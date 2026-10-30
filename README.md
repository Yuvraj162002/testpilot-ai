# TestPilot AI — AI QA Agent

Website URL + plain-English requirements → AI test plan → user reviews → real browser runs the tests → screenshots, logs and a bug report.

Hackathon submission (problem, architecture, decisions, AI workflow, QA approach, limitations): [SUBMISSION.md](SUBMISSION.md).

## Setup (once)

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium        # only needed if Google Chrome is not installed
cp .env.example .env                          # then pick the AI provider (below)
cd ../frontend && npm install
```

### AI provider (`backend/.env`)

| `AI_PROVIDER` | Needs | Cost | `CLAUDE_MODEL` |
|---|---|---|---|
| `claude-cli` (default) | Claude Code installed and logged in on this machine (`claude` works in a terminal) | Your Claude subscription, no extra bill | `sonnet` / `opus` / `haiku` |
| `api` | `ANTHROPIC_API_KEY` from console.anthropic.com | Pay per call (API billing) | e.g. `claude-sonnet-5-5` |

Each person uses their own Claude login or API key; never share yours. Restart the backend after changing
`.env`. The Settings screen shows which provider is active.

With `claude-cli` the agent runs as your Claude account, so keep the app local: in local mode the backend has
no login and opens any URL it is given. Only put it online in public mode (see "Deploy (hosted demo)").

Anyone can also click **Add API key** in the sidebar and use their own Anthropic key. It stays in that browser
tab's memory, is sent with each request, and is never saved on the server.

## Run

```bash
./dev.sh        # open http://localhost:5173
```

API docs / Swagger (try every endpoint in the browser): http://localhost:8000/docs

Demo shop to test against: http://localhost:8000/demo/ (click "use demo shop" on the New Test Run screen).
It has 3 planted bugs (details in `backend/app/demo.py`):
1. Order with discount code `SAVE10` → server error 500, no confirmation page.
2. Mobile menu (390px viewport) never opens.
3. Wrong password on Sign in shows no error message.

## Tests

```bash
cd backend
.venv/bin/pip install -r requirements-dev.txt   # pytest + httpx
.venv/bin/pytest                                # ~1 s, Claude is mocked, no browser needed
```

Covers the evidence check (a `Passed` without text from the page becomes `Blocked`), input validation,
bug reports (failed tests only), the answer API and the run history DB.

## What each part does

| Folder / file | What it is |
|---|---|
| `frontend/` | React + TypeScript UI (Vite). The screens the user clicks. |
| `frontend/src/pages/` | One file per screen: `Dashboard`, `NewRun` (website URL or APK + requirements), `PlanReview` (edit/add/approve cases), `RunView` (live results, evidence, edit & re-run, export), `BugReport`, `History`, `Settings`. |
| `frontend/src/components.tsx` | Shared UI: badges, case editor, toasts, Ctrl+K search, pass-rate bar. |
| `frontend/src/icons.tsx` | Icons from `design.html`. |
| `frontend/src/report.ts` | Markdown export of a run / bug report. |
| `frontend/src/api.ts` | All calls to the backend + the data types. |
| `frontend/src/styles.css` | Styles taken from `design.html`. |
| `backend/app/main.py` | FastAPI endpoints (`/api/plans`, `/api/runs`, …). |
| `backend/app/ai.py` | Everything that talks to Claude: write the test plan, pick the next browser action, write the bug report. |
| `backend/app/android.py` | Android: installs the APK with adb, reads the screen (uiautomator), taps/types, screenshots, logcat errors. |
| `backend/app/settings.py` | Settings screen values (`backend/data/settings.json`). |
| `backend/app/runner.py` | Playwright: opens Chromium, does the actions, collects screenshots, console and network errors. |
| `backend/app/db.py` | Saves runs in a SQLite file (`backend/data/runs.db`). |
| `backend/app/access.py` | Public mode only: access codes, egress proxy that keeps the browser off private networks. |
| `backend/app/demo.py` + `backend/demo_site/` | Demo shop "AcmeCart" with the planted bugs. |
| `backend/runs/` | Screenshots per run (served at `/evidence/...`). |
| `design.html` | The original clickable prototype, for reference. |

## How a test runs

1. `POST /api/plans`: backend opens the URL, reads the page structure, Claude writes test cases.
2. User edits/approves → `POST /api/runs` starts a background job, frontend polls `GET /api/runs/{id}`.
3. Per test case: fresh browser context → Claude sees the page (accessibility snapshot) and picks ONE action (click / fill / press / goto / finish) → Playwright does it → repeat (max 15).
4. A "Passed" verdict must quote text that is really on the page, otherwise it becomes "Blocked — needs review". Results come from the real browser, not only from the AI.
5. Failed test → "Create bug report" → Claude writes Markdown from the real log, errors and screenshot.

## Deploy (one server)

`npm run build` in `frontend/` → FastAPI serves the UI at `/`, so only port 8000 is needed.

```bash
docker build -t testpilot .
docker run -p 8000:8000 --env-file backend/.env testpilot     # http://localhost:8000
```

Never put it on the internet like this: local mode has no login and opens any URL, including private ones.

## Deploy (hosted demo, Fly.io)

`PUBLIC_MODE=1` (set in `fly.toml`) turns on:

- **Access codes.** The app asks for a code. You create and revoke codes at `/#admin` with `ADMIN_PASSWORD`.
  Each code sees only its own runs, screenshots and bug reports.
- **Own API key required.** Every tester adds their Anthropic key. The server's login or key is never used.
- **Egress proxy.** All browser traffic (pages, redirects, fetch, WebSockets) goes through a small proxy in
  `access.py`. The proxy resolves each host once, refuses `localhost`, private networks, Fly's internal network
  and cloud metadata IPs, and connects to the exact IP it checked, which also stops DNS rebinding.
- **Limits.** Android is off, settings are read-only, API docs are hidden, each code runs one test run at a
  time, and at most `MAX_BROWSERS` browsers run together.

```bash
fly auth login
fly launch --no-deploy --copy-config        # keep fly.toml; change `app` if the name is taken
fly volumes create testpilot_data --size 1 --region bom
fly secrets set ADMIN_PASSWORD='<long random password>'
fly deploy
fly scale count 1                           # exactly one machine (SQLite + background runs)
```

Then open `https://<app>.fly.dev/#admin`, create a code per tester and share the link and code.
Demo shop: `https://<app>.fly.dev/demo/`. Afterwards: `fly apps destroy <app>`.

## Rules

- `backend/.env` holds the API key. It is git-ignored; never commit it and never put the key in the frontend.
- In local mode the backend opens any URL you give it. Run it only locally, or online in public mode.
