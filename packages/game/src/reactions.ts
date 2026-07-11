export const AVATAR_REACTION_EMOJIS = [
  "😭",
  "😱",
  "😂",
  "🙌",
  "💀",
  "👀",
] as const

export type AvatarReactionEmoji = (typeof AVATAR_REACTION_EMOJIS)[number]
