/**
 * The live coach demo: the explanation of 10...cxb5 from Morphy's Opera game, where the moves in
 * the text play out on the board, as they do in the app's Commentary tab.
 */

type Square = string; // "e4"
type Position = Record<string, Square>; // piece id -> square; the id starts with its sprite, e.g. "wN-b1"

type LineId = "game" | "bxb5" | "qb4";

type Line = {
  position: Position;
  lastMove: [Square, Square];
  /** Board label for screen readers. */
  label: string;
  /** Shown in "Exploring … from 10… cxb5"; empty for the game itself. */
  san: string;
};

/** After 10.Nxb5 (the position before the move under review). Ids are stable across lines. */
const BEFORE: Position = {
  "wK-e1": "e1", "wQ-b3": "b3", "wR-a1": "a1", "wR-h1": "h1", "wB-c4": "c4", "wB-g5": "g5", "wN-b5": "b5",
  "wP-a2": "a2", "wP-b2": "b2", "wP-c2": "c2", "wP-e4": "e4", "wP-f2": "f2", "wP-g2": "g2", "wP-h2": "h2",
  "bK-e8": "e8", "bQ-e7": "e7", "bR-a8": "a8", "bR-h8": "h8", "bB-f8": "f8", "bN-b8": "b8", "bN-f6": "f6",
  "bP-a7": "a7", "bP-c6": "c6", "bP-e5": "e5", "bP-f7": "f7", "bP-g7": "g7", "bP-h7": "h7"
};

function play(from: Position, moves: [string, Square][], captures: string[] = []): Position {
  const next: Position = { ...from };
  for (const id of captures) delete next[id];
  for (const [id, to] of moves) next[id] = to;
  return next;
}

const GAME = play(BEFORE, [["bP-c6", "b5"]], ["wN-b5"]);

const LINES: Record<LineId, Line> = {
  game: { position: GAME, lastMove: ["c6", "b5"], label: "Board after 10…cxb5, the move under review", san: "" },
  bxb5: {
    position: play(GAME, [["wB-c4", "b5"]], ["bP-c6"]),
    lastMove: ["c4", "b5"],
    label: "Board after 11.Bxb5+, the bishop recaptures with check",
    san: "11. Bxb5+"
  },
  qb4: {
    position: play(BEFORE, [["bQ-e7", "b4"]]),
    lastMove: ["e7", "b4"],
    label: "Board after 10…Qb4+ instead, the queen checks from b4",
    san: "10… Qb4+"
  }
};

/** Column and row on screen, White at the bottom. */
function xy(square: Square): { x: number; y: number } {
  return { x: square.charCodeAt(0) - 97, y: 8 - Number(square[1]) };
}

function place(el: HTMLElement, square: Square): void {
  const { x, y } = xy(square);
  el.style.setProperty("--x", String(x));
  el.style.setProperty("--y", String(y));
}

function drawCoordinates(board: HTMLElement): void {
  const files = "abcdefgh";
  for (let i = 0; i < 8; i++) {
    const rank = document.createElement("span");
    // a8 is a light square, so even ranks start light and odd ranks dark.
    const rankOnLight = (8 - i) % 2 === 0;
    rank.className = `coord coord-rank ${rankOnLight ? "coord-on-light" : "coord-on-dark"}`;
    rank.style.top = `calc(${i * 12.5}% + 3px)`;
    rank.textContent = String(8 - i);
    board.append(rank);

    const file = document.createElement("span");
    const fileOnLight = i % 2 === 1; // a1 is dark
    file.className = `coord coord-file ${fileOnLight ? "coord-on-light" : "coord-on-dark"}`;
    file.style.right = "auto";
    file.style.left = `calc(${(i + 1) * 12.5}% - 1.1em)`;
    file.textContent = files[i];
    board.append(file);
  }
}

export function initCoach(root: Document = document): void {
  const demo = root.querySelector<HTMLElement>("[data-coach]");
  const found = demo?.querySelector<HTMLElement>("[data-board]");
  if (!demo || !found) return;
  const board: HTMLElement = found;

  const variation = demo.querySelector<HTMLElement>("[data-variation]");
  const variationLine = demo.querySelector<HTMLElement>("[data-variation-line]");
  const back = demo.querySelector<HTMLButtonElement>("[data-back]");
  const announce = root.querySelector<HTMLElement>("[data-announce]");
  const buttons = [...demo.querySelectorAll<HTMLButtonElement>("button[data-line]")];

  const lastSquares = [0, 1].map(() => {
    const sq = document.createElement("div");
    sq.className = "sq sq-last";
    board.append(sq);
    return sq;
  });
  drawCoordinates(board);

  const pieces = new Map<string, HTMLElement>();
  for (const [id, square] of Object.entries(BEFORE)) {
    const el = document.createElement("div");
    el.className = `pc pc-${id.slice(0, 2)}`;
    place(el, square);
    board.append(el);
    pieces.set(id, el);
  }

  let current: LineId | null = null;

  function show(id: LineId): void {
    if (id === current) return;
    const line = LINES[id];
    const first = current === null;

    for (const [pieceId, el] of pieces) {
      const to = line.position[pieceId];
      const wasGone = el.classList.contains("is-gone");
      if (!to) {
        if (first) el.style.transition = "none";
        el.classList.add("is-gone");
        el.classList.remove("is-moving");
        if (first) {
          void el.offsetWidth;
          el.style.transition = "";
        }
        continue;
      }
      const from = el.style.getPropertyValue("--x") + el.style.getPropertyValue("--y");
      const target = xy(to);
      const moving = !wasGone && from !== `${target.x}${target.y}`;
      el.classList.toggle("is-moving", moving);
      if (wasGone || first) {
        // A captured piece comes back where it stood: jump there, then fade in.
        el.style.transition = "none";
        place(el, to);
        void el.offsetWidth;
        el.style.transition = "";
      } else {
        place(el, to);
      }
      el.classList.remove("is-gone");
    }
    place(lastSquares[0], line.lastMove[0]);
    place(lastSquares[1], line.lastMove[1]);

    board.setAttribute("aria-label", line.label);
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.line === id));
    if (variation && variationLine) {
      variation.hidden = id === "game";
      variationLine.textContent = line.san;
    }
    if (announce && !first) announce.textContent = line.label;
    current = id;
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const id = button.dataset.line as LineId;
      show(current === id ? "game" : id);
    });
  }
  back?.addEventListener("click", () => {
    show("game");
    // The Back button disappears with the notice; keep focus in the explanation.
    buttons[0]?.focus();
  });

  show("game");
}
