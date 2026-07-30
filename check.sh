#!/usr/bin/env bash
# Type-check fork before commit. Blocks on any TS error.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x ./node_modules/.bin/tsc ]; then
  NPM_WRAPPER_ALLOW_LOCAL=1 npm install --no-save typescript >/dev/null 2>&1 || true
fi

if ./node_modules/.bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler index.ts 2>&1; then
  echo "OK: 0 diagnostics"
  exit 0
fi

echo "FAIL: TS errors (commit blocked)"
exit 1
