import type { Card, CardColor } from "./cards"
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
  | "game-won"

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

export type DrawStack = {
  amount: number
  minimum: number
  targetPlayerId: string
}

export type PendingChoice =
  | {
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
  winnerPlacement: WinnerPlacement | null
  connected: boolean
  ready: boolean
}

export type StagedPlayPublic = {
  playerId: string
  kind: "play" | "roulette"
  cards: Card[]
}

export type StagedPlayState = {
  playerId: string
  kind: "play" | "roulette"
  cardIds: string[]
}

export type PublicGameSnapshot = {
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
}

export type PlayerGameSnapshot = {
  playerId: string
  hand: Card[]
  playableCardIds: string[]
  catchablePlayerIds: string[]
  canDraw: boolean
  canEndTurn: boolean
  canTakeDrawPenalty: boolean
}

export type GameState = {
  playerOrder: string[]
  direction: Direction
  currentColor: PlayColor
  turnPlayerId: string | null
  drawPile: Card[]
  discardPile: Card[]
  handsByPlayerId: Record<string, Card[]>
  eliminatedPlayerIds: string[]
  knockedOutCards: Card[]
  drawStack: DrawStack | null
  pendingChoice: PendingChoice | null
  unoVulnerablePlayerIds: string[]
  unoDeclaredPlayerIds: string[]
  drawnThisTurnPlayerId: string | null
  stagedPlay: StagedPlayState | null
  winnerPlacements: WinnerPlacement[]
  winnerPlayerId: string | null
  events: GameEvent[]
}

export type PlayCardsInput = {
  cardIds: string[]
  declaredUno?: boolean
  chosenColor?: PlayColor
  discardCardIds?: string[]
  topCardId?: string
  swapWithPlayerId?: string
  rotateHands?: boolean
}

export type StageCardsInput = {
  cardIds: string[]
}

export type CatchUnoInput = {
  targetPlayerId: string
}

export type GameContext = {
  players: Player[]
  houseRules: HouseRules
}
