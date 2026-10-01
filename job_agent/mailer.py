"""SMTP for sending review emails, IMAP for reading your replies."""

from __future__ import annotations

import email
import email.policy
import html
import imaplib
import mimetypes
import re
import smtplib
from dataclasses import dataclass, field
from datetime import date, timedelta
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr
from pathlib import Path

from job_agent.config import EmailConfig

AGENT_HEADER = "X-JobAgent"


@dataclass
class Attachment:
    filename: str
    data: bytes


@dataclass
class IncomingMail:
    message_id: str
    sender: str
    subject: str
    body: str
    attachments: list[Attachment] = field(default_factory=list)
    from_agent: bool = False


class Mailer:
    def __init__(self, cfg: EmailConfig):
        self.cfg = cfg

    def send(self, subject: str, body: str, attachments: list[Path] = (), kind: str = "notice") -> str:
        msg = EmailMessage()
        msg["From"] = self.cfg.agent_address
        msg["To"] = self.cfg.your_address
        msg["Subject"] = subject
        msg["Message-ID"] = make_msgid(domain="job-agent.local")
        # Marks our own outgoing mail so the inbox poller never treats it as your reply
        # (matters when agent_address == your_address).
        msg[AGENT_HEADER] = kind
        msg.set_content(body)
        for path in attachments:
            ctype, _ = mimetypes.guess_type(path.name)
            maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
            msg.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name)
        with smtplib.SMTP_SSL(self.cfg.smtp_host, self.cfg.smtp_port) as smtp:
            smtp.login(self.cfg.agent_address, self.cfg.password)
            smtp.send_message(msg)
        return msg["Message-ID"]

    def fetch_recent(self, already_seen=lambda message_id: False, days: int = 14) -> list[IncomingMail]:
        """Messages from your address in the last `days` days that `already_seen` hasn't handled."""
        since = (date.today() - timedelta(days=days)).strftime("%d-%b-%Y")
        out: list[IncomingMail] = []
        with imaplib.IMAP4_SSL(self.cfg.imap_host, self.cfg.imap_port) as imap:
            imap.login(self.cfg.agent_address, self.cfg.password)
            imap.select("INBOX", readonly=True)
            status, data = imap.search(None, "SINCE", since, "FROM", f'"{self.cfg.your_address}"')
            if status != "OK":
                return out
            for num in data[0].split():
                status, head = imap.fetch(num, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
                if status == "OK" and head and isinstance(head[0], tuple):
                    header = email.message_from_bytes(head[0][1], policy=email.policy.default)
                    if already_seen((header["Message-ID"] or "").strip()):
                        continue
                status, parts = imap.fetch(num, "(BODY.PEEK[])")
                if status != "OK" or not parts or not isinstance(parts[0], tuple):
                    continue
                out.append(parse_message(parts[0][1]))
        your = self.cfg.your_address.lower()
        return [m for m in out if m.sender == your and not m.from_agent]


def _html_to_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style).*?</\1>", "", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", markup)
    # Gmail wraps the quoted original in a blockquote; turn it into "> " lines so it gets stripped.
    markup = re.sub(r"(?is)<blockquote.*?</blockquote>", "\n> quoted\n", markup)
    return html.unescape(re.sub(r"<[^>]+>", "", markup))


def parse_message(raw: bytes) -> IncomingMail:
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    body_part = msg.get_body(preferencelist=("plain", "html"))
    body = ""
    if body_part is not None:
        body = body_part.get_content()
        if body_part.get_content_type() == "text/html":
            body = _html_to_text(body)
    attachments = []
    for part in msg.iter_attachments():
        name = part.get_filename()
        if name:
            attachments.append(Attachment(name, part.get_payload(decode=True) or b""))
    return IncomingMail(
        message_id=(msg["Message-ID"] or "").strip(),
        sender=parseaddr(msg["From"] or "")[1].lower(),
        subject=str(msg["Subject"] or ""),
        body=body,
        attachments=attachments,
        from_agent=msg[AGENT_HEADER] is not None,
    )
