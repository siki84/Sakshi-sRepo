#!/usr/bin/env python3
"""AWS customer-feedback agent.

Scans Reddit communities (plus any new ones it discovers) and the public web
(LinkedIn posts, Corey Quinn and other AWS commentators) for what customers say
about AWS customer experience, the AWS Management Console, Amazon Q and the new
Starter Home experience, then writes a dated Markdown report.

Usage:
    python agent.py                 # last 30 days (config.json lookback_days)
    python agent.py --days 7        # custom window
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import anthropic
import requests

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
STATE_PATH = HERE / "state" / "communities.json"
REPORTS_DIR = HERE / "reports"

MODEL = "claude-opus-5-5"
USER_AGENT = os.environ.get("REDDIT_USER_AGENT", "aws-feedback-agent/0.1 (customer research)")


# --------------------------------------------------------------------------- #
# Reddit access
# --------------------------------------------------------------------------- #
class Reddit:
    """Thin read-only Reddit client.

    Uses app-only OAuth when REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set
    (recommended: unauthenticated requests are heavily rate limited or blocked),
    otherwise falls back to the public .json endpoints.
    """

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.base = "https://www.reddit.com"
        client_id = os.environ.get("REDDIT_CLIENT_ID")
        secret = os.environ.get("REDDIT_CLIENT_SECRET")
        if client_id and secret:
            resp = self.session.post(
                "https://www.reddit.com/api/v1/access_token",
                auth=(client_id, secret),
                data={"grant_type": "client_credentials"},
                timeout=30,
            )
            resp.raise_for_status()
            self.session.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"
            self.base = "https://oauth.reddit.com"

    def get(self, path: str, params: dict[str, Any]) -> Any:
        for attempt in range(4):
            resp = self.session.get(f"{self.base}{path}", params={**params, "raw_json": 1}, timeout=30)
            if resp.status_code == 429:
                time.sleep(2 ** (attempt + 1))
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()


def _post_summary(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "subreddit": p.get("subreddit"),
        "title": p.get("title"),
        "author": p.get("author"),
        "score": p.get("score"),
        "num_comments": p.get("num_comments"),
        "created": dt.datetime.fromtimestamp(p.get("created_utc", 0), dt.timezone.utc).strftime("%Y-%m-%d"),
        "url": f"https://www.reddit.com{p.get('permalink', '')}",
        "permalink": p.get("permalink"),
        "text": (p.get("selftext") or "")[:800],
    }


# --------------------------------------------------------------------------- #
# Persistent community list (seed + discovered)
# --------------------------------------------------------------------------- #
def load_state(seed: list[str]) -> dict[str, Any]:
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text())
    else:
        state = {"discovered": {}, "runs": []}
    state.setdefault("discovered", {})
    state.setdefault("runs", [])
    state["seed"] = seed
    return state


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #
CLIENT_TOOLS = [
    {
        "name": "search_subreddit",
        "description": (
            "Search one subreddit for posts from the lookback window matching a query. "
            "Returns title, score, comment count, date, URL and the first 800 chars of the body. "
            "Use short keyword queries (e.g. 'console', 'Amazon Q', 'billing'). "
            "Pass query='' to list the newest posts instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "subreddit": {"type": "string", "description": "Name without the r/ prefix"},
                "query": {"type": "string"},
                "sort": {"type": "string", "enum": ["new", "relevance", "top", "comments"]},
            },
            "required": ["subreddit", "query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_post_comments",
        "description": "Fetch the top comments of a Reddit post to gauge sentiment beyond the headline.",
        "input_schema": {
            "type": "object",
            "properties": {
                "permalink": {"type": "string", "description": "permalink from search_subreddit, e.g. /r/aws/comments/abc/..."},
                "limit": {"type": "integer", "description": "Max comments (default 15, max 40)"},
            },
            "required": ["permalink"],
            "additionalProperties": False,
        },
    },
    {
        "name": "discover_subreddits",
        "description": (
            "Search Reddit for communities matching a query, to find AWS-related subreddits "
            "that are not yet on the scan list. Returns name, subscriber count and description."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "add_community",
        "description": (
            "Add a newly found subreddit to the persistent scan list so future runs include it. "
            "Only add active communities where AWS console, Amazon Q, AWS customer experience "
            "or AWS cost/UX is actually discussed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "subreddit": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["subreddit", "reason"],
            "additionalProperties": False,
        },
    },
]
for _tool in CLIENT_TOOLS:
    _tool["eager_input_streaming"] = True

WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 25}

_TYPES = {"string": str, "integer": int}


def validate_input(tool: dict[str, Any], args: Any) -> str | None:
    """Return an error string if args don't match the tool's schema.

    Needed because eager_input_streaming disables server-side validation, so a
    truncated or malformed input can reach us.
    """
    schema = tool["input_schema"]
    if not isinstance(args, dict):
        return "input must be a JSON object"
    for key in schema["required"]:
        if key not in args:
            return f"missing required field '{key}'"
    for key, value in args.items():
        prop = schema["properties"].get(key)
        if prop is None:
            return f"unknown field '{key}'"
        if not isinstance(value, _TYPES[prop["type"]]):
            return f"field '{key}' must be {prop['type']}"
        if "enum" in prop and value not in prop["enum"]:
            return f"field '{key}' must be one of {prop['enum']}"
    return None


class ToolRunner:
    def __init__(self, reddit: Reddit, state: dict[str, Any], lookback_days: int, max_posts: int) -> None:
        self.reddit = reddit
        self.state = state
        self.cutoff = time.time() - lookback_days * 86400
        self.time_filter = "week" if lookback_days <= 7 else "month" if lookback_days <= 31 else "year"
        self.max_posts = max_posts
        self.added_this_run: list[str] = []

    def run(self, name: str, args: dict[str, Any]) -> Any:
        return getattr(self, name)(**args)

    def search_subreddit(self, subreddit: str, query: str, sort: str = "new") -> Any:
        subreddit = subreddit.removeprefix("r/").strip("/")
        if query:
            data = self.reddit.get(
                f"/r/{subreddit}/search.json",
                {"q": query, "restrict_sr": 1, "sort": sort, "t": self.time_filter, "limit": self.max_posts},
            )
        else:
            data = self.reddit.get(f"/r/{subreddit}/new.json", {"limit": self.max_posts})
        posts = [c["data"] for c in data.get("data", {}).get("children", [])]
        posts = [p for p in posts if p.get("created_utc", 0) >= self.cutoff]
        return {"subreddit": subreddit, "query": query, "count": len(posts), "posts": [_post_summary(p) for p in posts]}

    def get_post_comments(self, permalink: str, limit: int = 15) -> Any:
        limit = max(1, min(limit, 40))
        path = "/" + permalink.split("reddit.com/")[-1].strip("/") + ".json"
        data = self.reddit.get(path, {"limit": limit, "sort": "top", "depth": 2})
        comments = []
        for c in data[1]["data"]["children"][:limit] if len(data) > 1 else []:
            d = c.get("data", {})
            if c.get("kind") == "t1" and d.get("body"):
                comments.append({"author": d.get("author"), "score": d.get("score"), "body": d["body"][:600]})
        return {"permalink": permalink, "comments": comments}

    def discover_subreddits(self, query: str) -> Any:
        data = self.reddit.get("/subreddits/search.json", {"q": query, "limit": 15})
        known = {s.lower() for s in self.state["seed"]} | {s.lower() for s in self.state["discovered"]}
        results = []
        for c in data.get("data", {}).get("children", []):
            d = c["data"]
            results.append({
                "name": d.get("display_name"),
                "subscribers": d.get("subscribers"),
                "description": (d.get("public_description") or "")[:300],
                "already_scanned": d.get("display_name", "").lower() in known,
            })
        return {"query": query, "results": results}

    def add_community(self, subreddit: str, reason: str) -> Any:
        name = subreddit.removeprefix("r/").strip("/")
        if name.lower() in {s.lower() for s in self.state["seed"]}:
            return {"status": "already a seed community", "subreddit": name}
        if name not in self.state["discovered"]:
            self.state["discovered"][name] = {"reason": reason, "added": dt.date.today().isoformat()}
            self.added_this_run.append(name)
            save_state(self.state)
            return {"status": "added", "subreddit": name}
        return {"status": "already on list", "subreddit": name}


# --------------------------------------------------------------------------- #
# Prompt
# --------------------------------------------------------------------------- #
SYSTEM_PROMPT = """You are an AWS voice-of-customer research analyst. Your job is to find out what \
customers are actually saying about AWS and turn it into a report a product team can act on.

Focus areas (in priority order):
1. The new Starter Home experience in the AWS Management Console (anything launched or changed recently).
2. Amazon Q (Q Developer, Q Business, Q in the console / chat in the console).
3. The AWS Management Console in general (navigation, search, performance, redesigns, regions, IAM friction).
4. Overall AWS customer experience (support, docs, billing surprises, onboarding, account issues).

How to work:
- Scan every community on the scan list with search_subreddit, using several short queries per \
community that cover the focus areas. Large technical communities (r/aws, r/devops, r/sysadmin, r/FinOps) \
deserve more queries than career or employee communities. Open the comments (get_post_comments) of the \
most relevant or most discussed threads so you report sentiment, not just headlines.
- Look for communities not yet on the list with discover_subreddits. Add any active, relevant one \
with add_community and scan it in this same run.
- Use web_search for the same window to cover what Reddit misses: public LinkedIn posts \
(search e.g. "site:linkedin.com/posts AWS console"), Corey Quinn / Last Week in AWS, the influencers \
listed below, and posts comparing AWS with Azure, Google Cloud and others on console UX, AI assistants \
(Amazon Q vs GitHub Copilot, Gemini, etc.) and customer experience. Also check what AWS itself announced \
about Starter Home and the console in the window so you can tie feedback to launches.
- Only report items dated inside the lookback window. If the date of something is unclear, say so.
- Every claim must cite at least one URL. Never invent posts, quotes, numbers or people. Short quotes \
are fine; mark them as quotes. If you found little or nothing on a topic, say that plainly; a thin \
result is a finding too.
- If a tool returns an error (blocked, rate-limited, private subreddit), note it under Coverage and move on.

When you have finished researching, reply with only the final report in Markdown, using these sections:

# AWS Customer Feedback Report: <start date> to <end date>
## Executive summary (5 to 8 bullets, most important first, each with an overall sentiment label)
## Starter Home
## Amazon Q
## AWS Management Console
## Customer experience (support, docs, billing, onboarding)
## Influencers and LinkedIn (what Corey Quinn and others are saying, AWS vs competitors)
## Emerging themes and new communities (anything new since earlier runs, communities added this run)
## Recommended actions (concrete, tied to the evidence above)
## Coverage and limitations (communities scanned, queries, tools that failed, what may be missing)

In each topic section give: sentiment (positive / mixed / negative, with a rough count of threads), \
the top themes with evidence links, notable quotes, and feature requests or pain points."""


def build_user_message(cfg: dict[str, Any], state: dict[str, Any], days: int) -> str:
    today = dt.date.today()
    start = today - dt.timedelta(days=days)
    discovered = state["discovered"]
    last_run = state["runs"][-1] if state["runs"] else None
    lines = [
        f"Today is {today.isoformat()}. Lookback window: {start.isoformat()} to {today.isoformat()} ({days} days).",
        "",
        "Seed communities: " + ", ".join(f"r/{s}" for s in cfg["seed_subreddits"]),
        "Communities discovered on earlier runs: "
        + (", ".join(f"r/{s} ({v['reason']})" for s, v in discovered.items()) or "none yet"),
        "",
        "Topic keywords to start from (expand as you learn the vocabulary people use):",
        json.dumps(cfg["topics"], indent=2),
        "",
        "Queries to try for discovering new communities: " + ", ".join(cfg["discovery_queries"]),
        "Influencers to check: " + "; ".join(cfg["influencers"]),
        "Web sources worth checking: " + ", ".join(cfg["web_sources_hint"]),
    ]
    if last_run:
        lines += ["", f"Previous run: {last_run['date']}. Themes it reported: {last_run.get('themes', 'n/a')}",
                  "Call out what is new compared with that run."]
    lines += ["", "Begin the research now."]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Agent loop
# --------------------------------------------------------------------------- #
def run_agent(cfg: dict[str, Any], days: int, verbose: bool = True) -> tuple[str, ToolRunner]:
    client = anthropic.Anthropic()
    state = load_state(cfg["seed_subreddits"])
    runner = ToolRunner(Reddit(), state, days, cfg["max_posts_per_search"])
    tools_by_name = {t["name"]: t for t in CLIENT_TOOLS}

    messages: list[dict[str, Any]] = [{"role": "user", "content": build_user_message(cfg, state, days)}]

    for turn in range(cfg["max_agent_turns"]):
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=64000,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            tools=[*CLIENT_TOOLS, WEB_SEARCH_TOOL],
            messages=messages,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            response = stream.get_final_message()

        # Append the full content (thinking, server-tool blocks, etc.) unchanged.
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "refusal":
            raise RuntimeError(f"Model declined the request: {response.stop_details}")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("Hit max_tokens before finishing; rerun with a shorter --days window.")
        if response.stop_reason == "pause_turn":
            continue  # long server-side web search turn; resend to let it continue
        if response.stop_reason != "tool_use":
            report = "".join(b.text for b in response.content if b.type == "text").strip()
            return report, runner

        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            tool = tools_by_name.get(block.name)
            error = "unknown tool" if tool is None else validate_input(tool, block.input)
            if error is None:
                try:
                    output = runner.run(block.name, block.input)
                    if verbose:
                        print(f"  [{turn}] {block.name} {json.dumps(block.input)}", file=sys.stderr)
                except requests.RequestException as exc:
                    error = f"request failed: {exc}"
            if error is not None:
                if verbose:
                    print(f"  [{turn}] {block.name} ERROR {error}", file=sys.stderr)
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": error, "is_error": True})
            else:
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(output)})
        messages.append({"role": "user", "content": results})

    raise RuntimeError(f"Agent did not finish within {cfg['max_agent_turns']} turns.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, help="Lookback window in days (default from config.json)")
    parser.add_argument("--quiet", action="store_true", help="Don't log tool calls to stderr")
    args = parser.parse_args()

    cfg = json.loads(CONFIG_PATH.read_text())
    days = args.days or cfg["lookback_days"]

    report, runner = run_agent(cfg, days, verbose=not args.quiet)

    REPORTS_DIR.mkdir(exist_ok=True)
    out = REPORTS_DIR / f"aws-feedback-{dt.date.today().isoformat()}.md"
    out.write_text(report + "\n")

    # Remember a short theme summary so the next run can say what's new.
    summary_start = report.find("## Executive summary")
    themes = report[summary_start:summary_start + 1500] if summary_start >= 0 else report[:1500]
    runner.state["runs"] = (runner.state["runs"] + [{
        "date": dt.date.today().isoformat(),
        "days": days,
        "report": out.name,
        "new_communities": runner.added_this_run,
        "themes": themes,
    }])[-10:]
    save_state(runner.state)

    print(f"Report written to {out}")
    if runner.added_this_run:
        print("New communities added to the scan list: " + ", ".join(f"r/{s}" for s in runner.added_this_run))
    return 0


if __name__ == "__main__":
    sys.exit(main())
