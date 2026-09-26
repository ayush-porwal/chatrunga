#!/usr/bin/env node
// Plans a release from git history: next version, tag, and Markdown release notes.
//
//   node scripts/release-plan.mjs --bump patch|minor|major [--version X.Y.Z[-pre]] \
//     [--repo owner/name] [--notes release-notes.md]
//
// Version source of truth is the latest `vX.Y.Z` tag (other tags, e.g. the old
// `alpha-v*`, are ignored). With no tags yet, the desktop package.json version is
// released as-is. Prints `version=…`, `tag=…`, `previous_tag=…` lines (GitHub
// Actions output format) and writes the notes file.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseArgs(argv) {
  const args = { bump: "patch", version: "", repo: "", notes: "release-notes.md" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!(key in args)) throw new Error(`Unknown argument: ${argv[i]}`);
    args[key] = argv[i + 1] ?? "";
  }
  if (!["patch", "minor", "major"].includes(args.bump)) throw new Error(`Invalid bump: ${args.bump}`);
  return args;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parse(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Not a semantic version: ${version}`);
  return { major: +match[1], minor: +match[2], patch: +match[3], pre: match[4] ?? "" };
}

function compare(a, b) {
  for (const key of ["major", "minor", "patch"]) if (a[key] !== b[key]) return a[key] - b[key];
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1; // a release sorts after its prereleases
  if (!b.pre) return -1;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true });
}

export function bumpVersion(current, bump) {
  const v = parse(current);
  if (v.pre) return `${v.major}.${v.minor}.${v.patch}`; // finishing a prerelease
  if (bump === "major") return `${v.major + 1}.0.0`;
  if (bump === "minor") return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

function latestVersionTag() {
  const tags = git("tag", "--list", "v*").split("\n").filter((tag) => SEMVER.test(tag.slice(1)));
  tags.sort((a, b) => compare(parse(a.slice(1)), parse(b.slice(1))));
  return tags.at(-1) ?? "";
}

const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactoring"],
  ["docs", "Documentation"],
  ["build", "Build & CI"],
  ["ci", "Build & CI"],
  ["test", "Tests"],
  ["chore", "Maintenance"]
];

export function releaseNotes({ commits, version, previousTag, repo }) {
  const groups = new Map();
  for (const { sha, subject } of commits) {
    const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
    const type = match?.[1]?.toLowerCase();
    const title = SECTIONS.find(([key]) => key === type)?.[1] ?? "Other changes";
    const scope = match?.[2] ? `**${match[2]}:** ` : "";
    const text = match ? match[4] : subject;
    const breaking = match?.[3] ? " ⚠️ breaking" : "";
    const link = repo ? `[\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})` : `\`${sha.slice(0, 7)}\``;
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(`- ${scope}${text}${breaking} (${link})`);
  }
  const order = [...new Set(SECTIONS.map(([, title]) => title)), "Other changes"];
  const body = order
    .filter((title) => groups.has(title))
    .map((title) => `### ${title}\n\n${groups.get(title).join("\n")}`)
    .join("\n\n");
  const compareLink =
    repo && previousTag ? `\n\n**Full changelog:** https://github.com/${repo}/compare/${previousTag}...v${version}` : "";
  return `## Chaturanga v${version}\n\n${body || "_No changes since the previous release._"}${compareLink}\n`;
}

function commitsSince(previousTag) {
  const range = previousTag ? [`${previousTag}..HEAD`] : ["HEAD"];
  const log = git("log", ...range, "--no-merges", "--pretty=format:%H%x09%s");
  return log
    ? log.split("\n").map((line) => {
        const [sha, ...rest] = line.split("\t");
        return { sha, subject: rest.join("\t") };
      })
    : [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const previousTag = latestVersionTag();
  const packageVersion = JSON.parse(readFileSync(new URL("../apps/desktop/package.json", import.meta.url))).version;

  let version = args.version.replace(/^v/, "");
  if (version) parse(version);
  else version = previousTag ? bumpVersion(previousTag.slice(1), args.bump) : packageVersion;

  if (previousTag && compare(parse(version), parse(previousTag.slice(1))) <= 0) {
    throw new Error(`Version ${version} must be greater than the latest release ${previousTag}.`);
  }
  if (git("tag", "--list", `v${version}`)) throw new Error(`Tag v${version} already exists.`);

  writeFileSync(args.notes, releaseNotes({ commits: commitsSince(previousTag), version, previousTag, repo: args.repo }));
  process.stdout.write(`version=${version}\ntag=v${version}\nprevious_tag=${previousTag}\nprerelease=${parse(version).pre ? "true" : "false"}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`release-plan: ${error.message}`);
    process.exit(1);
  }
}
