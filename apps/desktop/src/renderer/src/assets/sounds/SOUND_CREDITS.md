# Sound credits

The board's sounds in Chaturanga are the work of the authors below, under the licences listed.
Chaturanga itself is GPL-3.0-or-later. The full texts of the GPL and AGPL are in
`piece-set-licenses` beside this file in the app (`scripts/piece-svg-sources/licenses/` in the
repository).

| Set (Settings → Sound) | Folder        | Author                                                                        | Licence                                               | Source                                     |
| ---------------------- | ------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Lichess SFX            | `sfx/`        | [Enigmahack](https://github.com/Enigmahack)                                   | [AGPLv3+](https://www.gnu.org/licenses/agpl-3.0.html) | lichess-org/lila `public/sound/sfx`        |
| Lichess Piano          | `piano/`      | [Enigmahack](https://github.com/Enigmahack)                                   | [AGPLv3+](https://www.gnu.org/licenses/agpl-3.0.html) | lichess-org/lila `public/sound/piano`      |
| Lichess NES            | `nes/`        | [Enigmahack](https://github.com/Enigmahack)                                   | [AGPLv3+](https://www.gnu.org/licenses/agpl-3.0.html) | lichess-org/lila `public/sound/nes`        |
| Lichess Futuristic     | `futuristic/` | [Enigmahack](https://github.com/Enigmahack)                                   | [AGPLv3+](https://www.gnu.org/licenses/agpl-3.0.html) | lichess-org/lila `public/sound/futuristic` |
| PyChess                | `pychess/`    | [The PyChess authors](https://github.com/pychess/pychess/blob/master/AUTHORS) | [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html)    | pychess/pychess `sounds/`                  |

## Lichess sets (Enigmahack)

Taken unchanged (mp3) from [lichess-org/lila](https://github.com/lichess-org/lila) at commit
`b93a19b019dc28b279050097243931eef53c343c`, whose `COPYING.md` lists `public/sound/futuristic`,
`nes`, `piano` and `sfx` by Enigmahack under AGPLv3+. Each set ships `Move`, `Capture`, `Check`,
`Victory`, `Defeat`, `Draw`, `GenericNotify` (a game's start, a solved puzzle) and `LowTime`.

These sounds are free software: you can redistribute them and/or modify them under the terms of
the GNU Affero General Public License as published by the Free Software Foundation, either version
3 of the License, or (at your option) any later version. They are distributed in the hope that
they will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for
more details. Their source is the repository and commit named above.

Lichess's other sounds (standard, robot, woodland, instrument) are listed there as non-free, and
lisp is CC BY-NC-SA; none of them is shipped.

## PyChess

From [pychess/pychess](https://github.com/pychess/pychess) at commit
`94771355c49a04c3e8fc16dd135fe8ceed78a277` (GPLv3, its `LICENSE`): `move1`, `capture1`, `castle`,
`check1`, `start1`, `win1`, `lose1`, `draw1` and `invalid`, converted from the repository's WAV
files to mono 44.1 kHz mp3 (ffmpeg, libmp3lame 96 kb/s), otherwise unchanged.

PyChess's `alarm` (a Wikimedia Commons recording by Bidgee) and `success` (Freesound #242501 by
Gabriel Araujo) come from elsewhere, and PyChess doesn't state their licences, so they are not
shipped.
