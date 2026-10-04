// Live analysis on the Analyze board with an engine whose output is shaped like Stockfish 19's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, importPgnFile, registerFakeEngine, skipWelcome, test } from "./app";
import { writePgn } from "./fixtures";

/** Both sides castled (White short, Black long): a PGN stores castling as the king taking its rook. */
const CASTLED_PGN = `[Event "E2E castled"]
[White "Alpha"]
[Black "Beta"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O Be7 5. d3 d6 6. Nc3 Bg4 7. h3 Qd7 8. hxg4 O-O-O *
`;

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const engineCommands = (log: string) => readFileSync(log, "utf8").split("\n").filter(Boolean);

test("the Analyze board shows an imported castled game's depth, score and lines from Stockfish-shaped output", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { app, page } = await launch();
  await skipWelcome(page);
  // Like Stockfish 19, the fake quits on castling sent as the king taking its rook.
  await registerFakeEngine(page, log, "stockfish");
  await importPgnFile(app, page, writePgn(profile, "castled.pgn", CASTLED_PGN));
  const moves = page.getByRole("tree", { name: "Game moves" });
  await expect(moves.getByRole("button", { name: "O-O-O", exact: true })).toBeVisible();

  await titlebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(titlebar(page).getByRole("button", { name: "Stop analysis" })).toBeVisible();
  await page.getByRole("tab", { name: "Engine" }).click();
  const panel = page.getByRole("tabpanel", { name: "Engine" });
  await expect(panel.getByRole("heading", { name: "Fake UCI" })).toBeVisible();
  // White to move after 8... O-O-O: the fake's first line is its first legal move, Rb1.
  await expect(panel.getByRole("button", { name: "Go to Rb1 position" })).toBeVisible({
    timeout: 15_000
  });
  await expect(panel).toContainText(/Depth\s*\d+/);
  await expect(panel).toContainText(/Score\s*\+0\.35/);
  await expect(panel).toContainText(/Best\s*Rb1/);
  await expect(panel).not.toContainText("stopped with an error");

  // Both castles went to the engine as the king's two-square move.
  const position = engineCommands(log)
    .filter((line) => line.startsWith("position"))
    .at(-1);
  expect(position).toContain(" e1g1 ");
  expect(position).toMatch(/ e8c8$/);
  expect(engineCommands(log)).not.toContain("exit");
});
