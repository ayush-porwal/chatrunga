# Chaturanga

A desktop chess app for studying your own games. It reviews every move with Stockfish, shows how
players at your rating would likely have played (Maia), and explains the key moments in plain
language.

![Game review](apps/marketing/public/shots/hero-review-1200.jpg)

- **Game review:** accuracy, move grades, eval graph, and a coach that explains each move
- **Analysis:** live engine lines and a move tree with variations
- **Play:** games against an engine with clocks, plus puzzles from the Lichess database
- **Local-first:** games and engines stay on your machine; AI commentary runs through your own
  OpenRouter key
- **Usage data:** on by default, off with one switch in Settings; feature usage and AI commentary
  requests and answers, never your API keys or files ([what is collected](docs/telemetry.md))

## Download

Get the latest build from [Releases](https://github.com/ayush-porwal/chatrunga/releases)
(macOS, Windows, Linux).

The app checks for new versions itself (the button next to Settings), downloads them in the
background and installs them on restart. macOS builds aren't notarized yet, so the first time you
open a downloaded copy macOS asks you to confirm it (System Settings → Privacy & Security → Open
Anyway); updates after that install in place without asking. Keep the app in Applications so it can
replace itself.

## Development

Requires Node 24 and pnpm 11.

```bash
pnpm install
pnpm dev     # run the desktop app
pnpm test    # run tests
pnpm lint    # lint
```

Releases are built by the manual **release** workflow in GitHub Actions. In-app updates read the
public GitHub releases of the repo in `build.publish` (`apps/desktop/package.json`). To try the
update flow locally, run a packaged build with `CHATURANGA_UPDATE_FEED_URL` pointing at a folder
served over HTTP that holds a `latest-mac.yml` / `latest.yml` / `latest-linux.yml`.

Usage analytics (PostHog) is configured at build time with `MAIN_VITE_POSTHOG_PROJECT_TOKEN` and
`MAIN_VITE_POSTHOG_HOST`; development and test runs never send. See [docs/telemetry.md](docs/telemetry.md).

Architecture proposals and implementation handoffs:

- [Engine catalog, profiles, pictures, and downloads](docs/engine-catalog-architecture.md)
