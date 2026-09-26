import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

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
