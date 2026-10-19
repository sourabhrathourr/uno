import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PublicMessageActions, PublicMessageReactions } from "./message-actions"
import { ReplyPreview } from "./public-chat-controls"
import type { ChatMessage, Player } from "@workspace/game"

let root: Root
const message: ChatMessage = {
  id: "original",
  playerId: "a",
  playerName: "Maya",
  channel: "public",
  kind: "text",
  body: "Save a reverse for the next draw stack.",
  mentionPlayerIds: [],
  createdAt: "now",
  reactions: [{ emoji: "👍", playerIds: ["me"] }],
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(() => root.unmount())
  document.body.innerHTML = ""
  vi.useRealTimers()
})
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label
  )!

it("distinguishes quote navigation from composing a reply and leaves missing quotes inert", async () => {
  const navigate = vi.fn(),
    reply = vi.fn()
  await act(() =>
    root.render(
      <>
        <ReplyPreview message={message} onNavigate={navigate} />
        <PublicMessageActions
          message={message}
          selfId="me"
          onReply={reply}
          onReact={vi.fn()}
        />
      </>
    )
  )
  expect(button("Go to original message from Maya").textContent).toContain(
    message.body
  )
  await act(() => button("Go to original message from Maya").click())
  expect(navigate).toHaveBeenCalledOnce()
  expect(reply).not.toHaveBeenCalled()
  await act(() => button("React or reply to Maya's message").click())
  await act(() => button("Reply to Maya's message").focus())
  await act(() => button("Reply to Maya's message").click())
  expect(reply).toHaveBeenCalledWith("original")
  expect(document.activeElement).toBe(
    button("React or reply to Maya's message")
  )
  expect(navigate).toHaveBeenCalledOnce()
  await act(() =>
    root.render(<ReplyPreview unavailable onNavigate={navigate} />)
  )
  expect(document.querySelector("button")).toBeNull()
  expect(document.body.textContent).toContain(
    "Original message is no longer available"
  )
})

it("shows reactor names grouped by emoji without changing reactions, with explicit removal and picker access", async () => {
  const react = vi.fn()
  const sample = {
    ...message,
    reactions: [
      { emoji: "👍", playerIds: ["me", "a", "departed"] },
      { emoji: "🔥", playerIds: ["a"] },
    ],
  }
  await act(() =>
    root.render(
      <div data-chat-message="original" className="group/message">
        <PublicMessageActions
          message={sample}
          selfId="me"
          onReply={vi.fn()}
          onReact={react}
        />
        <PublicMessageReactions
          message={sample}
          selfId="me"
          players={[{ id: "a", name: "Maya" } as Player]}
          onReact={react}
        />
      </div>
    )
  )
  const badge = button("👍 reactions, 3. View who reacted")
  await act(() => badge.click())
  expect(react).not.toHaveBeenCalled()
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain("You")
  expect(dialog.textContent).toContain("Maya")
  expect(dialog.textContent).toContain("Player no longer in room")
  expect(dialog.querySelectorAll("section")).toHaveLength(2)
  await act(() => button("Remove my 👍 reaction").click())
  expect(react).toHaveBeenCalledExactlyOnceWith(sample, "👍")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(() => badge.click())
  await act(() =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Add or change reaction")!
      .click()
  )
  expect(
    document.querySelector('[role="dialog"]')?.getAttribute("aria-label")
  ).toBe("React to Maya's message")
})

it("dismisses reactor names by keyboard, outside press and chat scroll, while retaining internal scroll", async () => {
  await act(() =>
    root.render(
      <PublicMessageReactions message={message} selfId="me" onReact={vi.fn()} />
    )
  )
  const badge = button("👍 reactions, 1. View who reacted")
  await act(() => badge.click())
  const dialog = document.querySelector('[role="dialog"]')!
  await act(() => dialog.dispatchEvent(new Event("scroll", { bubbles: true })))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    )
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  for (const event of [
    new Event("pointerdown", { bubbles: true }),
    new Event("scroll", { bubbles: true }),
  ]) {
    await act(() => badge.click())
    await act(() => document.body.dispatchEvent(event))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  }
})

it("restores message-action focus when the final reaction is removed remotely", async () => {
  const render = (sample: ChatMessage) =>
    root.render(
      <div data-chat-message="original">
        <PublicMessageActions
          message={sample}
          selfId="me"
          onReply={vi.fn()}
          onReact={vi.fn()}
        />
        <PublicMessageReactions
          message={sample}
          selfId="me"
          onReact={vi.fn()}
        />
      </div>
    )
  await act(() => render(message))
  await act(() => button("👍 reactions, 1. View who reacted").click())
  expect(document.activeElement).toBe(button("Close reactions"))
  await act(() => render({ ...message, reactions: [] }))
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(
    button("React or reply to Maya's message")
  )
})

it("opens an accessible picker, reflects existing choices and reacts only after explicit selection", async () => {
  const react = vi.fn()
  await act(() =>
    root.render(
      <PublicMessageActions
        message={message}
        selfId="me"
        onReply={vi.fn()}
        onReact={react}
      />
    )
  )
  const trigger = button("React or reply to Maya's message")
  await act(() => trigger.click())
  expect(trigger.getAttribute("aria-expanded")).toBe("true")
  expect(button("React 👍").getAttribute("aria-pressed")).toBe("true")
  expect(document.activeElement).toBe(button("React 👍"))
  expect(react).not.toHaveBeenCalled()
  await act(() => button("React 👍").click())
  expect(react).toHaveBeenCalledWith(message, "👍")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it("dismisses by Escape, outside press, scrolling, or keyboard focus leaving the picker", async () => {
  await act(() =>
    root.render(
      <PublicMessageActions
        message={message}
        selfId="me"
        onReply={vi.fn()}
        onReact={vi.fn()}
      />
    )
  )
  const trigger = button("React or reply to Maya's message")
  for (const dismiss of [
    () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        })
      ),
    () =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    () => document.dispatchEvent(new Event("scroll")),
    () =>
      document.body.dispatchEvent(new FocusEvent("focusin", { bubbles: true })),
  ]) {
    await act(() => trigger.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(dismiss)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  }
})
