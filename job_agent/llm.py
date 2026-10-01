"""Claude calls: score a job against your profile, and tailor the resume + cover letter."""

from __future__ import annotations

import anthropic
from pydantic import BaseModel, Field

FALLBACK_BETA = "server-side-fallback-2026-07-01"

HONESTY_RULES = """\
Hard rules - these override any instinct to make the candidate look better:
- Never invent or inflate anything: no new employers, titles, dates, degrees, certifications,
  tools, skills, metrics, team sizes, or responsibilities that the master resume or the
  candidate's extra details do not support.
- You MAY reorder sections and bullets, rephrase bullets, tighten wording, pick which true
  accomplishments to emphasize, and use the posting's terminology where it truthfully
  describes something the candidate did (e.g. "stakeholder management" for a bullet that
  clearly describes it).
- If the posting asks for something the candidate lacks, do not paper over it. List it in
  `gaps` so the candidate can decide.
"""


class JobFit(BaseModel):
    score: int = Field(description="0-100: how well the candidate fits this role as it stands today")
    summary: str = Field(description="Two or three sentences on why")
    strengths: list[str] = Field(description="Requirements the candidate clearly meets")
    gaps: list[str] = Field(description="Requirements the candidate does not clearly meet")


class TailoredDocs(BaseModel):
    resume_markdown: str = Field(
        description="Full tailored resume in simple Markdown: '# Name', contact line, '## Section', "
        "'### Role | Company | Dates', '- bullet'. No tables, no images."
    )
    cover_letter_markdown: str = Field(
        description="Cover letter in plain paragraphs (Markdown), 250-400 words, addressed to the hiring team"
    )
    changes: list[str] = Field(description="Plain-English list of what was changed from the master resume and why")
    keywords_matched: list[str] = Field(description="Posting keywords now reflected truthfully in the resume")
    gaps: list[str] = Field(description="Posting requirements the candidate does not meet; not addressed in the resume")


class Claude:
    def __init__(self, model: str):
        self.client = anthropic.Anthropic()
        self.model = model

    def _parse(self, system: str, user: str, schema: type[BaseModel], effort: str) -> BaseModel:
        # The candidate profile is the stable prefix, so auto-caching reuses it across jobs.
        response = self.client.beta.messages.parse(
            model=self.model,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            cache_control={"type": "ephemeral"},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
        if response.stop_reason == "refusal":
            raise RuntimeError("Claude declined this request")
        if response.stop_reason == "max_tokens" or response.parsed_output is None:
            raise RuntimeError(f"Claude returned no usable output (stop_reason={response.stop_reason})")
        return response.parsed_output

    @staticmethod
    def _profile_system(role: str, resume: str, details: str) -> str:
        return (
            f"{role}\n\n{HONESTY_RULES}\n"
            f"<master_resume>\n{resume}\n</master_resume>\n\n"
            f"<candidate_details>\n{details or '(none provided)'}\n</candidate_details>"
        )

    def score_job(self, resume: str, details: str, title: str, company: str, description: str) -> JobFit:
        system = self._profile_system(
            "You are an experienced technical recruiter screening roles for one candidate. "
            "Judge fit honestly from the candidate's real background and stated preferences.",
            resume,
            details,
        )
        user = f"<job>\nTitle: {title}\nCompany: {company}\n\n{description}\n</job>\n\nScore this candidate's fit."
        return self._parse(system, user, JobFit, effort="low")

    def tailor(
        self,
        resume: str,
        details: str,
        candidate_name: str,
        title: str,
        company: str,
        description: str,
        previous: TailoredDocs | None = None,
        feedback: str | None = None,
    ) -> TailoredDocs:
        system = self._profile_system(
            "You tailor a candidate's resume and write their cover letter for one specific job, "
            "the way a strong recruiter would: lead with what this hiring manager is screening for, "
            "mirror the posting's language where it is true, keep it ATS-friendly and about the "
            "same length as the master resume.",
            resume,
            details,
        )
        parts = [f"<job>\nTitle: {title}\nCompany: {company}\n\n{description}\n</job>"]
        if previous is not None:
            parts.append(f"<current_resume_draft>\n{previous.resume_markdown}\n</current_resume_draft>")
            parts.append(f"<current_cover_letter_draft>\n{previous.cover_letter_markdown}\n</current_cover_letter_draft>")
        if feedback:
            parts.append(
                "<candidate_feedback>\n"
                f"{feedback}\n"
                "</candidate_feedback>\n"
                "Revise the current drafts to address this feedback. The candidate's feedback is "
                "authoritative about their own background; the honesty rules still apply to everything else."
            )
        else:
            parts.append(f"Write the tailored resume and a cover letter signed by {candidate_name}.")
        return self._parse(system, "\n\n".join(parts), TailoredDocs, effort="high")
