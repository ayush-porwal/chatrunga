// Study's engine panel (Analyze) through the built app, on the fake UCI engine in its "lines" mode
// (three lines that fit each position of the seeded chapter); how to run them: playwright.config.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { expect, importPgnFile, registerFakeEngine, sidebar, skipWelcome, test } from "./app";
import { RUY_LOPEZ_PGN, writePgn } from "./fixtures";

const REPERTOIRE = "Engine repertoire e2e";

/**
 * A path prefix for the journey's screenshots of the open panel (`<prefix>-1280x800.png`, …;
 * unset: none are taken).
 */
const SCREENSHOT = process.env.CHATURANGA_E2E_ENGINE_PANEL_SCREENSHOT;
/** The same for Study's actions with the panel closed (`<prefix>-1280x800.png`, …). */
const ACTIONS_SCREENSHOT = process.env.CHATURANGA_E2E_STUDY_ACTIONS_SCREENSHOT;

/**
 * Resizes the page to `width`×`height` (the window's content) and waits for it to lay out again.
 * Returns the size it got. On a screen too small for that (e.g. a CI display) the window stays a
 * few pixels inside the work area: Chromium on X11 shrinks a window that would fill the screen
 * exactly by a pixel, so a window sized to the screen never reaches the size asked for.
 */
async function resizeWindow(app: ElectronApplication, page: Page, width: number, height: number) {
  const size = await app.evaluate(
    ({ BrowserWindow, screen }, [width, height]) => {
      const area = screen.getPrimaryDisplay().workAreaSize;
      const margin = 8;
      const fitted = [
        Math.min(width, area.width - margin),
        Math.min(height, area.height - margin)
      ] as const;
      BrowserWindow.getAllWindows()[0]!.setContentSize(...fitted);
      return fitted;
    },
    [width, height] as const
  );
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual(size);
  return size;
}

/**
 * The locator's box once it has stopped changing: the same in two reads a quarter second apart
 * (the board and the side panel lay out again over a few frames after a resize). Two reads taken
 * back to back could both catch the layout mid-change.
 */
async function settledBox(locator: Locator) {
  let last: string | undefined;
  let box: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  await expect
    .poll(
      async () => {
        box = await locator.boundingBox();
        const read = JSON.stringify(box);
        const same = box !== null && read === last;
        last = read;
        return same;
      },
      { intervals: [250] }
    )
    .toBe(true);
  return box!;
}

/**
 * How the engine panel and the move tree share the side panel: the panel's own box against its
 * content (nothing cut off), each line row inside it, and the tree's visible height.
 */
function studyPanelLayout(page: Page) {
  return page.evaluate(() => {
    const engine = document.querySelector('[aria-label="Engine analysis"]')!;
    const box = engine.getBoundingClientRect();
    const scroller = engine.firstElementChild as HTMLElement;
    const rows = [...engine.querySelectorAll("li")].map((row) => row.getBoundingClientRect());
    const tree = document.querySelector('[role="tree"][aria-label="Chapter moves"]')!;
    return {
      engineOverflow: scroller.scrollHeight - scroller.clientHeight,
      rowsInside:
        rows.length === 3 && rows.every((row) => row.top >= box.top && row.bottom <= box.bottom),
      treeHeight: tree.getBoundingClientRect().height
    };
  });
}

/** A White repertoire whose chapter is 1. e4 e5 2. Nf3 Nc6 3. Bc4, opened by "Study" at its start. */
function seedRepertoire(page: Page) {
  return page.evaluate(async (name) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const created = await api.create({ name, color: "white" });
    const preview = await api.previewImport({
      pgn: '[Event "Italian"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 *'
    });
    const imported = await api.commitImport({
      repertoireId: created.id,
      jobId: preview.jobId,
      expectedRevision: created.revision,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: "Italian",
        kind: "opening" as const,
        include: true
      }))
    });
    const chapter = imported.repertoire.chapters.find((item) => item.nodeCount > 0)!;
    await api.saveWorkspace({
      repertoireId: created.id,
      workspace: {
        lastChapterId: chapter.id,
        lastNodeId: "root",
        orientation: "white",
        practiceDraft: null
      }
    });
  }, REPERTOIRE);
}

const studyPanel = (page: Page) => page.getByRole("complementary", { name: "Repertoire study" });
/** Analyze and Play from here: icons in the side panel's status row, on the selected position. */
const positionActions = (page: Page) => page.getByRole("group", { name: "Position actions" });
const enginePanel = (page: Page) =>
  studyPanel(page).getByRole("region", { name: "Engine analysis" });
const chapterMoves = (page: Page) => page.getByRole("tree", { name: "Chapter moves" });
const addLine = (page: Page, san: string) =>
  enginePanel(page).getByRole("button", {
    name: `Add the line to ${san} to the chapter`,
    exact: true
  });

/** The process id of the fake engine started last (it logs `pid <id>` as it starts). */
function enginePid(log: string): number {
  const line = engineCommands(log)
    .filter((entry) => entry.startsWith("pid "))
    .at(-1);
  if (!line) throw new Error("the fake engine never started");
  return Number(line.slice("pid ".length));
}

/** Whether a process with this id is running (signal 0 only checks; it works on Windows too). */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, but as someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The UCI commands the fake engine received, in order. */
function engineCommands(log: string): string[] {
  try {
    return readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

test("Analyze runs the engine in study: its lines follow the selection, a picked move joins the chapter and Undo takes it back", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "lines");
  await seedRepertoire(page);
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await page.getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(chapterMoves(page)).toBeVisible();
  const board = page.getByRole("region", { name: "Board" }).locator("cg-board");

  // Analyze and Play from here are icons in the side panel's status row, acting on the selected
  // position, and the chapter's Rehearse and Practice share one row under the moves.
  await expect(studyPanel(page).getByRole("group", { name: "Position actions" })).toBeVisible();
  const analyze = positionActions(page).getByRole("button", { name: "Analyze", exact: true });
  await analyze.hover();
  await expect(page.getByRole("tooltip")).toContainText("Analyze this position with the engine");
  const rehearse = studyPanel(page).getByRole("button", { name: "Rehearse this chapter" });
  const practise = studyPanel(page).getByRole("button", { name: "Practice this chapter" });
  for (const [width, height] of [
    [1680, 1050],
    [1280, 800]
  ] as const) {
    const [shownWidth, shownHeight] = await resizeWindow(app, page, width, height);
    // Both read once the layout has settled, so neither is compared against a stale box.
    const rehearseBox = await settledBox(rehearse);
    const practiseBox = await settledBox(practise);
    expect(rehearseBox.y).toBe(practiseBox.y);
    if (ACTIONS_SCREENSHOT) {
      await page.screenshot({ path: `${ACTIONS_SCREENSHOT}-${shownWidth}x${shownHeight}.png` });
    }
  }
  await page.mouse.move(0, 0);
  const boardBox = await settledBox(board);

  // Analyze opens the panel in place (no other screen) with the start position's lines and the bar.
  await expect(analyze).toHaveAttribute("aria-expanded", "false");
  await expect(analyze).toHaveAttribute("aria-pressed", "false");
  await analyze.click();
  await expect(analyze).toHaveAttribute("aria-expanded", "true");
  await expect(analyze).toHaveAttribute("aria-pressed", "true");
  await expect(enginePanel(page)).toBeVisible();
  await expect(enginePanel(page).getByRole("heading", { name: "Fake UCI" })).toBeVisible({
    timeout: 15_000
  });
  await expect(addLine(page, "e4")).toBeVisible();
  await expect(addLine(page, "d4")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Evaluation / })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Moves", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  // The board keeps its size with the panel and bar open.
  await expect.poll(() => board.boundingBox()).toEqual(boardBox);
  // The engine searched the chapter's position (from its root, with its moves).
  expect(engineCommands(log)).toContain(
    "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  );

  // Selecting another move searches that one: the lines follow.
  await chapterMoves(page).getByRole("button", { name: "Bc4", exact: true }).click();
  await expect(addLine(page, "Nf6")).toBeVisible();
  await expect(addLine(page, "Bc5")).toBeVisible();
  await expect(addLine(page, "Be7")).toBeVisible();
  await expect(addLine(page, "e4")).toHaveCount(0);
  expect(engineCommands(log).at(-2)).toBe(
    "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4 e7e5 g1f3 b8c6 f1c4"
  );

  // In a 1280×800 window and a large one, the three lines show in full above a usable move tree.
  for (const [width, height] of [
    [1280, 800],
    [1680, 1050]
  ] as const) {
    const [shownWidth, shownHeight] = await resizeWindow(app, page, width, height);
    await expect
      .poll(() => studyPanelLayout(page))
      .toMatchObject({
        engineOverflow: 0,
        rowsInside: true
      });
    expect((await studyPanelLayout(page)).treeHeight).toBeGreaterThanOrEqual(90);
    if (SCREENSHOT) {
      await page.screenshot({ path: `${SCREENSHOT}-${shownWidth}x${shownHeight}.png` });
    }
  }
  await resizeWindow(app, page, 1280, 800);
  await expect.poll(() => board.boundingBox()).toEqual(boardBox);

  // An unfolded line's move shows its position beside the side panel (over the board's edge,
  // level with the lines), without the line repeated there.
  await enginePanel(page).getByRole("button", { name: "Show the whole line" }).first().click();
  await addLine(page, "d3").first().hover();
  const preview = page.getByRole("group", { name: /^Position after / });
  await expect(preview).toBeVisible();
  await expect(preview.locator("cg-board")).toBeVisible();
  await expect(preview).toContainText("Line score");
  await expect(preview).not.toContainText("Nf6");
  await expect(preview).not.toContainText("d3");
  // It never grows the panel or covers the moves and their Undo / Redo under it.
  expect(await studyPanelLayout(page)).toMatchObject({ engineOverflow: 0, rowsInside: true });
  const previewBox = (await preview.boundingBox())!;
  const panelBox = (await studyPanel(page).boundingBox())!;
  expect(previewBox.x + previewBox.width).toBeLessThan(panelBox.x);
  if (SCREENSHOT) await page.screenshot({ path: `${SCREENSHOT}-preview.png` });

  // Moving off the lines takes the preview away.
  await page.mouse.move(0, 0);
  await expect(preview).toHaveCount(0);

  // Picking an engine move adds it to the chapter at the selected move and selects it.
  await addLine(page, "Nf6").click();
  await expect(chapterMoves(page).getByRole("button", { name: "Nf6", exact: true })).toBeVisible();
  // The board shows the new move (its route under the board).
  await expect(
    page
      .getByRole("region", { name: "Board" })
      .getByText("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6", { exact: true })
  ).toBeVisible();
  await expect(addLine(page, "d3")).toBeVisible();
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText("Saved");

  // Undo takes it back (one step), and the lines are the previous move's again.
  await studyPanel(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(chapterMoves(page).getByRole("button", { name: "Nf6", exact: true })).toHaveCount(0);
  await expect(addLine(page, "Nf6")).toBeVisible();
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText("Saved");

  // Closing the panel stops the engine; the bar goes with it.
  await enginePanel(page).getByRole("button", { name: "Close the engine" }).click();
  await expect(enginePanel(page)).toHaveCount(0);
  await expect(analyze).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("img", { name: /^Evaluation / })).toHaveCount(0);
  await expect.poll(() => engineCommands(log).at(-1)).toBe("stop");
  await expect.poll(() => board.boundingBox()).toEqual(boardBox);
  // The toggle is a keyboard control: Enter opens the panel again, at the same board size.
  await analyze.focus();
  await page.keyboard.press("Enter");
  await expect(analyze).toHaveAttribute("aria-expanded", "true");
  await expect(addLine(page, "Nf6")).toBeVisible();
  await expect.poll(() => board.boundingBox()).toEqual(boardBox);
});

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });

/** From anywhere: the repertoire's Study (at its last position), with the engine panel searching. */
async function studyWithEngine(page: Page) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  const analyze = positionActions(page).getByRole("button", { name: "Analyze", exact: true });
  // Each visit starts with the panel closed.
  await expect(analyze).toHaveAttribute("aria-expanded", "false");
  await analyze.click();
  await expect(addLine(page, "e4")).toBeVisible({ timeout: 15_000 });
}

/**
 * Waits for the engine to be told to stop after the first `from` commands, with nothing started
 * after it (the search ended, and nothing searches the study behind the screen left to).
 */
async function expectStoppedSince(log: string, from: number) {
  await expect.poll(() => engineCommands(log).slice(from).at(-1)).toBe("stop");
}

test("leaving Study by any route stops the engine panel's search", async ({ launch, profile }) => {
  const log = join(profile, "fake-engine.log");
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "lines");
  await seedRepertoire(page);

  // The breadcrumb back to the repertoires.
  await studyWithEngine(page);
  let from = engineCommands(log).length;
  await page
    .getByRole("navigation", { name: "Repertoire location" })
    .getByRole("button", { name: "Repertoire", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true })
  ).toBeVisible();
  await expectStoppedSince(log, from);

  // Back (to the repertoires, where Study was opened from).
  await studyWithEngine(page);
  from = engineCommands(log).length;
  await titlebar(page)
    .getByRole("button", { name: /^Back \(/ })
    .click();
  await expect(
    page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true })
  ).toBeVisible();
  await expectStoppedSince(log, from);

  // The sidebar, to a screen without a board.
  await studyWithEngine(page);
  from = engineCommands(log).length;
  await sidebar(page).getByRole("button", { name: "Home", exact: true }).click();
  await expect(studyPanel(page)).toHaveCount(0);
  await expectStoppedSince(log, from);

  // The sidebar's Analyze: the board's own engine tab analyses the board, not the study.
  await studyWithEngine(page);
  from = engineCommands(log).length;
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expectStoppedSince(log, from);
  await page
    .getByRole("tabpanel", { name: "Engine" })
    .getByRole("button", { name: "Start analysis" })
    .click();
  await expect.poll(() => engineCommands(log).slice(from).at(-1)).toBe("go infinite");
  expect(
    engineCommands(log)
      .slice(from)
      .filter((line) => line.startsWith("position"))
      .at(-1)
  ).toBe("position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

  // Closing the window ends the engine with it (macOS keeps the app running): its process is gone.
  // Elsewhere it also ran its exit handler; on Windows a kill ends a process without running it.
  await studyWithEngine(page);
  from = engineCommands(log).length;
  const pid = enginePid(log);
  expect(isRunning(pid), "the panel's engine runs").toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect.poll(() => isRunning(pid)).toBe(false);
  if (process.platform !== "win32") expect(engineCommands(log).slice(from)).toContain("exit");
});

test("Play from here stops the panel's search and the engine game gets the engine", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "lines");
  await seedRepertoire(page);
  await studyWithEngine(page);
  await page.getByRole("tab", { name: "Moves", exact: true }).click();
  await chapterMoves(page).getByRole("button", { name: "Bc4", exact: true }).click();
  await expect(addLine(page, "Nf6")).toBeVisible();

  const from = engineCommands(log).length;
  await positionActions(page).getByRole("button", { name: "Play from here", exact: true }).click();
  await expect(page.getByText(`${REPERTOIRE} › Italian`)).toBeVisible();
  await expectStoppedSince(log, from);
  // Black (the engine) is to move after 3. Bc4: the game asks the engine for its move.
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect
    .poll(() =>
      engineCommands(log)
        .slice(from)
        .some((line) => /^go (?!infinite)/.test(line))
    )
    .toBe(true);
});

test("Back from Study with the engine panel open to an analysis board analyses the board again", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "lines");
  await seedRepertoire(page);
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  const gameMoves = page.getByRole("tree", { name: "Game moves" });
  await gameMoves.getByRole("button", { name: "a6", exact: true }).click();

  // The board analysed at 3... a6.
  await page.getByRole("tab", { name: "Engine" }).click();
  const engineTab = page.getByRole("tabpanel", { name: "Engine" });
  await engineTab.getByRole("button", { name: "Start analysis" }).click();
  await expect(engineTab.getByRole("button", { name: "Stop" })).toBeVisible();

  // Its line goes into the repertoire (from the Moves tab), and the notice opens the new chapter's Study from here.
  await page.getByRole("tab", { name: "Moves" }).click();
  await page.getByRole("button", { name: "Add to repertoire…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to repertoire" });
  await dialog.getByLabel("Repertoire").selectOption({ label: `${REPERTOIRE} (White)` });
  const add = dialog.getByRole("button", { name: "Add to repertoire", exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  await page.getByRole("button", { name: "Open chapter", exact: true }).click();
  await expect(studyPanel(page)).toBeVisible();
  const analyze = positionActions(page).getByRole("button", { name: "Analyze", exact: true });
  await analyze.click();
  await expect(addLine(page, "e4")).toBeVisible({ timeout: 15_000 });

  const from = engineCommands(log).length;
  await titlebar(page)
    .getByRole("button", { name: /^Back \(/ })
    .click();
  await expect(gameMoves).toBeVisible();
  // The study's search stopped and the board's runs again, at its move.
  await page.getByRole("tab", { name: "Engine" }).click();
  await expect(engineTab.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect.poll(() => engineCommands(log).slice(from).at(-1)).toBe("go infinite");
  const since = engineCommands(log).slice(from);
  expect(since).toContain("stop");
  expect(since.filter((line) => line.startsWith("position")).at(-1)).toBe(
    "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4 e7e5 g1f3 b8c6 f1b5 a7a6"
  );
});
