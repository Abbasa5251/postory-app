import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Vendored better-auth-ui registry components (installed via
    // `npx shadcn add https://better-auth-ui.com/r/...`). Kept byte-identical
    // to upstream so future registry re-adds stay clean diffs — style rules
    // that upstream doesn't satisfy are relaxed here only.
    files: ["src/components/auth/**"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
