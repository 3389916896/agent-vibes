/**
 * lint-staged Configuration - Root Level
 *
 * Pre-commit hooks for code quality in monorepo.
 * Uses turbo with caching for efficient lint checks.
 *
 * Documentation: https://github.com/lint-staged/lint-staged
 */

const config = {
  // TypeScript and JavaScript files - format and lint
  "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}": [
    "prettier --write",
    // Use turbo with caching for efficient monorepo lint
    () => "npx turbo run lint --concurrency=4",
  ],

  // Config and data files
  "*.{json,jsonc,json5,yaml,yml}": "prettier --write",

  // Markdown files - lint and format
  "*.{md,mdx}": ["markdownlint-cli2 --fix", "prettier --write"],
}

export default config
