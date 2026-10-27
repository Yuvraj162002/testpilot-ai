---
name: ship
description: Commit, push or pull this repo safely to the author's personal GitHub (Yuvraj162002) from the office laptop. Use when the user says commit, push, pull, sync, or "ship it".
---

# Ship

This laptop's global git identity is a work account. This repo must only ever use the
personal account. `.claude/hooks/guard-git.sh` enforces it; this skill is the happy path.

## Before anything

```bash
git config user.email          # must contain Yuvraj162002 (repo-local)
git remote -v                  # origin must be git@github-personal:Yuvraj162002/<repo>.git
ssh -T git@github-personal     # "Hi Yuvraj162002!" — if not, the SSH key is missing (~/.ssh/id_ed25519_personal)
```

If `origin` is missing, ask the user for the repo name (they create it on github.com/new — empty,
private), then `git remote add origin git@github-personal:Yuvraj162002/<repo>.git`.

## Commit

1. `git status --short` and `git diff` — read what changed.
2. Never stage: `backend/.env`, `backend/data/` (APKs, runs.db), `backend/runs/`, `node_modules`, `dist`.
   They are git-ignored; never use `git add -f` on them.
3. Quick secret scan of the staged diff:
   `git diff --cached | grep -nE 'sk-ant-|ghp_|AIza|ANTHROPIC_API_KEY=[^ ]+'` must print nothing.
4. If backend code changed and `backend/tests/` exists: `cd backend && .venv/bin/pytest -q` must pass.
   If frontend changed: `cd frontend && npm run build` must pass.
5. Split unrelated changes into separate commits. Message: `<type>(<scope>): <subject>` (see CLAUDE.md),
   body explains why.

## Push / pull

- Show the user `git log --oneline origin/main..HEAD` (or the full log on the first push) and push only
  after they say so: `git push -u origin main`.
- Pull: `git pull --rebase origin main`. On conflicts, stop and show them; don't resolve by discarding.
- Never force-push.
