import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import type { ChatMessage, Player } from "@workspace/game"
import type { GameSocket } from "@/lib/realtime"
import { useChannelChat } from "./use-channel-chat"
import {
  PublicMessageActions,
  ReplyPreview,
  usePublicChatControls,
} from "./public-chat-controls"
import { useReadingScroll } from "./use-reading-scroll"
import { ShortcutGuide } from "./shortcut-guide"

vi.mock("@/lib/sound", () => ({ playFx: vi.fn() }))
vi.mock("@/components/support-experience", () => ({
  mentionablePlayersForChannel: (
    players: Player[],
    channel: string,
    ids: string[]
  ) =>
    channel === "squad" ? players.filter((p) => ids.includes(p.id)) : players,
}))

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
let root: Root | undefined
afterEach(async () => {
  await act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ""
  vi.useRealTimers()
  vi.clearAllMocks()
})

const players = ["a", "b"].map((id, seat) => ({
  id,
  name: id.toUpperCase(),
  seat,
  connected: true,
  ready: true,
  joinedAt: "now",
  lastSeenAt: "now",
})) satisfies Player[]
const message = (id = "first", body = "hello"): ChatMessage => ({
  id,
  body,
  playerId: "b",
  playerName: "B",
  channel: "public",
  kind: "text",
  mentionPlayerIds: [],
  createdAt: "now",
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function mountRoot() {
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  return container
}

function labelledButton(label: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((candidate) => candidate.getAttribute("aria-label") === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  return button
}

async function channelHarness(
  onSendMessage: (input: unknown) => void | Promise<boolean> = vi.fn()
) {
  mountRoot()
  let current!: ReturnType<typeof useChannelChat>
  let reading = true
  let messages = [message()]
  const onTyping = vi.fn()
  const onComposeEnd = vi.fn()
  function Harness() {
    current = useChannelChat({
      messages,
      squadMessages: [],
      squadPlayerId: null,
      players,
      squadMemberIds: [],
      selfPlayerId: "a",
      isReading: reading,
      onSendMessage,
      onTyping,
      onComposeEnd,
    })
    return (
      <button
        type="button"
        disabled={current.sending}
        onClick={() => void current.sendText()}
      >
        {current.sending ? "Sending…" : "Send"}
      </button>
    )
  }
  const render = () => root!.render(<Harness />)
  await act(render)
  return {
    get: () => current,
    onTyping,
    onComposeEnd,
    render: () => act(render),
    reading: (value: boolean) =>
      act(() => {
        reading = value
        render()
      }),
    messages: (value: ChatMessage[]) =>
      act(() => {
        messages = value
        render()
      }),
  }
}

it("blocks same-tick double sends and exposes pending feedback before acknowledgement", async () => {
  const request = deferred<boolean>()
  const send = vi.fn(() => request.promise)
  const h = await channelHarness(send)
  await act(() => h.get().changeText(" Hello "))
  let first!: Promise<void>
  let duplicate!: Promise<void>
  await act(() => {
    first = h.get().sendText()
    duplicate = h.get().sendText()
  })
  expect(send).toHaveBeenCalledOnce()
  expect(send).toHaveBeenCalledWith({
    kind: "text",
    body: "Hello",
    mentionPlayerIds: [],
    channel: "public",
  })
  expect(h.get().sending).toBe(true)
  expect(document.querySelector("button")!.disabled).toBe(true)
  expect(document.body.textContent).toContain("Sending")
  expect(h.onComposeEnd).toHaveBeenCalledOnce()
  expect(h.onTyping).toHaveBeenCalledExactlyOnceWith(true)
  await act(async () => {
    request.resolve(true)
    await Promise.all([first, duplicate])
  })
  expect(h.get().sending).toBe(false)
  expect(h.get().text).toBe("")
})

it.each(["rejected", "failed"])(
  "retains draft and reply when sending is %s",
  async (failure) => {
    const send = vi.fn(() =>
      failure === "rejected"
        ? Promise.reject(new Error("Offline"))
        : Promise.resolve(false)
    )
    const h = await channelHarness(send)
    await act(() => {
      h.get().changeText("Keep this draft")
      h.get().setReplyToMessageId("first")
    })
    await act(async () => {
      await h.get().sendText()
    })
    expect(h.get().text).toBe("Keep this draft")
    expect(h.get().replyToMessageId).toBe("first")
    expect(h.get().sending).toBe(false)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: "first" })
    )
  }
)

it("clears the acknowledged draft and reply after success", async () => {
  const h = await channelHarness(vi.fn(async () => true))
  await act(() => {
    h.get().changeText("Send me")
    h.get().setReplyToMessageId("first")
  })
  await act(async () => {
    await h.get().sendText()
  })
  expect(h.get().text).toBe("")
  expect(h.get().replyToMessageId).toBeNull()
})

it("does not overwrite text or reply chosen while an older send is pending", async () => {
  const request = deferred<boolean>()
  const h = await channelHarness(vi.fn(() => request.promise))
  await act(() => {
    h.get().changeText("Old draft")
    h.get().setReplyToMessageId("first")
  })
  let pending!: Promise<void>
  await act(() => {
    pending = h.get().sendText()
  })
  await act(() => {
    h.get().changeText("New draft")
    h.get().setReplyToMessageId("second")
  })
  await act(async () => {
    request.resolve(true)
    await pending
  })
  expect(h.get().text).toBe("New draft")
  expect(h.get().replyToMessageId).toBe("second")
})

it("preserves new mention metadata and reply while an older send acknowledgement arrives", async () => {
  const request = deferred<boolean>()
  const send = vi
    .fn()
    .mockImplementationOnce(() => request.promise)
    .mockResolvedValue(true)
  const h = await channelHarness(send)
  await act(() => h.get().changeText("Original draft"))
  let pending!: Promise<void>
  await act(() => {
    pending = h.get().sendText()
  })
  await act(() => h.get().changeText("New "))
  await act(() => {
    h.get().applyMention(players[1]!, { start: 4, end: 4 })
    h.get().setReplyToMessageId("second")
  })
  await act(async () => {
    request.resolve(true)
    await pending
  })
  expect(h.get().text).toBe("New @B ")
  expect(h.get().replyToMessageId).toBe("second")
  await act(async () => {
    await h.get().sendText()
  })
  expect(send).toHaveBeenLastCalledWith({
    kind: "text",
    body: "New @B",
    mentionPlayerIds: ["b"],
    replyToMessageId: "second",
    channel: "public",
  })
})

it("preserves drafts and replies while the panel closes and reopens, with unread mentions retained until reading", async () => {
  const h = await channelHarness()
  await act(() => {
    h.get().changeText("Come back to this")
    h.get().setReplyToMessageId("first")
  })
  await h.reading(false)
  await h.messages([message(), { ...message("new"), mentionPlayerIds: ["a"] }])
  expect(h.get().text).toBe("Come back to this")
  expect(h.get().replyToMessageId).toBe("first")
  expect(h.get().unreadMessageCount).toBe(1)
  expect(h.get().publicMention).toBe(true)
  await h.reading(true)
  expect(h.get().text).toBe("Come back to this")
  expect(h.get().replyToMessageId).toBe("first")
  expect(h.get().unreadMessageCount).toBe(0)
  expect(h.get().publicMention).toBe(false)
})

it("renders reply content literally and keeps reply/react callbacks tied to the original message", async () => {
  mountRoot()
  const original = {
    ...message("unsafe", '<img src=x onerror="alert(1)">'),
    playerName: "<script>bad()</script>",
    reactions: [{ emoji: "👍", playerIds: ["a"] }],
  }
  const reply = vi.fn()
  const react = vi.fn()
  const cancel = vi.fn()
  await act(() =>
    root!.render(
      <>
        <ReplyPreview message={original} onCancel={cancel} />
        <PublicMessageActions
          message={original}
          selfId="a"
          onReply={reply}
          onReact={react}
        />
      </>
    )
  )
  expect(document.querySelector("img,script")).toBeNull()
  expect(document.body.textContent).toContain(original.body)
  expect(document.body.textContent).toContain(original.playerName)
  await act(() =>
    document
      .querySelector<HTMLButtonElement>(
        `button[aria-label="Reply to ${original.playerName}'s message"]`
      )!
      .click()
  )
  expect(reply).toHaveBeenCalledWith("unsafe")
  const existing = labelledButton("👍 reaction, 1")
  expect(existing.getAttribute("aria-pressed")).toBe("true")
  await act(() => existing.click())
  expect(react).toHaveBeenLastCalledWith(original, "👍")
  const details = document.querySelector("details")!
  details.setAttribute("open", "")
  await act(() => labelledButton("React 🔥").click())
  expect(react).toHaveBeenLastCalledWith(original, "🔥")
  expect(details.hasAttribute("open")).toBe(false)
  await act(() =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Cancel reply"]')!
      .click()
  )
  expect(cancel).toHaveBeenCalledOnce()
  await act(() => root!.render(<ReplyPreview unavailable />))
  expect(document.body.textContent).toContain(
    "Original message is no longer available"
  )
})

function mockSocket(
  initialTyping: Array<{ playerId: string; expiresAt: number }> = []
) {
  const handlers = new Map<string, Set<(...args: any[]) => void>>()
  const emit = vi.fn((event: string, ...args: any[]) => {
    if (event === "room:getChatTyping")
      args[0](null, { ok: true, data: initialTyping })
  })
  const socket = {
    connected: true,
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(listener)
    }),
    off: vi.fn((event: string, listener: (...args: any[]) => void) => {
      handlers.get(event)?.delete(listener)
    }),
    timeout: vi.fn(() => socket),
    volatile: { emit },
  }
  return {
    socket,
    emit,
    handlers,
    receive: (event: string, ...args: unknown[]) => {
      for (const listener of handlers.get(event) ?? []) listener(...args)
    },
  }
}

async function publicHarness(
  initialTyping: Array<{ playerId: string; expiresAt: number }> = []
) {
  mountRoot()
  const mock = mockSocket(initialTyping)
  let current!: ReturnType<typeof usePublicChatControls>
  function Harness() {
    current = usePublicChatControls(
      mock.socket as unknown as GameSocket,
      "ABCDEF",
      players,
      "a"
    )
    return (
      <>
        {current.typingNames.join(",")}
        {current.error && <div role="alert">{current.error}</div>}
      </>
    )
  }
  await act(() => root!.render(<Harness />))
  // Initial typing hydration is a read; following assertions count only mutations.
  mock.emit.mockClear()
  return { ...mock, get: () => current }
}

it("hydrates current typing leases on initial mount", async () => {
  const h = await publicHarness([
    { playerId: "b", expiresAt: Date.now() + 3000 },
  ])
  expect(h.socket.timeout).toHaveBeenCalledWith(4000)
  expect(h.get().typingNames).toEqual(["B"])
})

it("ending composition for send cancels idle and cleanup packets without sending typing-stop", async () => {
  vi.useFakeTimers()
  const h = await publicHarness()
  await act(() => h.get().onTyping(true))
  expect(h.emit).toHaveBeenCalledOnce()
  await act(() => h.get().endCompose())
  expect(h.emit).toHaveBeenCalledOnce()
  await act(() => vi.advanceTimersByTime(3000))
  expect(h.emit).toHaveBeenCalledOnce()
  await act(() => root!.unmount())
  root = undefined
  expect(h.emit).toHaveBeenCalledOnce()
})

it("text send ends local composition and emits only the acknowledged chat request", async () => {
  vi.useFakeTimers()
  mountRoot()
  const mock = mockSocket()
  let chat!: ReturnType<typeof useChannelChat>
  function Harness() {
    const controls = usePublicChatControls(
      mock.socket as unknown as GameSocket,
      "ABCDEF",
      players,
      "a"
    )
    chat = useChannelChat({
      messages: [],
      squadMessages: [],
      squadPlayerId: null,
      players,
      squadMemberIds: [],
      selfPlayerId: "a",
      isReading: false,
      onTyping: controls.onTyping,
      onComposeEnd: controls.endCompose,
      onSendMessage: (input) => {
        mock.socket.volatile.emit("room:sendChatMessage", input)
        return Promise.resolve(true)
      },
    })
    return null
  }
  await act(() => root!.render(<Harness />))
  await act(() => chat.changeText("Hello table"))
  mock.emit.mockClear()
  await act(async () => {
    await chat.sendText()
  })
  expect(mock.emit).toHaveBeenCalledExactlyOnceWith(
    "room:sendChatMessage",
    expect.objectContaining({ body: "Hello table" })
  )
  await act(() => vi.advanceTimersByTime(3000))
  expect(mock.emit).toHaveBeenCalledOnce()
})

it("shortcut guide focuses its close control, traps Tab, handles Escape and restores focus", async () => {
  mountRoot()
  const opener = document.createElement("button")
  opener.textContent = "Open guide"
  document.body.append(opener)
  opener.focus()
  let visible = true
  const close = vi.fn(() => {
    visible = false
    render()
  })
  function render() {
    root!.render(visible ? <ShortcutGuide onClose={close} /> : null)
  }
  await act(render)
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((candidate) => candidate.textContent === "Close guide")!
  expect(document.activeElement).toBe(button)
  for (const shiftKey of [false, true]) {
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
    await act(() => button.dispatchEvent(tab))
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(button)
  }
  await act(() =>
    button.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        isComposing: true,
      })
    )
  )
  expect(close).not.toHaveBeenCalled()
  await act(() =>
    button.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    )
  )
  expect(close).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it("shortcut guide closes for its backdrop, but not clicks inside the dialog", async () => {
  mountRoot()
  const close = vi.fn()
  await act(() => root!.render(<ShortcutGuide onClose={close} />))
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  await act(() => dialog.click())
  expect(close).not.toHaveBeenCalled()
  await act(() => dialog.parentElement!.click())
  expect(close).toHaveBeenCalledOnce()
})

it("throttles typing refreshes and expires idle composition without interval polling", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  const h = await publicHarness()
  await act(() => {
    h.get().onTyping(true)
    h.get().onTyping(true)
  })
  expect(h.emit).toHaveBeenCalledTimes(1)
  expect(h.emit).toHaveBeenLastCalledWith(
    "room:setChatTyping",
    { typing: true },
    expect.any(Function)
  )
  await act(() => vi.advanceTimersByTime(1200))
  await act(() => h.get().onTyping(true))
  expect(h.emit).toHaveBeenCalledTimes(2)
  await act(() => vi.advanceTimersByTime(2499))
  expect(h.emit).toHaveBeenCalledTimes(2)
  await act(() => vi.advanceTimersByTime(1))
  expect(h.emit).toHaveBeenLastCalledWith(
    "room:setChatTyping",
    { typing: false },
    expect.any(Function)
  )
})

it("filters typing to room peers, expires remote leases, and cleans up disconnect and unmount", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  const h = await publicHarness()
  await act(() =>
    h.receive("room:chatTyping", [
      { playerId: "a", expiresAt: 13_000 },
      { playerId: "b", expiresAt: 10_500 },
      { playerId: "foreign", expiresAt: 14_000 },
    ])
  )
  expect(h.get().typingNames).toEqual(["B"])
  await act(() => vi.advanceTimersByTime(501))
  expect(h.get().typingNames).toEqual([])
  await act(() => h.get().onTyping(true))
  h.socket.connected = false
  await act(() => h.receive("disconnect"))
  expect(h.get().typingNames).toEqual([])
  const before = h.emit.mock.calls.length
  await act(() => vi.advanceTimersByTime(3000))
  expect(h.emit).toHaveBeenCalledTimes(before)
  h.socket.connected = true
  await act(() => h.get().onTyping(true))
  await act(() => root!.unmount())
  root = undefined
  expect(h.emit).toHaveBeenLastCalledWith(
    "room:setChatTyping",
    { typing: false },
    expect.any(Function)
  )
  expect([...h.handlers.values()].every((set) => set.size === 0)).toBe(true)
})

it("gates pending reactions, uses explicit toggle state, and reports failed acknowledgements", async () => {
  const h = await publicHarness()
  const original = {
    ...message(),
    reactions: [{ emoji: "👍", playerIds: ["a"] }],
  }
  await act(() => {
    h.get().react(original, "👍")
    h.get().react(original, "👍")
  })
  expect(h.emit).toHaveBeenCalledOnce()
  expect(h.emit).toHaveBeenLastCalledWith(
    "room:reactToChatMessage",
    { messageId: "first", emoji: "👍", active: false },
    expect.any(Function)
  )
  const ack = h.emit.mock.calls[0]![2] as (
    cause: Error | null,
    result?: unknown
  ) => void
  await act(() => ack(new Error("timeout")))
  expect(h.get().error).toContain("unconfirmed")
  await act(() => h.get().react(original, "🔥"))
  const retryAck = h.emit.mock.calls[1]![2] as typeof ack
  await act(() =>
    retryAck(null, {
      ok: false,
      error: { code: "reaction-too-fast", message: "Wait a beat." },
    })
  )
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Wait a beat."
  )
})

it("preserves reading position on new messages and jumps only on request or when near the bottom", async () => {
  mountRoot()
  let ids = ["first"]
  let current!: ReturnType<typeof useReadingScroll>
  function Harness() {
    current = useReadingScroll(ids)
    return (
      <>
        <div data-list ref={current.listRef} onScroll={current.onScroll} />
        <button onClick={current.latest}>{current.unread} new</button>
      </>
    )
  }
  const render = () => root!.render(<Harness />)
  await act(render)
  const list = document.querySelector<HTMLDivElement>("[data-list]")!
  Object.defineProperties(list, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
  })
  list.scrollTop = 200
  await act(() => list.dispatchEvent(new Event("scroll", { bubbles: true })))
  await act(() => {
    ids = ["first", "second", "third"]
    render()
  })
  expect(list.scrollTop).toBe(200)
  expect(current.unread).toBe(2)
  await act(render)
  expect(current.unread).toBe(2)
  await act(() => document.querySelector("button")!.click())
  expect(list.scrollTop).toBe(1000)
  expect(current.unread).toBe(0)
  list.scrollTop = 780
  await act(() => list.dispatchEvent(new Event("scroll", { bubbles: true })))
  await act(() => {
    ids = [...ids, "fourth"]
    render()
  })
  expect(list.scrollTop).toBe(1000)
  expect(current.unread).toBe(0)
})
