/**
 * A chess book PDF as the import sends it to main: its page count, own title and SHA-256, and
 * each page rendered at 300 dpi in grayscale as WebP (`books.addPage`). PDF.js loads on
 * first use (pdfjs-loader.ts), so nothing of it is in the startup bundle.
 */

/** The parts of PDF.js used here (the real module and test fakes both fit). */
export type PdfjsLike = {
  open(data: Uint8Array): { promise: Promise<PdfDocumentLike>; destroy(): Promise<void> };
};

export type PdfDocumentLike = {
  numPages: number;
  getMetadata(): Promise<{ info: object; metadata: { get(name: string): unknown } | null }>;
  getPage(pageNumber: number): Promise<PdfPageLike>;
};

type PdfPageLike = {
  /** The page's size in pixels at `scale` (1 = 72 dpi). */
  size(scale: number): { width: number; height: number };
  render(canvas: HTMLCanvasElement, scale: number): Promise<void>;
  cleanup(): void;
};

/** A canvas: `document.createElement("canvas")` in the app, a fake in tests. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

export type PdfBook = {
  pageCount: number;
  /** The PDF's own title (its Info dictionary or XMP metadata), when it has one. */
  metadataTitle: string | null;
  /** SHA-256 of the file, hex. */
  sha256: string;
  /** Page `pageIndex` (0-based) as WebP bytes. */
  renderPage(pageIndex: number): Promise<Uint8Array>;
  /** Frees the document (and its worker's copy). */
  close(): Promise<void>;
};

/**
 * 300 dpi: at 150 a figurine is a few pixels wide, and repairing a misread line from a 300 dpi page
 * fixed more of them. The same image is read, repaired from and shown in the Book tab.
 */
export const PAGE_DPI = 300;
/** About 400 KB a page of print (twice 150 dpi at 0.8). */
const WEBP_QUALITY = 0.6;
/** PDF user space is 72 units to the inch. */
const PDF_UNITS_PER_INCH = 72;

const domCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

async function loadPdfjs(): Promise<PdfjsLike> {
  return (await import("./pdfjs-loader")).pdfjs;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function titleText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  return title || null;
}

/** The Info dictionary's Title, else the XMP `dc:title`. */
async function metadataTitleOf(document: PdfDocumentLike): Promise<string | null> {
  try {
    const { info, metadata } = await document.getMetadata();
    const fromInfo = "Title" in info ? titleText(info.Title) : null;
    return fromInfo ?? titleText(metadata?.get("dc:title"));
  } catch {
    return null;
  }
}

function webp(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== "image/webp") {
          reject(new Error("This system can't save the page as an image."));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      "image/webp",
      WEBP_QUALITY
    );
  });
}

/** Renders one page: drawn at PAGE_DPI, then copied through a grayscale filter, as WebP. */
async function renderPage(
  document: PdfDocumentLike,
  pageIndex: number,
  createCanvas: CanvasFactory
): Promise<Uint8Array> {
  const page = await document.getPage(pageIndex + 1);
  try {
    const scale = PAGE_DPI / PDF_UNITS_PER_INCH;
    const size = page.size(scale);
    const width = Math.round(size.width);
    const height = Math.round(size.height);
    const color = createCanvas(width, height);
    await page.render(color, scale);
    const gray = createCanvas(width, height);
    const context = gray.getContext("2d");
    if (!context) throw new Error("This system can't draw the page.");
    context.filter = "grayscale(1)";
    context.drawImage(color, 0, 0);
    return await webp(gray);
  } finally {
    page.cleanup();
  }
}

/** Opens a PDF the user picked. Rejects when it isn't a PDF PDF.js can read. */
export async function openPdfBook(
  file: Blob,
  options: { pdfjs?: PdfjsLike; createCanvas?: CanvasFactory } = {}
): Promise<PdfBook> {
  const pdfjs = options.pdfjs ?? (await loadPdfjs());
  const createCanvas = options.createCanvas ?? domCanvas;
  const buffer = await file.arrayBuffer();
  // Hashed first: PDF.js may take the bytes over (transfer them to its worker).
  const sha256 = await sha256Hex(buffer);
  const task = pdfjs.open(new Uint8Array(buffer));
  let document: PdfDocumentLike;
  try {
    document = await task.promise;
  } catch (error) {
    // A corrupt or password-protected file: its worker is freed before the rejection goes on.
    await task.destroy().catch(() => undefined);
    throw error;
  }
  return {
    pageCount: document.numPages,
    metadataTitle: await metadataTitleOf(document),
    sha256,
    renderPage: (pageIndex) => renderPage(document, pageIndex, createCanvas),
    close: () => task.destroy()
  };
}

/**
 * Renders the pages `pageIndexes` (by default all of them) in order, one at a time, handing each
 * to `onPage` (which sends it) before the next is drawn. `signal` stops it between pages
 * (rejecting with its reason).
 */
export async function renderPdfPages(
  book: Pick<PdfBook, "pageCount" | "renderPage">,
  options: {
    onPage: (page: { pageIndex: number; bytes: Uint8Array }) => Promise<void>;
    signal?: AbortSignal;
    pageIndexes?: readonly number[];
  }
): Promise<void> {
  const pageIndexes =
    options.pageIndexes ?? Array.from({ length: book.pageCount }, (_, index) => index);
  for (const pageIndex of pageIndexes) {
    options.signal?.throwIfAborted();
    await options.onPage({ pageIndex, bytes: await book.renderPage(pageIndex) });
  }
}
