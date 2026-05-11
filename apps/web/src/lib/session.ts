const PLAYER_SESSION_KEY = "uno-no-mercy:player-session-id"
const PLAYER_NAME_KEY = "uno-no-mercy:player-name"
const ACTIVE_ROOM_KEY = "uno-no-mercy:active-room-code"

export function getPlayerSessionId(): string {
  if (typeof window === "undefined") return "server"

  const existing = window.localStorage.getItem(PLAYER_SESSION_KEY)
  if (existing) return existing

  const next = window.crypto.randomUUID()
  window.localStorage.setItem(PLAYER_SESSION_KEY, next)
  return next
}

export function getSavedPlayerName(): string {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(PLAYER_NAME_KEY) ?? ""
}

export function savePlayerName(name: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(PLAYER_NAME_KEY, name)
}

export function getActiveRoomCode(): string {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(ACTIVE_ROOM_KEY) ?? ""
}

export function saveActiveRoomCode(code: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ACTIVE_ROOM_KEY, code.toUpperCase())
}
