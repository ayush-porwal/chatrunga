/**
 * What Insights hands Study (docs/repertoire-games-and-practice.md §3 "From your games banner"):
 * the banner's facts, and for an unprepared reply the move Study stages. Also how Study words the
 * health check's flags (§6.3), which the banner and the choices panel show.
 */
import type {
  RepertoireHealthFlag,
  RepertoireHealthFlagKind
} from "@chaturanga/shared/types/repertoire-health";
import { moveLabel, playUci } from "./study-staging";

/** A move with how many of the user's games played it there. */
type MoveCount = { uci: string; san: string; games: number };

export type StudyFromGames =
  /** The user left their repertoire here: what they played, and what the repertoire has. */
  | { kind: "forgot"; positionKey: string; played: MoveCount[]; expectedSans: string[] }
  /** Opponents played a reply the repertoire doesn't cover; Study stages `reply`. */
  | { kind: "unprepared"; positionKey: string; reply: MoveCount }
  /** A health-check flag, opened from Insights or the Explorer. */
  | { kind: "health"; positionKey: string; flag: RepertoireHealthFlag };

/** A flag's short name, as its badge shows it. */
export const HEALTH_FLAG_LABELS: Record<RepertoireHealthFlagKind, string> = {
  "engine-disagrees": "Weak move",
  "no-answer": "No answer",
  "common-mistake": "Trap"
};

/**
 * What a flag means, in a sentence: "6.h3: −9% win chance; the engine prefers 6.Be2.", "After
 * 5…Nf6 you have no answer.", "Players at your level play 5…e5 (23%), which loses to 6.Nxe5."
 */
export function healthFlagText(flag: RepertoireHealthFlag): string {
  const move = moveLabel(flag.fen, flag.san);
  switch (flag.kind) {
    case "engine-disagrees": {
      const loss = flag.loss === null ? "" : `: −${Math.round(flag.loss)}% win chance`;
      const best = flag.bestSan ? `; the engine prefers ${moveLabel(flag.fen, flag.bestSan)}` : "";
      return `${move}${loss}${best}.`;
    }
    case "no-answer":
      return `After ${move} you have no answer.`;
    case "common-mistake": {
      const share = flag.probability === null ? "" : ` (${Math.round(flag.probability * 100)}%)`;
      const after = playUci(flag.fen, flag.uci)?.fenAfter;
      const punishment =
        after && flag.bestSan ? `, which loses to ${moveLabel(after, flag.bestSan)}` : "";
      return `Players at your level play ${move}${share}${punishment}.`;
    }
  }
}

/** "38 games" / "1 game". */
function games(count: number): string {
  return `${count} game${count === 1 ? "" : "s"}`;
}

/**
 * The banner's sentence. `fen`: the position (numbers the moves; null words them by SAN alone).
 */
export function fromGamesText(fromGames: StudyFromGames, fen: string | null): string {
  const label = (san: string) => (fen ? moveLabel(fen, san) : san);
  switch (fromGames.kind) {
    case "forgot": {
      const played = fromGames.played.length
        ? fromGames.played
            .map((move, index) =>
              index === 0
                ? `${label(move.san)} here in ${games(move.games)}`
                : `${label(move.san)} in ${move.games}`
            )
            .join(", ")
        : "other moves here";
      const expected = fromGames.expectedSans.map(label).join(", ");
      return `From your games: you played ${played}. ${
        expected ? `Your repertoire move: ${expected}.` : "Your repertoire has no move here yet."
      }`;
    }
    case "unprepared":
      return `From your games: opponents played ${label(fromGames.reply.san)} here in ${games(
        fromGames.reply.games
      )}. It isn't covered yet; play your answer and add it.`;
    case "health":
      return healthFlagText(fromGames.flag);
  }
}
