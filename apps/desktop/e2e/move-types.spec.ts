// Game review's move marks through the built app: a short game reviewed on the fake UCI engine in
// its "review" mode (scripted lines for the Blackburne Shilling trap, see the script). Ordinary
// moves stay unmarked, the errors and the verified critical find are marked, the key moments lead
// the review and can be stepped through, and a saved analysis from before the current marks opens
// re-assessed and says so. How to run them: playwright.config.ts.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import type { GameReview } from "../../../packages/shared/src/types/engine";
import { trapReviewMoves } from "../../../packages/shared/src/chess/__fixtures__/trap-game";
import { MOVE_ASSESSMENT_POLICY } from "../../../packages/shared/src/chess/move-assessment";
import {
  closeApp,
  expect,
  importPgnFile,
  registerFakeEngine,
  sidebar,
  skipWelcome,
  test
} from "./app";
import { writePgn } from "./fixtures";

const TRAP_PGN = `[Event "Move marks e2e"]
[White "Alpha"]
[Black "Beta"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1
`;

/**
 * Each move's mark (null: unmarked), in game order. The first six are opening theory (3… Nd4 is
 * the Blackburne–Kostić Gambit of the opening book).
 */
const MARKS: readonly [string, string | null][] = [
  ["e4", "book"],
  ["e5", "book"],
  ["Nf3", "book"],
  ["Nc6", "book"],
  ["Bc4", "book"],
  ["Nd4", "book"],
  ["Nxe5", "blunder"],
  ["Qg5", "great"],
  ["Nxf7", "blunder"],
  ["Qxg2", "good"],
  ["Rf1", null],
  ["Qxe4+", null],
  ["Be2", "mistake"],
  ["Nf3#", null]
];

/** Where the journey's screenshots go (`<dir>/move-types-*.png`; unset: none are taken). */
const SCREENSHOT_DIR = process.env.CHATURANGA_E2E_MOVE_TYPES_SCREENSHOTS;

async function screenshot(page: Page, name: string) {
  if (SCREENSHOT_DIR)
    await page.screenshot({ path: join(SCREENSHOT_DIR, `move-types-${name}.png`) });
}

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const reviewTabs = (page: Page) => page.getByRole("tablist", { name: "Game review sections" });
const moveTree = (page: Page) => page.getByRole("tree", { name: "Reviewed move tree" });
const keyMomentNav = (page: Page) => page.getByRole("group", { name: "Key insights" });
const counter = (page: Page) =>
  page.getByRole("navigation", { name: "Move navigation" }).getByRole("paragraph").first();

/** The move list's cell (mark, piece, SAN) for the `index`-th main-line move (SANs repeat: Nf3 is played twice). */
function treeMove(page: Page, index: number): Locator {
  return moveTree(page).locator("[data-move-cell]").nth(index);
}

/** The marks the move tree shows, in game order. */
async function treeMarks(page: Page): Promise<[string, string | null][]> {
  const marks: [string, string | null][] = [];
  for (let index = 0; index < MARKS.length; index += 1) {
    const cell = treeMove(page, index);
    // The move is named by its SAN (its piece is drawn as an icon).
    const san = (await cell.locator("[data-tree-node-id]").getAttribute("aria-label")) ?? "";
    const badge = cell.locator("[data-annotation]");
    marks.push([san, (await badge.count()) ? await badge.getAttribute("data-annotation") : null]);
  }
  return marks;
}

test("a reviewed game marks only the moves that matter, leads with its key moments and steps through them", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "uci.log"), "review");
  await importPgnFile(app, page, writePgn(profile, "trap.pgn", TRAP_PGN));
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();

  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  await expect(reviewTabs(page)).toBeVisible();
  await titlebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  // An imported game asks which side it's reviewed as before its review starts: White.
  await page
    .getByRole("radiogroup", { name: "Review this game as" })
    .getByRole("radio", { name: "White (Alpha)" })
    .click();
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(
    titlebar(page).getByRole("button", { name: "Analyze again", exact: true })
  ).toBeVisible({ timeout: 60_000 });

  // The summary counts each side's marks: White's two blunders and mistake, Black's Great and Good.
  const markRow = (name: string) =>
    page.getByRole("table", { name: "Marks" }).getByRole("row").filter({ hasText: name });
  await expect(markRow("Blunder").getByRole("cell", { name: "White 2" })).toBeVisible();
  await expect(markRow("Mistake").getByRole("cell", { name: "White 1" })).toBeVisible();
  await expect(markRow("Great").getByRole("cell", { name: "Black 1" })).toBeVisible();

  // Before a move is picked, the commentary tab leads with White's key moments (Black's Great is
  // the opponent's).
  await reviewTabs(page).getByRole("tab", { name: "Commentary", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Move navigation" })
    .getByRole("button", { name: "First move", exact: true })
    .click();
  await expect(counter(page)).toHaveText("0 / 14");
  const leading = page.getByRole("list", { name: "Key moments of the game" });
  await expect(leading.getByRole("listitem")).toHaveCount(3);
  // Each card is the move (with the board's piece) and its mark, and no text beyond them.
  await expect(leading.getByRole("button").nth(0)).toHaveAccessibleName("4. Nxe5, Blunder");
  await expect(leading.getByRole("button").nth(1)).toHaveAccessibleName("5. Nxf7, Blunder");
  await expect(leading.getByRole("button").nth(2)).toHaveAccessibleName("7. Be2, Mistake");
  await expect(leading.getByRole("button")).toHaveCount(3);
  await expect(leading).not.toContainText("of the winning chances");
  await expect(leading).not.toContainText("Allows a forced mate.");
  await screenshot(page, "key-moments");

  // Key-insight navigation (the charts' header): from the start to each in turn, and back.
  await expect(keyMomentNav(page)).toContainText("3 key insights");
  await expect(
    keyMomentNav(page).getByRole("button", { name: "Previous key insight" })
  ).toBeDisabled();
  await keyMomentNav(page).getByRole("button", { name: "Next key insight" }).click();
  await expect(counter(page)).toHaveText("7 / 14");
  await expect(keyMomentNav(page)).toContainText("Key insight 1 of 3");
  await keyMomentNav(page).getByRole("button", { name: "Next key insight" }).click();
  await expect(counter(page)).toHaveText("9 / 14");
  await expect(keyMomentNav(page)).toContainText("Key insight 2 of 3");
  await keyMomentNav(page).getByRole("button", { name: "Next key insight" }).click();
  await expect(counter(page)).toHaveText("13 / 14");
  await expect(keyMomentNav(page).getByRole("button", { name: "Next key insight" })).toBeDisabled();
  await keyMomentNav(page).getByRole("button", { name: "Previous key insight" }).click();
  await expect(counter(page)).toHaveText("9 / 14");

  // The selected move's header names its mark (no static explanation): 4… Qg5, the critical find.
  await page
    .getByRole("navigation", { name: "Move navigation" })
    .getByRole("button", { name: "Previous move", exact: true })
    .click();
  const header = page.getByRole("heading", { name: "4… Qg5", level: 2 });
  await expect(header).toBeVisible();
  await expect(page.locator("header [data-annotation]")).toHaveAttribute(
    "data-annotation",
    "great"
  );
  await expect(page.getByText(/A critical find/)).toHaveCount(0);
  await screenshot(page, "great");

  // A book move carries the Book mark, and nothing more.
  const navigation = page.getByRole("navigation", { name: "Move navigation" });
  await navigation.getByRole("button", { name: "First move", exact: true }).click();
  await navigation.getByRole("button", { name: "Next move", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1. e4", level: 2 })).toBeVisible();
  await expect(page.locator("header [data-annotation]")).toHaveAttribute("data-annotation", "book");

  // An ordinary move has no mark at all: no badge, and no praise for matching the engine.
  for (let ply = 2; ply <= 11; ply += 1)
    await navigation.getByRole("button", { name: "Next move", exact: true }).click();
  await expect(page.getByRole("heading", { name: "6. Rf1", level: 2 })).toBeVisible();
  await expect(page.locator("header [data-annotation]")).toHaveCount(0);
  await expect(page.getByText("The engine's top choice.")).toHaveCount(0);

  // The move tree marks exactly the moves that matter.
  await reviewTabs(page).getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(moveTree(page)).toBeVisible();
  expect(await treeMarks(page)).toEqual(MARKS);
  await expect(treeMove(page, 7).getByRole("img", { name: "Great" })).toBeVisible();
  // An error's disc unfolds its BEST line.
  await expect(
    treeMove(page, 6).getByRole("button", { name: "Blunder: show the best line" })
  ).toBeVisible();
  await screenshot(page, "move-tree");

  // The Moves tab's other view, the key insights (the reviewed side's key moments), is remembered.
  const views = page.getByRole("radiogroup", { name: "Moves shown" });
  await expect(views.getByRole("radio", { name: "Moves", exact: true })).toBeChecked();
  await views.getByRole("radio", { name: "Key insights" }).click();
  const insights = page.getByRole("list", { name: "Key insights" });
  await expect(insights.getByRole("listitem")).toHaveCount(3);
  await screenshot(page, "key-insights");
  await insights.getByRole("button", { name: /Nxf7/ }).click();
  await expect(counter(page)).toHaveText("9 / 14");
  await reviewTabs(page).getByRole("tab", { name: "Commentary", exact: true }).click();
  await reviewTabs(page).getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(insights).toBeVisible();
  await views.getByRole("radio", { name: "Moves", exact: true }).click();
  await expect(moveTree(page)).toBeVisible();

  // The winning-chances chart dots the same moves (book moves stay neutral) and rings the key
  // insights: 4. Nxe5's blunder among them.
  const graph = page.getByRole("region", { name: "Game charts" });
  const dotted = MARKS.flatMap(([, mark], index) =>
    mark && mark !== "book" ? [`${index + 1} ${mark}`] : []
  );
  await expect
    .poll(() =>
      graph
        .locator("circle[data-annotation]")
        .evaluateAll((dots) =>
          dots.map(
            (dot) => `${dot.getAttribute("data-ply")} ${dot.getAttribute("data-annotation")}`
          )
        )
    )
    .toEqual(dotted);
  await expect(graph.locator("circle[data-key-moment]")).toHaveCount(3);
  const nxe5 = graph.locator('circle[data-ply="7"]');
  await expect(nxe5).toHaveAttribute("data-annotation", "blunder");
  await expect(nxe5).toHaveAttribute("data-key-moment", "true");

  // The saved analysis reopens with the same marks (the Great included) after a restart.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
        const [game] = (await api.games.listPage({ limit: 1 })).items;
        return game ? ((await api.games.get(game.id)).review?.assessmentPolicy ?? null) : null;
      })
    )
    .toBe(MOVE_ASSESSMENT_POLICY);
  await closeApp(app);
  const again = await launch();
  await sidebar(again.page).getByRole("button", { name: "Home", exact: true }).click();
  await expect(again.page.getByText("3 errors found")).toBeVisible();
  await again.page.getByRole("button", { name: "Open review", exact: true }).click();
  await reviewTabs(again.page).getByRole("tab", { name: "Moves", exact: true }).click();
  expect(await treeMarks(again.page)).toEqual(MARKS);
  await expect(again.page.getByText(/This analysis predates the current move marks/)).toHaveCount(
    0
  );
});

test("an analysis saved before the current marks opens re-assessed from its evaluations, and says so", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  // An older build's analysis of the game (evaluations only, a one-label verdict on every move),
  // saved through the preload bridge (set-up, not the journey).
  const legacy = trapReviewMoves().map((move) => ({ ...move, classification: "best" as const }));
  await page.evaluate(
    async ([pgn, moves]) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
      const { game } = await api.games.importPgn({ pgn });
      const saved = await api.games.save({ ...game });
      const byPly = new Map(
        saved.moveTree.filter((node) => node.san).map((node) => [node.ply, node.id])
      );
      const review: GameReview = {
        reviewId: "legacy-analysis",
        schemaVersion: 2,
        engineId: "sf",
        engineName: "Stockfish",
        depth: null,
        moveTimeMs: 250,
        createdAt: Date.now(),
        summary: {
          totalMoves: 14,
          best: 14,
          excellent: 0,
          good: 0,
          inaccuracies: 0,
          mistakes: 0,
          blunders: 0,
          missedTactics: 0,
          averageCentipawnLoss: 0
        },
        moves: moves.map((move) => ({ ...move, nodeId: byPly.get(move.ply) ?? move.nodeId })),
        // An explanation the AI coach wrote for that build, when every move came with a verdict.
        commentary: [
          {
            ply: 8,
            headline: "A brilliant queen sortie",
            prose: "Well spotted: Qg5 hits g2 and the knight on e5.",
            generatedAt: 1,
            providerModel: "test/model"
          }
        ]
      };
      await api.games.save({ ...game, id: saved.id, review });
    },
    [TRAP_PGN, legacy] as const
  );

  // Home counts its errors again from the stored evaluations (its own summary said none).
  await page.reload();
  await sidebar(page).getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByText("3 errors found")).toBeVisible();
  await page.getByRole("button", { name: "Open review", exact: true }).click();
  await expect(page.getByText(/This analysis predates the current move marks/)).toBeVisible();
  await reviewTabs(page).getByRole("tab", { name: "Moves", exact: true }).click();
  // The errors come back; Qg5 had no deeper search, so it is only Good (it punished Nxe5).
  expect(await treeMarks(page)).toEqual(
    MARKS.map(([san, mark]) => [san, san === "Qg5" ? "good" : mark])
  );
  await screenshot(page, "recomputed");

  // That explanation still shows, labelled as written before the current marks (nothing is
  // requested on its own). This profile has no OpenRouter key, so it can't be written again here.
  await reviewTabs(page).getByRole("tab", { name: "Commentary", exact: true }).click();
  await moveFromChart(page, 8); // 4… Qg5
  await expect(page.getByText("Well spotted: Qg5 hits g2 and the knight on e5.")).toBeVisible();
  await expect(page.getByText("Written before the current move marks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Write again" })).toHaveCount(0);
  await screenshot(page, "earlier-commentary");
});

/** Selects a marked move by clicking its dot on the winning-chances chart. */
async function moveFromChart(page: Page, ply: number) {
  await page
    .getByRole("region", { name: "Game charts" })
    .locator(`circle[data-ply="${ply}"]`)
    .click();
}
