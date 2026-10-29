/** What practice says about a move (docs/repertoire-games-and-practice.md §4 Session). Pure. */
import type { PracticeAnswer } from "@chaturanga/shared/types/repertoire";
import { moveNumberOf, sanOf } from "./repertoire-model";

/** A move as the session's messages name it: "1.e4", "1…e5". */
export function moveLabel(fen: string, uci: string): string {
  const { fullmove, white } = moveNumberOf(fen);
  return `${fullmove}${white ? "." : "…"}${sanOf(fen, uci)}`;
}

/** The move an answer shows first: the preferred one, else the first accepted. */
function shownMove(answer: Pick<PracticeAnswer, "ucis" | "preferredUci">): string | null {
  return answer.preferredUci && answer.ucis.includes(answer.preferredUci)
    ? answer.preferredUci
    : (answer.ucis[0] ?? null);
}

/** "Not 1…e5. Your move here is 1…c6. Play it to continue." after a move outside the repertoire. */
export function wrongMoveText(
  fen: string,
  playedUci: string,
  answer: Pick<PracticeAnswer, "ucis" | "preferredUci">
): string {
  const move = shownMove(answer);
  const played = `Not ${moveLabel(fen, playedUci)}.`;
  return move
    ? `${played} Your move here is ${moveLabel(fen, move)}. Play it to continue.`
    : `${played} Play your move to continue.`;
}

/** First sight: "New position: your move is 4…Nc6." */
export function firstSightText(fen: string, uci: string): string {
  return `New position: your move is ${moveLabel(fen, uci)}.`;
}
