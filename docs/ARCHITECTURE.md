# Testara — Architecture

## Overview

Testara is an AI QA agent. A tester gives it a website URL and plain-English requirements:

1. Claude writes a test plan.
2. The tester reviews and approves it.
3. A real Chromium browser (Playwright) runs each case, with Claude choosing one action at a time.
4. The tester gets verdicts with screenshots, logs, console and network errors, and an AI-written bug report.

The app is one FastAPI backend and one React frontend. It runs locally (`./dev.sh`) or as a single Docker container
(Fly.io, `PUBLIC_MODE=1`).

```
React UI ──/api (JSON, polling)──► FastAPI ──► Claude (plan · next action · bug report)
                                      │
                                      ├─ runner.py ──► Chromium ──(public mode: egress proxy)──► site under test
                                      ├─ android.py ─► adb + uiautomator (local only)
                                      └─ db.py ─────► SQLite (one JSON row per run) + screenshots on disk
```

## Components

| Component | Responsibility |
|---|---|
| `frontend/src/pages/*` | One React page per screen: Dashboard, New Run, Plan Review, Run View, Bug Report, History, Settings, Admin |
| `frontend/src/api.ts` | The only place that calls the backend. Holds the tester's API key in memory and sends it as a header |
| `backend/app/main.py` | FastAPI endpoints; access-code middleware; owner-checked screenshot route |
| `backend/app/ai.py` | Every Claude call: plan, next action, bug report. Tool schemas and the provider switch live here |
| `backend/app/runner.py` | Playwright agent loop, evidence check, dead-click check, screenshots, console/network capture |
| `backend/app/android.py` | Same loop for APKs over adb |
| `backend/app/questions.py` | Human in the loop: a running test pauses and asks the tester |
| `backend/app/access.py` | Public mode: access codes, per-code ownership, egress proxy |
| `backend/app/models.py` | Pydantic models and input validation |
| `backend/app/db.py` | SQLite run history and crashed-run recovery |
| `backend/demo_site/` | AcmeCart demo shop with three planted bugs, used as the acceptance test |

## Data flow

1. **Plan.** `POST /api/plans {url, requirements, viewport}`
   - The backend opens the URL in Chromium and takes the page's accessibility snapshot.
   - Claude returns test cases through a forced tool call (`submit_plan`): title, priority, steps, expected
     result.
2. **Review.** The tester edits, adds, removes and approves cases in the UI. Nothing runs before approval.
3. **Run.** `POST /api/runs {url, cases}`
   - The backend saves the run and starts a background job; the UI polls `GET /api/runs/{id}`.
   - For each case, in a fresh browser context, up to 15 times:
     1. Claude gets the snapshot, URL and log, and returns one tool call (`click`, `fill`, `press`, `goto`,
        `ask_user` or `finish`).
     2. Playwright performs it.
     3. The runner logs the result. If a click changed nothing, it adds a `NO CHANGE` line that Claude sees.
4. **Verdict.** On `finish` the runner checks the AI's verdict against the real page:
   - A `Passed` with no evidence, with evidence that is not on the page, or after a dead click becomes
     `Blocked — needs review`.
   - Console errors, failed network calls and a screenshot are attached.
5. **Ask.** With `ask_user`, the run pauses and the UI shows the question. The tester answers through
   `POST …/answer`.
6. **Bug report.** `POST …/bug` sends Claude only the recorded log, errors and verdict. Claude writes the
   report; only "likely cause" is a guess, and it is labelled with a confidence.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status, AI provider, whether a key / access code is needed |
| POST | `/api/plans` | Generate a test plan for a URL or APK |
| POST | `/api/runs` | Start a run with approved cases |
| GET | `/api/runs`, `/api/runs/{id}` | Run history and one run's live results |
| POST | `/api/runs/{id}/cases/{case}/bug` | AI bug report for a failed case |
| POST | `/api/runs/{id}/cases/{case}/answer` | Answer a paused test's question |
| GET/PUT | `/api/settings` | Screenshots, logs, retry, ask-when-unsure (read-only in public mode) |
| GET | `/evidence/{run}/{file}` | Screenshot, only for the run's owner |
| POST | `/api/login`, `/api/logout`, GET `/api/me` | Access code → http-only cookie (public mode) |
| GET/POST | `/api/admin/codes`, POST `/api/admin/codes/revoke` | Create, list and revoke codes (`X-Admin-Password`) |
| — | `/demo/` | AcmeCart demo shop |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, plain CSS, oxlint |
| Backend | Python 3.12, FastAPI, Pydantic 2, Uvicorn |
| Browser automation | Playwright 1.64 (Chrome if installed, else bundled Chromium) |
| AI | Claude (Sonnet) via the Anthropic SDK, or the Claude Code CLI (`claude -p`) |
| Storage | SQLite; screenshots on disk (Fly volume in production) |
| Android | adb + uiautomator |
| Deploy | One Docker image (FastAPI also serves the built UI); Fly.io (`fly.toml`) |
| Tests | pytest: 124 tests, Claude always mocked |

## Integrations

**Claude.** There are three ways to reach Claude, all through one function, `ai._tool_call`. The tool-use
schemas are the contract.
- The local Claude Code login (`claude -p`, run from an empty temp dir so repo instructions never leak into the
  test agent).
- The Anthropic API with a server key.
- The tester's own key, sent per request in `X-Anthropic-Key`, kept in memory only and never stored.

## Security (public mode)

`PUBLIC_MODE=1` turns on the following:
- **Access codes.**
  - Codes are created on `/#admin` with `ADMIN_PASSWORD` (a Fly secret).
  - The code is stored in an http-only, Secure cookie.
  - Runs store only a hash of the code as their owner.
- **Per-code isolation.** Each code sees only its own runs, screenshots, answers and bug reports. The screenshot
  route checks the owner and only accepts plain file names (path traversal is tested).
- **Egress proxy.**
  - Chromium reaches the network only through a local proxy, which resolves each host once.
  - It refuses private, loopback, link-local and Fly-internal (`fdaa::/16`) addresses, and connects to the exact
    IP it checked.
  - This covers redirects, WebSockets, service workers and DNS rebinding. WebRTC UDP is disabled.
- **Other limits.** Android is off, settings are read-only and API docs are hidden. Each code can have one run
  at a time, with at most `MAX_BROWSERS` browsers. Failed logins are delayed.

## Key technical decisions

| Decision | Why | Trade-off |
|---|---|---|
| Accessibility snapshot, not screenshots, as the agent's view | Cheaper and faster; gives the exact role and name to click | Canvas-only or badly labelled UIs are harder |
| One action per AI call | Every step is checked and logged; the agent reacts to what really happened | More calls per case |
| Runner overrides the AI's verdict | The AI sometimes said `Passed` when the page didn't show it | Correct passes with paraphrased evidence become "needs review" |
| Human approves the plan | The tester owns what runs on their site | One extra step |
| SQLite + JSON rows + polling | Simplest thing that works on one machine | Hosted version must be exactly one machine |
| Public mode is a switch | Local use stays simple; the deploy adds only what it needs | Two modes to keep tested (both are in the suite) |
| Egress proxy instead of Playwright `route` | `route` was bypassed by redirects, WebSockets and DNS rebinding | One more component; HTTP(S) and WebSockets only |
