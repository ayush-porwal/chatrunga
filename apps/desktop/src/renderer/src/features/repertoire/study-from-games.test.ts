import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { RepertoireHealthFlag } from "@chaturanga/shared/types/repertoire-health";
import { fromGamesText, healthFlagText } from "./study-from-games";
import { playUcis } from "./study-staging";

/** The position after `ucis` from the start. */
const after = (...ucis: string[]) => playUcis(START_FEN, ucis)!.at(-1)!.fenAfter;

const flag = (patch: Partial<RepertoireHealthFlag>): RepertoireHealthFlag => ({
  repertoireId: "r1",
  positionKey: "k",
  fen: START_FEN,
  kind: "no-answer",
  uci: "e2e4",
  san: "e4",
  bestUci: null,
  bestSan: null,
  loss: null,
  probability: null,
  rating: null,
  line: "",
  chapterId: "c1",
  nodeId: "root",
  revision: 1,
  checkedAt: 0,
  ...patch
});

describe("the From your games banner", () => {
  const fen = after("e2e4", "c7c6", "d2d4", "d7d5", "e4e5");

  it("says what you played instead of your repertoire move", () => {
    expect(
      fromGamesText(
        {
          kind: "forgot",
          positionKey: "k",
          played: [
            { uci: "c8f5", san: "Bf5", games: 38 },
            { uci: "g8f6", san: "Nf6", games: 6 }
          ],
          expectedSans: ["Nc6"]
        },
        fen
      )
    ).toBe(
      "From your games: you played 3…Bf5 here in 38 games, 3…Nf6 in 6. Your repertoire move: 3…Nc6."
    );
  });

  it("names a reply you aren't prepared for, by SAN alone without the position", () => {
    expect(
      fromGamesText(
        { kind: "unprepared", positionKey: "k", reply: { uci: "e4e5", san: "e5", games: 1 } },
        null
      )
    ).toBe(
      "From your games: opponents played e5 here in 1 game. It isn't covered yet; play your answer and add it."
    );
  });

  it("explains a health flag", () => {
    expect(
      fromGamesText({ kind: "health", positionKey: "k", flag: flag({ kind: "no-answer" }) }, null)
    ).toBe("After 1.e4 you have no answer.");
  });
});

describe("health flags in words", () => {
  it("gives the loss and the engine's move for a weak move", () => {
    expect(
      healthFlagText(
        flag({
          kind: "engine-disagrees",
          uci: "h2h3",
          san: "h3",
          bestUci: "e2e4",
          bestSan: "e4",
          loss: 9.4
        })
      )
    ).toBe("1.h3: −9% win chance; the engine prefers 1.e4.");
  });

  it("gives Maia's share and the punishment for their common mistake", () => {
    const fen = after("e2e4", "e7e5", "g1f3");
    expect(
      healthFlagText(
        flag({
          kind: "common-mistake",
          fen,
          uci: "f7f6",
          san: "f6",
          bestUci: "f3e5",
          bestSan: "Nxe5",
          probability: 0.23
        })
      )
    ).toBe("Players at your level play 2…f6 (23%), which loses to 3.Nxe5.");
  });
});
