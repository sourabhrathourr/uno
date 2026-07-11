import type { GifProvider } from "./gifs"

export type ChatMessageKind = "text" | "emoji" | "gif" | "preset" | "vote-kick"
export type ChatChannel = "public" | "squad"
export type VoteKickChoice = "yes" | "no"
export type VoteKickStatus = "open" | "passed" | "failed"
export type VoteKickResult = "kicked" | "not-kicked"

export type SendChatMessageInput = {
  channel?: ChatChannel
  kind: ChatMessageKind
  body: string
  gifProvider?: GifProvider
  mentionPlayerIds?: string[]
}

export type ChatMessage = {
  id: string
  playerId: string
  playerName: string
  channel: ChatChannel
  squadPlayerId?: string
  matchId?: string
  kind: ChatMessageKind
  body: string
  mentionPlayerIds: string[]
  label?: string
  voteKick?: VoteKickPoll
  createdAt: string
}

export type VoteKickVote = {
  playerId: string
  choice: VoteKickChoice
  votedAt: string
}

export type VoteKickPoll = {
  id: string
  initiatorPlayerId: string
  initiatorPlayerName: string
  targetPlayerId: string
  targetPlayerName: string
  status: VoteKickStatus
  result: VoteKickResult | null
  eligibleVoterIds: string[]
  votes: VoteKickVote[]
  yesCount: number
  noCount: number
  createdAt: string
  closesAt: string
  resolvedAt: string | null
}

export type PlayerSocialSnapshot = {
  squadPlayerId: string | null
  squadChatMessages: ChatMessage[]
  blockedSupportedPlayerIds: string[]
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
