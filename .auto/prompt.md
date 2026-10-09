# Autoresearch: shrink the shipped package, drop dead code, raise Lighthouse

## Objective
Make the desktop app users download smaller, without changing how it works. The v0.2.4
release artifacts (https://github.com/ayush-porwal/chatrunga/releases/tag/v0.2.4) are
~102–125 MB installers. Almost all of that is the Electron runtime plus `out/` (the
electron-vite bundles). Stockfish must not be inside the package: it is already a managed
download of the latest official release (fallback pinned to Stockfish 19), same path as Lc0.
Do not vendor the engine, the `stockfish/` checkout, or the npm `stockfish` package.

Also remove dead code (knip, with entry points that match how the app actually starts) and
raise Lighthouse performance, accessibility, best-practices, and SEO for every audited page.
The app must keep working: checks.sh is the gate.

## Metrics
- **Primary**: `package_bytes` (bytes, lower is better) — exact byte size of the unpacked
  macOS arm64 app `electron-builder --mac --arm64 --dir` writes. This is the shippable app
  for the host we can actually package. It moves when locales, bundles, or extra resources
  shrink, and it does not move if we only drop another OS target.
- **Secondary**:
  - `zip_bytes` — the matching `--arm64 zip` artifact (what a macOS arm64 user downloads)
  - `locale_bytes` — `.lproj` still inside the packaged app
  - `asar_bytes` — `app.asar` size
  - `renderer_js_bytes`, `main_js_bytes` — JS inside the asar
  - `stockfish_bytes` — packaged files that are a Stockfish binary (must stay 0; measure.sh
    exits 1 if this is non-zero, so a bundle of the engine cannot be kept)
  - `marketing_bytes` — `apps/marketing/dist` (not in the Electron package; tracked so image
    work is visible)
  - `knip_issues` — unused files + unused exports + unused dependencies knip reports
  - `lh_perf`, `lh_a11y`, `lh_bp`, `lh_seo` — minimum category score (0–100) across every
    audited page and form factor
  - `lh_pages` — how many page audits ran (must not drop; dropping a page to raise the min
    is cheating)

## How to Run
`./.auto/measure.sh` — builds the desktop app, packages the macOS arm64 dir + zip, audits
Lighthouse, runs knip, prints `METRIC name=value` lines.

Packaging is slow (copies Electron). Do not "speed it up" by summing a hand-maintained file
list instead of the real `dist/mac-arm64` app. That list can drift from what ships.

## Audited pages
Lighthouse must cover every page a person can open:

1. Marketing site `/` — the only public HTML page (mobile and desktop form factors).
2. Desktop renderer routes, loaded in the real Electron app (desktop form factor), not a
   stripped fixture:
   - `#/` (home)
   - `#/repertoires` (repertoire hub)
   - `#/repertoires/demo/chapters/demo` (study)
   - `#/repertoires/demo/practice` (practice)
   - `#/games/current/review` (game review)

In-app views that are not routes (Settings, Play, Puzzles, Databases) are reached from Home.
If you add a real route for one, add it to `.auto/lighthouse.mjs` in the same change.
Do not remove a page from the audit to improve a score.

## Files in Scope
- `apps/desktop/**` — Electron app, builder config, renderer, main, preload
- `apps/marketing/**` — public site (Lighthouse + its own dist size)
- `packages/shared/**` — shared code pulled into the bundles
- `scripts/**` — packaging checks, generators
- `pnpm-workspace.yaml`, root `package.json` — only if a dependency is truly unused
- `.auto/**` — measurement and this playbook (update "What's Been Tried")

## Off Limits
- Images may be deleted even when code references or renders them. Remove the reference in the same change so the build does not point at a missing file. Prefer deleting an image that is unused, duplicated, or only there as weight. Do not delete sounds or piece-theme glyphs the board still draws, and do not remove a non-image feature.
- Do not drop macOS x64, Windows, or Linux targets. This metric is arm64-only because that
  is the machine we can package; the release still builds the others.
- Do not exclude files from `build.files` that `scripts/check-packaged-app.mjs` requires.
- Do not vendor Stockfish (binary, source tree, or npm package) into the app, asar, or
  extraResources. The gitignored `stockfish/` directory is a local checkout, not a package
  input — never add it to `extraResources` or `files`.
- Do not weaken tests, lint, or coverage to pass checks.
- Do not commit secrets or the untracked audit markdown files (`AUDIT.md`, `FEEDBACK.md`, …).

## Constraints
- Behavior stays the same. English UI is fine; stripping non-English Electron locale packs
  is allowed (native dialogs fall back to English). Do not break engine download, review,
  import, or the packaged-app check.
- `stockfish_bytes` must stay 0. Downloads stay on the existing latest-release path
  (`STOCKFISH_SOURCE` / `ENGINE_MANIFEST` fallback `sf_19`).
- Checks: `./.auto/checks.sh` (lint, typecheck, unit tests, script tests). A keep requires
  checks to pass. Run packaged e2e (`CHATURANGA_E2E_PACKAGED=1`) before declaring the three
  end conditions met, not on every iteration.
- No new runtime dependencies unless removing a larger one. Dev-only tools are fine.
- Do not cheat: no stubbing Lighthouse, no deleting a page from the audit, no measuring a
  subset of the packaged app, no claiming dead code is gone by ignoring knip entry points
  that are real (workers, preload, e2e, scripts).

## End conditions
Stop only when all three are true, and say so:

1. Further package-size cuts would remove behavior, a platform, or a file the package check
   requires — or they lose to measurement noise.
2. Lighthouse category mins are at the ceiling the pages allow (or a further point needs a
   product change, which you record in `.auto/ideas.md` instead of forcing).
3. `knip_issues` is 0 with an honest entry-point config, or every remaining hit is a
   documented false positive you cannot fix without hiding real code. Dead code includes
   unused files, exports, dependencies, and images nothing renders. Referenced images are
   still removable when dropping them (and the reference) shrinks the package or the page.

## What's Been Tried
- Not yet. Baseline is the first run.
- Known before any run (verify, do not assume):
  - electron-builder `files` is only `out/**` + `package.json`; extraResources are the two
    icons. The 109 MB `stockfish/stockfish-macos-m1-apple-silicon` binary is gitignored and
    not referenced by the builder config.
  - Stockfish and Lc0 already resolve from the GitHub latest release; fallback manifest is
    Stockfish 19 (`sf_19`).
  - Electron Framework locales under `*.lproj` are ~48 MB unpacked. `electronLanguages` is
    unset, so all of them ship. The UI is English.
  - Renderer `out/` is ~4 MB; main ~1.8 MB. Biggest app sources: generated piece-theme CSS,
    opening book data. Marketing images are not in the Electron package.
  - `pnpm-workspace.yaml` `allowBuilds.stockfish` is the string `"set this to true or false"`.
    The npm `stockfish` package is not a dependency. Removing that line is cleanup, not a
    size win, unless a dependency appears.
