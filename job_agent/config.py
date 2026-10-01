"""Loads config.yaml plus secrets from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class SearchQuery:
    keywords: str
    location: str = ""


@dataclass
class SearchConfig:
    queries: list[SearchQuery]
    posted_within_days: int = 7
    # Any of: onsite, remote, hybrid. Empty means no filter.
    work_types: list[str] = field(default_factory=list)
    easy_apply_only: bool = True
    max_results_per_query: int = 25
    min_score: int = 70
    max_drafts_per_run: int = 5


@dataclass
class EmailConfig:
    your_address: str          # reviews go here; only replies from here count
    agent_address: str         # mailbox the agent sends from and reads
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 465
    imap_host: str = "imap.gmail.com"
    imap_port: int = 993
    password_env: str = "JOB_AGENT_EMAIL_PASSWORD"

    @property
    def password(self) -> str:
        value = os.environ.get(self.password_env)
        if not value:
            raise RuntimeError(
                f"Set the {self.password_env} environment variable to the mailbox "
                "password (for Gmail, an App Password)."
            )
        return value


@dataclass
class ApplyConfig:
    mode: str = "easy_apply"   # easy_apply | manual
    dry_run: bool = True       # stop just before LinkedIn's final "Submit"
    headless: bool = False
    max_steps: int = 15
    screening_answers: dict[str, str] = field(default_factory=dict)


@dataclass
class Candidate:
    name: str
    email: str
    phone: str = ""
    location: str = ""
    linkedin_url: str = ""


@dataclass
class Config:
    root: Path
    candidate: Candidate
    resume_file: Path
    details_file: Path
    search: SearchConfig
    email: EmailConfig
    apply: ApplyConfig
    model: str = "claude-opus-5-5"
    data_dir: Path = Path("data")
    poll_seconds: int = 120

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jobs.sqlite3"

    @property
    def browser_profile(self) -> Path:
        return self.data_dir / "browser-profile"

    def job_dir(self, job_id: int) -> Path:
        path = self.data_dir / "jobs" / str(job_id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def master_resume(self) -> str:
        return self.resume_file.read_text(encoding="utf-8")

    def details(self) -> str:
        return self.details_file.read_text(encoding="utf-8") if self.details_file.exists() else ""


def load_config(path: str | Path = "config.yaml") -> Config:
    path = Path(path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Copy config.example.yaml to config.yaml and fill it in.")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    root = path.parent

    def rel(p: str) -> Path:
        candidate = Path(p)
        return candidate if candidate.is_absolute() else root / candidate

    search_raw = dict(raw.get("search") or {})
    queries = [SearchQuery(**q) for q in search_raw.pop("queries", [])]
    if not queries:
        raise ValueError("config.yaml: search.queries must list at least one query")

    cfg = Config(
        root=root,
        candidate=Candidate(**raw["candidate"]),
        resume_file=rel(raw.get("resume_file", "profile/resume.md")),
        details_file=rel(raw.get("details_file", "profile/details.md")),
        search=SearchConfig(queries=queries, **search_raw),
        email=EmailConfig(**raw["email"]),
        apply=ApplyConfig(**(raw.get("apply") or {})),
        model=raw.get("model", "claude-opus-5-5"),
        data_dir=rel(raw.get("data_dir", "data")),
        poll_seconds=int(raw.get("poll_seconds", 120)),
    )
    if cfg.apply.mode not in ("easy_apply", "manual"):
        raise ValueError("config.yaml: apply.mode must be 'easy_apply' or 'manual'")
    if not cfg.resume_file.exists():
        raise FileNotFoundError(f"Master resume not found at {cfg.resume_file}")
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    return cfg
