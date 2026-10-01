from pathlib import Path

import pytest

from job_agent import linkedin, workflow
from job_agent.config import ApplyConfig, Candidate, Config, EmailConfig, SearchConfig, SearchQuery
from job_agent.documents import docx_to_text, markdown_to_docx
from job_agent.llm import JobFit, TailoredDocs
from job_agent.mailer import Attachment, IncomingMail, parse_message
from job_agent.review import classify_reply, is_search_request, parse_subject, strip_quoted, subject_tag

ME = "me@example.com"

# ----------------------------------------------------------------------------- reply parsing


@pytest.mark.parametrize(
    "body",
    ["Approve", "approve this resume and cover letter", "Approved!", "APPROVE\n\nOn Wed, Oct 1 X wrote:\n> Review"],
)
def test_approve_variants(body):
    assert classify_reply(body).action == "approve"


@pytest.mark.parametrize(
    "body",
    [
        "Approve but change the summary to mention SQL",
        "Looks good, approve",  # doesn't *start* with approve -> treated as feedback, not consent
        "I don't approve this",
        "Please emphasize my Python work",
    ],
)
def test_non_approvals_become_edits(body):
    assert classify_reply(body).action == "edit"


def test_skip_and_empty():
    assert classify_reply("Skip, not interested").action == "skip"
    assert classify_reply("> only quoted text").action == "empty"


def test_strip_quoted_gmail_style():
    body = "Lead with the dashboard project.\n\nOn Wed, Oct 1, 2026 at 9:00 AM Agent <a@b.c> wrote:\n> old text"
    assert strip_quoted(body) == "Lead with the dashboard project."


def test_subject_roundtrip():
    tag = subject_tag(12, 3, "AB12CD")
    ref = parse_subject(f"Re: Review: Analyst @ Acme {tag}")
    assert (ref.job_id, ref.revision, ref.code) == (12, 3, "AB12CD")
    assert parse_subject("Re: hello") is None


def test_search_request_detection():
    assert is_search_request("look for matching jobs", "")
    assert is_search_request("hi", "Please find me new jobs today")
    assert not is_search_request(f"Re: {subject_tag(1, 1, 'AAAAAA')}", "look for jobs")


# ----------------------------------------------------------------------------- LinkedIn parsing

SEARCH_HTML = """
<li><div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:4012345678">
  <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/x-4012345678?trk=1"></a>
  <h3 class="base-search-card__title"> Data Analyst </h3>
  <h4 class="base-search-card__subtitle"><a>Acme Corp</a></h4>
  <span class="job-search-card__location">Remote</span>
</div></li>
<li><div class="base-card" data-entity-urn="urn:li:somethingElse:1"></div></li>
"""


def test_parse_search_results():
    jobs = linkedin.parse_search_results(SEARCH_HTML)
    assert len(jobs) == 1
    job = jobs[0]
    assert (job.linkedin_id, job.title, job.company, job.location) == ("4012345678", "Data Analyst", "Acme Corp", "Remote")
    assert job.url == "https://www.linkedin.com/jobs/view/4012345678/"


def test_parse_description_and_url():
    html = '<div class="show-more-less-html__markup"><p>Must know SQL.</p><ul><li>Tableau</li></ul></div>'
    assert linkedin.parse_description(html) == "Must know SQL.\nTableau"
    cfg = SearchConfig(queries=[], posted_within_days=1, work_types=["remote", "hybrid"])
    url = linkedin.search_url(SearchQuery("Data Analyst", "NYC"), cfg, 10)
    assert "f_TPR=r86400" in url and "f_WT=2%2C3" in url and "f_AL=true" in url and "start=10" in url


def test_answer_matching():
    cand = Candidate(name="A", email="a@b.c", phone="555")
    answers = {"years of experience": "4"}
    assert linkedin._answer_for("How many years of experience do you have with SQL?", cand, answers) == "4"
    assert linkedin._answer_for("Mobile phone number", cand, answers) == "555"
    assert linkedin._answer_for("Favourite colour?", cand, answers) is None


# ----------------------------------------------------------------------------- documents


def test_docx_roundtrip(tmp_path):
    md = "# Jane Doe\njane@x.com\n## Experience\n### Analyst | Acme | 2020\n- Built **dashboards**\nPlain line"
    path = markdown_to_docx(md, tmp_path / "r.docx")
    text = docx_to_text(path)
    assert "# Jane Doe" in text and "## Experience" in text and "- Built dashboards" in text


def test_parse_message_with_attachment():
    raw = (
        b"From: Me <ME@example.com>\r\nSubject: Re: x\r\nMessage-ID: <1@x>\r\nMIME-Version: 1.0\r\n"
        b'Content-Type: multipart/mixed; boundary="B"\r\n\r\n--B\r\nContent-Type: text/plain\r\n\r\nApprove\r\n'
        b'--B\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="Resume.docx"\r\n'
        b"Content-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--B--\r\n"
    )
    mail = parse_message(raw)
    assert mail.sender == ME and mail.body.strip() == "Approve" and not mail.from_agent
    assert mail.attachments[0].filename == "Resume.docx" and mail.attachments[0].data == b"hello"


# ----------------------------------------------------------------------------- workflow + approval gate


class FakeMailer:
    def __init__(self):
        self.sent = []

    def send(self, subject, body, attachments=(), kind="notice"):
        self.sent.append((subject, body, [Path(a) for a in attachments]))

    def fetch_recent(self, already_seen=None, days=14):
        return []


class FakeClaude:
    def __init__(self):
        self.feedback = []

    def score_job(self, resume, details, title, company, description):
        return JobFit(score=90 if "Analyst" in title else 20, summary="fit", strengths=[], gaps=[])

    def tailor(self, resume, details, name, title, company, description, previous=None, feedback=None):
        self.feedback.append(feedback)
        return TailoredDocs(
            resume_markdown=f"# {name}\n## Summary\nTailored for {company} {len(self.feedback)}",
            cover_letter_markdown=f"Dear {company} team,\nHello.",
            changes=["Reordered bullets"],
            keywords_matched=["SQL"],
            gaps=["No Tableau"],
        )


@pytest.fixture
def agent(tmp_path, monkeypatch):
    resume = tmp_path / "resume.md"
    resume.write_text("# Jane\n## Experience\n- SQL")
    cfg = Config(
        root=tmp_path,
        candidate=Candidate(name="Jane Doe", email=ME),
        resume_file=resume,
        details_file=tmp_path / "details.md",
        search=SearchConfig(queries=[SearchQuery("Analyst")], min_score=70),
        email=EmailConfig(your_address=ME, agent_address=ME),
        apply=ApplyConfig(mode="easy_apply", dry_run=False),
        data_dir=tmp_path / "data",
    )
    a = workflow.Agent(cfg)
    a.mailer = FakeMailer()
    a._claude = FakeClaude()
    listings = [
        linkedin.JobListing("111", "Data Analyst", "Acme", "Remote", "https://www.linkedin.com/jobs/view/111/", "SQL"),
        linkedin.JobListing("222", "Chef", "Diner", "NYC", "https://www.linkedin.com/jobs/view/222/", "Cook"),
    ]
    monkeypatch.setattr(linkedin, "search", lambda cfg, known: listings)
    a.applied = []
    monkeypatch.setattr(linkedin, "easy_apply", lambda url, resume, cover, *rest: a.applied.append((url, resume, cover)))
    return a


def reply(agent, job_id, body, attachments=(), n=[0], subject=None):
    job = agent.store.get(job_id)
    n[0] += 1
    agent.handle_mail(
        IncomingMail(
            message_id=f"<{n[0]}@x>",
            sender=ME,
            subject=subject or f"Re: Review {subject_tag(job.id, job.revision, job.review_code)}",
            body=body,
            attachments=list(attachments),
        )
    )


def test_full_flow_requires_approval(agent):
    drafted = agent.search_and_draft()
    assert drafted == [1]
    assert agent.store.get(2).status == "low_match"
    job = agent.store.get(1)
    assert job.status == "awaiting_review" and job.revision == 1
    review = [s for s in agent.mailer.sent if s[0].startswith("Review:")][0]
    assert len(review[2]) == 2 and all(p.exists() for p in review[2])
    assert "No Tableau" in review[1]

    # Direct apply without approval is refused.
    with pytest.raises(PermissionError):
        agent.apply(1)

    # Feedback -> new revision, nothing applied.
    reply(agent, 1, "Lead with the SQL work please")
    job = agent.store.get(1)
    assert job.revision == 2 and job.status == "awaiting_review" and agent.applied == []
    assert agent._claude.feedback[-1] == "Lead with the SQL work please"

    # Approval of the stale revision is ignored.
    old = subject_tag(1, 1, "ZZZZZZ")
    reply(agent, 1, "Approve", subject=f"Re: {old}")
    assert agent.store.get(1).status == "awaiting_review" and agent.applied == []

    reply(agent, 1, "Approve this resume and cover letter")
    assert agent.store.get(1).status == "applied"
    assert len(agent.applied) == 1 and "r2" in str(agent.applied[0][1])


def test_approve_with_edited_attachment_submits_your_file(agent, tmp_path):
    agent.search_and_draft()
    edited = markdown_to_docx("# Jane Doe\n## Summary\nMy own words", tmp_path / "x.docx").read_bytes()
    reply(agent, 1, "Approve", [Attachment("Jane Doe Acme Resume.docx", edited)])
    url, resume, cover = agent.applied[0]
    assert "yours" in str(resume) and resume.read_bytes() == edited
    assert "Cover Letter" in cover.name


def test_attachment_without_approval_needs_another_round(agent, tmp_path):
    agent.search_and_draft()
    edited = markdown_to_docx("# Jane\nMine", tmp_path / "x.docx").read_bytes()
    reply(agent, 1, "Here is my version", [Attachment("Resume.docx", edited)])
    job = agent.store.get(1)
    assert job.status == "awaiting_review" and job.revision == 2 and agent.applied == []
    assert "YOUR edited files" in agent.mailer.sent[-1][1]


def test_skip_and_foreign_sender(agent):
    agent.search_and_draft()
    job = agent.store.get(1)
    agent.handle_mail(
        IncomingMail("<evil@x>", "attacker@example.com", f"Re: {subject_tag(1, 1, job.review_code)}", "Approve")
    )
    assert agent.store.get(1).status == "awaiting_review"
    reply(agent, 1, "Skip")
    assert agent.store.get(1).status == "rejected" and agent.applied == []


def test_not_easy_apply_falls_back_to_manual(agent, monkeypatch):
    agent.search_and_draft()

    def no_button(*a, **k):
        raise linkedin.NotEasyApply("x")

    monkeypatch.setattr(linkedin, "easy_apply", no_button)
    reply(agent, 1, "approve")
    assert agent.store.get(1).status == "needs_manual"
    assert "Ready for you to submit" in agent.mailer.sent[-1][0]


def test_search_by_email(agent):
    agent.handle_mail(IncomingMail("<s@x>", ME, "Look for matching jobs", ""))
    assert agent.store.get(1).status == "awaiting_review"
