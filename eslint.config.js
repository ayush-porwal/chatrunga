import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import pluginQuery from "@tanstack/eslint-plugin-query";

export default tseslint.config(
  {
    // Build output, coverage reports and the gitignored upstream Stockfish checkout.
    ignores: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/coverage/**", "stockfish/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      }
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
  // Each process gets its own globals and may not reach into another's code: the renderer runs in
  // a sandboxed page (no Node, no Electron main APIs — only the preload bridge), main has no DOM.
  {
    files: ["apps/desktop/src/renderer/src/**/*.{ts,tsx}", "apps/marketing/src/**/*.ts"],
    // Tests run in Node (vitest) and may use it.
    ignores: ["**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "electron", message: "The renderer reaches Electron only through window.chaturanga (preload)." }],
          patterns: [
            { group: ["node:*"], message: "Node APIs aren't available in the sandboxed renderer." },
            { group: ["**/main/**", "**/preload/**"], message: "Renderer code can't import main/preload code." }
          ]
        }
      ]
    }
  },
  {
    files: ["apps/desktop/src/main/**/*.ts", "apps/desktop/src/preload/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/renderer/**", "@/*"], message: "Main/preload code can't import renderer code." }] }
      ]
    }
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
