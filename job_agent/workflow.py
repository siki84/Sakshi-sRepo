"""The agent loop: find jobs -> tailor -> email you -> wait for APPROVE -> apply."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from job_agent import linkedin
from job_agent.config import Config
from job_agent.documents import docx_to_text, markdown_to_docx
from job_agent.llm import Claude, TailoredDocs
from job_agent.mailer import Attachment, IncomingMail, Mailer
from job_agent.review import classify_reply, is_search_request, new_review_code, parse_subject, subject_tag
from job_agent.store import Job, Store

log = logging.getLogger("job_agent")

REVIEW_INSTRUCTIONS = """\
How to respond (reply to this email, keep the subject line as is):

  * APPROVE      - reply with just "Approve" (or "Approve this resume and cover letter").
                   Only then will I apply. If you edited the attached .docx files, attach
                   them to the same reply and I'll submit your versions exactly.
  * CHANGES      - reply describing what to change (e.g. "drop the Acme internship, lead
                   with the data pipeline work"). I'll revise and send a new version.
                   You can also attach edited .docx files without approving to get them
                   sent back for a final look.
  * SKIP         - reply "Skip" and I won't apply to this job.

An approval only counts for the newest version (the r-number in the subject).
"""


class Agent:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.store = Store(cfg.db_path)
        self.mailer = Mailer(cfg.email)
        self._claude: Claude | None = None

    @property
    def claude(self) -> Claude:
        if self._claude is None:
            self._claude = Claude(self.cfg.model)
        return self._claude

    # ------------------------------------------------------------------ search + draft

    def search_and_draft(self) -> list[int]:
        """Search LinkedIn, score new postings, and send review emails for the best matches."""
        resume, details = self.cfg.master_resume(), self.cfg.details()
        listings = linkedin.search(self.cfg.search, known=self.store.has_job)
        log.info("Found %d new postings", len(listings))

        scored: list[tuple[int, int]] = []
        for listing in listings:
            job_id = self.store.add_job(
                listing.linkedin_id, listing.title, listing.company, listing.location, listing.url, listing.description
            )
            fit = self.claude.score_job(resume, details, listing.title, listing.company, listing.description)
            self.store.update(job_id, score=fit.score, fit=fit.model_dump())
            log.info("#%d %s @ %s: score %d", job_id, listing.title, listing.company, fit.score)
            if fit.score >= self.cfg.search.min_score:
                scored.append((fit.score, job_id))
            else:
                self.store.update(job_id, status="low_match")

        drafted = []
        for _, job_id in sorted(scored, reverse=True)[: self.cfg.search.max_drafts_per_run]:
            self.draft(job_id)
            drafted.append(job_id)
        for _, job_id in sorted(scored, reverse=True)[self.cfg.search.max_drafts_per_run :]:
            self.store.update(job_id, status="match_not_drafted")

        self.mailer.send(
            f"[JobAgent] Search done: {len(listings)} new postings, {len(drafted)} sent for review",
            self._search_summary(listings, drafted),
        )
        return drafted

    def _search_summary(self, listings, drafted: list[int]) -> str:
        lines = [f"I checked {len(listings)} new LinkedIn postings.", ""]
        if drafted:
            lines.append("Sent to you for review (separate emails):")
            for job_id in drafted:
                job = self.store.get(job_id)
                lines.append(f"  #{job.id}  {job.score}/100  {job.title} @ {job.company}  {job.url}")
        else:
            lines.append(f"None scored {self.cfg.search.min_score}+ for fit, so nothing to review.")
        return "\n".join(lines)

    def draft(self, job_id: int, feedback: str | None = None) -> None:
        """Generate (or revise) tailored docs and email them for review."""
        job = self.store.get(job_id)
        previous = self._load_drafts(job) if feedback else None
        docs = self.claude.tailor(
            self.cfg.master_resume(),
            self.cfg.details(),
            self.cfg.candidate.name,
            job.title,
            job.company,
            job.description,
            previous=previous,
            feedback=feedback,
        )
        revision = job.revision + 1
        resume_path, cover_path = self._write_drafts(job, revision, docs)
        code = new_review_code()
        self.store.update(
            job_id,
            status="awaiting_review",
            revision=revision,
            review_code=code,
            approved_revision=None,
            resume_path=str(resume_path),
            cover_path=str(cover_path),
        )
        self.store.log(job_id, "drafted", f"r{revision}" + (f" feedback: {feedback}" if feedback else ""))
        self._send_review(self.store.get(job_id), docs)

    def _write_drafts(self, job: Job, revision: int, docs: TailoredDocs) -> tuple[Path, Path]:
        d = self.cfg.job_dir(job.id)
        (d / f"r{revision}.json").write_text(docs.model_dump_json(indent=2), encoding="utf-8")
        stem = _safe(f"{self.cfg.candidate.name} {job.company}")
        resume = markdown_to_docx(docs.resume_markdown, d / f"r{revision}" / f"{stem} Resume.docx")
        cover = markdown_to_docx(docs.cover_letter_markdown, d / f"r{revision}" / f"{stem} Cover Letter.docx")
        return resume, cover

    def _load_drafts(self, job: Job) -> TailoredDocs | None:
        path = self.cfg.job_dir(job.id) / f"r{job.revision}.json"
        return TailoredDocs.model_validate_json(path.read_text(encoding="utf-8")) if path.exists() else None

    def _send_review(self, job: Job, docs: TailoredDocs | None, note: str = "") -> None:
        fit = job.fit or {}
        lines = [
            f"{job.title} @ {job.company} ({job.location})",
            job.url,
            f"Fit score: {job.score}/100 - {fit.get('summary', '')}",
            "",
        ]
        if note:
            lines += [note, ""]
        if docs is not None:
            lines += ["What I changed from your master resume:"] + [f"  - {c}" for c in docs.changes]
            if docs.keywords_matched:
                lines += ["", "Posting keywords now reflected: " + ", ".join(docs.keywords_matched)]
            if docs.gaps:
                lines += ["", "Gaps I did NOT paper over (you may want to address these):"]
                lines += [f"  - {g}" for g in docs.gaps]
            lines += ["", "-" * 60, "COVER LETTER (also attached)", "-" * 60, docs.cover_letter_markdown, ""]
        lines += ["-" * 60, REVIEW_INSTRUCTIONS]
        subject = f"Review: {job.title} @ {job.company} {subject_tag(job.id, job.revision, job.review_code)}"
        self.mailer.send(subject, "\n".join(lines), [Path(job.resume_path), Path(job.cover_path)], kind="review")
        log.info("Sent review email for #%d r%d", job.id, job.revision)

    # ------------------------------------------------------------------ inbox

    def process_inbox(self) -> None:
        for mail in self.mailer.fetch_recent(already_seen=self.store.email_processed):
            if not mail.message_id or self.store.email_processed(mail.message_id):
                continue
            try:
                self.handle_mail(mail)
            except Exception as exc:  # keep polling; tell the user what broke
                log.exception("Failed handling %s", mail.subject)
                self.mailer.send(f"[JobAgent] Error handling: {mail.subject}", f"{type(exc).__name__}: {exc}")
            finally:
                self.store.mark_email_processed(mail.message_id)

    def handle_mail(self, mail: IncomingMail) -> None:
        if mail.sender != self.cfg.email.your_address.lower() or mail.from_agent:
            return
        ref = parse_subject(mail.subject)
        if ref is None:
            if is_search_request(mail.subject, mail.body):
                log.info("Search requested by email")
                self.search_and_draft()
            return

        job = self.store.get(ref.job_id)
        if job is None or job.review_code is None:
            return
        if job.status != "awaiting_review":
            self.mailer.send(f"[JobAgent] #{job.id} is already '{job.status}'", "No action taken.")
            return
        if ref.revision != job.revision or ref.code != job.review_code:
            self.mailer.send(
                f"[JobAgent] #{job.id}: that reply was for an older version",
                f"You replied to r{ref.revision}, but the newest version is r{job.revision}. "
                "Please reply to the newest review email. Nothing was applied.",
            )
            return

        decision = classify_reply(mail.body)
        edited = [a for a in mail.attachments if a.filename.lower().endswith(".docx")]
        self.store.log(job.id, f"reply_{decision.action}", decision.text[:2000])

        if decision.action == "approve":
            if edited:
                self._adopt_attachments(job, edited, keep_revision=True)
            self.store.update(job.id, status="approved", approved_revision=job.revision)
            self.apply(job.id)
        elif decision.action == "skip":
            self.store.update(job.id, status="rejected")
            self.mailer.send(f"[JobAgent] #{job.id} skipped", f"OK, I won't apply to {job.title} @ {job.company}.")
        elif edited:
            # Your own edits come back to you as a new revision to approve explicitly.
            self._adopt_attachments(job, edited, keep_revision=False)
            note = "These are YOUR edited files, unchanged."
            if decision.action == "edit":
                note += f" (I did not apply your written notes to them: \"{decision.text[:300]}\".)"
            self._send_review(self.store.get(job.id), None, note=note)
        elif decision.action == "edit":
            self.draft(job.id, feedback=decision.text)

    def _adopt_attachments(self, job: Job, files: list[Attachment], keep_revision: bool) -> None:
        revision = job.revision if keep_revision else job.revision + 1
        d = self.cfg.job_dir(job.id) / f"r{revision}-yours"
        d.mkdir(parents=True, exist_ok=True)
        resume_path, cover_path = Path(job.resume_path), Path(job.cover_path)
        for att in files:
            path = d / _safe(att.filename)
            path.write_bytes(att.data)
            if "cover" in att.filename.lower():
                cover_path = path
            else:
                resume_path = path
        updates = dict(resume_path=str(resume_path), cover_path=str(cover_path))
        if not keep_revision:
            updates.update(revision=revision, review_code=new_review_code())
            # Snapshot the text so later "CHANGES" replies revise your version, not the old draft.
            prev = self._load_drafts(job)
            snapshot = TailoredDocs(
                resume_markdown=docx_to_text(resume_path),
                cover_letter_markdown=docx_to_text(cover_path),
                changes=["Your manual edits"],
                keywords_matched=prev.keywords_matched if prev else [],
                gaps=prev.gaps if prev else [],
            )
            (self.cfg.job_dir(job.id) / f"r{revision}.json").write_text(snapshot.model_dump_json(indent=2), encoding="utf-8")
        self.store.update(job.id, **updates)
        self.store.log(job.id, "adopted_your_files", json.dumps([f.filename for f in files]))

    # ------------------------------------------------------------------ apply

    def apply(self, job_id: int) -> str:
        job = self.store.get(job_id)
        # The one gate every application passes through: an explicit approval of the current revision.
        # needs_manual/failed are retryable because they were reached only after approval.
        if job.approved_revision != job.revision or job.status not in ("approved", "needs_manual", "failed"):
            raise PermissionError(f"Job #{job_id} is not approved (status={job.status}); refusing to apply.")

        resume, cover = Path(job.resume_path), Path(job.cover_path)
        if self.cfg.apply.mode == "manual":
            return self._needs_manual(job, "apply.mode is 'manual'")

        try:
            linkedin.easy_apply(job.url, resume, cover, self.cfg.candidate, self.cfg.apply, self.cfg.browser_profile)
        except linkedin.NotEasyApply:
            return self._needs_manual(job, "this posting has no Easy Apply; it applies on the company's site")
        except linkedin.StoppedBeforeSubmit:
            return self._needs_manual(
                job, "dry_run is on, so I filled the Easy Apply form but did not press Submit"
            )
        except linkedin.NeedsHuman as exc:
            qs = "\n".join(f"  - {q}" for q in exc.questions)
            return self._needs_manual(
                job,
                "the application form asked questions I have no answer for:\n"
                f"{qs}\n\nAdd answers under apply.screening_answers in config.yaml and run "
                f"`python -m job_agent apply {job.id}`, or apply yourself",
            )
        except Exception as exc:
            self.store.update(job.id, status="failed", notes=str(exc))
            self.mailer.send(f"[JobAgent] #{job.id} application failed", f"{type(exc).__name__}: {exc}\n{job.url}")
            return "failed"

        self.store.update(job.id, status="applied")
        self.store.log(job.id, "applied", job.url)
        self.mailer.send(
            f"[JobAgent] Applied: {job.title} @ {job.company}",
            f"Submitted via LinkedIn Easy Apply with your approved r{job.revision} documents (attached).\n{job.url}",
            [resume, cover],
        )
        return "applied"

    def _needs_manual(self, job: Job, reason: str) -> str:
        self.store.update(job.id, status="needs_manual", notes=reason)
        self.store.log(job.id, "needs_manual", reason)
        self.mailer.send(
            f"[JobAgent] Ready for you to submit: {job.title} @ {job.company}",
            f"Your approved documents are attached. I didn't submit because {reason}.\n\n"
            f"Apply here: {job.url}\n\n"
            f"Once you've applied, run `python -m job_agent mark-applied {job.id}` to keep the tracker accurate.",
            [Path(job.resume_path), Path(job.cover_path)],
        )
        return "needs_manual"


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in " .-_" else "_" for c in name).strip()[:120]
