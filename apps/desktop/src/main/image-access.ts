import { fileURLToPath } from "node:url";

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
  if (path) chosenThisSession.add(path);
}

export function isServableImage(path: string, registeredImages: () => Iterable<string | null>): boolean {
  if (chosenThisSession.has(path)) return true;
  for (const registered of registeredImages()) if (registered && asFilePath(registered.trim()) === path) return true;
  return false;
}

/** A stored picture as a file path: `file://` URLs are stored as given, the protocol asks by path. */
function asFilePath(value: string): string {
  if (!/^file:/i.test(value)) return value;
  try {
    return fileURLToPath(value);
  } catch {
    return value;
  }
}
