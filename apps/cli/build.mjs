import { build } from "esbuild"

// CommonJS keeps Node optional require() probes working. Disable optional native
// accelerators so the artifact runs on a different cloud OS/architecture.
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/uno-cli.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  define: {
    "process.env.WS_NO_BUFFER_UTIL": '"1"',
    "process.env.WS_NO_UTF_8_VALIDATE": '"1"',
  },
  external: ["bufferutil", "utf-8-validate"],
  legalComments: "eof",
  sourcemap: false,
  metafile: true,
}).then(async (result) => {
  const { writeFile } = await import("node:fs/promises")
  await writeFile(
    "dist/meta.json",
    JSON.stringify(result.metafile, null, 2) + "\n"
  )
})
