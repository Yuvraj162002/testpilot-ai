#!/usr/bin/env bash
# PreToolUse (Bash): this laptop's global git identity is the office account. Keep this repo personal.
cmd=$(jq -r '.tool_input.command // empty')

if grep -qE 'git +config +(--global|--system)' <<<"$cmd"; then
  echo "Blocked: don't change global git config on this machine. Use repo-local config." >&2
  exit 2
fi

if grep -qE '(^|[;&|] *)git +push' <<<"$cmd"; then
  cd "$CLAUDE_PROJECT_DIR" || exit 0
  for remote in $(git remote); do
    url=$(git remote get-url "$remote")
    if [[ "$url" != git@github-personal:Yuvraj162002/* ]]; then
      echo "Blocked: remote '$remote' is $url. Push only to git@github-personal:Yuvraj162002/<repo>.git." >&2
      exit 2
    fi
  done
  if [[ "$(git config user.email)" != *Yuvraj162002* ]]; then
    echo "Blocked: repo-local user.email is not the personal GitHub email." >&2
    exit 2
  fi
fi
exit 0
