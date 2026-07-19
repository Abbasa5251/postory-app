import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// AGENTS.md §6: the drizzle client is DAL-only. `**/db/db` catches relative
// escapes ("../db/db") as well as the "@/db/db" alias form.
const dbClientRestriction = {
  group: ["@/db/db", "**/db/db"],
  message:
    "Only the DAL (src/server/dal/**) may import the db client (AGENTS.md §6); everything else calls DAL functions.",
};

// AGENTS.md §5: src/lib is isomorphic-safe. `**/server/**` also catches
// relative escapes ("../server/..."); "next/server" does NOT match (no path
// segment after "server/").
const serverBoundaryRestriction = {
  group: ["@/server/**", "**/server/**"],
  message:
    "src/lib/** is isomorphic-safe and must not import from src/server/** (AGENTS.md §5).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Must follow the shared configs: disables stylistic rules Prettier owns.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Installed agent skills — vendored third-party content (untracked, but
    // present in local checkouts; their example code breaks `npm run lint`).
    ".agents/**",
    ".claude/**",
    // Design-tool mockup export (not app source; its example JS isn't ours).
    "postory-design/**",
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
  {
    // Vendored shadcn/ui primitives (installed via `npx shadcn add`, base-nova
    // style) + its use-mobile hook — kept close to upstream so re-adds stay
    // clean diffs; relax the effect rule the registry doesn't satisfy.
    files: ["src/components/ui/**", "src/hooks/use-mobile.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // ---- Layer-boundary rules (AGENTS.md §5/§6). Flat-config semantics: a
  // later object with the same rule REPLACES it for matched files, so the
  // src/lib object repeats the db restriction (superset) and the allowlist
  // must come last. ----
  {
    rules: {
      "no-restricted-imports": ["error", { patterns: [dbClientRestriction] }],
    },
  },
  {
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [dbClientRestriction, serverBoundaryRestriction] },
      ],
    },
  },
  {
    // Allowlist: the DAL is the db client's home; auth.ts needs it for the
    // drizzle adapter (documented exception, AGENTS.md §6). dal/ doesn't
    // exist yet — the pattern future-proofs A5.
    files: ["src/server/dal/**", "src/server/auth/auth.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
