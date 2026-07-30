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
        statements: 75,
        branches: 60,
        functions: 80,
        lines: 75,
      },
    },
  },
});
