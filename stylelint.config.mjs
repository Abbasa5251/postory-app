/** @type {import('stylelint').Config} */
export default {
  extends: [
    "stylelint-config-standard",
    // Must come after -standard: allows Tailwind v4 at-rules (@theme,
    // @custom-variant, @utility, @variant, @source, @plugin, @reference,
    // @apply, ...) and the theme() function.
    "stylelint-config-tailwindcss",
  ],
  rules: {
    // shadcn/Tailwind emit oklch() with number lightness/hue; enforce that
    // notation instead of rewriting generated theme values to %/deg.
    "lightness-notation": "number",
    "hue-degree-notation": "number",
  },
};
