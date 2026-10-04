// Repertoire journeys for a chapter with nothing to practise (its moves kept as reference, as when
// they were played while studying or a whole game was added): Study says why and makes it
// practised in one click, practice explains its empty states and leads back to Study, and Rehearse
// this chapter starts instead of spinning. How to run them: playwright.config.ts.
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
      // The repertoire's empty first chapter goes, as "Create and import PGN" does.
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
      // Study opens after 1... c5, where "Your choices here" lists 2. Nf3.
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
const notice = (page: Page) => page.getByRole("status", { name: "Why nothing is practised" });

async function openHub(page: Page) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true })
  ).toBeVisible();
}

async function openStudy(page: Page) {
  await openHub(page);
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await expect(studyPanel(page).getByText("Decisions", { exact: true })).toBeVisible();
}

test("a chapter of reference moves says why, offers no dead buttons, and is practised in one click", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page);
  await openStudy(page);
  const panel = studyPanel(page);

  // Why, in one sentence: White's first move is kept as reference, so nothing after it is asked.
  // What the fix does (and why moves start as reference) is its description and tooltip.
  await expect(
    notice(page).getByText("1. e4 is reference only, so nothing from it on is asked.", {
      exact: true
    })
  ).toBeVisible();
  const include = notice(page).getByRole("button", { name: "Include in practice", exact: true });
  await expect(include).toHaveAccessibleDescription(
    /start as reference until you accept them.*Undo reverts it/
  );
  await include.hover();
  await expect(page.getByRole("tooltip")).toContainText("accepts your first move at each position");
  await expect(panel.getByText("0 in this chapter")).toBeVisible();

  // The choice explains itself instead of "Not trained here / reference".
  const choices = panel.getByRole("region", { name: "Choices at this position" });
  await expect(choices.getByText(/^Not practised:/)).toBeVisible();
  await expect(
    choices.getByText("kept as reference · not practised because 1. e4 is reference only")
  ).toBeVisible();

  // The training marks: plain names, their state and effect, tucked under Advanced.
  const practiceHere = panel.getByRole("region", { name: "Practice at this move" });
  await expect(practiceHere).toContainText("Not practised: 1. e4 is reference only");
  await practiceHere.getByRole("button", { name: /Advanced: training marks/ }).click();
  const start = practiceHere.getByRole("switch", { name: "Start practice here" });
  await expect(start).toHaveAttribute("aria-checked", "false");
  await expect(
    practiceHere.getByText("Practice begins at this move", { exact: false })
  ).toBeVisible();
  await expect(
    practiceHere.getByText("No change to what this chapter practises").first()
  ).toBeVisible();

  // Nothing to practise: both actions are disabled, with the reason beside them.
  const practise = panel.getByRole("button", { name: "Practice this chapter", exact: true });
  const rehearse = panel.getByRole("button", { name: "Rehearse this chapter", exact: true });
  await expect(practise).toBeDisabled();
  await expect(rehearse).toBeDisabled();
  await expect(
    panel.getByText("Nothing to practise yet: your moves here are kept as reference.")
  ).toBeVisible();

  // One click: the import default — White's moves accepted, Black's replies covered.
  await include.click();
  await expect(notice(page)).toHaveCount(0);
  await expect(panel.getByText("4 in this chapter")).toBeVisible();
  await expect(choices.getByText(/^Preferred:/)).toBeVisible();
  await expect(practiceHere).toContainText("Practised");
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText("Saved");
  await expect(practise).toBeEnabled();

  // Practice now asks the four decisions; the first is answered on the board.
  await practise.click();
  await page.getByRole("radio", { name: "Learn new", exact: true }).click();
  await page.getByRole("button", { name: "Start learning", exact: true }).click();
  await expect(practicePanel(page)).toContainText("1 of 4");
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(practicePanel(page).getByText("You played e4.")).toBeVisible();
});

test("Rehearse this chapter on the user's chapter starts a rehearsal instead of spinning", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page);
  await openStudy(page);
  await notice(page).getByRole("button", { name: "Include in practice", exact: true }).click();
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText("Saved");

  await studyPanel(page)
    .getByRole("button", { name: "Rehearse this chapter", exact: true })
    .click();
  const panel = practicePanel(page);
  await expect(panel).toBeVisible();
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
  await page.getByRole("button", { name: `${REPERTOIRE} actions`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Practice", exact: true }).click();

  // Explained before any start, and every Start is disabled with the reason.
  await expect(page.getByText("Nothing to practise in “Chapter 1”")).toBeVisible();
  await expect(page.getByText("1. e4 is reference only", { exact: false })).toBeVisible();
  for (const [mode, start] of [
    ["Review due", "Start review"],
    ["Learn new", "Start learning"],
    ["Rehearse lines", "Start rehearsal"]
  ]) {
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await expect(page.getByRole("button", { name: start, exact: true })).toBeDisabled();
    await expect(
      page.getByText("Nothing in this repertoire is practised yet — see why above.")
    ).toBeVisible();
  }

  // The way back: Study at the position whose choices list the reference move.
  await page.getByRole("button", { name: "Fix in Study", exact: true }).click();
  await expect(notice(page)).toBeVisible();
  const choices = studyPanel(page).getByRole("region", { name: "Choices at this position" });
  await expect(choices.getByRole("button", { name: "e4", exact: true })).toBeVisible();
  await expect(choices.getByText(/^Reference only:/)).toBeVisible();
});

test("an empty review explains itself and Learn new starts from the same screen", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page, { reference: false });
  await openStudy(page);
  await studyPanel(page)
    .getByRole("button", { name: "Practice this chapter", exact: true })
    .click();

  // Review due with no new cards: nothing is due yet.
  await page.getByRole("radio", { name: "Review due", exact: true }).click();
  await page.getByRole("spinbutton", { name: "New cards" }).fill("0");
  const start = page.getByRole("button", { name: "Start review", exact: true });
  await start.click();
  await expect(page.getByText("No reviews due", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Everything in this scope is scheduled for later.", { exact: false })
  ).toBeVisible();
  // The form stayed as it was (no flicker back to defaults).
  await expect(page.getByRole("spinbutton", { name: "New cards" })).toHaveValue("0");

  await page.getByRole("button", { name: "Learn new", exact: true }).click();
  await expect(practicePanel(page)).toContainText("1 of 4");
});

test("Rehearse from here and Rehearse this chapter know about paused decisions", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedSicilian(page, { reference: false, pgn: "1. e4 c5 2. Nf3 *" });
  await openStudy(page);
  const panel = studyPanel(page);
  const titlebar = page.getByRole("banner", { name: "Titlebar" });
  const pause = async () => {
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await page.getByRole("switch", { name: "Pause this decision", exact: true }).click();
    await expect(titlebar).toContainText("Saved");
    await page.getByRole("tab", { name: "Moves", exact: true }).click();
  };
  const fromHere = panel.getByRole("button", { name: "Rehearse from here", exact: true });
  const rehearse = panel.getByRole("button", { name: "Rehearse this chapter", exact: true });

  // After 1... c5 the line asks 2. Nf3; paused, it has nothing to ask from here.
  await expect(fromHere).toBeVisible();
  await pause();
  await expect(fromHere).toHaveCount(0);
  await expect(rehearse).toBeEnabled();

  // With 1. e4 paused too, nothing in the chapter is asked.
  await panel.getByRole("button", { name: "First move", exact: true }).click();
  await pause();
  const reason = "Every decision in this chapter is paused (see Notes).";
  await expect(panel.getByText(reason)).toBeVisible();
  await expect(rehearse).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "Practice this chapter", exact: true })
  ).toBeDisabled();
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
        repertoireId: repertoire!.id,
        jobId: preview.jobId,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "Alapin", kind: "opening", include: true }]
      });
    },
    { name: REPERTOIRE, revision }
  );
  await openStudy(page);
  const panel = studyPanel(page);
  await expect(panel.getByText("0 in this chapter")).toBeVisible();

  // Accepting 2. Nf3 there would change what "Alapin" practises too: it asks first.
  await notice(page).getByRole("button", { name: "Include in practice", exact: true }).click();
  const question = notice(page).getByRole("group", { name: "Include in practice?" });
  await expect(question).toContainText(
    "Your other chapters play a different move after 1. e4 c5. Including also accepts 2. Nf3 there."
  );
  await question.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(panel.getByText("0 in this chapter")).toBeVisible();

  await notice(page).getByRole("button", { name: "Include in practice", exact: true }).click();
  await question.getByRole("button", { name: "Include anyway", exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(panel.getByText("4 in this chapter")).toBeVisible();
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText("Saved");
});
