# Wayfarer — trip planner

A guided, five-step trip planner: it compares destinations against your weather preferences and passport, researches must-sees and local gems (Reddit, Pinterest, blogs — via Claude's web search, with sources), recommends a trip length, and builds two map-based itineraries you can refine and share.

> Status: **Milestone 6 (the plan)** done — the full flow works end to end. Polish (M7) is next.

## Setup

Requirements: Node 20+ (22 recommended).

```bash
npm install
cp .env.example .env.local     # then add your ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Check your setup at <http://localhost:3000/api/health?ai=1>. It makes one tiny Claude call and reports whether the key works.

### Keys and services

| Service | Used for | Key needed? |
|---|---|---|
| Claude API (`claude-sonnet-5-5`, override with `CLAUDE_MODEL`) | research, verdicts, itineraries | **Yes**: `ANTHROPIC_API_KEY`. Web search must be enabled for your org in the Claude Console. |
| Open-Meteo | climate normals and forecasts | No |
| Nominatim (OpenStreetMap) | geocoding / coordinate checks | No (set `NOMINATIM_CONTACT` to be polite) |
| OpenStreetMap tiles + Leaflet | maps | No |

### Offline / test mode

- `MOCK_AI=1`: Claude calls return bundled fixtures. They still go through the same schema and source validation.
- `MOCK_EXTERNAL=1`: Open-Meteo and Nominatim return fixtures.

```bash
MOCK_AI=1 MOCK_EXTERNAL=1 npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build && npm start` | production build |
| `npm run lint` / `npm run typecheck` | static checks |
| `npm test` | unit tests (Vitest) |
| `npm run e2e` | browser smoke tests (Playwright; starts its own server in mock mode). First run locally: `npx playwright install chromium` |

## How it's built

- **Next.js 15 (App Router) + TypeScript + Tailwind v4.**
- **SQLite** (`better-sqlite3`, file at `data/app.db`) stores the profile, trips, a research cache, and a geocode cache. There's no auth: it's a single local user.
- **AI layer** (`lib/ai/client.ts`):
  - every Claude call asks for JSON matching a Zod schema (`output_config.format`), is re-validated, and gets up to 2 retries with the validation errors fed back;
  - `pause_turn` is resumed, refusals and truncation surface as clear errors, and server-side refusal fallback is enabled;
  - any URL the model cites must be one its web search actually returned (`lib/ai/sources.ts`).
- **Research progress** streams to the browser over Server-Sent Events (`lib/sse.ts`).
- Deterministic code (not the model) handles weather scoring, geographic clustering, route ordering, and interest-mix math, so the numbers you see are computed rather than guessed.

## The five steps

1. **Where** — compare 1–2 destinations for a month (or exact dates) and a rough length. Weather fit is computed from 10 years of Open-Meteo data against your profile; Claude researches season, events, and visa/entry rules for each passport and any other documents or restrictions you list. If nothing fits, it proposes weather-checked alternatives.
2. **Interests** — chips, a mix (sliders that always total 100%), and hard requirements in plain English, turned into checkable rules.
3. **Discover** — must-sees and local gems from Reddit, Pinterest, blogs, and local guides (every card sourced, locations double-checked), ranked by your mix, on a list + map. Keep / remove / more like this.
4. **How long** — minimum / ideal / generous days computed from your picks and pace; optional dates (forecast if the trip is within 2 weeks).
5. **Plan** — two itineraries (big sights first vs. easy-going), days grouped by neighborhood with route maps and morning/afternoon/evening blocks, weather-aware placement, mix achieved vs asked, requirement checks, and where to stay. Refine by chat ("swap day 2 and 3", "make day 4 lighter") or by dragging stops between days; everything is re-checked after each edit. Share a read-only link or print.

Who decides what: **code** computes weather scores, rankings, trip lengths, day clustering, routes, mixes, and requirement checks; **Claude** does the research and writes the explanations, and its output is validated (schema + sources + consistency rules) before it's shown.
