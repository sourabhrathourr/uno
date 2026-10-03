import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  createGame,
  createDefaultHouseRules,
  projectPublicGame,
  projectPlayerGame,
  offerBlindTrade,
  respondBlindTrade,
  cancelBlindTrade,
  resolveLastGift,
  drawOne,
  type GameContext,
  type RoomSnapshot,
  type CommandResult,
} from "@workspace/game"
import type { GameSocket } from "../lib/realtime"
import { PartyExperience } from "./party-experience"

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})
let root: Root | null = null
afterEach(async () => {
  await act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  vi.useRealTimers()
})

async function setup() {
  const context: GameContext = {
    players: ["a", "b", "c"].map((id, seat) => ({
      id,
      name: id.toUpperCase(),
      seat,
      connected: true,
      ready: true,
      joinedAt: "now",
      lastSeenAt: "now",
    })),
    houseRules: createDefaultHouseRules(),
  }
  const game = createGame(context)
  game.handsByPlayerId = Object.fromEntries(
    context.players.map(({ id }) => [
      id,
      [
        { id: `${id}-red`, color: "red", face: { kind: "number", value: 1 } },
        { id: `${id}-blue`, color: "blue", face: { kind: "number", value: 2 } },
      ],
    ])
  )
  game.drawPile = [
    { id: "knockout-card", color: "green", face: { kind: "number", value: 9 } },
  ]
  let playerId = "a"
  let version = 1
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  const onOpen = vi.fn()
  const commands = {
    "game:offerBlindTrade": offerBlindTrade,
    "game:respondBlindTrade": respondBlindTrade,
    "game:cancelBlindTrade": cancelBlindTrade,
    "game:resolveLastGift": resolveLastGift,
  }
  const emit = vi.fn(
    (
      event: keyof typeof commands,
      input: never,
      ack: (result: CommandResult<RoomSnapshot>) => void
    ) => {
      const result = commands[event](game, context, playerId, input)
      version += 1
      render()
      ack(result.ok ? { ok: true, data: room() } : result)
    }
  )
  const socket = { connected: true, emit } as unknown as GameSocket
  function room(): RoomSnapshot {
    return {
      code: "ABCDEF",
      status: "playing",
      hostPlayerId: "a",
      crownPlayerId: null,
      nextMatchDirection: 1,
      players: context.players,
      chatMessages: [],
      voteKick: {
        activeVoteKickId: null,
        lobbyVoteKickedPlayerIds: [],
        cooldowns: [],
      },
      houseRules: context.houseRules,
      game: projectPublicGame(game, context),
      version,
      createdAt: "now",
      updatedAt: "now",
    }
  }
  function render() {
    root!.render(
      <PartyExperience
        room={room()}
        playerId={playerId}
        playerGame={projectPlayerGame(game, context, playerId)}
        socket={socket}
        onOpen={onOpen}
      />
    )
  }
  await act(render)
  return {
    game,
    context,
    emit,
    onOpen,
    socket,
    render: () => act(render),
    view: (id: string) =>
      act(() => {
        playerId = id
        render()
      }),
  }
}

function button(text: string) {
  const result = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).find(
    (button) =>
      button.textContent?.trim() === text ||
      button.getAttribute("aria-label") === text
  )
  if (!result) throw new Error(`Missing button: ${text}`)
  return result
}

async function click(text: string) {
  await act(() => button(text).click())
}

describe("party experience dry run", () => {
  it("takes both players through choosing, offering, accepting, and returning to play", async () => {
    const table = await setup()
    await click("Blind trade")
    expect(table.onOpen).toHaveBeenCalledOnce()
    expect(button("Offer face down").disabled).toBe(true)
    await click("B")
    await click("Choose blue 2")
    expect(button("Offer face down").disabled).toBe(false)
    await click("Offer face down")
    expect(document.body.textContent).toContain("Your card is locked.")
    expect(document.body.textContent).toContain("Waiting for B")
    expect(table.emit).toHaveBeenLastCalledWith(
      "game:offerBlindTrade",
      { cardId: "a-blue", targetPlayerId: "b" },
      expect.any(Function)
    )
    await table.view("b")
    expect(document.body.textContent).toContain("A wants to trade.")
    expect(
      document.querySelector("button[aria-label='Choose red 1']")
    ).not.toBeNull()
    expect(
      document.querySelector("button[aria-label='wild hidden card']")
    ).toBeNull()
    expect(button("Lock card & trade").disabled).toBe(true)
    await click("Choose red 1")
    await click("Lock card & trade")
    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(table.game.handsByPlayerId.a?.map((card) => card.id)).toContain(
      "b-red"
    )
    expect(table.game.handsByPlayerId.b?.map((card) => card.id)).toContain(
      "a-blue"
    )
    expect(table.game.turnPlayerId).toBe("a")
    expect(table.game.tradeUsedPlayerIds).toEqual(["a", "b"])
    expect(document.body.textContent).toContain("Received blue 2 from A")
  })

  it("shows all 26 gift choices and sends the last drawn card to a survivor", async () => {
    const table = await setup()
    table.game.handsByPlayerId.a = Array.from({ length: 25 }, (_, i) => ({
      id: `frozen-${i}`,
      color: "yellow",
      face: { kind: "number", value: 1 },
    }))
    expect(drawOne(table.game, table.context, "a").ok).toBe(true)
    await table.render()
    expect(document.body.textContent).toContain("Your frozen hand · 26 cards")
    expect(
      document.querySelectorAll("button[aria-label^='Choose ']")
    ).toHaveLength(26)
    await click("Choose green 9")
    expect(button("Give to …").disabled).toBe(true)
    await click("B")
    await click("Give to B")
    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(table.game.handsByPlayerId.b?.map((card) => card.id)).toContain(
      "knockout-card"
    )
    expect(table.game.lastGifts).toEqual([])
    expect(table.game.eliminatedPlayerIds).toContain("a")
  })

  it("lets the player skip and shows other players a wait notice without private cards", async () => {
    const table = await setup()
    table.game.handsByPlayerId.a = Array.from({ length: 25 }, (_, i) => ({
      id: `frozen-${i}`,
      color: "yellow",
      face: { kind: "number", value: 1 },
    }))
    drawOne(table.game, table.context, "a")
    await table.view("b")
    expect(document.body.textContent).toContain("A is choosing a last gift")
    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(
      document.querySelectorAll("button[aria-label^='Choose ']")
    ).toHaveLength(0)
    await table.view("a")
    await click("Leave no gift")
    expect(table.game.knockedOutCards).toHaveLength(26)
    expect(table.game.lastGifts).toEqual([])
  })

  it("supports Escape, traps keyboard focus, and restores focus after closing", async () => {
    await setup()
    button("Blind trade").focus()
    await click("Blind trade")
    await click("B")
    await click("Choose blue 2")
    button("Offer face down").focus()
    await act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
      )
    })
    expect(document.activeElement).toBe(button("Close trade"))
    await act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    })
    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(document.activeElement).toBe(button("Blind trade"))
  })

  it("keeps failed choices reviewable and blocks double submits while awaiting an answer", async () => {
    const table = await setup()
    await click("Blind trade")
    await click("B")
    await click("Choose blue 2")
    let ack: ((result: CommandResult<RoomSnapshot>) => void) | undefined
    table.emit.mockImplementationOnce((_event, _input, callback) => {
      ack = callback
    })
    await click("Offer face down")
    expect(table.emit).toHaveBeenCalledOnce()
    expect(button("Cancel").disabled).toBe(true)
    await act(() =>
      ack!({
        ok: false,
        error: {
          code: "invalid-trade-target",
          message: "That player left the game.",
        },
      })
    )
    expect(document.querySelector("[role='alert']")?.textContent).toBe(
      "That player left the game."
    )
    expect(button("Offer face down").disabled).toBe(false)
    expect(document.querySelector("[role='dialog']")).not.toBeNull()
  })
})
