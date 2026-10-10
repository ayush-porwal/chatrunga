#!/usr/bin/env node
/**
 * Lighthouse against the packaged desktop app only.
 * Electron loads file://, which Lighthouse will not navigate to itself, so each
 * route is a reload of that same packaged page driven from inside the app.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { navigation } from "lighthouse";

const root = fileURLToPath(new URL("..", import.meta.url));
const appBin = join(
  root,
  "apps/desktop/dist/mac-arm64/Chaturanga.app/Contents/MacOS/Chaturanga"
);
statSync(appBin);

const ROUTES = [
  "#/",
  "#/repertoires",
  "#/repertoires/demo/chapters/demo",
  "#/repertoires/demo/practice",
  "#/games/current/review"
];

const flags = {
  logLevel: "error",
  onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
  disableStorageReset: true
};

async function auditNavigation(page, hash, label) {
  const result = await navigation(
    page,
    async () => {
      await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await page.reload({ waitUntil: "load", timeout: 30_000 });
    },
    { config: desktopConfig, flags }
  );
  if (!result) throw new Error(`lighthouse returned no result for ${label}`);
  return scores(result.lhr, label);
}

function scores(lhr, label) {
  const round = (id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
  const failed = [];
  for (const category of Object.values(lhr.categories)) {
    for (const ref of category.auditRefs ?? []) {
      const audit = lhr.audits[ref.id];
      if (audit && audit.score !== null && audit.score < 1) failed.push(ref.id);
    }
  }
  const row = {
    performance: round("performance"),
    accessibility: round("accessibility"),
    "best-practices": round("best-practices"),
    seo: round("seo")
  };
  console.error(
    `LH ${label} perf=${row.performance} a11y=${row.accessibility} bp=${row["best-practices"]} seo=${row.seo} url=${lhr.finalUrl} failed=${failed.join(",")}`
  );
  return row;
}

const port = 9333;
const profile = mkdtempSync(join(tmpdir(), "chaturanga-lh-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.CHATURANGA_USER_DATA_DIR = profile;
env.CHATURANGA_TELEMETRY_ENABLED = "false";
env.CHATURANGA_UPDATE_FEED_URL = "http://127.0.0.1:9/";
// Same hook the packaged e2e uses so an unfocused window still paints at full speed.
env.CHATURANGA_E2E_BACKGROUND = "1";

const child = spawn(
  appBin,
  [
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    "--use-mock-keychain",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    `--user-data-dir=${profile}`
  ],
  { env, stdio: "ignore" }
);

async function waitForDebugger() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // App still starting.
    }
    await delay(250);
  }
  throw new Error("packaged app did not open a debugging port");
}

const mins = { performance: 100, accessibility: 100, "best-practices": 100, seo: 100 };
const pages = [];

function take(row) {
  pages.push(row);
  for (const key of Object.keys(mins)) mins[key] = Math.min(mins[key], row[key]);
}

try {
  await waitForDebugger();
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null
  });
  const targets = await browser.pages();
  const page = targets.find((candidate) => candidate.url().startsWith("file:"));
  if (!page) throw new Error(`no file:// page in packaged app: ${targets.map((t) => t.url()).join(" ")}`);
  const session = await page.createCDPSession();
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.waitForSelector("#root", { timeout: 20_000 });
  await page.waitForSelector("xpath/.//button[contains(., 'Skip setup')]", { timeout: 20_000 });
  take(await auditNavigation(page, "#/", "desktop-onboarding"));
  const skip = await page.waitForSelector("xpath/.//button[contains(., 'Skip setup')]", {
    timeout: 20_000
  });
  await skip.click();
  await page.waitForSelector("[role=dialog]", { hidden: true, timeout: 15_000 });

  for (const route of ROUTES) {
    take(await auditNavigation(page, route, `desktop${route}`));
  }
  await browser.disconnect();
} finally {
  child.kill("SIGTERM");
  await delay(300);
  child.kill("SIGKILL");
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A profile the app has not released yet must not fail the score.
  }
}

console.log(`METRIC lh_perf=${mins.performance}`);
console.log(`METRIC lh_a11y=${mins.accessibility}`);
console.log(`METRIC lh_bp=${mins["best-practices"]}`);
console.log(`METRIC lh_seo=${mins.seo}`);
console.log(`METRIC lh_pages=${pages.length}`);
