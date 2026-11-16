import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e 目录是 Playwright 的用例（视觉回归），不要被 Vitest 收集
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
    include: ["src/**/*.{test,spec}.ts", "packages/**/*.{test,spec}.ts"],
  },
});
