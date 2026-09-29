import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import pluginQuery from "@tanstack/eslint-plugin-query";
import { builtinModules } from "node:module";

/**
 * Node's built-in modules, by bare name ("fs": exact matches, so "chessops/util" isn't caught) —
 * the "node:*" form is a pattern below. None load in a sandboxed page.
 */
const nodeBuiltinPaths = (message) =>
  builtinModules.filter((name) => !name.startsWith("_") && !name.startsWith("node:")).map((name) => ({ name, message }));

export default tseslint.config(
  {
    // Build output, coverage reports and the gitignored upstream Stockfish checkout.
    ignores: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/coverage/**", "stockfish/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    // No globals here: flat config merges globals across matching entries, so each process gets
    // only its own (below).
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    },
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  // Each process may not reach into another's code: the renderer runs in a sandboxed page (no Node,
  // no Electron main APIs — only the preload bridge), main has no DOM. (Undefined globals are the
  // type checker's job: tsconfig.renderer.json has no Node types, tsconfig.main.json no DOM.)
  {
    files: ["apps/desktop/src/renderer/src/**/*.{ts,tsx}", "apps/marketing/src/**/*.ts"],
    // Tests run in Node (vitest) and may use it.
    ignores: ["**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "electron", message: "The renderer reaches Electron only through window.chaturanga (preload)." },
            ...nodeBuiltinPaths("Node APIs aren't available in the sandboxed renderer.")
          ],
          patterns: [
            { group: ["node:*"], message: "Node APIs aren't available in the sandboxed renderer." },
            { group: ["**/main/**", "**/preload/**"], message: "Renderer code can't import main/preload code." }
          ]
        }
      ]
    }
  },
  {
    files: ["apps/desktop/src/main/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/renderer/**", "@/*"], message: "Main code can't import renderer code." }] }
      ]
    }
  },
  // The preload runs sandboxed (BrowserWindow sandbox: true): only Electron's renderer modules
  // load there — a Node built-in would break the whole window.chaturanga bridge.
  {
    files: ["apps/desktop/src/preload/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeBuiltinPaths("The sandboxed preload can't load Node built-ins."),
          patterns: [
            { group: ["node:*"], message: "The sandboxed preload can't load Node built-ins." },
            { group: ["**/renderer/**", "@/*", "**/main/**"], message: "Preload code can't import main or renderer code." }
          ]
        }
      ]
    }
  },
  // Code shared by both sides, build configs and tests (vitest runs in Node, some with DOM types).
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "apps/desktop/src/renderer/src/**",
      "apps/marketing/src/**",
      "apps/desktop/src/main/**",
      "apps/desktop/src/preload/**"
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },
  // TanStack Query: query keys list every variable the query reads, and query options are stable.
  ...pluginQuery.configs["flat/recommended"],
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node
    }
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  prettier
);
