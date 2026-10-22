// Book import through the built app: a generated two-page PDF is opened and rendered by PDF.js
// (its worker and decoders under the app's CSP), sent page by page, read by a stand-in for
// OpenRouter, and becomes a repertoire whose Study has the Book tab; how to run: playwright.config.ts.
import type { Page } from "@playwright/test";
import { BOOK_OCR_PROMPT, BOOK_OUTLINE_PROMPT } from "../../../packages/shared/src/books/prompts";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { expect, fakeOpenRouter, sidebar, skipWelcome, test } from "./app";
import { writeBookPdf } from "./fixtures";

const TITLE = "E2E Openings";

/** Every page reads the same way, and one chapter spans both. */
const ANSWERS = {
  ocr: "**1 e4 e5 2 Nf3** develops a piece.",
  outline: JSON.stringify({
    title: TITLE,
    author: null,
    color: "white",
    printedPageOffset: 0,
    chapters: [{ number: 1, title: "King's pawn", firstPage: 1, lastPage: null }]
  }),
  lines: JSON.stringify({
    game: null,
    lines: [
      { label: null, kind: "main", role: "own-recommended", moves: "1. e4 e5 2. Nf3", notes: [] }
    ]
  }),
  repair: JSON.stringify({ moves: null })
};

async function openHub(page: Page) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Repertoire", level: 1 })).toBeVisible();
}

async function openImportDialog(page: Page) {
  await page.getByRole("button", { name: "New repertoire", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import book (PDF)…", exact: true }).click();
  return page.getByRole("dialog", { name: "Import a book" });
}

test("without an OpenRouter key, the dialog reads the PDF and offers Settings", async ({
  launch,
  profile
}) => {
  const { page, pageErrors } = await launch();
  await skipWelcome(page);
  await openHub(page);
  const dialog = await openImportDialog(page);
  await dialog.getByLabel("Book PDF").setInputFiles(writeBookPdf(profile, TITLE));
  // The PDF's own title, and its page count read by PDF.js.
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(TITLE);
  await expect(dialog.getByRole("definition").first()).toHaveText("2");
  await expect(dialog.getByText("An OpenRouter API key is needed")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Open Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  expect(pageErrors).toStrictEqual([]);
});

test("imports a book PDF into a repertoire with its pages in Study's Book tab", async ({
  launch,
  profile
}) => {
  const { app, page, pageErrors } = await launch();
  await skipWelcome(page);
  await fakeOpenRouter(
    app,
    { ocr: BOOK_OCR_PROMPT, outline: BOOK_OUTLINE_PROMPT, lines: "You extract chess lines" },
    ANSWERS
  );
  // Set-up, not the journey: a (test) key through the bridge, as Settings → AI saves it.
  await page.evaluate(() =>
    (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.commentary.setOpenRouterConfig({
      apiKey: "e2e-test-key"
    })
  );
  await openHub(page);
  const dialog = await openImportDialog(page);
  await dialog.getByLabel("Book PDF").setInputFiles(writeBookPdf(profile, TITLE));
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(TITLE);
  await dialog.getByRole("button", { name: "Start", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Rendered, sent, read and written: the notice offers the new repertoire.
  const ready = page.getByRole("status").filter({ hasText: `“${TITLE}” is ready.` });
  await expect(ready).toBeVisible({ timeout: 60_000 });
  const row = page.getByRole("list", { name: "Repertoires" }).getByRole("listitem");
  await expect(row.filter({ hasText: TITLE }).getByText("Book", { exact: true })).toBeVisible();
  await ready.getByRole("button", { name: "Open", exact: true }).click();

  // Moves starting a page carry its chip; the Book tab shows the page as rendered.
  const moves = page.getByRole("tree", { name: "Chapter moves" });
  await expect(moves.getByRole("button", { name: "Show p. 1 of the book" })).toBeVisible();
  await moves.getByRole("button", { name: "Show p. 1 of the book" }).click();
  await expect(page.getByRole("tab", { name: "Book", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const image = page.getByRole("img", { name: "Book p. 1" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("img", { name: "Book p. 2" })).toBeVisible();
  expect(pageErrors).toStrictEqual([]);
});
