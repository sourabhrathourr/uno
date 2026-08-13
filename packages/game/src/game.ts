import type { Card, CardColor } from "./cards"
import type { AvatarReactionEmoji } from "./reactions"
import type { HouseRules, Player } from "./rooms"

export type PlayColor = Exclude<CardColor, "wild">

export type Direction = 1 | -1

export type GameEventType =
  | "game-started"
  | "card-played"
  | "card-drawn"
  | "turn-passed"
  | "draw-stacked"
  | "draw-penalty"
  | "turn-skipped"
  | "direction-changed"
  | "color-changed"
  | "hand-swapped"
  | "hands-rotated"
  | "uno-called"
  | "uno-caught"
  | "player-eliminated"
  | "player-waiting"
  | "game-won"
  | "player-vote-kicked"
  | "support-started"
  | "support-ended"
  | "support-kicked"
  | "support-requested"
  | "support-request-declined"

export type GameEvent = {
  id: string
  type: GameEventType
  message: string
  playerId?: string
  targetPlayerId?: string
  cards?: Card[]
  cardCount?: number
  drawKind?: "single" | "penalty" | "roulette-reveal" | "roulette-complete"
  createdAt: string
}

export type WinnerPlacement = {
  playerId: string
  position: number
  createdAt: string
}

export type SupportEndReason =
  | "supported-player-inactive"
  | "supporter-kicked"
  | "match-finished"

export type SupportLink = {
  supporterPlayerId: string
  supportedPlayerId: string
  createdAt: string
}

export type SupportHistoryEntry = SupportLink & {
  endedAt: string | null
  endReason: SupportEndReason | null
}

export type SupportBlock = {
  supporterPlayerId: string
  supportedPlayerId: string
  createdAt: string
}

/**
 * A second-chance ask. The first support pick is unilateral, but once a
 * supported player has kicked someone, that person can only come back if the
 * supported player approves this request.
 */
export type SupportRequest = {
  supporterPlayerId: string
  supportedPlayerId: string
  createdAt: string
}

export type SendAvatarEmojiReactionInput = {
  body: AvatarReactionEmoji
}

export type AvatarEmojiReaction = SendAvatarEmojiReactionInput & {
  id: string
  playerId: string
  supportedPlayerId: string | null
  createdAt: string
}

export type SupportRecapTitle = {
  label: "Early Believer" | "Crowd Favorite"
  playerId: string
  description: string
}

export type SupportRecap = {
  journey: SupportHistoryEntry[]
  titles: SupportRecapTitle[]
}

export type DrawStack = {
  amount: number
  minimum: number
  targetPlayerId: string
}

export type PendingChoice = {
  type: "roulette-draw"
  playerId: string
  color: PlayColor
  drawnCards: Card[]
}

export type PlayerGamePublic = {
  playerId: string
  handCount: number
  declaredUno: boolean
  eliminated: boolean
  voteKicked: boolean
  waiting: boolean
  winnerPlacement: WinnerPlacement | null
  connected: boolean
  ready: boolean
}

export type PlayDecision = {
  chosenColor?: PlayColor
  declaredUno?: boolean
  rotateHands?: boolean
  swapWithPlayerId?: string
}

export type StagedPlayPublic = PlayDecision & {
  playerId: string
  kind: "play" | "roulette"
  cards: Card[]
}

export type StagedPlayState = PlayDecision & {
  playerId: string
  kind: "play" | "roulette"
  cardIds: string[]
}

export type PublicGameSnapshot = {
  matchId: string
  direction: Direction
  currentColor: PlayColor
  turnPlayerId: string | null
  topDiscard: Card | null
  drawPileCount: number
  discardPileCount: number
  drawStack: DrawStack | null
  pendingChoice: PendingChoice | null
  stagedPlay: StagedPlayPublic | null
  players: PlayerGamePublic[]
  events: GameEvent[]
  winnerPlacements: WinnerPlacement[]
  winnerPlayerId: string | null
  supportLinks: SupportLink[]
  avatarEmojiReactions: AvatarEmojiReaction[]
  supportRecap: SupportRecap | null
  /** Only present once the match is over. */
  matchRecap: MatchRecap | null
}

export type PlayerGameSnapshot = {
  playerId: string
  roomVersion?: number
  hand: Card[]
  playableCardIds: string[]
  catchablePlayerIds: string[]
  canDraw: boolean
  canEndTurn: boolean
  canTakeDrawPenalty: boolean
}

/**
 * Running tally for one player, kept as the match plays out.
 *
 * The public snapshot only carries the last handful of events, so anything
 * match-wide has to be counted as it happens rather than reconstructed at the
 * end. These are the numbers the end-of-match recap is built from.
 */
export type PlayerMatchStats = {
  playerId: string
  turnsTaken: number
  cardsPlayed: number
  /** Every card that entered the hand from the deck, however it got there. */
  cardsDrawn: number
  /** Cards taken specifically as a stacked draw penalty. */
  penaltyCardsTaken: number
  biggestPenaltyTaken: number
  /** Total draw a player pushed onto other people (+2, +4, +10 …). */
  drawCardsDealt: number
  skipsPlayed: number
  reversesPlayed: number
  wildsPlayed: number
  unosCalled: number
  /** Times this player caught someone who forgot to call UNO. */
  unoCatches: number
  /** Times this player was caught out. */
  timesCaught: number
  peakHandSize: number
}

export type MatchRecap = {
  /** Finish order first, then everyone who never got out. */
  players: PlayerMatchStats[]
  totalCardsPlayed: number
  totalCardsDrawn: number
  /** The largest draw stack that built up at any point in the match. */
  biggestDrawStack: number
  handsSwapped: number
  handsRotated: number
  startedAt: string
  finishedAt: string | null
}

export type GameState = {
  matchId: string
  startedAt: string
  finishedAt: string | null
  statsByPlayerId: Record<string, PlayerMatchStats>
  handsSwapped: number
  handsRotated: number
  biggestDrawStack: number
  playerOrder: string[]
  direction: Direction
  currentColor: PlayColor
  turnPlayerId: string | null
  drawPile: Card[]
  discardPile: Card[]
  handsByPlayerId: Record<string, Card[]>
  eliminatedPlayerIds: string[]
  voteKickedPlayerIds: string[]
  waitingPlayerIds: string[]
  knockedOutCards: Card[]
  drawStack: DrawStack | null
  pendingChoice: PendingChoice | null
  unoVulnerablePlayerIds: string[]
  unoDeclaredPlayerIds: string[]
  drawnThisTurnPlayerId: string | null
  stagedPlay: StagedPlayState | null
  winnerPlacements: WinnerPlacement[]
  winnerPlayerId: string | null
  supportLinks: SupportLink[]
  supportHistory: SupportHistoryEntry[]
  supportBlocks: SupportBlock[]
  supportRequests: SupportRequest[]
  avatarEmojiReactions: AvatarEmojiReaction[]
  events: GameEvent[]
}

export type PlayCardsInput = PlayDecision & {
  cardIds: string[]
  discardCardIds?: string[]
  topCardId?: string
}

export type StageCardsInput = PlayDecision & {
  cardIds: string[]
}

export type CatchUnoInput = {
  targetPlayerId: string
}

export type GameContext = {
  players: Player[]
  houseRules: HouseRules
}
