"""Pure parsing of your email replies. Approval is decided here by fixed rules, never by the model."""

from __future__ import annotations

import re
import secrets
import string
from dataclasses import dataclass

SUBJECT_TAG = re.compile(r"\[JobAgent #(\d+) r(\d+) ([A-Z0-9]{6})\]")
SEARCH_TRIGGER = re.compile(r"\b(look|search|find)\b.*\bjobs?\b", re.IGNORECASE)

QUOTE_HEADER = re.compile(
    r"^(On .+wrote:|-----Original Message-----|From: .+|________________________________)\s*$"
)
APPROVE = re.compile(r"^\s*(i\s+)?approved?\b", re.IGNORECASE)
SKIP = re.compile(r"^\s*(skip|reject|rejected|pass|no thanks)\b", re.IGNORECASE)
# Words that turn "approve ..." into a conditional approval, which we treat as edit requests.
CONDITIONAL = re.compile(r"\b(but|except|however|change|edit|fix|update|instead|tweak|remove|add)\b", re.IGNORECASE)


def new_review_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(6))


def subject_tag(job_id: int, revision: int, code: str) -> str:
    return f"[JobAgent #{job_id} r{revision} {code}]"


@dataclass
class SubjectRef:
    job_id: int
    revision: int
    code: str


def parse_subject(subject: str) -> SubjectRef | None:
    m = SUBJECT_TAG.search(subject or "")
    if not m:
        return None
    return SubjectRef(int(m.group(1)), int(m.group(2)), m.group(3))


def strip_quoted(body: str) -> str:
    """Keep only what you typed, dropping the quoted original message."""
    kept = []
    for line in (body or "").replace("\r\n", "\n").splitlines():
        if line.lstrip().startswith(">") or QUOTE_HEADER.match(line.strip()):
            break
        kept.append(line)
    return "\n".join(kept).strip()


@dataclass
class Decision:
    action: str          # approve | skip | edit | empty
    text: str            # your reply text, quotes removed


def classify_reply(body: str) -> Decision:
    text = strip_quoted(body)
    if not text:
        return Decision("empty", text)
    words = text.split()
    if APPROVE.match(text) and len(words) <= 15 and not CONDITIONAL.search(text):
        return Decision("approve", text)
    if SKIP.match(text) and len(words) <= 15:
        return Decision("skip", text)
    return Decision("edit", text)


def is_search_request(subject: str, body: str) -> bool:
    if parse_subject(subject):
        return False
    return bool(SEARCH_TRIGGER.search(subject or "") or SEARCH_TRIGGER.search(strip_quoted(body)[:200]))
