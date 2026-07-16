import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "game",
          environment: "node",
          include: ["packages/game/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server",
          environment: "node",
          include: ["apps/server/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "mobile",
          environment: "node",
          include: ["apps/mobile/src/**/*.test.ts"],
        },
      },
    ],
  },
})
