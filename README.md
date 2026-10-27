# TestPilot AI — AI QA Agent

Website URL + plain-English requirements → AI test plan → user reviews → real browser runs the tests → screenshots, logs and a bug report.

## Setup (once)

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium        # only needed if Google Chrome is not installed
cp .env.example .env                          # then put your ANTHROPIC_API_KEY in .env
cd ../frontend && npm install
```

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

Any VM / Render / Railway that runs Docker works; Chromium needs ~1–2 GB RAM.
Add a password before putting it on the internet (anyone with the link can make it open URLs).

## Rules

- `backend/.env` holds the API key. It is git-ignored; never commit it and never put the key in the frontend.
- The backend opens any URL you give it — run it only locally / on a trusted network.

## 7-day plan

- [x] Day 0: skeleton — UI, API, plan generation, agent runner, evidence, history
- [ ] Day 1–2: test on a real site, tune prompts, port the dashboard + settings screens from `design.html`
- [ ] Day 3: video recording, network log table, report export (PDF / Markdown)
- [ ] Day 4: bug report screen like the prototype (steps, expected vs actual, confirmed evidence vs AI analysis)
- [ ] Day 5: re-run a run to verify a fix; post results to Teams
- [ ] Day 6–7: demo site with 2–3 planted bugs, demo script, polish
