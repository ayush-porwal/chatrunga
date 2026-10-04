// The board pages' layout through the built app: the sidebar collapses to an icon rail and opens
// as it was left; the board fills its space, and a grip in its bottom-right corner (shown only on
// hover) resizes it, the side panel taking all the width it frees (no empty column either side) and
// the board centred down its cell, is remembered, and fills again on a double-click; the
// splitter in the gap between the board and the panel drives the same size (dragged across,
// stepped with the arrow keys, remembered, filled again on a double-click); the
// review board shows each side's clock at the selected move from the game's [%clk], in a light
// box for White and a dark one for Black, and no clocks for a game without them. How to run them:
// playwright.config.ts.
import type { Page } from "@playwright/test";
import { closeApp, expect, importPgnFile, sidebar, skipWelcome, test } from "./app";
import { RUY_LOPEZ_PGN, writePgn } from "./fixtures";

const CLOCKED_PGN = `[Event "Clocks e2e"]
[White "Clock White"]
[Black "Clock Black"]
[TimeControl "180+0"]
[Result "*"]

1. e4 { [%clk 0:02:58] } e5 { [%clk 0:02:55] } 2. Nf3 { [%clk 0:02:41] } Nc6 { [%clk 0:02:50] }
3. Bb5 { [%clk 0:02:30] } *
`;

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const board = (page: Page) => page.getByRole("region", { name: "Board" });
const grip = (page: Page) => board(page).locator(".board-resize-grip");
const splitter = (page: Page) =>
  page.getByRole("separator", { name: "Resize board and panel", exact: true });
/** The board block: the player rows, the eval column and the board (BoardStage). */
const boardBlock = (page: Page) => board(page).locator(":scope > div").first();
const navigation = (page: Page) => page.getByRole("navigation", { name: "Move navigation" });
const counter = (page: Page) => navigation(page).getByRole("paragraph").first();
const clock = (page: Page, side: "White" | "Black") =>
  board(page).getByRole("timer", { name: `${side} clock` });

async function box(locator: ReturnType<Page["locator"]>) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("not visible");
  return rect;
}

/** The board's edge on screen (Chessground's square board). */
async function boardEdge(page: Page) {
  return (await box(board(page).locator("cg-board"))).width;
}

/** The grip's centre, in the board's bottom-right corner. */
async function gripCentre(page: Page) {
  const rect = await box(grip(page));
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

const gripOpacity = (page: Page) => grip(page).evaluate((el) => getComputedStyle(el).opacity);

/** Whether a pointer at (x, y) reaches `target`: a view change's transition still covers the page. */
const reaches = (target: ReturnType<Page["locator"]>, x: number, y: number) =>
  target.evaluate((el, [px, py]) => el.contains(document.elementFromPoint(px, py)), [
    x,
    y
  ] as const);

/**
 * How far a board edge can be from the edge a resize asked for: Chessground rounds it down to
 * whole-pixel squares (8 device pixels at most, as many CSS pixels at a ratio of 1).
 */
const SQUARE_ROUNDING = 8;

/** Steps the move navigation to the `ply`-th move of the main line (0: the starting position). */
async function goToPly(page: Page, ply: number, total: number) {
  // At the starting position already, First move is disabled.
  const first = navigation(page).getByRole("button", { name: "First move", exact: true });
  if (await first.isEnabled()) await first.click();
  await expect(counter(page)).toHaveText(`0 / ${total}`);
  for (let step = 0; step < ply; step += 1)
    await navigation(page).getByRole("button", { name: "Next move", exact: true }).click();
  await expect(counter(page)).toHaveText(`${ply} / ${total}`);
}

async function openReview(page: Page, title: RegExp) {
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: title })
    .click();
  await expect(page.getByRole("tablist", { name: "Game review sections" })).toBeVisible();
}

test("the sidebar collapses to an icon rail with tooltips and opens as it was left", async ({
  launch
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  const nav = sidebar(page);
  const expandedWidth = (await box(nav)).width;
  expect(expandedWidth).toBeGreaterThan(150);

  await titlebar(page).getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await expect(titlebar(page).getByRole("button", { name: "Show sidebar" })).toBeVisible();
  // The rail is 56px at the base type size (3.5rem; bigger monitors step the type up).
  await expect.poll(async () => Math.round((await box(nav)).width)).toBeLessThanOrEqual(63);
  expect((await box(nav)).width).toBeGreaterThanOrEqual(56);
  // Every command keeps its name, and says it in a tooltip on hover.
  const review = nav.getByRole("button", { name: "Game review", exact: true });
  await review.hover();
  await expect(page.getByRole("tooltip")).toContainText("Game review");

  // Reopened, the app keeps the rail.
  await closeApp(app);
  const again = await launch();
  await expect(titlebar(again.page).getByRole("button", { name: "Show sidebar" })).toBeVisible();
  await expect.poll(async () => (await box(sidebar(again.page))).width).toBeLessThan(64);

  await titlebar(again.page).getByRole("button", { name: "Show sidebar", exact: true }).click();
  await expect
    .poll(async () => (await box(sidebar(again.page))).width)
    .toBeCloseTo(expandedWidth, 0);
});

test("the board fills its space, and its corner grip resizes it for the side panel", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  await expect(counter(page)).toHaveText("6 / 6");
  const panel = page.getByRole("complementary", { name: "Game" });

  // Filled: as large as the board cell allows beside the eval column and under the player rows
  // (whole-pixel squares and the frame's border take a few pixels off).
  const cell = await box(board(page));
  const filled = await boardEdge(page);
  expect(filled).toBeGreaterThan(Math.min(cell.width - 28, cell.height - 80) - 12);
  expect(filled).toBeLessThanOrEqual(Math.min(cell.width, cell.height));

  // The grip shows only while the pointer is over the board's bottom-right corner.
  await expect.poll(() => gripOpacity(page)).toBe("0");
  const cg = await box(board(page).locator("cg-board"));
  await page.mouse.move(cg.x + cg.width / 2, cg.y + cg.height / 2);
  await expect.poll(() => gripOpacity(page)).toBe("0");
  const corner = await gripCentre(page);
  await page.mouse.move(corner.x, corner.y);
  await expect.poll(() => gripOpacity(page)).toBe("1");

  // Dragging it up and left shrinks the square, and the panel takes the width it frees.
  const panelBefore = (await box(panel)).width;
  await page.mouse.down();
  // Along the corner's own path: 140 across, 70 up (the board is centred down its cell).
  await page.mouse.move(corner.x - 140, corner.y - 70, { steps: 10 });
  // Still shown mid-drag, and still under the pointer across (the axis the drag follows); down, it
  // rises half as far as the board shrank, the board centred down its cell.
  await expect.poll(() => gripOpacity(page)).toBe("1");
  const followed = await gripCentre(page);
  const shrunk = filled - (await boardEdge(page));
  expect(Math.abs(followed.x - (corner.x - 140))).toBeLessThan(6);
  expect(Math.abs(followed.y - (corner.y - shrunk / 2))).toBeLessThan(6);
  await page.mouse.up();
  const resized = await boardEdge(page);
  const square = await box(board(page).locator("cg-board"));
  // A filled board's grid is centred in the workspace, a resized one starts at its left edge: the
  // drag made up the board's move left, so it shrank by the drag less that shift.
  const shift = cg.x - square.x;
  expect(shift).toBeGreaterThanOrEqual(0);
  expect(Math.abs(resized - (filled - 140 + shift))).toBeLessThanOrEqual(SQUARE_ROUNDING);
  expect(square.height).toBeCloseTo(square.width, 0);
  expect((await box(panel)).width).toBeGreaterThan(panelBefore + 100);
  // No width is left over: the board's cell starts at the workspace's padding and is as wide as the
  // board block (eval column + board), and the panel takes everything to the padding on the right.
  const workspace = await box(page.locator(".board-workspace"));
  const cellAfter = await box(board(page));
  const panelAfter = await box(panel);
  const block = await box(boardBlock(page));
  const pad = cellAfter.x - workspace.x;
  expect(pad).toBeLessThanOrEqual(40);
  expect(
    Math.abs(workspace.x + workspace.width - (panelAfter.x + panelAfter.width) - pad)
  ).toBeLessThan(2);
  expect(block.x - cellAfter.x).toBeLessThan(2);
  expect(cellAfter.width - block.width).toBeLessThan(8);
  expect(square.x - cellAfter.x).toBeLessThanOrEqual(32);
  // Down, the board block is centred in its cell: the spare height splits above and below it,
  // while the panel keeps the full height.
  const above = block.y - cellAfter.y;
  const below = cellAfter.y + cellAfter.height - (block.y + block.height);
  expect(above).toBeGreaterThan(20);
  expect(Math.abs(above - below)).toBeLessThan(2);
  expect(Math.abs(panelAfter.height - cellAfter.height)).toBeLessThan(2);
  // Moves still play on the resized board's keys.
  await page.keyboard.press("ArrowLeft");
  await expect(counter(page)).toHaveText("5 / 6");

  // The size is remembered, and shared by the other board pages (the game's review here).
  await closeApp(app);
  const again = await launch();
  await openReview(again.page, /^Alpha vs Beta/);
  await expect(board(again.page).locator("cg-board")).toBeVisible();
  await expect.poll(() => boardEdge(again.page)).toBeGreaterThan(resized - 10);
  expect(await boardEdge(again.page)).toBeLessThan(resized + 10);

  // A double-click on the grip fills the space again (once the review's view transition has let
  // the pointer through to it).
  const restore = await gripCentre(again.page);
  await expect.poll(() => reaches(grip(again.page), restore.x, restore.y)).toBe(true);
  await again.page.mouse.move(restore.x, restore.y);
  await again.page.mouse.dblclick(restore.x, restore.y);
  await expect.poll(() => boardEdge(again.page)).toBeGreaterThan(filled - 12);
  // Away from the corner the grip hides again.
  await again.page.mouse.move(restore.x - 200, restore.y - 200);
  await expect.poll(() => gripOpacity(again.page)).toBe("0");
});

test("the line between the board and the panel is a splitter that resizes both", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  await expect(counter(page)).toHaveText("6 / 6");
  const panel = page.getByRole("complementary", { name: "Game" });
  const filled = await boardEdge(page);
  const panelBefore = (await box(panel)).width;

  // Dragged 160px left, it stays under the pointer: the board shrinks by as much, less how far it
  // moved left to the content's edge, and the panel takes the width.
  const line = await box(splitter(page));
  const x = line.x + line.width / 2;
  const y = line.y + line.height / 2;
  const before = await box(board(page).locator("cg-board"));
  await expect.poll(() => reaches(splitter(page), x, y)).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 160, y, { steps: 10 });
  const dragged = await box(splitter(page));
  // It sits at the board's edge, which Chessground rounds to whole-pixel squares.
  expect(Math.abs(dragged.x + dragged.width / 2 - (x - 160))).toBeLessThanOrEqual(SQUARE_ROUNDING);
  await page.mouse.up();
  const resized = await boardEdge(page);
  const shift = before.x - (await box(board(page).locator("cg-board"))).x;
  expect(shift).toBeGreaterThanOrEqual(0);
  expect(Math.abs(resized - (filled - 160 + shift))).toBeLessThanOrEqual(SQUARE_ROUNDING);
  expect((await box(panel)).width).toBeGreaterThan(panelBefore + 150);
  // Its value is the board's edge.
  const value = Number(await splitter(page).getAttribute("aria-valuenow"));
  expect(Math.abs(value - resized)).toBeLessThan(8);

  // The arrow keys step it, without moving through the game.
  await splitter(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => Number(await splitter(page).getAttribute("aria-valuenow")))
    .toBe(value - 16);
  await expect(counter(page)).toHaveText("6 / 6");
  const stepped = await boardEdge(page);

  // The size is remembered.
  await closeApp(app);
  const again = await launch();
  await openReview(again.page, /^Alpha vs Beta/);
  await expect(board(again.page).locator("cg-board")).toBeVisible();
  await expect.poll(() => boardEdge(again.page)).toBeGreaterThan(stepped - 10);
  expect(await boardEdge(again.page)).toBeLessThan(stepped + 10);

  // A double-click fills the space again.
  const restore = await box(splitter(again.page));
  const [rx, ry] = [restore.x + restore.width / 2, restore.y + restore.height / 2];
  await expect.poll(() => reaches(splitter(again.page), rx, ry)).toBe(true);
  await again.page.mouse.dblclick(rx, ry);
  await expect.poll(() => boardEdge(again.page)).toBeGreaterThan(filled - 12);
});

test("the review board shows each side's clock at the move from [%clk], and none without", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "clocked.pgn", CLOCKED_PGN));
  await expect(counter(page)).toHaveText("5 / 5");
  await openReview(page, /^Clock White vs Clock Black/);

  // The start: both sides have the time control's three minutes.
  await goToPly(page, 0, 5);
  await expect(clock(page, "White")).toHaveText("03:00");
  await expect(clock(page, "Black")).toHaveText("03:00");
  // 2. Nf3: White's clock after it, Black's after 1… e5.
  await goToPly(page, 3, 5);
  await expect(clock(page, "White")).toHaveText("02:41");
  await expect(clock(page, "Black")).toHaveText("02:55");
  // 2… Nc6: Black's clock moves on, White's stays.
  await navigation(page).getByRole("button", { name: "Next move", exact: true }).click();
  await expect(clock(page, "White")).toHaveText("02:41");
  await expect(clock(page, "Black")).toHaveText("02:50");

  // A light box for White, a dark one for Black.
  const background = (side: "White" | "Black") =>
    clock(page, side).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await background("White")).toBe("rgb(233, 228, 216)");
  expect(await background("Black")).toBe("rgb(12, 13, 15)");

  // A game whose moves record no clock shows no clocks at all.
  await importPgnFile(app, page, writePgn(profile, "plain.pgn", RUY_LOPEZ_PGN));
  await expect(counter(page)).toHaveText("6 / 6");
  await openReview(page, /^Alpha vs Beta/);
  await expect(board(page).getByRole("timer")).toHaveCount(0);
});
