import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  openPdfBook,
  PAGE_DPI,
  renderPdfPages,
  type PdfDocumentLike,
  type PdfjsLike
} from "./render-pdf";

type FakeCanvas = {
  width: number;
  height: number;
  drawn: { filter: string; source: unknown }[];
  getContext: () => { filter: string; drawImage: (source: unknown) => void };
  toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => void;
};

/** Canvases that remember what was drawn on them; `toBlob` encodes as `blobType`. */
function canvases(blobType = "image/webp") {
  const made: FakeCanvas[] = [];
  const toBlob = vi.fn((callback: (blob: Blob | null) => void, type: string) =>
    callback(new Blob([`encoded as ${type}`], { type: blobType }))
  );
  const createCanvas = (width: number, height: number) => {
    const canvas: FakeCanvas = {
      width,
      height,
      drawn: [],
      getContext: () => {
        const context = {
          filter: "none",
          drawImage: (source: unknown) => canvas.drawn.push({ filter: context.filter, source })
        };
        return context;
      },
      toBlob
    };
    made.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  };
  return { made, toBlob, createCanvas };
}

/** A two-page PDF.js document (US letter) with the given metadata. */
function fakePdfjs(metadata: Awaited<ReturnType<PdfDocumentLike["getMetadata"]>>) {
  const rendered: { page: number; scale: number }[] = [];
  const cleanup = vi.fn();
  const destroy = vi.fn(async () => undefined);
  const document: PdfDocumentLike = {
    numPages: 2,
    getMetadata: async () => metadata,
    getPage: async (page) => ({
      size: (scale) => ({ width: 612 * scale, height: 792 * scale }),
      render: async (_canvas, scale) => {
        rendered.push({ page, scale });
      },
      cleanup
    })
  };
  const pdfjs: PdfjsLike = { open: () => ({ promise: Promise.resolve(document), destroy }) };
  return { pdfjs, rendered, cleanup, destroy };
}

const file = new Blob(["%PDF-1.7 synthetic"]);
const noMetadata = { info: {}, metadata: null };

describe("openPdfBook", () => {
  it("reads the page count, the PDF's own title and the file's SHA-256", async () => {
    const { pdfjs } = fakePdfjs({ info: { Title: "  A   Test   Book " }, metadata: null });
    const book = await openPdfBook(file, { pdfjs });
    expect(book).toMatchObject({
      pageCount: 2,
      metadataTitle: "A Test Book",
      sha256: createHash("sha256").update("%PDF-1.7 synthetic").digest("hex")
    });
  });

  it("takes the XMP title when the Info dictionary has none, and none when both are blank", async () => {
    const xmp = fakePdfjs({ info: { Title: "" }, metadata: { get: () => "From XMP" } });
    await expect(openPdfBook(file, xmp)).resolves.toMatchObject({ metadataTitle: "From XMP" });
    const blank = fakePdfjs({ info: {}, metadata: { get: () => null } });
    await expect(openPdfBook(file, blank)).resolves.toMatchObject({ metadataTitle: null });
  });

  it("renders a page at 150 dpi, copies it through a grayscale filter and encodes WebP", async () => {
    const { pdfjs, rendered, cleanup } = fakePdfjs(noMetadata);
    const { made, toBlob, createCanvas } = canvases();
    const book = await openPdfBook(file, { pdfjs, createCanvas });
    const bytes = await book.renderPage(1);
    expect(rendered).toStrictEqual([{ page: 2, scale: PAGE_DPI / 72 }]);
    expect(made.map(({ width, height }) => [width, height])).toStrictEqual([
      [1275, 1650],
      [1275, 1650]
    ]);
    expect(made[1].drawn).toStrictEqual([{ filter: "grayscale(1)", source: made[0] }]);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.8);
    expect(new TextDecoder().decode(bytes)).toBe("encoded as image/webp");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("refuses a system that can't encode WebP rather than sending another format", async () => {
    const { pdfjs, cleanup } = fakePdfjs(noMetadata);
    const book = await openPdfBook(file, {
      pdfjs,
      createCanvas: canvases("image/png").createCanvas
    });
    await expect(book.renderPage(0)).rejects.toThrow("can't save the page");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("frees the loading task when PDF.js can't open the file, and rejects", async () => {
    const destroy = vi.fn(async () => undefined);
    const pdfjs: PdfjsLike = {
      open: () => ({ promise: Promise.reject(new Error("Invalid PDF structure.")), destroy })
    };
    await expect(openPdfBook(file, { pdfjs })).rejects.toThrow("Invalid PDF structure.");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("frees the document when closed", async () => {
    const { pdfjs, destroy } = fakePdfjs(noMetadata);
    await (await openPdfBook(file, { pdfjs })).close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("renderPdfPages", () => {
  const book = {
    pageCount: 3,
    renderPage: async (pageIndex: number) => new Uint8Array([pageIndex])
  };

  it("hands each page on in order: all of them, or the ones asked for", async () => {
    const sent: number[] = [];
    const onPage = async ({ pageIndex, bytes }: { pageIndex: number; bytes: Uint8Array }) => {
      sent.push(pageIndex, bytes[0]);
    };
    await renderPdfPages(book, { onPage });
    expect(sent).toStrictEqual([0, 0, 1, 1, 2, 2]);
    sent.length = 0;
    await renderPdfPages(book, { pageIndexes: [0, 2], onPage });
    expect(sent).toStrictEqual([0, 0, 2, 2]);
  });

  it("stops between pages when cancelled", async () => {
    const controller = new AbortController();
    const sent: number[] = [];
    const rendering = renderPdfPages(book, {
      signal: controller.signal,
      onPage: async ({ pageIndex }) => {
        sent.push(pageIndex);
        controller.abort(new Error("cancelled"));
      }
    });
    await expect(rendering).rejects.toThrow("cancelled");
    expect(sent).toStrictEqual([0]);
  });
});
