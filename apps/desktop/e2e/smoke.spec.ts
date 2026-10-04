// Smoke journeys through the built app; how to run them: playwright.config.ts.
import { join } from "node:path";
import {
  appTarget,
  clickSquare,
  closeApp,
  expect,
  importPgnFile,
  mainRecord,
  registerFakeEngine,
  routeToFile,
  sidebar,
  skipWelcome,
  test
} from "./app";
import {
  ENDGAME_PGN,
  LICHESS_PUZZLES_URL,
  QUICK_SCAN_MATCHES,
  RUY_LOPEZ_PGN,
  writeLichessPuzzleFile,
  writePgn
} from "./fixtures";

const moveCounter = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Move navigation" }).getByRole("paragraph");

test("boots past the welcome to a board", async ({ launch }) => {
  const { app, page } = await launch();
  // The run drives what it was asked to: the packaged app, or the build in out/.
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(appTarget().packaged);
  await skipWelcome(page);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  const board = page.getByRole("region", { name: "Board" });
  await expect(board.locator("cg-board")).toBeVisible();
  await expect(board.locator("cg-board piece")).toHaveCount(32);
});

test("imports a PGN, steps through it with the keyboard, and closes a dialog with Escape", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));

  const moves = page.getByRole("tree", { name: "Game moves" });
  for (const san of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]) {
    await expect(moves.getByRole("button", { name: san, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText(/Alpha\s*vs\s*Beta/);
  await expect(moveCounter(page)).toHaveText("6 / 6");

  // The arrows step through the game once the board has focus (not a sidebar button).
  await page.getByRole("region", { name: "Board" }).click({ position: { x: 3, y: 3 } });
  await page.keyboard.press("ArrowLeft");
  await expect(moveCounter(page)).toHaveText("5 / 6");
  await page.keyboard.press("ArrowLeft");
  await expect(moveCounter(page)).toHaveText("4 / 6");
  await page.keyboard.press("ArrowRight");
  await expect(moveCounter(page)).toHaveText("5 / 6");

  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose a game" });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
});

test("keeps an edited game across a restart", async ({ launch, profile }) => {
  const first = await launch();
  await skipWelcome(first.page);
  await importPgnFile(first.app, first.page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  const moves = first.page.getByRole("tree", { name: "Game moves" });
  await expect(moves.getByRole("button", { name: "a6", exact: true })).toBeVisible();

  // The edit: delete the last move (the app asks with window.confirm, answered yes here).
  await first.page.evaluate(() => {
    window.confirm = () => true;
  });
  await moves.getByRole("button", { name: "a6", exact: true }).click();
  await moves.getByRole("button", { name: "Delete line from a6" }).click();
  await expect(moves.getByRole("button", { name: "a6", exact: true })).toHaveCount(0);
  await expect(moveCounter(first.page)).toHaveText("5 / 5");
  // Closing writes the pending autosave first (no "couldn't be saved" prompt).
  await closeApp(first.app);

  const second = await launch(profile);
  await expect(sidebar(second.page)).toBeVisible();
  await expect(second.page.getByRole("dialog", { name: "Welcome to Chaturanga" })).toHaveCount(0);
  // Back to Home, then open the game from the library.
  await sidebar(second.page).getByRole("button", { name: "Home", exact: true }).click();
  await sidebar(second.page).getByRole("button", { name: "Analyze", exact: true }).click();
  await second.page.getByRole("tab", { name: "Library" }).click();
  const library = second.page.getByRole("list", { name: "Saved games" });
  await expect(library.getByRole("button", { name: /Alpha vs Beta/ })).toHaveCount(1);
  await library.getByRole("button", { name: /Alpha vs Beta/ }).click();
  await second.page.getByRole("tab", { name: "Moves" }).click();
  const reopened = second.page.getByRole("tree", { name: "Game moves" });
  await expect(reopened.getByRole("button", { name: "Bb5", exact: true })).toBeVisible();
  await expect(reopened.getByRole("button", { name: "a6", exact: true })).toHaveCount(0);
  await expect(moveCounter(second.page)).toHaveText(/\/ 5$/);
});

test("loads a position from a FEN and plays a move from it", async ({ launch }) => {
  const { page } = await launch();
  await skipWelcome(page);
  // Game review → Choose a game → Import PGN: the paste dialog.
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: "Import PGN" })
    .click();
  const importDialog = page.getByRole("dialog", { name: "Import PGN" });
  await importDialog.getByRole("textbox", { name: "PGN text" }).fill(ENDGAME_PGN);
  await importDialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(importDialog).toBeHidden();

  const board = page.getByRole("region", { name: "Board" });
  await expect(board.locator("cg-board piece")).toHaveCount(3);
  await expect(board.locator("cg-board piece.white.pawn")).toHaveCount(1);
  await page.getByRole("tab", { name: "Moves" }).click();
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(
    page.getByRole("tree", { name: "Game moves" }).getByRole("button", { name: "e4", exact: true })
  ).toBeVisible();
  await expect(moveCounter(page)).toHaveText("1 / 1");
});

test("serves a puzzle from a local puzzle database, scanned in the worker thread", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  // The Databases page's Download, answered from a generated file instead of database.lichess.org.
  await routeToFile(app, LICHESS_PUZZLES_URL, writeLichessPuzzleFile(profile));
  await skipWelcome(page);
  await sidebar(page).getByRole("button", { name: "Databases", exact: true }).click();
  const lichess = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Lichess Puzzle Database" }) });
  await lichess.getByRole("button", { name: "Download", exact: true }).click();
  await expect(lichess.getByRole("button", { name: "Train with this dataset" })).toBeVisible({
    timeout: 30_000
  });

  await sidebar(page).getByRole("button", { name: "Puzzles", exact: true }).click();
  await page.getByRole("button", { name: "Start puzzle set" }).click();
  const puzzle = page.getByRole("region", { name: "Puzzle" });
  const title = puzzle.getByRole("heading", { level: 2 });
  // Every row a quick scan of the file's start can reach is `qA0000` (see the fixture).
  await expect(title).toHaveText("Puzzle #qA0000", { timeout: 30_000 });

  // Two scans, both in puzzle-scan-worker.js: the quick one that answered the first puzzle, and
  // the whole-file one it started, which keeps a sample of every match in the file.
  await expect
    .poll(async () => (await mainRecord(app)).workerAnswers.some((answer) => answer.complete), {
      timeout: 30_000
    })
    .toBe(true);
  const record = await mainRecord(app);
  expect(record.workers).toHaveLength(2);
  for (const file of record.workers) expect(file).toMatch(/puzzle-scan-worker\.js$/);
  const quick = record.workerAnswers.find((answer) => answer.complete === false);
  const whole = record.workerAnswers.find((answer) => answer.complete === true);
  expect(quick).toMatchObject({ ok: true, matches: QUICK_SCAN_MATCHES });
  expect(new Set(quick?.ids)).toEqual(new Set(["qA0000"]));
  expect(whole).toMatchObject({ ok: true, matches: 3000 });

  // Solve (Qxf7#) and take the next puzzle: with qA0000 shown (and so excluded), it is served from
  // the whole-file scan's sample, and is a `qB` row only that scan reached. (For the sample to hold
  // none, all 64 of its rows would have to come from the first sixth of the file: about 1 in 10^50.)
  await expect(puzzle).toContainText("0 of 1 move found");
  await clickSquare(page, "h5");
  await clickSquare(page, "f7");
  const next = page.getByRole("button", { name: "Next puzzle", exact: true });
  await expect(next).toBeVisible();
  await next.click();
  await expect(title).toHaveText(/^Puzzle #qB\d{4}$/);
  const id = (await title.textContent())?.replace("Puzzle #", "");
  expect(whole?.ids).toContain(id);
});

test("works offline: library and engine analysis without a network", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  // Also take the window's session offline, and check nothing can reach the network from either side.
  const probe = await app.evaluate(async ({ net, session }) => {
    session.defaultSession.enableNetworkEmulation({ offline: true });
    const attempt = async (call: () => Promise<Response>) => {
      try {
        return `status ${(await call()).status}`;
      } catch {
        return "refused";
      }
    };
    return {
      node: await attempt(() => fetch("https://lichess.org/api/account")),
      chromium: await attempt(() => net.fetch("https://lichess.org/api/account"))
    };
  });
  expect(probe).toEqual({ node: "refused", chromium: "refused" });

  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "fake-engine.log"));
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  await expect(
    page.getByRole("tree", { name: "Game moves" }).getByRole("button", { name: "a6", exact: true })
  ).toBeVisible();

  await page.getByRole("tab", { name: "Library" }).click();
  await expect(
    page.getByRole("list", { name: "Saved games" }).getByRole("button", { name: /Alpha vs Beta/ })
  ).toBeVisible();

  // Analysis of the start position (the fake engine's line, 1.e4 e5, is legal there).
  await page.getByRole("button", { name: "First move" }).click();
  await expect(moveCounter(page)).toHaveText("0 / 6");
  await page.getByRole("tab", { name: "Engine" }).click();
  const panel = page.getByRole("tabpanel", { name: "Engine" });
  // The Analysis switch in the tab's header row starts the engine, and stops it.
  const analysis = page
    .getByRole("complementary", { name: "Game" })
    .getByRole("switch", { name: "Analysis" });
  await expect(analysis).toHaveAttribute("aria-checked", "false");
  await analysis.click();
  await expect(analysis).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByRole("heading", { name: "Fake UCI" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Go to e4 position" })).toBeVisible({
    timeout: 15_000
  });
  await expect(panel).toContainText("+0.20");
  await analysis.click();
  await expect(analysis).toHaveAttribute("aria-checked", "false");
});
