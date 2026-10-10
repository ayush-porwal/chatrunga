import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import {
  compactSvg,
  dropBakedShadows,
  FILES,
  fitSvg,
  HEIGHTS,
  loadFit,
  packedPayload,
  payloadPath,
  prepareSvg,
  THEMES
} from "./generate-piece-theme-css.mjs";

test("a drawing in a small box keeps more digits", () => {
  assert.equal(
    compactSvg('<svg viewBox="0 0 10 10"><path d="M1.234567 0"/></svg>'),
    '<svg viewBox="0 0 10 10"><path d="M1.23457 0"/></svg>'
  );
});

test("rounding keeps packed path numbers apart", () => {
  // `1.9998.006` and `2.634.0024` are two numbers each: rounding must neither glue them together
  // nor start inside one (`634.0024`).
  assert.equal(
    compactSvg('<svg><path d="M1.9998.006l3.14159.5 2.634.0024"/></svg>'),
    '<svg><path d="M2 .006l3.142.5 2.634.0024"/></svg>'
  );
});

test("transforms keep their precision", () => {
  assert.equal(
    compactSvg(
      '<svg><path transform="matrix(1.0008 0 0 1.0001 462.7543 3.5)" d="M1.23456 0"/></svg>'
    ),
    '<svg><path transform="matrix(1.0008 0 0 1.0001 462.7543 3.5)" d="M1.235 0"/></svg>'
  );
});

test("a drawing sized only by width/height keeps that box as its viewBox", () => {
  assert.equal(
    compactSvg('<svg width="368" height="368"><path/></svg>'),
    '<svg viewBox="0 0 368 368"><path/></svg>'
  );
});

test("the published color-scheme marker is dropped", () => {
  assert.equal(
    compactSvg('<svg style="color-scheme:light only" viewBox="0 0 9 9"><path/></svg>'),
    '<svg viewBox="0 0 9 9"><path/></svg>'
  );
});

test("only the root loses its size", () => {
  assert.equal(
    compactSvg('<svg width="45" height="45"><filter width="1.46" height="1.33"/></svg>'),
    '<svg viewBox="0 0 45 45"><filter width="1.46" height="1.33"/></svg>'
  );
});

test("fitting swaps in the square viewBox", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -92.5 398 510"><path/></svg>';
  assert.equal(
    fitSvg(svg, "1 2 300 300"),
    '<svg viewBox="1 2 300 300" xmlns="http://www.w3.org/2000/svg"><path/></svg>'
  );
});

test("every drawing has a square fit and survives the pipeline", () => {
  const fit = loadFit();
  for (const heights of HEIGHTS) {
    for (const theme of THEMES) {
      for (const [, , file] of FILES) {
        const [, , w, h] = fit[heights][theme][file].split(" ").map(Number);
        assert.equal(w, h, `${heights} ${theme}/${file} viewBox is square`);
        assert.match(
          prepareSvg(theme, file, fit, heights),
          /^<svg [^>]*viewBox="[^"]+"[^>]*>[\s\S]*<\/svg>$/
        );
      }
    }
  }
});

test("a baked-in drop shadow is detached; other filters stay", () => {
  const svg =
    '<svg><filter id="b"><feGaussianBlur/><feOffset dx="1" dy="1"/></filter><filter id="c"><feGaussianBlur/></filter>' +
    '<path filter="url(#b)"/><path filter="url(#c)"/></svg>';
  const out = dropBakedShadows(svg);
  assert.doesNotMatch(out, /filter="url\(#b\)"/);
  assert.match(out, /<path filter="url\(#c\)"\/>/);
  // Named in an inline style too.
  const styled = dropBakedShadows(
    '<svg><filter id="s"><feOffset dx="1"/></filter><path style="fill:red;filter:url(#s);opacity:1"/></svg>'
  );
  assert.match(styled, /style="fill:red;opacity:1"/);
  // Whatever the filter's attribute order, and an id with regex characters in it.
  const ordered = dropBakedShadows(
    '<svg><filter x="0" id="a.b"><feOffset dx="1"/></filter><path filter="url(#a.b)"/><path filter="url(#aXb)"/></svg>'
  );
  assert.match(ordered, /<path\/><path filter="url\(#aXb\)"\/>/);
});

test("the committed payload is what the sources pack to", () => {
  const committed = gunzipSync(readFileSync(payloadPath)).toString("utf8");
  assert.ok(
    committed === packedPayload(loadFit()),
    "generated-piece-themes.css.gz is stale: run `node scripts/measure-piece-fit.mjs && pnpm generate:piece-css`"
  );
});

test("the payload names its sets, then holds every drawing and every uniform box", () => {
  const fit = loadFit();
  const [header, ...entries] = packedPayload(fit).split("\0");
  assert.deepEqual(header.split(" "), THEMES);
  assert.equal(entries.length, THEMES.length * FILES.length * 2);
  assert.equal(entries.at(-1), fit.uniform[THEMES.at(-1)][FILES.at(-1)[2]]);
});

test("every set the app lists is packed", () => {
  const settings = readFileSync(
    new URL("../packages/shared/src/types/settings.ts", import.meta.url),
    "utf8"
  );
  const listed = settings
    .match(/VENDORED_PIECE_SETS[^=]*= \[([^\]]*)\]/)[1]
    .match(/"[^"]+"/g)
    .map((s) => JSON.parse(s));
  assert.deepEqual(new Set(THEMES), new Set(["cburnett", ...listed]));
});

test("CREDITS.md lists every set with the licence the app shows for it", () => {
  const settings = readFileSync(
    new URL("../packages/shared/src/types/settings.ts", import.meta.url),
    "utf8"
  );
  const licenceBlock = settings.slice(
    settings.indexOf("const PIECE_LICENCES"),
    settings.indexOf("} satisfies")
  );
  const licences = Object.fromEntries(
    [...licenceBlock.matchAll(/(\w+): \{\s*name: "([^"]+)",\s*url: "([^"]+)"/g)].map(
      ([, key, name, url]) => [key, `[${name}](${url})`]
    )
  );
  const options = settings.slice(settings.indexOf("export const pieceStyleOptions"));
  const shown = Object.fromEntries(
    options
      .slice(0, options.indexOf("\n];"))
      .split("\n  {")
      .slice(1)
      .map((entry) => [
        entry.match(/id: "([^"]+)"/)[1],
        licences[entry.match(/licence: PIECE_LICENCES\.(\w+)/)[1]]
      ])
  );
  const credits = readFileSync(new URL("./piece-svg-sources/CREDITS.md", import.meta.url), "utf8");
  const listed = Object.fromEntries(
    [...credits.matchAll(/^\| ([a-z][a-z0-9-]*) \| [^|]+ \| (.+) \|$/gm)].map(
      ([, set, licence]) => [set, licence]
    )
  );
  assert.deepEqual(listed, shown);
  assert.deepEqual(new Set(Object.keys(shown)), new Set(THEMES));
});
