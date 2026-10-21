# CSSLab Maia 3 engine (vendored, unmodified)

These files are CSSLab's, copied byte for byte from the Maia platform frontend and kept at their
upstream paths. Do not edit them: `src/main/maia/vendor-provenance.test.ts` re-hashes every file
here against the table below, and fails on any change or any unlisted file. To update, copy the new
upstream files and update the commit and hashes here.

- Upstream: https://github.com/CSSLab/maia-platform-frontend
- Commit: `a6e52f5c811ee18863cb2f0e81f2433a5b9905de`
- License: GPL-3.0 (`LICENSE`, CSSLab's copy), the same as Chaturanga's
- Model (not vendored; installed at runtime): `public/maia3/maia3_simplified.onnx` at commit
  `0013cc8e6ec52c88f5b3d694781d4cc8427cb91a`, 45,683,686 bytes, sha256
  `405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856`

## Files

Each path is both the upstream path and the path in this folder.

| File | sha256 |
| --- | --- |
| `LICENSE` | `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` |
| `public/maia-worker.js` | `db44a23840a6f200508d0a5ff1c502488aba59efa2d1d083134eccba40b59394` |
| `src/lib/engine/maia.ts` | `4658f4bab4da5a0ed211b8744c093d571d5a72397eacd170396f1dc2616b597c` |
| `src/lib/engine/storage.ts` | `7ec570972f4c086af864ed876a4e2005dffb789218db0bf7f93311c01d8d572b` |
| `src/lib/engine/tensor.ts` | `fc633e50757da719b2b615a390ea1da38ce079056ed63a72ac7fb88bde5bd7c5` |
| `src/lib/engine/data/all_moves.json` | `8a14d9f503a76e2de63c78a0e1751a2542de0cd4d89c0b9bd94f7732577c919f` |
| `src/lib/engine/data/all_moves_reversed.json` | `26333ed8da9f865c2b71f1943bd19a04f3fedc8ba1009abbe61ba5e6d48e2134` |
| `src/lib/engine/data/all_moves_maia3.json` | `e3351a233174e99d9ddca981681b65a444d191e8a6b474e27bd8fad8514af8d7` |
| `src/lib/engine/data/all_moves_maia3_reversed.json` | `bb9542b706d3011aa8c0bb067dd33b50bbd7313414cfb50052b0c92aaa9833ee` |

## What is not vendored

- `src/types` (their whole types tree): `maia.ts` imports only the `MaiaStatus` union from it. The
  host build and `tsconfig.maia-host.json` map that import to `src/maia-host/upstream-types.ts`.
- `public/ort/*` (their ONNX Runtime files): byte-identical to the `onnxruntime-web@1.23.0` npm
  package's `dist/` (the version their lockfile pins), so the app depends on that exact version and
  the host build copies these three files from it to `/ort/`, where their worker loads them. The
  test checks the installed package against their hashes:

| `onnxruntime-web/dist/` file (= CSSLab `public/ort/`) | sha256 |
| --- | --- |
| `ort.wasm.min.js` | `aec37bf5b223afd8ac358e6647369c724cc08727c258760bb88e4f6ce69ab68f` |
| `ort-wasm-simd-threaded.mjs` | `c0bc2244e2c95fbf39a5eccb595bca31defb9eefdffa6f9ce0325a1c47524461` |
| `ort-wasm-simd-threaded.wasm` | `3260fcdb33b4fc4ec33e89caf392e13625823e01049d3bf32c38464f9dbfe14c` |

- `chess.ts`: an npm dependency at the version their lockfile pins (`0.16.2`).
