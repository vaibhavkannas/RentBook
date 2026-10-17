import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const LOGGER_ONLY = "Write to the server log with logEvent (src/lib/server/log.ts), not to the console.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The server writes to its log only through logEvent (src/lib/server/log.ts), which builds one JSON line from a
  // fixed list of fields. A plain console call can print a whole error object, and the object can carry the request
  // Google was sent. This catches every way to reach the console, not only `console.x(`. `no-console` would miss
  // `const { error } = console`. The scripts and the tests are outside src and may print. A test lints snippets with
  // this configuration (tests/server/no-console-rule.test.ts).
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", { name: "console", message: LOGGER_ONLY }],
      "no-restricted-properties": [
        "error",
        ...["globalThis", "global", "window", "self"].map((object) => ({ object, property: "console", message: LOGGER_ONLY })),
        ...["stdout", "stderr"].map((property) => ({ object: "process", property, message: LOGGER_ONLY })),
      ],
      "no-restricted-imports": [
        "error",
        { paths: ["console", "node:console"].map((name) => ({ name, message: LOGGER_ONLY })) },
      ],
    },
  },
  // The logger is the one place that writes to the console.
  {
    files: ["src/lib/server/log.ts"],
    rules: { "no-restricted-globals": "off", "no-restricted-properties": "off", "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
