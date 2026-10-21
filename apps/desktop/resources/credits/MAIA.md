# Maia 3 credits

Chaturanga's human-move predictions (Game review's Human moves, Moves by rating and difficulty)
and its Maia opponent in Play come from Maia 3, by the
[CSSLab](https://csslab.cs.toronto.edu/) (University of Toronto and McGill University), run with
CSSLab's own engine code from the Maia platform. Chaturanga is not affiliated with or endorsed by
CSSLab.

## The model

`maia3_simplified.onnx`, CSSLab's Maia 3 model as the Maia platform serves it, is not bundled. It is
downloaded at runtime, when you choose to, from the
[CSSLab/maia-platform-frontend](https://github.com/CSSLab/maia-platform-frontend) repository:
`public/maia3/maia3_simplified.onnx` at commit `0013cc8e6ec52c88f5b3d694781d4cc8427cb91a`
(45,683,686 bytes, sha256 `405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856`; the
app checks both before installing it). That repository is licensed under the
[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html).

## The engine code (bundled)

CSSLab's Maia 3 engine files from
[CSSLab/maia-platform-frontend](https://github.com/CSSLab/maia-platform-frontend) at commit
`a6e52f5c811ee18863cb2f0e81f2433a5b9905de`, unmodified, GPL-3.0. They are in
`apps/desktop/vendor/csslab-maia/` in the repository, at their upstream paths, with CSSLab's
`LICENSE` and a `PROVENANCE.md` that lists each file's sha256:

- `public/maia-worker.js`
- `src/lib/engine/maia.ts`
- `src/lib/engine/storage.ts`
- `src/lib/engine/tensor.ts`
- `src/lib/engine/data/all_moves.json`
- `src/lib/engine/data/all_moves_reversed.json`
- `src/lib/engine/data/all_moves_maia3.json`
- `src/lib/engine/data/all_moves_maia3_reversed.json`

The app builds them, as they are, into the hidden page that runs the model (`out/maia-host/` in a
build). The GPL-3.0 text is Chaturanga's own `LICENSE` (next to this `credits` folder in the app,
at the root of the repository), the same licence as CSSLab's.

## Papers

Maia 3:

> Monroe, Eilender, Chalmers, Tang and Anderson. "Chessformer: A Unified Architecture for Chess
> Modeling." International Conference on Learning Representations (ICLR), 2026.
> https://openreview.net/forum?id=2ltBRzEHyd

The original Maia:

> Reid McIlroy-Young, Siddhartha Sen, Jon Kleinberg and Ashton Anderson. "Aligning Superhuman AI
> with Human Behavior: Chess as a Model System." Proceedings of the 26th ACM SIGKDD International
> Conference on Knowledge Discovery and Data Mining (KDD), 2020.
> https://doi.org/10.1145/3394486.3403219

## Libraries CSSLab's engine runs on (bundled)

| Library                                                                                                                | Version | Copyright                        | Licence                                                                                |
| ---------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime)                                                           | 1.23.0  | © Microsoft Corporation          | MIT, [licenses/MIT-ONNX-Runtime.txt](licenses/MIT-ONNX-Runtime.txt)                    |
| [chess.ts](https://github.com/lubert/chess.ts), a TypeScript rewrite of [chess.js](https://github.com/jhlywa/chess.js) | 0.16.2  | © 2020 Jeff Hlywa, © 2020 Lu Zhu | BSD-2-Clause, [licenses/BSD-2-Clause-chess.ts.txt](licenses/BSD-2-Clause-chess.ts.txt) |

ONNX Runtime's `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs` and `ort-wasm-simd-threaded.wasm`
from the `onnxruntime-web` npm package (the files CSSLab's platform serves) ship unmodified.
ONNX Runtime includes third-party components under their own licences, listed in its
[ThirdPartyNotices.txt](https://github.com/microsoft/onnxruntime/blob/v1.23.0/ThirdPartyNotices.txt).
