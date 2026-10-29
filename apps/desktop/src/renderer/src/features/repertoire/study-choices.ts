import type { DrawShape } from "@lichess-org/chessground/draw";
import { uciSquares } from "@chaturanga/shared/chess/square";
import type { RepertoireHealthFlag } from "@chaturanga/shared/types/repertoire-health";
import { DASHED_GREEN_BRUSH } from "../board/board-shapes";
import type { MoveKind } from "./repertoire-model";
import { moveLabel } from "./study-staging";

/*
 * Study's choices panel (docs/repertoire-games-and-practice.md §3 "Choices panel") and the
 * repertoire arrows: every move the repertoire has from the selected position, across its
 * chapters (decisions are per position). Pure, so it is unit-tested directly.
 */

/** One chapter's occurrence of the position, with its continuations and their kinds. */
export type ChoiceSource = {
  chapterId: string;
  chapterTitle: string;
  /** The position's node in that chapter. */
  nodeId: string;
  moves: readonly { nodeId: string; uci: string; san: string; kind: MoveKind }[];
};

/** A move of the repertoire from the position, as the choices panel shows it. */
export type PositionChoice = {
  uci: string;
  /** As a line reads it: `4…Nc6`. */
  label: string;
  /** The strongest kind any chapter gives it: one of yours, then covered, then study-only. */
  kind: MoveKind;
  /** The preferred move of the player's (★). */
  preferred: boolean;
  /** The chapters it comes from, the open one first. */
  chapters: string[];
  /** Where it is: in the open chapter when it has it, else the first other chapter's node. */
  at: { chapterId: string; nodeId: string };
  /** The health check's flags on the move here. */
  flags: RepertoireHealthFlag[];
};

const KIND_RANK: Record<MoveKind, number> = { yours: 0, covered: 1, reference: 2 };

/**
 * The repertoire's moves from a position, merged across the chapters reaching it (`sources`, the
 * open chapter first): one row per move with its strongest kind and its chapters, the preferred
 * move (`preferredUci`, one of yours) first, then yours, covered replies and study-only moves.
 */
export function positionChoices({
  fen,
  positionKey,
  sources,
  preferredUci,
  flags
}: {
  /** The position. */
  fen: string;
  positionKey: string | null;
  sources: readonly ChoiceSource[];
  preferredUci: string | null;
  flags: readonly RepertoireHealthFlag[];
}): PositionChoice[] {
  const byUci = new Map<string, PositionChoice & { order: number }>();
  for (const source of sources) {
    for (const move of source.moves) {
      const row = byUci.get(move.uci);
      if (!row) {
        byUci.set(move.uci, {
          uci: move.uci,
          label: moveLabel(fen, move.san),
          kind: move.kind,
          preferred: false,
          chapters: [source.chapterTitle],
          at: { chapterId: source.chapterId, nodeId: move.nodeId },
          flags: flags.filter((flag) => flag.positionKey === positionKey && flag.uci === move.uci),
          order: byUci.size
        });
        continue;
      }
      if (KIND_RANK[move.kind] < KIND_RANK[row.kind]) row.kind = move.kind;
      if (!row.chapters.includes(source.chapterTitle)) row.chapters.push(source.chapterTitle);
    }
  }
  const rows = [...byUci.values()].map((row) => ({
    ...row,
    preferred: row.kind === "yours" && row.uci === preferredUci
  }));
  rows.sort(
    (left, right) =>
      Number(right.preferred) - Number(left.preferred) ||
      KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
      left.order - right.order
  );
  return rows.map(({ order: _order, ...row }) => row);
}

/**
 * The repertoire's arrows on the board for the position's choices: green for the player's moves
 * (the preferred one solid, the others dashed), blue for covered replies; study-only moves have
 * none.
 */
export function repertoireArrows(choices: readonly PositionChoice[]): DrawShape[] {
  const shapes: DrawShape[] = [];
  for (const choice of choices) {
    const squares = uciSquares(choice.uci);
    if (!squares || choice.kind === "reference") continue;
    const brush =
      choice.kind === "covered" ? "blue" : choice.preferred ? "green" : DASHED_GREEN_BRUSH;
    shapes.push({ orig: squares[0], dest: squares[1], brush });
  }
  return shapes;
}
