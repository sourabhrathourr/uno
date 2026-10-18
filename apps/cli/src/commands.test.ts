import { describe, expect, it } from "vitest"
import { COMMANDS, parseCommand } from "./commands"
import { UnoClient, validateServerUrl } from "./client"

describe("CLI command boundary", () => {
  it.each([
    null,
    [],
    {},
    { action: "voice:join" },
    { action: "game:spectatePlayer" },
    { action: "support" },
    { action: "__proto__" },
    { action: "join", code: "ABC123", name: "Bot", sessionId: "borrowed" },
    { action: "play", cardIds: ["a", "a"] },
    { action: "play", cardIds: [] },
    { action: "play", cardIds: ["a"], chosenColor: "wild" },
    { action: "ready", ready: "yes" },
    { action: "draw", expectedVersion: -1 },
    { action: "play", cardIds: ["a"], playerId: "someone-else" },
  ])("rejects malformed or unavailable command %j", (input) => {
    expect(() => parseCommand(input)).toThrow()
  })
  it.each([{ cardId: "card" }, { targetPlayerId: "recipient" }])(
    "rejects a partial gift %j before dispatch",
    (fields) => {
      expect(() =>
        parseCommand({ action: "gift", giftId: "gift", ...fields })
      ).toThrowError(expect.objectContaining({ code: "invalid-command" }))
    }
  )
  it.each([{}, { cardId: "card", targetPlayerId: "recipient" }])(
    "accepts a complete gift or explicit skip %j",
    (fields) => {
      const input = { action: "gift", giftId: "gift", ...fields }
      const parsed = parseCommand(input)
      expect(parsed).toEqual(input)
      expect(parsed).not.toBe(input)
    }
  )
  it("keeps complete atomic play decisions without accepting extra fields", () => {
    const input = {
      id: 4,
      action: "play",
      cardIds: ["discard"],
      discardCardIds: ["r2"],
      topCardId: "r2",
      declaredUno: true,
      expectedVersion: 42,
    }
    expect(parseCommand(input)).toEqual(input)
    expect(parseCommand({ action: "stage", cardIds: [] })).toEqual({
      action: "stage",
      cardIds: [],
    })
  })
  it("offers no raw event, voice, spectator, or support actions", () => {
    expect(COMMANDS.join(" ")).not.toMatch(/voice|spectat|support|signal/)
  })
  it.each([
    "file:///tmp/socket",
    "https://user:secret@example.test",
    "https://example.test/path",
    "https://example.test?token=secret",
  ])("rejects unsafe server origins %s", (url) => {
    expect(() => validateServerUrl(url)).toThrow()
  })
  it("defaults to no connection until join/create and serializes local commands", async () => {
    const client = new UnoClient({ serverUrl: "http://127.0.0.1:1" })
    try {
      expect(client.status().connected).toBe(false)
      await expect(client.execute({ action: "draw" })).rejects.toMatchObject({
        code: "not-connected",
      })
      await client.execute({ action: "watch", enabled: false })
      expect(client.status().watching).toBe(false)
      await client.execute({ action: "quit" })
      await expect(
        client.execute({ action: "join", code: "ABC123", name: "Bot" })
      ).rejects.toMatchObject({ code: "closed" })
    } finally {
      client.close()
    }
  })
})

it("validates bounded event-driven waits and the payload-free roulette macro", () => {
  expect(parseCommand({ action: "resolve-roulette" })).toEqual({
    action: "resolve-roulette",
  })
  expect(
    parseCommand({
      action: "wait-for-action",
      afterVersion: 0,
      timeoutMs: 60_000,
    })
  ).toMatchObject({ timeoutMs: 60_000 })
  for (const timeoutMs of [0, -1, 60_001, 1.5, "20"])
    expect(() =>
      parseCommand({ action: "wait-for-action", timeoutMs })
    ).toThrow()
  expect(() =>
    parseCommand({ action: "wait-for-action", afterVersion: -1 })
  ).toThrow()
  expect(() =>
    parseCommand({ action: "resolve-roulette", count: 10 })
  ).toThrow()
})
