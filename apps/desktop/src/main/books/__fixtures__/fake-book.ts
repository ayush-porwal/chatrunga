/**
 * A synthetic four-page "book" (made-up text, no real book's) and a fake OpenRouter that answers
 * the import's prompts for it: pages 1–2 are chapter A (1 e4 e5, with a game header, a note, an
 * illegal move the repair fixes and a rejected try), pages 3–4 chapter B (1 d4 d5).
 */
import {
  BOOK_OCR_PROMPT,
  BOOK_OUTLINE_PROMPT,
  type BookChatMessage
} from "@chaturanga/shared/books/prompts";
import type { BookChatRequest } from "../openrouter-chat";

export const PAGE_TEXT = [
  "Chapter A\n**1 e4 e5 2 Nf3!** develops.\n[PAGE 1]",
  "**2...Nc6 3 Bb5** a) 3 Bc4?! is less precise.\n[PAGE 2]",
  "Chapter B\n**1 d4 d5 2 c4**\n[PAGE 3]",
  "**2...e6 3 Nc3**\n[PAGE 4]"
];

export const OUTLINE = {
  title: "Synthetic Openings",
  author: "A. Writer",
  color: "white",
  printedPageOffset: 0,
  chapters: [
    { number: 1, title: "Chapter A", firstPage: 1, lastPage: 2 },
    { number: 2, title: "Chapter B", firstPage: 3, lastPage: null }
  ]
};

export const ILLEGAL_LINE = "1. e4 e5 2. Nf3 Nc6 3. Bb9";
export const REPAIRED_LINE = "1. e4 e5 2. Nf3 Nc6 3. Bb5";

export const PAGE_LINES = [
  {
    game: { white: "Alpha", black: "Beta", event: "Test Open", year: "2000" },
    lines: [
      {
        label: null,
        kind: "main",
        role: "own-recommended",
        moves: "1. e4 e5 2. Nf3",
        notes: [{ after: "2. Nf3", text: "Develops.", symbols: "!" }]
      }
    ]
  },
  {
    game: null,
    lines: [
      { label: null, kind: "main", role: "own-recommended", moves: ILLEGAL_LINE, notes: [] },
      {
        label: "a",
        kind: "variation",
        role: "own-alternative",
        moves: "1. e4 e5 2. Nf3 Nc6 3. Bc4",
        notes: []
      }
    ]
  },
  {
    game: null,
    lines: [{ label: null, kind: "main", role: "own-recommended", moves: "1. d4 d5 2. c4" }]
  },
  {
    game: null,
    lines: [
      { label: null, kind: "main", role: "own-recommended", moves: "1. d4 d5 2. c4 e6 3. Nc3" }
    ]
  }
];

/** The page image file stored for page `index` (what the fake page files read back). */
export const imageFile = (folder: string, index: number) => `${folder}/p${index}.webp`;

export type PromptKind = "ocr" | "outline" | "lines" | "repair";

function textOf(message: BookChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** Which of the import's prompts a request is. */
export function promptKind(request: BookChatRequest): PromptKind {
  const first = textOf(request.messages[0]);
  if (first.startsWith(BOOK_OCR_PROMPT)) return "ocr";
  if (first === BOOK_OUTLINE_PROMPT) return "outline";
  if (first.startsWith("You extract chess lines")) return "lines";
  return "repair";
}

/** The user turn's text (where the lines prompt puts the context and the page). */
export const userText = (request: BookChatRequest) => textOf(request.messages.at(-1)!);

function imagePage(request: BookChatRequest): number {
  const content = request.messages[0].content;
  const image = Array.isArray(content) ? content.find((part) => part.type === "image_url") : null;
  const url = image?.type === "image_url" ? image.image_url.url : "";
  const path = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString();
  return Number(/p(\d+)\.webp$/.exec(path)?.[1]);
}

/** The scripted answer to a request (the right one for its prompt and page). */
export function bookAnswer(request: BookChatRequest): string {
  switch (promptKind(request)) {
    case "ocr":
      return PAGE_TEXT[imagePage(request)];
    case "outline":
      return `Here it is: ${JSON.stringify(OUTLINE)}`;
    case "lines": {
      const page = PAGE_TEXT.findIndex((text) => userText(request).endsWith(`THIS PAGE\n${text}`));
      return JSON.stringify(PAGE_LINES[page]);
    }
    case "repair":
      return JSON.stringify({ moves: REPAIRED_LINE });
  }
}

/** Fake page files: a page's "image" is its path, as bytes. */
export const fakeFiles = {
  read: async (_bookId: string, path: string) => ({
    bytes: Buffer.from(path),
    type: "image/webp" as const
  })
};
