import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/client/main.tsx", "src/server/index.ts"],
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: "client",
          environment: "jsdom",
          include: ["tests/client/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/client/setup.ts"],
        },
      },
      {
        test: {
          name: "server",
          environment: "node",
          testTimeout: 15000,
          include: ["tests/server/**/*.test.ts"],
        },
      },
    ],
  },
});
