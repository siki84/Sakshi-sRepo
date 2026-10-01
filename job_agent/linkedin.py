"""LinkedIn job search (public guest listings) and Easy Apply (browser automation).

Search reads LinkedIn's public, logged-out job listings at a slow, polite rate.
Easy Apply drives a real Chrome window logged in as you (you log in yourself once
with `job-agent linkedin-login`; the agent never sees your password).

Be aware: LinkedIn's User Agreement prohibits automated access, and accounts that
use bots can be restricted. Keep volumes low, or set apply.mode: manual in
config.yaml to have the agent prepare everything and let you click Submit.
LinkedIn changes its page markup often; selectors here are best-effort.
"""

from __future__ import annotations

import random
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode

import requests
from bs4 import BeautifulSoup

from job_agent.config import ApplyConfig, Candidate, SearchConfig, SearchQuery

GUEST_SEARCH = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
GUEST_POSTING = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{id}"
JOB_VIEW = "https://www.linkedin.com/jobs/view/{id}/"
WORK_TYPES = {"onsite": "1", "remote": "2", "hybrid": "3"}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass
class JobListing:
    linkedin_id: str
    title: str
    company: str
    location: str
    url: str
    description: str = ""


def _pause() -> None:
    time.sleep(random.uniform(2.0, 5.0))


def search_url(query: SearchQuery, cfg: SearchConfig, start: int) -> str:
    params = {"keywords": query.keywords, "start": start}
    if query.location:
        params["location"] = query.location
    if cfg.posted_within_days:
        params["f_TPR"] = f"r{cfg.posted_within_days * 86400}"
    codes = [WORK_TYPES[w] for w in cfg.work_types if w in WORK_TYPES]
    if codes:
        params["f_WT"] = ",".join(codes)
    if cfg.easy_apply_only:
        params["f_AL"] = "true"
    return f"{GUEST_SEARCH}?{urlencode(params)}"


def parse_search_results(html: str) -> list[JobListing]:
    soup = BeautifulSoup(html, "html.parser")
    jobs = []
    for card in soup.select("div.base-card, div.job-search-card"):
        urn = card.get("data-entity-urn", "")
        m = re.search(r"jobPosting:(\d+)", urn)
        if not m:
            continue

        def text(sel: str) -> str:
            el = card.select_one(sel)
            return el.get_text(" ", strip=True) if el else ""

        job_id = m.group(1)
        jobs.append(
            JobListing(
                linkedin_id=job_id,
                title=text(".base-search-card__title"),
                company=text(".base-search-card__subtitle"),
                location=text(".job-search-card__location"),
                url=JOB_VIEW.format(id=job_id),
            )
        )
    return jobs


def parse_description(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".show-more-less-html__markup, .description__text")
    return el.get_text("\n", strip=True) if el else ""


def search(cfg: SearchConfig, known=lambda linkedin_id: False) -> list[JobListing]:
    """New listings across all configured queries, with descriptions filled in."""
    session = requests.Session()
    session.headers.update(HEADERS)
    found: dict[str, JobListing] = {}
    for query in cfg.queries:
        start = 0
        count = 0
        while count < cfg.max_results_per_query:
            resp = session.get(search_url(query, cfg, start), timeout=30)
            if resp.status_code == 429:
                raise RuntimeError("LinkedIn is rate limiting search; try again later.")
            resp.raise_for_status()
            page = parse_search_results(resp.text)
            if not page:
                break
            for job in page:
                if job.linkedin_id not in found and not known(job.linkedin_id):
                    found[job.linkedin_id] = job
                    count += 1
            start += len(page)
            _pause()
    for job in found.values():
        resp = session.get(GUEST_POSTING.format(id=job.linkedin_id), timeout=30)
        if resp.ok:
            job.description = parse_description(resp.text)
        _pause()
    return [j for j in found.values() if j.description]


# --------------------------------------------------------------------------- Easy Apply


class NotEasyApply(Exception):
    """The posting has no Easy Apply button (company-site application)."""


class NeedsHuman(Exception):
    """The form asked something the agent has no configured answer for."""

    def __init__(self, questions: list[str]):
        super().__init__("; ".join(questions))
        self.questions = questions


class StoppedBeforeSubmit(Exception):
    """dry_run is on: everything was filled in, but Submit was not clicked."""


def _browser(profile_dir: Path, headless: bool):
    from playwright.sync_api import sync_playwright

    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(str(profile_dir), headless=headless, viewport={"width": 1280, "height": 900})
    return pw, ctx


def interactive_login(profile_dir: Path) -> None:
    pw, ctx = _browser(profile_dir, headless=False)
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.linkedin.com/login")
        input("Log in to LinkedIn in the browser window, then press Enter here... ")
    finally:
        ctx.close()
        pw.stop()


def _label_for(page, field) -> str:
    fid = field.get_attribute("id")
    if fid:
        label = page.locator(f'label[for="{fid}"]')
        if label.count():
            return label.first.inner_text().strip()
    aria = field.get_attribute("aria-label")
    if aria:
        return aria.strip()
    # Fieldsets (radio groups) carry their question in a legend.
    legend = field.locator("xpath=ancestor::fieldset[1]//legend")
    return legend.first.inner_text().strip() if legend.count() else ""


def _answer_for(label: str, candidate: Candidate, answers: dict[str, str]) -> str | None:
    low = label.lower()
    builtin = {
        "phone": candidate.phone,
        "mobile": candidate.phone,
        "email": candidate.email,
        "city": candidate.location,
        "location": candidate.location,
        "linkedin": candidate.linkedin_url,
    }
    for key, value in answers.items():
        if key.lower() in low:
            return str(value)
    for key, value in builtin.items():
        if key in low and value:
            return value
    return None


def _fill_step(page, modal, candidate: Candidate, answers: dict[str, str], resume: Path, cover: Path | None) -> list[str]:
    unanswered: list[str] = []

    for upload in modal.locator('input[type="file"]').all():
        label = (_label_for(page, upload) or upload.get_attribute("name") or "").lower()
        upload.set_input_files(str(cover if cover and "cover" in label else resume))

    for field in modal.locator("input[type=text], input[type=tel], input[type=email], input:not([type]), textarea").all():
        if not field.is_visible() or field.input_value().strip():
            continue
        label = _label_for(page, field)
        answer = _answer_for(label, candidate, answers)
        if answer is not None:
            field.fill(answer)
        elif field.get_attribute("required") is not None or field.get_attribute("aria-required") == "true":
            unanswered.append(label or "(unlabelled text field)")

    for select in modal.locator("select").all():
        if not select.is_visible():
            continue
        current = select.evaluate("el => el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : ''")
        if current and "select" not in current.lower():
            continue
        label = _label_for(page, select)
        answer = _answer_for(label, candidate, answers)
        if answer is None:
            unanswered.append(label or "(unlabelled dropdown)")
            continue
        try:
            select.select_option(label=answer)
        except Exception:
            unanswered.append(f"{label} (configured answer '{answer}' is not one of the options)")

    for group in modal.locator("fieldset").all():
        radios = group.locator('input[type="radio"]')
        if not radios.count() or group.locator('input[type="radio"]:checked').count():
            continue
        legend = group.locator("legend")
        label = legend.first.inner_text().strip() if legend.count() else "(unlabelled choice)"
        answer = _answer_for(label, candidate, answers)
        option = group.locator(f'label:has-text("{answer.replace(chr(34), "")}")') if answer else None
        if option is not None and option.count():
            option.first.click()
        else:
            unanswered.append(label)

    return unanswered


def easy_apply(
    job_url: str,
    resume: Path,
    cover: Path | None,
    candidate: Candidate,
    cfg: ApplyConfig,
    profile_dir: Path,
) -> None:
    """Submit an Easy Apply application. Raises NotEasyApply, NeedsHuman or StoppedBeforeSubmit."""
    pw, ctx = _browser(profile_dir, headless=cfg.headless)
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(job_url, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        if "login" in page.url or "authwall" in page.url:
            raise NeedsHuman(["LinkedIn session expired - run `job-agent linkedin-login` again"])

        button = page.locator("button.jobs-apply-button:has-text('Easy Apply')")
        if not button.count():
            raise NotEasyApply(job_url)
        button.first.click()
        modal = page.locator("div[role=dialog]").first
        modal.wait_for(timeout=15000)

        for _ in range(cfg.max_steps):
            page.wait_for_timeout(1200)
            unanswered = _fill_step(page, modal, candidate, cfg.screening_answers, resume, cover)
            if unanswered:
                raise NeedsHuman(unanswered)

            submit = modal.locator("button:has-text('Submit application')")
            if submit.count():
                follow = modal.locator("label:has-text('Follow')")
                if follow.count():  # don't auto-follow the company
                    checkbox = modal.locator("input[type=checkbox][id*='follow']")
                    if checkbox.count() and checkbox.first.is_checked():
                        follow.first.click()
                if cfg.dry_run:
                    raise StoppedBeforeSubmit(job_url)
                submit.first.click()
                page.wait_for_timeout(3000)
                return

            advance = modal.locator(
                "button:has-text('Review'), button:has-text('Next'), button[aria-label='Continue to next step']"
            )
            if not advance.count():
                raise NeedsHuman(["Could not find a Next/Review/Submit button on the form"])
            advance.first.click()
            page.wait_for_timeout(800)
            errors = modal.locator(".artdeco-inline-feedback--error")
            if errors.count():
                raise NeedsHuman([e.inner_text().strip() for e in errors.all() if e.inner_text().strip()])

        raise NeedsHuman([f"Form had more than {cfg.max_steps} steps"])
    finally:
        ctx.close()
        pw.stop()
