// Playing Maia 3 through the built app, on its e2e stand-in (`maia3Fixture`: installed, answering at
// once with a move drawn from its own weights, so legal but not always the same one). Maia is one
// opponent whose rating Play settings choose (600–2600, remembered), the game names it "Maia
// <rating>" and it replies with a legal move; a game saved against Maia 1 ("Maia 1500 (managed)",
// an engine since removed) rejoins against Maia 3 at 1500; and without Maia 3, Play settings offer
// its download (the user's to start). How to run them: playwright.config.ts.
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import {
  clickSquare,
  expect,
  mainRecord,
  registerFakeEngine,
  sidebar,
  skipWelcome,
  test
} from "./app";
/** Black's twenty legal replies to 1. e4, as SAN. */
const REPLIES_TO_E4 = [
  ..."abcdefgh".split("").flatMap((file) => [`${file}6`, `${file}5`]),
  "Na6",
  "Nc6",
  "Nf6",
  "Nh6"
];

/** A game against a Maia 1 network, saved by an older build: 1. e4 played, Maia to move. */
const MAIA1_GAME_PGN = `[Event "Engine game"]
[White "You"]
[Black "Maia 1500 (managed)"]
[Result "*"]

1. e4 *
`;

const playCard = (page: Page) => page.getByRole("region", { name: "Play", exact: true });
const playSettings = (page: Page) => page.getByRole("dialog", { name: "Play settings" });
const gameMoves = (page: Page) =>
  page.getByRole("tree", { name: "Game moves" }).locator("[data-move-cell]");

/** Whether main has listed Maia 3's engine (the registry sync adds it once assets are read). */
function maiaListed(page: Page) {
  return page.evaluate(async () => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    return (await api.engines.list()).some((engine) => engine.runtime === "maia3");
  });
}

/** The newest library game's players and Black's Elo, as saved. */
function newestGame(page: Page) {
  return page.evaluate(async () => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    const item = (await api.games.listPage({ limit: 1 })).items.at(0);
    if (!item) return null;
    const { headers } = await api.games.get(item.id);
    return { white: headers?.white, black: headers?.black, blackElo: headers?.blackElo };
  });
}

/** After 1. e4 on the board: Black's reply arrives, a legal one. */
async function expectLegalReplyToE4(page: Page) {
  await expect(gameMoves(page)).toHaveCount(2);
  const reply = await gameMoves(page)
    .nth(1)
    .locator("[data-tree-node-id]")
    .getAttribute("aria-label");
  expect(REPLIES_TO_E4).toContain(reply);
}

test("Maia plays at the rating chosen in Play settings, named for it, and replies with a legal move", async ({
  launch
}) => {
  const { page } = await launch(undefined, { maia3Fixture: true });
  await skipWelcome(page);
  await expect.poll(() => maiaListed(page)).toBe(true);
  await sidebar(page).getByRole("button", { name: "Play", exact: true }).click();

  // Play settings: Maia's rating beside it, one choice per 100 points from 600 to 2600.
  await playCard(page).getByRole("button", { name: "Play settings" }).click();
  const rating = playSettings(page).getByRole("combobox", { name: "Maia's rating" });
  await expect(rating.locator("option")).toHaveCount(21);
  await expect(rating.locator("option").first()).toHaveText("600");
  await expect(rating.locator("option").last()).toHaveText("2600");
  await rating.selectOption("1100");
  await expect(
    playSettings(page).getByRole("radio", { name: "Engine: Maia 1100", exact: true })
  ).toHaveAttribute("aria-checked", "true");
  await playSettings(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(playSettings(page)).toHaveCount(0);
  // The card plays Maia at that rating, and remembers it.
  await expect(playCard(page).getByText("Maia 1100", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
        return (await api.settings.getAll()).playMaiaRating;
      })
    )
    .toBe(1100);

  // Untimed, Maia answers at once: 1. e4 and its reply.
  await playCard(page).getByRole("button", { name: "Start game", exact: true }).click();
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expectLegalReplyToE4(page);
  await expect(page.getByText("Maia 1100", { exact: true }).first()).toBeVisible();
  // Saved as played: Maia named for its rating, its Elo that rating.
  await expect
    .poll(() => newestGame(page))
    .toEqual({ white: "You", black: "Maia 1100", blackElo: "1100" });
});

test("a game saved against Maia 1 rejoins against Maia 3 at its rating", async ({ launch }) => {
  const { page } = await launch(undefined, { maia3Fixture: true });
  await skipWelcome(page);
  await expect.poll(() => maiaListed(page)).toBe(true);
  // Saved through the preload bridge (set-up, not the journey), with the id of an engine that is
  // gone (Maia 1's rows are removed).
  await page.evaluate(async (pgn) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    const { game } = await api.games.importPgn({ pgn });
    await api.games.save({
      ...game,
      source: "engine-game",
      headers: { ...game.headers, engineId: "maia-1500-removed" }
    });
  }, MAIA1_GAME_PGN);
  await page.reload();

  await sidebar(page).getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByText("You vs Maia 1500", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Rejoin/ }).click();
  // Played on (not only opened): Maia 3, at the 1500 in the game's name, answers 1. e4.
  await expectLegalReplyToE4(page);
  await expect(page.getByText(/isn't installed, so the game opened on the board/)).toHaveCount(0);
  await expect(page.getByText("Maia 1500", { exact: true }).first()).toBeVisible();
});

test("without Maia 3, Play settings offer its download", async ({ launch, profile }) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "fake-engine.log"), "stockfish");
  await sidebar(page).getByRole("button", { name: "Play", exact: true }).click();
  await playCard(page).getByRole("button", { name: "Play settings" }).click();

  // Maia isn't one of the engines; the Engines group says it is available, with its size.
  await expect(playSettings(page).getByText("Maia 3 is available", { exact: true })).toBeVisible();
  await expect(
    playSettings(page).getByRole("button", { name: /^Download \(\d+\.\d MB\)$/ })
  ).toBeVisible();
  await expect(playSettings(page).getByRole("combobox", { name: "Maia's rating" })).toHaveCount(0);
  // Offered, not started: nothing asked for the model.
  const { fetches } = await mainRecord(app);
  expect(fetches.filter((url) => url.includes("maia3"))).toEqual([]);
});
