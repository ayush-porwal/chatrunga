#!/usr/bin/env node
// Plans a release from git history: next version, tag, and Markdown release notes.
//
//   node scripts/release-plan.mjs --bump patch|minor|major [--version X.Y.Z[-pre]] \
//     [--repo owner/name] [--notes release-notes.md]
//   node scripts/release-plan.mjs --channel nightly [--date YYYYMMDD] [--repo …] [--notes …]
//
// Version source of truth is the latest `vX.Y.Z` tag (other tags, e.g. the old
// `alpha-v*`, are ignored). With no tags yet, the desktop package.json version is
// released as-is. Prints `version=…`, `tag=…`, `previous_tag=…`, `prerelease=…` and
// `skip=…` lines (GitHub Actions output format) and writes the notes file.
//
// A nightly is the next patch after the latest stable release, as a dated prerelease
// (0.2.9-nightly.20261023): it sorts after the previous nightly and before that patch's
// release. Its notes cover the commits since the latest tag of either kind. `skip=true`
// when there's nothing new since that tag, or tonight's nightly already exists.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseArgs(argv) {
  const args = {
    bump: "patch",
    version: "",
    repo: "",
    notes: "release-notes.md",
    channel: "stable",
    date: ""
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!(key in args)) throw new Error(`Unknown argument: ${argv[i]}`);
    args[key] = argv[i + 1] ?? "";
  }
  if (!["patch", "minor", "major"].includes(args.bump))
    throw new Error(`Invalid bump: ${args.bump}`);
  if (!["stable", "nightly"].includes(args.channel))
    throw new Error(`Invalid channel: ${args.channel}`);
  if (args.date && !/^\d{8}$/.test(args.date)) throw new Error(`Invalid date: ${args.date}`);
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

/**
 * npm-style bump. A prerelease is "finished" only when the requested level matches it:
 * 0.9.0-beta.1 → patch/minor 0.9.0, major 1.0.0; 1.2.3-rc.1 → patch 1.2.3, minor 1.3.0.
 */
export function bumpVersion(current, bump) {
  const v = parse(current);
  if (bump === "major")
    return v.pre && v.minor === 0 && v.patch === 0 ? `${v.major}.0.0` : `${v.major + 1}.0.0`;
  if (bump === "minor")
    return v.pre && v.patch === 0 ? `${v.major}.${v.minor}.0` : `${v.major}.${v.minor + 1}.0`;
  return v.pre ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}.${v.patch + 1}`;
}

/** The latest `vX.Y.Z[-pre]` tag; only stable ones (no prerelease) when `stableOnly`. */
function latestVersionTag({ stableOnly = false } = {}) {
  const tags = git("tag", "--list", "v*")
    .split("\n")
    .filter((tag) => SEMVER.test(tag.slice(1)))
    .filter((tag) => !stableOnly || !parse(tag.slice(1)).pre);
  tags.sort((a, b) => compare(parse(a.slice(1)), parse(b.slice(1))));
  return tags.at(-1) ?? "";
}

/**
 * Tonight's nightly: the patch after the latest stable release (or the package version when there
 * is none), as `-nightly.<date>`. 0.2.8 on 2026-10-23 → 0.2.9-nightly.20261023.
 */
export function nightlyVersion(latestStable, packageVersion, date) {
  const base = latestStable ? bumpVersion(latestStable, "patch") : packageVersion.split("-")[0];
  return `${base}-nightly.${date}`;
}

/** Today's date in UTC as YYYYMMDD. */
function todayUtc() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
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

/** A commit's section (by its Conventional Commits type) and its bullet in the notes. */
function noteEntry({ sha, subject }, repo) {
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
  const type = match?.[1]?.toLowerCase();
  const title = SECTIONS.find(([key]) => key === type)?.[1] ?? "Other changes";
  const scope = match?.[2] ? `**${match[2]}:** ` : "";
  const text = match ? match[4] : subject;
  const breaking = match?.[3] ? " ⚠️ breaking" : "";
  const link = repo
    ? `[\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})`
    : `\`${sha.slice(0, 7)}\``;
  return { title, line: `- ${scope}${text}${breaking} (${link})` };
}

export function releaseNotes({ commits, version, previousTag, repo }) {
  const groups = new Map();
  for (const commit of commits) {
    const { title, line } = noteEntry(commit, repo);
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(line);
  }
  const order = [...new Set(SECTIONS.map(([, title]) => title)), "Other changes"];
  const body = order
    .filter((title) => groups.has(title))
    .map((title) => `### ${title}\n\n${groups.get(title).join("\n")}`)
    .join("\n\n");
  const compareLink =
    repo && previousTag
      ? `\n\n**Full changelog:** https://github.com/${repo}/compare/${previousTag}...v${version}`
      : "";
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
  const nightly = args.channel === "nightly";
  // A release's notes and version follow the last release (nightlies in between don't count); a
  // nightly's follow the last tag of either kind.
  const previousTag = latestVersionTag({ stableOnly: !nightly });
  const packageVersion = JSON.parse(
    readFileSync(new URL("../apps/desktop/package.json", import.meta.url))
  ).version;

  let version = args.version.replace(/^v/, "");
  if (nightly) {
    const stable = latestVersionTag({ stableOnly: true });
    version = nightlyVersion(
      stable ? stable.slice(1) : "",
      packageVersion,
      args.date || todayUtc()
    );
  } else if (version) parse(version);
  else version = previousTag ? bumpVersion(previousTag.slice(1), args.bump) : packageVersion;

  const commits = commitsSince(previousTag);
  // A nightly with nothing new, or one already made tonight, is skipped rather than failed.
  const skip = nightly && (!commits.length || Boolean(git("tag", "--list", `v${version}`)));
  if (!skip) {
    if (previousTag && compare(parse(version), parse(previousTag.slice(1))) <= 0) {
      throw new Error(`Version ${version} must be greater than the latest release ${previousTag}.`);
    }
    if (git("tag", "--list", `v${version}`)) throw new Error(`Tag v${version} already exists.`);
  }

  writeFileSync(args.notes, releaseNotes({ commits, version, previousTag, repo: args.repo }));
  process.stdout.write(
    `version=${version}\ntag=v${version}\nprevious_tag=${previousTag}\nprerelease=${parse(version).pre ? "true" : "false"}\nskip=${skip}\n`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`release-plan: ${error.message}`);
    process.exit(1);
  }
}
