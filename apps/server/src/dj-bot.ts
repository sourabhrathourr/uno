import {
  DJ_BOT_NAME,
  formatTrackDuration,
  isYouTubeVideoId,
  parseYouTubeVideoId,
  type ChatMessage,
  type CommandResult,
  type MusicTrack,
  type Player,
  type QueuedTrack,
  type RoomMusicSnapshot,
  type RoomSnapshot,
} from "@workspace/game"

import type { RoomManager } from "./room-manager"
import type { EnqueueMode, RoomMusic } from "./room-music"
import { MusicSearchError, type YouTubeService } from "./youtube"

export type DjCommand =
  | { type: "help" }
  | { type: "play"; query: string; playNext: boolean }
  | { type: "resume" }
  | { type: "pause" }
  | { type: "skip" }
  | { type: "stop" }
  | { type: "clear" }
  | { type: "queue" }
  | { type: "now-playing" }
  | { type: "remove"; position: number }

const DJ_PREFIX = new RegExp(`^@${DJ_BOT_NAME}(?=$|[\\s,:])[\\s,:]*`, "i")

/**
 * Reads a chat message addressed to the DJ. Returns null when the message is
 * not for the DJ, including when it mentions a seated player named "DJ".
 */
export function parseDjCommand(
  body: string,
  mentionedPlayers: Pick<Player, "name">[] = []
): DjCommand | null {
  const trimmed = body.trim()
  if (!DJ_PREFIX.test(trimmed)) return null
  if (
    mentionedPlayers.some(
      (player) => player.name.toLowerCase() === DJ_BOT_NAME.toLowerCase()
    )
  )
    return null

  const rest = trimmed.replace(DJ_PREFIX, "").trim()
  if (!rest) return { type: "help" }
  const [rawVerb = "", ...words] = rest.split(/\s+/)
  const verb = rawVerb.toLowerCase()
  const args = words.join(" ").trim()

  switch (verb) {
    case "help":
    case "commands":
    case "?":
      return { type: "help" }
    case "play":
    case "p":
      return args
        ? { type: "play", query: args, playNext: false }
        : { type: "resume" }
    case "next":
    case "playnext":
      return args
        ? { type: "play", query: args, playNext: true }
        : { type: "skip" }
    case "resume":
    case "unpause":
    case "continue":
      return { type: "resume" }
    case "pause":
    case "hold":
      return { type: "pause" }
    case "skip":
    case "s":
      return { type: "skip" }
    case "stop":
      return { type: "stop" }
    case "clear":
      return { type: "clear" }
    case "queue":
    case "q":
    case "list":
    case "upnext":
      return { type: "queue" }
    case "np":
    case "now":
    case "song":
    case "playing":
    case "what":
      return { type: "now-playing" }
    case "remove":
    case "rm": {
      const position = Number.parseInt(args, 10)
      return Number.isInteger(position) && position > 0
        ? { type: "remove", position }
        : { type: "help" }
    }
    default:
      // "@DJ never gonna give you up" is a play request.
      return { type: "play", query: rest, playNext: false }
  }
}

export const DJ_HELP_TEXT = [
  "Tag me with a song and I'll play it for the whole room:",
  "• @DJ play <song or YouTube link>",
  "• @DJ next <song>: play it right after this one",
  "• @DJ pause / resume / skip / stop",
  "• @DJ queue · @DJ np · @DJ remove <#> · @DJ clear",
  "Open the music library (♪ button) to search, browse history, and like songs.",
].join("\n")

type MusicControllerOptions = {
  rooms: RoomManager
  music: RoomMusic
  youtube: YouTubeService
  emitMusic: (code: string) => void
  emitRoom: (code: string, room: RoomSnapshot) => void
}

type Actor = { code: string; playerId: string; sessionId?: string }

/**
 * Everything that changes room music goes through here, whether it came from
 * an `@DJ` chat command or a click in the library, so both paths validate,
 * broadcast, and announce the same way.
 */
export class MusicController {
  constructor(private readonly options: MusicControllerOptions) {}

  snapshot(code: string): RoomMusicSnapshot {
    return this.options.music.snapshot(code)
  }

  async search(query: string, sessionId: string): Promise<MusicTrack[]> {
    const videoId = parseYouTubeVideoId(query)
    if (videoId) {
      const track = await this.options.youtube.resolveTrack(videoId)
      return track ? [track] : []
    }
    return this.options.youtube.search(query, sessionId)
  }

  async enqueueVideo(
    actor: Actor,
    videoId: string,
    mode: EnqueueMode = "end"
  ): Promise<CommandResult<RoomMusicSnapshot>> {
    const requester = this.requester(actor)
    if (!requester) return notJoined()
    let track: MusicTrack | null
    try {
      track = await this.options.youtube.resolveTrack(videoId)
    } catch (cause) {
      return fail("music-lookup-failed", errorMessage(cause))
    }
    if (!track) {
      return fail(
        "music-unavailable",
        "That video can't be played here (removed, private, or embedding is off)."
      )
    }
    const result = this.options.music.enqueue(
      actor.code,
      track,
      requester,
      mode
    )
    if (!result.ok) return result
    this.announce(actor.code, announcement(requester.name, result.data), track)
    return this.changed(actor.code)
  }

  control(
    actor: Actor,
    action: "pause" | "resume" | "skip" | "stop"
  ): CommandResult<RoomMusicSnapshot> {
    const requester = this.requester(actor)
    if (!requester) return notJoined()
    const { music } = this.options
    switch (action) {
      case "pause": {
        const result = music.pause(actor.code)
        if (!result.ok) return result
        this.announce(actor.code, `${requester.name} paused the music.`)
        break
      }
      case "resume": {
        const result = music.resume(actor.code)
        if (!result.ok) return result
        this.announce(actor.code, `${requester.name} resumed the music.`)
        break
      }
      case "skip": {
        const result = music.skip(actor.code)
        if (!result.ok) return result
        const next = music.nowPlaying(actor.code)
        this.post(actor.code, {
          body: skipMessage(requester.name, result.data, next),
          track: next ?? undefined,
          skipped: { track: result.data, byName: requester.name },
        })
        break
      }
      case "stop": {
        const result = music.stop(actor.code)
        if (!result.ok) return result
        this.announce(
          actor.code,
          `${requester.name} stopped the music and cleared the queue.`
        )
        break
      }
      default:
        return fail("music-action", "Unknown music action.")
    }
    return this.changed(actor.code)
  }

  /** Scrubbing is silent: announcing every drag would flood the chat. */
  seek(actor: Actor, positionSec: number): CommandResult<RoomMusicSnapshot> {
    if (!this.requester(actor)) return notJoined()
    const result = this.options.music.seek(actor.code, positionSec)
    if (!result.ok) return result
    return this.changed(actor.code)
  }

  like(
    actor: Actor,
    videoId: string,
    liked: boolean
  ): CommandResult<RoomMusicSnapshot> {
    const requester = this.requester(actor)
    if (!requester) return notJoined()
    if (!isYouTubeVideoId(videoId))
      return fail("music-invalid", "Choose a song first.")
    if (this.options.music.setLike(actor.code, videoId, requester, liked))
      this.options.emitMusic(actor.code)
    return ok(this.options.music.snapshot(actor.code))
  }

  remove(actor: Actor, queueId: string): CommandResult<RoomMusicSnapshot> {
    if (!this.requester(actor)) return notJoined()
    const result = this.options.music.remove(actor.code, queueId)
    if (!result.ok) return result
    return this.changed(actor.code)
  }

  reportEnded(actor: Actor, queueId: string) {
    if (!this.requester(actor)) return
    if (this.options.music.reportEnded(actor.code, queueId))
      this.options.emitMusic(actor.code)
  }

  reportUnplayable(actor: Actor, queueId: string) {
    if (!this.requester(actor)) return
    const skipped = this.options.music.reportUnplayable(actor.code, queueId)
    if (!skipped) return
    this.announce(
      actor.code,
      `Couldn't play “${skipped.title}” (YouTube blocked it here), so I skipped it.`
    )
    this.options.emitMusic(actor.code)
  }

  /**
   * Runs an `@DJ` chat command. The player's own message is already in chat;
   * the DJ answers as a reply to it.
   */
  async handleChatMessage(
    code: string,
    playerId: string,
    message: ChatMessage,
    players: Player[]
  ): Promise<boolean> {
    const mentioned = players.filter((player) =>
      message.mentionPlayerIds.includes(player.id)
    )
    const command = parseDjCommand(message.body, mentioned)
    if (!command) return false
    const actor = { code, playerId }
    const reply = (
      body: string,
      track?: MusicTrack,
      skipped?: { track: MusicTrack }
    ) => this.post(code, { body, track, skipped, replyToMessageId: message.id })
    const requester = this.requester(actor)
    if (!requester) return true

    switch (command.type) {
      case "help":
        reply(DJ_HELP_TEXT)
        return true
      case "play": {
        let track: MusicTrack | null = null
        try {
          const videoId = parseYouTubeVideoId(command.query)
          track = videoId
            ? await this.options.youtube.resolveTrack(videoId)
            : ((
                await this.options.youtube.search(command.query, playerId)
              )[0] ?? null)
        } catch (cause) {
          reply(
            cause instanceof MusicSearchError
              ? cause.message
              : "YouTube didn't answer. Try again in a moment."
          )
          return true
        }
        if (!track) {
          reply(`I couldn't find anything playable for “${command.query}”.`)
          return true
        }
        const result = this.options.music.enqueue(
          code,
          track,
          requester,
          command.playNext ? "next" : "end"
        )
        if (!result.ok) {
          reply(result.error.message)
          return true
        }
        reply(
          result.data.placement === "playing"
            ? `Requested by ${requester.name}.`
            : `Queued at #${result.data.placement}${command.playNext ? " (up next)" : ""}.`,
          track
        )
        this.options.emitMusic(code)
        return true
      }
      case "pause":
      case "resume":
      case "skip":
      case "stop": {
        const result = this.controlQuietly(code, command.type)
        if (!result.ok) {
          reply(result.error.message)
          return true
        }
        reply(
          result.data.message,
          result.data.track ?? undefined,
          result.data.skipped ? { track: result.data.skipped } : undefined
        )
        this.options.emitMusic(code)
        return true
      }
      case "clear": {
        const removed = this.options.music.clearQueue(code)
        reply(
          removed
            ? `Cleared ${removed} song${removed === 1 ? "" : "s"} from the queue.`
            : "The queue is already empty."
        )
        if (removed) this.options.emitMusic(code)
        return true
      }
      case "queue":
        reply(queueSummary(this.options.music, code))
        return true
      case "now-playing": {
        const snapshot = this.options.music.snapshot(code)
        if (!snapshot.nowPlaying) {
          reply("Nothing is playing. Try “@DJ play <song>”.")
          return true
        }
        reply(
          `${snapshot.status === "paused" ? "Paused" : "Playing"} at ${formatTrackDuration(snapshot.positionSec)} / ${formatTrackDuration(snapshot.nowPlaying.durationSec)} (requested by ${snapshot.nowPlaying.requestedByName}).`,
          snapshot.nowPlaying
        )
        return true
      }
      case "remove": {
        const entry = this.options.music.queue(code)[command.position - 1]
        if (!entry) {
          reply(`There's no song #${command.position} in the queue.`)
          return true
        }
        this.options.music.remove(code, entry.queueId)
        reply(`Removed “${entry.title}” from the queue.`)
        this.options.emitMusic(code)
        return true
      }
    }
  }

  private controlQuietly(
    code: string,
    action: "pause" | "resume" | "skip" | "stop"
  ): CommandResult<{
    message: string
    track: QueuedTrack | null
    skipped?: QueuedTrack
  }> {
    const { music } = this.options
    if (action === "pause") {
      const result = music.pause(code)
      return result.ok ? ok({ message: "Paused.", track: null }) : result
    }
    if (action === "resume") {
      const result = music.resume(code)
      return result.ok
        ? ok({ message: "Back on.", track: music.nowPlaying(code) })
        : result
    }
    if (action === "skip") {
      const result = music.skip(code)
      if (!result.ok) return result
      const next = music.nowPlaying(code)
      // Web chat draws both songs as cards; the text is for the terminal.
      return ok({
        message: next
          ? `Skipped “${result.data.title}”. Up now: “${next.title}”.`
          : `Skipped “${result.data.title}”. The queue is empty.`,
        track: next,
        skipped: result.data,
      })
    }
    const result = music.stop(code)
    return result.ok
      ? ok({ message: "Stopped the music and cleared the queue.", track: null })
      : result
  }

  private announce(code: string, body: string, track?: MusicTrack) {
    this.post(code, { body, track })
  }

  private post(
    code: string,
    input: {
      body: string
      track?: MusicTrack
      skipped?: { track: MusicTrack; byName?: string }
      replyToMessageId?: string
    }
  ) {
    const result = this.options.rooms.postBotMessage(code, {
      ...input,
      track: input.track ? plainTrack(input.track) : undefined,
      skipped: input.skipped
        ? { ...input.skipped, track: plainTrack(input.skipped.track) }
        : undefined,
    })
    if (result.ok) this.options.emitRoom(code, result.data)
  }

  private changed(code: string): CommandResult<RoomMusicSnapshot> {
    this.options.emitMusic(code)
    return ok(this.options.music.snapshot(code))
  }

  private requester(actor: Actor): { id: string; name: string } | null {
    const name = this.options.rooms.getPlayerName(actor.code, actor.playerId)
    return name ? { id: actor.playerId, name } : null
  }
}

function announcement(
  name: string,
  outcome: { placement: "playing" | number }
): string {
  return outcome.placement === "playing"
    ? `${name} started the music.`
    : `${name} queued a song (#${outcome.placement}).`
}

function skipMessage(
  name: string,
  skipped: QueuedTrack,
  next: QueuedTrack | null
): string {
  return next
    ? `${name} skipped “${skipped.title}”. Up now: “${next.title}”.`
    : `${name} skipped “${skipped.title}”. The queue is empty.`
}

function queueSummary(music: RoomMusic, code: string): string {
  const snapshot = music.snapshot(code)
  if (!snapshot.nowPlaying) return "Nothing is playing and the queue is empty."
  const lines = [
    `${snapshot.status === "paused" ? "⏸" : "▶"} ${snapshot.nowPlaying.title} · ${snapshot.nowPlaying.artist}`,
  ]
  if (snapshot.queue.length === 0) lines.push("Nothing queued after this.")
  snapshot.queue.slice(0, 8).forEach((entry, index) => {
    lines.push(
      `${index + 1}. ${entry.title} · ${formatTrackDuration(entry.durationSec)} (${entry.requestedByName})`
    )
  })
  if (snapshot.queue.length > 8)
    lines.push(`…and ${snapshot.queue.length - 8} more`)
  return lines.join("\n")
}

function plainTrack(track: MusicTrack): MusicTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    durationSec: track.durationSec,
    thumbnailUrl: track.thumbnailUrl,
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof MusicSearchError
    ? cause.message
    : "YouTube didn't answer. Try again in a moment."
}

function notJoined<T>(): CommandResult<T> {
  return fail("not-joined", "Join the room first.")
}

function ok<T>(data: T): CommandResult<T> {
  return { ok: true, data }
}

function fail<T>(code: string, message: string): CommandResult<T> {
  return { ok: false, error: { code, message } }
}
