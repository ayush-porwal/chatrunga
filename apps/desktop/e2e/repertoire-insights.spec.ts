// Repertoire → Insights through the built app (docs/repertoire-games-and-practice.md §5): a game
// of the connected chess.com account that left a White repertoire at move 2 is compared in the
// background, shows in the report's "Moves you forgot" and in the Games list, and Review game
// opens it in Game review with Back to Insights. The network is off in these runs (chess.com
// answers from fixtures); how to run them: playwright.config.ts.
import type { ElectronApplication, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { desktopDir, expect, importPgnFile, routeToFile, sidebar, skipWelcome, test } from "./app";
import { writePgn } from "./fixtures";

const API = "https://api.chess.com/pub/player/ayush_p64";
const FIXTURES = join(desktopDir, "src/main/chesscom/__fixtures__");
const REPERTOIRE = "Insights e2e";

/** The user's game (White is the chess.com account): 2. Bc4 where the repertoire plays 2. Nf3. */
const MY_GAME_PGN = `[Event "E2E insights game"]
[White "ayush_p64"]
[Black "e2e_rival"]
[Result "1-0"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0
`;

/** Chess.com's answers for the account: its profile and ratings, and no games of its own. */
async function serveChesscom(app: ElectronApplication, profile: string): Promise<void> {
  const archives = join(profile, "chesscom-archives.json");
  writeFileSync(archives, JSON.stringify({ archives: [] }));
  const routes: [string, string][] = [
    [API, join(FIXTURES, "profile.json")],
    [`${API}/stats`, join(FIXTURES, "stats.json")],
    [`${API}/games/archives`, archives]
  ];
  for (const [url, file] of routes) await routeToFile(app, url, file);
}

async function connectChesscom(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Settings", exact: true }).click();
  const card = page.locator("#settings-chesscom");
  await card.getByLabel("Chess.com username").fill("ayush_p64");
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(card.getByText("Ayush_P64", { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** A White repertoire of 1. e4 e5 2. Nf3, through the preload bridge (set-up, not the journey). */
function seedRepertoire(page: Page) {
  return page.evaluate(async (name) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const created = await api.create({ name, color: "white" });
    const preview = await api.previewImport({ pgn: '[Event "Open game"]\n\n1. e4 e5 2. Nf3 *' });
    await api.commitImport({
      repertoireId: created.id,
      jobId: preview.jobId,
      expectedRevision: created.revision,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: "Open game",
        kind: "opening" as const,
        include: true
      }))
    });
  }, REPERTOIRE);
}

test("Insights reports a move forgotten in a real game and opens it in Game review", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  await skipWelcome(page);
  await serveChesscom(app, profile);
  await connectChesscom(page);
  await seedRepertoire(page);
  await importPgnFile(app, page, writePgn(profile, "my-game.pgn", MY_GAME_PGN));
  await expect(
    page
      .getByRole("tree", { name: "Game moves" })
      .getByRole("button", { name: "Qxf7#", exact: true })
  ).toBeVisible();

  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("tab", { name: "Insights" }).click();

  // The comparer runs in the background once the changes settle.
  const report = page.getByRole("region", { name: "Report" });
  const forgot = report.getByRole("region", { name: "Moves you forgot" });
  await expect(forgot).toBeVisible({ timeout: 30_000 });
  await expect(forgot).toContainText(REPERTOIRE);
  await expect(forgot).toContainText("2.Nf3");
  await expect(forgot).toContainText("You played 2.Bc4 (1)");
  await expect(forgot).toContainText("100%");

  // The filters live in a dialog behind the tab bar's funnel; the funnel names what they leave out.
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filters" });
  await filters
    .getByRole("group", { name: "Time controls" })
    .getByRole("button", { name: /Bullet/ })
    .click();
  await filters.getByRole("button", { name: "Done" }).click();
  const narrowed = page.getByRole("button", { name: /^Filters: .*Blitz/ });
  await expect(narrowed).toBeVisible();
  await narrowed.click();
  await filters.getByRole("button", { name: "Reset" }).click();
  await filters.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();

  // Its games link filters the Games card to that position.
  await forgot.getByRole("button", { name: "1 game", exact: true }).click();
  const games = page.getByRole("region", { name: "Games" });
  await expect(games.getByRole("button", { name: "Show all games", exact: true })).toBeVisible();
  const row = games.getByRole("list", { name: "Games" }).getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("e2e_rival");
  await expect(row).toContainText("Won");
  await expect(row).toContainText("Forgot 2.Nf3");

  // Review opens Game review at the move, with Back to Insights.
  await row.getByRole("button", { name: "Review game", exact: true }).click();
  const back = page.getByRole("button", { name: "Back to Insights", exact: true });
  await expect(back).toBeVisible({ timeout: 20_000 });
  await back.click();
  await expect(page.getByRole("tab", { name: "Insights" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});
