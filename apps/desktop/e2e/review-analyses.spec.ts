// Game review's saved analyses through the built app: the titlebar's compact picker names the one
// shown by its date (Latest when it's the newest, the engine settings in its tooltip and list), and
// deleting one or all of them asks first, switches to the newest left, and ends on Analyze with the
// game still in the library. Three analyses of the trap game are saved through the preload bridge
// (set-up, not the journey). How to run them: playwright.config.ts.
import type { Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import type { GameReview } from "../../../packages/shared/src/types/engine";
import { trapReviewMoves } from "../../../packages/shared/src/chess/__fixtures__/trap-game";
import { expect, sidebar, skipWelcome, test } from "./app";

const TRAP_PGN = `[Event "Saved analyses e2e"]
[White "Alpha"]
[Black "Beta"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1
`;

/** The saved analyses, newest first: when (local time) and how each was made. */
const ANALYSES = [
  { reviewId: "e2e-newest", at: [2026, 9, 4, 16, 1], engine: "Stockfish 19", ms: 250 },
  { reviewId: "e2e-middle", at: [2026, 9, 3, 9, 5], engine: "Stockfish 18", ms: 1000 },
  { reviewId: "e2e-oldest", at: [2026, 9, 2, 20, 15], engine: "Stockfish 17", ms: 500 }
] as const;

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const trigger = (page: Page) => titlebar(page).getByRole("button", { name: /^Analysis: / });
const picker = (page: Page) => page.getByRole("dialog", { name: "Saved analyses" });
const option = (page: Page, when: RegExp) =>
  picker(page).locator("[data-analysis-option]").filter({ hasText: when });

test("the saved-analysis picker is compact, details each analysis, and deletes one or all after asking", async ({
  launch
}) => {
  test.setTimeout(90_000);
  const { page } = await launch();
  await skipWelcome(page);
  await page.evaluate(
    async ([pgn, moves, analyses]) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
      const { game } = await api.games.importPgn({ pgn });
      const saved = await api.games.save({ ...game });
      const byPly = new Map(
        saved.moveTree.filter((node) => node.san).map((node) => [node.ply, node.id])
      );
      // Oldest first, as they'd have been made.
      for (const analysis of [...analyses].reverse()) {
        const [year, month, day, hour, minute] = analysis.at;
        const review: GameReview = {
          reviewId: analysis.reviewId,
          schemaVersion: 2,
          engineId: "sf",
          engineName: analysis.engine,
          depth: null,
          moveTimeMs: analysis.ms,
          createdAt: new Date(year, month, day, hour, minute).getTime(),
          side: "white",
          maiaEngines: [
            { rating: 1100, engineId: "maia-1100", name: "Maia 1100" },
            { rating: 1900, engineId: "maia-1900", name: "Maia 1900" }
          ],
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
          moves: moves.map((move) => ({ ...move, nodeId: byPly.get(move.ply) ?? move.nodeId }))
        };
        await api.games.save({ ...game, id: saved.id, review });
      }
    },
    [TRAP_PGN, trapReviewMoves(), ANALYSES] as const
  );
  await page.reload();

  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();

  // The compact trigger: the newest analysis's date and time, tagged Latest, and nothing more.
  await expect(trigger(page)).toHaveText(/^Oct 4, 4:01\sPM\s*Latest$/);
  const width = (await trigger(page).boundingBox())?.width ?? Infinity;
  expect(width).toBeLessThanOrEqual(240);
  // The details are in its tooltip.
  await trigger(page).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    /Latest · Oct 4, 4:01\sPM · Stockfish 19 · 250 ms\/move · Maia 1100–1900/
  );

  // The list: each analysis's date (Latest on the newest), how it was made, and a check on the one
  // shown.
  await trigger(page).click();
  await expect(picker(page).locator("[data-analysis-option]")).toHaveCount(3);
  const newest = option(page, /Oct 4/);
  await expect(newest).toContainText("Latest");
  await expect(newest).toContainText("Stockfish 19 · 250 ms/move · Maia 1100–1900");
  await expect(newest).toHaveAttribute("aria-current", "true");
  await expect(option(page, /Oct 3/)).toContainText("Stockfish 18 · 1 s/move · Maia 1100–1900");
  await expect(option(page, /Oct 3/)).not.toHaveAttribute("aria-current", "true");
  await expect(option(page, /Oct 3/)).not.toContainText("Latest");
  // The list paints above the review panel and board (it's portalled out of the titlebar), and
  // fits inside the window's right edge.
  for (const row of await picker(page).locator("[data-analysis-option]").all()) {
    const topmost = await row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && element.contains(hit);
    });
    expect(topmost).toBe(true);
  }
  const menuBox = await picker(page).boundingBox();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? Infinity)).toBeLessThanOrEqual(viewportWidth);
  // Up and Down move between them.
  await expect(newest).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(option(page, /Oct 3/)).toBeFocused();

  // Deleting the one shown asks first; Cancel keeps it.
  await picker(page)
    .getByRole("button", { name: /^Delete the analysis of Oct 4/ })
    .click();
  const confirm = page.getByRole("dialog", { name: "Delete this analysis?" });
  await expect(confirm).toContainText("This can't be undone.");
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(trigger(page)).toHaveText(/^Oct 4, 4:01\sPM\s*Latest$/);

  // Confirmed, it goes and the next newest is shown (now the latest).
  await trigger(page).click();
  await picker(page)
    .getByRole("button", { name: /^Delete the analysis of Oct 4/ })
    .click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(trigger(page)).toHaveText(/^Oct 3, 9:05\sAM\s*Latest$/);
  await trigger(page).click();
  await expect(picker(page).locator("[data-analysis-option]")).toHaveCount(2);
  await expect(option(page, /Oct 3/)).toHaveAttribute("aria-current", "true");

  // Delete all asks with the count, then the review is back to Analyze.
  await picker(page)
    .getByRole("button", { name: "Delete all analyses of this game", exact: true })
    .click();
  const confirmAll = page.getByRole("dialog", { name: "Delete all 2 analyses of this game?" });
  await expect(confirmAll).toContainText("This can't be undone.");
  await confirmAll.getByRole("button", { name: "Delete all", exact: true }).click();
  await expect(confirmAll).toHaveCount(0);
  await expect(trigger(page)).toHaveCount(0);
  await expect(titlebar(page).getByRole("button", { name: "Analyze", exact: true })).toBeVisible();

  // The game itself stays, with no analyses, after a restart of the page too.
  await page.reload();
  const left = await page.evaluate(async () => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    const { items } = await api.games.listPage({ filter: "all" });
    return items.map((item) => [item.white, item.reviewCount]);
  });
  expect(left).toEqual([["Alpha", 0]]);
});
