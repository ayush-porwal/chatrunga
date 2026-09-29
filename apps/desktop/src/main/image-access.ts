/**
 * Which local images the `chaturanga-image:` protocol may serve: engine pictures stored in the
 * engines table, and files the user picked in an open-file dialog this session (a picture being
 * set on a new engine, previewed before it is saved). Nothing else on disk — the protocol can't be
 * used to read other images.
 */
const chosenThisSession = new Set<string>();

/** The user picked `path` in a file dialog. */
export function allowChosenFile(path: string | null): void {
  if (path) chosenThisSession.add(path);
}

export function isServableImage(path: string, registeredImages: () => Iterable<string | null>): boolean {
  if (chosenThisSession.has(path)) return true;
  for (const registered of registeredImages()) if (registered === path) return true;
  return false;
}
