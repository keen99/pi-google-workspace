import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["index.ts", "src/**/*.ts"],
      reportOnFailure: true,
      reporter: [
        ["text", { maxCols: 200, skipFull: false }],
        "text-summary",
        "html",
        "lcov",
        "json-summary",
      ],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 80,
        functions: 95,
        lines: 90,
      },
    },
  },
});
