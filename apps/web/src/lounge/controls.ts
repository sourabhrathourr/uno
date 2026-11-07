/**
 * Input for the lounge, shared between the HTML overlay (joystick, buttons)
 * and the 3D scene, which reads it every frame. One lounge per page, so a
 * module singleton is enough.
 */
export const controls = {
  keys: new Set<string>(),
  /** Touch joystick, -1..1 on each axis; y is forward. */
  stick: { x: 0, y: 0 },
  /** Accumulated look drag in pixels; the camera consumes it each frame. */
  look: { x: 0, y: 0 },
  /** Pointer position over the view, -1..1, for a seated glance. */
  pointer: { x: 0, y: 0 },
  zoom: 0,
  jump: false,
  interact: false,
  dance: null as number | null,
  /** Keys only steer the avatar while this is true. */
  enabled: true,
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

const MOVEMENT_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "shift",
])

/**
 * Keyboard for walking around. `onKey` gets the other lounge keys (E, T,
 * Enter...) so the overlay can act on them. Returns a cleanup.
 */
export function installLoungeKeys(
  onKey: (key: string, event: KeyboardEvent) => void
) {
  const down = (event: KeyboardEvent) => {
    if (
      isEditableTarget(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return
    const key = event.key.toLowerCase()
    onKey(key, event)
    if (!controls.enabled) return
    if (MOVEMENT_KEYS.has(key)) {
      controls.keys.add(key)
      if (key.startsWith("arrow")) event.preventDefault()
    }
    if (key === " ") {
      event.preventDefault()
      controls.jump = true
    }
    if (/^[1-4]$/.test(key)) controls.dance = Number(key) - 1
  }
  const up = (event: KeyboardEvent) =>
    controls.keys.delete(event.key.toLowerCase())
  const blur = () => controls.keys.clear()
  window.addEventListener("keydown", down)
  window.addEventListener("keyup", up)
  window.addEventListener("blur", blur)
  return () => {
    window.removeEventListener("keydown", down)
    window.removeEventListener("keyup", up)
    window.removeEventListener("blur", blur)
    controls.keys.clear()
  }
}

/** Forward/right input from keys and the joystick, each -1..1. */
export function movementInput() {
  const keys = controls.keys
  let forward = controls.stick.y
  let right = controls.stick.x
  if (keys.has("w") || keys.has("arrowup")) forward += 1
  if (keys.has("s") || keys.has("arrowdown")) forward -= 1
  if (keys.has("d") || keys.has("arrowright")) right += 1
  if (keys.has("a") || keys.has("arrowleft")) right -= 1
  const length = Math.hypot(forward, right)
  if (length > 1) {
    forward /= length
    right /= length
  }
  const stickLength = Math.hypot(controls.stick.x, controls.stick.y)
  return {
    forward,
    right,
    run: keys.has("shift") || stickLength > 0.92,
  }
}
