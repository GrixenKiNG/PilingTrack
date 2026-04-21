import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
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
    ".kilo/**",
    "zai-provider-extension/**",
    "coverage/**",
    ".codex/**",
    "output/**",
    "andrej-karpathy-skills-main/**"
  ]
}];

export default eslintConfig;
