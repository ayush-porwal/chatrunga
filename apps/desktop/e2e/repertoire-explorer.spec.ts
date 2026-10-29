// Study's Explorer through the built app (docs/repertoire-games-and-practice.md §6): the user's
// own game at the selected position (a game played by a connected chess.com account, read into
// the position index in the background), Maia 3's likely moves (its e2e stand-in), and the health
// check on a scripted engine flagging a practised move the engine dislikes. The network is off in
// these runs (chess.com answers from fixtures); how to run them: playwright.config.ts.
import type { ElectronApplication, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import {
  desktopDir,
  expect,
  importPgnFile,
  registerFakeEngine,
  routeToFile,
  sidebar,
  skipWelcome,
  test
} from "./app";
import { writePgn } from "./fixtures";

const API = "https://api.chess.com/pub/player/ayush_p64";
const FIXTURES = join(desktopDir, "src/main/chesscom/__fixtures__");
const REPERTOIRE = "Explorer e2e";

/** The user's game (White is the chess.com account): 1. f3, and mated two moves later. */
const MY_GAME_PGN = `[Event "E2E my game"]
[White "ayush_p64"]
[Black "e2e_rival"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1
`;

/** A 1×1 PNG: the account's picture. */
const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** Chess.com's answers for the account: its profile, picture and ratings, and no games of its own. */
async function serveChesscom(app: ElectronApplication, profile: string): Promise<void> {
  const archives = join(profile, "chesscom-archives.json");
  writeFileSync(archives, JSON.stringify({ archives: [] }));
  const avatar = join(profile, "chesscom-avatar.png");
  writeFileSync(avatar, AVATAR_PNG);
  const routes: [string, string][] = [
    // profile.json's `avatar`.
    ["https://images.chesscomfiles.com/uploads/v1/user/1.png", avatar],
    [API, join(FIXTURES, "profile.json")],
    [`${API}/stats`, join(FIXTURES, "stats.json")],
    [`${API}/games/archives`, archives]
  ];
  for (const [url, file] of routes) await routeToFile(app, url, file);
}

/** Connects the fixture account from Settings (the account the game's White is). */
async function connectChesscom(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Settings", exact: true }).click();
  const card = page.locator("#settings-chesscom");
  await card.getByLabel("Chess.com username").fill("ayush_p64");
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(card.getByText("Ayush_P64", { exact: true })).toBeVisible({ timeout: 20_000 });
}

/**
 * A White repertoire of 1. f3 e5 2. g4, which "Study" opens at its start, through the preload
 * bridge (set-up, not the journey).
 */
function seedRepertoire(page: Page) {
  return page.evaluate(async (name) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const created = await api.create({ name, color: "white" });
    const preview = await api.previewImport({ pgn: '[Event "Bird"]\n\n1. f3 e5 2. g4 *' });
    const imported = await api.commitImport({
      repertoireId: created.id,
      jobId: preview.jobId,
      expectedRevision: created.revision,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: "Bird",
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

test("the Explorer shows the user's games, Maia's likely moves and a health flag", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch(undefined, { maia3Fixture: true });
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "fake-engine.log"), "health");
  await serveChesscom(app, profile);
  await connectChesscom(page);
  await importPgnFile(app, page, writePgn(profile, "my-game.pgn", MY_GAME_PGN));
  await expect(
    page
      .getByRole("tree", { name: "Game moves" })
      .getByRole("button", { name: "Qh4#", exact: true })
  ).toBeVisible();
  await seedRepertoire(page);

  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  const panel = studyPanel(page);
  await panel.getByRole("tab", { name: "Explorer" }).click();

  // Your games: the one game played 1. f3 here and lost; 1. f3 is the repertoire's move. The index
  // is read in the background, so the row may take a moment.
  const games = panel.getByRole("table", { name: "Your games" });
  const f3 = games.getByRole("row").filter({ hasText: "1.f3" });
  await expect(f3).toBeVisible({ timeout: 20_000 });
  await expect(f3).toContainText("0%");
  await expect(f3).toContainText("In repertoire");
  await expect(panel).toContainText("Filters: all time · all time controls (set in Insights)");

  // Likely replies: Maia 3 (the stand-in) at the user's rating; it is White's own move here.
  const maia = panel.getByRole("region", { name: "Likely replies (Maia 3)" });
  await expect(maia).toContainText(/Players rated \d+–\d+ play:/);
  await expect(
    maia.getByRole("list", { name: "Likely moves" }).getByRole("listitem")
  ).not.toHaveCount(0);

  // Health: Run check flags 1. f3, which the engine scores 18% below 1. e4.
  const health = panel.getByRole("region", { name: "Health" });
  await expect(health).toContainText("No flags at this position.");
  await health.getByRole("button", { name: "Run check", exact: true }).click();
  const flag = health.getByRole("list", { name: "Health flags" }).getByRole("listitem");
  await expect(flag).toContainText("Weak move", { timeout: 30_000 });
  await expect(flag).toContainText("1.f3: −18% win chance; the engine prefers 1.e4.");
});
