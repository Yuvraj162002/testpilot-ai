#!/usr/bin/env bash
# PostToolUse (Edit|Write): report syntax errors in an edited Python file right away.
path=$(jq -r '.tool_input.file_path // empty')
[[ "$path" == *.py ]] || exit 0
if ! out=$(python3 -m py_compile "$path" 2>&1); then
  echo "Syntax error in $path:" >&2
  echo "$out" >&2
  exit 2
fi
exit 0
