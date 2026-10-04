import { createHash } from "node:crypto";
import type { GameHeaders, MoveNode } from "@chaturanga/shared/types/chess";

/**
 * What makes two library games "the same game", so importing one the library already has opens
 * that copy instead of adding another: its Lichess game (the URL in Site), or else its starting
 * position, main-line moves, players and date. Moves alone aren't enough: short games repeat.
 * Case, spacing, PGN "?" placeholders and annotations (variations, comments) don't matter.
 * Null for a game with nothing identifying it (no players, no date, no Lichess game): two such
 * games with the same moves can be unrelated, so they're never taken for one another.
 */
export function gameFingerprint(input: {
  headers: Pick<GameHeaders, "site" | "white" | "black" | "date">;
  rootFen: string;
  moveTree: readonly MoveNode[];
}): string | null {
  const lichess = lichessGameId(input.headers.site);
  if (lichess) return `lichess:${lichess}`;
  const who = [
    normalized(input.headers.white),
    normalized(input.headers.black),
    normalized(input.headers.date)
  ];
  if (who.every((part) => !part)) return null;
  const moves = mainlineUcis(input.moveTree);
  const parts = [input.rootFen.trim(), moves.join(" "), ...who];
  return `game:${createHash("sha256").update(parts.join("\n")).digest("hex")}`;
}

/** The Lichess game id in a game URL (`https://lichess.org/abcd1234`, also `/abcd1234/black`). */
export function lichessGameId(site: string | null | undefined): string | null {
  const match =
    /^https?:\/\/(?:www\.)?lichess\.org\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#].*)?$/.exec(
      site?.trim() ?? ""
    );
  return match?.[1] ?? null;
}

function normalized(value: string | null | undefined): string {
  const text = (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  // PGN's unknown values: "?", "????.??.??".
  return /^[?.\s]*$/.test(text) ? "" : text;
}

function mainlineUcis(moveTree: readonly MoveNode[]): string[] {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const ucis: string[] = [];
  let node = moveTree.find((item) => item.parentId === null);
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const next = node.children[0] ? byId.get(node.children[0]) : undefined;
    if (next?.uci) ucis.push(next.uci);
    node = next;
  }
  return ucis;
}
