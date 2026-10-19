// Live analysis on the Analyze board, and an engine game, with an engine whose output is shaped
// like Stockfish 19's (and with one that quits during a search).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  clickSquare,
  expect,
  importPgnFile,
  registerFakeEngine,
  sidebar,
  skipWelcome,
  test
} from "./app";
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
/**
 * What the app reports when the engine (the fake in "stockfish-crash" mode) dies during a search.
 * Killed, it ends by a signal on macOS and Linux (no exit code to name) and with exit code 1 on
 * Windows, which the message names.
 */
const CRASHED = /Fake UCI quit during the search( \(exit \d+\))?\./;

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
  // The game shows on the Analyze page: the sidebar's Analyze is current with the switch off too.
  const analyzeItem = sidebar(page).getByRole("button", { name: "Analyze", exact: true });
  await expect(analyzeItem).toHaveAttribute("aria-pressed", "true");

  // Live analysis starts with the switch in the Moves tab's engine row (the titlebar has no Analyze
  // of its own).
  const analysis = page.getByRole("switch", { name: "Analysis" });
  await expect(analysis).toHaveAttribute("aria-checked", "false");
  await expect(analyzeItem).toHaveAttribute("aria-pressed", "true");
  await analysis.click();
  await expect(analysis).toHaveAttribute("aria-checked", "true");
  await expect(analyzeItem).toHaveAttribute("aria-pressed", "true");
  await expect(titlebar(page).getByRole("button", { name: "Stop analysis" })).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Engine" });
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

test("the Analysis switch off pauses: the lines stay, on another move too, and on again resumes from them", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "stockfish");
  await importPgnFile(app, page, writePgn(profile, "castled.pgn", CASTLED_PGN));
  const moves = page.getByRole("tree", { name: "Game moves" });
  await expect(moves.getByRole("button", { name: "O-O-O", exact: true })).toBeVisible();

  const analysis = page.getByRole("switch", { name: "Analysis" });
  const panel = page.getByRole("region", { name: "Engine" });
  // White to move after 8... O-O-O: the fake's first line is Rb1.
  const rb1 = panel.getByRole("button", { name: "Go to Rb1 position" });
  await analysis.click();
  await expect(rb1).toBeVisible({ timeout: 15_000 });

  // Off: paused, the lines and the Depth / Score / Best strip stay as they were.
  await analysis.click();
  await expect(analysis).toHaveAttribute("aria-checked", "false");
  await expect(panel).toContainText(/Paused at depth \d+/);
  await expect(rb1).toBeVisible();
  await expect(panel).toContainText(/Best\s*Rb1/);
  await expect(panel).toContainText(/Score\s*\+0\.35/);
  // The engine was stopped (its process stays warm for the switch on again).
  await expect.poll(() => engineCommands(log).at(-1)).toBe("stop");

  // Another move: still paused, with the paused position's lines.
  await moves.getByRole("button", { name: "hxg4", exact: true }).click();
  await expect(panel).toContainText("Paused · after 8… O-O-O");
  await expect(rb1).toBeVisible();
  await expect(panel).toContainText(/Best\s*Rb1/);

  // Back on it and switched on: the search resumes from its lines, which never go meanwhile.
  await moves.getByRole("button", { name: "O-O-O", exact: true }).click();
  await expect(panel).toContainText(/Paused at depth \d+/);
  await page.evaluate(() => {
    const flags = window as unknown as { linesEmptied?: boolean };
    flags.linesEmptied = false;
    const region = document.querySelector('[aria-label="Engine"]')!;
    new MutationObserver(() => {
      if (!region.querySelector('[aria-label="Go to Rb1 position"]')) flags.linesEmptied = true;
    }).observe(region, { subtree: true, childList: true, characterData: true });
  });
  await analysis.click();
  await expect(analysis).toHaveAttribute("aria-checked", "true");
  await expect(panel).toContainText("Analysing");
  await expect(rb1).toBeVisible();
  await expect(panel).toContainText(/Depth\s*\d+/);
  expect(
    await page.evaluate(() => (window as unknown as { linesEmptied?: boolean }).linesEmptied)
  ).toBe(false);
});

test("an engine that dies during live analysis ends the search, and Restart searches again", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "stockfish-crash");
  await importPgnFile(app, page, writePgn(profile, "castled.pgn", CASTLED_PGN));
  await expect(
    page
      .getByRole("tree", { name: "Game moves" })
      .getByRole("button", { name: "O-O-O", exact: true })
  ).toBeVisible();

  await page.getByRole("switch", { name: "Analysis" }).click();
  const panel = page.getByRole("region", { name: "Engine" });
  // Its lines up to the crash stay; the search shows as ended, not running.
  await expect(panel.getByText(CRASHED)).toBeVisible({ timeout: 15_000 });
  await expect(panel).toContainText("The engine stopped with an error");
  await expect(panel.getByRole("button", { name: "Go to Rb1 position" })).toBeVisible();
  // No search runs: Restart is offered (the Analysis switch stays on: analysis is still wanted).
  await expect(
    page.getByRole("complementary", { name: "Game" }).getByRole("switch", { name: "Analysis" })
  ).toHaveAttribute("aria-checked", "true");
  const spawns = () => engineCommands(log).filter((line) => line === "spawn").length;
  expect(spawns()).toBe(1);

  await panel.getByRole("button", { name: "Restart analysis from scratch" }).click();
  await expect.poll(spawns).toBe(2);
  await expect(panel.getByText(CRASHED)).toBeVisible();
  await expect(panel).toContainText("The engine stopped with an error");
});

test("an engine that dies during an engine game stops its clock and says so", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "stockfish-crash");
  await sidebar(page).getByRole("button", { name: "Play", exact: true }).click();
  // Play is current, not Analyze (nor once the game's board shows).
  const analyzeItem = sidebar(page).getByRole("button", { name: "Analyze", exact: true });
  await expect(sidebar(page).getByRole("button", { name: "Play", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(analyzeItem).not.toHaveAttribute("aria-pressed");
  // A clock (the time control slider's first timed stop, from no clock), then Start as White.
  const timeControl = page.getByRole("slider");
  await timeControl.focus();
  await timeControl.press("ArrowRight");
  await page.getByRole("button", { name: "Start game", exact: true }).click();

  // 1. e4, then Black (the engine) is to move: its search dies, and its clock stops instead of
  // running out.
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(page.getByText(CRASHED).first()).toBeVisible({ timeout: 15_000 });
  await expect(analyzeItem).not.toHaveAttribute("aria-pressed");
  expect(engineCommands(log).some((line) => line.startsWith("go wtime"))).toBe(true);
  const blackClock = page.getByRole("timer", { name: "Black clock" });
  await expect(blackClock).toBeVisible();
  await expect(blackClock).not.toHaveAttribute("data-running", "true");
  await expect(page.getByRole("timer", { name: "White clock" })).not.toHaveAttribute(
    "data-running",
    "true"
  );
});

test("an engine game in progress shows its opponent's row but none of its search until it is decided", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { page } = await launch();
  await skipWelcome(page);
  // The fake answers every engine-game search with 1. Nf3 (a line scored +0.30): the engine is White.
  await registerFakeEngine(page, log, "stockfish");
  await sidebar(page).getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Switch colours" }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();

  const moves = page.getByRole("tree", { name: "Game moves" });
  await expect(moves.getByRole("button", { name: "Nf3", exact: true })).toBeVisible({
    timeout: 15_000
  });
  const panel = page.getByRole("region", { name: "Engine" });
  await expect(panel.getByRole("heading", { name: "Fake UCI" })).toBeVisible();
  // Its score, best move and line would be outside help.
  await expect(panel).not.toContainText(/Depth|Score|Best/);
  await expect(panel.getByRole("button", { name: /^Go to / })).toHaveCount(0);

  await page.getByRole("button", { name: "Resign" }).click();
  // Decided, its Depth / Score / Best strip is back.
  await expect(panel).toContainText(/Depth.*Score.*Best/);
});
