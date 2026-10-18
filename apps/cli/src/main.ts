import { createInterface } from "node:readline"
import { parseArgs } from "node:util"
import { UnoClient } from "./client"
import { CliError, COMMANDS } from "./commands"

const HELP = `UNO No Mercy CLI — persistent JSON Lines client

pnpm --filter @workspace/cli start --server http://localhost:4001
pnpm --filter @workspace/cli start --server http://localhost:4001 --room ABC123 --name Bot
pnpm --filter @workspace/cli start --server http://localhost:4001 --create --name Host

Send one JSON object per line on stdin. stdout contains JSON Lines only.
Example: {"id":1,"action":"join","code":"ABC123","name":"Bot"}
Example: {"id":2,"action":"ready","ready":true}
Example: {"id":3,"action":"play","cardIds":["your-card-id"],"declaredUno":true}
Actions: ${COMMANDS.join(", ")}

No voice, spectator/support access, automatic strategy, or saved/browser sessions.
See apps/cli/README.md for all commands and reconnect/unknown-outcome handling.
`

async function main() {
  const { values } = parseArgs({
    options: {
      server: { type: "string", default: "http://localhost:4001" },
      room: { type: "string" },
      name: { type: "string", default: "CLI player" },
      create: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  if (values.help) {
    process.stdout.write(HELP)
    return
  }
  if (values.create && values.room)
    throw new CliError(
      "invalid-options",
      "Choose --create or --room, not both."
    )
  const client = new UnoClient({ serverUrl: values.server })
  const write = (value: unknown) =>
    process.stdout.write(`${JSON.stringify(value)}\n`)
  client.on("notice", write)
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  input.pause()
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    input.close()
    client.close()
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  async function run(value: unknown) {
    const id =
      value && typeof value === "object" && "id" in value
        ? (value as { id: unknown }).id
        : undefined
    try {
      const data = await client.execute(value)
      write({ type: "result", id, ok: true, data })
      if (
        value &&
        typeof value === "object" &&
        "action" in value &&
        value.action === "quit"
      )
        stop()
    } catch (cause) {
      const error =
        cause instanceof CliError
          ? cause
          : new CliError(
              "client-error",
              "Command failed. Inspect status before continuing."
            )
      write({
        type: "result",
        id,
        ok: false,
        error: { code: error.code, message: error.message },
      })
    }
  }
  write({ type: "ready", protocolVersion: 1, commands: COMMANDS })
  try {
    if (values.create) await run({ action: "create", name: values.name })
    else if (values.room)
      await run({ action: "join", code: values.room, name: values.name })
    const lines = input[Symbol.asyncIterator]()
    input.resume()
    for await (const line of lines) {
      if (stopping) break
      if (!line.trim()) continue
      if (Buffer.byteLength(line) > 65_536) {
        write({
          type: "result",
          ok: false,
          error: {
            code: "line-too-long",
            message: "Commands are limited to 64 KiB.",
          },
        })
        continue
      }
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        write({
          type: "result",
          ok: false,
          error: {
            code: "invalid-json",
            message: "Send one valid JSON command per line.",
          },
        })
        continue
      }
      await run(value)
    }
  } finally {
    stop()
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
  }
}

main().catch((cause: unknown) => {
  const message =
    cause instanceof CliError
      ? cause.message
      : "Invalid CLI options. Use --help."
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
