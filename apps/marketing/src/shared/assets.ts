// Release builds are published on GitHub Releases by .github/workflows/release.yml.
// File names carry the version (Chaturanga-<version>-mac-arm64.dmg, -win-x64-setup.exe,
// -linux-x86_64.AppImage), so every platform links to the releases page. That page lists
// prereleases too (unlike /releases/latest, which skips them and is empty until a stable release
// exists). index.html references these as %DOWNLOAD_URL% and %DOWNLOAD_URL_<PLATFORM>%
// (substituted in vite.config.ts).
export const RELEASES_URL = "https://github.com/ayush-porwal/chatrunga/releases";
export const DOWNLOAD_URL = RELEASES_URL;

export type PlatformId = "mac" | "windows" | "linux";

export type Platform = {
  id: PlatformId;
  /** Shown on buttons: "Download for <name>". */
  name: string;
  /** The file to pick on the release page. */
  file: string;
  arch: string;
  href: string;
};

export const PLATFORMS: readonly Platform[] = [
  { id: "mac", name: "macOS", file: ".dmg", arch: "Apple silicon and Intel", href: DOWNLOAD_URL },
  { id: "windows", name: "Windows", file: "setup .exe", arch: "64-bit (x64)", href: DOWNLOAD_URL },
  { id: "linux", name: "Linux", file: "AppImage", arch: "64-bit (x64)", href: DOWNLOAD_URL }
];
