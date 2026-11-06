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
    const third = music.enqueue(ROOM, track("c"), alice, { playNext: true })

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

  it("stop clears the queue but keeps history and playlists", () => {
    const music = new RoomMusic()
    music.enqueue(ROOM, track("a"), alice)
    music.enqueue(ROOM, track("b"), alice)
    const playlist = music.createPlaylist(ROOM, "Bangers", alice)
    expect(playlist.ok).toBe(true)
    music.stop(ROOM)
    const snapshot = music.snapshot(ROOM)
    expect(snapshot).toMatchObject({ status: "idle", nowPlaying: null })
    expect(snapshot.queue).toEqual([])
    expect(snapshot.history).toHaveLength(1)
    expect(snapshot.playlists).toHaveLength(1)
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

describe("room playlists", () => {
  it("creates, fills, plays and deletes a shared playlist", () => {
    const music = new RoomMusic()
    const created = music.createPlaylist(ROOM, "  Late   night ", alice)
    if (!created.ok) throw new Error(created.error.message)
    expect(created.data.name).toBe("Late night")

    music.addToPlaylist(ROOM, created.data.id, track("a"))
    music.addToPlaylist(ROOM, created.data.id, track("b"))
    music.addToPlaylist(ROOM, created.data.id, track("a"))
    expect(music.findPlaylist(ROOM, created.data.id)?.tracks).toHaveLength(2)

    expect(music.findPlaylistByName(ROOM, "late")?.id).toBe(created.data.id)
    const playlist = music.findPlaylist(ROOM, created.data.id)!
    expect(music.enqueueMany(ROOM, playlist.tracks, alice)).toBe(2)
    expect(music.snapshot(ROOM).nowPlaying?.title).toBe("Song a")

    music.removeFromPlaylist(ROOM, created.data.id, track("a").id)
    expect(music.findPlaylist(ROOM, created.data.id)?.tracks).toHaveLength(1)
    expect(music.deletePlaylist(ROOM, created.data.id).ok).toBe(true)
    expect(music.snapshot(ROOM).playlists).toEqual([])
  })

  it("rejects blank and duplicate playlist names", () => {
    const music = new RoomMusic()
    expect(music.createPlaylist(ROOM, "   ", alice).ok).toBe(false)
    expect(music.createPlaylist(ROOM, "Mix", alice).ok).toBe(true)
    const duplicate = music.createPlaylist(ROOM, "mix", alice)
    expect(!duplicate.ok && duplicate.error.code).toBe("playlist-exists")
  })
})
