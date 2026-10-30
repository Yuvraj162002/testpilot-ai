# Testara — Submission

AI Product Hackathon 2026 · individual entry · built with Claude Code.

| | |
|---|---|
| Demo video | `<link — add before submitting>` |
| Live demo | Not hosted (free hosts that can run Chromium now need a paid plan). Deploy-ready: `Dockerfile` + `fly.toml`, public mode built and tested. Run locally with `./dev.sh` (README "Run"). |
| Code | This repository, with its full git history |

---

## 1. Problem

Manual QA of a web app is slow and repetitive: someone reads the requirements, writes test cases, clicks through
the site, takes screenshots and writes bug reports. Script-based automation (Selenium, Playwright scripts) moves the
work into code that breaks whenever the UI changes. Small teams often end up doing neither.

## 2. Product

**Testara is an AI QA agent.** You give it a website URL and plain-English requirements. It runs real tests and
hands back evidence.

1. **Plan.** Claude reads the start page and writes a test plan: cases, steps and an observable expected result.
2. **Review.** The tester edits, adds, removes and approves cases. A human stays in control.
3. **Run.** A real Chromium browser (Playwright) runs each case. Claude picks one action at a time from the
   page's accessibility snapshot.
4. **Results.** Each case gets a verdict with a screenshot, the action log, console errors and failed network calls.
5. **Bug report.** For a failed case, Claude writes the report. Steps, actual result and errors come only from
   recorded data; only the "likely cause" is a guess, and it is labelled as one.

Also included:
- **Ask when unsure.** The agent pauses and asks the tester (test data, before paying or deleting).
- **Retry.** A failed case can be retried once to flag flaky results.
- **History, dashboard and export.** Runs are kept with history and a dashboard, and can be exported as Markdown.
- **Android APKs.** APKs can be tested over adb with the same loop (local only).
- **Agent timeline.** The run screen shows each action the agent took (opened, clicked, typed, nothing changed,
  verdict) as a live timeline, with the raw log one click away.
- **Light and dark theme**, and a Coming Soon screen with the roadmap (iOS, hosted version, Figma compare, CI).

**Demo shop.** AcmeCart (`/demo/`) is a small store (6 products, categories, search, cart, checkout, sign-in) with three planted bugs: discount code SAVE10 → HTTP 500, the mobile menu never
opens, and a wrong password shows no error. The agent is only right if it finds all three.

## 3. Architecture

```
Browser (React UI)
   │  /api/*  (JSON, polling)
   ▼
FastAPI backend ──────────────► Claude (plan · next action · bug report)
   │   ├─ runner.py   Playwright loop + evidence check
   │   ├─ android.py  same loop over adb (local only)
   │   ├─ access.py   public mode: access codes, egress proxy
   │   └─ db.py       SQLite, one JSON row per run
   ▼
Chromium ──(public mode: egress proxy)──► the site under test
```

- **Agent loop** (`runner.py`). Each case gets a fresh browser context, then repeats up to 15 times:
  1. Claude gets the accessibility snapshot, the URL and the log so far.
  2. It returns ONE tool call (`click`, `fill`, `press`, `goto`, `ask_user` or `finish`).
  3. Playwright performs it.
- **Grounded verdicts.** The runner, not the AI, has the final word. A `Passed` must quote evidence that is on
  the real page. A `Passed` after a click that changed nothing is downgraded to `Blocked — needs review`.
- **AI provider** (`ai.py`). Every Claude call goes through one function and uses forced tool use, with schemas
  in one place. Three ways to reach Claude:
  - `claude -p` with the local Claude Code login (no key)
  - the Anthropic API with a server key
  - the tester's own key, sent per request and never stored

### Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, plain CSS (from the `design.html` prototype) |
| Backend | Python 3.12, FastAPI, Pydantic 2, Uvicorn |
| Browser | Playwright 1.64 (Chrome if installed, else bundled Chromium) |
| AI | Claude via the Anthropic SDK or the Claude Code CLI |
| Storage | SQLite (`backend/data/runs.db`), screenshots on disk |
| Android | adb + uiautomator |
| Deploy | One Docker image (FastAPI also serves the built UI), Fly.io config in `fly.toml` |
| Tests | pytest (124 tests, Claude always mocked), oxlint |

## 4. Key technical decisions and trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| Accessibility snapshot instead of screenshots for the agent | Cheaper, faster, gives exact role and name for clicks | Canvas-only or badly labelled UIs are harder to test |
| One action per AI call | Every step can be checked and logged; the agent reacts to what really happened | More calls per case, so slower and costlier than one-shot scripts |
| Runner overrides the AI's verdict (evidence check, dead-click check) | The AI said `Passed` when the page didn't show it | Some real passes become "needs review" when the AI paraphrases |
| Human approves the plan before running | The tester owns what is tested; no surprise actions on their site | One extra step |
| SQLite + JSON per run, polling instead of websockets | Simplest thing that works for one machine | Hosted version must run as exactly one machine |
| `claude -p` as the default provider | No API key needed to try it locally | Only for local use; the hosted version needs a key |
| Public mode as a switch, not a separate app | Local use stays simple; deploy adds only what it needs | Two modes to keep tested (both are in the test suite) |
| Egress proxy for the hosted browser | Playwright `route` checks were bypassed by redirects, WebSockets and DNS rebinding | Small extra component; HTTP and HTTPS only |

## 5. Security

- **Secrets.**
  - `backend/.env` is git-ignored, and a Claude Code hook blocks the AI from reading it.
  - No key is hard-coded or kept in the frontend.
- **Testers' own API key.**
  - It is held in the browser tab's memory and sent as a header.
  - The server uses it only for that request or run and never stores or logs it (a test checks the DB).
- **Input validation.**
  - Pydantic models check the URL scheme, APK path, requirements length and answer length.
  - Bad Anthropic keys are rejected before use.
- **Hosted demo (`PUBLIC_MODE=1`, `access.py`).**
  - **Access codes.**
    - Codes are made on an admin page that needs `ADMIN_PASSWORD` (a Fly secret).
    - The code lives in an http-only, Secure cookie.
    - The DB stores only a hash of the code as the run owner.
  - **Per-code data.** Each code sees only its own runs, screenshots, answers and bug reports. Screenshots are
    served by an owner-checked route; path traversal is tested.
  - **Egress proxy.**
    - All browser traffic goes through it. It resolves each host once, refuses private, loopback, link-local and
      Fly-internal addresses, and connects to the IP it checked.
    - This blocks requests, redirects, WebSockets and DNS rebinding to internal services.
    - WebRTC UDP is disabled.
  - **Other limits.**
    - Android is off, settings are read-only and API docs are hidden.
    - Each code can have one run at a time, with at most `MAX_BROWSERS` browsers in total.
    - Failed logins are delayed.
- **Data.**
  - No customer apps or sites were used.
  - Run data and screenshots are git-ignored.

## 6. How AI was used (AI development practice)

Built with **Claude Code** as the development partner across the lifecycle, with my own review and validation at
each step.

| Phase | How AI helped | How I validated it |
|---|---|---|
| Define | Turned the idea into the user journey (URL → plan → review → run → evidence → bug report) and the demo shop with planted bugs | Kept scope to one journey; the planted bugs are the acceptance test |
| Design | Proposed the one-action agent loop, the tool schemas, and the public-mode design | Chose simpler options where it over-engineered (SQLite + polling) |
| Build | Wrote most of the code against `CLAUDE.md` rules and the existing style | Read every diff; ran the app and the demo-shop eval |
| Test | Wrote the pytest suite (mocked AI), negative and edge cases, Playwright checks in a real browser | Every change re-runs the suite; security fixes have a test that fails without them |
| Review | The `qa-reviewer` agent reviewed the public-mode diff and found two real holes (screenshot path traversal, redirect bypass) plus three more | Reproduced each finding before fixing it, then re-verified in real Chrome |
| Debug | Found the proxy hang (a reader thread holding a lock) and showed a "redirect error" was a Chrome quirk, not our bug | Isolated each with a minimal script before changing code |
| Document | README, this file, `CLAUDE.md` | Checked against the code |

### Context engineering

| Guide area | Where it lives |
|---|---|
| Requirements | README "How a test runs" and this file; the demo shop's planted bugs as the acceptance criteria |
| Architecture | `CLAUDE.md` layout table, README "What each part does", section 3 above |
| Standards | `CLAUDE.md` rules (grounded verdicts, no secrets, small readable code) and conventional commits |
| AI context | `CLAUDE.md`, `.claude/agents/qa-reviewer.md`, `.claude/skills/{ship,run-app}`, hooks |
| Delivery | README "Run", "Deploy", `Dockerfile`, `fly.toml`, `backend/.env.example` |
| Learning | `CLAUDE.md` "Learnings": updated each time the AI got something wrong |

### Agents, skills, guardrails

- **`qa-reviewer` agent.** Reviews a diff against the `CLAUDE.md` rules (grounded verdicts, secrets, input
  validation, URL safety, tests) before a commit.
- **`run-app` skill.** Starts the app and smoke-tests it on the demo shop. The agent is "right" only if it finds
  the planted bugs.
- **`ship` skill.** Commits and pushes safely:
  - personal account only
  - secret scan of the staged diff
  - tests and build must pass
  - conventional commits
- **Hooks (`.claude/settings.json`).**
  - Block reading or editing `.env` files.
  - Block pushes to any remote except the personal one, and block global git config changes.
  - Syntax-check every edited Python file.
- **Product guardrails against AI mistakes.**
  - Evidence check and dead-click check in the runner.
  - The bug report may only use recorded data.
  - Fake test data in forms.
  - `claude -p` runs outside the repo so `CLAUDE.md` never reaches the test agent.

### Learning from AI failures

| What went wrong | What changed |
|---|---|
| The test agent said `Passed` when the expected text was not on the page | Evidence check: a `Passed` must quote text that is really on the page |
| The agent passed the "mobile menu" case although the menu never opened | First a prompt rule; when that wasn't enough, the runner detects clicks that change nothing |
| `claude -p` reads `CLAUDE.md` from parent folders and would have leaked dev instructions into the test agent | It now runs from an empty temp dir |
| A test written by the AI saved a screenshot into the real `backend/runs/` and deleted a real screenshot | Tests must patch evidence paths to `tmp_path`, and this is now a rule in `CLAUDE.md` |
| The first public-mode URL guard (Playwright `route`) was bypassable by redirects, WebSockets and DNS rebinding (found by the reviewer agent) | Replaced with an egress proxy that pins the checked IP, with real-socket tests |
| An Android emulator with software rendering was too slow for the loop | Test on a real phone over adb |

## 7. QA approach

- **The product is AI-assisted QA.** Claude generates the test cases, including negative ones (invalid discount
  code, empty password), and a human reviews them.
- **AI output is validated, not trusted.**
  - The runner checks evidence against the real page.
  - Dead clicks are caught.
  - Bug reports use only recorded steps and errors.
- **Eval on the demo shop.**
  - The three planted bugs must come back `Failed`; plain add-to-cart must come back `Passed` with real evidence.
  - Last run (29 Oct): all three bugs caught; the four mobile-menu cases all `Failed` with "page did not change".
- **Automated tests: 124 pytest tests.** Claude is always mocked, and tests never call the real API.
  - Verdict grounding, including evidence edge cases and dead clicks
  - Input validation, answers, bug reports and run history
  - Tester API key handling (key never saved, bad keys rejected)
  - Public mode: access codes, per-code isolation, path traversal, private URLs, the egress proxy over real
    sockets (redirect target, pinned IP, bad ports), and crashed-run recovery
- **Manual and browser checks.** Real Chrome scripts were used for the proxy (private host, redirect, WebSocket,
  demo checkout through the proxy) and for the public-mode UI flow (admin → code → key → revoke).
- **AI code review.** The `qa-reviewer` agent reviewed the security-sensitive diff before commit.

## 8. Limitations

- **Testers' own key.** Only an Anthropic key works for now; the code has a single place to add OpenAI-compatible
  providers.
- **AI is non-deterministic.** The same case can take different paths, and the runner's checks catch false passes
  but not every false fail. Run the eval more than once before trusting a prompt change.
- **Hard pages.** CAPTCHAs, 2FA and complex canvas or drag-and-drop UIs are out of scope. Long flows can hit the
  15-action limit (`Blocked`).
- **Hosted version.**
  - It runs on one machine (SQLite) and allows 2 browsers at a time.
  - Access is by codes, not user accounts or email.
  - Android works only locally.
- **iOS.** Not supported yet; the iOS tab on New Test Run shows "coming soon".
- **Paraphrased evidence.** The evidence check is an exact (case and whitespace-insensitive) text match, so a
  correct pass with paraphrased evidence becomes "needs review".
- **Proxy scope.** The egress proxy handles HTTP(S) and WebSockets. Other protocols are not proxied (WebRTC UDP is
  disabled).

## 9. Dependencies

- **Backend** (`backend/requirements.txt`): `fastapi`, `uvicorn[standard]`, `anthropic`, `playwright`,
  `python-dotenv`. Tests use `pytest`.
- **Frontend** (`frontend/package.json`): `react` and `react-dom`. For development: Vite, TypeScript and oxlint.
- **External services:**
  - Claude, through the Anthropic API or the Claude Code CLI
  - Google Chrome or Playwright Chromium
  - adb, for Android
  - Fly.io, for the hosted demo

## 10. Run it

On your own laptop (Linux/macOS, or WSL on Windows), with Python 3.10+, Node.js 20.19+ and Claude Code or an
Anthropic API key:

```bash
git clone https://github.com/Yuvraj162002/testpilot-ai.git && cd testpilot-ai
./setup.sh      # one-time setup
./dev.sh        # then open http://localhost:5173 and click "use demo shop"
```

[README.md](README.md) has the details, troubleshooting, tests and the Fly.io deploy.
