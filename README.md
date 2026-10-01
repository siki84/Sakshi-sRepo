# Vercel Clone

A replica of the [Vercel](https://vercel.com) marketing site and dashboard, built with **Next.js 16 (App Router)**, **React 19**, **TypeScript** and **Tailwind CSS v4**. There is no real backend: data is mocked and saved in your browser's `localStorage`.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

| Page | URL |
| --- | --- |
| Landing page | `/` |
| Team dashboard (projects) | `/siki84sak-3148s-projects` |
| Project overview | `/siki84sak-3148s-projects/v0-ebay-clone` |
| Deployments | `/siki84sak-3148s-projects/v0-ebay-clone/deployments` |
| **Settings → Domains** | `/siki84sak-3148s-projects/v0-ebay-clone/settings/domains` |
| Settings → Environment Variables | `/siki84sak-3148s-projects/v0-ebay-clone/settings/environment-variables` |
| Import a new project | `/new` |

The URLs follow the same structure as vercel.com: `/<team>/<project>/...`.

## Features

- **Domains settings**
  - Add a domain with validation; pasted URLs like `https://Example.com/` are cleaned up.
  - Rejects duplicate domains, including ones used by other projects.
  - Adding an apex domain offers Vercel's recommended `www` setup: the apex gets a 308 redirect to `www`.
  - Shows Valid or Invalid Configuration, with the DNS record to set: an A record `76.76.21.21` for apex domains, a CNAME `cname.vercel-dns.com` for subdomains, or Vercel nameservers.
  - **Refresh** pretends to check DNS again.
  - **Edit** sets a redirect (301/302/307/308) or connects the domain to Production or a Preview Git branch.
  - **Remove** asks for confirmation and also clears any redirects that pointed at the removed domain.
- **Deployments**
  - Filter by branch, environment and status.
  - Redeploy runs a fake build: Queued → Building → Ready.
  - Promote a deployment to Production, or cancel one that is still building.
- **Project settings:** rename the project, change the production branch, and delete the project (you type its name to confirm).
- **Environment variables:** add variables scoped to environments, reveal or hide values, and delete them.
- **New project:** import a mock repository, configure it, and deploy it.
- Light and dark themes (in the avatar menu), a responsive layout, and **Reset demo data**.

The other tabs (Analytics, Logs, Firewall, …) and settings sections are placeholders.

## Project structure

```
src/
  app/
    page.tsx                      # marketing landing page
    new/page.tsx                  # import / create project
    [team]/page.tsx               # projects grid
    [team]/[project]/...          # overview, deployments, settings/*
  components/
    ui.tsx                        # Button, Input, Modal, Menu, Badge, …
    dashboard-header.tsx          # top bar, breadcrumbs, tabs
  lib/
    store.tsx                     # React context + reducer, persisted to localStorage
    seed.ts                       # initial demo data
    domains.ts                    # domain validation + DNS constants
```

---

Built for learning. Not affiliated with Vercel Inc.
