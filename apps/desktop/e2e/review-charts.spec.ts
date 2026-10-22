// The review's linked charts through the built app: winning chances, Maia difficulty and move times
// share one move axis, one hover tooltip and one current-move line, and a click jumps the board;
// each strip folds (remembered) and so does the whole Charts section, under its header row right
// under the line above it; a splitter over the line above them sets their height (double-click
// resets it); without Maia 3 the difficulty strip offers its download, and without [%clk] there is
// no move-times strip. Maia 3 reads each side at its game rating (Human moves, the rating curve read
// when a move is opened), or both at Review settings' Maia rating. Reviewed on the fake
// UCI engine's "review" mode (the Blackburne Shilling trap, as move-types.spec.ts), with Maia 3's
// e2e stand-in (`maia3Fixture`: every position the same 50% for White, its moves weighted by
// rating). How to run them: playwright.config.ts.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import {
  expect,
  importPgnFile,
  mainRecord,
  registerFakeEngine,
  sidebar,
  skipWelcome,
  test,
  type LaunchedApp
} from "./app";
import { writePgn } from "./fixtures";

const SANS = "e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf3#".split(" ");
/** Seconds each ply took; 3 + 2 clocks follow from them. */
const SPENT = [2, 3, 9, 4, 14, 31, 6, 22, 41, 3, 17, 8, 26, 2];

/** The players' ratings: Maia 3 reads White at 1400 and Black at 1700 (its 100-point grid). */
const ELO = { white: 1412, black: 1689 } as const;

function trapPgn(withClocks: boolean, elo?: { white: number; black: number }): string {
  const left = { white: 180, black: 180 };
  const moves = SANS.map((san, index) => {
    const side = index % 2 === 0 ? "white" : "black";
    left[side] += 2 - SPENT[index];
    const clock = `0:0${Math.floor(left[side] / 60)}:${String(left[side] % 60).padStart(2, "0")}`;
    const text = withClocks ? `${san} { [%clk ${clock}] }` : san;
    return side === "white" ? `${index / 2 + 1}. ${text}` : text;
  });
  return `[Event "Charts e2e"]
[White "Alpha"]
[Black "Beta"]
${elo ? `[WhiteElo "${elo.white}"]\n[BlackElo "${elo.black}"]\n` : ""}${withClocks ? '[TimeControl "180+2"]\n' : ""}[Result "0-1"]

${moves.join(" ")} 0-1
`;
}

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const reviewTabs = (page: Page) => page.getByRole("tablist", { name: "Game review sections" });
const charts = (page: Page) => page.getByRole("region", { name: "Game charts" });
const view = (page: Page, name: "winning-chances" | "difficulty" | "times") =>
  charts(page).locator(`svg[data-chart="${name}"]`);
const counter = (page: Page) =>
  page.getByRole("navigation", { name: "Move navigation" }).getByRole("paragraph").first();
const splitter = (page: Page) => page.getByRole("separator", { name: "Resize the charts" });
const chartsToggle = (page: Page) => charts(page).getByRole("button", { name: "Charts" });

/**
 * The header row of the section `toggle` folds, as laid out: its height, how far below the line
 * above it it starts (the panel's top edge, or the divider over the charts), the title's inset
 * from the panel's left edge, the title's font and the chevron's size; and where the charts'
 * splitter is centred, from that line (null without one).
 */
async function headerBox(toggle: Locator) {
  return toggle.evaluate((button) => {
    const heading = button.closest("h3");
    const row = heading?.parentElement;
    const panel = button.closest("aside");
    const block = panel && [...panel.children].find((child) => child.contains(button));
    const chevron = button.querySelector("svg");
    if (!heading || !row || !panel || !block || !chevron) throw new Error("no header row");
    const box = row.getBoundingClientRect();
    const line =
      block.getBoundingClientRect().top + parseFloat(getComputedStyle(block).borderTopWidth);
    const splitter = block.querySelector('[role="separator"]')?.getBoundingClientRect();
    const font = getComputedStyle(heading);
    return {
      row: {
        height: box.height,
        belowLine: box.top - line,
        titleInset: button.getBoundingClientRect().left - panel.getBoundingClientRect().left,
        font: `${font.fontSize} ${font.fontWeight}`,
        // Its laid-out size (a folding chevron's box grows while it turns).
        chevron: getComputedStyle(chevron).width
      },
      splitter: splitter
        ? { centre: splitter.top + splitter.height / 2 - line, height: splitter.height }
        : null
    };
  });
}

/**
 * The Charts header row sits right under its line (the splitter adds no height); returns the
 * charts' splitter, from {@link headerBox}.
 */
async function expectChartsHeader(page: Page) {
  const chartsHeader = await headerBox(chartsToggle(page));
  expect(chartsHeader.row.belowLine).toBe(0);
  return chartsHeader.splitter;
}

/**
 * Imports the trap game (rated `elo` when given), reviews it as White and ends on the review page
 * with the charts.
 */
async function reviewTrap(
  { app, page }: LaunchedApp,
  profile: string,
  withClocks: boolean,
  elo?: { white: number; black: number }
) {
  await importPgnFile(app, page, writePgn(profile, "trap.pgn", trapPgn(withClocks, elo)));
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  await titlebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  // An imported game asks which side it's reviewed as before its review starts: White.
  const reviewAs = page.getByRole("tabpanel", { name: "Summary" });
  await reviewAs
    .getByRole("radiogroup", { name: "Review this game as" })
    .getByRole("radio", { name: "White (Alpha)" })
    .click();
  await reviewAs.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(
    titlebar(page).getByRole("button", { name: "Analyze again", exact: true })
  ).toBeVisible({ timeout: 60_000 });
  await expect(charts(page)).toBeVisible();
}

test("the three charts share a tooltip, jump the board, fold and resize", async ({
  launch,
  profile
}) => {
  test.setTimeout(150_000);
  const launched = await launch(undefined, { maia3Fixture: true });
  const { page } = launched;
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "uci.log"), "review");
  await reviewTrap(launched, profile, true, ELO);

  // Three views on one axis, each under its own folding label.
  await expect(view(page, "winning-chances")).toBeVisible();
  await expect(view(page, "difficulty")).toBeVisible();
  await expect(view(page, "times")).toBeVisible();
  await expect(charts(page).getByRole("button", { name: "Winning chances" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  // Difficulty names the rating each side's moves were read at: their game ratings.
  await expect(
    charts(page).getByRole("button", { name: "Difficulty at White 1400 · Black 1700 · Maia" })
  ).toBeVisible();
  await expect(charts(page).getByRole("button", { name: "Time per move" })).toBeVisible();
  // The header holds no key-insight navigation (the review button above the move navigation
  // steps through them). The splitter overlays the line above it: centred on it, an 8 px hit area.
  const overLine = await expectChartsHeader(page);
  expect(overLine?.height).toBe(8);
  expect(Math.abs(overLine?.centre ?? Infinity)).toBeLessThanOrEqual(1);
  await expect(charts(page).getByRole("group", { name: "Key insights" })).toHaveCount(0);

  // Hovering a move shows one tooltip for all three views: 4. Nxe5's blunder and its time.
  const nxe5 = view(page, "winning-chances").locator('circle[data-ply="7"]');
  await expect(nxe5).toHaveAttribute("data-annotation", "blunder");
  await nxe5.hover();
  const tooltip = charts(page).locator("[data-chart-tooltip]");
  await expect(tooltip).toContainText("4. Nxe5 · Blunder");
  // The chances name the review's engine; the difficulty Maia, at the rating it read the move at.
  await expect(tooltip).toContainText(/Your chances · .+?\d+%\s*Opponent's\s*\d+%/);
  await expect(tooltip).toContainText(/Best move at 1400 · Maia\s*\d+%/);
  await expect(tooltip).toContainText(/Time spent\s*0:06/);
  // The same move's bar on the time strip shows the same tooltip.
  await view(page, "times").locator('rect[data-ply="7"]').hover();
  await expect(tooltip).toContainText("4. Nxe5 · Blunder");

  // A click jumps the board there; the current-move line follows in every view.
  await nxe5.click();
  await expect(counter(page)).toHaveText("4 / 7");
  await expect(charts(page).locator("[data-current-move]")).toHaveCount(3);
  // Focused, the charts step through the moves with the arrow keys.
  await charts(page)
    .getByRole("group", { name: /Winning chances, difficulty/ })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(counter(page)).toHaveText("4 / 7");

  // Each strip folds on its own, remembered across a reload, and hands its height to the views
  // still open. That needs a height of the user's: at the default one the charts are as tall as
  // their open views need, so they'd shrink instead. Dragged up (as far as there is room).
  const handle = await splitter(page).boundingBox();
  if (!handle) throw new Error("no splitter");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 100, { steps: 5 });
  await page.mouse.up();
  const openHeight = async () => {
    const heights = await Promise.all(
      (["winning-chances", "difficulty"] as const).map(
        async (name) => (await view(page, name).boundingBox())?.height ?? 0
      )
    );
    return heights.reduce((sum, height) => sum + height, 0);
  };
  const before = await openHeight();
  await charts(page).getByRole("button", { name: "Time per move" }).click();
  await expect(view(page, "times")).toHaveCount(0);
  await expect.poll(openHeight).toBeGreaterThan(before);
  await splitter(page).dblclick();
  // Reloaded (once its review is saved), the review page opens the same game with its review.
  await expect.poll(() => savedReviews(page)).toEqual([["Alpha", 1]]);
  const reviewUrl = page.url();
  expect(reviewUrl).toMatch(/#\/games\/(?!current\/)[^/]+\/review$/);
  await page.reload();
  expect(page.url()).toBe(reviewUrl);
  await expect(
    titlebar(page).getByRole("button", { name: "Analyze again", exact: true })
  ).toBeVisible();
  await expect(
    sidebar(page).getByRole("button", { name: "Game review", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    sidebar(page).getByRole("button", { name: "Analyze", exact: true })
  ).not.toHaveAttribute("aria-pressed");
  await expect(counter(page)).toHaveText(/ \/ 7$/);
  await expect(charts(page)).toBeVisible();
  await expect(view(page, "winning-chances").locator('circle[data-ply="7"]')).toHaveAttribute(
    "data-annotation",
    "blunder"
  );
  await expect(view(page, "times")).toHaveCount(0);
  await charts(page).getByRole("button", { name: "Time per move" }).click();
  await expect(view(page, "times")).toBeVisible();
  // Back to the default height.
  await splitter(page).dblclick();

  // The whole Charts section folds to its header, and the splitter goes.
  await chartsToggle(page).click();
  await expect(view(page, "winning-chances")).toHaveCount(0);
  await expect(splitter(page)).toHaveCount(0);
  expect(await expectChartsHeader(page)).toBeNull();
  await chartsToggle(page).click();
  await expect(view(page, "winning-chances")).toBeVisible();

  // The splitter: dragging it up makes the charts taller, as far as the content above leaves room
  // (its aria-valuemax; on a small screen the default height may already be there); a double-click
  // resets the height; the arrow keys step it.
  const initial = Number(await splitter(page).getAttribute("aria-valuenow"));
  const max = Number(await splitter(page).getAttribute("aria-valuemax"));
  // (The height is whole pixels, the measured room isn't.)
  expect(max).toBeGreaterThanOrEqual(initial - 1);
  const box = await splitter(page).boundingBox();
  if (!box) throw new Error("no splitter");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 100, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await splitter(page).getAttribute("aria-valuenow")))
    .toBeGreaterThanOrEqual(Math.min(initial + 60, max));
  await splitter(page).dblclick();
  await expect(splitter(page)).toHaveAttribute("aria-valuenow", String(initial));
  // ↓ lowers it (↑ may have no room left on a small screen).
  await splitter(page).focus();
  await page.keyboard.press("ArrowDown");
  await expect(splitter(page)).toHaveAttribute("aria-valuenow", String(initial - 16));
  await splitter(page).dblclick();
});

test("without Maia 3 the difficulty strip offers its download, and without clocks there are no move times", async ({
  launch,
  profile
}) => {
  test.setTimeout(150_000);
  const launched = await launch();
  const { page } = launched;
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "uci.log"), "review");
  await reviewTrap(launched, profile, false);

  await expect(view(page, "winning-chances")).toBeVisible();
  await expect(view(page, "difficulty")).toHaveCount(0);
  // Maia 3 isn't installed: the strip's place says it is available, with its download and size
  // (the download is the user's to start).
  await expect(charts(page).getByText(/^Maia 3 is available/)).toBeVisible();
  await expect(
    charts(page).getByRole("button", { name: /^Download \(\d+\.\d MB\)$/ })
  ).toBeVisible();
  await expect(view(page, "times")).toHaveCount(0);
  await expect(charts(page).getByRole("button", { name: "Time per move" })).toHaveCount(0);

  // Settings → Engines offers the same download on its Maia 3 row; nothing fetched the model.
  await sidebar(page).getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download Maia 3", exact: true })).toBeVisible();
  const { fetches } = await mainRecord(launched.app);
  expect(fetches.filter((url) => url.includes("maia3"))).toEqual([]);
});

test("Maia 3 reads each side at its game rating: human moves and the curve across ratings; Review settings' rating reads both sides at one", async ({
  launch,
  profile
}) => {
  test.setTimeout(180_000);
  const launched = await launch(undefined, { maia3Fixture: true });
  const { page } = launched;
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "uci.log"), "review");
  await reviewTrap(launched, profile, false, ELO);
  // The rating curve is read for a saved analysis.
  await expect.poll(() => savedReviews(page)).toEqual([["Alpha", 1]]);
  await expect(
    charts(page).getByRole("button", { name: "Difficulty at White 1400 · Black 1700 · Maia" })
  ).toBeVisible();

  // 4. Nxe5, White's move: Maia's moves at White's rating, and (read when the move is opened) its
  // curve over the 21 ratings from 600 to 2600, White's marked as the reviewed side's (You).
  await view(page, "winning-chances").locator('circle[data-ply="7"]').click();
  await expect(counter(page)).toHaveText("4 / 7");
  await reviewTabs(page).getByRole("tab", { name: "Engine", exact: true }).click();
  await expect(page.getByRole("table", { name: /Human moves at 1400$/ })).toBeVisible();
  const curve = page.getByRole("table", {
    name: "Share of players expected to play each move, by rating"
  });
  await expect(curve.getByRole("rowheader")).toHaveCount(21);
  await expect(curve.getByRole("rowheader").first()).toHaveText("600");
  await expect(curve.getByRole("rowheader").last()).toHaveText("2600");
  await expect(curve.getByRole("rowheader", { name: "1400 (You)", exact: true })).toHaveCount(1);
  const slider = page.getByRole("slider", { name: "Human prediction by rating" });
  await expect(slider).toHaveAttribute("aria-valuemax", "20");
  await expect(slider).toHaveAttribute("aria-valuenow", "8");
  // Read once: the curve is saved into the move, so the next visit has it at once.
  await expect.poll(() => savedCurveLength(page, "f3e5")).toBe(21);

  // 4… Qg5, Black's move: at Black's rating, marked as the opponent's.
  await page
    .getByRole("navigation", { name: "Move navigation" })
    .getByRole("button", { name: "Next move", exact: true })
    .click();
  await expect(page.getByRole("table", { name: /Human moves at 1700$/ })).toBeVisible();
  await expect(curve.getByRole("rowheader", { name: "1700 (Opponent)", exact: true })).toHaveCount(
    1
  );

  // Review settings' Maia rating reads both sides at one rating, from the next analysis on.
  await page
    .getByRole("complementary", { name: "Review" })
    .getByRole("button", { name: "Review settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Review settings" });
  await expect(dialog.getByText("White 1400 · Black 1700 · from the game")).toBeVisible();
  await dialog.getByRole("combobox", { name: "Maia rating" }).selectOption("1800");
  await expect(dialog.getByText("Both sides 1800", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await titlebar(page).getByRole("button", { name: "Analyze again", exact: true }).click();
  await expect.poll(() => savedReviews(page), { timeout: 60_000 }).toEqual([["Alpha", 2]]);
  await expect(
    charts(page).getByRole("button", { name: "Difficulty at 1800 · Maia" })
  ).toBeVisible();
  // The new review opens on its Moves tab: 4. Nxe5 again, on the Engine tab, reads White at 1800.
  await view(page, "winning-chances").locator('circle[data-ply="7"]').click();
  await expect(counter(page)).toHaveText("4 / 7");
  await reviewTabs(page).getByRole("tab", { name: "Engine", exact: true }).click();
  await expect(page.getByRole("table", { name: /Human moves at 1800$/ })).toBeVisible();
});

test("the Analyze page shows the Charts for an unreviewed game: its clocks, no evaluations, no Difficulty", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "clocked.pgn", trapPgn(true)));
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(counter(page)).toHaveText("7 / 7");

  await expect(charts(page).getByRole("button", { name: "Charts" })).toBeVisible();
  // The Winning chances strip is there, waiting for a review; no Maia prompt on Analyze.
  await expect(charts(page).getByRole("button", { name: "Winning chances" })).toBeVisible();
  await expect(charts(page).getByText("No evaluations yet")).toBeVisible();
  await expect(view(page, "difficulty")).toHaveCount(0);
  await expect(charts(page).getByText("Difficulty needs")).toHaveCount(0);
  // Time per move from the clocks, linked to the board.
  await expect(view(page, "times")).toBeVisible();
  await view(page, "times").locator('rect[data-ply="7"]').click();
  await expect(counter(page)).toHaveText("4 / 7");
});

test("dragged up, the charts stop where the move list keeps its room under the engine lines", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "fake-engine.log"), "stockfish");
  await importPgnFile(app, page, writePgn(profile, "clocked.pgn", trapPgn(true)));
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  // Off the final mate, so there is something to analyse.
  await view(page, "times").locator('rect[data-ply="7"]').click();
  await expect(counter(page)).toHaveText("4 / 7");
  await page.getByRole("switch", { name: "Analysis" }).click();
  const engine = page.getByRole("region", { name: "Engine" });
  await expect(engine.getByRole("heading", { name: "Fake UCI" })).toBeVisible();

  // Far past the top of the panel.
  const handle = await splitter(page).boundingBox();
  if (!handle) throw new Error("no splitter");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, 0, { steps: 8 });
  await page.mouse.up();

  // Top to bottom without overlapping: the engine lines, the move list, then the charts. The move
  // list keeps its minimum room, unless the window is too short for that and the charts are down to
  // their own minimum.
  await expect(async () => {
    const lines = await box(engine);
    const moves = await box(page.locator("[data-panel-yields]"));
    const chartsBox = await box(charts(page));
    expect(lines.y + lines.height).toBeLessThanOrEqual(moves.y + 0.5);
    expect(moves.y + moves.height).toBeLessThanOrEqual(chartsBox.y + 0.5);
    expect(await keepsMoveListRoom(page, moves.height)).toBe(true);
  }).toPass();
});

/** The library's games, as [White, saved analyses]. */
function savedReviews(page: Page) {
  return page.evaluate(async () => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    const { items } = await api.games.listPage({});
    return items.map((item) => [item.white, item.reviewCount]);
  });
}

/** How many ratings the newest analysis keeps for the move played as `uci` (0: none). */
function savedCurveLength(page: Page, uci: string) {
  return page.evaluate(async (uci) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    const game = (await api.games.listPage({ limit: 1 })).items.at(0);
    if (!game) return 0;
    const move = (await api.games.get(game.id)).review?.moves.find(
      (item) => item.playedMove === uci
    );
    return move?.humanPredictions?.length ?? 0;
  }, uci);
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not laid out");
  return found;
}

/** The move list has its 160 px, or the charts gave up all they can (at their minimum height). */
async function keepsMoveListRoom(page: Page, movesHeight: number): Promise<boolean> {
  const value = (name: string) => splitter(page).getAttribute(name).then(Number);
  return movesHeight >= 159 || (await value("aria-valuenow")) <= (await value("aria-valuemin"));
}
