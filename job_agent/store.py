"""SQLite state for jobs, review rounds, and processed emails.

Job lifecycle:
    new -> low_match                       (scored below threshold)
    new -> awaiting_review                 (tailored docs emailed to you)
    awaiting_review -> awaiting_review     (you sent edits; revision += 1)
    awaiting_review -> approved            (you replied APPROVE to the latest revision)
    awaiting_review -> rejected            (you replied SKIP)
    approved -> applied | needs_manual | failed
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    url TEXT NOT NULL,
    description TEXT,
    score INTEGER,
    fit_json TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    revision INTEGER NOT NULL DEFAULT 0,
    review_code TEXT,
    approved_revision INTEGER,
    resume_path TEXT,
    cover_path TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_emails (
    message_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Job:
    id: int
    linkedin_id: str
    title: str
    company: str
    location: str
    url: str
    description: str
    score: int | None
    fit: dict
    status: str
    revision: int
    review_code: str | None
    approved_revision: int | None
    resume_path: str | None
    cover_path: str | None
    notes: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Job":
        return cls(
            id=row["id"],
            linkedin_id=row["linkedin_id"],
            title=row["title"],
            company=row["company"],
            location=row["location"] or "",
            url=row["url"],
            description=row["description"] or "",
            score=row["score"],
            fit=json.loads(row["fit_json"]) if row["fit_json"] else {},
            status=row["status"],
            revision=row["revision"],
            review_code=row["review_code"],
            approved_revision=row["approved_revision"],
            resume_path=row["resume_path"],
            cover_path=row["cover_path"],
            notes=row["notes"],
        )


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    def has_job(self, linkedin_id: str) -> bool:
        return self.conn.execute("SELECT 1 FROM jobs WHERE linkedin_id = ?", (linkedin_id,)).fetchone() is not None

    def add_job(self, linkedin_id: str, title: str, company: str, location: str, url: str, description: str) -> int:
        ts = now()
        cur = self.conn.execute(
            "INSERT INTO jobs (linkedin_id, title, company, location, url, description, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (linkedin_id, title, company, location, url, description, ts, ts),
        )
        self.conn.commit()
        self.log(cur.lastrowid, "found", url)
        return cur.lastrowid

    def get(self, job_id: int) -> Job | None:
        row = self.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return Job.from_row(row) if row else None

    def list(self, status: str | None = None) -> list[Job]:
        if status:
            rows = self.conn.execute("SELECT * FROM jobs WHERE status = ? ORDER BY id", (status,))
        else:
            rows = self.conn.execute("SELECT * FROM jobs ORDER BY id")
        return [Job.from_row(r) for r in rows]

    def update(self, job_id: int, **fields) -> None:
        if "fit" in fields:
            fields["fit_json"] = json.dumps(fields.pop("fit"))
        fields["updated_at"] = now()
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))
        self.conn.commit()

    def log(self, job_id: int | None, kind: str, detail: str = "") -> None:
        self.conn.execute(
            "INSERT INTO events (job_id, ts, kind, detail) VALUES (?, ?, ?, ?)", (job_id, now(), kind, detail)
        )
        self.conn.commit()

    def events(self, job_id: int) -> list[sqlite3.Row]:
        return list(self.conn.execute("SELECT * FROM events WHERE job_id = ? ORDER BY id", (job_id,)))

    def email_processed(self, message_id: str) -> bool:
        return (
            self.conn.execute("SELECT 1 FROM processed_emails WHERE message_id = ?", (message_id,)).fetchone()
            is not None
        )

    def mark_email_processed(self, message_id: str) -> None:
        self.conn.execute(
            "INSERT OR IGNORE INTO processed_emails (message_id, processed_at) VALUES (?, ?)", (message_id, now())
        )
        self.conn.commit()
