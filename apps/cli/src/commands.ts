import type { PlayCardsInput, StageCardsInput } from "@workspace/game"

type Envelope = { id?: string | number; expectedVersion?: number }
export type CliCommand = Envelope &
  (
    | { action: "help" | "status" | "resync" | "quit" }
    | { action: "watch"; enabled: boolean }
    | { action: "join"; code: string; name: string }
    | { action: "create"; name: string }
    | { action: "ready"; ready: boolean }
    | { action: "start" | "restart" }
    | ({ action: "play" } & PlayCardsInput)
    | ({ action: "stage" } & StageCardsInput)
    | { action: "draw" | "pass" | "penalty" | "roulette" }
    | { action: "catch-uno"; targetPlayerId: string }
    | { action: "trade-offer"; cardId: string; targetPlayerId: string }
    | {
        action: "trade-respond"
        offerId: string
        accept: boolean
        cardId?: string
      }
    | { action: "trade-cancel"; offerId: string }
    | {
        action: "gift"
        giftId: string
        cardId?: string
        targetPlayerId?: string
      }
  )

export class CliError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = "CliError"
  }
}

type Validator = (value: unknown) => boolean
const text: Validator = (value) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 256
const bool: Validator = (value) => typeof value === "boolean"
const ids: Validator = (value) =>
  Array.isArray(value) &&
  value.length <= 128 &&
  value.every(text) &&
  new Set(value).size === value.length
const color: Validator = (value) =>
  ["red", "green", "blue", "yellow"].includes(value as string)
const decisions = {
  chosenColor: color,
  declaredUno: bool,
  rotateHands: bool,
  swapWithPlayerId: text,
}
const schemas: Record<
  CliCommand["action"],
  { required?: Record<string, Validator>; optional?: Record<string, Validator> }
> = {
  help: {},
  status: {},
  resync: {},
  quit: {},
  watch: { required: { enabled: bool } },
  join: {
    required: {
      code: (value) =>
        typeof value === "string" && /^[a-z0-9]{6}$/i.test(value),
      name: text,
    },
  },
  create: { required: { name: text } },
  ready: { required: { ready: bool } },
  start: {},
  restart: {},
  play: {
    required: {
      cardIds: (value) => ids(value) && (value as string[]).length > 0,
    },
    optional: { ...decisions, discardCardIds: ids, topCardId: text },
  },
  stage: { required: { cardIds: ids }, optional: decisions },
  draw: {},
  pass: {},
  penalty: {},
  roulette: {},
  "catch-uno": { required: { targetPlayerId: text } },
  "trade-offer": { required: { cardId: text, targetPlayerId: text } },
  "trade-respond": {
    required: { offerId: text, accept: bool },
    optional: { cardId: text },
  },
  "trade-cancel": { required: { offerId: text } },
  gift: {
    required: { giftId: text },
    optional: { cardId: text, targetPlayerId: text },
  },
}

export const COMMANDS = Object.keys(schemas) as Array<CliCommand["action"]>

/** An explicit allowlist: no raw events, borrowed sessions, support or spectator reads. */
export function parseCommand(input: unknown): CliCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CliError(
      "invalid-command",
      "Send one JSON command object per line."
    )
  const data = input as Record<string, unknown>
  if (typeof data.action !== "string" || !Object.hasOwn(schemas, data.action))
    throw new CliError(
      "unknown-action",
      `Supported actions: ${COMMANDS.join(", ")}.`
    )
  const schema = schemas[data.action as CliCommand["action"]]
  const validators: Record<string, Validator> = {
    action: text,
    id: (value) =>
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value)),
    expectedVersion: (value) =>
      Number.isSafeInteger(value) && (value as number) >= 0,
    ...schema.required,
    ...schema.optional,
  }
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(validators, key) || !validators[key]!(value))
      throw new CliError(
        "invalid-command",
        `Invalid or unsupported field: ${key}.`
      )
  }
  for (const key of Object.keys(schema.required ?? {})) {
    if (!Object.hasOwn(data, key))
      throw new CliError("invalid-command", `Missing field: ${key}.`)
  }
  if (
    data.action === "gift" &&
    Object.hasOwn(data, "cardId") !== Object.hasOwn(data, "targetPlayerId")
  )
    throw new CliError(
      "invalid-command",
      "Send cardId and targetPlayerId together, or omit both to skip."
    )
  return structuredClone(data) as CliCommand
}
