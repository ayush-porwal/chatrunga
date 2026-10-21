# Engine logo credits

Chaturanga shows each chess engine's logo next to its name. The logos identify the engines; they
are the marks of their respective projects, and Chaturanga is not affiliated with or endorsed by
any of them. The files are in `apps/desktop/src/renderer/src/assets/engines/` in the repository.

| Logo             | Engine                 | Source                                                                                                                            | Licence of the source                                                        |
| ---------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `stockfish.webp` | Stockfish              | [official-stockfish/stockfish-web](https://github.com/official-stockfish/stockfish-web) `static/images/logo/icon_512x512@2x.webp` | [MIT](https://github.com/official-stockfish/stockfish-web/blob/main/LICENSE) |
| `maia.webp`      | Maia                   | [CSSLab/maia-platform-frontend](https://github.com/CSSLab/maia-platform-frontend), as shown on https://www.maiachess.com/         | [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html)                           |
| `lc0.webp`       | Lc0 (Leela Chess Zero) | [LeelaChessZero/lczero.org](https://github.com/LeelaChessZero/lczero.org) `static/images/logo.svg`                                | None stated                                                                  |

## Stockfish

The Stockfish logo from the official Stockfish website's repository,
[official-stockfish/stockfish-web](https://github.com/official-stockfish/stockfish-web)
(`static/images/logo/icon_512x512@2x.webp`, served at
https://stockfishchess.org/images/logo/icon_512x512@2x.webp). That repository's `LICENSE` is the
MIT licence; its copyright notice names the Hugo theme the site is built on (Robert Austin /
zerostatic). Our copy has its margin trimmed and is resized to a 128×128 WebP. Stockfish itself is
© the Stockfish developers, under the GPLv3.

## Maia

The Maia logo of the CSSLab (University of Toronto and McGill University), as used by the Maia
platform, [CSSLab/maia-platform-frontend](https://github.com/CSSLab/maia-platform-frontend)
(GPLv3), at https://www.maiachess.com/. Our copy is a 96×96 WebP. The GPL-3.0 text is
Chaturanga's own `LICENSE` (next to this `credits` folder in the app, at the root of the
repository).

## Lc0

The Lc0 (Leela Chess Zero) logo from
[LeelaChessZero/lczero.org](https://github.com/LeelaChessZero/lczero.org)
(`static/images/logo.svg`), recomposed onto a square dark tile and rasterised to a 128×128 WebP.
It is used to identify the Lc0 engine; the lczero.org repository does not state a licence for it.

## The engines

The engines are not bundled: Stockfish, Lc0 (on Windows; elsewhere you install it yourself) and
Lc0's network are downloaded at runtime from their projects' own releases, and come with those
projects' licences (see `apps/desktop/src/main/engine/engine-manifest.ts`). Lc0's default network,
T1-256x10-distilled-swa-2432500, is by the Leela Chess Zero project
(https://lczero.org/play/networks/bestnets/), which states no licence for it; Lc0 keeps playing on
it.

Maia 3 replaces the Maia 1 networks (1100–1900) that Chaturanga used to run in Lc0: it is one model
for every rating from 600 to 2600, downloaded at runtime when you choose to, and it no longer runs
in Lc0 but in CSSLab's own engine code, bundled unmodified. Its model, that code, the libraries it
runs on and the papers behind it are credited in [MAIA.md](MAIA.md).
