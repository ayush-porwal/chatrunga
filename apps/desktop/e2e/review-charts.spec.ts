// The review's linked charts through the built app: winning chances, Maia difficulty and move times
// share one move axis, one hover tooltip and one current-move line, and a click jumps the board;
// each strip folds (remembered) and so does the whole Charts section; a splitter along their top
// sets their height (double-click resets it); without Maia the difficulty strip is a one-line
// install prompt, and without [%clk] there is no move-times strip. Reviewed on the fake UCI
// engine's "review" mode (the Blackburne Shilling trap, as move-types.spec.ts), with a fake Maia
// (fake-uci.mjs replaying captured lc0 policy output). How to run them: playwright.config.ts.
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import {
  desktopDir,
  expect,
  importPgnFile,
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

function trapPgn(withClocks: boolean): string {
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
${withClocks ? '[TimeControl "180+2"]\n' : ""}[Result "0-1"]

${moves.join(" ")} 0-1
`;
}

const FAKE_MAIA = join(desktopDir, "src/main/engine/__fixtures__/fake-uci.mjs");

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const charts = (page: Page) => page.getByRole("region", { name: "Game charts" });
const view = (page: Page, name: "winning-chances" | "difficulty" | "times") =>
  charts(page).locator(`svg[data-chart="${name}"]`);
const counter = (page: Page) =>
  page.getByRole("navigation", { name: "Move navigation" }).getByRole("paragraph").first();
const splitter = (page: Page) => page.getByRole("separator", { name: "Resize the charts" });

/** Imports the trap game, reviews it as White and ends on the review page with the charts. */
async function reviewTrap({ app, page }: LaunchedApp, profile: string, withClocks: boolean) {
  await importPgnFile(app, page, writePgn(profile, "trap.pgn", trapPgn(withClocks)));
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
  const launched = await launch();
  const { page } = launched;
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "uci.log"), "review");
  await page.evaluate(
    ([executablePath, script]) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
      return api.engines.create({
        name: "Maia 1500",
        executablePath,
        args: [script, "maia"],
        maiaRating: 1500,
        isHumanPrediction: true
      });
    },
    [process.execPath, FAKE_MAIA] as const
  );
  await reviewTrap(launched, profile, true);

  // Three views on one axis, each under its own folding label.
  await expect(view(page, "winning-chances")).toBeVisible();
  await expect(view(page, "difficulty")).toBeVisible();
  await expect(view(page, "times")).toBeVisible();
  await expect(charts(page).getByRole("button", { name: "Winning chances" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  await expect(
    charts(page).getByRole("button", { name: "Difficulty at 1500 · Maia" })
  ).toBeVisible();
  await expect(charts(page).getByRole("button", { name: "Time per move" })).toBeVisible();
  // The header keeps the key-insight navigation.
  await expect(charts(page).getByRole("group", { name: "Key insights" })).toBeVisible();

  // Hovering a move shows one tooltip for all three views: 4. Nxe5's blunder and its time.
  const nxe5 = view(page, "winning-chances").locator('circle[data-ply="7"]');
  await expect(nxe5).toHaveAttribute("data-annotation", "blunder");
  await nxe5.hover();
  const tooltip = charts(page).locator("[data-chart-tooltip]");
  await expect(tooltip).toContainText("4. Nxe5 · Blunder");
  await expect(tooltip).toContainText(/You \d+% · Opponent \d+%/);
  await expect(tooltip).toContainText("0:06 spent");
  // The same move's bar on the time strip shows the same tooltip.
  await view(page, "times").locator('rect[data-ply="7"]').hover();
  await expect(tooltip).toContainText("4. Nxe5 · Blunder");

  // A click jumps the board there; the current-move line follows in every view.
  await nxe5.click();
  await expect(counter(page)).toHaveText("7 / 14");
  await expect(charts(page).locator("[data-current-move]")).toHaveCount(3);
  // Focused, the charts step through the moves with the arrow keys.
  await charts(page)
    .getByRole("group", { name: /Winning chances, difficulty/ })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(counter(page)).toHaveText("8 / 14");

  // Each strip folds on its own, remembered across a reload. Under a height set with the splitter,
  // folding hands its height to the others (unset, the charts take the default for the views shown).
  await splitter(page).focus();
  await page.keyboard.press("ArrowUp");
  const winHeight = async () => (await view(page, "winning-chances").boundingBox())?.height ?? 0;
  const before = await winHeight();
  await charts(page).getByRole("button", { name: "Time per move" }).click();
  await expect(view(page, "times")).toHaveCount(0);
  await expect.poll(winHeight).toBeGreaterThan(before);
  // A reloaded page starts without the game: it is opened again from the picker, once its review
  // is saved.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
        const { items } = await api.games.listPage({ filter: "all" });
        return items.map((item) => [item.white, item.reviewCount]);
      })
    )
    .toEqual([["Alpha", 1]]);
  await page.reload();
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  await expect(charts(page)).toBeVisible();
  await expect(view(page, "times")).toHaveCount(0);
  await charts(page).getByRole("button", { name: "Time per move" }).click();
  await expect(view(page, "times")).toBeVisible();
  // Back to the default height.
  await splitter(page).dblclick();

  // The whole Charts section folds to its header (the key insights stay), and the splitter goes.
  await charts(page).getByRole("button", { name: "Charts" }).click();
  await expect(view(page, "winning-chances")).toHaveCount(0);
  await expect(splitter(page)).toHaveCount(0);
  await expect(charts(page).getByRole("group", { name: "Key insights" })).toBeVisible();
  await charts(page).getByRole("button", { name: "Charts" }).click();
  await expect(view(page, "winning-chances")).toBeVisible();

  // The splitter: dragging it up makes the charts taller, as far as the content above leaves room
  // (its aria-valuemax); a double-click resets the height; the arrow keys step it.
  const initial = Number(await splitter(page).getAttribute("aria-valuenow"));
  const max = Number(await splitter(page).getAttribute("aria-valuemax"));
  expect(max).toBeGreaterThan(initial + 16);
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
  await splitter(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(splitter(page)).toHaveAttribute("aria-valuenow", String(initial + 16));
  await splitter(page).dblclick();
});

test("without Maia the difficulty strip is an install prompt, and without clocks there are no move times", async ({
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
  await expect(charts(page).getByText("Difficulty needs a Maia model.")).toBeVisible();
  await expect(view(page, "times")).toHaveCount(0);
  await expect(charts(page).getByRole("button", { name: "Time per move" })).toHaveCount(0);

  // The prompt's link opens Settings at the engine downloads, where Maia is installed.
  await charts(page).getByRole("button", { name: "Install Maia" }).click();
  await expect(page.getByRole("heading", { name: "Engine downloads" })).toBeVisible();
});

test("the Analyze page shows the Charts for an unreviewed game: its clocks, no evaluations, no Difficulty", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "clocked.pgn", trapPgn(true)));
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(counter(page)).toHaveText("14 / 14");

  await expect(charts(page).getByRole("button", { name: "Charts" })).toBeVisible();
  // The Winning chances strip is there, waiting for a review; no Maia prompt on Analyze.
  await expect(charts(page).getByRole("button", { name: "Winning chances" })).toBeVisible();
  await expect(charts(page).getByText("No evaluations yet")).toBeVisible();
  await expect(view(page, "difficulty")).toHaveCount(0);
  await expect(charts(page).getByText("Difficulty needs")).toHaveCount(0);
  // Time per move from the clocks, linked to the board.
  await expect(view(page, "times")).toBeVisible();
  await view(page, "times").locator('rect[data-ply="7"]').click();
  await expect(counter(page)).toHaveText("7 / 14");
});
