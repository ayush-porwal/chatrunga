import { describe, expect, it } from "vitest";
import type { StreamedGame } from "../../stores/broadcast-store";
import { alertMessage, endedAlerts } from "./game-alerts";

const ALERT = { roundId: "Round001", white: "GM Carlsen", black: "GM Gukesh" };

const streamed = (id: string, result: StreamedGame["result"]) => ({ id, result }) as StreamedGame;

describe("game-end alerts", () => {
  it("fires once, when a game with an alert goes from in progress to a result", () => {
    const alerts = { Game0001: ALERT, Game0002: ALERT };
    const before = { Game0001: streamed("Game0001", "*"), Game0002: streamed("Game0002", "*") };
    const after = { ...before, Game0001: streamed("Game0001", "1-0") };
    expect(endedAlerts(alerts, after, before)).toStrictEqual([
      { gameId: "Game0001", alert: ALERT, result: "1-0" }
    ]);
    // Seen ended already (a stream sending every game anew): no second alert.
    expect(endedAlerts(alerts, after, after)).toStrictEqual([]);
    // The bell rung from the round summary, and the game's first streamed sighting is its end.
    expect(endedAlerts({ Game0001: ALERT }, after, {})).toStrictEqual([
      { gameId: "Game0001", alert: ALERT, result: "1-0" }
    ]);
    expect(alertMessage(ALERT, "½-½")).toStrictEqual({
      title: "GM Carlsen – GM Gukesh",
      body: "Game over: ½–½"
    });
  });
});
