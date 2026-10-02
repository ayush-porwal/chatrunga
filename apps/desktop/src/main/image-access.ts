import { win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { localImagePathFromUrl } from "./security";

/**
 * Which local images the `chaturanga-image:` protocol may serve: engine pictures stored in the
 * engines table, and files the user picked in an open-file dialog this session (a picture being
 * set on a new engine, previewed before it is saved). Nothing else on disk.
 *
 * Defence in depth, not a sandbox: the renderer can register an engine (an executable, a picture)
 * by design, so a picture only becomes readable by showing up as an engine's picture in Settings —
 * never silently. A typed path previews once the engine is saved.
 */
const chosenThisSession = new Set<string>();

/** The user picked `path` in a file dialog. */
export function allowChosenFile(path: string | null): void {
  if (path) chosenThisSession.add(canonicalImagePath(path));
}

export function isServableImage(
  path: string,
  registeredImages: () => Iterable<string | null>,
  windows = process.platform === "win32"
): boolean {
  const requested = canonicalImagePath(path, windows);
  if (chosenThisSession.has(requested)) return true;
  for (const registered of registeredImages()) {
    if (registered && canonicalImagePath(registered, windows) === requested) return true;
  }
  return false;
}

/**
 * One spelling per picture, so a stored value and a request for it compare equal. `file://` URLs
 * become paths; on Windows, `file:///C:/x.png` reaches the protocol as its URL pathname
 * `/C:/x.png` (see renderer `localImageSrc`), so that and `C:/x.png` both become `C:\x.png`.
 * A stored `chaturanga-image:` URL is passed through by the renderer: it becomes the path it asks for.
 */
export function canonicalImagePath(value: string, windows = process.platform === "win32"): string {
  let path = value.trim();
  if (/^chaturanga-image:/i.test(path)) path = localImagePathFromUrl(path) ?? path;
  else if (/^file:/i.test(path)) {
    try {
      path = fileURLToPath(path, { windows });
    } catch {
      return path;
    }
  }
  return windows ? win32.normalize(path.replace(/^\/(?=[a-zA-Z]:[\\/])/, "")) : path;
}
