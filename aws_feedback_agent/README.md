# AWS customer-feedback agent

An agent built on Claude that reads Reddit and the public web to find what customers say about:

1. **Starter Home**, the new AWS Management Console experience
2. **Amazon Q** (Q Developer, Q Business, Q in the console)
3. **The AWS Management Console** in general
4. **AWS customer experience** (support, docs, billing, onboarding)

Each run produces a dated Markdown report in `reports/`. The report covers sentiment, themes, quotes with links, what influencers say, how AWS compares with competitors, and recommended actions.

## What it scans

- **Seed subreddits** (in `config.json`): r/aws, r/AWSCertifications, r/devops, r/sysadmin, r/cscareerquestions, r/ExperiencedDevs, r/amazonemployees, r/AmazonFC, r/serverless, r/Terraform, r/kubernetes, r/FinOps.
- **New communities.** On every run the agent searches Reddit for AWS-related subreddits it doesn't know yet. It adds the relevant ones to `state/communities.json` and scans them in the same run and in later runs.
- **LinkedIn and influencers** through Claude's web search: public LinkedIn posts, Corey Quinn / Last Week in AWS, and the other people listed in `config.json` (edit that list freely). It also looks for AWS vs Azure / Google Cloud comparisons and AWS's own announcements, so it can tie feedback to launches.
- **What's new.** Each run saves a short summary of its themes, and the next run reports what changed since then.

## Setup

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...          # or `ant auth login`
# Strongly recommended: Reddit blocks or throttles anonymous API traffic.
# Create a "script" app at https://www.reddit.com/prefs/apps
export REDDIT_CLIENT_ID=...
export REDDIT_CLIENT_SECRET=...
```

## Run

```bash
python agent.py            # last 30 days
python agent.py --days 7   # last week
```

Tool calls are logged to stderr. The report path is printed at the end.

### Scheduled runs

`.github/workflows/aws-feedback-agent.yml` runs the agent on the 1st of every month, or on demand from the Actions tab. It commits the report and the updated community list back to the repo. Add the `ANTHROPIC_API_KEY`, `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` repository secrets first.

## Limitations

- **LinkedIn has no public search API**, and scraping it breaks LinkedIn's terms. Coverage is limited to posts that web search engines index, so treat the LinkedIn section as a sample, not a census.
- Reddit search returns at most about 25 posts per query. The agent compensates by running several queries per community.
- The model only reports what it finds and cites. Each report ends with a *Coverage and limitations* section that lists anything that failed or was thin.
- Cost: one run makes many model turns plus up to 25 web searches. Expect a few dollars per run at `effort: high`. Lower `effort` in `agent.py` or shorten `--days` to reduce it.

## Files

| File | Purpose |
|---|---|
| `agent.py` | The agent: Reddit tools, web search, agent loop, report writing |
| `config.json` | Seed subreddits, topic keywords, influencers, limits |
| `state/communities.json` | Communities discovered on earlier runs, plus run history (created on first run) |
| `reports/` | Generated reports |
