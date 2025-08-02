import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Environment settings
    environment: "node",

    // Test file patterns
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],

    // Reporter settings
    reporter: ["verbose", "json"],

    // Coverage settings
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/__tests__/**"],
      all: true,
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90,
    },

    // Timeout settings
    testTimeout: 10000,
    hookTimeout: 10000,

    // Concurrent execution
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
      },
    },

    // Global setup
    globals: false,

    // Watch mode settings
    watch: false,

    // Fail fast on first test failure
    bail: 0,
  },
});
