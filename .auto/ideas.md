# Ideas

- `electronLanguages: ["en"]` — drop non-English Electron `.lproj` / locale `.pak` files. Biggest unpacked-size lever. Confirm native menus and file dialogs still open.
- `compression: "maximum"` on electron-builder — may shrink zip/dmg/nsis even when unpacked bytes stay flat. Only keep if `zip_bytes` is the thing that improved and a repeat run confirms it is outside noise.
- Generated piece-theme CSS is ~276 KB source and lands in the renderer CSS. Subsetting unused piece sets would shrink the bundle but only if a set is truly unreachable from settings.
- Opening book (`packages/shared/src/chess/opening-book-data.ts`, ~260 KB) is data, not dead code. Compressing or code-splitting it only helps if review still resolves openings.
- Marketing JPEGs (hero and `public/shots`) dominate Lighthouse LCP. Re-encode only if visual quality holds and width/height/preload stay correct.
- Desktop views that are not routes (Settings, Play, Puzzles, Databases) are not separate Lighthouse URLs. A route each would let the audit cover them; do not add routes only to game the score.
- `app-icon.iconset` is source for the `.icns` and is not in extraResources. Do not add it.
