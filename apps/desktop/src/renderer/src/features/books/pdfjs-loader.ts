/**
 * PDF.js, loaded only when a book is imported (render-pdf.ts imports this module on demand): the
 * library, its worker (a module worker from the app's own files) and where its image decoders'
 * JavaScript builds are served (`pdfjs/`, copied there by electron.vite.config.ts). WebAssembly
 * stays off: the packaged app's CSP doesn't allow compiling it, and the JavaScript decoders read
 * the same scans (JBIG2, CCITT, JPEG 2000).
 */
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
// oxlint-disable-next-line import/default -- Vite's `?url` import is the worker file's URL (a default string export), not the module itself
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfDocumentLike, PdfjsLike } from "./render-pdf";

GlobalWorkerOptions.workerSrc = workerUrl;

function adapt(pdf: PDFDocumentProxy): PdfDocumentLike {
  return {
    numPages: pdf.numPages,
    getMetadata: () => pdf.getMetadata(),
    getPage: async (pageNumber) => {
      const page = await pdf.getPage(pageNumber);
      return {
        size: (scale) => page.getViewport({ scale }),
        render: (canvas, scale) =>
          page.render({ canvas, viewport: page.getViewport({ scale }) }).promise,
        cleanup: () => void page.cleanup()
      };
    }
  };
}

export const pdfjs: PdfjsLike = {
  open: (data) => {
    const task = getDocument({
      data,
      useWasm: false,
      wasmUrl: new URL("pdfjs/", document.baseURI).href,
      // Scans need no fonts; text PDFs fall back to the system's for unembedded ones.
      useSystemFonts: true
    });
    return { promise: task.promise.then(adapt), destroy: () => task.destroy() };
  }
};
