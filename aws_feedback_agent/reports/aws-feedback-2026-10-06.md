# AWS Customer Feedback Report: 2026-09-06 to 2026-10-06

> **How this report was made.** This run was done by hand from a sandbox, not by `agent.py`. The sandbox had no Anthropic API key and blocks reddit.com, x.com, linkedin.com and most news sites, so **no Reddit threads or LinkedIn posts could be read directly.** Every finding below comes from web-search summaries of news articles, AWS's own announcements, Hacker News, DEV Community and X. Treat sentiment counts as rough. Run `python agent.py` with Reddit credentials for the real Reddit and LinkedIn coverage.

## Executive summary

- **Starter Home / new getting-started experience (launched Sep 16): mixed, leaning positive.** People like sign-in with Google, GitHub or Apple, no credit card, and the hard **spend limit** (from $20/month). The criticism: it's a separate, deliberately limited account type (a fixed home Region, Ohio for US sign-ups, and no IAM), plus some rough edges on day one.
- **AWS's own framing is an admission that the console overwhelms new users.** The Register's headline was "AWS confesses its console causes cloudy confusion for new users". Commentators read the launch as AWS conceding a long-standing UX problem.
- **Amazon Q Developer: negative / winding down.** New sign-ups are closed and end of support is April 30, 2027; AWS is moving users to **Kiro**. Ongoing complaints are about no Kiro plugin for Eclipse or Visual Studio, CI/CD integrations that will quietly break, and newer models only being available in Kiro.
- **Spend limits are the most praised feature in the window.** Hard caps are something customers (especially on FinOps and solo-builder forums) have asked for for years. The catch: only new customers get them for now.
- **Comparisons with competitors are still unflattering for the AWS console.** 2026 comparison write-ups regularly rank Google Cloud's console and docs as the cleanest, and call AWS's console overwhelming.
- **Corey Quinn: sceptical on console UX.** In late September he mocked "CloudWatch Omni" for headlining that it works *outside* the console, then said the out-of-console experience was somehow worse. No direct take of his on the new sign-up experience turned up.
- **Reliability noise:** short US-EAST-1 and Oregon API-error incidents (Sep 3, Sep 21), plus the long-running Gulf-region (me-central-1) availability-zone data loss confirmed on Sep 15. This is the kind of thing that drives r/sysadmin and r/devops threads.

## Starter Home (new getting-started experience)

**What launched (Sep 16, 2026; rolling out gradually to new customers):**
- Sign up with Google, GitHub, Apple or Amazon; no credit card for most people; $100 in Free Tier credits.
- Everything lives in a **project**: one AWS account plus sharing settings. AWS creates the first project automatically with sensible defaults.
- Invite collaborators by email. There are no IAM users: permissions are configured by console workflows and coding agents.
- **Monthly spend limit** from $20. When a project hits it, it is paused and its resources are stopped.
- A fixed home Region by country (Ohio for US sign-ups). You can switch on the "advanced" feature set (multi-Region, Organizations) later without migrating.

**Sentiment: mixed, leaning positive (about 8 write-ups or threads seen; roughly 5 positive, 3 critical).**

| Theme | Evidence |
|---|---|
| 👍 Lower barrier for solo / AI-era builders | Praise for the focus on solo founders and first-time builders ([X summary of reactions](https://x.com/AGTPinsights/status/2105534009162052021)); [DEV: "The New AWS Sign-Up Experience: Start Building in Minutes"](https://dev.to/aaronshunter/the-new-aws-sign-up-experience-start-building-in-minutes-47gi); [heise: "AWS without IAM hassle"](https://www.heise.de/en/news/AWS-without-IAM-hassle-start-developing-right-away-11458306.html) |
| 👍 Hard spend caps | [Help Net Security](https://www.helpnetsecurity.com/2026/09/17/aws-spend-limit-agent-set-permissions/); a wider discussion of hard budget caps for agents ([daily.dev](https://daily.dev/posts/we-re-going-to-need-default-hard-budget-caps-on-pretty-much-everything-wptapk6pa)) |
| 👎 Limited control: fixed Region, no IAM | ["AWS New Sign-Up Puts US Projects in Ohio, Limits Control"](https://windowsforum.com/news/aws-new-sign-up-puts-us-projects-in-ohio-limits-control.444941/). AWS's own docs split "Sign up for AWS (new)" from "(advanced)" ([AWS docs](https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html)) |
| 👎 Launch rough edges | Reported reactions: the promo video was called "slop" because it barely shows the product, the new login screen called "ugly", a GitHub sign-in loop ("Email already in use"), and questions about access control without IAM and "whether the billing console was fixed". AWS Support apologised publicly ([summary](https://x.com/AGTPinsights/status/2105534009162052021)) |
| ⚠️ Effect on the ecosystem | Some argue it could hurt startups that wrap AWS for beginners (same source) |

**Pain points and requests:** let users pick the Region; explain how access control works without IAM; bring spend limits to existing accounts; make the GitHub identity linking reliable.

Primary sources: [AWS What's New](https://aws.amazon.com/about-aws/whats-new/2026/09/New-AWS-Builder-Experience/), [AWS News Blog](https://aws.amazon.com/blogs/aws/aws-reimagines-the-getting-started-experience/), [The Register](https://www.theregister.com/off-prem/2026/09/18/aws-confesses-its-console-causes-cloudy-confusion-for-new-users/5297365), [AWS Builder Center](https://builder.aws.com/content/3Jjk5VP4G85LdDg3plnLLaDLXbF/the-new-way-to-start-on-aws), [DEV (AWS)](https://dev.to/aws/what-the-new-aws-means-if-youre-just-getting-started-1een).

## Amazon Q

**Sentiment: negative to resigned.**
- **Retirement:** Q Developer IDE plugins and paid subscriptions reach end of support on **April 30, 2027**, with new sign-ups closed. Kiro replaces it ([aws-news.com](https://aws-news.com/article/2026-04-30-amazon-q-developer-end-of-support-announcement), [DZone](https://dzone.com/articles/amazon-kiro-vs-amazon-q-developer-which-ai-coding), [ChatForest timeline](https://chatforest.com/builders-log/amazon-q-developer-kiro-migration-timeline-opus-cutoff/)). The announcement predates this window; the migration complaints continue inside it.
- **Migration complaints:** no Kiro plugin for Eclipse or Visual Studio; CI/CD and PR automation built on Q will silently stop working; newer models are Kiro-only; teams that use Kiro like Q (free-form chat instead of specs) see no productivity gain ([Digital Applied playbook](https://www.digitalapplied.com/blog/amazon-q-to-kiro-migration-playbook), [Cloudvisor](https://cloudvisor.co/amazon-q-developer-to-kiro-migration/)).
- **Internal pushback** on the Kiro mandate at Amazon: engineers said outside models beat Kiro on some tasks, and exceptions need VP approval ([AI CERTs News](https://www.aicerts.ai/news/inside-amazons-kiro-mandate-and-the-future-of-ai-coding/)). This is likely to show up in r/amazonemployees.
- **What people still value:** Q is strong on AWS-specific work (Lambda, CloudFormation, CloudWatch logs) but "noticeably behind the competition" elsewhere ([devtoolsreview](https://devtoolsreview.com/reviews/amazon-q-review/)). Gartner Peer Insights is about 4.4/5 ([Gartner](https://www.gartner.com/reviews/product/amazon-q-developer)).
- **Q in the console:** no new console-Q launch or discussion was found in the window. The open question is what replaces Q chat in the console as Kiro takes over, and the "coding agents set permissions" wording in the new experience hints at the direction.

## AWS Management Console

**Sentiment: negative (long-running), with cautious hope tied to the new experience.**
- AWS itself said builders "do not want to spend their first hours configuring an AWS environment", and spent nearly a year building an alternative, which the press framed as a confession ([The Register](https://www.theregister.com/off-prem/2026/09/18/aws-confesses-its-console-causes-cloudy-confusion-for-new-users/5297365)).
- Corey Quinn on "CloudWatch Omni": its headline feature is being available outside the console, and the outside version is worse ([X](https://x.com/QuinnyPig/status/2102553987774116211)).
- Comparison write-ups this year consistently put GCP's console first and call AWS's overwhelming ([DataCamp](https://www.datacamp.com/blog/aws-vs-azure-vs-gcp), [Tech Insider](https://tech-insider.org/aws-vs-azure-vs-google-cloud-2026/)).
- Smaller Console Home update: the Cost and Usage widget is now in the European Sovereign Cloud ([AWS](https://aws.amazon.com/about-aws/whats-new/2026/07/aws-console-home-cost-and-usage-eu-sovereign-cloud/)). It's from July, outside the window, but relevant context.

## Customer experience (support, docs, billing, onboarding)

- **Billing:** spend limits are the headline win. Repeated questions about whether the billing console itself was improved suggest that pain is still there.
- **Support:** AWS Support publicly apologised for the launch's first impression ([summary](https://x.com/AGTPinsights/status/2105534009162052021)). That's good responsiveness, but it confirms the rough start.
- **Reliability:** US-EAST-1 EC2 launch API errors (about 1 hour, Sep 21), Oregon API errors (about 2.3 hours, Sep 3) ([UptimeRobot](https://uptimerobot.com/is-it-down/aws-amazon-web-services/2026-09-21/)), and AWS confirming on Sep 15 that data in a Gulf-region availability zone can't be recovered ([report](https://goldesel.de/aktien/news/amazon-kann-zugriff-auf-daten-in-golf-rechenzentrum-nicht-wiederherstellen)).
- **Certifications (r/AWSCertifications):** MLA-C01's last day was Sep 28 and the C02 beta started Sep 29. SAP-C02 ends Nov 17 and DVA-C02 ends Dec 1, with C03 registration opening Oct 27 ([AWS T&C blog](https://aws.amazon.com/blogs/training-and-certification/september-2026-new-offerings/), [CertCrush](https://www.certcrush.app/blog/aws-sap-c03-dva-c03-release-dates-2026)). Expect a wave of "which version should I take" threads.

## Influencers and LinkedIn

- **Corey Quinn (Last Week in AWS / Duckbill):** the CloudWatch Omni jab above. His AWS Morning Brief for the week of Sep 14 was titled "Lambda Slowly Becomes EC2, One Feature at a Time". No post from him specifically on the new sign-up experience was indexed ([Last Week in AWS](https://www.lastweekinaws.com/), [LinkedIn profile](https://www.linkedin.com/in/coquinn/)).
- **AWS Developers account:** a 47-second "AWS just got a lot easier to use" video on Oct 1 got about 496K views. Replies were split, with criticism that it barely shows the product ([source](https://x.com/AGTPinsights/status/2105534009162052021)).
- **Community builders:** a positive explainer from AWS Hero / Community Builder authors on DEV ([1](https://dev.to/bhatiagirish/whats-new-in-aws-sign-in-experience-a-builders-perspective-1h7a), [2](https://dev.to/aws/what-the-new-aws-means-if-youre-just-getting-started-1een)).
- **LinkedIn:** no individual LinkedIn posts were found through search (LinkedIn is blocked from this sandbox and poorly indexed). This is the biggest gap in this run.
- **AWS vs competitors:** the comparison pieces above favour GCP on developer experience. The new AWS flow looks aimed at Vercel- and Firebase-style simplicity ([Nucamp](https://www.nucamp.co/blog/aws-vs-azure-vs-google-cloud-vs-vercel-in-2026-which-cloud-platform-should-backend-developers-learn)).

## Emerging themes and new communities

- **New theme:** coding agents as first-class AWS users (agents set permissions, hard caps because agents can run up bills). Expect this in r/aws, r/devops and r/FinOps.
- **New theme:** "two AWSes", meaning the simple project-based AWS versus the advanced one, and the confusion about which to choose.
- **Communities to add for the next agent run:** r/kiroIDE / r/Kiro (Q to Kiro migration), r/vibecoding and r/SideProject (the target audience for the new experience), r/googlecloud and r/AZURE (comparison threads). These are suggestions; they could not be checked from this sandbox.

## Recommended actions

1. **Bring spend limits to existing accounts.** It's the most loved part of the launch and the most obvious "why not me?" request.
2. **Publish a clear access-control explainer for projects**, covering who can do what without IAM and how it maps to IAM once you upgrade.
3. **Fix GitHub identity-linking errors** and explain why the home Region is fixed. Consider letting users choose the Region at sign-up.
4. **Ship a product-first demo.** The launch video was criticised for not showing the product.
5. **Make the Q to Kiro path concrete:** say what happens to Q chat in the console, and give a plan for Eclipse and Visual Studio users and for CI/CD integrations before April 2027.
6. **Track this monthly with `agent.py`.** Above all, check Reddit and LinkedIn sentiment on projects and spend limits once the rollout widens.

## Coverage and limitations

- **Not covered directly:** Reddit (all 12 seed communities), LinkedIn and X. All were blocked from this sandbox, and search engines index few recent Reddit or LinkedIn posts.
- **Covered via search:** AWS announcements and docs, The Register, Help Net Security, heise, DEV Community, daily.dev, Hacker News (summary only), outage trackers and certification blogs.
- About 20 web searches. Full article text could not be fetched, so quotes are from search summaries.
- Some sources disagree on details (for example $100 vs "up to $200" in credits). This report uses AWS's own figure ($100).
