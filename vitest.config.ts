import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const alias = {
  "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
  "@workspace/game": fileURLToPath(
    new URL("./packages/game/src/index.ts", import.meta.url)
  ),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "game",
          environment: "node",
          include: ["packages/game/src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "server",
          environment: "node",
          include: ["apps/server/src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
})
