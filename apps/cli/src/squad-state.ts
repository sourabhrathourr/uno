import type {
  PlayerGamePublic,
  PlayerSocialSnapshot,
  RoomSnapshot,
} from "@workspace/game"

export function isActive(player: PlayerGamePublic | undefined) {
  return Boolean(
    player &&
    !player.eliminated &&
    !player.voteKicked &&
    !player.waiting &&
    !player.winnerPlacement
  )
}

/** Private squad history never enters the public room or the CLI's own hand. */
export class SquadState {
  watching = false
  readonly mentions = new Set<string>()
  private room: RoomSnapshot | null = null
  private selfId: string | null = null
  private key = ""
  private social: PlayerSocialSnapshot | null = null
  private seen: Set<string> | null = null

  constructor(private readonly notice: (value: unknown) => void) {}

  reset() {
    this.room = null
    this.selfId = null
    this.key = ""
    this.social = null
    this.seen = null
    this.mentions.clear()
  }

  update(room: RoomSnapshot, selfId: string) {
    const own = room.game?.players.find((player) => player.playerId === selfId)
    const squad =
      room.game?.supportLinks.find((link) => link.supporterPlayerId === selfId)
        ?.supportedPlayerId ?? (isActive(own) ? selfId : null)
    const key = `${room.code}:${room.game?.matchId ?? ""}:${selfId}:${squad ?? ""}:${room.status}`
    if (key !== this.key) this.reset()
    this.room = room
    this.selfId = selfId
    this.key = key
  }

  apply(snapshot: PlayerSocialSnapshot) {
    const game = this.room?.game
    if (!game || !this.selfId || this.room?.status !== "playing") return
    const own = game.players.find((player) => player.playerId === this.selfId)
    const permitted =
      game.supportLinks.find((link) => link.supporterPlayerId === this.selfId)
        ?.supportedPlayerId ?? (isActive(own) ? this.selfId : null)
    if (snapshot.squadPlayerId !== null && snapshot.squadPlayerId !== permitted)
      return
    // Social packets have no version envelope. Scope every message to the current
    // match and public membership; reject foreign/previous-match packets entirely.
    if (
      snapshot.squadChatMessages.some(
        (message) =>
          message.channel !== "squad" ||
          message.matchId !== game.matchId ||
          message.squadPlayerId !== snapshot.squadPlayerId
      )
    )
      return
    if (this.social?.squadPlayerId !== snapshot.squadPlayerId) {
      this.seen = null
      this.mentions.clear()
    }
    this.social = structuredClone(snapshot)
    const messages = this.social.squadChatMessages
    if (this.seen === null) {
      this.seen = new Set(messages.map((message) => message.id))
      return
    }
    for (const message of messages) {
      if (this.seen.has(message.id)) continue
      const mentioned =
        message.playerId !== this.selfId &&
        message.mentionPlayerIds.includes(this.selfId)
      if (mentioned) this.mentions.add(message.id)
      if (this.watching)
        this.notice({
          type: "chat-message",
          channel: "squad",
          message: structuredClone(message),
          mentioned,
        })
    }
    this.seen = new Set(messages.map((message) => message.id))
    for (const id of this.mentions)
      if (!this.seen.has(id)) this.mentions.delete(id)
  }

  read(afterMessageId?: string, limit = 100) {
    const all = this.social?.squadChatMessages ?? []
    const index = afterMessageId
      ? all.findIndex((message) => message.id === afterMessageId)
      : -1
    const messages = (
      afterMessageId && index >= 0 ? all.slice(index + 1) : all
    ).slice(0, limit)
    for (const message of messages) this.mentions.delete(message.id)
    return structuredClone({
      messages,
      gap: Boolean(afterMessageId && index < 0),
      nextMessageId: messages.at(-1)?.id ?? afterMessageId ?? null,
    })
  }

  target() {
    const game = this.room?.game
    const self = game?.players.find((player) => player.playerId === this.selfId)
    const target = game?.supportLinks.find(
      (link) => link.supporterPlayerId === this.selfId
    )?.supportedPlayerId
    if (
      this.room?.status !== "playing" ||
      !self ||
      isActive(self) ||
      game?.lastGift?.playerId === this.selfId ||
      !target ||
      !isActive(game?.players.find((player) => player.playerId === target))
    )
      return null
    return target
  }

  summary() {
    const game = this.room?.game
    const self = game?.players.find((player) => player.playerId === this.selfId)
    const linked =
      game?.supportLinks.find((link) => link.supporterPlayerId === this.selfId)
        ?.supportedPlayerId ?? null
    return structuredClone({
      squadPlayerId: this.social?.squadPlayerId ?? null,
      supportingPlayerId: linked,
      canReadSupportView: this.target() !== null,
      incomingSupportRequests: this.social?.incomingSupportRequests ?? [],
      outgoingSupportRequest: this.social?.outgoingSupportRequest ?? null,
      candidates:
        this.room?.status === "playing" &&
        self &&
        !isActive(self) &&
        !linked &&
        game?.lastGift?.playerId !== this.selfId
          ? (game?.players
              .filter(
                (player) => isActive(player) && player.playerId !== this.selfId
              )
              .map((player) => ({
                playerId: player.playerId,
                needsApproval:
                  this.social?.blockedSupportedPlayerIds.includes(
                    player.playerId
                  ) ?? false,
              })) ?? [])
          : [],
    })
  }

  chatStatus() {
    return {
      watching: this.watching,
      available: Boolean(this.social?.squadPlayerId),
      pendingMentionIds: [...this.mentions],
    }
  }
}
