// A reviewed game on the board through the built app: the eval bar prints the evaluation at the
// better side's end (and follows a flipped board), and the reviewed move's mark sits on its
// destination square in Game review and on the Analyze board, never on the board of the game
// itself, and never for an ordinary move. The game is reviewed on the fake UCI engine's "review"
// mode (scripted lines for the Blackburne Shilling trap, as move-types.spec.ts). How to run them:
// playwright.config.ts.
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
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
  await expect(counter(page)).toHaveText(`${ply} / ${total}`);
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
  return board(page).evaluate((region, pieceClass) => {
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
  // gets no badge on the board.
  await goToPly(page, 1);
  await expect(evalBar(page)).toHaveAccessibleName("Evaluation +0.3");
  expect(await evalText(page)).toEqual({ text: "0.3", side: "white", end: "bottom" });
  // Drawn as chess.com draws it: white over a warm dark grey, the number dark on the white.
  expect(await evalColours(page)).toEqual({ bar: "rgb(64, 61, 57)", text: "rgb(64, 61, 57)" });
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
  await expect(counter(page)).toHaveText("7 / 14");
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
  await screenshot(page, "analyze-board");

  // An ordinary move there has none either.
  await goToPly(page, 3);
  await expect(markBadge(page)).toHaveCount(0);

  // With live analysis started on it, the mark stays.
  await goToPly(page, 7);
  await titlebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(titlebar(page).getByRole("button", { name: "Stop analysis" })).toBeVisible();
  await expect(board(page).getByRole("img", { name: "Blunder: Nxe5" })).toBeVisible();
});
