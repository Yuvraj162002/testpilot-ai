#!/usr/bin/env bash
# PreToolUse (Read|Edit|Write): keep secrets out of the AI's context. .env.example is allowed.
path=$(jq -r '.tool_input.file_path // empty')
name=$(basename -- "$path")
if [[ "$name" == ".env" || ( "$name" == .env.* && "$name" != ".env.example" ) ]]; then
  echo "Blocked: $path may hold secrets. Ask the user to change it, or edit backend/.env.example instead." >&2
  exit 2
fi
exit 0
