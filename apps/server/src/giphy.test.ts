import { describe, expect, it, vi } from "vitest"

import { GiphyService } from "./giphy"

describe("GiphyService", () => {
  it("normalizes search results and approves returned GIFs for chat", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        data: [
          {
            id: "winner-123",
            title: "Victory dance",
            images: {
              fixed_width_small: {
                webp: "https://media.giphy.com/preview.webp",
                width: "100",
                height: "75",
              },
              original: {
                webp: "https://media.giphy.com/original.webp",
                width: "480",
                height: "360",
              },
            },
          },
        ],
        pagination: { count: 1, offset: 0, total_count: 1 },
        meta: { status: 200 },
      })
    )
    const service = new GiphyService({
      apiKey: "test-key",
      fetcher,
    })

    const response = await service.search({ query: "victory", offset: 0 })

    expect(response).toEqual({
      results: [
        {
          provider: "giphy",
          id: "winner-123",
          title: "Victory dance",
          previewUrl: "https://media.giphy.com/preview.webp",
          mediaUrl: "https://media.giphy.com/original.webp",
          width: 480,
          height: 360,
        },
      ],
      nextOffset: null,
      source: "giphy",
    })
    expect(service.resolveApprovedGif("winner-123")).toEqual({
      body: "https://media.giphy.com/original.webp",
      label: "Victory dance",
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/v1/gifs/search?")
  })

  it("caps uncached upstream searches to protect the API key", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        data: [],
        pagination: { count: 0, offset: 0, total_count: 0 },
        meta: { status: 200 },
      })
    )
    const service = new GiphyService({
      apiKey: "test-key",
      fetcher,
      maxRequestsPerHour: 1,
    })

    await service.search({ query: "victory", offset: 0 })

    await expect(
      service.search({ query: "defeat", offset: 0 })
    ).rejects.toThrow("request budget")
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it("limits uncached upstream searches per player session", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        data: [],
        pagination: { count: 0, offset: 0, total_count: 0 },
        meta: { status: 200 },
      })
    )
    const service = new GiphyService({
      apiKey: "test-key",
      fetcher,
      maxRequestsPerHour: 10,
      maxRequestsPerRequesterPerHour: 1,
    })

    await service.search({ query: "victory", offset: 0, requesterId: "a" })
    await expect(
      service.search({ query: "defeat", offset: 0, requesterId: "a" })
    ).rejects.toThrow("player request budget")
    await service.search({ query: "applause", offset: 0, requesterId: "b" })

    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("stops pagination before GIPHY's maximum search offset", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        data: [],
        pagination: { count: 20, offset: 4_990, total_count: 10_000 },
        meta: { status: 200 },
      })
    )
    const service = new GiphyService({ apiKey: "test-key", fetcher })

    const response = await service.search({ query: "victory", offset: 4_990 })

    expect(response.nextOffset).toBeNull()
  })

  it("stops pagination when GIPHY returns an empty page", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        data: [],
        pagination: { count: 0, offset: 40, total_count: 100 },
        meta: { status: 200 },
      })
    )
    const service = new GiphyService({ apiKey: "test-key", fetcher })

    const response = await service.search({ query: "victory", offset: 40 })

    expect(response.nextOffset).toBeNull()
  })

  it("falls back to the curated catalog when no API key is configured", async () => {
    const service = new GiphyService()

    const response = await service.search({ query: "applause", offset: 0 })

    expect(response.source).toBe("curated")
    expect(response.results).toHaveLength(1)
    expect(response.results[0]).toMatchObject({
      provider: "curated",
      title: "Applause",
    })
  })
})
