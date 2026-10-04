// Proves the Oxlint config still rejects what it is meant to and passes legitimate code: each case
// is a small file at a path inside a throwaway copy of the repo layout (overrides match by path),
// linted with the real oxlint.config.ts, and asserts exactly which lines each named rule flags.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const oxlint = join(repo, "node_modules", ".bin", "oxlint");
const { default: config } = await import(pathToFileURL(join(repo, "oxlint.config.ts")).href);

/** The repo config with JS plugin specifiers made absolute, so it runs from a temp directory. */
function portableConfig() {
  const requireFromRepo = createRequire(join(repo, "package.json"));
  return {
    ...config,
    jsPlugins: config.jsPlugins.map(({ name, specifier }) => ({
      name,
      specifier: specifier.startsWith(".")
        ? resolve(repo, specifier)
        : requireFromRepo.resolve(specifier)
    }))
  };
}

const RESTRICTED = "eslint(no-restricted-imports)";

/**
 * `rules` lists the rules a case is about; `lines` the lines they must flag in that file (none, for
 * legitimate code). Other rules' findings in the same file are ignored.
 */
const CASES = [
  // Process boundaries: static and dynamic imports.
  {
    name: "the renderer can't import Electron, Node built-ins, or main/preload code",
    file: "apps/desktop/src/renderer/src/features/boundary.ts",
    rules: [RESTRICTED],
    lines: [1, 2, 3, 4, 5, 7, 8, 9],
    code: `import { ipcRenderer } from "electron";
import { readFileSync } from "node:fs";
import { join } from "path";
import { handlers } from "../../../main/ipc/register";
import { api } from "../../../preload/index";
export async function load() {
  await import("electron");
  await import("node:child_process");
  await import("../../../main/index");
  return [ipcRenderer, readFileSync, join, handlers, api];
}
`
  },
  {
    name: "the renderer may import shared code, its own aliases and browser packages",
    file: "apps/desktop/src/renderer/src/features/allowed.ts",
    rules: [RESTRICTED],
    lines: [],
    code: `import { parseSquare } from "chessops/util";
import { MAIA_RATINGS } from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";
export async function load() {
  const { Chess } = await import("chessops/chess");
  return [parseSquare, MAIA_RATINGS, cn, Chess];
}
`
  },
  {
    name: "renderer unit tests run in Node and may use it",
    file: "apps/desktop/src/renderer/src/features/allowed.test.ts",
    rules: [RESTRICTED],
    lines: [],
    code: `import { readFileSync } from "node:fs";
export const read = () => readFileSync("x");
`
  },
  {
    name: "the marketing page can't import Node built-ins",
    file: "apps/marketing/src/page.ts",
    rules: [RESTRICTED],
    lines: [1, 2],
    code: `import { readFileSync } from "node:fs";
export const load = () => import("os").then(() => readFileSync);
`
  },
  {
    name: "main can't import renderer code",
    file: "apps/desktop/src/main/feature.ts",
    rules: [RESTRICTED],
    lines: [1, 2, 4],
    code: `import { cn } from "@/lib/utils";
import { App } from "../renderer/src/app/App";
export async function load() {
  await import("../renderer/src/lib/uci");
  return [cn, App];
}
`
  },
  {
    name: "main may import Node, Electron and shared code",
    file: "apps/desktop/src/main/allowed.ts",
    rules: [RESTRICTED],
    lines: [],
    code: `import { readFileSync } from "node:fs";
import { app } from "electron";
import { IPC } from "@chaturanga/shared/ipc/channels";
export const load = async () => [readFileSync, app, IPC, await import("node:path")];
`
  },
  {
    name: "the sandboxed preload can't load Node built-ins or main/renderer code",
    file: "apps/desktop/src/preload/bridge.ts",
    rules: [RESTRICTED],
    lines: [1, 2, 3, 4, 5, 7],
    code: `import { readFileSync } from "node:fs";
import { join } from "path";
import { handlers } from "../main/ipc/register";
import { cn } from "@/lib/utils";
import { App } from "../renderer/src/app/App";
export async function load() {
  await import("node:fs/promises");
  return [readFileSync, join, handlers, cn, App];
}
`
  },
  {
    name: "the preload may import Electron's renderer modules and shared contracts",
    file: "apps/desktop/src/preload/allowed.ts",
    rules: [RESTRICTED],
    lines: [],
    code: `import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@chaturanga/shared/ipc/channels";
export const bridge = [contextBridge, ipcRenderer, IPC];
`
  },

  // React Hooks, including the React Compiler rules eslint-plugin-react-hooks enabled.
  {
    name: "Hooks rules: conditional Hooks and missing effect dependencies",
    file: "apps/desktop/src/renderer/src/features/hooks.tsx",
    rules: ["react-hooks(rules-of-hooks)", "react-hooks(exhaustive-deps)"],
    lines: [4, 6],
    code: `import { useEffect, useState } from "react";
export function Hooks({ id, open }: { id: string; open: boolean }) {
  if (open) {
    useState(0);
  }
  useEffect(() => console.log(id), []);
  return null;
}
`
  },
  {
    name: "Hooks rules: complete dependencies and unconditional Hooks pass",
    file: "apps/desktop/src/renderer/src/features/hooks-ok.tsx",
    rules: ["react-hooks(rules-of-hooks)", "react-hooks(exhaustive-deps)"],
    lines: [],
    code: `import { useEffect, useState } from "react";
export function Hooks({ id }: { id: string }) {
  const [count] = useState(0);
  useEffect(() => console.log(id, count), [id, count]);
  return null;
}
`
  },
  {
    name: "React Compiler rules flag render-time mistakes",
    file: "apps/desktop/src/renderer/src/features/compiler.tsx",
    rules: [
      "react(static-components)",
      "react(use-memo)",
      "react(immutability)",
      "react(globals)",
      "react(refs)",
      "react(error-boundaries)",
      "react(purity)",
      "react(set-state-in-render)",
      "react(unsupported-syntax)",
      "react(incompatible-library)"
    ],
    lines: [8, 11, 15, 19, 24, 29, 36, 42, 46, 51],
    code: `import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
let renders = 0;
function Child() { return <span />; }

export function StaticComponents({ label }: { label: string }) {
  const Inner = () => <span>{label}</span>;
  return <Inner />;
}
export function UseMemo({ value }: { value: number }) {
  const doubled = useMemo((factor: number) => value * factor, [value]);
  return <span>{doubled}</span>;
}
export function Immutability({ config }: { config: { x: number } }) {
  config.x = 2;
  return <span>{config.x}</span>;
}
export function Globals() {
  renders = renders + 1;
  return <span>{renders}</span>;
}
export function Refs() {
  const ref = useRef(0);
  return <span>{ref.current}</span>;
}

export function ErrorBoundaries() {
  try {
    return <Child />;
  } catch {
    return null;
  }
}

export function Purity() {
  const now = Date.now();
  return <span>{now}</span>;
}

export function SetStateInRender() {
  const [count, setCount] = useState(0);
  setCount(1);
  return <span>{count}</span>;
}
export function Unsupported() {
  const value = eval("1");
  return <span>{value}</span>;
}
export function Incompatible() {
  const form = useForm();
  return <span>{String(form.watch("x"))}</span>;
}
`
  },

  // TanStack Query's rules, through the pinned JS plugin.
  {
    name: "TanStack Query rules: query keys, stable clients, stable deps and property order",
    file: "apps/desktop/src/renderer/src/queries/query.tsx",
    rules: [
      "@tanstack/query(exhaustive-deps)",
      "@tanstack/query(stable-query-client)",
      "@tanstack/query(no-unstable-deps)",
      "@tanstack/query(infinite-query-property-order)",
      "@tanstack/query(mutation-property-order)"
    ],
    lines: [11, 12, 14, 15, 21],
    code: `import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery
} from "@tanstack/react-query";
import { useEffect } from "react";
const load = (id: string) => Promise.resolve(id);

export function Queries({ id }: { id: string }) {
  const client = new QueryClient();
  const query = useQuery({ queryKey: ["game"], queryFn: () => load(id) });
  const mutation = useMutation({ mutationFn: load });
  useEffect(() => mutation.reset(), [mutation]);
  const pages = useInfiniteQuery({
    queryKey: ["pages"],
    getNextPageParam: (last: number) => last + 1,
    queryFn: ({ pageParam }) => Promise.resolve(pageParam),
    initialPageParam: 0
  });
  const save = useMutation({
    onError: () => undefined,
    onMutate: () => undefined,
    mutationFn: load
  });
  return [client, query, pages, save];
}
`
  },
  {
    name: "TanStack Query rules pass a complete key and a module-level client",
    file: "apps/desktop/src/renderer/src/queries/query-ok.tsx",
    rules: ["@tanstack/query(exhaustive-deps)", "@tanstack/query(stable-query-client)"],
    lines: [],
    code: `import { QueryClient, useQuery } from "@tanstack/react-query";
export const client = new QueryClient();
const load = (id: string) => Promise.resolve(id);
export function Query({ id }: { id: string }) {
  return useQuery({ queryKey: ["game", id], queryFn: () => load(id) });
}
`
  },

  // Type-aware rules (oxlint-tsgolint).
  {
    name: "dropped promises, async callbacks where a sync one is expected, and awaiting a non-promise",
    file: "apps/desktop/src/main/async.ts",
    rules: [
      "typescript(no-floating-promises)",
      "typescript(no-misused-promises)",
      "typescript(await-thenable)"
    ],
    lines: [3, 4, 8],
    code: `const save = async (value: number) => value;
export function run(list: number[]) {
  save(1);
  list.forEach(async (value) => await save(value));
  return list;
}
export async function wait() {
  await 5;
}
`
  },
  {
    name: "awaited, handled or explicitly discarded promises pass",
    file: "apps/desktop/src/main/async-ok.ts",
    rules: ["typescript(no-floating-promises)", "typescript(no-misused-promises)"],
    lines: [],
    code: `const save = async (value: number) => value;
export async function run(list: number[]) {
  await save(1);
  save(2).catch(() => undefined);
  void save(3);
  await Promise.all(list.map(async (value) => save(value)));
}
`
  },

  {
    name: "unhandled union members, any, and untyped data flowing into typed code",
    file: "apps/desktop/src/main/unsafe.ts",
    rules: [
      "typescript(switch-exhaustiveness-check)",
      "typescript(no-explicit-any)",
      "typescript(no-unsafe-assignment)",
      "typescript(no-unsafe-member-access)",
      "typescript(no-unsafe-call)",
      "typescript(no-unsafe-argument)",
      "typescript(no-unsafe-return)"
    ],
    lines: [3, 9, 10, 11, 12, 12, 13, 15],
    code: `type Phase = "idle" | "running" | "done";
export function label(phase: Phase): string {
  switch (phase) {
    case "idle":
      return "Idle";
  }
  return "";
}
export function read(text: string, take: (value: string) => void, loose: any) {
  const parsed = JSON.parse(text);
  JSON.parse(text).field;
  JSON.parse(text).run();
  take(JSON.parse(text));
  void [parsed, loose];
  return JSON.parse(text);
}
`
  },
  {
    name: "parsed data typed as unknown, then narrowed, passes",
    file: "apps/desktop/src/main/unsafe-ok.ts",
    rules: [
      "typescript(no-unsafe-assignment)",
      "typescript(no-unsafe-member-access)",
      "typescript(no-unsafe-return)"
    ],
    lines: [],
    code: `export function read(text: string): string | null {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string") {
    return parsed.name;
  }
  return null;
}
`
  },

  {
    name: "production code can't narrow a value with a cast",
    file: "apps/desktop/src/main/cast.ts",
    rules: ["typescript(no-unsafe-type-assertion)"],
    lines: [3, 4],
    code: `type Kind = "opening" | "reference";
export function kindOf(value: unknown, text: string): [Kind, Kind] {
  const fromInput = value as Kind;
  const fromText = text as Kind;
  return [fromInput, fromText];
}
`
  },
  {
    name: "tests may cast test doubles and malformed inputs",
    file: "apps/desktop/src/main/cast.test.ts",
    rules: ["typescript(no-unsafe-type-assertion)"],
    lines: [],
    code: `type Kind = "opening" | "reference";
it("passes a malformed kind through", () => {
  expect(("other" as string as Kind).length).toBe(5);
});
`
  },

  // Test hygiene in unit and e2e tests.
  {
    name: "tests can't be focused or skipped, and every expect is complete and specific",
    file: "apps/desktop/src/main/hygiene.test.ts",
    rules: [
      "vitest(no-focused-tests)",
      "vitest(no-disabled-tests)",
      "vitest(valid-expect)",
      "vitest(valid-expect-in-promise)",
      "vitest(require-to-throw-message)",
      "vitest(no-conditional-expect)",
      "vitest(expect-expect)"
    ],
    lines: [3, 4, 6, 8, 11, 13, 14, 16],
    code: `const parse = (value: unknown) => String(value);
const load = () => Promise.resolve(1);
it.only("focused", () => expect(parse(1)).toBe("1"));
it.skip("skipped", () => expect(parse(1)).toBe("1"));
it("incomplete", () => {
  expect(parse(1));
});
it("unawaited", () => { load().then((value) => { expect(value).toBe(1); }); });
it("any error", () => {
  expect(() => parse(1)).not.toThrow(/x/);
  expect(() => parse(1)).toThrow();
});
it("conditional", () => {
  if (parse(1)) expect(parse(1)).toBe("1");
});
it("no assertions", () => {
  parse(1);
});
`
  },
  {
    name: "complete tests pass: a failure message, a specific error and an assertion helper",
    file: "apps/desktop/src/main/hygiene-ok.test.ts",
    rules: ["vitest(valid-expect)", "vitest(require-to-throw-message)", "vitest(expect-expect)"],
    lines: [],
    code: `const parse = (value: unknown) => String(value);
const expectParsed = (value: unknown) => expect(parse(value), "parsed").toBe(String(value));
it("message", () => {
  expect(parse(1), "the number as text").toBe("1");
  expect(() => JSON.parse("{")).toThrow(/JSON/);
});
it("helper", () => expectParsed(2));
`
  },

  // eslint:recommended and typescript-eslint's recommended set (a sample of each kind).
  {
    name: "recommended rules: unused values, empty blocks, ts-ignore, debugger and const",
    file: "packages/shared/src/sample.ts",
    rules: [
      "eslint(no-unused-vars)",
      "eslint(no-empty)",
      "eslint(prefer-const)",
      "eslint(no-debugger)",
      "typescript(ban-ts-comment)"
    ],
    lines: [1, 3, 4, 6, 7],
    code: `const unused = 1;
export function sample(input: string) {
  let fixed = input;
  if (fixed) {
  }
  // @ts-ignore
  debugger;
  return fixed;
}
`
  },
  {
    name: "plain JS scripts reject undefined names",
    file: "scripts/tool.mjs",
    rules: ["eslint(no-undef)"],
    lines: [2],
    code: `import { readFileSync } from "node:fs";
console.log(readFileSync(process.argv[2]), missingName);
`
  }
];

let findings;
let workDir;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "chaturanga-lint-"));
  writeFileSync(join(workDir, ".oxlintrc.json"), JSON.stringify(portableConfig()));
  // Type-aware rules need a program: one strict project over every case.
  writeFileSync(
    join(workDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: []
      },
      include: ["**/*.ts", "**/*.tsx"]
    })
  );
  for (const { file, code } of CASES) {
    mkdirSync(dirname(join(workDir, file)), { recursive: true });
    writeFileSync(join(workDir, file), code);
  }
  // Packages resolve as they do in the repo (react, @tanstack/react-query live in desktop's).
  mkdirSync(join(workDir, "apps/desktop"), { recursive: true });
  symlinkSync(join(repo, "apps/desktop/node_modules"), join(workDir, "apps/desktop/node_modules"));
  symlinkSync(join(repo, "node_modules"), join(workDir, "node_modules"));

  const result = spawnSync(oxlint, ["-c", ".oxlintrc.json", "-f", "json", "."], {
    cwd: workDir,
    encoding: "utf8"
  });
  assert.ok(result.stdout, `oxlint printed nothing:\n${result.stderr}`);
  findings = JSON.parse(result.stdout).diagnostics.map((diagnostic) => ({
    file: diagnostic.filename,
    rule: diagnostic.code,
    line: diagnostic.labels[0]?.span.line,
    message: diagnostic.message
  }));
});

after(() => rmSync(workDir, { recursive: true, force: true }));

describe("oxlint config", () => {
  for (const { name, file, rules, lines } of CASES) {
    test(name, () => {
      const flagged = findings.filter(
        (finding) => finding.file === file && rules.includes(finding.rule)
      );
      assert.deepEqual(
        flagged.map((finding) => finding.line).sort((a, b) => a - b),
        lines,
        JSON.stringify(flagged, null, 2)
      );
      // Each rule a forbidden case names fires at least once, so no rule's coverage hides behind another's.
      if (lines.length) {
        for (const rule of rules)
          assert.ok(
            flagged.some((finding) => finding.rule === rule),
            `${rule} never fired`
          );
      }
    });
  }
});
