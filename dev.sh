#!/usr/bin/env bash
# Starts backend (http://localhost:8000) and frontend (http://localhost:5173) together. Ctrl+C stops both.
set -e
cd "$(dirname "$0")"
command -v claude >/dev/null || echo "WARNING: claude (Claude Code) not found - install it and log in, or set AI_PROVIDER=api with a key in backend/.env"
(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) &
(cd frontend && npm run dev -- --port 5173) &
trap 'kill 0' EXIT
wait
