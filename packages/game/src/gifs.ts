export type GifProvider = "curated" | "giphy"

export type GifSearchResult = {
  provider: GifProvider
  id: string
  title: string
  previewUrl: string
  mediaUrl: string
  width: number
  height: number
}

export type GifSearchResponse = {
  results: GifSearchResult[]
  nextOffset: number | null
  source: GifProvider
}
