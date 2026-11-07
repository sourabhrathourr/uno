import { describe, expect, it, vi } from "vitest"
import { sanitizeWorldAvatarState, sanitizeWorldTempo } from "@workspace/game"

import { Lounge, TempoLookup, cleanSongTitle } from "./lounge"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("cleanSongTitle", () => {
  it("splits 'Artist - Song' and drops YouTube decoration", () => {
    expect(
      cleanSongTitle(
        "The Weeknd - Blinding Lights (Official Video) [4K]",
        "TheWeekndVEVO"
      )
    ).toEqual({ title: "Blinding Lights", artist: "The Weeknd" })
  })

  it("keeps the channel as artist for auto-generated topic channels", () => {
    expect(cleanSongTitle("Levitating", "Dua Lipa - Topic")).toEqual({
      title: "Levitating",
      artist: "Dua Lipa",
    })
  })

  it("drops featured artists and pipe suffixes", () => {
    expect(
      cleanSongTitle("Calm Down ft. Selena Gomez | Lyrics", "Rema")
    ).toEqual({ title: "Calm Down", artist: "Rema" })
  })
})

describe("TempoLookup", () => {
  it("returns the BPM of a matching catalogue track and caches it", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)
      if (href.includes("/search/track"))
        return jsonResponse({
          data: [
            {
              id: 1,
              title: "Blinding Lights (Remix)",
              title_short: "Something Else",
              artist: { name: "Nobody" },
            },
            {
              id: 2,
              title: "Blinding Lights",
              title_short: "Blinding Lights",
              artist: { name: "The Weeknd" },
            },
          ],
        })
      return jsonResponse({ id: 2, bpm: 170.84 })
    })
    const lookup = new TempoLookup({ fetcher })
    const track = {
      id: "4NRXx6U8ABQ",
      title: "The Weeknd - Blinding Lights (Official Video)",
      artist: "TheWeekndVEVO",
    }

    expect(await lookup.bpmFor(track)).toBe(170.84)
    expect(await lookup.bpmFor(track)).toBe(170.84)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1]![0])).toContain("/track/2")
  })

  it("returns null when nothing matches or the catalogue is unreachable", async () => {
    const empty = new TempoLookup({
      fetcher: async () => jsonResponse({ data: [], total: 30 }),
    })
    expect(
      await empty.bpmFor({ id: "aaaaaaaaaaa", title: "Song", artist: "A" })
    ).toBeNull()

    const failing = new TempoLookup({
      fetcher: async () => {
        throw new Error("offline")
      },
    })
    expect(
      await failing.bpmFor({ id: "bbbbbbbbbbb", title: "Song", artist: "A" })
    ).toBeNull()
  })

  it("stops looking up once the daily budget is spent", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [] }))
    const lookup = new TempoLookup({ fetcher, maxLookupsPerDay: 1 })
    await lookup.bpmFor({ id: "ccccccccccc", title: "One", artist: "" })
    await lookup.bpmFor({ id: "ddddddddddd", title: "Two", artist: "" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe("Lounge.tempoFor", () => {
  it("prefers a tapped tempo, then a lookup for the song now playing", async () => {
    const track = {
      id: "4NRXx6U8ABQ",
      title: "Blinding Lights",
      artist: "The Weeknd",
      durationSec: 200,
      thumbnailUrl: "",
    }
    const tempoLookup = new TempoLookup({
      fetcher: async (url) =>
        String(url).includes("/search/")
          ? jsonResponse({
              data: [
                {
                  id: 9,
                  title: "Blinding Lights",
                  artist: { name: "The Weeknd" },
                },
              ],
            })
          : jsonResponse({ bpm: 171 }),
    })
    const lounge = new Lounge({
      tempoLookup,
      nowPlaying: () => track,
      playerName: () => "Sam",
    })

    expect(await lounge.tempoFor("ROOM01", track.id)).toEqual({
      videoId: track.id,
      bpm: 171,
      offsetSec: 0,
      source: "lookup",
    })
    expect(await lounge.tempoFor("ROOM01", "zzzzzzzzzzz")).toBeNull()
  })
})

describe("world input sanitizing", () => {
  it("clamps positions and rejects non-numbers", () => {
    expect(
      sanitizeWorldAvatarState({
        x: 999,
        y: 1,
        z: -2,
        heading: 7,
        animation: "fly",
        dance: 12,
      })
    ).toMatchObject({ x: 15, y: 1, z: -2, animation: "idle", dance: 3 })
    expect(
      sanitizeWorldAvatarState({ x: Number.NaN, y: 0, z: 0, heading: 0 })
    ).toBeNull()
    expect(sanitizeWorldAvatarState("nope")).toBeNull()
  })

  it("accepts only sane tempos for real video ids", () => {
    expect(
      sanitizeWorldTempo({ videoId: "4NRXx6U8ABQ", bpm: 128, offsetSec: 1.5 })
    ).toEqual({ videoId: "4NRXx6U8ABQ", bpm: 128, offsetSec: 1.5 })
    expect(
      sanitizeWorldTempo({ videoId: "4NRXx6U8ABQ", bpm: 900, offsetSec: 0 })
    ).toBeNull()
    expect(
      sanitizeWorldTempo({ videoId: "bad", bpm: 120, offsetSec: 0 })
    ).toBeNull()
  })
})
