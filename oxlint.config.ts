import { builtinModules } from "node:module";
import { defineConfig } from "oxlint";

/**
 * Node's built-in modules by bare name ("fs": exact matches, so "chessops/util" isn't caught); the
 * "node:" form is a regex (Oxlint's globs, unlike ESLint's, don't match "node:fs/promises" with
 * "node:*"). None load in a sandboxed page. `no-restricted-imports` also checks dynamic
 * `import("…")`, so a lazy import can't slip past a boundary.
 */
const nodeBuiltins = (message: string) => ({
  paths: builtinModules
    .filter((name) => !name.startsWith("_") && !name.startsWith("node:"))
    .map((name) => ({ name, message })),
  patterns: [{ regex: "^node:", message }]
});

const RENDERER_NODE = "Node APIs aren't available in the sandboxed renderer.";
const PRELOAD_NODE = "The sandboxed preload can't load Node built-ins.";

export default defineConfig({
  // Build output, coverage and test reports, the gitignored upstream Stockfish checkout, and agent
  // worktrees nested in this checkout (each is a whole other copy of the repo).
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/out/**",
    "**/coverage/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "stockfish/**",
    ".claude/**",
    ".worktrees/**"
  ],
  plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "jsx-a11y"],
  // TanStack Query's rules have no native port. The plugin is pinned (JS plugins are alpha) and
  // scripts/lint-config.test.mjs proves its rules still fire.
  jsPlugins: [
    { name: "@tanstack/query", specifier: "@tanstack/eslint-plugin-query" },
    // The app's own rules, each with valid and invalid fixtures (scripts/oxlint-plugin-chaturanga.test.mjs).
    { name: "chaturanga", specifier: "./scripts/oxlint-plugin-chaturanga/index.mjs" }
  ],
  // Type-aware rules (oxlint-tsgolint) use each file's tsconfig.
  options: {
    typeAware: true,
    // A disable comment whose rule no longer fires there is an error, so exceptions don't outlive
    // the code they were for.
    reportUnusedDisableDirectives: "error"
  },
  // Code that is outright wrong or useless. Rules below add to it (or switch one off, with why).
  categories: {
    correctness: "error"
  },
  rules: {
    // eslint:recommended and typescript-eslint's recommended rules outside the correctness
    // category (which covers the rest of both).
    "no-case-declarations": "error",
    "no-empty": "error",
    "no-fallthrough": "error",
    "no-prototype-builtins": "error",
    "no-redeclare": "error",
    "no-regex-spaces": "error",
    "preserve-caught-error": "error",
    "no-array-constructor": "error",
    "typescript/ban-ts-comment": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-namespace": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unsafe-function-type": "error",

    // Dropped promises, and async callbacks where a sync one is expected.
    "typescript/no-floating-promises": [
      "error",
      {
        // node:test's test() and describe() return promises the runner itself awaits.
        allowForKnownSafeCalls: [
          { from: "package", name: ["test", "describe", "it", "suite"], package: "node:test" }
        ]
      }
    ],
    "typescript/no-misused-promises": "error",
    "typescript/await-thenable": "error",

    // Unhandled domain states: a switch over a union names every member (or has a default).
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: true, requireDefaultForNonUnion: false }
    ],
    // Unsafe data: external values are validated, not left `any`.
    "typescript/no-explicit-any": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-type-assertion": "error",

    // Copying a collection before a loop that changes it (`for (const key of [...pools.keys()])`
    // with a body that deletes) is deliberate here; the rule reads every such copy as waste.
    "unicorn/no-useless-spread": "off",

    // React Hooks (native port of eslint-plugin-react-hooks, React Compiler rules included). The
    // two left off match the ESLint config: manual memoization the compiler can't preserve, and
    // effects that reset state when a prop changes, are both used deliberately.
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "error",
    "react/static-components": "error",
    "react/use-memo": "error",
    "react/preserve-manual-memoization": "off",
    "react/incompatible-library": "error",
    "react/immutability": "error",
    "react/globals": "error",
    "react/refs": "error",
    "react/set-state-in-effect": "off",
    "react/error-boundaries": "error",
    "react/purity": "error",
    "react/set-state-in-render": "error",
    "react/unsupported-syntax": "error",

    // Accessibility (jsx-a11y's correctness rules). Two don't fit how the app is built: focus moves
    // into a dialog or inline editor the user just opened (the WAI-ARIA dialog pattern; nothing
    // autofocuses on load), and custom widgets keep their ARIA roles on styled elements
    // (role="status" regions, radio cards, listboxes) where the native tag can't be styled alike.
    "jsx-a11y/no-autofocus": "off",
    "jsx-a11y/prefer-tag-over-role": "off",
    // The app's Switch renders a native switch button, so a label wrapping it labels a control.
    "jsx-a11y/label-has-associated-control": ["error", { controlComponents: ["Switch"] }],

    // TanStack Query: query keys list every variable the query reads, and query options are stable.
    "@tanstack/query/exhaustive-deps": "error",
    "@tanstack/query/no-rest-destructuring": "error",
    "@tanstack/query/stable-query-client": "error",
    "@tanstack/query/no-unstable-deps": "error",
    "@tanstack/query/infinite-query-property-order": "error",
    "@tanstack/query/no-void-query-fn": "error",
    "@tanstack/query/mutation-property-order": "error",

    // A lint-disable comment names its rule and says, after `--`, why the exception is safe.
    "chaturanga/disable-needs-reason": "error"
  },
  overrides: [
    // The TypeScript compiler already rejects these in .ts files (typescript-eslint's
    // eslint-recommended override), and adds the ES2015+ preferences.
    {
      files: ["**/*.{ts,tsx,mts,cts}"],
      rules: {
        "constructor-super": "off",
        "getter-return": "off",
        "no-class-assign": "off",
        "no-const-assign": "off",
        "no-dupe-class-members": "off",
        "no-dupe-keys": "off",
        "no-func-assign": "off",
        "no-import-assign": "off",
        "no-new-native-nonconstructor": "off",
        "no-obj-calls": "off",
        "no-redeclare": "off",
        "no-setter-return": "off",
        "no-this-before-super": "off",
        "no-unreachable": "off",
        "no-unsafe-negation": "off",
        "no-var": "error",
        "no-with": "off",
        "prefer-const": "error",
        "prefer-rest-params": "error",
        "prefer-spread": "error"
      }
    },
    // Each process may not reach into another's code: the renderer runs in a sandboxed page (no
    // Node, no Electron main APIs, only the preload bridge), main has no DOM. (Undefined globals are
    // the type checker's job: tsconfig.renderer.json has no Node types, tsconfig.main.json no DOM.)
    {
      files: ["apps/desktop/src/renderer/src/**/*.{ts,tsx}", "apps/marketing/src/**/*.ts"],
      env: { browser: true },
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "electron",
                message: "The renderer reaches Electron only through window.chaturanga (preload)."
              },
              ...nodeBuiltins(RENDERER_NODE).paths
            ],
            patterns: [
              ...nodeBuiltins(RENDERER_NODE).patterns,
              {
                group: ["**/main/**", "**/preload/**"],
                message: "Renderer code can't import main/preload code."
              }
            ]
          }
        ]
      }
    },
    // Dev tools: each has a Node server and a plain page script that runs in the browser.
    {
      files: ["devtools/**/app.js"],
      env: { browser: true }
    },
    {
      files: ["apps/desktop/src/main/**/*.ts"],
      env: { node: true },
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/renderer/**", "@/**"],
                message: "Main code can't import renderer code."
              }
            ]
          }
        ]
      }
    },
    // The preload runs sandboxed (BrowserWindow sandbox: true): only Electron's renderer modules
    // load there, and a Node built-in would break the whole window.chaturanga bridge.
    {
      files: ["apps/desktop/src/preload/**/*.ts"],
      env: { node: true },
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: nodeBuiltins(PRELOAD_NODE).paths,
            patterns: [
              ...nodeBuiltins(PRELOAD_NODE).patterns,
              {
                group: ["**/renderer/**", "@/**", "**/main/**"],
                message: "Preload code can't import main or renderer code."
              }
            ]
          }
        ]
      }
    },
    // Unit tests run in Node (vitest), so renderer tests may use it.
    {
      files: [
        "apps/desktop/src/renderer/src/**/*.test.{ts,tsx}",
        "apps/marketing/src/**/*.test.ts"
      ],
      env: { browser: true, node: true },
      rules: { "no-restricted-imports": "off" }
    },
    // Test hygiene: nothing focused or skipped reaches CI, and every expect is complete.
    {
      files: ["**/*.test.{ts,tsx,mjs}", "**/__fixtures__/**", "apps/desktop/e2e/**"],
      plugins: ["vitest"],
      rules: {
        "vitest/no-focused-tests": "error",
        "vitest/no-disabled-tests": "error",
        // vitest's expect takes an optional failure message as its second argument.
        "vitest/valid-expect": ["error", { maxArgs: 2 }],
        "vitest/valid-expect-in-promise": "error",
        // A test's assertions may live in a named helper (`expectRejected(/web page/)`).
        "vitest/expect-expect": [
          "error",
          { assertFunctionNames: ["expect", "expect*", "assert", "assert*"] }
        ],
        // Test doubles and deliberately malformed inputs stand in for full types; the assertion
        // check guards production data, where a cast hides a value nobody validated.
        "typescript/no-unsafe-type-assertion": "off",
        // vitest types its asymmetric matchers (expect.any(String), expect.objectContaining(…))
        // as `any` so they fit any expected value; assigning or returning them is the point.
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-return": "off",
        // vi.fn() takes its types from its implementation or the method it spies on; restating
        // them as type parameters adds noise, not safety.
        "vitest/require-mock-type-parameters": "off",
        // Await the milestone (or use fake timers), never a real sleep.
        "chaturanga/no-test-sleep": "error"
      }
    },
    // Plain JS (repo scripts, fake engines): no tsconfig type-checks these files, so their values
    // are inferred `any` and the unsafe-* checks would only restate that. Undefined names are
    // caught here instead, as the type checker does for TypeScript.
    {
      files: ["**/*.{js,mjs,cjs}"],
      env: { node: true, es2024: true },
      rules: {
        "no-undef": "error",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off"
      }
    },
    {
      files: ["**/*.cjs"],
      rules: { "typescript/no-require-imports": "off" }
    }
  ]
});
