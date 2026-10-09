#!/usr/bin/env bash
# Correctness gate. Quiet on success; last lines surface on failure.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm lint
pnpm -r --if-present typecheck
pnpm --filter @chaturanga/shared test -- --reporter=dot
pnpm --filter @chaturanga/desktop test -- --reporter=dot
node --test scripts/*.test.mjs
