#!/usr/bin/env bash
# Package size + Lighthouse + dead-code count. Prints METRIC lines.
set -euo pipefail
cd "$(dirname "$0")/.."

# Syntax of the measure helpers fails in well under a second.
node --check .auto/measure-package.mjs
node --check .auto/lighthouse.mjs

pnpm --filter @chaturanga/desktop exec electron-vite build
pnpm --filter @chaturanga/marketing exec vite build

export CSC_IDENTITY_AUTO_DISCOVERY=false
# Zip build leaves the unpacked app in dist/mac-arm64 and writes the downloadable zip.
# Host arch only. package.json still lists the other release targets.
pnpm --filter @chaturanga/desktop exec electron-builder --mac --arm64 --publish never -c.mac.target=zip

node .auto/measure-package.mjs | tee /tmp/chaturanga-package-metrics.txt
node scripts/check-packaged-app.mjs >/tmp/chaturanga-package-check.txt

node .auto/lighthouse.mjs | tee /tmp/chaturanga-lh-metrics.txt

# Knip exits 1 when it finds issues. The count is the metric; the build still succeeded.
knip_out="$(mktemp)"
if ! pnpm dlx knip@5.88.1 --config .auto/knip.json --reporter json >"$knip_out" 2>/tmp/chaturanga-knip.err; then
  if [[ ! -s "$knip_out" ]]; then
    echo "knip failed without a report" >&2
    cat /tmp/chaturanga-knip.err >&2
    exit 1
  fi
fi
node --input-type=module -e '
import { readFileSync } from "node:fs";
const report = JSON.parse(readFileSync(process.argv[1], "utf8"));
let issues = 0;
const add = (value) => {
  if (Array.isArray(value)) issues += value.length;
  else if (value && typeof value === "object") for (const item of Object.values(value)) add(item);
};
add(report);
console.log(`METRIC knip_issues=${issues}`);
' "$knip_out" | tee /tmp/chaturanga-knip-metrics.txt

node .auto/score.mjs
