export type ShortcutState = {
  enabled: boolean
  scopeEnabled?: boolean
  navigate?: (direction: -1 | 1) => void
  toggleFocused?: () => void
  focusChat?: () => void
  showGuide?: () => void
  escape?: () => void
  pending: boolean
  canDraw: boolean
  canTakePenalty: boolean
  canSubmit: boolean
  canPass: boolean
  draw: () => void
  takePenalty: () => void
  submit: () => void
  pass: () => void
}

/** Keyboard and buttons share the same legal actions; no implicit selection. */
export function installGameShortcuts(
  getState: () => ShortcutState,
  target: Window = window
) {
  const held = new Set<string>()
  const keyup = (event: KeyboardEvent) => held.delete(event.key.toLowerCase())
  const blur = () => held.clear()
  const keydown = (event: KeyboardEvent) => {
    const state = getState()
    const key = event.key.toLowerCase()
    if (
      !(state.scopeEnabled ?? state.enabled) ||
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.shiftKey && key !== "?") ||
      held.has(key)
    )
      return
    const node = event.composedPath()[0]
    const handCard =
      node instanceof Element ? node.closest("[data-hand-card]") : null
    if (
      !handCard &&
      node instanceof Element &&
      node.closest(
        'input,textarea,select,button,a[href],summary,[role="button"],[role="log"],[contenteditable]:not([contenteditable="false"])'
      )
    )
      return
    const modal = target.document.querySelector(
      'dialog[open],[role="dialog"]:not([aria-hidden="true"]),[aria-modal="true"]'
    )
    if (modal) return
    let action: (() => void) | undefined
    if (key === "arrowleft" || key === "arrowup")
      action = state.navigate ? () => state.navigate!(-1) : undefined
    if (key === "arrowright" || key === "arrowdown")
      action = state.navigate ? () => state.navigate!(1) : undefined
    if (key === "c") action = state.focusChat
    if (key === "?") action = state.showGuide
    if (key === "escape") action = state.escape
    if (key === " " && state.enabled && !state.pending)
      action = state.toggleFocused
    if (key === "d" && state.enabled && !state.pending)
      action = state.canTakePenalty
        ? state.takePenalty
        : state.canDraw
          ? state.draw
          : undefined
    if (key === "enter" && state.enabled && !state.pending)
      action = state.canSubmit
        ? state.submit
        : state.canPass
          ? state.pass
          : undefined
    if (!action) return
    event.preventDefault()
    held.add(key)
    action()
  }
  target.addEventListener("keydown", keydown)
  target.addEventListener("keyup", keyup)
  target.addEventListener("blur", blur)
  return () => {
    target.removeEventListener("keydown", keydown)
    target.removeEventListener("keyup", keyup)
    target.removeEventListener("blur", blur)
  }
}
