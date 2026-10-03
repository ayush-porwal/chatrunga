// Repertoire hub journeys: editing a repertoire's details, and long import-preview and chapter
// lists (search, bulk actions, bounded rendering); how to run them: playwright.config.ts.
import type { Locator, Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { expect, sidebar, skipWelcome, test } from "./app";

/** `titles.length` games of `plies` knight shuffles each, one per title (an imported collection). */
function collectionPgn(titles: readonly string[], plies = 20): string {
  const moves = Array.from(
    { length: plies },
    (_, ply) => `${ply % 2 === 0 ? `${ply / 2 + 1}. ` : ""}${["Nf3", "Nf6", "Ng1", "Ng8"][ply % 4]}`
  ).join(" ");
  return titles.map((title) => `[Event "${title}"]\n\n${moves} *`).join("\n\n");
}

const lines = (count: number) => Array.from({ length: count }, (_, index) => `Line ${index}`);

/**
 * Runs `run` in the window with the repertoire API and JSON `args` (set-up and checks, not the
 * journey). Sent as source: the page's CSP forbids building functions from strings there.
 */
function withApi<R, A>(
  page: Page,
  args: A,
  run: (api: ChaturangaApi["repertoires"], args: A) => Promise<R>
): Promise<R> {
  return page.evaluate<R>(
    `(${run.toString()})(window.chaturanga.repertoires, ${JSON.stringify(args)})`
  );
}

/**
 * Creates a repertoire holding one imported chapter per title (the empty first chapter removed)
 * and makes its first chapter the one Study opens.
 */
function seedCollection(page: Page, name: string, titles: readonly string[]) {
  return withApi(page, { name, pgn: collectionPgn(titles) }, async (api, { name, pgn }) => {
    const created = await api.create({ name, color: "white" });
    const preview = await api.previewImport({ pgn });
    const result = await api.commitImport({
      jobId: preview.jobId,
      repertoireId: created.id,
      expectedRevision: created.revision,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: game.proposedTitle,
        kind: "opening" as const,
        include: true,
        excludeNodeIds: []
      }))
    });
    const placeholder = result.repertoire.chapters.find((chapter) => chapter.nodeCount === 0)!;
    const removed = await api.removeChapter({
      repertoireId: created.id,
      chapterId: placeholder.id,
      expectedRevision: result.repertoire.revision
    });
    const first = removed.repertoire.chapters[0];
    await api.saveWorkspace({
      repertoireId: created.id,
      workspace: {
        lastChapterId: first.id,
        lastNodeId: null,
        orientation: "white",
        practiceDraft: null
      }
    });
    return { id: created.id, chapters: removed.repertoire.chapters.length };
  });
}

/** The element's box lies entirely inside the window (nothing clipped above or below). */
async function expectInWindow(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box, "laid out").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
}

async function openHub(page: Page) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Repertoire", level: 1 })).toBeVisible();
}

async function openChapters(page: Page, repertoire: string) {
  await openHub(page);
  await page.getByRole("button", { name: `Study ${repertoire}`, exact: true }).click();
  await page.getByRole("tab", { name: "Chapters", exact: true }).click();
  await expect(page.getByRole("list", { name: "Chapters" })).toBeVisible();
}

test("edits a repertoire's name and tags; the hub search finds the new tag", async ({ launch }) => {
  const { page } = await launch();
  await skipWelcome(page);
  const { id } = await withApi(page, {}, async (api) => {
    const created = await api.create({ name: "Black against 1.e4", color: "black" });
    await api.create({ name: "White openings", color: "white", tags: ["e4"] });
    return created;
  });
  await openHub(page);

  await page.getByRole("button", { name: "Black against 1.e4 actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit repertoire", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit repertoire" });
  const name = dialog.getByRole("textbox", { name: "Name" });
  await expect(name).toHaveValue("Black against 1.e4");
  await name.fill("");
  await expect(dialog.getByText("Enter a name.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await name.fill("Sicilian Najdorf");
  await dialog.getByRole("textbox", { name: "Description" }).fill("Main lines against 6.Bg5");
  await dialog.getByRole("textbox", { name: "Tags" }).fill("sicilian, najdorf-bg5, sicilian");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved the details of “Sicilian Najdorf”.")).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search repertoires" });
  await search.fill("najdorf-bg5");
  const list = page.getByRole("list", { name: "Repertoires" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(
    list.getByRole("button", { name: "Study Sicilian Najdorf", exact: true })
  ).toBeVisible();
  await search.fill("");
  await expect(list.getByRole("listitem")).toHaveCount(2);

  // Renamed elsewhere while the editor is open: it says so, won't save, and Reload starts over.
  await page.getByRole("button", { name: "Sicilian Najdorf actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit repertoire", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Tags" }).fill("sicilian, sharp");
  await withApi(page, { id }, async (api, { id }) => {
    const stored = await api.get(id);
    await api.updateMetadata({
      id,
      expectedRevision: stored.revision,
      patch: { name: "Najdorf (renamed elsewhere)" }
    });
  });
  await expect(dialog.getByText("Changed since you opened this")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(name).toHaveValue("Najdorf (renamed elsewhere)");
  await expect(dialog.getByRole("textbox", { name: "Tags" })).toHaveValue("sicilian, najdorf-bg5");
  await dialog.getByRole("textbox", { name: "Tags" }).fill("sicilian, sharp");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  const stored = await withApi(page, { id }, (api, { id }) => api.get(id));
  expect(stored).toMatchObject({
    name: "Najdorf (renamed elsewhere)",
    description: "Main lines against 6.Bg5",
    tags: ["sicilian", "sharp"]
  });
});

test("searches a long import preview, excludes the games found and imports the rest", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await withApi(page, {}, (api) => api.create({ name: "Collection", color: "white" }));
  await openHub(page);
  await page.getByRole("button", { name: "Collection actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import PGN", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import PGN" });
  const titles = [...lines(110), ...Array.from({ length: 10 }, (_, index) => `Najdorf ${index}`)];
  await dialog.getByRole("textbox", { name: "PGN text" }).fill(collectionPgn(titles));
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();

  // A page of rows at first; the rest on request.
  const games = dialog.getByRole("list", { name: "Games in the PGN" });
  await expect(games.getByRole("listitem")).toHaveCount(50);
  await expect(dialog.getByText("120 of 120 games included")).toBeVisible();
  await dialog.getByRole("button", { name: "Show 50 more (70 not shown)" }).click();
  await expect(games.getByRole("listitem")).toHaveCount(100);
  await expect(dialog.getByRole("checkbox", { name: "Import game 51", exact: true })).toBeFocused();

  const search = dialog.getByRole("searchbox", { name: "Search games" });
  await search.fill("najdorf");
  await expect(games.getByRole("listitem")).toHaveCount(10);
  await expect(search).toBeFocused();
  await dialog.getByRole("button", { name: "Exclude found", exact: true }).click();
  await expect(dialog.getByText("110 of 120 games included · 10 found")).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "Import game 111", exact: true })
  ).not.toBeChecked();

  // The exclusions outlive the search; a kind applies to the included games found.
  await search.fill("line 10");
  await expect(games.getByRole("listitem")).toHaveCount(11);
  await dialog
    .getByRole("combobox", { name: "Chapter kind for the included games found" })
    .selectOption("reference");
  await expect(dialog.getByRole("combobox", { name: "Chapter kind for game 101" })).toHaveValue(
    "reference"
  );
  await search.fill("");
  await expect(games.getByRole("listitem")).toHaveCount(50);
  await expect(
    dialog.getByRole("combobox", { name: "Chapter kind for game 1", exact: true })
  ).toHaveValue("opening");
  await dialog.getByRole("button", { name: "Import 110 chapters", exact: true }).click();
  await expect(page.getByText("Imported 110 chapters into “Collection”.")).toBeVisible();
  const chapters = await withApi(page, {}, async (api) => {
    const [summary] = await api.list({});
    return (await api.get(summary.id)).chapters.filter((chapter) => chapter.nodeCount > 0);
  });
  expect(chapters).toHaveLength(110);
  expect(chapters.filter((chapter) => chapter.title.startsWith("Najdorf"))).toEqual([]);
  expect(
    chapters.filter((chapter) => chapter.kind === "reference").map((chapter) => chapter.title)
  ).toEqual(["Line 10", ...Array.from({ length: 10 }, (_, index) => `Line ${100 + index}`)]);
});

test("filters the chapter list without losing the selection, then disables the selection at once", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  const { id } = await seedCollection(page, "Forty lines", lines(40));
  await openChapters(page, "Forty lines");
  const chapters = page.getByRole("list", { name: "Chapters" });

  // The open chapter (Line 0) and two others.
  for (const title of ["Line 0", "Line 3", "Line 12"]) {
    await chapters.getByRole("checkbox", { name: `Select ${title}`, exact: true }).check();
  }
  const search = page.getByRole("searchbox", { name: "Search chapters" });
  await search.pressSequentially("line 1");
  await expect(search).toBeFocused();
  await expect(page.getByText("3 selected · 2 not shown")).toBeVisible();
  // Line 1, Line 10–19, Line 21 and Line 31; only the rows in view are mounted.
  await expect(chapters.getByRole("listitem").first()).toHaveAttribute("aria-setsize", "13");
  await chapters.evaluate((list) => list.parentElement!.scrollTo({ top: 0 }));
  await expect(
    chapters.getByRole("checkbox", { name: "Select Line 12", exact: true })
  ).toBeChecked();
  await expect(
    chapters.getByRole("checkbox", { name: "Select Line 10", exact: true })
  ).not.toBeChecked();
  await search.fill("no such line");
  await expect(page.getByText("No chapters match “no such line”.")).toBeVisible();
  await search.fill("");
  await expect(
    chapters.getByRole("checkbox", { name: "Select Line 3", exact: true })
  ).toBeChecked();

  // A focused row stays mounted while the list scrolls past it.
  const lineThree = chapters.getByRole("checkbox", { name: "Select Line 3", exact: true });
  await lineThree.focus();
  await chapters.evaluate((list) => list.parentElement!.scrollTo({ top: 1e6 }));
  await expect(
    chapters.getByRole("checkbox", { name: "Select Line 39", exact: true })
  ).toBeVisible();
  await expect(lineThree).toBeFocused();
  await chapters.evaluate((list) => list.parentElement!.scrollTo({ top: 0 }));

  const before = await withApi(page, { id }, (api, { id }) => api.get(id));
  await page.getByRole("button", { name: "Selected chapters actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disable for practice", exact: true }).click();
  for (const title of ["Line 0", "Line 3", "Line 12"]) {
    await expect(
      chapters.getByRole("switch", { name: `Enable ${title} for practice`, exact: true })
    ).toBeVisible();
  }
  await expect(
    chapters.getByRole("switch", { name: "Disable Line 1 for practice", exact: true })
  ).toBeVisible();
  // One write for the two closed chapters, then the open chapter's draft autosaves.
  await expect
    .poll(async () => {
      const after = await withApi(page, { id }, (api, { id }) => api.get(id));
      return {
        disabled: after.chapters
          .filter((chapter) => !chapter.enabled)
          .map((chapter) => chapter.title),
        revisions: after.revision - before.revision
      };
    })
    .toEqual({ disabled: ["Line 0", "Line 3", "Line 12"], revisions: 2 });
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText("Saved");
});

/**
 * Milliseconds from `action` (statements run in the page, so no IPC sits between the event and
 * the clock) to the next frame after React committed and the browser laid it out.
 */
function timeInPage(page: Page, action: string) {
  return page.evaluate<number>(`(async () => {
    const start = performance.now();
    ${action};
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    return Math.round(performance.now() - start);
  })()`);
}

const clickTab = (name: string) =>
  `[...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.trim() === ${JSON.stringify(name)}).click()`;
const typeSearch = (label: string, value: string) => `
  const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event("input", { bubbles: true }));`;

test(
  "benchmark: a 500-chapter repertoire's chapter list and import preview",
  { tag: "@perf" },
  async ({ launch }) => {
    test.setTimeout(240_000);
    const { page } = await launch();
    await skipWelcome(page);
    const seeded = await seedCollection(page, "Large collection", lines(500));
    expect(seeded.chapters).toBe(500);

    await openChapters(page, "Large collection");
    const openChaptersMs: number[] = [];
    for (let run = 0; run < 3; run++) {
      await page.getByRole("tab", { name: "Moves", exact: true }).click();
      openChaptersMs.push(await timeInPage(page, clickTab("Chapters")));
    }
    const chapterRows = await page
      .getByRole("list", { name: "Chapters" })
      .getByRole("listitem")
      .count();
    const filterChaptersMs: number[] = [];
    for (const query of ["line 4", "line 49", "", "line 4", ""]) {
      filterChaptersMs.push(await timeInPage(page, typeSearch("Search chapters", query)));
    }

    // The write a bulk action makes (one call), against the save per chapter it replaces.
    const writes = await withApi(page, { id: seeded.id }, async (api, { id }) => {
      const detail = await api.get(id);
      const ids = detail.chapters.slice(1, 101).map((chapter) => chapter.id);
      let revision = detail.revision;
      let start = performance.now();
      for (const chapterId of ids) {
        const chapter = await api.getChapter({ repertoireId: id, chapterId });
        const saved = await api.saveChapter({
          repertoireId: id,
          chapter: { ...chapter, enabled: false },
          expectedRevision: revision
        });
        revision = saved.repertoire.revision;
      }
      const perChapterSaves100Ms = Math.round(performance.now() - start);
      start = performance.now();
      const batch = await api.updateChapters({
        repertoireId: id,
        chapterIds: ids,
        expectedRevision: revision,
        patch: { enabled: true }
      });
      const bulk100Ms = Math.round(performance.now() - start);
      start = performance.now();
      await api.updateChapters({
        repertoireId: id,
        chapterIds: detail.chapters.slice(1).map((chapter) => chapter.id),
        expectedRevision: batch.repertoire.revision,
        patch: { kind: "reference" }
      });
      return { perChapterSaves100Ms, bulk100Ms, bulk499Ms: Math.round(performance.now() - start) };
    });

    await page
      .getByRole("navigation", { name: "Repertoire location" })
      .getByRole("button", { name: "Repertoire", exact: true })
      .click();
    await page.getByRole("button", { name: "Large collection actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Import PGN", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import PGN" });
    await dialog.getByRole("textbox", { name: "PGN text" }).fill(collectionPgn(lines(500)));
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    const games = dialog.getByRole("list", { name: "Games in the PGN" });
    await expect(games).toBeVisible({ timeout: 60_000 });
    const previewRows = await games.getByRole("listitem").count();
    // However long the list, the dialog fits the window: heading, search and Import stay in view
    // while only the list scrolls.
    const heading = dialog.getByRole("heading", { name: "Import PGN" });
    const importButton = dialog.getByRole("button", { name: "Import 500 chapters", exact: true });
    await expectInWindow(page, dialog);
    await expectInWindow(page, heading);
    await expectInWindow(page, importButton);
    await games.evaluate((list) => list.parentElement!.scrollTo({ top: 1e6 }));
    await expect(dialog.getByRole("button", { name: /^Show 50 more/ })).toBeInViewport();
    await expectInWindow(page, heading);
    await expectInWindow(page, dialog.getByRole("searchbox", { name: "Search games" }));
    await expectInWindow(page, importButton);
    await test.info().attach("import-preview-500-games", {
      body: await page.screenshot(),
      contentType: "image/png"
    });
    const toggleGameMs: number[] = [];
    for (let run = 0; run < 3; run++) {
      toggleGameMs.push(
        await timeInPage(
          page,
          `document.querySelector('input[aria-label="Import game 1"]').click()`
        )
      );
    }
    const filterGamesMs: number[] = [];
    for (const query of ["line 4", "line 49", "", "line 4", ""]) {
      filterGamesMs.push(await timeInPage(page, typeSearch("Search games", query)));
    }

    console.log(
      `REPERTOIRE_LIST_BENCH ${JSON.stringify({ chapterRows, openChaptersMs, filterChaptersMs, previewRows, toggleGameMs, filterGamesMs, ...writes })}`
    );
    expect(chapterRows).toBeLessThan(100);
    expect(previewRows).toBe(50);
  }
);
