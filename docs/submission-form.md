# Submission form answers

Copy each section into the form field with the same name. Each heading shows the field's character limit.
Each answer was checked against its limit.

## Project / Product Name (—)
Testara

## Problem Statement (2000)
Testing a web app by hand is slow and repetitive. Someone reads the requirements, writes test cases, clicks through every flow, takes screenshots and writes bug reports — and repeats it after every change. Script-based automation (Selenium, Playwright scripts) moves that work into code that needs engineers to write and breaks whenever the UI changes. Small teams, solo developers and product people often end up doing neither, so bugs like a broken discount code or a mobile menu that never opens reach users.

Testara is for developers, QA engineers and product owners who want a website tested from plain-English requirements, without writing test scripts, and who need results they can trust. AI that "just says it passed" is not enough: every verdict must be backed by evidence from the real page.

## Solution & Key Features (3000)
Testara is an AI QA agent. You give it a website URL and what should work, in plain English. It plans the tests, runs them in a real browser and hands back evidence.

How it works:
1. Plan: Claude reads the start page and writes test cases (steps, an observable expected result, priority), including negative cases.
2. Review: the tester edits, adds or removes cases and approves the plan. Nothing runs without approval.
3. Run: a real Chromium browser (Playwright) runs each case. Claude chooses one action at a time (click, fill, press, go to) from the page's accessibility snapshot, sees what happened, and decides the next step.
4. Results: every case gets Passed / Failed / Blocked with a screenshot, the step log, console errors and failed network calls.
5. Bug report: for a failed case, Claude writes a report whose steps, actual result and errors come only from recorded data; the likely cause is clearly marked as a guess.

Standout features:
- Grounded verdicts: a Passed must quote text that is really on the page, and a Passed after a click that changed nothing is downgraded to "needs review". The runner, not the AI, has the final word.
- Human in the loop: the agent pauses and asks the tester when it is unsure (missing test data, before paying or deleting).
- Retry of failed cases to flag flaky results; run history, dashboard, Markdown export, Ctrl+K search.
- Android APKs over adb with the same agent loop (local).
- Live agent timeline on the run screen: every action (opened, clicked, typed, nothing changed) and the verdict, with the raw log one click away.
- Light and dark theme; a Coming Soon screen shows the roadmap (iOS, hosted version, Figma compare, CI).
- AcmeCart demo shop with three planted bugs (SAVE10 → HTTP 500, mobile menu never opens, wrong password shows no error) used as the acceptance test: the agent finds all three.
- Deploy-ready "public mode" for a hosted demo: invite-only access codes, each code sees only its own runs, each tester uses their own Anthropic API key (kept in memory, never stored), and an egress proxy stops the browser from reaching private networks.
- Runs free locally with a Claude Code login, or with an API key.

## Working Product / Demo URL (—)
Not hosted: free hosts that can run a real Chromium (1–2 GB RAM) now need a paid plan. The app is deploy-ready (Dockerfile + fly.toml, public mode with access codes and an egress proxy) and runs locally with `./dev.sh`; see the README "Run" and "Deploy" sections. The demo video shows it end to end.

## Source Code Repositories (—)
Full stack (frontend + backend + infra): https://github.com/Yuvraj162002/testpilot-ai   ← make it public or share it with evaluators first

## Demo Video URL (—)
<link>   ← product walkthrough + code walkthrough, max 5 minutes, viewable without sign-in

## How was AI used during development? (5000)
I built Testara with Claude Code as my development partner across the whole lifecycle, and reviewed and validated every step myself.

- Define: Claude helped turn the idea into one clear journey (URL → plan → review → run → evidence → bug report) and proposed the AcmeCart demo shop with planted bugs, which became the acceptance test.
- Design: Claude proposed the one-action-at-a-time agent loop, the tool-use schemas, and later the public-mode design (access codes, per-code data, egress proxy). I chose simpler options where it over-engineered (SQLite + polling instead of a queue and websockets).
- Build: Claude wrote most of the code following the rules and style in CLAUDE.md: FastAPI endpoints, the Playwright runner, the React screens, Android over adb, the API-key dialog and public mode.
- Test: Claude wrote the pytest suite (124 tests, AI always mocked), including negative and edge cases, and wrote real-Chrome scripts to verify behaviour the unit tests can't (redirects, WebSockets, a full checkout through the proxy).
- Review: a custom qa-reviewer agent reviewed the security-sensitive public-mode diff before commit and found two real holes (screenshot path traversal, private-network access through redirects) plus three smaller issues. I had each reproduced before fixing it.
- Debug: Claude found why the egress proxy hung (a reader thread holding a lock until timeout) and proved a "redirect error" was a known Chrome quirk by reproducing it without our code.
- Document: README, SUBMISSION.md, ARCHITECTURE.md and CLAUDE.md, checked against the code.
- Ship: a ship skill does commits and pushes with a secret scan, tests and build, and conventional commit messages.

The product itself also uses AI: Claude writes test plans, drives the browser and writes bug reports.

## Which AI tools and models were used? (5000)
- Claude Code (CLI) — main development partner: planning, coding, testing, debugging, reviews, docs, commits. Used with project instructions (CLAUDE.md), custom skills, a custom agent and hooks.
- Claude Opus — the model behind Claude Code during development.
- Claude Sonnet — the model inside the product (test plans, choosing browser actions, bug reports), called through the Anthropic SDK or the Claude Code CLI (`claude -p`).
- Claude Code subagents — the custom qa-reviewer agent for code review.

No other AI tools were used. The product works with the tester's own Anthropic key; adding other providers is a listed next step.

## How did you manage context? (5000)
- CLAUDE.md (checked in): what the product is, how to run and test it, a layout table of every important file, seven rules that must never be broken (grounded verdicts, intentional demo bugs, no secrets, no customer data, deploy only in public mode, keep claude -p out of the repo, small readable code), git conventions, and the AI tooling in the repo.
- A "Learnings" section in CLAUDE.md, updated every time the AI got something wrong, so the same mistake isn't repeated in later sessions.
- README.md for setup, provider options, run, tests and deploy; SUBMISSION.md and ARCHITECTURE.md for design and decisions.
- Persistent memory files (Claude Code memory) for things the repo doesn't record: the submission deadline and time, and pending work between sessions (for example "case 6 false Passed on mobile menu — fix next session").
- Skills carry reusable procedures as context only when needed (how to ship safely, how to start and smoke-test the app).
- Context isolation for the product: the in-product agent runs `claude -p` from an empty temp folder, because the CLI reads CLAUDE.md from parent folders and would otherwise get our development instructions.
- Type contracts as context: `frontend/src/api.ts` mirrors `backend/app/models.py`, and the tool schemas live in one place in `ai.py`.

## Approach to planning, prompting and iteration (5000)
- Small vertical slices: each change was one working piece (for example "flag clicks that change nothing", "let testers bring their own key", "public mode"), with its tests, committed separately with a conventional commit that explains why.
- Plan first, then build: for bigger work I asked for options and trade-offs, picked one, and kept the scope realistic for the deadline. For example I chose access codes instead of email sign-up for the deadline, and kept email for later.
- Prompts state the goal, constraints and how to verify, and point at existing code and rules rather than retyping them.
- Verify, don't trust: after each change, run the test suite, run the app, and run the demo-shop eval, where the agent is only right if it finds all three planted bugs.
- When the AI failed, fix the system, not just the prompt. A prompt rule alone did not stop a false Passed on the mobile menu, so the runner now detects dead clicks in code. The first URL guard was bypassable, so it was replaced with a proxy and real-socket tests.
- Independent review for risky changes: the qa-reviewer agent reviews the diff without my conclusions, and I reproduce its findings before fixing.

## Agents, skills, reusable instructions or workflows (5000)
- CLAUDE.md: reusable project instructions loaded in every session (product, run/test commands, file layout, rules, git conventions, learnings).
- qa-reviewer agent (.claude/agents/qa-reviewer.md): a read-only reviewer (Read, Glob, Grep, Bash) that checks a diff against the CLAUDE.md rules: grounded verdicts, no secrets, input validation, URL safety, tests.
- ship skill (.claude/skills/ship): commit, push and pull safely to the personal GitHub account — identity and remote checks, never stage ignored files, secret scan of the staged diff, tests and build must pass, conventional commits, push only after confirmation, never force-push.
- run-app skill (.claude/skills/run-app): start backend and frontend, wait for health checks, then smoke-test on the demo shop and report pass/fail per case; a Passed on a planted-bug case is reported as an AI error.
- Hooks (.claude/settings.json): block-env-files.sh, guard-git.sh, check-python.sh (see guardrails).
- Inside the product: three Claude "roles" with forced tool use — planner (submit_plan), browser agent (click/fill/press/goto/ask_user/finish) and bug reporter (submit_bug).

## Responsibilities the agents handled (5000)
- Claude Code (main session): planning, implementation, tests, debugging, docs, commits through the ship skill.
- qa-reviewer agent: pre-commit review of backend/AI and security changes. On the public-mode diff it found and reproduced screenshot path traversal, redirect bypass to private networks, WebSocket bypass, DNS rebinding and runs stuck as "Running" after a crash.
- run-app skill: starting the app and the end-to-end smoke test on the demo shop.
- ship skill: safe commits and pushes.
- In the product: the planner writes test cases; the browser agent runs one case step by step and decides Passed/Failed/Blocked or asks the tester; the bug reporter writes reports from recorded data only.

## Guardrails implemented (5000)
Development guardrails (Claude Code hooks):
- block-env-files.sh: the AI cannot read or edit .env files, so keys never enter the AI context.
- guard-git.sh: blocks pushes to any remote other than the personal GitHub alias and blocks global git config changes.
- check-python.sh: syntax-checks every Python file the AI edits.
- The ship skill scans the staged diff for keys and runs tests and build before every commit.

Product guardrails against wrong AI output:
- Evidence check: a Passed must quote text that is on the real page; otherwise it becomes "Blocked — needs review".
- Dead-click check: a Passed after a click that changed nothing is downgraded.
- Forced tool use with JSON schemas for every AI call; a step limit (15 actions per case).
- Bug reports may only use recorded steps and errors; only the likely cause is a labelled guess.
- The agent types made-up test data in forms, never real personal details, and asks before paying or deleting.

Security guardrails (hosted demo):
- Invite-only access codes and an admin page behind a password.
- Each code sees only its own data.
- Testers' API keys are kept in memory only.
- An egress proxy blocks private and internal networks, including through redirects, WebSockets and DNS rebinding.
- Android is off, settings are read-only and API docs are hidden.
- Each code can run one test at a time, and the server runs a limited number of browsers.

## How was human review incorporated? (5000)
- I read every diff before committing, and all commits go through me.
- The product itself keeps a human checkpoint: the tester reviews and approves the AI's test plan before anything runs, and can answer the agent's questions during a run.
- I validated behaviour in the real app, not only in tests: demo-shop runs, public-mode flows in a real browser (admin → code → key → revoke), and screenshots of new UI.
- For risky work I asked for an independent review (qa-reviewer agent), then had every finding reproduced before a fix and verified again after.
- I made the product decisions: scope, access codes instead of email sign-up before the deadline, no public deploy without the security checks, Claude-only keys for now.
- Honest reporting: when something was not verified (for example the Docker image was not built locally) or went wrong (a test deleted a real screenshot), it was recorded rather than hidden.

## AI-assisted testing strategy (5000)
Three layers:
1. Automated tests written with AI (pytest, 124 tests), with Claude always mocked so tests are fast, free and deterministic. They cover verdict grounding, input validation, API behaviour and security. Every bug fix gets a test that fails without the fix.
2. An end-to-end eval on the AcmeCart demo shop, which has three planted bugs. The agent is right only if it marks those cases Failed and marks plain add-to-cart Passed with evidence that is on the page. I ran it after AI or prompt changes, on desktop and mobile viewports.
3. Real-browser verification scripts for things unit tests can't prove, such as redirects, WebSockets, a full checkout through the egress proxy, and the public-mode UI flow.

On top of that, an AI reviewer agent checks security-sensitive diffs, and the product itself is AI-assisted QA whose output is checked by code (evidence and dead-click checks).

## Tests created or executed (5000)
- Unit and integration tests (pytest, FastAPI TestClient): 124, all passing.
  - Verdict grounding (test_evidence.py): evidence on the page or not, case and whitespace, accessible names, blank and paraphrased evidence, previous-page evidence, dead clicks, step limit, failed actions.
  - Input validation (test_validation.py): URL schemes, javascript: and file: URLs, APK paths, requirements length.
  - Answers and bug reports (test_answer.py, test_bug_report.py): waiting and not waiting, invalid bodies, unknown runs, running runs.
  - Run history (test_db.py): history and API create/get/list.
  - Tester API key (test_user_key.py): key used but never saved, bad keys rejected, public mode requires a key, rejected key gives a clear 401.
  - Public mode (test_access.py): access codes and admin, per-code isolation of runs and screenshots, path traversal, one run per code, private URL rejection, IPv4/IPv6/IPv4-mapped/Fly-internal addresses, bad ports, Android off, settings read-only, API docs hidden, and the egress proxy over real sockets (public host passes, private host refused, redirect target refused, pinned IP dialled). Crashed and restarted runs are closed.
- End-to-end eval on the demo shop: desktop (7 cases) and mobile (6 cases). All three planted bugs caught.
- Manual and browser scripts:
  - Playwright scripts for proxy blocking (direct, redirect, WebSocket), checkout through the proxy (HTTP 500 captured), and the public-mode UI flow.
  - Screenshots of the new dialogs.
  - A smoke test of the running app (health, frontend, rejected-key path).

## How AI helped find bugs, edge cases or regressions (5000)
- False Passed (the product's own AI): the eval showed the agent passing a mobile-menu case although the menu never opens. A prompt rule was not enough, so we added a dead-click check in the runner. The next eval run failed all four menu cases with "page did not change".
- Security review: the qa-reviewer agent found that `/evidence/2/%2e%2e/1/case_1.png` returned another user's screenshot, and that a site redirecting to 169.254.169.254 or localhost bypassed the URL guard. It also flagged WebSocket bypass, DNS rebinding, runs stuck as "Running" after a crash, thread-pool exhaustion from sleep calls, 500 errors on odd run IDs, and the access code leaking into URLs and logs. All were fixed and have tests.
- Edge cases generated by AI: IPv4-mapped IPv6 (::ffff:127.0.0.1), Fly's private fdaa:: network, ports above 65535, blank evidence strings, keys of the wrong format, a cookie that is Secure on plain-HTTP tests.
- Regressions caught by the suite: changing who owns a run broke two older tests (unknown runs now return 404), which made the behaviour change explicit.
- Debugging: AI found the proxy hang (a reader thread holding a lock) and isolated a Chrome redirect quirk with a minimal reproduction.

## How were test results validated? (5000)
- The AI is never the final judge. In the product, the runner checks every Passed against the real page. In development, tests and real-browser runs decide, not the AI's description of what it did.
- Tests are checked to really test something: each security fix was reproduced first (the attack worked), then fixed, then shown to fail without the fix and pass with it.
- I ran the demo-shop eval against known planted bugs, so a correct result is known in advance.
- AI findings were reproduced before acting (for example the path-traversal and redirect attacks were run against the real app).
- Unexpected results were investigated instead of accepted. For example, a redirect failure was shown to happen without our proxy too, so it was a Chrome quirk and not our bug.
- Test isolation: Claude is always mocked, and tests use temporary databases and evidence folders. This rule was added after an AI-written test touched real data.
- Results are reported honestly, including what was not verified.

## Important architectural or product decisions (2000)
- The runner, not the AI, decides the final verdict: a Passed needs evidence on the real page and no dead clicks. The trade-off is that some real passes become "needs review".
- One AI action per step from the accessibility snapshot: every step is checked and logged. It costs more calls but is far more reliable than one-shot scripts.
- A human approves the plan before anything runs.
- SQLite + polling on one machine: the simplest design that works.
- Public mode is a switch: local use stays simple, and the deploy adds access codes, per-code data, testers' own keys and an egress proxy.
- Egress proxy instead of Playwright route checks, because those were bypassable.
- Access codes instead of email sign-up for the deadline.

## Known limitations or incomplete features (1500)
- Only Anthropic keys for now. The provider code has one place to add OpenAI-compatible models.
- AI is non-deterministic: checks stop false passes, but a case can still fail for the wrong reason, so run the eval more than once.
- CAPTCHAs, 2FA and complex canvas or drag-and-drop UIs are out of scope; long flows can hit the 15-action limit.
- Paraphrased evidence turns a correct pass into "needs review".
- iOS apps are not supported yet (the iOS tab shows "coming soon").
- The hosted demo runs on one machine with two browsers at a time, uses access codes rather than accounts, and has no Android.
- The proxy covers HTTP(S) and WebSockets; WebRTC UDP is disabled.

## External dependencies (1000)
- Claude: Anthropic API (key) or Claude Code CLI login.
- Google Chrome or Playwright Chromium.
- Python 3.12: FastAPI, Uvicorn, Pydantic, Playwright, anthropic, python-dotenv; pytest for tests.
- Node.js: React, Vite, TypeScript (build only).
- SQLite (built into Python).
- Optional: adb and an Android phone for APK testing; Fly.io and Docker for the hosted demo.

## Current risks and future improvements (5000)
Risks:
- Cost and speed: one AI call per step makes long suites slow and costly.
- AI non-determinism: a prompt or model change can shift results, so the eval must be re-run.
- Hosted demo: single machine, SQLite and a small browser pool. It needs monitoring if usage grows. Access codes are a stand-in for real accounts.

Next steps:
1. Accounts with email approval: sign-up request → admin approves by email → magic-link login. Per-owner data separation is already in place.
2. More AI providers through an OpenAI-compatible adapter (OpenAI, Gemini, Groq, OpenRouter) from a fixed list, with the eval run per model.
3. Run the demo-shop eval in CI on every prompt or model change, with a pass threshold.
4. Re-run a failed case after a fix to confirm it, and post results to Teams or Slack.
5. Cheaper runs: cache the plan, take fewer snapshots, use a smaller model for easy steps.
6. A job queue and Postgres for several machines; video recording of runs.

## Pre-existing Work Disclosure (yes / no)
<choose yes or no in the form>
