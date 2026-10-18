import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fixture } from "./test-fixture"
import { parseCommand } from "./commands"

let f: Awaited<ReturnType<typeof fixture>>
beforeEach(async () => {
  f = await fixture()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await f.close()
})

async function poll(playing = false) {
  const a = f.client(200),
    b = f.client(200),
    c = f.client(200)
  await a.execute({ action: "create", name: "Initiator" })
  const code = a.status().room!.code
  await b.execute({ action: "join", code, name: "Voter" })
  await c.execute({ action: "join", code, name: "Target" })
  if (playing) {
    await b.execute({ action: "ready", ready: true })
    await c.execute({ action: "ready", ready: true })
    await a.execute({ action: "start" })
  }
  const result = f.manager.startVoteKick(
    code,
    a.status().playerId!,
    c.status().playerId!
  )
  if (!result.ok) throw new Error(result.error.message)
  f.publish(code, result.data)
  await expect.poll(() => b.status().pending.voteKick?.actionable).toBe(true)
  return { a, b, c, code, id: result.data.voteKick.activeVoteKickId! }
}

it.each([
  { action: "vote-cast", voteKickId: "poll" },
  { action: "vote-cast", voteKickId: "poll", choice: true },
  { action: "vote-cast", voteKickId: "poll", choice: "YES" },
  { action: "vote-cast", voteKickId: "", choice: "yes" },
  {
    action: "vote-cast",
    voteKickId: "poll",
    choice: "yes",
    targetPlayerId: "someone",
  },
])(
  "requires an explicit bounded poll ID and exact Yes/No choice: %o",
  (input) => {
    expect(() => parseCommand(input)).toThrow()
  }
)

it("reads public poll details/deadline, casts explicit choices, and deduplicates the same vote", async () => {
  const { b, c, id } = await poll()
  await expect(b.execute({ action: "vote-read" })).resolves.toMatchObject({
    poll: { id, targetPlayerName: "Target", yesCount: 1, noCount: 0 },
    myChoice: null,
    eligible: true,
    actionable: true,
    yesCommand: { action: "vote-cast", voteKickId: id, choice: "yes" },
    noCommand: { action: "vote-cast", voteKickId: id, choice: "no" },
    remainingMs: expect.any(Number),
  })
  await b.execute({ action: "vote-cast", voteKickId: id, choice: "yes" })
  expect(b.status().pending.voteKick).toMatchObject({
    myChoice: "yes",
    poll: { yesCount: 2 },
  })
  const sent = f.received.filter(
    (event) => event === "room:castVoteKick"
  ).length
  await expect(
    b.execute({ action: "vote-cast", voteKickId: id, choice: "yes" })
  ).resolves.toMatchObject({ alreadyVoted: true })
  expect(
    f.received.filter((event) => event === "room:castVoteKick")
  ).toHaveLength(sent)
  await b.execute({ action: "vote-cast", voteKickId: id, choice: "no" })
  expect(b.status().pending.voteKick).toMatchObject({
    myChoice: "no",
    poll: { yesCount: 1, noCount: 1 },
  })
  await expect(
    c.execute({ action: "vote-cast", voteKickId: id, choice: "yes" })
  ).rejects.toMatchObject({ code: "vote-kick-not-eligible" })
})

it("rejects unknown, expired, and resolved polls without sending a vote", async () => {
  const { b, code, id } = await poll()
  await expect(
    b.execute({ action: "vote-cast", voteKickId: "missing", choice: "no" })
  ).rejects.toMatchObject({ code: "vote-kick-not-found" })
  const clock = vi
    .spyOn(performance, "now")
    .mockReturnValue(performance.now() + 60_000)
  await expect(b.execute({ action: "vote-read" })).resolves.toMatchObject({
    open: false,
    remainingMs: 0,
    actionable: false,
    yesCommand: null,
  })
  await expect(
    b.execute({ action: "vote-cast", voteKickId: id, choice: "no" })
  ).rejects.toMatchObject({ code: "vote-kick-closed" })
  clock.mockRestore()
  const snapshot = structuredClone(b.status().room!)
  snapshot.version++
  snapshot.voteKick.activeVoteKickId = null
  snapshot.chatMessages.find(
    (message) => message.voteKick?.id === id
  )!.voteKick!.status = "failed"
  f.publish(code, snapshot)
  await expect.poll(() => b.status().pending.voteKick).toBeNull()
  await expect(
    b.execute({ action: "vote-read", voteKickId: id })
  ).resolves.toMatchObject({ open: false, poll: { status: "failed" } })
  await expect(
    b.execute({ action: "vote-cast", voteKickId: id, choice: "no" })
  ).rejects.toMatchObject({ code: "vote-kick-closed" })
  expect(f.received).not.toContain("room:castVoteKick")
})

it("uses server-relative expiry when the client wall clock is ahead", async () => {
  const { b, id } = await poll()
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000)
  expect(b.status().pending.voteKick).toMatchObject({
    open: true,
    actionable: true,
  })
  // Only the synchronous client status read sees skew; server time stays real.
  clock.mockRestore()
  await b.execute({ action: "vote-cast", voteKickId: id, choice: "no" })
  expect(b.status().pending.voteKick?.myChoice).toBe("no")
})

it("requires synchronized snapshots and the requested current room version", async () => {
  const { a, b, code, id } = await poll(true)
  f.controls.holdPrivate = true
  await a.execute({ action: "chat-send", body: "State changed" })
  await expect.poll(() => b.status().synchronized).toBe(false)
  expect(b.status().pending.voteKick?.actionable).toBe(false)
  await expect(
    b.execute({ action: "vote-cast", voteKickId: id, choice: "no" })
  ).rejects.toMatchObject({ code: "stale-state" })
  f.controls.holdPrivate = false
  f.publish(code)
  await expect.poll(() => b.status().synchronized).toBe(true)
  await expect(
    b.execute({
      action: "vote-cast",
      voteKickId: id,
      choice: "no",
      expectedVersion: 0,
    })
  ).rejects.toMatchObject({ code: "stale-version" })
  expect(f.received).not.toContain("room:castVoteKick")
  await b.execute({
    action: "vote-cast",
    voteKickId: id,
    choice: "no",
    expectedVersion: b.status().room!.version,
  })
})

it("restores the poll and existing vote after reconnect instead of replaying a choice", async () => {
  const { b, id } = await poll()
  await b.execute({ action: "vote-cast", voteKickId: id, choice: "no" })
  const socket = [...f.io.sockets.sockets.values()].find(
    (socket) => socket.data.playerId === b.status().playerId
  )!
  const disconnected = new Promise<void>((resolve) =>
    b.once("change", () => resolve())
  )
  socket.conn.close()
  await disconnected
  await expect.poll(() => b.status().joined, { timeout: 5000 }).toBe(true)
  expect(b.status().pending.voteKick).toMatchObject({
    myChoice: "no",
    actionable: true,
  })
  expect(
    f.received.filter((event) => event === "room:castVoteKick")
  ).toHaveLength(1)
})

it("requires resync after an unknown vote acknowledgement and avoids duplicate resend", async () => {
  const { b, id } = await poll()
  f.controls.dropAckFor = "room:castVoteKick"
  await expect(
    b.execute({ action: "vote-cast", voteKickId: id, choice: "yes" })
  ).rejects.toMatchObject({ code: "outcome-unknown" })
  expect(b.status().pending.voteKick?.actionable).toBe(false)
  await expect(
    b.execute({ action: "vote-cast", voteKickId: id, choice: "no" })
  ).rejects.toMatchObject({ code: "resync-required" })
  f.controls.dropAckFor = ""
  await b.execute({ action: "resync" })
  await expect(
    b.execute({ action: "vote-cast", voteKickId: id, choice: "yes" })
  ).resolves.toMatchObject({ alreadyVoted: true })
  expect(
    f.received.filter((event) => event === "room:castVoteKick")
  ).toHaveLength(1)
})
