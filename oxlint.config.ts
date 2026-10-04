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
  plugins: ["eslint", "typescript", "unicorn", "oxc", "react"],
  // TanStack Query's rules have no native port. The plugin is pinned (JS plugins are alpha) and
  // scripts/lint-config.test.mjs proves its rules still fire.
  jsPlugins: [{ name: "@tanstack/query", specifier: "@tanstack/eslint-plugin-query" }],
  categories: {
    correctness: "off"
  },
  rules: {
    // eslint:recommended and typescript-eslint's recommended set, as the ESLint config ran them.
    "constructor-super": "error",
    "for-direction": "error",
    "getter-return": "error",
    "no-async-promise-executor": "error",
    "no-case-declarations": "error",
    "no-class-assign": "error",
    "no-compare-neg-zero": "error",
    "no-cond-assign": "error",
    "no-const-assign": "error",
    "no-constant-binary-expression": "error",
    "no-constant-condition": "error",
    "no-control-regex": "error",
    "no-debugger": "error",
    "no-delete-var": "error",
    "no-dupe-class-members": "error",
    "no-dupe-else-if": "error",
    "no-dupe-keys": "error",
    "no-duplicate-case": "error",
    "no-empty": "error",
    "no-empty-character-class": "error",
    "no-empty-pattern": "error",
    "no-empty-static-block": "error",
    "no-ex-assign": "error",
    "no-extra-boolean-cast": "error",
    "no-fallthrough": "error",
    "no-func-assign": "error",
    "no-global-assign": "error",
    "no-import-assign": "error",
    "no-invalid-regexp": "error",
    "no-irregular-whitespace": "error",
    "no-loss-of-precision": "error",
    "no-misleading-character-class": "error",
    "no-new-native-nonconstructor": "error",
    "no-nonoctal-decimal-escape": "error",
    "no-obj-calls": "error",
    "no-prototype-builtins": "error",
    "no-redeclare": "error",
    "no-regex-spaces": "error",
    "no-self-assign": "error",
    "no-setter-return": "error",
    "no-shadow-restricted-names": "error",
    "no-sparse-arrays": "error",
    "no-this-before-super": "error",
    "no-unassigned-vars": "error",
    "no-unreachable": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    "no-unsafe-optional-chaining": "error",
    "no-unused-labels": "error",
    "no-unused-private-class-members": "error",
    "no-unused-vars": "error",
    "no-useless-backreference": "error",
    "no-useless-catch": "error",
    "no-useless-escape": "error",
    "no-with": "error",
    "preserve-caught-error": "error",
    "require-yield": "error",
    "use-isnan": "error",
    "valid-typeof": "error",
    "no-array-constructor": "error",
    "no-unused-expressions": "error",
    "typescript/ban-ts-comment": "error",
    "typescript/no-duplicate-enum-values": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-extra-non-null-assertion": "error",
    "typescript/no-misused-new": "error",
    "typescript/no-namespace": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-this-alias": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-wrapper-object-types": "error",
    "typescript/prefer-as-const": "error",
    "typescript/prefer-namespace-keyword": "error",
    "typescript/triple-slash-reference": "error",

    // React Hooks (native port of eslint-plugin-react-hooks, React Compiler rules included). The
    // two left off match the ESLint config: manual memoization the compiler can't preserve, and
    // effects that reset state when a prop changes, are both used deliberately.
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "warn",
    "react/static-components": "error",
    "react/use-memo": "error",
    "react/preserve-manual-memoization": "off",
    "react/incompatible-library": "warn",
    "react/immutability": "error",
    "react/globals": "error",
    "react/refs": "error",
    "react/set-state-in-effect": "off",
    "react/error-boundaries": "error",
    "react/purity": "error",
    "react/set-state-in-render": "error",
    "react/unsupported-syntax": "warn",

    // TanStack Query: query keys list every variable the query reads, and query options are stable.
    "@tanstack/query/exhaustive-deps": "error",
    "@tanstack/query/no-rest-destructuring": "warn",
    "@tanstack/query/stable-query-client": "error",
    "@tanstack/query/no-unstable-deps": "error",
    "@tanstack/query/infinite-query-property-order": "error",
    "@tanstack/query/no-void-query-fn": "error",
    "@tanstack/query/mutation-property-order": "error"
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
    // Plain JS (repo scripts, fake engines): Node globals. Undefined names are caught here, as the
    // type checker does for TypeScript.
    {
      files: ["**/*.{js,mjs,cjs}"],
      env: { node: true, es2024: true },
      rules: { "no-undef": "error" }
    },
    {
      files: ["**/*.cjs"],
      rules: { "typescript/no-require-imports": "off" }
    }
  ]
});
