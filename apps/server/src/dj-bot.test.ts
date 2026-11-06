import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DJ_BOT_ID,
  parseYouTubeVideoId,
  type CommandResult,
  type MusicTrack,
} from "@workspace/game"

import { MusicController, parseDjCommand } from "./dj-bot"
import { RoomManager } from "./room-manager"
import { RoomMusic } from "./room-music"
import { MusicSearchError, YouTubeService } from "./youtube"

function data<T>(result: CommandResult<T>): T {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data
}

function fakeTrack(id: string, title: string): MusicTrack {
  return {
    id,
    title,
    artist: "Artist",
    durationSec: 200,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  }
}

const SONGS: Record<string, MusicTrack> = {
  dQw4w9WgXcQ: fakeTrack("dQw4w9WgXcQ", "Never Gonna Give You Up"),
  kJQP7kiw5Fk: fakeTrack("kJQP7kiw5Fk", "Despacito"),
}

class FakeYouTube extends YouTubeService {
  searches: string[] = []
  failSearch: Error | null = null
  override async search(query: string): Promise<MusicTrack[]> {
    this.searches.push(query)
    if (this.failSearch) throw this.failSearch
    return Object.values(SONGS).filter((song) =>
      song.title.toLowerCase().includes(query.toLowerCase())
    )
  }
  override async resolveTrack(videoId: string) {
    return SONGS[videoId] ?? null
  }
}

function setup() {
  const rooms = new RoomManager()
  const created = data(
    rooms.createRoom({ playerName: "Alice", sessionId: "dj-a" })
  )
  const code = created.room.code
  const alice = created.player.id
  const bob = data(
    rooms.joinRoom({ code, playerName: "Bob", sessionId: "dj-b" })
  ).player.id
  rooms.registerConnection(code, alice, "socket-a")
  rooms.registerConnection(code, bob, "socket-b")
  const youtube = new FakeYouTube()
  const music = new RoomMusic({ searchAvailable: () => true })
  const emitMusic = vi.fn()
  const emitRoom = vi.fn()
  const controller = new MusicController({
    rooms,
    music,
    youtube,
    emitMusic,
    emitRoom,
  })

  async function say(
    playerId: string,
    body: string,
    mentionPlayerIds: string[] = []
  ) {
    const room = data(
      rooms.sendChatMessage(code, playerId, {
        kind: "text",
        body,
        mentionPlayerIds,
      })
    )
    vi.advanceTimersByTime(1_000)
    const sent = room.chatMessages.at(-1)!
    const handled = await controller.handleChatMessage(
      code,
      playerId,
      sent,
      room.players
    )
    return { handled, sent }
  }

  function lastBotMessage() {
    return data(rooms.getRoom(code))
      .chatMessages.filter((message) => message.playerId === DJ_BOT_ID)
      .at(-1)
  }

  return {
    rooms,
    code,
    alice,
    bob,
    youtube,
    music,
    controller,
    emitMusic,
    emitRoom,
    say,
    lastBotMessage,
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

describe("parseDjCommand", () => {
  it.each([
    [
      "@DJ play despacito",
      { type: "play", query: "despacito", playNext: false },
    ],
    ["@dj despacito", { type: "play", query: "despacito", playNext: false }],
    [
      "@DJ, next tum hi ho",
      { type: "play", query: "tum hi ho", playNext: true },
    ],
    ["@DJ next", { type: "skip" }],
    ["@DJ skip", { type: "skip" }],
    ["@DJ play", { type: "resume" }],
    ["@DJ pause", { type: "pause" }],
    ["@DJ stop", { type: "stop" }],
    ["@DJ queue", { type: "queue" }],
    ["@DJ np", { type: "now-playing" }],
    ["@DJ remove 2", { type: "remove", position: 2 }],
    ["@DJ", { type: "help" }],
  ])("reads %s", (body, expected) => {
    expect(parseDjCommand(body)).toEqual(expected)
  })

  it("ignores messages that are not addressed to the DJ", () => {
    expect(parseDjCommand("play despacito")).toBeNull()
    expect(parseDjCommand("hey @DJ play this")).toBeNull()
    expect(parseDjCommand("@DJane hi")).toBeNull()
  })

  it("treats @DJ as a player mention when a seated player is named DJ", () => {
    expect(parseDjCommand("@DJ nice play", [{ name: "dj" }])).toBeNull()
  })
})

describe("parseYouTubeVideoId", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "dQw4w9WgXcQ",
  ])("extracts the ID from %s", (input) => {
    expect(parseYouTubeVideoId(input)).toBe("dQw4w9WgXcQ")
  })

  it("rejects non-YouTube links", () => {
    expect(
      parseYouTubeVideoId("https://evil.example/watch?v=dQw4w9WgXcQ")
    ).toBeNull()
    expect(parseYouTubeVideoId("never gonna give you up")).toBeNull()
  })
})

describe("DJ chat commands", () => {
  it("queues songs from chat and announces where they landed", async () => {
    const { say, alice, bob, music, code, lastBotMessage, emitMusic } = setup()
    expect((await say(alice, "@DJ play despacito")).handled).toBe(true)
    expect(music.snapshot(code).nowPlaying).toMatchObject({
      title: "Despacito",
      requestedByName: "Alice",
    })
    const first = lastBotMessage()
    expect(first).toMatchObject({
      kind: "bot",
      playerName: "DJ",
      track: { id: "kJQP7kiw5Fk" },
    })
    expect(first?.body).toBe("Requested by Alice.")
    expect(emitMusic).toHaveBeenCalledWith(code)

    const { sent } = await say(bob, "@DJ https://youtu.be/dQw4w9WgXcQ")
    expect(music.snapshot(code).queue.map((entry) => entry.title)).toEqual([
      "Never Gonna Give You Up",
    ])
    expect(lastBotMessage()).toMatchObject({
      replyToMessageId: sent.id,
      body: "Queued at #1.",
    })
  })

  it("does not touch music for ordinary chat", async () => {
    const { say, alice, music, code, youtube } = setup()
    expect((await say(alice, "play despacito")).handled).toBe(false)
    expect(youtube.searches).toEqual([])
    expect(music.snapshot(code).status).toBe("idle")
  })

  it("explains when nothing matches or search is unavailable", async () => {
    const { say, alice, youtube, lastBotMessage } = setup()
    await say(alice, "@DJ play zzzz unknown song")
    expect(lastBotMessage()?.body).toContain("couldn't find")

    youtube.failSearch = new MusicSearchError(
      "search-unconfigured",
      "Song search needs YOUTUBE_API_KEY on the server. Paste a YouTube link instead."
    )
    await say(alice, "@DJ play despacito")
    expect(lastBotMessage()?.body).toContain("Paste a YouTube link")
  })

  it("pauses, skips, lists and removes from chat", async () => {
    const { say, alice, bob, music, code, lastBotMessage } = setup()
    await say(alice, "@DJ despacito")
    await say(bob, "@DJ dQw4w9WgXcQ")
    await say(alice, "@DJ despacito")

    await say(bob, "@DJ queue")
    expect(lastBotMessage()?.body).toContain("1. Never Gonna Give You Up")

    await say(alice, "@DJ pause")
    expect(music.snapshot(code).status).toBe("paused")
    await say(alice, "@DJ resume")
    expect(music.snapshot(code).status).toBe("playing")

    await say(bob, "@DJ remove 2")
    expect(music.snapshot(code).queue).toHaveLength(1)

    await say(bob, "@DJ skip")
    expect(music.snapshot(code).nowPlaying?.title).toBe(
      "Never Gonna Give You Up"
    )
    expect(lastBotMessage()).toMatchObject({
      skipped: { track: { id: "kJQP7kiw5Fk" } },
      track: { id: "dQw4w9WgXcQ" },
    })
    expect(lastBotMessage()?.skipped?.byName).toBeUndefined()
    expect(lastBotMessage()?.body).toContain("Skipped “Despacito”")
  })

  it("posts a skip from the library with both songs as cards", async () => {
    const { controller, alice, bob, code, lastBotMessage } = setup()
    await controller.enqueueVideo({ code, playerId: alice }, "kJQP7kiw5Fk")
    await controller.enqueueVideo({ code, playerId: alice }, "dQw4w9WgXcQ")
    data(controller.control({ code, playerId: bob }, "skip"))
    expect(lastBotMessage()).toMatchObject({
      skipped: { track: { id: "kJQP7kiw5Fk" }, byName: "Bob" },
      track: { id: "dQw4w9WgXcQ" },
    })

    data(controller.control({ code, playerId: bob }, "skip"))
    expect(lastBotMessage()?.skipped?.track.id).toBe("dQw4w9WgXcQ")
    expect(lastBotMessage()?.track).toBeUndefined()
  })

  it("rejects clients sending messages as the bot", () => {
    const { rooms, code, alice } = setup()
    const result = rooms.sendChatMessage(code, alice, {
      kind: "bot",
      body: "fake",
    })
    expect(result.ok).toBe(false)
  })
})

describe("library actions", () => {
  it("queues a song picked in the library and announces it in chat", async () => {
    const { controller, code, bob, lastBotMessage } = setup()
    const snapshot = data(
      await controller.enqueueVideo({ code, playerId: bob }, "dQw4w9WgXcQ")
    )
    expect(snapshot.nowPlaying?.requestedByName).toBe("Bob")
    expect(lastBotMessage()).toMatchObject({
      body: "Bob started the music.",
      track: { id: "dQw4w9WgXcQ" },
    })
  })

  it("plays a library pick right away when asked to play now", async () => {
    const { controller, code, bob, music } = setup()
    await controller.enqueueVideo({ code, playerId: bob }, "kJQP7kiw5Fk")
    const snapshot = data(
      await controller.enqueueVideo(
        { code, playerId: bob },
        "dQw4w9WgXcQ",
        "now"
      )
    )
    expect(snapshot.nowPlaying?.id).toBe("dQw4w9WgXcQ")
    expect(music.snapshot(code).queue).toEqual([])
  })

  it("refuses videos YouTube won't let us embed", async () => {
    const { controller, code, bob } = setup()
    const result = await controller.enqueueVideo(
      { code, playerId: bob },
      "zzzzzzzzzzz"
    )
    expect(!result.ok && result.error.code).toBe("music-unavailable")
  })

  it("refuses players who are not seated in the room", async () => {
    const { controller, code } = setup()
    const result = await controller.enqueueVideo(
      { code, playerId: "intruder" },
      "dQw4w9WgXcQ"
    )
    expect(!result.ok && result.error.code).toBe("not-joined")
  })
})
