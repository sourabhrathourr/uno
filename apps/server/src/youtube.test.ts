import { describe, expect, it, vi } from "vitest"

import { MusicSearchError, YouTubeService, parseIsoDuration } from "./youtube"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function youtubeFetcher() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/search")) {
      return json({
        items: [
          { id: { videoId: "kJQP7kiw5Fk" } },
          { id: { videoId: "blockedVid1" } },
        ],
      })
    }
    if (url.pathname.endsWith("/videos")) {
      const ids = url.searchParams.get("id")!.split(",")
      return json({
        items: ids.map((id) => ({
          id,
          snippet: {
            title: "Luis Fonsi - Despacito ft. Daddy Yankee &amp; friends",
            channelTitle: "Luis Fonsi - Topic",
          },
          contentDetails: { duration: "PT4M42S" },
          status: { embeddable: id !== "blockedVid1" },
        })),
      })
    }
    return json({}, 404)
  })
}

describe("parseIsoDuration", () => {
  it.each([
    ["PT4M13S", 253],
    ["PT1H2M3S", 3723],
    ["PT45S", 45],
    ["P1DT1S", 86401],
    ["P0D", null],
    ["nonsense", null],
    [undefined, null],
  ])("parses %s", (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected)
  })
})

describe("YouTubeService", () => {
  it("returns embeddable tracks with clean metadata and durations", async () => {
    const fetcher = youtubeFetcher()
    const youtube = new YouTubeService({ apiKey: "key", fetcher })
    const results = await youtube.search("despacito", "s1")
    expect(results).toEqual([
      {
        id: "kJQP7kiw5Fk",
        title: "Luis Fonsi - Despacito ft. Daddy Yankee & friends",
        artist: "Luis Fonsi",
        durationSec: 282,
        thumbnailUrl: "https://i.ytimg.com/vi/kJQP7kiw5Fk/mqdefault.jpg",
      },
    ])
    const searchUrl = new URL(String(fetcher.mock.calls[0]![0]))
    expect(searchUrl.searchParams.get("videoEmbeddable")).toBe("true")
  })

  it("caches searches and reuses looked-up tracks", async () => {
    const fetcher = youtubeFetcher()
    const youtube = new YouTubeService({ apiKey: "key", fetcher })
    await youtube.search("Despacito", "s1")
    await youtube.search("  despacito ", "s2")
    expect(fetcher).toHaveBeenCalledTimes(2)
    await youtube.resolveTrack("kJQP7kiw5Fk")
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await youtube.resolveTrack("blockedVid1")).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("enforces the per-player and daily search budgets", async () => {
    const youtube = new YouTubeService({
      apiKey: "key",
      fetcher: youtubeFetcher(),
      maxSearchesPerDay: 3,
      maxSearchesPerRequesterPerHour: 2,
    })
    await youtube.search("one", "s1")
    await youtube.search("two", "s1")
    await expect(youtube.search("three", "s1")).rejects.toMatchObject({
      code: "search-player-budget",
    })
    await youtube.search("four", "s2")
    await expect(youtube.search("five", "s3")).rejects.toMatchObject({
      code: "search-budget",
    })
  })

  it("explains that search needs a key, but still resolves links via oEmbed", async () => {
    const fetcher = vi.fn(async () =>
      json({ title: "Never Gonna Give You Up", author_name: "Rick Astley" })
    )
    const youtube = new YouTubeService({ fetcher })
    await expect(youtube.search("rick", "s1")).rejects.toBeInstanceOf(
      MusicSearchError
    )
    expect(await youtube.resolveTrack("dQw4w9WgXcQ")).toMatchObject({
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
      durationSec: null,
    })
  })

  it("treats oEmbed 401/404 as unplayable rather than an outage", async () => {
    const youtube = new YouTubeService({
      fetcher: vi.fn(async () => new Response("", { status: 401 })),
    })
    expect(await youtube.resolveTrack("dQw4w9WgXcQ")).toBeNull()
  })
})
