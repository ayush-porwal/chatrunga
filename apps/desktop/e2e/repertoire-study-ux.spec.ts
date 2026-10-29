// Repertoire journeys for a chapter with nothing to practise (its moves kept as reference, as when
// they were played while studying or a whole game was added): Study says why and makes it
// practised in one click, practice explains its empty states and leads back to Study, and a
// rehearsal of the chapter (Practice set to Lines) starts instead of spinning. How to run them:
// playwright.config.ts.
import type { Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { clickSquare, expect, sidebar, skipWelcome, test } from "./app";

const REPERTOIRE = "Sicilian";

/**
 * The user's report: a White repertoire "Sicilian" whose only chapter, "Chapter 1", holds
 * 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 with every move kept as reference. Study opens it after
 * 1... c5. `reference: false` keeps the import default (four decisions); `pgn` replaces the moves.
 */
function seedSicilian(
  page: Page,
  { reference = true, pgn = "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 *" } = {}
) {
  return page.evaluate(
    async ({ reference, pgn }) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
      const created = await api.create({ name: "Sicilian", color: "white" });
      const preview = await api.previewImport({ pgn });
      const imported = await api.commitImport({
        repertoireId: created.id,
        jobId: preview.jobId,
        expectedRevision: created.revision,
        selections: [{ gameIndex: 0, title: "Chapter 1", kind: "opening", include: true }]
      });
      // The repertoire's empty first chapter goes, as an import into a new repertoire does.
      const placeholder = imported.repertoire.chapters.find((chapter) => chapter.nodeCount === 0)!;
      const removed = await api.removeChapter({
        repertoireId: created.id,
        chapterId: placeholder.id,
        expectedRevision: imported.repertoire.revision
      });
      const summary = removed.repertoire.chapters[0];
      let revision = removed.repertoire.revision;
      const chapter = await api.getChapter({ repertoireId: created.id, chapterId: summary.id });
      if (reference) {
        const nodeMeta = Object.fromEntries(
          chapter.tree
            .filter((node) => node.parentId)
            .map((node) => [node.id, { edge: "reference" as const }])
        );
        const saved = await api.saveChapter({
          repertoireId: created.id,
          chapter: { ...chapter, nodeMeta },
          expectedRevision: revision
        });
        revision = saved.repertoire.revision;
      }
      // Study opens after 1... c5, where White decides 2. Nf3.
      const c5 = chapter.tree.find((node) => node.san === "c5")!;
      await api.saveWorkspace({
        repertoireId: created.id,
        workspace: {
          lastChapterId: summary.id,
          lastNodeId: c5.id,
          orientation: "white",
          practiceDraft: null
        }
      });
      return revision;
    },
    { reference, pgn }
  );
}

const studyPanel = (page: Page) => page.getByRole("complementary", { name: "Repertoire study" });
const practicePanel = (page: Page) => page.getByRole("complementary", { name: "Practice" });
const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
/** The study footer's one-click fix when the chapter practises nothing. */
const includeButton = (page: Page) =>
  studyPanel(page).getByRole("button", { name: "Include in practice", exact: true });
const practiceButton = (page: Page) =>
  studyPanel(page).getByRole("button", { name: "Practice", exact: true });

/** The repertoire's unique practised decisions (the hub's Positions column). */
function decisionCount(page: Page) {
  return page.evaluate(async (name) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const [repertoire] = await api.list({ query: name });
    return repertoire.decisionCount;
  }, REPERTOIRE);
}

async function openHub(page: Page) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true })
  ).toBeVisible();
}

async function openStudy(page: Page) {
  await openHub(page);
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await expect(studyPanel(page).getByRole("tree", { name: "Chapter moves" })).toBeVisible();
}

/** The repertoire settings (the tab bar's cog): Practice → Lines, saved. */
async function practiseLines(page: Page) {
  await page.getByRole("button", { name: "Repertoire settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Repertoire settings" });
  await dialog
    .getByRole("radiogroup", { name: "Practice" })
    .getByRole("radio", { name: "Lines", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** The selected move's menu (the starting position's: `name` "Starting position") → `item`. */
async function moveMenu(page: Page, name: string, item: string) {
  await studyPanel(page)
    .getByRole("button", { name: `${name} actions`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("a chapter of reference moves says why, offers no dead buttons, and is practised in one click", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page);
  await openStudy(page);
  const panel = studyPanel(page);

  // Why, in one line: White's moves are kept as reference (why moves start that way is its
  // tooltip); what the fix does is the fix's description.
  const why = panel.getByText("Your moves here are kept as reference.");
  await expect(why).toBeVisible();
  await expect(why).toHaveAttribute("title", /start as reference until you accept them/);
  const include = includeButton(page);
  await expect(include).toHaveAccessibleDescription(
    /accepts your first move at each position.*Undo reverts it/
  );
  expect(await decisionCount(page)).toBe(0);

  // One click: the import default — White's moves accepted, Black's replies covered.
  await include.click();
  await expect(include).toHaveCount(0);
  await expect(why).toHaveCount(0);
  await expect(titlebar(page)).toContainText("Saved");
  await expect.poll(() => decisionCount(page)).toBe(4);

  // Practice now asks the four decisions (nothing is due: the new ones); the first is answered
  // on the board.
  await practiceButton(page).click();
  await expect(practicePanel(page)).toContainText("1 of 4");
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(practicePanel(page).getByText("You played e4.")).toBeVisible();
});

test("Practice set to Lines rehearses the user's chapter instead of spinning", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page);
  await openStudy(page);
  await includeButton(page).click();
  await expect(titlebar(page)).toContainText("Saved");

  // Lines (the repertoire settings): Study's Practice rehearses the open chapter.
  await practiseLines(page);
  await practiceButton(page).click();
  const panel = practicePanel(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("tab", { name: "Rehearsal", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Starting practice" })).toHaveCount(0);
  // The line is played move by move: 1. e4, the chapter's reply 1... c5, then 2. Nf3.
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(panel.getByText("The reply: c5.")).toBeVisible();
  await clickSquare(page, "g1");
  await clickSquare(page, "f3");
  await expect(panel.getByText("The reply: d6.")).toBeVisible();
});

test("practice explains a repertoire with nothing to practise and leads back to Study at the move", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page);
  await openHub(page);
  await page.getByRole("button", { name: `Practice ${REPERTOIRE}`, exact: true }).click();

  // The start finds nothing to ask: the chapter is named with its cause, and the settings are a
  // click away.
  await expect(page.getByText("Nothing to practise in “Chapter 1”")).toBeVisible();
  await expect(page.getByText("1. e4 is reference only", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Practice settings", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Starting practice" })).toHaveCount(0);

  // The way back: Study at the position where the reference move is played (the start), with
  // the footer's why and fix.
  await page.getByRole("button", { name: "Fix in Study", exact: true }).click();
  await expect(includeButton(page)).toBeVisible();
  await expect(studyPanel(page).getByText("Your moves here are kept as reference.")).toBeVisible();
  await expect(
    studyPanel(page).getByRole("button", { name: "Starting position", exact: true })
  ).toHaveAttribute("aria-current", "step");
  await expect(
    studyPanel(page).getByRole("tree", { name: "Chapter moves" }).getByRole("button", {
      name: "e4",
      exact: true
    })
  ).toBeVisible();
});

test("an empty review explains itself and Learn new starts from the same screen", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page, { reference: false });
  await openStudy(page);

  // Positions with no new cards (the repertoire settings): only due ones, and none is due yet.
  await page.getByRole("button", { name: "Repertoire settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Repertoire settings" });
  await expect(settings.getByRole("radio", { name: "Positions", exact: true })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await settings.getByRole("spinbutton", { name: /^New cards/ }).fill("0");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toBeHidden();
  await practiceButton(page).click();
  await expect(page.getByText("No reviews due", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Everything in this scope is scheduled for later.", { exact: false })
  ).toBeVisible();
  // The settings it started with are a click away, as saved.
  await page.getByRole("button", { name: "Practice settings", exact: true }).click();
  await expect(settings.getByRole("spinbutton", { name: /^New cards/ })).toHaveValue("0");
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settings).toBeHidden();

  await page.getByRole("button", { name: "Learn new", exact: true }).click();
  await expect(practicePanel(page)).toContainText("1 of 4");
});

test("rehearsing the chapter knows about paused decisions", async ({ launch }) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page, { reference: false, pgn: "1. e4 c5 2. Nf3 *" });
  await openStudy(page);
  await practiseLines(page);

  // The start's decision (1. e4) paused: the move menu offers to resume it.
  await studyPanel(page).getByRole("button", { name: "Starting position", exact: true }).click();
  await moveMenu(page, "Starting position", "Pause practice for this position");
  await expect(titlebar(page)).toContainText("Saved");
  const startActions = studyPanel(page).getByRole("button", {
    name: "Starting position actions",
    exact: true
  });
  await startActions.click();
  await expect(
    page.getByRole("menuitem", { name: "Resume practice for this position", exact: true })
  ).toBeVisible();
  await startActions.click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  // The rehearsal plays 1. e4 for you and asks 2. Nf3 after the reply.
  await practiceButton(page).click();
  const panel = practicePanel(page);
  await expect(panel.getByRole("tab", { name: "Rehearsal", exact: true })).toBeVisible();
  await expect(panel.getByText("The reply: c5.")).toBeVisible();
  await clickSquare(page, "g1");
  await clickSquare(page, "f3");
  await expect(panel.getByText("Line complete", { exact: false })).toBeVisible();

  // With 2. Nf3 paused too, nothing in the chapter is asked, and practice says so.
  await openStudy(page);
  await studyPanel(page)
    .getByRole("tree", { name: "Chapter moves" })
    .getByRole("button", { name: "c5", exact: true })
    .click();
  await moveMenu(page, "c5", "Pause practice for this position");
  await expect(titlebar(page)).toContainText("Saved");
  await practiceButton(page).click();
  await expect(page.getByText("Nothing to rehearse from here", { exact: true })).toBeVisible();
  await expect(
    page.getByText("paused decisions are played for you", { exact: false })
  ).toBeVisible();
  await expect(practicePanel(page)).toHaveCount(0);
});

test("Include in practice asks before accepting a move where another chapter plays a different one", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  const revision = await seedSicilian(page);
  // Another chapter practises 2. c3 after 1. e4 c5 (an import's default).
  await page.evaluate(
    async ({ name, revision }) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
      const [repertoire] = await api.list({ query: name });
      const preview = await api.previewImport({ pgn: "1. e4 c5 2. c3 *" });
      await api.commitImport({
        repertoireId: repertoire.id,
        jobId: preview.jobId,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "Alapin", kind: "opening", include: true }]
      });
    },
    { name: REPERTOIRE, revision }
  );
  await openStudy(page);
  // "Alapin" practises 1. e4 and 2. c3; this chapter nothing.
  await expect(includeButton(page)).toBeVisible();
  expect(await decisionCount(page)).toBe(2);

  // Accepting 2. Nf3 there would change what "Alapin" practises too: it asks first.
  await includeButton(page).click();
  const question = page.getByRole("dialog", { name: "Include in practice?" });
  await expect(question).toContainText(
    "Your other chapters play a different move after 1. e4 c5. Including also accepts 2. Nf3 there."
  );
  await question.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(includeButton(page)).toBeVisible();
  expect(await decisionCount(page)).toBe(2);

  await includeButton(page).click();
  await question.getByRole("button", { name: "Include anyway", exact: true }).click();
  await expect(includeButton(page)).toHaveCount(0);
  await expect(titlebar(page)).toContainText("Saved");
  // 2. Nf3, 3. d4 and 4. Nxd4 join the start's 1. e4 (shared with "Alapin").
  await expect.poll(() => decisionCount(page)).toBe(4);
});
