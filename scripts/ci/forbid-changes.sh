#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="HEAD~1"
fi

DIFF="$(git diff --name-status "$BASE_REF...HEAD")"
[ -z "$DIFF" ] && exit 0

violations=()
while IFS=$'\t' read -r status path _; do
  [ -z "${status:-}" ] && continue
  [ -z "${path:-}" ] && continue

  case "$path" in
    .github/workflows/*|candidate-pack/*)
      violations+=("$status $path")
      ;;
    tests/*)
      case "$path" in
        tests/additional/*) ;;
        *) violations+=("$status $path") ;;
      esac
      ;;
    contracts/test/*)
      case "$path" in
        contracts/test/additional/*) ;;
        *) violations+=("$status $path") ;;
      esac
      ;;
  esac
done <<< "$DIFF"

if [ "${#violations[@]}" -gt 0 ]; then
  echo "Forbidden edits detected:"
  for item in "${violations[@]}"; do
    echo " - $item"
  done
  exit 1
fi

echo "Forbidden edit check passed."
