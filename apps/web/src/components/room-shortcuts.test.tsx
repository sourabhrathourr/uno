import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  createDefaultHouseRules,
  createGame,
  projectPlayerGame,
  projectPublicGame,
} from "@workspace/game"
import { Route } from "../routes/room.$roomCode"

const fixture = vi.hoisted(() => ({ join: {} as object }))
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useParams: () => ({ roomCode: "DEBUG1" }),
  }),
}))
vi.mock("@/lib/realtime", () => {
  const socket = {
    connected: true,
    id: "debug-socket",
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((event, ...args) => {
      const ack = args.at(-1)
      if (typeof ack !== "function") return
      if (event === "room:join") ack({ ok: true, data: fixture.join })
    }),
    timeout: () => ({
      volatile: { emit: vi.fn() },
    }),
    volatile: { emit: vi.fn() },
  }
  return {
    getGameSocket: () => socket,
    getRoomPreview: () => new Promise(() => {}),
    searchGifs: vi.fn(),
  }
})
vi.mock("@/lib/use-room-voice", () => ({
  useRoomVoice: () => ({
    enabled: false,
    connecting: false,
    muted: false,
    error: null,
    voiceStates: {},
    remoteStreamsByPlayerId: {},
    connectionIssues: {},
  }),
  logRoomVoiceDebug: vi.fn(),
}))
vi.mock("@/lib/sound", () => ({
  playFx: vi.fn(),
  playCardSound: vi.fn(),
  playShuffleSound: vi.fn(),
  playTurnAlert: vi.fn(),
  playWinnerSound: vi.fn(),
  isSfxEnabled: () => false,
  setSfxEnabled: vi.fn(),
  startSoundSystem: vi.fn(),
}))
vi.mock("@/components/voice-filter-picker", () => ({
  VoiceFilterPicker: () => null,
}))

let root: Root
beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [new DOMRect(0, 0, 120, 170)] as unknown as DOMRectList
  )
  localStorage.setItem("uno-no-mercy:player-name", "Debug a")
  localStorage.setItem("uno-no-mercy:active-room-code", "DEBUG1")
  localStorage.setItem("uno:chat-collapsed", "1")
  const context = {
    players: ["a", "b", "c"].map((id, seat) => ({
      id,
      name: `Debug ${id}`,
      seat,
      connected: true,
      ready: true,
      joinedAt: "now",
      lastSeenAt: "now",
    })),
    houseRules: createDefaultHouseRules(),
  }
  const game = createGame(context)
  game.turnPlayerId = "a"
  game.currentColor = "red"
  game.discardPile = [
    { id: "top", color: "red", face: { kind: "number", value: 9 } },
  ]
  game.handsByPlayerId.a = [
    { id: "blocked", color: "blue", face: { kind: "number", value: 8 } },
    { id: "legal", color: "red", face: { kind: "number", value: 1 } },
    { id: "incompatible", color: "red", face: { kind: "number", value: 2 } },
  ]
  fixture.join = {
    player: context.players[0],
    playerGame: { ...projectPlayerGame(game, context, "a"), roomVersion: 1 },
    playerSocial: null,
    room: {
      code: "DEBUG1",
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
      version: 1,
      createdAt: "now",
      updatedAt: "now",
    },
  }
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  const Component = (Route as unknown as { component: () => React.ReactNode })
    .component
  await act(() => root.render(<Component />))
})
afterEach(async () => {
  await act(() => root.unmount())
  document.body.innerHTML = ""
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function press(key: string) {
  await act(() => {
    const target = document.activeElement ?? window
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    )
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }))
  })
  await act(() => vi.advanceTimersByTime(20))
}
const staged = () => document.querySelectorAll('[aria-label="Staged card"]')
const hint = () =>
  [...document.querySelectorAll('[role="status"]')].find((node) =>
    node.textContent?.includes("Can’t add this card to this play")
  )

it("explains an invalid keyboard selection briefly without changing the play or extending repeated hints", async () => {
  await press("ArrowRight")
  expect((document.activeElement as HTMLElement).dataset.handCard).toBe(
    "blocked"
  )
  await press(" ")
  expect(staged()).toHaveLength(0)
  expect(hint()?.getAttribute("aria-live")).toBe("polite")
  await act(() => vi.advanceTimersByTime(1500))
  await press(" ")
  await act(() => vi.advanceTimersByTime(1100))
  expect(hint()).toBeUndefined()
})

it("keeps legal staging and unstaging intact and rejects incompatible additions", async () => {
  await press("ArrowRight")
  await press(" ")
  expect(hint()).toBeDefined()
  await press("ArrowRight")
  await press(" ")
  expect(staged()).toHaveLength(1)
  expect(hint()).toBeUndefined()
  await press("ArrowRight")
  await press(" ")
  expect(staged()).toHaveLength(1)
  expect(hint()).toBeDefined()
  await press("ArrowLeft")
  await press(" ")
  expect(staged()).toHaveLength(0)
  expect(hint()).toBeUndefined()
})
