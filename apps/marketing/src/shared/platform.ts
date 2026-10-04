import { PLATFORMS, type Platform, type PlatformId } from "./assets";

type UAData = { platform?: string; mobile?: boolean };

/** The visitor's desktop OS, or null on phones, tablets and anything unrecognised. */
export function detectPlatform(): PlatformId | null {
  const nav = navigator as Navigator & { userAgentData?: UAData };
  const ua = nav.userAgent;
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(ua)) return null;
  const hint = `${nav.userAgentData?.platform ?? ""} ${ua}`;
  if (/Win/i.test(hint)) return "windows";
  // iPadOS reports a Mac user agent; a touch screen gives it away.
  if (/Mac/i.test(hint)) return nav.maxTouchPoints > 1 ? null : "mac";
  if (/Linux|X11|CrOS/i.test(hint)) return "linux";
  return null;
}

/**
 * Highlights the visitor's platform without hiding the others:
 * - `[data-platform="<id>"]` gets `.is-detected` (and `aria-current` on links);
 * - `[data-download-label]` becomes "Download for <OS>", `a[data-download]` links to that build;
 * - `<html data-os="<id>">` for any CSS that needs it.
 * With no match (or no JS) the generic "Download Chaturanga" copy stays.
 */
export function applyPlatform(root: Document = document): Platform | null {
  const id = detectPlatform();
  const platform = PLATFORMS.find((p) => p.id === id) ?? null;
  if (!platform) return null;
  root.documentElement.dataset.os = platform.id;
  for (const el of root.querySelectorAll<HTMLElement>("[data-platform]")) {
    const match = el.dataset.platform === platform.id;
    el.classList.toggle("is-detected", match);
    if (match && el instanceof HTMLAnchorElement) el.setAttribute("aria-current", "true");
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-download-label]")) {
    el.textContent = `Download for ${platform.name}`;
  }
  for (const el of root.querySelectorAll<HTMLAnchorElement>("a[data-download]"))
    el.href = platform.href;
  return platform;
}
