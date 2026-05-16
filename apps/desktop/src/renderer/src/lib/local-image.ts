export function localImageSrc(path: string | null | undefined): string | null {
  if (!path?.trim()) return null;
  const value = path.trim();
  if (/^(https?:|data:|blob:|chaturanga-image:)/i.test(value)) return value;
  if (!window.chaturanga?.environment?.isElectron) return null;
  if (/^file:/i.test(value)) {
    try {
      return `chaturanga-image://local/${encodeURIComponent(decodeURIComponent(new URL(value).pathname))}`;
    } catch {
      return value;
    }
  }
  return `chaturanga-image://local/${encodeURIComponent(value)}`;
}
