// A reviewed game on the board through the built app: the eval bar prints the evaluation at the
// better side's end (and follows a flipped board), and the reviewed move's mark sits on its
// destination square in Game review and on the Analyze board, never on the board of the game
// itself, and never for an ordinary move. The game is reviewed on the fake UCI engine's "review"
// mode (scripted lines for the Blackburne Shilling trap, as move-types.spec.ts). While a review
// runs (the "review-gated" mode releases it move by move), the board follows the analysis, each
// finished move showing its mark, until the user navigates. The review board is interactive:
// arrows drawn last for their position, moves played (and the coach's lines clicked) go into a
// scratch line the game never gets, searched live, and the coach's moves and squares show on the
// board while hovered or focused. How to run them: playwright.config.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import type { GameReview } from "../../../packages/shared/src/types/engine";
import { trapReviewMoves } from "../../../packages/shared/src/chess/__fixtures__/trap-game";
import {
  clickSquare,
  expect,
  importPgnFile,
  registerFakeEngine,
  sidebar,
  skipWelcome,
  test,
  type LaunchedApp
} from "./app";
import { writePgn } from "./fixtures";

const TRAP_PGN = `[Event "Board marks e2e"]
[White "Alpha"]
[Black "Beta"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1
`;

/** Where the journey's screenshots go (`<dir>/review-marks-*.png`; unset: none are taken). */
const SCREENSHOT_DIR = process.env.CHATURANGA_E2E_REVIEW_MARKS_SCREENSHOTS;

async function screenshot(page: Page, name: string) {
  if (SCREENSHOT_DIR)
    await page.screenshot({ path: join(SCREENSHOT_DIR, `review-marks-${name}.png`) });
}

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const board = (page: Page) => page.getByRole("region", { name: "Board" });
const evalBar = (page: Page) => board(page).getByRole("img", { name: /^Evaluation / });
const markBadge = (page: Page) => board(page).locator("[data-square]");
const navigation = (page: Page) => page.getByRole("navigation", { name: "Move navigation" });
const counter = (page: Page) => navigation(page).getByRole("paragraph").first();

/** Steps the move navigation to the `ply`-th move of the main line (0: the starting position). */
async function goToPly(page: Page, ply: number, total = 14) {
  await navigation(page).getByRole("button", { name: "First move", exact: true }).click();
  for (let step = 0; step < ply; step += 1)
    await navigation(page).getByRole("button", { name: "Next move", exact: true }).click();
  // The counter counts full moves (White's move and Black's reply are one).
  await expect(counter(page)).toHaveText(`${Math.ceil(ply / 2)} / ${Math.ceil(total / 2)}`);
}

/** The bar's printed evaluation, the side it is drawn for, and which end of the bar it sits at. */
async function evalText(page: Page) {
  const label = evalBar(page).locator("[data-eval-side]");
  const [bar, box] = await Promise.all([evalBar(page).boundingBox(), label.boundingBox()]);
  if (!bar || !box) throw new Error("eval bar not visible");
  return {
    text: await label.textContent(),
    side: await label.getAttribute("data-eval-side"),
    end: box.y + box.height / 2 < bar.y + bar.height / 2 ? "top" : "bottom"
  };
}

/** The bar's own fill (Black's share) and the printed number's colour. */
async function evalColours(page: Page) {
  return evalBar(page).evaluate((bar) => {
    const label = bar.querySelector("[data-eval-side]");
    return {
      bar: getComputedStyle(bar).backgroundColor,
      text: label ? getComputedStyle(label).color : null
    };
  });
}

/** The square under the badge on the visible board, and whether it is in that square's top-right corner. */
async function badgeSquare(page: Page, flipped = false) {
  const [area, box] = await Promise.all([
    board(page).locator("cg-board").boundingBox(),
    markBadge(page).boundingBox()
  ]);
  if (!area || !box) throw new Error("board or badge not visible");
  const size = area.width / 8;
  const x = (box.x + box.width / 2 - area.x) / size;
  const y = (box.y + box.height / 2 - area.y) / size;
  const column = Math.floor(x);
  const row = Math.floor(y);
  const file = String.fromCharCode(97 + (flipped ? 7 - column : column));
  const rank = flipped ? row + 1 : 8 - row;
  return { square: `${file}${rank}`, topRight: x - column > 0.5 && y - row < 0.5 };
}

/**
 * What is drawn on top at the badge's centre: the badge, or the piece on its square. Hit testing
 * follows paint order, so for this check alone the badge and the pieces take pointer events (both
 * normally let them through to the board). `piece` puts Chessground's class for a sliding ("anim")
 * or dragged ("dragging") piece on the piece there first.
 */
async function onTopAtBadge(page: Page, piece?: "anim" | "dragging") {
  // Typed here: an optional `arg` drops `undefined` from the type Playwright infers for it.
  return board(page).evaluate((region, pieceClass: typeof piece) => {
    const badge = region.querySelector<HTMLElement>("[data-square]");
    if (!badge) throw new Error("no badge");
    const box = badge.getBoundingClientRect();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    const under = [...region.querySelectorAll<HTMLElement>("cg-board piece:not(.ghost)")].find(
      (item) => {
        const rect = item.getBoundingClientRect();
        return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
      }
    );
    if (!under) throw new Error("no piece under the badge");
    const style = document.createElement("style");
    style.textContent = "cg-board piece, [data-square] { pointer-events: auto !important; }";
    document.head.append(style);
    if (pieceClass) under.classList.add(pieceClass);
    try {
      const hit = document.elementFromPoint(x, y);
      if (hit && badge.contains(hit)) return "badge";
      return hit === under ? "piece" : (hit?.tagName.toLowerCase() ?? "nothing");
    } finally {
      if (pieceClass) under.classList.remove(pieceClass);
      style.remove();
    }
  }, piece);
}

/**
 * The badge moved onto the square at `at` (percentages of the board from its top left, as
 * squareOffset places it: `{ left: 87.5, top: 0 }` is the top-right corner square, h8 on a board
 * seen from White), since none of the trap game's marks lands on an edge square. Says whether its
 * box then reaches past the board's top and right edges, and whether the badge itself is what is
 * drawn just inside the middle of each side of that box (the disc touches all four), so nothing
 * (the board's rounded frame, the stage, the panel) clips it. Pointer events are on for the check
 * alone, as in onTopAtBadge.
 */
async function badgeOnEdgeSquare(page: Page, at: { left: number; top: number }) {
  return board(page).evaluate(async (region, { left, top }) => {
    const badge = region.querySelector<SVGSVGElement>("svg[data-square]");
    const square = badge?.parentElement;
    const area = region.querySelector("cg-board")?.getBoundingClientRect();
    if (!badge || !square || !area) throw new Error("no badge");
    // Measured at its full size, after it has popped in.
    await Promise.all(badge.getAnimations().map((animation) => animation.finished));
    const placed = { left: square.style.left, top: square.style.top };
    const style = document.createElement("style");
    style.textContent = "[data-square] { pointer-events: auto !important; }";
    document.head.append(style);
    Object.assign(square.style, { left: `${left}%`, top: `${top}%` });
    try {
      const box = badge.getBoundingClientRect();
      const shows = (x: number, y: number) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && badge.contains(hit));
      };
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      return {
        overhangs: box.top < area.top && box.right > area.right,
        top: shows(x, box.top + 1),
        right: shows(box.right - 1, y),
        bottom: shows(x, box.bottom - 1),
        left: shows(box.left + 1, y)
      };
    } finally {
      Object.assign(square.style, placed);
      style.remove();
    }
  }, at);
}

/** A badge on the top-right corner square: past the board's top and right edges, and all of it drawn. */
const WHOLE_OVERHANG = { overhangs: true, top: true, right: true, bottom: true, left: true };

/** Imports the trap game and reviews it on the fake engine; ends on the review page. */
async function reviewTrapGame({ app, page }: LaunchedApp, profile: string) {
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "uci.log"), "review");
  await importPgnFile(app, page, writePgn(profile, "trap.pgn", TRAP_PGN));
  await expect(board(page)).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  await expect(page.getByRole("tablist", { name: "Game review sections" })).toBeVisible();
  await titlebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  // An imported game asks which side it's reviewed as first (White: the board stays as it is).
  await page
    .getByRole("radiogroup", { name: "Review this game as" })
    .getByRole("radio", { name: "White (Alpha)" })
    .click();
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(
    titlebar(page).getByRole("button", { name: "Analyze again", exact: true })
  ).toBeVisible({ timeout: 60_000 });
}

test("game review prints the evaluation at the better side's end and marks the reviewed move's square", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const launched = await launch();
  const { page } = launched;
  await reviewTrapGame(launched, profile);

  // 1. e4: White is better, so the number sits at White's end (the bottom); a book move, which
  // gets its badge on e4 like any other mark.
  await goToPly(page, 1);
  await expect(evalBar(page)).toHaveAccessibleName("Evaluation +0.3");
  expect(await evalText(page)).toEqual({ text: "0.3", side: "white", end: "bottom" });
  // Drawn as chess.com draws it: white over a warm dark grey, the number dark on the white.
  expect(await evalColours(page)).toEqual({ bar: "rgb(64, 61, 57)", text: "rgb(64, 61, 57)" });
  await expect(board(page).getByRole("img", { name: "Book: e4" })).toHaveAttribute(
    "data-annotation",
    "book"
  );
  expect(await badgeSquare(page)).toEqual({ square: "e4", topRight: true });
  await screenshot(page, "book");

  // 6. Rf1, an ordinary move: no badge.
  await goToPly(page, 11);
  await expect(markBadge(page)).toHaveCount(0);
  await screenshot(page, "unmarked");

  // 4. Nxe5, a blunder: Black is better (the top), and the badge is on e5's top-right corner.
  await goToPly(page, 7);
  await expect(evalBar(page)).toHaveAccessibleName("Evaluation -2.5");
  expect(await evalText(page)).toEqual({ text: "2.5", side: "black", end: "top" });
  // Black's number is light on the grey.
  expect((await evalColours(page)).text).toBe("rgb(255, 255, 255)");
  const blunder = board(page).getByRole("img", { name: "Blunder: Nxe5" });
  await expect(blunder).toHaveAttribute("data-annotation", "blunder");
  await expect(blunder).toHaveAttribute("data-square", "e5");
  expect(await badgeSquare(page)).toEqual({ square: "e5", topRight: true });
  await screenshot(page, "blunder");
  // Drawn over the knight on e5, standing or sliding in.
  expect(await onTopAtBadge(page)).toBe("badge");
  expect(await onTopAtBadge(page, "anim")).toBe("badge");
  // On the top-right corner square (h8) it overhangs the board's top and right edges, and shows
  // whole: nothing around the board clips it.
  expect(await badgeOnEdgeSquare(page, { left: 87.5, top: 0 })).toEqual(WHOLE_OVERHANG);

  // The badge follows navigation: 4… Qg5, the critical find, on g5.
  await navigation(page).getByRole("button", { name: "Next move", exact: true }).click();
  await expect(board(page).getByRole("img", { name: "Great: Qg5" })).toHaveAttribute(
    "data-annotation",
    "great"
  );
  expect(await badgeSquare(page)).toEqual({ square: "g5", topRight: true });

  // Flipped (Black at the bottom): Black's end of the bar is the bottom now, White's the top, and
  // the badge moves with its square.
  await sidebar(page).getByRole("button", { name: "Flip board", exact: true }).click();
  await goToPly(page, 7);
  expect(await evalText(page)).toEqual({ text: "2.5", side: "black", end: "bottom" });
  expect(await badgeSquare(page, true)).toEqual({ square: "e5", topRight: true });
  // Flipped, the top-right corner square is a1: the badge shows whole there too.
  expect(await badgeOnEdgeSquare(page, { left: 87.5, top: 0 })).toEqual(WHOLE_OVERHANG);
  await screenshot(page, "flipped");
  await goToPly(page, 1);
  expect(await evalText(page)).toEqual({ text: "0.3", side: "white", end: "top" });

  // A forced mate prints as M and its length; the game's end prints its result.
  await goToPly(page, 13);
  await expect(evalBar(page)).toHaveAccessibleName("Evaluation M-1");
  expect(await evalText(page)).toEqual({ text: "M1", side: "black", end: "bottom" });
  await goToPly(page, 14);
  expect(await evalText(page)).toEqual({ text: "0-1", side: "black", end: "bottom" });
  await screenshot(page, "result");
});

test("the Analyze board marks the reviewed move, the game's own board does not", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const launched = await launch();
  const { page } = launched;
  await reviewTrapGame(launched, profile);
  await goToPly(page, 7);
  await expect(board(page).getByRole("img", { name: "Blunder: Nxe5" })).toBeVisible();

  // Back to the game's board (a free board for playing on): the same move, no mark.
  await titlebar(page)
    .getByRole("button", { name: /^Back \(/ })
    .click();
  await expect(page.getByRole("tablist", { name: "Game review sections" })).toHaveCount(0);
  await expect(board(page).locator("cg-board")).toBeVisible();
  await goToPly(page, 7);
  await expect(evalBar(page)).toHaveAccessibleName("Evaluation -2.5");
  await expect(markBadge(page)).toHaveCount(0);
  await screenshot(page, "game-board");

  // The Analyze board of the same game shows it, and lets clicks through to the board.
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  const blunder = board(page).getByRole("img", { name: "Blunder: Nxe5" });
  await expect(counter(page)).toHaveText("4 / 7");
  await expect(blunder).toBeVisible();
  expect(await badgeSquare(page)).toEqual({ square: "e5", topRight: true });
  const box = await blunder.boundingBox();
  if (!box) throw new Error("badge not visible");
  const hit = await page.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest("cg-container")),
    [box.x + box.width / 2, box.y + box.height / 2] as const
  );
  expect(hit).toBe(true);
  // Over the knight standing or sliding in; a piece picked up and dragged goes over the badge.
  expect(await onTopAtBadge(page)).toBe("badge");
  expect(await onTopAtBadge(page, "anim")).toBe("badge");
  expect(await onTopAtBadge(page, "dragging")).toBe("piece");
  // Whole on the top-right corner square (h8) of this board too.
  expect(await badgeOnEdgeSquare(page, { left: 87.5, top: 0 })).toEqual(WHOLE_OVERHANG);
  await screenshot(page, "analyze-board");

  // An ordinary move there (6. Rf1) has none either.
  await goToPly(page, 11);
  await expect(markBadge(page)).toHaveCount(0);

  // With live analysis started on it, the mark stays.
  await goToPly(page, 7);
  const analysis = page.getByRole("switch", { name: "Analysis" });
  await analysis.click();
  await expect(analysis).toHaveAttribute("aria-checked", "true");
  await expect(board(page).getByRole("img", { name: "Blunder: Nxe5" })).toBeVisible();
});

test("a running review fills in as it goes: the board follows the analysis until the user navigates", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  // The engine's "review-gated" mode: with the gate at N, moves 1…N are analysed, N + 1 is going.
  const log = join(profile, "uci.log");
  const gate = (ply: number) => writeFileSync(`${log}.gate`, String(ply));
  gate(0);
  await skipWelcome(page);
  await registerFakeEngine(page, log, "review-gated");
  await importPgnFile(app, page, writePgn(profile, "trap.pgn", TRAP_PGN));
  await expect(board(page)).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  await titlebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "Review this game as" })
    .getByRole("radio", { name: "White (Alpha)" })
    .click();
  await page.getByRole("button", { name: "Start review", exact: true }).click();

  // The run opens the Moves tab on its move list, and the board on the start position.
  const tabs = page.getByRole("tablist", { name: "Game review sections" });
  await expect(tabs.getByRole("tab", { name: "Moves", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const tree = page.getByRole("tree", { name: "Reviewed move tree" });
  const stop = titlebar(page).getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await expect(counter(page)).toHaveText("0 / 7");
  const follow = navigation(page).getByRole("button", { name: "Follow analysis" });
  await expect(follow).toHaveCount(0);

  // The board steps to each move as its analysis finishes; the tree selects it.
  gate(1);
  await expect(counter(page)).toHaveText("1 / 7");
  gate(2);
  await expect(counter(page)).toHaveText("1 / 7");
  await expect(tree.getByRole("button", { name: "e5", exact: true })).toHaveAttribute(
    "aria-current",
    "step"
  );
  // The opening is named as soon as its last book move is analysed.
  gate(6);
  await expect(counter(page)).toHaveText("3 / 7");
  await expect(tree.getByLabel(/Italian Game.*: book ends$/)).toBeVisible();
  // A finished move's mark is final: on the board at once, while the run goes on.
  gate(7);
  await expect(counter(page)).toHaveText("4 / 7");
  await expect(board(page).getByRole("img", { name: "Blunder: Nxe5" })).toBeVisible();
  await expect(navigation(page).getByRole("status")).toHaveAccessibleName("Analyzing move 4 of 7");
  await expect(stop).toBeVisible();
  await screenshot(page, "live");

  // Clicking a move pauses following: the board stays there while the run goes on.
  await tree.getByRole("button", { name: "Nf3", exact: true }).click();
  await expect(counter(page)).toHaveText("2 / 7");
  await expect(follow).toBeVisible();
  gate(8);
  await expect(navigation(page).getByRole("status")).toHaveAccessibleName("Analyzing move 5 of 7");
  await expect(counter(page)).toHaveText("2 / 7");

  // The board takes no moves while the run goes on: a piece dragged adds none.
  const area = await board(page).locator("cg-board").boundingBox();
  if (!area) throw new Error("board not visible");
  const size = area.width / 8;
  const centre = (column: number, row: number) =>
    [area.x + (column + 0.5) * size, area.y + (row + 0.5) * size] as const;
  await page.mouse.move(...centre(6, 0));
  await page.mouse.down();
  await page.mouse.move(...centre(5, 2), { steps: 5 });
  await page.mouse.up();
  await expect(counter(page)).toHaveText("2 / 7");
  await expect(tree.getByRole("group", { name: /^Variation: / })).toHaveCount(0);
  await expect(tree.getByRole("button", { name: "Nf6", exact: true })).toHaveCount(0);

  // Follow analysis jumps back to the latest analysed move and follows again.
  await follow.click();
  await expect(counter(page)).toHaveText("4 / 7");
  await expect(follow).toHaveCount(0);
  await expect(board(page).getByRole("img", { name: "Great: Qg5" })).toBeVisible();

  // Clicking the move already shown pauses too: the board holds there as the next one finishes.
  await tree.getByRole("button", { name: "Qg5", exact: true }).click();
  await expect(follow).toBeVisible();
  gate(9);
  await expect(navigation(page).getByRole("status")).toHaveAccessibleName("Analyzing move 5 of 7");
  await expect(counter(page)).toHaveText("4 / 7");
  await follow.click();
  await expect(counter(page)).toHaveText("5 / 7");

  // The run ends with the board on its last move.
  gate(13);
  await expect(
    titlebar(page).getByRole("button", { name: "Analyze again", exact: true })
  ).toBeVisible();
  await expect(counter(page)).toHaveText("7 / 7");
});

test("a stopped review says where it got to and offers Analyze again", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  // The engine's "review-gated" mode: with the gate at N, moves 1…N are analysed, N + 1 is going.
  const log = join(profile, "uci.log");
  writeFileSync(`${log}.gate`, "4");
  await skipWelcome(page);
  await registerFakeEngine(page, log, "review-gated");
  await importPgnFile(app, page, writePgn(profile, "trap.pgn", TRAP_PGN));
  await expect(board(page)).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  await titlebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "Review this game as" })
    .getByRole("radio", { name: "White (Alpha)" })
    .click();
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  // Four plies analysed, the fifth (White's third move) going.
  await expect(navigation(page).getByRole("status")).toHaveAccessibleName("Analyzing move 3 of 7");
  await titlebar(page).getByRole("button", { name: "Stop", exact: true }).click();

  // The panel says where the run stopped, on every tab, with the way to run it again.
  const panel = page.getByRole("complementary", { name: "Review" });
  const stopped = panel.getByRole("status").filter({ hasText: /^Analysis stopped at/ });
  await expect(stopped).toContainText("Analysis stopped at move 3 of 7.");
  const tabs = page.getByRole("tablist", { name: "Game review sections" });
  await tabs.getByRole("tab", { name: "Summary", exact: true }).click();
  await expect(stopped).toBeVisible();
  // The moves it reached are reviewed: the review button shows, with no key moment among them.
  await expect(panel.getByRole("button", { name: "No key moments", exact: true })).toBeDisabled();

  await stopped.getByRole("button", { name: "Analyze again", exact: true }).click();
  await expect(titlebar(page).getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(stopped).toHaveCount(0);
});

/** The coach's text on 4. Nxe5: the game's moves, the engine's better line, and squares. */
const COACH_PROSE =
  "Nxe5 walks into the trap: Qg5 hits g2 and the knight on e5 at once. Nxd4 exd4 keeps the balance.";

/**
 * The trap game saved with its analysis (as the fake engine's review stores it) and the coach's
 * text on 4. Nxe5, through the preload bridge (set-up, not the journey), then opened in Game review
 * from Play's Recent games. Returns the game's id.
 */
async function openSeededReview(page: Page): Promise<string> {
  const id = await page.evaluate(
    async ([pgn, moves, prose]) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
      const { game } = await api.games.importPgn({ pgn });
      const saved = await api.games.save({ ...game });
      const byPly = new Map(
        saved.moveTree.filter((node) => node.san).map((node) => [node.ply, node.id])
      );
      const review: GameReview = {
        reviewId: "seeded-analysis",
        schemaVersion: 2,
        engineId: "sf",
        engineName: "Stockfish",
        depth: null,
        moveTimeMs: 250,
        createdAt: Date.now(),
        summary: {
          totalMoves: 14,
          best: 9,
          excellent: 0,
          good: 2,
          inaccuracies: 0,
          mistakes: 1,
          blunders: 2,
          missedTactics: 0,
          averageCentipawnLoss: 0
        },
        moves: moves.map((move) => ({ ...move, nodeId: byPly.get(move.ply) ?? move.nodeId })),
        commentary: [
          {
            ply: 7,
            headline: "A knight lost to a trap",
            prose,
            generatedAt: 1,
            providerModel: "test/model"
          }
        ]
      };
      await api.games.save({ ...game, id: saved.id, review });
      return saved.id;
    },
    [TRAP_PGN, trapReviewMoves(), COACH_PROSE] as const
  );
  await page.reload();
  await sidebar(page).getByRole("button", { name: "Play", exact: true }).click();
  await page
    .getByRole("region", { name: "Recent games" })
    .getByRole("button", { name: /^Open review/ })
    .first()
    .click();
  await expect(reviewTabs(page)).toBeVisible();
  return id;
}

const reviewTabs = (page: Page) => page.getByRole("tablist", { name: "Game review sections" });
/** What the review board shows besides the game's move (its data attributes). */
const boardSurface = (page: Page) => board(page).locator("[data-drawings]");
/** The moves tried on the board, in the Moves tab. */
const scratchRow = (page: Page) => page.getByRole("group", { name: /^Moves tried, not saved: / });

/** How many moves the saved game has (its root included), read from the library. */
function savedMoveCount(page: Page, id: string): Promise<number> {
  return page.evaluate(async (gameId) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    return (await api.games.get(gameId)).moveTree.length;
  }, id);
}

/** The UCI commands the fake engine received, in order. */
function engineCommands(log: string): string[] {
  try {
    return readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** The centre of `square` on the visible board (White at the bottom). */
async function squarePoint(page: Page, square: string) {
  const box = await board(page).locator("cg-board").boundingBox();
  if (!box) throw new Error("board not visible");
  const column = square.charCodeAt(0) - 97;
  const row = 8 - Number(square[1]);
  return { x: box.x + ((column + 0.5) * box.width) / 8, y: box.y + ((row + 0.5) * box.height) / 8 };
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("the review board takes drawings for its position and tries moves in a scratch line, searched live, the game unchanged", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const log = join(profile, "uci.log");
  const { page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "review");
  const id = await openSeededReview(page);
  const savedMoves = await savedMoveCount(page, id);
  await goToPly(page, 6); // 3… Nd4

  // An arrow drawn with the right button stays while its position shows, and goes with it.
  const from = await squarePoint(page, "e2");
  const to = await squarePoint(page, "e4");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await expect(boardSurface(page)).toHaveAttribute("data-drawings", "1");
  await navigation(page).getByRole("button", { name: "Next move", exact: true }).click();
  await expect(boardSurface(page)).toHaveAttribute("data-drawings", "0");
  await navigation(page).getByRole("button", { name: "Previous move", exact: true }).click();
  await expect(boardSurface(page)).toHaveAttribute("data-drawings", "0");

  // A move played on the board (4. c3, not the game's 4. Nxe5) starts a scratch line.
  await expect(boardSurface(page)).not.toHaveAttribute("data-scratch-line");
  await clickSquare(page, "c2");
  await clickSquare(page, "c3");
  await expect(boardSurface(page)).toHaveAttribute("data-scratch-line", "");
  await clickSquare(page, "d4");
  await clickSquare(page, "f3");
  await reviewTabs(page).getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(scratchRow(page)).toHaveAccessibleName("Moves tried, not saved: 4. c3 Nxf3+");
  await expect(
    scratchRow(page).getByRole("button", { name: "Show 4. c3 Nxf3+ on the board" })
  ).toHaveAttribute("aria-current", "step");
  // The move buttons step within the line (← → too, outside the tab bar).
  await navigation(page).getByRole("button", { name: "Previous move", exact: true }).click();
  await expect(
    scratchRow(page).getByRole("button", { name: "Show 4. c3 on the board" })
  ).toHaveAttribute("aria-current", "step");

  // The Engine tab searches the line's position live (the game's moves, then the line's).
  await reviewTabs(page).getByRole("tab", { name: "Engine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fake UCI" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("switch", { name: "Live analysis" })).toBeChecked();
  await expect
    .poll(() => engineCommands(log))
    .toContain(`position fen ${START_FEN} moves e2e4 e7e5 g1f3 b8c6 f1c4 c6d4 c2c3`);
  expect(engineCommands(log)).toContain("go infinite");
  await expect(page.getByText(/^Trying moves from 3… Nd4/)).toBeVisible();

  // Back to game: the board is on the game's move again, and the game never got the moves.
  await page.getByRole("button", { name: "Back to game", exact: true }).first().click();
  await expect(boardSurface(page)).not.toHaveAttribute("data-scratch-line");
  await expect(counter(page)).toHaveText("3 / 7");
  // Its search stops.
  await expect
    .poll(() => {
      const commands = engineCommands(log);
      return commands.lastIndexOf("stop") > commands.lastIndexOf("go infinite");
    })
    .toBe(true);
  await reviewTabs(page).getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(scratchRow(page)).toHaveCount(0);
  expect(await savedMoveCount(page, id)).toBe(savedMoves);
});

test("the coach's moves and squares show on the review board while hovered or focused, and its line plays as a scratch line", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const log = join(profile, "uci.log");
  const { page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "review");
  const id = await openSeededReview(page);
  const savedMoves = await savedMoveCount(page, id);
  await reviewTabs(page).getByRole("tab", { name: "Commentary", exact: true }).click();
  await page.getByRole("region", { name: "Game charts" }).locator('circle[data-ply="7"]').click(); // 4. Nxe5
  const prose = page.getByText(/^Nxe5 walks into the trap/);
  await expect(prose).toBeVisible();

  // A square the text names rings it on the board, in the position before the move; leaving
  // puts the board back.
  await prose.locator('[data-square-ref="e5"]').hover();
  await expect(boardSurface(page)).toHaveAttribute("data-preview-square", "e5");
  await page.mouse.move(0, 0);
  await expect(boardSurface(page)).not.toHaveAttribute("data-preview-square");
  // Keyboard focus does the same.
  await prose.locator('[data-square-ref="g2"]').focus();
  await expect(boardSurface(page)).toHaveAttribute("data-preview-square", "g2");
  await prose.locator('[data-square-ref="g2"]').blur();
  await expect(boardSurface(page)).not.toHaveAttribute("data-preview-square");

  // A move the text names shows as its arrow on the position before it.
  const exd4 = prose.getByRole("button", { name: "Go to exd4 position" });
  await exd4.hover();
  await expect(boardSurface(page)).toHaveAttribute("data-preview-move", "e5d4");
  // Clicked, its line (the engine's 4. Nxd4 exd4) plays as a scratch line; the text stays.
  await exd4.click();
  await expect(boardSurface(page)).toHaveAttribute("data-scratch-line", "");
  await expect(boardSurface(page)).not.toHaveAttribute("data-preview-move");
  await expect(prose).toBeVisible();
  await expect(page.getByText(/^Trying moves from 3… Nd4/)).toBeVisible();
  await expect
    .poll(() => engineCommands(log))
    .toContain(`position fen ${START_FEN} moves e2e4 e7e5 g1f3 b8c6 f1c4 c6d4 f3d4 e5d4`);
  expect(await savedMoveCount(page, id)).toBe(savedMoves);

  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  await expect(boardSurface(page)).not.toHaveAttribute("data-scratch-line");
  await expect(counter(page)).toHaveText("4 / 7");
});
