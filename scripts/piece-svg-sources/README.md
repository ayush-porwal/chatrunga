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

## Authors and licences

Each set is its author's work under the licence below; our changes to a set are shared under that
same licence.

| Set        | Author                         | Licence                                                                                              |
| ---------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| cburnett   | Colin M.L. Burnett             | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)                                                   |
| merida     | Armando Hernandez Marroquin    | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)                                                   |
| alpha      | Eric Bentzen                   | Free for personal non-commercial use ([alpha.zip](http://www.enpassant.dk/chess/downl/alpha.zip))    |
| california | Jerry S.                       | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)                                |
| cardinal   | sadsnake1                      | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)                                |
| chessnut   | Alexis Luengas                 | [Apache 2.0](https://github.com/LexLuengas/chessnut-pieces/blob/master/LICENSE.txt)                  |
| kosal      | Kosal Sen                      | AGPLv3+ (no separate licence stated)                                                                 |
| maestro    | sadsnake1                      | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)                                |
| pirouetti  | pirouetti                      | [AGPLv3+](https://www.gnu.org/licenses/agpl-3.0.txt)                                                 |
| classic    | Colin M.L. Burnett (adapted)   | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)                                                   |
| anarcandy | caderek | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| caliente | avi | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| celtic | Maurizio Monge | MIT |
| cooke | fejfar | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| disguised | danegraphics | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| dubrovny | sadsnake1 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| fantasy | Maurizio Monge | MIT |
| firi | James Faure | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| fresca | sadsnake1 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| gioco | sadsnake1 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| horsey | cham and michael1241 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| icpieces | sadsnake1 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| kiwen-suwi | neverRare | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| letter | usolando | [AGPLv3+](https://www.gnu.org/licenses/agpl-3.0.txt) |
| minimal-warmth | blunder_reign | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| mpchess | Maxime Chupin | [GPLv3+](https://www.gnu.org/licenses/gpl-3.0.txt) |
| papercut | Nikolay Anzarov | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| pixel | therealqtpi | [AGPLv3+](https://www.gnu.org/licenses/agpl-3.0.txt) |
| rhosgfx | RhosGFX | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| shapes | flugsio | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| spatial | Maurizio Monge | MIT |
| staunty | sadsnake1 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| tatiana | sadsnake1 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| totoy | Kosal Sen | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| xkcd | Randall Munroe | [CC BY-NC-SA 2.5](https://xkcd.com/license.html) |

## Changes

- **classic**: made from `cburnett` — white pieces filled with a warm cream gradient
  (`#fdf7d6` → `#d8d3b3`), black pieces with a charcoal gradient (`#3e3f44` → `#030404`) and cream
  detail lines (`#f3edd2`). Shapes and outlines unchanged.

Every other drawing is as its author made it.
