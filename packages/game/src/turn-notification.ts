type TurnAlertInput = {
  previousTurnPlayerId: string | null
  turnPlayerId: string | null
  localPlayerId: string | undefined
}

export function shouldPlayTurnAlert({
  previousTurnPlayerId,
  turnPlayerId,
  localPlayerId,
}: TurnAlertInput): boolean {
  return (
    previousTurnPlayerId !== null &&
    previousTurnPlayerId !== turnPlayerId &&
    turnPlayerId === localPlayerId
  )
}
