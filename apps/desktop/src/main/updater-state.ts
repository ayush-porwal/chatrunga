/**
 * Pure decisions for in-app updates (no Electron imports, so they are unit-testable). The Electron
 * glue that feeds electron-updater events through these lives in `updater.ts`.
 */
import type { UpdateMode, UpdateStatus } from "@chaturanga/shared/types/updates";

/* ------------------------------------------------------------------ platform */

export type UpdateEnvironment = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  /** `process.env.APPIMAGE`: set by the AppImage runtime, the only Linux package that self-updates. */
  appImage: string | undefined;
  /** macOS: the running bundle has a Developer ID signature (Squirrel.Mac refuses anything else). */
  macSigned: boolean;
  /**
   * macOS: the running bundle can be replaced in place (a writable folder such as /Applications,
   * not a mounted DMG or an App Translocation copy). Lets unsigned builds update themselves.
   */
  macBundleReplaceable?: boolean;
};

export const DEV_BUILD_MESSAGE = "Updates are available in installed builds.";

export const MAC_NOT_REPLACEABLE_MESSAGE =
  "Move Chaturanga to your Applications folder and open it from there to update it in place.";

/**
 * How this build can update itself, and why when it can't do so automatically. `bundleSwap`: macOS
 * without a Developer ID, where the app replaces its own bundle (mac-bundle-updater.ts) because
 * Squirrel.Mac only installs updates signed by the same Developer ID.
 */
export function resolveUpdateMode(env: UpdateEnvironment): {
  mode: UpdateMode;
  reason: string | null;
  bundleSwap: boolean;
} {
  if (!env.isPackaged) return { mode: "disabled", reason: DEV_BUILD_MESSAGE, bundleSwap: false };
  if (env.platform === "win32") return { mode: "auto", reason: null, bundleSwap: false };
  if (env.platform === "darwin") {
    if (env.macSigned) return { mode: "auto", reason: null, bundleSwap: false };
    return env.macBundleReplaceable
      ? { mode: "auto", reason: null, bundleSwap: true }
      : { mode: "manual", reason: MAC_NOT_REPLACEABLE_MESSAGE, bundleSwap: false };
  }
  if (env.platform === "linux") {
    return env.appImage
      ? { mode: "auto", reason: null, bundleSwap: false }
      : {
          mode: "manual",
          reason:
            "Automatic updates need the AppImage; new versions are downloaded from the release page.",
          bundleSwap: false
        };
  }
  return {
    mode: "manual",
    reason: "New versions are downloaded from the release page.",
    bundleSwap: false
  };
}

/**
 * Whether a macOS bundle path can be swapped in place: a `.app`, and not an App Translocation copy
 * (macOS runs quarantined apps opened from Downloads from a random read-only path). Writability is
 * checked separately, on disk.
 */
export function isSwappableBundlePath(bundlePath: string): boolean {
  return bundlePath.endsWith(".app") && !bundlePath.includes("/AppTranslocation/");
}

/**
 * Whether `codesign -dv` output describes a Developer ID signature: a team identifier and not an
 * ad-hoc (`-`) signature. The app is built ad-hoc until signing certificates are added.
 */
export function isDeveloperIdSigned(codesignOutput: string): boolean {
  if (/^Signature=adhoc$/m.test(codesignOutput)) return false;
  const team = /^TeamIdentifier=(.+)$/m.exec(codesignOutput)?.[1]?.trim();
  return Boolean(team && team !== "not set");
}

/* ------------------------------------------------------------------ versions */

export function isPrereleaseVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(version.trim().replace(/^v/, ""));
}

/**
 * Prereleases (a future nightly build) are offered only to a build that is one; the production app
 * only ever updates to production releases.
 */
export function shouldAllowPrerelease(currentVersion: string): boolean {
  return isPrereleaseVersion(currentVersion);
}

/* ------------------------------------------------------------------ feed + download links */

/** The `app-update.yml` electron-builder writes into Resources from `build.publish`. */
export type UpdateFeedConfig =
  | { provider: "github"; owner: string; repo: string }
  | { provider: "generic"; url: string };

/** Reads the flat `key: value` lines of `app-update.yml`; null when it names no usable feed. */
export function parseAppUpdateConfig(text: string): UpdateFeedConfig | null {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z]+):\s*(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  if (values.provider === "github" && values.owner && values.repo) {
    return { provider: "github", owner: values.owner, repo: values.repo };
  }
  if (values.provider === "generic" && values.url) return { provider: "generic", url: values.url };
  return null;
}

/** Page listing every download of a release (the manual-download fallback). */
export function releasePageUrl(feed: UpdateFeedConfig, version: string): string {
  if (feed.provider === "generic") return feed.url;
  return `https://github.com/${feed.owner}/${feed.repo}/releases/tag/v${version}`;
}

export type UpdateFile = { url: string; size?: number; sha512?: string };

/**
 * The installer a person should download by hand for this platform and CPU: the DMG (else ZIP) for
 * macOS, the AppImage for Linux, matched to the architecture by file name. Only links that
 * `openDownload()` will actually open (isAllowedDownloadUrl) are offered; otherwise — no matching
 * file, or an installer hosted elsewhere — it falls back to the release page, which is always allowed.
 */
export function manualDownloadUrl(
  feed: UpdateFeedConfig,
  update: { version: string; files: UpdateFile[] },
  target: { platform: NodeJS.Platform; arch: string },
  feedOverride: string | null = null
): string {
  const extensions =
    target.platform === "darwin"
      ? [".dmg", ".zip"]
      : target.platform === "linux"
        ? [".AppImage"]
        : [".exe"];
  for (const extension of extensions) {
    const file = update.files.find(
      (candidate) => candidate.url.endsWith(extension) && isForArch(candidate.url, target.arch)
    );
    if (!file) continue;
    const url = resolveFileUrl(feed, update.version, file.url);
    if (isAllowedDownloadUrl(url, feedOverride)) return url;
  }
  return releasePageUrl(feed, update.version);
}

/**
 * The release ZIP the in-place macOS updater installs for this CPU, with the checksum it must match;
 * null when the feed has none (or it is hosted somewhere `isAllowedDownloadUrl` rejects).
 */
export function macUpdateZip(
  feed: UpdateFeedConfig,
  update: { version: string; files: UpdateFile[] },
  arch: string,
  feedOverride: string | null = null
): { url: string; sha512: string; size: number | null } | null {
  const file = update.files.find(
    (candidate) => candidate.url.endsWith(".zip") && isForArch(candidate.url, arch)
  );
  if (!file?.sha512) return null;
  const url = resolveFileUrl(feed, update.version, file.url);
  return isAllowedDownloadUrl(url, feedOverride)
    ? { url, sha512: file.sha512, size: file.size ?? null }
    : null;
}

/**
 * Swaps the downloaded bundle in once the app has quit (run detached by mac-bundle-updater.ts).
 * Arguments: pid, target bundle, staged bundle, relaunch (1/0). Waits up to 60s for the pid to exit,
 * then first moves the new bundle next to the app (a rename on the same volume, a copy across
 * volumes: a failure here leaves the app untouched), so the swap itself is two renames within one
 * folder. If the second rename fails the previous version is put back. Every run uses its own
 * temporary names, so leftovers from an earlier run can't be moved into. The last line of output is
 * the result: `installed` or `failed: <why>`. Paths arrive as arguments, never interpolated.
 */
export const BUNDLE_SWAP_SCRIPT = `#!/bin/sh
pid="$1"; target="$2"; staged="$3"; relaunch="$4"
incoming="$target.incoming-$$"
backup="$target.previous-$$"
finish() {
  echo "$1"
  if [ "$relaunch" = "1" ] && [ -d "$target" ]; then open "$target"; fi
  exit 0
}
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 600 ]; then finish "failed: the app did not quit"; fi
  sleep 0.1
done
if ! mv "$staged" "$incoming"; then
  rm -rf "$incoming"
  finish "failed: could not copy the new version next to the app"
fi
if ! mv "$target" "$backup"; then
  rm -rf "$incoming"
  finish "failed: could not move the current version aside"
fi
if mv "$incoming" "$target"; then
  rm -rf "$backup" 2>/dev/null
  finish "installed"
fi
rm -rf "$incoming"
if mv "$backup" "$target"; then finish "failed: the previous version was restored"; fi
finish "failed: the previous version is at $backup"
`;

/** The result line `BUNDLE_SWAP_SCRIPT` logged last (`installed` / `failed: …`); null when none. */
export function swapResult(log: string): { installed: boolean; detail: string } | null {
  const last = log.trim().split("\n").pop()?.trim() ?? "";
  if (last === "installed") return { installed: true, detail: last };
  if (last.startsWith("failed:"))
    return { installed: false, detail: last.slice("failed:".length).trim() };
  return null;
}

/** Our artifact names carry the CPU: `arm64` builds say so, anything else is x64. */
function isForArch(fileName: string, arch: string): boolean {
  const armFile = /arm64|aarch64/i.test(fileName);
  return arch === "arm64" ? armFile : !armFile;
}

function resolveFileUrl(feed: UpdateFeedConfig, version: string, fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  if (feed.provider === "generic")
    return new URL(fileUrl, feed.url.endsWith("/") ? feed.url : `${feed.url}/`).href;
  return `https://github.com/${feed.owner}/${feed.repo}/releases/download/v${version}/${encodeURIComponent(fileUrl)}`;
}

/**
 * Links `updates.openDownload()` may hand to the OS browser: https on github.com (release pages and
 * their assets), or anything under the test feed override when one is set.
 */
export function isAllowedDownloadUrl(url: string, feedOverride: string | null): boolean {
  try {
    const parsed = new URL(url);
    if (feedOverride) {
      const feed = new URL(feedOverride);
      if (
        parsed.origin === feed.origin &&
        (parsed.protocol === "http:" || parsed.protocol === "https:")
      )
        return true;
    }
    return parsed.protocol === "https:" && parsed.hostname === "github.com";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ release notes */

type ReleaseNotesInput =
  | string
  | Array<{ version: string; note: string | null }>
  | null
  | undefined;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeEntity(entity: string, name: string): string {
  if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()] ?? entity;
  const code =
    name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : entity;
}

/**
 * Release notes as plain Markdown-ish text. GitHub feeds deliver the release body as HTML; it is
 * flattened here (headings → `###`, list items → `- `, tags dropped, entities decoded) so the
 * renderer only ever formats text and never injects markup.
 */
export function releaseNotesToText(notes: ReleaseNotesInput): string {
  if (!notes) return "";
  if (Array.isArray(notes)) {
    return notes
      .map((entry) =>
        entry.note ? `### ${entry.version}\n\n${releaseNotesToText(entry.note)}` : ""
      )
      .filter(Boolean)
      .join("\n\n");
  }
  if (!/<[a-z][\s\S]*>/i.test(notes)) return notes.trim();
  return (
    notes
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      // Links survive as Markdown (the renderer opens http(s) ones in the browser).
      .replace(
        /<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_match, href: string, label: string) => {
          const text = label.replace(/<[^>]+>/g, "").trim();
          return text ? `[${text}](${href})` : "";
        }
      )
      .replace(/<h[1-6][^>]*>/gi, "\n\n### ")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|ul|ol|li|pre|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, decodeEntity)
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/* ------------------------------------------------------------------ errors */

export const CHECK_FAILED_MESSAGE = "Couldn’t check for updates";

/**
 * One readable sentence for an updater failure. Offline, DNS, timeouts and a missing/private
 * release feed (404/403) all read as "Couldn't check for updates" with a short reason; raw
 * electron-updater errors can be pages long (they include the HTTP response).
 */
export function readableUpdateError(
  error: unknown,
  phase: "check" | "download" | "install"
): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const text = raw.toLowerCase();
  const prefix =
    phase === "check"
      ? CHECK_FAILED_MESSAGE
      : phase === "download"
        ? "Couldn’t download the update"
        : "Couldn’t install the update";
  let reason: string | null = null;
  if (
    /enotfound|eai_again|err_internet_disconnected|err_name_not_resolved|err_network_changed|enetunreach|econnrefused|econnreset|err_connection/.test(
      text
    )
  ) {
    reason = "you appear to be offline";
  } else if (/timed? ?out|etimedout|err_timed_out/.test(text)) {
    reason = "the connection timed out";
  } else if (
    /\b40[46]\b|cannot find channel|no published versions|production release exists|unable to find latest version|latest.*\.yml/.test(
      text
    )
  ) {
    reason = "no published release was found";
  } else if (/\b403\b|rate limit/.test(text)) {
    reason = "GitHub refused the request, try again later";
  } else if (/sha512 checksum mismatch|checksum/.test(text)) {
    reason = "the download was corrupted";
  } else if (/code signature|not signed|signature/.test(text)) {
    reason = "the update’s signature couldn’t be verified";
  }
  return reason ? `${prefix}: ${reason}.` : `${prefix}.`;
}

/* ------------------------------------------------------------------ state machine */

export type UpdateInfoLike = {
  version: string;
  files?: UpdateFile[];
  releaseNotes?: ReleaseNotesInput;
  releaseDate?: string;
};

export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; info: UpdateInfoLike; manualUrl: string | null }
  | { type: "not-available" }
  | { type: "download-started" }
  | { type: "progress"; percent: number; transferred: number; total: number }
  | { type: "downloaded"; info: UpdateInfoLike }
  | { type: "error"; error: unknown };

/** Download size of the update: the package electron-updater would fetch (first file with a size). */
function updateSize(info: UpdateInfoLike): number | null {
  const size = info.files?.find((file) => typeof file.size === "number" && file.size > 0)?.size;
  return size ?? null;
}

function versionOf(status: UpdateStatus): string | null {
  return "version" in status ? status.version : null;
}

function notesOf(status: UpdateStatus): string {
  return "notes" in status ? status.notes : "";
}

/**
 * Next status for an electron-updater event. `manualUrl` on `available` marks the manual-download
 * path (the app never downloads; `updates.openDownload()` opens that URL).
 * A finished download is never lost to a later failed background check.
 */
export function reduceUpdateStatus(status: UpdateStatus, event: UpdateEvent): UpdateStatus {
  if (status.kind === "disabled") return status;
  switch (event.type) {
    case "checking":
      // A check while an update is downloading or waiting for a restart keeps that state.
      return status.kind === "downloading" || status.kind === "ready"
        ? status
        : { kind: "checking" };
    case "available": {
      if (status.kind === "ready" && status.version === event.info.version) return status;
      if (status.kind === "downloading" && status.version === event.info.version) return status;
      const manualUrl = event.manualUrl;
      // The manual path downloads one specific file (the DMG); its size, not the updater package's.
      const manualFile = manualUrl
        ? event.info.files?.find(
            (file) =>
              manualUrl.endsWith(encodeURIComponent(file.url)) || manualUrl.endsWith(file.url)
          )
        : undefined;
      const common = {
        version: event.info.version,
        notes: releaseNotesToText(event.info.releaseNotes),
        sizeBytes: manualUrl ? (manualFile?.size ?? null) : updateSize(event.info),
        releaseDate: event.info.releaseDate ?? null
      };
      return event.manualUrl
        ? { kind: "manual", ...common, url: event.manualUrl }
        : { kind: "available", ...common };
    }
    case "not-available":
      return status.kind === "ready" || status.kind === "downloading"
        ? status
        : { kind: "up-to-date" };
    case "download-started":
    case "progress": {
      if (status.kind !== "available" && status.kind !== "downloading") return status;
      const percent = event.type === "progress" ? Math.max(0, Math.min(100, event.percent)) : 0;
      return {
        kind: "downloading",
        version: status.version,
        notes: status.notes,
        releaseDate: status.releaseDate,
        percent,
        transferredBytes: event.type === "progress" ? event.transferred : 0,
        totalBytes:
          event.type === "progress"
            ? event.total
            : status.kind === "available"
              ? (status.sizeBytes ?? 0)
              : status.totalBytes
      };
    }
    case "downloaded":
      return {
        kind: "ready",
        version: event.info.version || versionOf(status) || "",
        notes: releaseNotesToText(event.info.releaseNotes) || notesOf(status),
        releaseDate: event.info.releaseDate ?? ("releaseDate" in status ? status.releaseDate : null)
      };
    case "error": {
      if (status.kind === "ready") return status;
      const phase = status.kind === "downloading" ? "download" : "check";
      return { kind: "error", message: readableUpdateError(event.error, phase) };
    }
  }
}

/** Statuses during which starting another check is pointless or would disturb the flow. */
export function isCheckBlocked(status: UpdateStatus): boolean {
  return (
    status.kind === "checking" ||
    status.kind === "downloading" ||
    status.kind === "ready" ||
    status.kind === "disabled"
  );
}
