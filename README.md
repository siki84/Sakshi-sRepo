# Job Application Agent (human-in-the-loop)

An agent that finds LinkedIn jobs matching your background, tailors your resume and
cover letter for each one with Claude, **emails them to you for review**, and applies
**only after you reply "Approve"** to that exact version.

```
 "look for matching jobs"  ──►  LinkedIn search ──► Claude scores fit (0-100)
                                                         │ score ≥ min_score
                                                         ▼
                                   Claude tailors resume + cover letter (.docx)
                                                         │
                                                         ▼
                         ┌──────── email to you: drafts + what changed + gaps ◄───────┐
                         │                                                           │
          reply "Approve"│        reply with changes / edited .docx                  │
                         │                  └──── new revision ──────────────────────┘
                         ▼
             LinkedIn Easy Apply with the approved files ──► confirmation email
             (or: "ready for you to submit" email if it can't apply itself)
```

## The human-in-the-loop guarantees

- **Nothing is submitted without your approval.** Every application goes through one
  gate (`Agent.apply`) that refuses unless the job's *current* revision was approved.
- **Approval is decided by fixed rules, not by the AI.** Your reply must *start with*
  "Approve" (e.g. "Approve", "Approve this resume and cover letter"). Anything
  conditional ("Approve but change X", "looks good, approve") is treated as change
  requests, and you get a new version to approve.
- **Only your replies count.** The sender must be `email.your_address`, and the subject
  must carry the job number, revision and a random code the agent generated
  (e.g. `[JobAgent #12 r2 K7QX9A]`). A reply to an older revision is ignored.
- **Your edits win.** Attach edited `.docx` files to your reply. With "Approve" they're
  submitted byte-for-byte; without it, they come back to you as a new revision.
- **No fabrication.** Claude may reorder, rephrase and emphasize what's in your master
  resume and details file, and mirror the posting's wording where it's true. It may not
  invent employers, titles, dates, degrees, skills or metrics. Requirements you don't
  meet are listed as "gaps" in the review email, not hidden.
- **`dry_run: true` by default**: the first time, it fills in Easy Apply and stops before
  Submit, emailing you the files and link. Turn it off once you trust it.

## Setup

1. **Install** (Python 3.10+):
   ```bash
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   playwright install chromium
   ```
2. **Your details**:
   ```bash
   cp config.example.yaml config.yaml
   cp profile/resume.example.md profile/resume.md      # paste your full resume here
   cp profile/details.example.md profile/details.md    # preferences, extra true details
   ```
   These three files are git-ignored so your personal data stays on your machine.
   Edit `config.yaml`: your name/contact info, search queries, `email.your_address`,
   and `apply.screening_answers` (years of experience, work authorization, etc.).
3. **Secrets** (environment variables, never in files):
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   export JOB_AGENT_EMAIL_PASSWORD=...   # Gmail: create an App Password (needs 2-Step Verification)
   ```
   For Gmail, also enable IMAP in Gmail settings. Using your own address for both
   `your_address` and `agent_address` works; the agent tags its own emails so it never
   mistakes them for your replies.
4. **Log in to LinkedIn once** (the agent never sees your password; the session is
   stored in `data/browser-profile`):
   ```bash
   python -m job_agent linkedin-login
   ```

## Using it

| You want to... | Do this |
|---|---|
| Look for matching jobs | `python -m job_agent search` **or** email yourself "look for matching jobs" while `run` is going |
| Have it watch for your replies | `python -m job_agent run` (checks every `poll_seconds`) |
| Process replies once | `python -m job_agent inbox` |
| See everything it's tracking | `python -m job_agent status` |
| See one job's history | `python -m job_agent show 12` |
| Retry an approved job (e.g. after adding a screening answer) | `python -m job_agent apply 12` |
| Record that you applied yourself | `python -m job_agent mark-applied 12` |

Replying to a review email:

- **"Approve"** → applies with that version (plus any `.docx` you attach).
- **Anything else you write** → treated as edit instructions; a revised version comes back.
- **"Skip"** → won't apply.

If an Easy Apply form asks something not covered by `screening_answers`, or the job only
accepts applications on the company's site, the agent stops and emails you the approved
files and the link so you can finish it yourself.

## Important caveats

- **LinkedIn's terms.** LinkedIn's User Agreement prohibits scraping and automated
  activity, and accounts using bots can be restricted or banned. This agent reads
  public job listings slowly and submits through your own logged-in browser, but the
  risk is yours. Keep `max_drafts_per_run` low, or set `apply.mode: manual` to have the
  agent do everything except the final click.
- **Selectors drift.** LinkedIn changes its page markup; if search returns nothing or
  Easy Apply can't find buttons, the selectors in `job_agent/linkedin.py` need updating.
- **Cost.** Each posting costs one short Claude call to score it, and each drafted job
  one longer call (plus one per revision). Uses `claude-opus-5-5`, with server-side
  refusal fallback enabled.

## Layout

```
job_agent/
  cli.py        commands
  workflow.py   search → draft → review email → approval gate → apply
  review.py     parsing your replies (approve / skip / edits), subject tags
  llm.py        Claude prompts: fit scoring, tailoring with no-fabrication rules
  linkedin.py   job search + Easy Apply automation
  mailer.py     SMTP send / IMAP read
  documents.py  Markdown ⇄ .docx
  store.py      SQLite state (data/jobs.sqlite3)
tests/          python -m pytest
```
