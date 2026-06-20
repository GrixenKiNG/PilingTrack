import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  // The next presets reference react-hooks/* rules but don't register the
  // plugin under flat config — register it here so the rules below resolve.
  plugins: { "react-hooks": reactHooks },
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/refs": "warn",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules
    "prefer-const": "warn",
    "no-unused-vars": "off",
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-debugger": "error",
    "no-empty": "warn",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "warn",
    "no-undef": "off",
    "no-unreachable": "warn",
    "no-useless-escape": "warn",
    // Surface unreferenced TODO/FIXME/HACK comments (audit M-7). Once a
    // comment is tracked (issue link, audit ref, or a `// eslint-disable
    // -- tracked in …` directive), the warning goes away.
    "no-warning-comments": ["warn", { terms: ["todo", "fixme", "hack", "xxx"], location: "start" }],
    // Audit L-2: regression watchdog for ad-hoc Tailwind sizes. Use the
    // design scale (text-xs/sm/base/…) instead of arbitrary pixel values.
    // Existing 56 occurrences are tracked in audit; new ones surface here.
    "no-restricted-syntax": ["warn", {
      selector: "Literal[value=/text-\\[\\d+px\\]/]",
      message: "Avoid ad-hoc text-[Npx]; use a Tailwind size token (text-xs, text-sm, …) or extend tailwind.config theme.fontSize.",
    }],
  },
}, {
  files: [
    "scripts/**",
    "load-tests/**",
    "performance/**",
    "e2e/**",
    "tests/**",
    "prisma/**",
    "src/workers/**",
    "src/lib/seed/**",
    "src/**/__tests__/**",
    "*.ts",
    "*.js",
    "public/**",
  ],
  rules: {
    "no-console": "off",
  },
}, {
  // Architectural boundaries (CLAUDE.md §1):
  //   modules/ = domain logic
  //   services/ = cross-cutting services
  //   core/    = infrastructure
  //   app/     = HTTP entry points
  // Allowed direction is downward only: app → services → core, modules → core.
  // Warn (not error) so legacy crossings (event-handlers.ts already imports
  // from modules/) surface in lint without breaking the build. Tests under
  // __tests__/ are exempt — they reach across layers by design.
  files: ["src/core/**/*.{ts,tsx}"],
  ignores: ["src/**/__tests__/**", "src/generated/**"],
  rules: {
    "no-restricted-imports": ["warn", {
      patterns: [
        { group: ["@/modules/*", "@/services/*", "@/app/*", "../modules/*", "../services/*", "../app/*"], message: "core/ must not depend on upper layers (modules/services/app)" },
      ],
    }],
  },
}, {
  files: ["src/services/**/*.{ts,tsx}"],
  ignores: ["src/**/__tests__/**"],
  rules: {
    "no-restricted-imports": ["warn", {
      patterns: [
        { group: ["@/modules/*", "@/app/*", "../modules/*", "../../modules/*", "../app/*", "../../app/*"], message: "services/ may only depend on services/, core/, lib/ (CLAUDE.md §1)" },
      ],
    }],
  },
}, {
  files: ["src/modules/**/*.{ts,tsx}"],
  ignores: ["src/**/__tests__/**"],
  rules: {
    "no-restricted-imports": ["warn", {
      patterns: [
        { group: ["@/services/*", "@/app/*", "../services/*", "../../services/*", "../app/*", "../../app/*", "../../../app/*"], message: "modules/ may only depend on modules/, core/, lib/ (CLAUDE.md §1)" },
      ],
    }],
  },
}, {
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "examples/**",
    "skills",
    "scripts/**",
    "src/generated/**",
    "agents/**",
    "design-previews/**",
    ".external-tools/**",
    ".gitnexus/**",
    ".kilo/**",
    "zai-provider-extension/**",
    "coverage/**",
    ".codex/**",
    "output/**",
    "andrej-karpathy-skills-main/**"
  ]
}];

export default eslintConfig;
