import type { GameHeaders, GameSource, MoveNode } from "@chaturanga/shared/types/chess";
import type {
  ComparisonIssue,
  ComparisonMove,
  ComparisonMoveStatus,
  RepertoireColor,
  RepertoireComparison,
  RepertoireSummary
} from "@chaturanga/shared/types/repertoire";

/**
 * Pure rules of the game review's Opening tab (design §6.3): the game's mainline as the compare
 * input, the status line and move-token wording, the default colour and repertoire, and which
 * actions an issue offers. The comparison itself is computed by the main process.
 */

/** One mainline move of the game, with the review node it belongs to. */
export type MainlineMove = { nodeId: string; ply: number; uci: string };

/** The game's mainline (root → first child chain) as UCI, with each move's node. */
export function mainlineMoves(moveTree: readonly MoveNode[]): MainlineMove[] {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const moves: MainlineMove[] = [];
  const seen = new Set<string>();
  let node = byId.get("root");
  while (node?.children[0] && !seen.has(node.id)) {
    seen.add(node.id);
    const next = byId.get(node.children[0]);
    if (!next?.uci) break;
    moves.push({ nodeId: next.id, ply: next.ply, uci: next.uci });
    node = next;
  }
  return moves;
}

/** The move number and side of the move played from `fen` ("12." for White, "12…" for Black). */
export function moveNumberOf(fen: string): { number: number; white: boolean } {
  const fields = fen.split(" ");
  const number = Number.parseInt(fields[5] ?? "1", 10);
  return { number: Number.isFinite(number) && number > 0 ? number : 1, white: fields[1] !== "b" };
}

/** "12. Nf3" / "12… Nf6": a move's label built from the position, not the ply's parity. */
export function moveLabel(fenBefore: string, san: string): string {
  const { number, white } = moveNumberOf(fenBefore);
  return `${number}${white ? "." : "…"} ${san}`;
}

export type ComparisonTone = "accent" | "info" | "warn" | "danger" | "neutral";

export type ComparisonSummary = {
  tone: ComparisonTone;
  /** The status line (§6.3 wording). */
  text: string;
};

/** The SANs of the expected moves, the preferred one first and marked. */
function expectedList(issue: ComparisonIssue, separator: string): string {
  const entries = issue.expectedUcis.map((uci, index) => ({
    uci,
    san: issue.expectedSans[index] ?? uci
  }));
  const preferred = entries.find((entry) => entry.uci === issue.preferredUci);
  const ordered = preferred
    ? [preferred, ...entries.filter((entry) => entry !== preferred)]
    : entries;
  return ordered
    .map((entry) => (entry === preferred ? `${entry.san} (preferred)` : entry.san))
    .join(separator);
}

/** The status line of a comparison. */
export function describeComparison(comparison: RepertoireComparison): ComparisonSummary {
  const { issue, moves } = comparison;
  if (!issue) {
    const recognized = [...moves]
      .reverse()
      .find((move) => move.status === "player-choice" || move.status === "covered-reply");
    if (!recognized) {
      if (!moves.length) return { tone: "neutral", text: "This game has no moves to compare" };
      // Nothing judged yet, but the final position is where a chapter begins.
      const chapter = comparison.chaptersUsed[0];
      return chapter
        ? { tone: "info", text: `This game ends where ${chapter.title} begins` }
        : { tone: "neutral", text: "No chapter of this repertoire applies to this game" };
    }
    return {
      tone: "accent",
      text: `In repertoire through move ${moveNumberOf(recognized.fenBefore).number}`
    };
  }
  const number = moveNumberOf(issue.fenBefore).number;
  const played = issue.playedSan ?? issue.playedUci ?? "another move";
  switch (issue.status) {
    case "player-deviation":
      return {
        tone: "warn",
        text: issue.expectedUcis.length
          ? `Left your repertoire at move ${number}: you played ${played}, your repertoire has ${expectedList(issue, " / ")}`
          : `Left your repertoire at move ${number}: you played ${played}`
      };
    case "uncovered-opponent":
      return {
        tone: "danger",
        text: issue.expectedUcis.length
          ? `Uncovered reply at move ${number}: opponent played ${played}; you cover ${expectedList(issue, ", ")}`
          : `Uncovered reply at move ${number}: opponent played ${played}; no reply is covered here yet`
      };
    case "preparation-ends": {
      const index = moves.findIndex((move) => move.ply === issue.ply);
      const last = index > 0 ? moves[index - 1] : null;
      return {
        tone: "info",
        text: last
          ? `Preparation ends after move ${moveNumberOf(last.fenBefore).number}`
          : "Preparation ends before the first move"
      };
    }
    case "no-applicable-chapter":
      return { tone: "neutral", text: "No chapter of this repertoire applies to this game" };
  }
}

/** "Back in known preparation at move N (chapter)" for each return by transposition. */
export function describeReturns(comparison: RepertoireComparison): string[] {
  const byPly = new Map(comparison.moves.map((move) => [move.ply, move]));
  return comparison.returnedByTransposition.map((entry) => {
    const move = byPly.get(entry.ply);
    const number = move ? moveNumberOf(move.fenBefore).number : Math.ceil(entry.ply / 2);
    return `Back in known preparation at move ${number} (${entry.chapterTitle})`;
  });
}

export type TokenStatus = {
  tone: ComparisonTone | "subtle";
  /** What the status means, as text (title and screen-reader label; never colour alone). */
  label: string;
};

const TOKEN_STATUS: Record<ComparisonMoveStatus, TokenStatus> = {
  "outside-scope": { tone: "subtle", label: "Outside your repertoire" },
  "player-choice": { tone: "accent", label: "Your repertoire move" },
  "covered-reply": { tone: "info", label: "Covered opponent reply" },
  deviation: { tone: "warn", label: "Left your repertoire" },
  uncovered: { tone: "danger", label: "Uncovered opponent reply" },
  "after-end": { tone: "neutral", label: "After your preparation ends" },
  "transposed-back": { tone: "info", label: "Back in known preparation" }
};

/** How a move token shows its status. */
export function tokenStatus(status: ComparisonMoveStatus): TokenStatus {
  return TOKEN_STATUS[status];
}

/** The text of one move token's title: its label and what the status means. */
export function tokenTitle(move: Pick<ComparisonMove, "fenBefore" | "san" | "status">): string {
  return `${moveLabel(move.fenBefore, move.san)}: ${tokenStatus(move.status).label}`;
}

/* ------------------------------------------------------------------ colour and repertoire */

export type RememberedRepertoires = { white: string | null; black: string | null };

/** The side picked in the Opening tab for one game (a history entry keeps it for Back). */
export type OpeningSide = { gameId: string | null; color: RepertoireColor };

/**
 * The side the saved game's provenance suggests the player had, or null: a Lichess game whose
 * White/Black header is the connected account, or a local game against the engine. Only a
 * suggestion; the colour control stays visible.
 */
export function suggestedSide(input: {
  source: GameSource;
  headers: Pick<GameHeaders, "white" | "black">;
  lichessUsername: string | null;
  engineSide: RepertoireColor | null;
}): { color: RepertoireColor; hint: string } | null {
  const { source, headers, lichessUsername, engineSide } = input;
  if (source === "lichess" && lichessUsername) {
    const name = lichessUsername.toLowerCase();
    const white = headers.white?.toLowerCase() === name;
    const black = headers.black?.toLowerCase() === name;
    if (white !== black) {
      const color = white ? "white" : "black";
      return {
        color,
        hint: `You played ${color === "white" ? "White" : "Black"} in this Lichess game`
      };
    }
  }
  if (source === "engine-game" && engineSide) {
    const color = engineSide === "white" ? "black" : "white";
    return {
      color,
      hint: `You played ${color === "white" ? "White" : "Black"} against the engine`
    };
  }
  return null;
}

/**
 * The colour the Opening tab starts with (never the board orientation): the provenance suggestion,
 * else the one colour whose remembered repertoire still exists, else White.
 */
export function defaultCompareColor(
  remembered: RememberedRepertoires,
  repertoires: readonly Pick<RepertoireSummary, "id" | "color">[],
  suggestion: RepertoireColor | null
): RepertoireColor {
  if (suggestion) return suggestion;
  const exists = (color: RepertoireColor) =>
    Boolean(
      remembered[color] &&
      repertoires.some((item) => item.id === remembered[color] && item.color === color)
    );
  const white = exists("white");
  const black = exists("black");
  if (white !== black) return white ? "white" : "black";
  return "white";
}

/** The repertoire to compare against: the remembered one when it's listed, else the first. */
export function pickRepertoire<T extends Pick<RepertoireSummary, "id" | "color">>(
  repertoires: readonly T[],
  color: RepertoireColor,
  rememberedId: string | null
): T | null {
  const ofColor = repertoires.filter((item) => item.color === color);
  return ofColor.find((item) => item.id === rememberedId) ?? ofColor[0] ?? null;
}

/* ------------------------------------------------------------------ actions */

export type ComparisonAction =
  /** Opens study at the issue's chapter and node. */
  | { kind: "study"; label: string; chapterId: string; nodeId: string | null }
  /** A targeted practice queue of this decision. */
  | { kind: "refresh"; label: string; positionKey: string }
  /** Opens study at the issue's node with the played move staged. */
  | {
      kind: "stage";
      label: string;
      chapterId: string;
      nodeId: string;
      uci: string;
      edge: "covered" | "reference";
    }
  /** Focuses the repertoire picker. */
  | { kind: "choose-repertoire"; label: string }
  /** Opens the repertoire hub. */
  | { kind: "hub"; label: string };

/** The actions an issue offers (primary first). */
export function comparisonActions(issue: ComparisonIssue | null): ComparisonAction[] {
  if (!issue) return [];
  const { chapterId, nodeId, playedUci } = issue;
  const study = (label: string): ComparisonAction[] =>
    chapterId ? [{ kind: "study", label, chapterId, nodeId }] : [];
  switch (issue.status) {
    case "player-deviation":
      return [
        { kind: "refresh", label: "Refresh this decision", positionKey: issue.positionKey },
        ...(chapterId && nodeId && playedUci
          ? [
              {
                kind: "stage" as const,
                label: "Adopt played alternative",
                chapterId,
                nodeId,
                uci: playedUci,
                edge: "reference" as const
              }
            ]
          : []),
        ...study("Study this position")
      ];
    case "uncovered-opponent":
      return [
        ...(chapterId && nodeId && playedUci
          ? [
              {
                kind: "stage" as const,
                label: "Add this response",
                chapterId,
                nodeId,
                uci: playedUci,
                edge: "covered" as const
              }
            ]
          : []),
        ...study("Study this position")
      ];
    case "preparation-ends":
      return study("Study the resulting position");
    case "no-applicable-chapter":
      return [
        { kind: "choose-repertoire", label: "Choose another repertoire" },
        { kind: "hub", label: "Create a chapter from this game's start" }
      ];
  }
}

/** The first chapter used by an issue-free comparison (where "Open the chapter" goes), or null. */
export function inRepertoireTarget(
  comparison: RepertoireComparison
): { chapterId: string; nodeId: string | null } | null {
  if (comparison.issue) return null;
  const last = [...comparison.moves]
    .reverse()
    .find(
      (move) =>
        move.chapterId && (move.status === "player-choice" || move.status === "covered-reply")
    );
  return last?.chapterId ? { chapterId: last.chapterId, nodeId: last.nodeId } : null;
}
