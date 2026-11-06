import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MusicTrack } from "@workspace/game"

import { RoomMusic } from "./room-music"

const ROOM = "ABC123"
const alice = { id: "p-alice", name: "Alice" }

function track(id: string, durationSec: number | null = 180): MusicTrack {
  return {
    id: id.padEnd(11, "x"),
    title: `Song ${id}`,
    artist: "Artist",
    durationSec,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("room music queue", () => {
  it("starts the first song right away and queues the rest in order", () => {
    const music = new RoomMusic()
    const first = music.enqueue(ROOM, track("a"), alice)
    const second = music.enqueue(ROOM, track("b"), alice)
    const third = music.enqueue(ROOM, track("c"), alice, "next")

    expect(first.ok && first.data.placement).toBe("playing")
    expect(second.ok && second.data.placement).toBe(1)
    expect(third.ok && third.data.placement).toBe(1)
    const snapshot = music.snapshot(ROOM)
    expect(snapshot.status).toBe("playing")
    expect(snapshot.nowPlaying?.title).toBe("Song a")
    expect(snapshot.queue.map((entry) => entry.title)).toEqual([
      "Song c",
      "Song b",
    ])
    expect(snapshot.history.map((entry) => entry.title)).toEqual(["Song a"])
  })

  it("reports the shared position and freezes it while paused", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a"), alice)
    vi.advanceTimersByTime(30_000)
    expect(music.snapshot(ROOM).positionSec).toBeCloseTo(30)

    music.pause(ROOM)
    vi.advanceTimersByTime(60_000)
    expect(music.snapshot(ROOM)).toMatchObject({
      status: "paused",
      positionSec: 30,
    })

    music.resume(ROOM)
    vi.advanceTimersByTime(5_000)
    expect(music.snapshot(ROOM).positionSec).toBeCloseTo(35)
  })

  it("advances on its own when a song's length runs out", () => {
    const onStateChanged = vi.fn()
    const music = new RoomMusic({ onStateChanged })
    music.enqueue(ROOM, track("a", 60), alice)
    music.enqueue(ROOM, track("b", 60), alice)

    vi.advanceTimersByTime(60_000)
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song a")
    vi.advanceTimersByTime(3_000)
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song b")
    expect(onStateChanged).toHaveBeenCalledWith(ROOM)

    vi.advanceTimersByTime(63_000)
    expect(music.snapshot(ROOM).status).toBe("idle")
  })

  it("does not auto-advance while paused", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a", 60), alice)
    vi.advanceTimersByTime(10_000)
    music.pause(ROOM)
    vi.advanceTimersByTime(120_000)
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song a")
  })

  it("ignores an early 'ended' report so one client cannot cut a song short", () => {
    const music = new RoomMusic()
    const started = music.enqueue(ROOM, track("a", 200), alice)
    music.enqueue(ROOM, track("b"), alice)
    const queueId = started.ok ? started.data.entry.queueId : ""

    vi.advanceTimersByTime(20_000)
    expect(music.reportEnded(ROOM, queueId)).toBe(false)
    vi.advanceTimersByTime(178_000)
    expect(music.reportEnded(ROOM, queueId)).toBe(true)
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song b")
    // A second, late report for the same song changes nothing.
    expect(music.reportEnded(ROOM, queueId)).toBe(false)
  })

  it("lets unknown-length songs end from a client report after a short floor", () => {
    const music = new RoomMusic()
    const started = music.enqueue(ROOM, track("a", null), alice)
    const queueId = started.ok ? started.data.entry.queueId : ""
    vi.advanceTimersByTime(5_000)
    expect(music.reportEnded(ROOM, queueId)).toBe(false)
    vi.advanceTimersByTime(6_000)
    expect(music.reportEnded(ROOM, queueId)).toBe(true)
  })

  it("skips an unplayable song only when it is still the current one", () => {
    const music = new RoomMusic()
    const started = music.enqueue(ROOM, track("a"), alice)
    music.enqueue(ROOM, track("b"), alice)
    expect(music.reportUnplayable(ROOM, "stale-id")).toBeNull()
    const queueId = started.ok ? started.data.entry.queueId : ""
    expect(music.reportUnplayable(ROOM, queueId)?.title).toBe("Song a")
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song b")
  })

  it("stop clears the queue but keeps history", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a"), alice)
    music.enqueue(ROOM, track("b"), alice)
    music.stop(ROOM)
    const snapshot = music.snapshot(ROOM)
    expect(snapshot).toMatchObject({ status: "idle", nowPlaying: null })
    expect(snapshot.queue).toEqual([])
    expect(snapshot.history).toHaveLength(1)
  })

  it("seeks the current song for everyone, playing or paused", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a", 100), alice)
    music.enqueue(ROOM, track("b", 100), alice)
    vi.advanceTimersByTime(10_000)

    expect(music.seek(ROOM, 60).ok).toBe(true)
    expect(music.snapshot(ROOM).positionSec).toBe(60)
    vi.advanceTimersByTime(5_000)
    expect(music.snapshot(ROOM).positionSec).toBe(65)

    // Seeking moves the auto-advance timer with it.
    vi.advanceTimersByTime(36_000)
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song a")
    vi.advanceTimersByTime(2_000)
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song b")

    music.pause(ROOM)
    music.seek(ROOM, 30)
    expect(music.snapshot(ROOM)).toMatchObject({
      status: "paused",
      positionSec: 30,
    })
    music.seek(ROOM, 500)
    expect(music.snapshot(ROOM).positionSec).toBe(99)
    music.seek(ROOM, -5)
    expect(music.snapshot(ROOM).positionSec).toBe(0)
  })

  it("refuses to seek when idle, live, or given garbage", () => {
    const music = new RoomMusic()
    expect(music.seek(ROOM, 10).ok).toBe(false)
    music.enqueue(ROOM, { ...track("a"), durationSec: null }, alice)
    const live = music.seek(ROOM, 10)
    expect(!live.ok && live.error.code).toBe("music-not-seekable")
    music.skip(ROOM)
    music.enqueue(ROOM, track("b", 100), alice)
    expect(music.seek(ROOM, Number.NaN).ok).toBe(false)
  })

  it("play now replaces the current song and keeps the queue", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a"), alice)
    music.enqueue(ROOM, track("b"), alice)
    music.pause(ROOM)
    const now = music.enqueue(ROOM, track("c"), alice, "now")
    expect(now.ok && now.data.placement).toBe("playing")
    const snapshot = music.snapshot(ROOM)
    expect(snapshot).toMatchObject({ status: "playing", positionSec: 0 })
    expect(snapshot.nowPlaying?.title).toBe("Song c")
    expect(snapshot.queue.map((entry) => entry.title)).toEqual(["Song b"])
    expect(snapshot.history.map((entry) => entry.title)).toEqual([
      "Song c",
      "Song a",
    ])
  })

  it("moves a replayed song to the top of history instead of duplicating it", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a", 10), alice)
    music.enqueue(ROOM, track("b", 10), alice)
    music.enqueue(ROOM, track("a", 10), alice)
    vi.advanceTimersByTime(13_000)
    vi.advanceTimersByTime(13_000)
    expect(music.snapshot(ROOM).history.map((entry) => entry.title)).toEqual([
      "Song a",
      "Song b",
    ])
  })
})

describe("previous", () => {
  it("goes back a song and lets next return to where you were", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a", 60), alice)
    music.enqueue(ROOM, track("b", 60), alice)
    music.enqueue(ROOM, track("c", 60), alice)
    expect(music.snapshot(ROOM).canGoBack).toBe(false)
    music.skip(ROOM)
    expect(music.snapshot(ROOM).canGoBack).toBe(true)

    const back = music.previous(ROOM)
    expect(back.ok && back.data.restarted).toBe(false)
    let snapshot = music.snapshot(ROOM)
    expect(snapshot.nowPlaying?.title).toBe("Song a")
    expect(snapshot.queue.map((entry) => entry.title)).toEqual([
      "Song b",
      "Song c",
    ])
    expect(snapshot.canGoBack).toBe(false)

    music.skip(ROOM)
    snapshot = music.snapshot(ROOM)
    expect(snapshot.nowPlaying?.title).toBe("Song b")
    expect(snapshot.queue.map((entry) => entry.title)).toEqual(["Song c"])
  })

  it("restarts the song when it is a few seconds in", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a", 60), alice)
    music.enqueue(ROOM, track("b", 60), alice)
    music.skip(ROOM)
    vi.advanceTimersByTime(10_000)
    const result = music.previous(ROOM)
    expect(result.ok && result.data.restarted).toBe(true)
    expect(music.snapshot(ROOM)).toMatchObject({
      positionSec: 0,
      nowPlaying: { title: "Song b" },
    })
  })

  it("brings back the last song after stop, but never an unplayable one", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a", 60), alice)
    music.stop(ROOM)
    expect(music.previous(ROOM).ok).toBe(true)
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song a")

    const fresh = new RoomMusic()
    const broken = fresh.enqueue(ROOM, track("x", 60), alice)
    fresh.enqueue(ROOM, track("y", 60), alice)
    fresh.reportUnplayable(ROOM, broken.ok ? broken.data.entry.queueId : "")
    expect(fresh.snapshot(ROOM).canGoBack).toBe(false)
  })

  it("fails when there is nothing to go back to", () => {
    const music = new RoomMusic()
    expect(music.previous(ROOM).ok).toBe(false)
  })
})

describe("room likes", () => {
  it("tracks who liked a song and ignores repeated likes", () => {
    const music = new RoomMusic()
    const bob = { id: "p-bob", name: "Bob" }
    const id = track("a").id
    expect(music.setLike(ROOM, id, alice, true)).toBe(true)
    expect(music.setLike(ROOM, id, alice, true)).toBe(false)
    music.setLike(ROOM, id, bob, true)
    expect(music.snapshot(ROOM).likes[id]).toEqual([
      { playerId: "p-alice", name: "Alice" },
      { playerId: "p-bob", name: "Bob" },
    ])
    music.setLike(ROOM, id, alice, false)
    music.setLike(ROOM, id, bob, false)
    expect(music.snapshot(ROOM).likes[id]).toBeUndefined()
  })
})
