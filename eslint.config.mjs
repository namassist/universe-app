import path from "node:path";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Absolute path to the web app. The Next plugin resolves `rootDir` against the
// current working directory, but this config runs from two of them — the repo
// root (pre-commit hook) and apps/web (turbo per-package lint). A relative
// "apps/web" would become apps/web/apps/web in the second case and the plugin
// would fail to find the App Router directory. An absolute path is stable.
const WEB_ROOT = path.join(import.meta.dirname, "apps/web");

/**
 * One flat config for the whole monorepo. ESLint 9 walks up from each file to
 * find this, and every block is scoped with `files`, so `eslint --fix <path>`
 * from the repo root (which is how the pre-commit hook runs it) applies the
 * right rules per package. Per-package configs would be invisible to a
 * root-run lint-staged, so everything lives here.
 */
export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/next-env.d.ts",
    // Drizzle-generated SQL + snapshot metadata — never hand-edited.
    "apps/api/drizzle/**",
  ]),

  // Backend (Elysia on Bun) and shared packages: plain TypeScript, no JSX.
  {
    files: ["apps/api/**/*.ts", "packages/**/*.ts"],
    extends: [tseslint.configs.recommended],
  },

  // Next.js web app.
  {
    files: ["apps/web/**/*.{js,jsx,ts,tsx}"],
    extends: [nextVitals, nextTs],
    // Monorepo: tell the Next plugin where the app actually lives so rules like
    // no-html-link-for-pages resolve against the right project.
    settings: { next: { rootDir: WEB_ROOT } },
    rules: {
      // Ban arbitrary hex colors in className (e.g. bg-[#fff], text-[#0054C7]).
      // Use a design token from globals.css instead.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/\\[#[0-9a-fA-F]/]",
          message:
            "Do not use arbitrary hex colors (e.g. bg-[#fff]). Use a design token from globals.css.",
        },
      ],
    },
  },

  // Must be last: turn off stylistic rules that would fight Prettier.
  prettier,
]);
