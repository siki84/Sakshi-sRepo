"""Command line: python -m job_agent <command>."""

from __future__ import annotations

import argparse
import logging
import time

from job_agent import linkedin
from job_agent.config import load_config
from job_agent.workflow import Agent


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="job_agent", description="Human-in-the-loop LinkedIn job application agent")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("linkedin-login", help="open a browser to log in to LinkedIn once (session is saved locally)")
    sub.add_parser("search", help="look for matching jobs now and email drafts for review")
    sub.add_parser("inbox", help="process your email replies once (approve / changes / skip)")
    sub.add_parser("run", help="keep running: check email replies every poll_seconds")
    sub.add_parser("status", help="list tracked jobs")
    p = sub.add_parser("show", help="show one job's history")
    p.add_argument("job_id", type=int)
    p = sub.add_parser("apply", help="retry applying to an already-approved job")
    p.add_argument("job_id", type=int)
    p = sub.add_parser("redraft", help="regenerate drafts for a job and email them again")
    p.add_argument("job_id", type=int)
    p = sub.add_parser("mark-applied", help="record that you applied yourself")
    p.add_argument("job_id", type=int)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(message)s")
    cfg = load_config(args.config)
    agent = Agent(cfg)

    if args.command == "linkedin-login":
        linkedin.interactive_login(cfg.browser_profile)
    elif args.command == "search":
        drafted = agent.search_and_draft()
        print(f"Sent {len(drafted)} review email(s) to {cfg.email.your_address}.")
    elif args.command == "inbox":
        agent.process_inbox()
    elif args.command == "run":
        print(f"Watching {cfg.email.agent_address} every {cfg.poll_seconds}s. Ctrl+C to stop.")
        while True:
            try:
                agent.process_inbox()
            except Exception:
                logging.exception("Inbox check failed; will retry")
            time.sleep(cfg.poll_seconds)
    elif args.command == "status":
        for job in agent.store.list():
            score = f"{job.score:>3}" if job.score is not None else "  -"
            print(f"#{job.id:<4} {score}  {job.status:<17} r{job.revision}  {job.title} @ {job.company}")
    elif args.command == "show":
        job = agent.store.get(args.job_id)
        if not job:
            raise SystemExit(f"No job #{args.job_id}")
        print(f"#{job.id} {job.title} @ {job.company} [{job.status}, r{job.revision}]\n{job.url}")
        print(f"Resume: {job.resume_path}\nCover:  {job.cover_path}")
        for ev in agent.store.events(job.id):
            print(f"  {ev['ts']}  {ev['kind']:<18} {ev['detail'] or ''}")
    elif args.command == "apply":
        print(agent.apply(args.job_id))
    elif args.command == "redraft":
        job = agent.store.get(args.job_id)
        if not job or job.status == "applied":
            raise SystemExit(f"Job #{args.job_id} is missing or already applied")
        agent.draft(args.job_id)
    elif args.command == "mark-applied":
        agent.store.update(args.job_id, status="applied")
        agent.store.log(args.job_id, "applied", "marked by you")
