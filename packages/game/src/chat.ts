export type ChatMessageKind = "text" | "emoji" | "gif" | "preset"

export type SendChatMessageInput = {
  kind: ChatMessageKind
  body: string
}

export type ChatMessage = {
  id: string
  playerId: string
  playerName: string
  kind: ChatMessageKind
  body: string
  label?: string
  createdAt: string
}

export type ChatGifPreset = {
  label: string
  url: string
}

export const CHAT_EMOJIS = [
  "😂",
  "😈",
  "😭",
  "🔥",
  "👀",
  "💀",
  "🤝",
  "🚫",
  "🔁",
  "🏆",
  "😬",
  "🫡",
] as const

export const CHAT_PRESETS = [
  "No mercy.",
  "That was personal.",
  "Stack it if you dare.",
  "I am definitely not holding +10.",
  "Someone check the deck.",
  "UNO energy detected.",
  "This table is cursed.",
  "I forgive nothing.",
  "Reverse psychology.",
  "+10 is a lifestyle.",
  "Caught you slipping.",
  "I respect the chaos.",
] as const

export const CHAT_GIFS = [
  {
    label: "Applause",
    url: "https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif",
  },
  {
    label: "Waiting",
    url: "https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif",
  },
  {
    label: "Mind blown",
    url: "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif",
  },
  {
    label: "Laughing",
    url: "https://media.giphy.com/media/3oEjHI8WJv4x6UPDB6/giphy.gif",
  },
  {
    label: "No way",
    url: "https://media.giphy.com/media/12XDYvMJNcmLgQ/giphy.gif",
  },
  {
    label: "Nice",
    url: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
  },
] as const satisfies readonly ChatGifPreset[]
