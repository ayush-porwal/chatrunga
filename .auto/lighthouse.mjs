#!/usr/bin/env node
/**
 * Lighthouse for every audited page. Prints METRIC lh_* lines.
 * Marketing is served from its production build. Desktop routes run in Electron.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const desktopDir = join(root, "apps/desktop");
const require = createRequire(join(desktopDir, "package.json"));

const DESKTOP_ROUTES = [
  "#/",
  "#/repertoires",
  "#/repertoires/demo/chapters/demo",
  "#/repertoires/demo/practice",
  "#/games/current/review"
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`));
      else resolve({ stdout, stderr });
    });
  });
}

async function lighthouse(url, preset, extraArgs = []) {
  const args = [
    "--yes",
    "lighthouse",
    url,
    "--quiet",
    "--chrome-flags=--headless=new --no-first-run",
    "--only-categories=performance,accessibility,best-practices,seo",
    "--output=json",
    "--output-path=stdout",
    `--preset=${preset}`,
    ...extraArgs
  ];
  const { stdout } = await run("npx", args, { cwd: root });
  const start = stdout.indexOf("{");
  const report = JSON.parse(stdout.slice(start));
  const score = (id) => Math.round((report.categories[id]?.score ?? 0) * 100);
  return {
    performance: score("performance"),
    accessibility: score("accessibility"),
    "best-practices": score("best-practices"),
    seo: score("seo")
  };
}

function staticServer(dir, port) {
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".json": "application/json"
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
    const path = join(dir, rel === "/" ? "index.html" : rel);
    if (!path.startsWith(dir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = readFileSync(path);
      res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const mins = { performance: 100, accessibility: 100, "best-practices": 100, seo: 100 };
const pages = [];

function take(label, scores) {
  pages.push(label);
  for (const key of Object.keys(mins)) mins[key] = Math.min(mins[key], scores[key]);
  console.error(`LH ${label} ${JSON.stringify(scores)}`);
}

const marketingDir = join(root, "apps/marketing/dist");
statSync(join(marketingDir, "index.html"));
const marketing = await staticServer(marketingDir, 5181);
try {
  for (const preset of ["desktop", "mobile"]) {
    take(`marketing/${preset}`, await lighthouse("http://127.0.0.1:5181/", preset));
  }
} finally {
  marketing.close();
}

// Desktop routes in the real Electron renderer. Lighthouse attaches to the app's
// debugging port so the scores are the packaged UI, not a fixture.
const electron = require("electron");
const port = 9229;
const profile = join(root, "apps/desktop/dist/.lh-profile");
const child = spawn(
  electron,
  [
    join(desktopDir, "out/main/index.js"),
    `--remote-debugging-port=${port}`,
    "--use-mock-keychain",
    "--disable-backgrounding-occluded-windows"
  ],
  {
    cwd: desktopDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      CHATURANGA_USER_DATA_DIR: profile,
      CHATURANGA_TELEMETRY_ENABLED: "false",
      CHATURANGA_UPDATE_FEED_URL: "http://127.0.0.1:9/"
    },
    stdio: "ignore"
  }
);
delete child.env;

async function debuggerUrl() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* app still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Electron debugging port did not open");
}

try {
  const target = await debuggerUrl();
  const base = target.url.split("#")[0];
  for (const route of DESKTOP_ROUTES) {
    const url = `${base}${route}`;
    take(
      `desktop${route}`,
      await lighthouse(url, "desktop", [`--port=${port}`, "--skip-audits=is-on-https"])
    );
  }
} finally {
  child.kill("SIGTERM");
}

console.log(`METRIC lh_perf=${mins.performance}`);
console.log(`METRIC lh_a11y=${mins.accessibility}`);
console.log(`METRIC lh_bp=${mins["best-practices"]}`);
console.log(`METRIC lh_seo=${mins.seo}`);
console.log(`METRIC lh_pages=${pages.length}`);
