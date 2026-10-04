// The board pages' layout through the built app: the sidebar collapses to an icon rail and opens
// as it was left; the board fills its space, and a grip in its bottom-right corner (shown only on
// hover) resizes it for the side panel, is remembered, and fills again on a double-click; the
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

/** Steps the move navigation to the `ply`-th move of the main line (0: the starting position). */
async function goToPly(page: Page, ply: number, total: number) {
  await navigation(page).getByRole("button", { name: "First move", exact: true }).click();
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
  await page.mouse.move(corner.x - 140, corner.y - 140, { steps: 10 });
  // Still shown mid-drag, wherever the pointer is.
  await expect.poll(() => gripOpacity(page)).toBe("1");
  await page.mouse.up();
  const resized = await boardEdge(page);
  expect(resized).toBeGreaterThan(filled - 150);
  expect(resized).toBeLessThan(filled - 130);
  const square = await box(board(page).locator("cg-board"));
  expect(square.height).toBeCloseTo(square.width, 0);
  expect((await box(panel)).width).toBeGreaterThan(panelBefore + 100);
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

  // A double-click on the grip fills the space again.
  const restore = await gripCentre(again.page);
  await again.page.mouse.move(restore.x, restore.y);
  await again.page.mouse.dblclick(restore.x, restore.y);
  await expect.poll(() => boardEdge(again.page)).toBeGreaterThan(filled - 12);
  // Away from the corner the grip hides again.
  await again.page.mouse.move(restore.x - 200, restore.y - 200);
  await expect.poll(() => gripOpacity(again.page)).toBe("0");
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
