// A chess.com account through the built app: connecting a username imports its games, which the
// library and Game review's Choose a game list under their own source tab (with Reviewed on top of
// any tab), Home names each game's source, the ratings follow the account, and disconnecting can
// take the games away. Chess.com's API is served from the unit tests' fixtures (the network is off
// in these runs); how to run them: playwright.config.ts.
import type { ElectronApplication, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import type { GameReview } from "../../../packages/shared/src/types/engine";
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
import { RUY_LOPEZ_PGN, writePgn } from "./fixtures";

const API = "https://api.chess.com/pub/player/ayush_p64";
const FIXTURES = join(desktopDir, "src/main/chesscom/__fixtures__");

/** Chess.com's answers for the account: its profile, ratings and three months of games. */
async function serveChesscom(app: ElectronApplication, profile: string): Promise<void> {
  const emptyMonth = join(profile, "chesscom-empty-month.json");
  writeFileSync(emptyMonth, JSON.stringify({ games: [] }));
  const routes: [string, string][] = [
    [API, join(FIXTURES, "profile.json")],
    [`${API}/stats`, join(FIXTURES, "stats.json")],
    [`${API}/games/archives`, join(FIXTURES, "archives.json")],
    [`${API}/games/2026/08`, emptyMonth],
    [`${API}/games/2026/09`, join(FIXTURES, "archive-2026-09.json")],
    [`${API}/games/2026/10`, join(FIXTURES, "archive-2026-10.json")]
  ];
  for (const [url, file] of routes) await routeToFile(app, url, file);
}

const chesscomCard = (page: Page) => page.locator("#settings-chesscom");
const ratingsGroup = (page: Page) => page.getByRole("region", { name: "Ratings", exact: true });
const library = (page: Page) => page.getByRole("region", { name: "Library" });
const sourceTabs = (scope: Page | ReturnType<Page["locator"]>) =>
  scope.getByRole("radiogroup", { name: "Game source" });
const savedGames = (page: Page) => page.getByRole("list", { name: "Saved games" });

async function openSettings(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** Connects the fixture account from Settings, every game imported, and waits for the import. */
async function connect(page: Page): Promise<void> {
  await openSettings(page);
  const card = chesscomCard(page);
  await card.getByLabel("Chess.com username").fill("ayush_p64");
  await card.getByLabel("First import").selectOption("all");
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(card.getByText("Ayush_P64", { exact: true })).toBeVisible();
  // The fixtures hold three standard games (and a Chess960 one, which isn't imported).
  await expect(card).toContainText("3 games.", { timeout: 20_000 });
}

/** Saves an analysis of the newest chess.com game, as a review would (set-up, not the journey). */
async function reviewNewestChesscomGame(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    const [summary] = (await api.games.listPage({ tab: "chesscom", limit: 1 })).items;
    if (!summary) throw new Error("no chess.com game");
    const saved = await api.games.get(summary.id);
    const review: GameReview = {
      reviewId: "e2e-chesscom",
      schemaVersion: 2,
      engineId: "sf",
      engineName: "Stockfish 17",
      depth: null,
      moveTimeMs: 250,
      createdAt: Date.now(),
      side: "black",
      maiaEngines: [],
      summary: {
        totalMoves: 0,
        best: 0,
        excellent: 0,
        good: 0,
        inaccuracies: 0,
        mistakes: 0,
        blunders: 0,
        missedTactics: 0,
        averageCentipawnLoss: 0
      },
      moves: []
    };
    await api.games.save({
      id: saved.id,
      source: saved.source,
      headers: saved.headers ?? {},
      rootFen: saved.initialFen ?? saved.moveTree[0]!.fenAfter,
      currentFen: saved.currentFen,
      currentNodeId: saved.currentNodeId ?? null,
      pgn: saved.pgn,
      moveTree: saved.moveTree,
      review
    });
  });
}

test("a chess.com account imports its games under their own source, in the library, Choose a game and Home", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  await skipWelcome(page);
  await serveChesscom(app, profile);
  await registerFakeEngine(page, join(profile, "fake-engine.log"), "stockfish");
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  await expect(
    page.getByRole("tree", { name: "Game moves" }).getByRole("button", { name: "a6", exact: true })
  ).toBeVisible();
  // Analysing a game doesn't change where it came from: it stays an imported game.
  await page.getByRole("tab", { name: "Engine" }).click();
  const analysis = page.getByRole("switch", { name: "Analysis" });
  await analysis.click();
  await expect(analysis).toHaveAttribute("aria-checked", "true");
  await page.getByRole("tab", { name: "Library" }).click();
  await expect(savedGames(page).getByRole("listitem")).toHaveCount(1);
  await expect(savedGames(page)).toContainText("Imported · E2E smoke · *");
  await page.getByRole("tab", { name: "Engine" }).click();
  await analysis.click();
  await expect(analysis).toHaveAttribute("aria-checked", "false");

  await connect(page);
  const card = chesscomCard(page);
  for (const badge of ["Rapid 1684", "Blitz 1662", "Bullet 1490", "Daily 1550"])
    await expect(card.getByText(badge, { exact: true })).toBeVisible();
  // Only chess.com is connected: it fills the ratings (Daily is Correspondence), read-only;
  // Classical has no chess.com rating and stays an input. No picker with one account.
  const ratings = ratingsGroup(page);
  await expect(ratings.getByRole("group", { name: "Rapid", exact: true })).toHaveText(/1684/);
  await expect(ratings.getByRole("group", { name: "Correspondence", exact: true })).toHaveText(
    /1550/
  );
  await expect(ratings.getByRole("spinbutton", { name: "Classical", exact: true })).toBeEditable();
  await expect(ratings.getByRole("radiogroup", { name: "Ratings from" })).toHaveCount(0);
  await reviewNewestChesscomGame(page);

  // The library has a tab per source it holds, with its count, and lists one at a time. It opens
  // on the board's game's tab: the sidebar's Analyze keeps it an imported game.
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await page.getByRole("tab", { name: "Library" }).click();
  const tabs = sourceTabs(library(page));
  await expect(tabs.getByRole("radio")).toHaveText(["Chess.com3", "Imported1"]);
  await expect(tabs.getByRole("radio", { name: /^Imported/ })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(savedGames(page).getByRole("listitem")).toHaveCount(1);
  await expect(savedGames(page)).toContainText("Imported · E2E smoke · *");

  await tabs.getByRole("radio", { name: /^Chess\.com/ }).click();
  const rows = savedGames(page).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("rook_n_roll vs ayush_p64");
  await expect(rows.first()).toContainText("Chess.com · Live Chess · 0-1");
  await expect(library(page)).toContainText("3 games");
  // Reviewed works on top of the tab.
  await library(page)
    .getByRole("button", { name: /^Reviewed/ })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(library(page)).toContainText("1 game");
  await library(page)
    .getByRole("button", { name: /^Reviewed/ })
    .click();
  await expect(rows).toHaveCount(3);

  // Choose a game opens on the tab chosen last; the board's game stays pinned on top.
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose a game" });
  await expect(sourceTabs(picker).getByRole("radio", { name: /^Chess\.com/ })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  // Pinned whatever the tab, still an imported game.
  await expect(picker.getByRole("button", { name: /^Alpha vs Beta/ })).toContainText(
    "Imported · E2E smoke"
  );
  const saved = picker.getByRole("button", { name: / vs / }).filter({ hasNotText: "Alpha" });
  await expect(saved).toHaveCount(3);
  await expect(saved.first()).toContainText("Chess.com · Live Chess");
  // Search stays within the tab.
  await picker.getByRole("textbox", { name: "Search saved games" }).fill("castle_queen");
  await expect(saved).toHaveCount(1);
  await picker.getByRole("textbox", { name: "Search saved games" }).fill("");
  await picker.getByRole("button", { name: /^Reviewed/ }).click();
  await expect(saved).toHaveCount(1);
  await expect(saved.first()).toContainText("Reviewed");
  await sourceTabs(picker)
    .getByRole("radio", { name: /^Imported/ })
    .click();
  await expect(saved).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  // Home names where each game came from.
  await sidebar(page).getByRole("button", { name: "Home", exact: true }).click();
  const continueCard = page.getByRole("region", { name: /vs/ }).first();
  await expect(continueCard.getByText("Source", { exact: true })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent games" });
  await expect(recent).toContainText("Chess.com · Live Chess");
});

test("disconnecting chess.com can remove its games; the ratings stay, typed-in", async ({
  launch,
  profile
}) => {
  test.setTimeout(90_000);
  const { app, page } = await launch();
  await skipWelcome(page);
  await serveChesscom(app, profile);
  await connect(page);

  const card = chesscomCard(page);
  await card.getByRole("button", { name: "Disconnect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Disconnect Ayush_P64?" });
  await expect(dialog).toContainText("Nothing changes on chess.com.");
  const remove = dialog.getByRole("switch", { name: "Also remove imported Chess.com games" });
  await expect(remove).toHaveAttribute("aria-checked", "false");
  await remove.click();
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByLabel("Chess.com username")).toBeVisible();

  const ratings = ratingsGroup(page);
  await expect(ratings.getByRole("spinbutton", { name: "Rapid", exact: true })).toHaveValue("1684");
  await expect(ratings.getByRole("spinbutton", { name: "Rapid", exact: true })).toBeEditable();

  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await page.getByRole("tab", { name: "Library" }).click();
  await expect(library(page)).toContainText("Saved games will appear here.");
  await expect(sourceTabs(library(page))).toHaveCount(0);
});
