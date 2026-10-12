import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { engineRules } from "./eslint.engine-rules.js";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "supabase/functions"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/sync/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: globals.browser },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Engine code (tests included) stays pure.
    files: ["src/engine/**/*.ts"],
    rules: engineRules,
  },
  {
    files: ["*.config.{js,ts}", "eslint.engine-rules.js", "scripts/**/*.{js,mjs}"],
    languageOptions: { globals: globals.node },
  },
);
