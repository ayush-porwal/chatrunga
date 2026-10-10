# Piece set sources

Our copies of the piece drawings the app ships, one folder per set, twelve SVGs each (`wK.svg` …
`bP.svg`). Nothing links to an outside copy at build or run time.

These are ours to edit: when a drawing needs a real fix (a path, a missing detail), change the SVG
here and note it under "Changes" below. Fixes that apply to every set — fitting, sizes, the shared
palette, baked-in shadows — happen when the sets are packed, so the drawings can stay close to
their originals.

After changing a drawing or adding a set, run:

```sh
node scripts/measure-piece-fit.mjs && pnpm generate:piece-css
```

`fit.json` is written by `measure-piece-fit.mjs`: one square viewBox per drawing for each piece
size mode.

## Authors, licences and changes

In [CREDITS.md](CREDITS.md), which ships inside every packaged build (`extraResources` in
`apps/desktop/package.json`), and each set's author and licence show in Settings → Board.
