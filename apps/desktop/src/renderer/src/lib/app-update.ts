import type { UpdateState, UpdateStatus } from "@chaturanga/shared/types/updates";

/*
 * Pure view logic for in-app updates: the sidebar update button + its changelog card, the Settings
 * status line and the release-notes formatting. The state itself comes from the main process
 * (main/updater.ts).
 */

/** What the one action button does for a status (null: nothing to do). */
export type UpdateAction = "install" | "download" | "open-download";

export function updateAction(status: UpdateStatus): UpdateAction | null {
  if (status.kind === "ready") return "install";
  if (status.kind === "manual") return "open-download";
  if (status.kind === "available") return "download";
  return null;
}

export const updateActionLabel: Record<UpdateAction, string> = {
  install: "Restart to update",
  download: "Download update",
  "open-download": "Download update"
};

/** The changelog card's primary button: its label, and the action (null = shown disabled). */
export function updateCardAction(status: UpdateStatus): { label: string; action: UpdateAction | null } | null {
  switch (status.kind) {
    case "ready":
      return { label: "Restart to update", action: "install" };
    case "downloading":
      return { label: `Downloading… ${Math.round(status.percent)}%`, action: null };
    case "manual":
      return { label: `Download v${status.version}`, action: "open-download" };
    case "available":
      return { label: `Download v${status.version}`, action: "download" };
    default:
      return null;
  }
}

/** Short-lived result of a check the user started from the sidebar button. */
export type CheckFeedback = "up-to-date" | "error" | null;

export type UpdateButtonView = {
  visual: "idle" | "checking" | "up-to-date" | "error" | "update" | "downloading" | "ready" | "disabled";
  /** Accessible name and the tooltip's first line. */
  label: string;
  /** Tooltip's quiet second line. */
  detail: string | null;
  /** An update exists: hover/focus/click shows the changelog card instead of a tooltip. */
  hasUpdate: boolean;
  /** Download progress 0–100. */
  percent: number | null;
};

/**
 * The sidebar update button: "Check for updates" (click checks) until an update exists, then the
 * update's state (hover shows its changelog card).
 */
export function updateButtonView(state: UpdateState | null, feedback: CheckFeedback, now: number): UpdateButtonView {
  const base = { detail: null, hasUpdate: false, percent: null };
  if (!state) return { ...base, visual: "idle", label: "Check for updates" };
  const status = state.status;
  switch (status.kind) {
    case "disabled":
      return { ...base, visual: "disabled", label: "Updates work in installed builds" };
    case "checking":
      return { ...base, visual: "checking", label: "Checking for updates…" };
    case "available":
    case "manual":
      return { ...base, visual: "update", label: `Chaturanga v${status.version} available`, hasUpdate: true };
    case "downloading":
      return {
        ...base,
        visual: "downloading",
        label: `Downloading v${status.version} · ${Math.round(status.percent)}%`,
        hasUpdate: true,
        percent: status.percent
      };
    case "ready":
      return { ...base, visual: "ready", label: `Update ready · v${status.version}`, hasUpdate: true };
    case "up-to-date":
      if (feedback === "up-to-date") return { ...base, visual: "up-to-date", label: `You’re up to date · v${state.currentVersion}` };
      break;
    case "error":
      if (feedback === "error") return { ...base, visual: "error", label: status.message };
      return { ...base, visual: "idle", label: "Check for updates", detail: status.message };
    case "idle":
      break;
  }
  return { ...base, visual: "idle", label: "Check for updates", detail: formatLastChecked(state.lastCheckedAt, now) };
}

/** The Settings status line. */
export function updateStatusText(state: UpdateState): string {
  const status = state.status;
  switch (status.kind) {
    case "idle":
      return "Updates are checked automatically.";
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return "Chaturanga is up to date.";
    case "available":
      return `Version ${status.version} is available.`;
    case "manual":
      return `Version ${status.version} is available to download.`;
    case "downloading":
      return `Downloading version ${status.version}… ${Math.round(status.percent)}%`;
    case "ready":
      return `Version ${status.version} is ready. Restart to finish updating.`;
    case "error":
    case "disabled":
      return status.message;
  }
}

/** "Last checked just now / 5 min ago / 3 h ago / on 12 Sep". */
export function formatLastChecked(checkedAt: number | null, now: number): string {
  if (checkedAt === null) return "Not checked yet";
  const minutes = Math.floor(Math.max(0, now - checkedAt) / 60_000);
  if (minutes < 1) return "Last checked just now";
  if (minutes < 60) return `Last checked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last checked ${hours} h ago`;
  return `Last checked on ${new Date(checkedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** "26 Sep 2026" for a release date (ISO), or null. */
export function formatReleaseDate(releaseDate: string | null | undefined): string | null {
  if (!releaseDate) return null;
  const date = new Date(releaseDate);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------------ release notes */

/** A run of text; `href` (http(s) only) makes it a link the browser opens. */
export type InlinePart = { text: string; href?: string };

export type ReleaseNoteBlock =
  | { type: "heading"; text: string }
  | { type: "bullet"; parts: InlinePart[] }
  | { type: "paragraph"; parts: InlinePart[] };

/** Emphasis/code markers → plain text (links are handled by {@link inlineParts}). */
function stripMarkers(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ");
}

/** Markdown inline text → text and link parts. Links to anything but http(s) keep only their label. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  const push = (part: InlinePart) => {
    if (!part.text) return;
    const previous = parts[parts.length - 1];
    if (previous && !previous.href && !part.href) previous.text += part.text;
    else parts.push(part);
  };
  for (let match = link.exec(text); match; match = link.exec(text)) {
    push({ text: stripMarkers(text.slice(last, match.index)) });
    const label = stripMarkers(match[1]).trim();
    push(/^https?:\/\//i.test(match[2]) ? { text: label, href: match[2] } : { text: label });
    last = match.index + match[0].length;
  }
  push({ text: stripMarkers(text.slice(last)) });
  if (parts.length) {
    parts[0].text = parts[0].text.trimStart();
    parts[parts.length - 1].text = parts[parts.length - 1].text.trimEnd();
  }
  return parts.filter((part) => part.text);
}

const plainText = (parts: InlinePart[]) => parts.map((part) => part.text).join("");

/**
 * Release notes (Markdown-ish text from the main process) as headings, bullets and paragraphs for
 * text-only rendering. Drops the "Chaturanga vX" title (the card shows it), the "Install" section
 * (the app installs for you), commit hashes and the compare link line.
 */
export function parseReleaseNotes(text: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  let paragraph: string[] = [];
  let skipping = false;
  const flush = () => {
    const parts = inlineParts(paragraph.join(" "));
    if (parts.length && !skipping) blocks.push({ type: "paragraph", parts });
    paragraph = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const title = plainText(inlineParts(heading[1]));
      skipping = /^install\b/i.test(title);
      if (!skipping && !/^chaturanga v?\d/i.test(title) && title) blocks.push({ type: "heading", text: title });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      // Release-plan bullets end with the commit link, "([`abc1234`](…))": noise in the app.
      const item = bullet[1].replace(/\s*\(\[`?[0-9a-f]{7,40}`?\]\([^)]*\)\)$/, "").replace(/\s*\(`?[0-9a-f]{7,40}`?\)$/, "");
      const parts = inlineParts(item);
      if (parts.length && !skipping) blocks.push({ type: "bullet", parts });
      continue;
    }
    if (!line || /^full changelog/i.test(plainText(inlineParts(line))) || /^[-*_]{3,}$/.test(line)) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
