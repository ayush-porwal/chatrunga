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
- **Primary**: `score` (lower is better). One integer so a size win always beats Lighthouse,
  and a Lighthouse win always beats a dead-code win, without either being discarded when
  the coarser number is unchanged:

  `size_bytes = package_bytes` (the unpacked packaged desktop app, not a browser build)
  `lh_deficit = (100-lh_perf) + (100-lh_a11y) + (100-lh_bp) + (100-lh_seo)`
  `dead_units = knip_issues + unreferenced_image_files` (capped at 999)
  `score = floor(size_bytes / 100) * 1_000_000 + lh_deficit * 1_000 + dead_units`

  `package_bytes` is the unpacked macOS arm64 app. `marketing_bytes` is the built site, so
  deleting a referenced image that the site ships counts. 100 bytes is the size resolution.
- **Secondary**:
  - `zip_bytes` — the matching `--arm64 zip` artifact (what a macOS arm64 user downloads)
  - `locale_bytes` — `.lproj` still inside the packaged app
  - `asar_bytes` — `app.asar` size
  - `renderer_js_bytes`, `main_js_bytes` — JS inside the asar
  - `stockfish_bytes` — packaged files that are a Stockfish binary (must stay 0; measure.sh
    exits 1 if this is non-zero, so a bundle of the engine cannot be kept)
  - `marketing_bytes` — `apps/marketing/dist`
  - `unreferenced_images` — image files under `apps/` and `packages/` whose basename appears
    in no source, html, css, or json file. Deleting these is dead-asset removal.
  - `knip_issues` — unused files + unused exports + unused dependencies knip reports
  - `lh_perf`, `lh_a11y`, `lh_bp`, `lh_seo` — minimum category score (0–100) across every
    audited page and form factor
  - `lh_pages` — how many page audits ran (must not drop; dropping a page to raise the min
    is cheating)

## How to Run
`./.auto/measure.sh` — builds the desktop app, packages the macOS arm64 zip (and the unpacked
app it leaves behind), audits Lighthouse, runs knip, prints `METRIC name=value` lines.
This is the iteration metric. It is macOS arm64 only, because that is the machine the loop
runs on.

Final installer sizes, for every OS the release ships, come from the throwaway workflow
`.github/workflows/package-size.yml` (`workflow_dispatch` only):

`gh workflow run package-size.yml --ref <branch>`

That workflow builds macOS (arm64 + x64), Windows, and Linux with `electron-builder --publish never`,
unsets `GH_TOKEN`, and has `contents: read` so it cannot create a release or an update. It deletes
`latest*.yml` and blockmaps before upload. Artifacts are named `throwaway-*` and expire in one day.
In-app updates read GitHub releases, not Actions artifacts, so a run cannot ship an update.
Do not point this workflow at the release workflow, and do not add a publish job.

Run it after a size change that should show up on every OS (locale stripping, asar contents),
and before claiming the package cannot get smaller. The iteration metric stays local; waiting
on three CI runners every experiment would hide the signal in queue time.

Packaging is slow (copies Electron). Do not replace the real `dist/mac-arm64` app with a
hand-maintained file list. That list can drift from what ships.

## Audited pages
Lighthouse runs only against the packaged desktop app (`dist/mac-arm64/Chaturanga.app`),
attached to that process. Do not serve the renderer in a browser. Many features do not
exist there, and a browser score is not a result.

Lighthouse cannot navigate to `file://` itself. Each route is a reload of the packaged
page, driven from inside the app. On macOS an unfocused window does not paint
(`backgroundThrottling`), so the audit uses the same packaged-app hook as e2e
(`CHATURANGA_E2E_BACKGROUND=1`, occluded-window flags, CDP focus emulation). That is still
the packaged binary, not a browser. Pages:

- first-launch onboarding (snapshot of the packaged window before Skip setup)
- `#/` home, after Skip setup is clicked in the app
- `#/repertoires`
- `#/repertoires/demo/chapters/demo`
- `#/repertoires/demo/practice`
- `#/games/current/review`

`lh_pages` must stay 6. Do not drop a page to raise the minimum.

## Files in Scope
- `apps/desktop/**` — Electron app, builder config, renderer, main, preload
- `apps/marketing/**` — public site (Lighthouse + its own dist size)
- `packages/shared/**` — shared code pulled into the bundles
- `scripts/**` — packaging checks, generators
- `pnpm-workspace.yaml`, root `package.json` — only if a dependency is truly unused
- `.auto/**` — measurement and this playbook (update "What's Been Tried")
- `.github/workflows/package-size.yml` — throwaway cross-platform size check only. Do not add a publish step.
- `scripts/measure-installer-sizes.mjs` — installer byte counts for that workflow

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
