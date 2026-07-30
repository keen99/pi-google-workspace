#!/usr/bin/env bash
# Local check: type-check + tests. Blocks on any failure.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x ./node_modules/.bin/tsc ] || [ ! -x ./node_modules/.bin/vitest ]; then
  NPM_WRAPPER_ALLOW_LOCAL=1 npm install >/dev/null 2>&1 || true
fi

echo ">> type-check (tsc --noEmit)"
if ! ./node_modules/.bin/tsc --noEmit 2>&1; then
  echo "FAIL: TS errors"
  exit 1
fi

if [ -d ./test ]; then
  echo ">> tests (vitest run)"
  if ! ./node_modules/.bin/vitest run 2>&1; then
    echo "FAIL: tests failed"
    exit 1
  fi
fi

echo "OK: type-check + tests pass"
exit 0
