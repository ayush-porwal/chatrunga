/**
 * An image's src for the renderer, or null when it can't load: a local file (through the app's
 * image protocol, in the desktop app only) or a data/blob/protocol URL. Web (http/https) images
 * are null: the packaged app's CSP blocks them.
 */
export function localImageSrc(path: string | null | undefined): string | null {
  const value = path?.trim();
  if (!value || /^https?:/i.test(value)) return null;
  if (/^(data:|blob:|chaturanga-image:)/i.test(value)) return value;
  if (!window.chaturanga?.environment.isElectron) return null;
  if (/^file:/i.test(value)) {
    try {
      return `chaturanga-image://local/${encodeURIComponent(decodeURIComponent(new URL(value).pathname))}`;
    } catch {
      return value;
    }
  }
  return `chaturanga-image://local/${encodeURIComponent(value)}`;
}
