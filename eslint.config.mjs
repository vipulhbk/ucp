import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/vendor/**", "node_modules/**", "playwright-report/**", "test-results/**"]),
  {
    // Layering (docs/ARCHITECTURE.md §3): the protocol core imports nothing from the app layers.
    files: ["src/ucp/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/merchant/*", "@/platform/*", "@/persistence/*", "@/app-services/*", "@/app/*", "@/components/*", "react", "next/*"], message: "src/ucp must stay framework- and storage-free." }] }],
    },
  },
  {
    // Platform and business may only meet over HTTP.
    files: ["src/platform/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@/merchant/*"], message: "The platform must call the merchant through UCP HTTP, never import it." }] }] },
  },
  {
    files: ["src/merchant/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@/platform/*"], message: "The merchant must not import platform code." }] }] },
  },
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-expressions": "off", "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
