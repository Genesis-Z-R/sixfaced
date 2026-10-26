// Minimal, high-signal ESLint config.
// The goal is not style: it is catching identifiers that do not exist
// (which vite happily bundles) and invalid hook usage.
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "src/ipc/vendor/**"],
  },
  {
    files: ["src/**/*.{js,jsx}", "*.js"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, gc: "readonly" },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
