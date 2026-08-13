import { describe, expect, it } from "vitest"

import { gifChatInput } from "./gif-picker"

describe("GIF picker", () => {
  it("sends a GIPHY result by its provider-approved ID", () => {
    expect(
      gifChatInput({
        provider: "giphy",
        id: "winner-123",
        title: "Victory dance",
        previewUrl: "https://media.giphy.com/preview.webp",
        mediaUrl: "https://media.giphy.com/original.webp",
        width: 480,
        height: 360,
      })
    ).toEqual({
      kind: "gif",
      body: "winner-123",
      gifProvider: "giphy",
    })
  })
})
