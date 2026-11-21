import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // `any` is allowed only with an explanatory eslint-disable comment (coding rule 1).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // The audio engine must stay pure TypeScript so it runs unchanged in a Web
    // Worker and in Node: no React, Next.js, Supabase, app code or browser globals.
    files: ["src/lib/audio-engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-*", "next", "next/*", "@supabase/*", "@/*"], message: "The audio engine must not depend on app or framework code." },
          ],
        },
      ],
      "no-restricted-globals": ["error", "window", "document", "navigator", "AudioContext", "localStorage"],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "public/worklets/**"]),
]);
