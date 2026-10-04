import { describe, expect, it } from "vitest";
import {
  isAppUrl,
  isExternalHttpUrl,
  isPermissionAllowed,
  localImagePathFromUrl,
  PRODUCTION_CSP,
  isTrustedSenderUrl
} from "./security";

describe("isExternalHttpUrl", () => {
  it("accepts only http(s) links", () => {
    expect(isExternalHttpUrl("https://database.lichess.org/#puzzles")).toBe(true);
    expect(isExternalHttpUrl("http://example.com")).toBe(true);
    expect(isExternalHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalHttpUrl("chaturanga-image://local/x.png")).toBe(false);
    expect(isExternalHttpUrl("smb://host/share")).toBe(false);
    expect(isExternalHttpUrl("not a url")).toBe(false);
  });
});

describe("isAppUrl", () => {
  it("matches the dev server origin, including hash routes", () => {
    const dev = "http://localhost:5199";
    expect(isAppUrl("http://localhost:5199/#/review", dev)).toBe(true);
    expect(isAppUrl("http://localhost:5200/", dev)).toBe(false);
    expect(isAppUrl("https://evil.example/", dev)).toBe(false);
  });

  it("matches only the bundled index.html in production", () => {
    const prod =
      "file:///Applications/Chaturanga.app/Contents/Resources/app.asar/out/renderer/index.html";
    expect(isAppUrl(`${prod}#/settings`, prod)).toBe(true);
    expect(isAppUrl("file:///etc/passwd", prod)).toBe(false);
    expect(isAppUrl("https://example.com", prod)).toBe(false);
    expect(isAppUrl("garbage", prod)).toBe(false);
  });
});

describe("isPermissionAllowed", () => {
  it("grants clipboard writes and nothing else", () => {
    expect(isPermissionAllowed("clipboard-sanitized-write")).toBe(true);
    for (const permission of ["media", "geolocation", "notifications", "openExternal", "hid"]) {
      expect(isPermissionAllowed(permission)).toBe(false);
    }
  });
});

describe("localImagePathFromUrl", () => {
  const url = (path: string) => `chaturanga-image://local/${encodeURIComponent(path)}`;

  it("serves absolute image paths", () => {
    expect(localImagePathFromUrl(url("/Users/me/engines/Stockfish Logo.PNG"))).toBe(
      "/Users/me/engines/Stockfish Logo.PNG"
    );
    expect(localImagePathFromUrl(url("C:\\engines\\lc0.webp"))).toBe("C:\\engines\\lc0.webp");
  });

  it("refuses non-images, relative paths and other hosts or schemes", () => {
    expect(localImagePathFromUrl(url("/Users/me/.ssh/id_ed25519"))).toBeNull();
    expect(localImagePathFromUrl(url("/Users/me/chaturanga.sqlite"))).toBeNull();
    expect(localImagePathFromUrl(url("engines/logo.png"))).toBeNull();
    expect(localImagePathFromUrl(url("/tmp/a.png\0.txt"))).toBeNull();
    expect(localImagePathFromUrl("chaturanga-image://remote/%2Ftmp%2Fa.png")).toBeNull();
    expect(localImagePathFromUrl("file:///tmp/a.png")).toBeNull();
    expect(localImagePathFromUrl("::")).toBeNull();
  });
});

describe("PRODUCTION_CSP", () => {
  it("blocks remote scripts, plugins and framing", () => {
    expect(PRODUCTION_CSP).toContain("script-src 'self'");
    // Sounds load as bundled files, never data: URLs.
    expect(PRODUCTION_CSP).toContain("media-src 'self'");
    expect(PRODUCTION_CSP).toContain("object-src 'none'");
    expect(PRODUCTION_CSP).toContain("frame-ancestors 'none'");
    expect(PRODUCTION_CSP).not.toContain("unsafe-eval");
  });
});

describe("isTrustedSenderUrl", () => {
  it("trusts only the app's own page", () => {
    const packaged =
      "file:///Applications/Chaturanga.app/Contents/Resources/app.asar/out/renderer/index.html";
    expect(isTrustedSenderUrl(`${packaged}#/games/1/review`, packaged)).toBe(true);
    expect(isTrustedSenderUrl("file:///tmp/evil.html", packaged)).toBe(false);
    expect(isTrustedSenderUrl("http://127.0.0.1:5173/#/", "http://127.0.0.1:5173")).toBe(true);
    expect(isTrustedSenderUrl("https://example.com/", "http://127.0.0.1:5173")).toBe(false);
    expect(isTrustedSenderUrl(undefined, packaged)).toBe(false);
  });
});
