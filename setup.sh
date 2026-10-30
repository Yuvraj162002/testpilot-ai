#!/usr/bin/env bash
# One-time setup on a new machine: Python venv + packages, browser, .env, frontend packages. Then run ./dev.sh
set -e
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null || { echo "ERROR: $1 not found. $2"; exit 1; }; }
need python3 "Install Python 3.10+ (https://www.python.org/downloads/)."
need npm "Install Node.js 20.19+ (https://nodejs.org/)."

echo "==> Backend: Python packages"
cd backend
python3 -m venv .venv || { echo "ERROR: could not create a venv. On Ubuntu/Debian: sudo apt install python3-venv"; exit 1; }
.venv/bin/pip install -q -r requirements.txt

# The runner uses Google Chrome when it is installed, otherwise Playwright's own Chromium.
if command -v google-chrome >/dev/null || command -v google-chrome-stable >/dev/null || [ -d "/Applications/Google Chrome.app" ]; then
  echo "==> Browser: Google Chrome found"
else
  echo "==> Browser: installing Playwright Chromium"
  .venv/bin/playwright install chromium
fi

[ -f .env ] || { cp .env.example .env; echo "==> Created backend/.env (AI_PROVIDER=claude-cli)"; }

echo "==> Frontend: npm packages"
cd ../frontend
npm install --silent

cd ..
command -v claude >/dev/null && echo "==> Claude Code found: the app will use your Claude login." \
  || echo "==> Claude Code not found: install and log in to it, or set AI_PROVIDER=api and ANTHROPIC_API_KEY in backend/.env"
echo
echo "Done. Start the app with:  ./dev.sh   then open http://localhost:5173"
