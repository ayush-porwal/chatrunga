# Chaturanga

A desktop chess app (Electron + React) for studying games: PGN import and a move-tree editor,
play and analysis against UCI engines, puzzles and opening databases, and a Game Review that
combines Stockfish, the human-like Maia models and optional AI commentary. Everything runs on
your machine; there is no Chaturanga server.

## Repository layout

| Path              | What it is                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `apps/desktop`    | The Electron app: `src/main` (engines, SQLite, IPC), `src/preload`, `src/renderer` (React UI) |
| `apps/marketing`  | Static marketing site (Vite)                                                                   |
| `packages/shared` | Code shared by main and renderer: chess logic, types, IPC contract, zod schemas, AI prompt     |
| `scripts`         | Repo tooling (Electron install check, piece-theme CSS generator)                               |

## Development

Requires Node `24.15.0` (see `.nvmrc`) and pnpm `11.0.9`.

```bash
pnpm install
pnpm dev                    # Electron app with hot reload (same as pnpm dev:desktop)
pnpm dev:marketing          # marketing site

pnpm test                   # vitest in every package
pnpm test:coverage          # shared + desktop with coverage thresholds
pnpm lint                   # eslint
pnpm -r --if-present typecheck
pnpm build                  # typecheck + build every package
pnpm generate:piece-css     # regenerate piece-theme CSS from scripts/piece-svg-sources
```

Environment hooks for the desktop app:

- `CHATURANGA_USER_DATA_DIR=/tmp/profile` runs against a throwaway profile (database,
  settings, API key, downloaded engines) instead of the real one — for UI automation and
  clean-install checks.
- `CHATURANGA_UCI_LOG=1` prints UCI transcripts and engine stderr to the terminal.

## Engines

Stockfish, Lc0 and the five Maia networks are installed from **Settings → Engine downloads**
(or the first-launch dialog); any other UCI engine can be added by path under Settings →
Engines. The app bundle ships no engine binaries.

- Stockfish and Lc0 come from the upstream GitHub **latest release**, looked up via the GitHub
  API and cached in the user-data directory (`apps/desktop/src/main/engine/github-releases.ts`).
  The right build for the platform/CPU is picked by pattern and verified against the sha256
  `digest` GitHub publishes for the asset before it is installed.
- When GitHub can't be reached and nothing is cached, a built-in fallback list of last
  known-good URLs is used (`apps/desktop/src/main/engine/engine-manifest.ts`). Maia weights
  always come from fixed URLs there.
- Updates are never applied silently: the panel shows "Update available" and the user clicks
  Update. Lc0 publishes no macOS/Linux binaries, so on those platforms the panel shows an
  install command (e.g. `brew install lc0`) and lets you pick the binary.

The install pipeline (resumable download from allow-listed GitHub hosts → verify → extract →
atomic swap) is in `apps/desktop/src/main/engine/asset-manager.ts`.

## AI commentary

Game Review explains each move in plain language, entirely from the client:

1. The renderer builds a grounded payload for the selected move from the finished engine
   review (evaluations, lines, board-derived ideas, Maia likelihoods) —
   `apps/desktop/src/renderer/src/features/game-review/review-utils.ts`.
2. The main process validates it and calls OpenRouter with **the user's own API key**
   (`apps/desktop/src/main/commentary/openrouter-commentary.ts`). The prompt, response parser
   and grounding validator are in `packages/shared/src/llm/commentary.ts`; answers that mention
   moves or tactics not in the facts are retried once, then replaced by the local explanation.
3. The key is encrypted with Electron `safeStorage` (the OS keychain on macOS) in the user-data
   directory and never reaches the renderer (`openrouter-config.ts`).

Without a key — or with **Settings → Commentary → Source: Local (offline)** — the app shows a
deterministic explanation built from the same facts, fully offline. Explanations are requested
only for the move being viewed and are cached with the saved game. The default model is set in
`packages/shared/src/llm/models.ts`.

## Releases

Releases are cut by the manual **release** workflow (`.github/workflows/release.yml`): GitHub →
Actions → release → Run workflow. It:

1. takes the latest commit on `main` and computes the next version from the latest `vX.Y.Z` tag
   (`patch`/`minor`/`major` bump, or an exact version such as `0.2.0-beta.1`, which is published
   as a prerelease) — `scripts/release-plan.mjs`;
2. writes release notes from the commit subjects since that tag, grouped by Conventional Commit
   type (`feat`, `fix`, `perf`, …);
3. runs lint, typecheck and tests, then builds in parallel: macOS `.dmg` + `.zip` (arm64 and x64,
   ad-hoc signed), Windows NSIS `-setup.exe` (x64) and Linux `.AppImage` (x64), plus the
   `latest*.yml` / `.blockmap` update metadata;
4. publishes the GitHub release `vX.Y.Z` with every file and a `SHA256SUMS.txt` (optionally as a
   draft).

The version lives in the git tag; `apps/desktop/package.json` is stamped at build time. Builds
are not notarized/code-signed yet — add Apple and Windows signing certificates as repository
secrets when available. Local packaging:

```bash
pnpm --filter @chaturanga/desktop dist:mac     # or dist:win / dist:linux, into apps/desktop/dist
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on every push.
