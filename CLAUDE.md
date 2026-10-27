# CLAUDE.md

Context for AI assistants working on this repo. Keep it short and true; update the Learnings section when
something goes wrong.

## What this is

**TestPilot AI**: an AI QA agent. Website URL + plain-English requirements → Claude writes a test plan →
the user reviews/edits it → a real Chromium browser (Playwright) runs each case, with Claude picking one
action at a time → results with screenshots, console/network errors and an AI-written bug report.
Android APKs are supported over adb. Built solo for the AI Product Hackathon 2026 (deadline 30 Oct 2026).

## Run

```bash
./dev.sh                     # backend :8000 + frontend :5173, Ctrl+C stops both
```

- App http://localhost:5173 · Swagger http://localhost:8000/docs · Demo shop http://localhost:8000/demo/
- First-time setup is in `README.md` (venv, `pip install`, `npm install`).
- AI provider: `claude-cli` (default, uses the local Claude Code login) or `api` (`ANTHROPIC_API_KEY` in
  `backend/.env`). See `backend/.env.example`.

## Layout

| Path | What |
|---|---|
| `backend/app/main.py` | FastAPI endpoints (`/api/plans`, `/api/runs`, bug report, answer, settings) |
| `backend/app/ai.py` | Every Claude call: plan, next action, bug report. Tool-use schemas live here |
| `backend/app/runner.py` | Playwright loop, evidence check, screenshots, console/network capture |
| `backend/app/android.py` | Same loop over adb + uiautomator |
| `backend/app/questions.py` | Human in the loop: the agent pauses and asks the tester |
| `backend/app/models.py` | Pydantic models + input validation (URL/APK, requirements length) |
| `backend/app/db.py` | SQLite run history (`backend/data/runs.db`, each run as JSON) |
| `backend/demo_site/` | AcmeCart demo shop |
| `frontend/src/pages/` | One React page per screen; API calls only through `frontend/src/api.ts` |

## Rules (do not break)

1. **Verdicts are grounded in the real page.** A `Passed` must quote evidence that is on the page,
   otherwise `runner.py` downgrades it to `Blocked — needs review`. Never remove or weaken this check.
   The bug report may guess a *likely cause*, but steps/actual/errors come only from recorded data.
2. **The demo shop bugs are intentional.** SAVE10 → 500, mobile menu never opens, wrong password shows no
   error (`backend/app/demo.py`). Don't "fix" them; the demo and the eval depend on them.
3. **No secrets in the repo.** `backend/.env` is git-ignored and blocked for Read/Edit by a hook. Never put
   a key in the frontend.
4. **No customer apps or data.** Don't commit or demo client APKs or runs against client sites.
   `backend/data/` and `backend/runs/` are git-ignored for this reason.
5. **The backend opens any URL it is given.** Treat it as local-only until auth and URL checks exist;
   don't deploy it publicly without them.
6. Keep `claude -p` out of the repo tree (`ai.CLI_CWD` is in the temp dir) so this file never reaches the
   test agent's prompt.
7. Small, readable code over abstractions. Match the existing style: short docstrings, comments only for
   the non-obvious.

## Git

- Commits go to the author's **personal** GitHub (`Yuvraj162002`) through the SSH alias `github-personal`,
  never the office account. Repo-local `user.name`/`user.email` are set; never touch `git config --global`.
  A hook blocks pushes to any other remote.
- Conventional commits: `<type>(<scope>): <subject>`, lowercase, ≤ 50 chars; body says why.
  Scopes: `backend`, `frontend`, `ai`, `runner`, `android`, `demo`, `docs`, `claude`.
- Use the `ship` skill to commit/push/pull.

## AI tooling in this repo

- `.claude/settings.json` hooks: block `.env` access, block pushes outside `github-personal` and global git
  config, syntax-check edited Python files.
- Skills: `ship` (commit + push/pull safely), `run-app` (start the app and smoke-test it on the demo shop).
- Agent: `qa-reviewer` (reviews a diff against the rules above before committing).

## Learnings (AI failures and what changed)

- The test agent sometimes said `Passed` when the expected text was not on the page → added the evidence
  check in `runner.py` (rule 1).
- `claude -p` reads `CLAUDE.md` from parent folders, so running it from `backend/data/` would have leaked
  this file into the test agent → moved its working dir to the temp dir.
- Android emulator with software rendering was too slow for the agent loop → test on a real phone over adb.
