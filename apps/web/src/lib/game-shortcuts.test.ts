import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { installGameShortcuts, type ShortcutState } from "./game-shortcuts"

let state: ShortcutState
let uninstall: () => void
beforeEach(() => {
  state = {
    enabled: true,
    pending: false,
    canDraw: false,
    canTakePenalty: false,
    canSubmit: false,
    canPass: false,
    draw: vi.fn(),
    takePenalty: vi.fn(),
    submit: vi.fn(),
    pass: vi.fn(),
    navigate: vi.fn(),
    toggleFocused: vi.fn(),
    focusChat: vi.fn(),
    showGuide: vi.fn(),
    escape: vi.fn(),
  }
  uninstall = installGameShortcuts(() => state)
})
afterEach(() => {
  uninstall()
  document.body.innerHTML = ""
})

function press(
  key: string,
  options: KeyboardEventInit = {},
  target: EventTarget = window
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  target.dispatchEvent(event)
  return event
}
function release(key: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { key }))
}
function noActions() {
  for (const action of [
    state.draw,
    state.takePenalty,
    state.submit,
    state.pass,
    state.navigate,
    state.toggleFocused,
    state.focusChat,
    state.showGuide,
    state.escape,
  ])
    if (action) expect(action).not.toHaveBeenCalled()
}

it("D chooses the legal draw action, with penalty acceptance taking priority", () => {
  expect(press("d").defaultPrevented).toBe(false)
  noActions()
  state.canDraw = true
  expect(press("D").defaultPrevented).toBe(true)
  expect(state.draw).toHaveBeenCalledOnce()
  release("d")
  state.canTakePenalty = true
  press("d")
  expect(state.takePenalty).toHaveBeenCalledOnce()
  expect(state.draw).toHaveBeenCalledOnce()
})

it("Enter submits an existing legal selection or passes only when permitted", () => {
  expect(press("Enter").defaultPrevented).toBe(false)
  noActions()
  state.canPass = true
  press("Enter")
  expect(state.pass).toHaveBeenCalledOnce()
  release("Enter")
  state.canSubmit = true
  press("Enter")
  expect(state.submit).toHaveBeenCalledOnce()
  expect(state.pass).toHaveBeenCalledOnce()
  expect(state.draw).not.toHaveBeenCalled()
})

it.each(["pending", "disabled"])("ignores shortcuts while %s", (mode) => {
  state.canDraw = state.canSubmit = true
  if (mode === "pending") state.pending = true
  else state.enabled = false
  expect(press("d").defaultPrevented).toBe(false)
  expect(press("Enter").defaultPrevented).toBe(false)
  noActions()
})

it("arrows navigate without selecting, and Space toggles only the focused card", () => {
  for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
    expect(press(key).defaultPrevented).toBe(true)
    release(key)
  }
  expect(state.navigate).toHaveBeenNthCalledWith(1, -1)
  expect(state.navigate).toHaveBeenNthCalledWith(2, -1)
  expect(state.navigate).toHaveBeenNthCalledWith(3, 1)
  expect(state.navigate).toHaveBeenNthCalledWith(4, 1)
  expect(state.toggleFocused).not.toHaveBeenCalled()
  expect(press(" ").defaultPrevented).toBe(true)
  expect(state.toggleFocused).toHaveBeenCalledOnce()
  expect(state.submit).not.toHaveBeenCalled()
})

it("C, shifted question mark and Escape invoke their explicit controls", () => {
  expect(press("c").defaultPrevented).toBe(true)
  expect(state.focusChat).toHaveBeenCalledOnce()
  expect(press("?", { shiftKey: true }).defaultPrevented).toBe(true)
  expect(state.showGuide).toHaveBeenCalledOnce()
  expect(press("Escape").defaultPrevented).toBe(true)
  expect(state.escape).toHaveBeenCalledOnce()
  expect(state.submit).not.toHaveBeenCalled()
})

it.each(["off-turn", "pending"])(
  "keeps navigation and panels available %s while blocking moves",
  (mode) => {
    state.scopeEnabled = true
    state.canDraw = state.canSubmit = state.canPass = true
    if (mode === "off-turn") state.enabled = false
    else state.pending = true
    for (const key of ["d", "Enter", " "])
      expect(press(key).defaultPrevented).toBe(false)
    for (const key of ["ArrowRight", "c", "?", "Escape"])
      expect(press(key).defaultPrevented).toBe(true)
    expect(state.navigate).toHaveBeenCalledWith(1)
    expect(state.focusChat).toHaveBeenCalledOnce()
    expect(state.showGuide).toHaveBeenCalledOnce()
    expect(state.escape).toHaveBeenCalledOnce()
    for (const action of [
      state.draw,
      state.submit,
      state.pass,
      state.toggleFocused,
    ])
      expect(action).not.toHaveBeenCalled()
  }
)

it("disables all controls outside the room shortcut scope", () => {
  state.scopeEnabled = false
  state.canDraw = state.canSubmit = true
  for (const key of ["d", "Enter", " ", "ArrowRight", "c", "?", "Escape"])
    expect(press(key).defaultPrevented).toBe(false)
  noActions()
})

it("allows focused hand buttons and nested card content to use shortcuts", () => {
  state.canSubmit = true
  const button = document.createElement("button")
  button.setAttribute("data-hand-card", "card-one")
  const content = document.createElement("span")
  button.append(content)
  document.body.append(button)
  button.focus()
  expect(press("ArrowRight", {}, content).defaultPrevented).toBe(true)
  expect(state.navigate).toHaveBeenCalledWith(1)
  expect(press(" ", {}, button).defaultPrevented).toBe(true)
  expect(state.toggleFocused).toHaveBeenCalledOnce()
  expect(press("Enter", {}, button).defaultPrevented).toBe(true)
  expect(state.submit).toHaveBeenCalledOnce()
})

it("leaves Tab and Shift+Tab untouched even on a focused hand card", () => {
  const button = document.createElement("button")
  button.setAttribute("data-hand-card", "card-one")
  document.body.append(button)
  button.focus()
  expect(press("Tab", {}, button).defaultPrevented).toBe(false)
  expect(press("Tab", { shiftKey: true }, button).defaultPrevented).toBe(false)
  noActions()
})

it.each([
  { ctrlKey: true },
  { metaKey: true },
  { altKey: true },
  { repeat: true },
  { isComposing: true },
  { keyCode: 229 },
])(
  "guards expanded controls against modified or composing input: %o",
  (options) => {
    for (const key of ["ArrowLeft", " ", "c", "?", "Escape"])
      press(key, options)
    noActions()
  }
)

it("blocks shifted controls except the question mark guide key", () => {
  for (const key of ["ArrowLeft", " ", "c", "Escape"])
    press(key, { shiftKey: true })
  noActions()
})

it.each([
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "summary",
  "[role=button]",
  "[contenteditable=true]",
])("does not steal keys from %s or its descendants", (selector) => {
  state.canDraw = state.canSubmit = true
  let element: HTMLElement
  if (selector === "a[href]") {
    element = document.createElement("a")
    element.setAttribute("href", "#")
  } else if (selector.startsWith("[")) {
    element = document.createElement("div")
    if (selector.includes("contenteditable"))
      element.setAttribute("contenteditable", "true")
    else element.setAttribute("role", "button")
  } else element = document.createElement(selector)
  document.body.append(element)
  expect(press("d", {}, element).defaultPrevented).toBe(false)
  if (!["input", "textarea", "select"].includes(selector)) {
    const nested = document.createElement("span")
    element.append(nested)
    press("Enter", {}, nested)
    for (const key of ["ArrowLeft", " ", "c", "?", "Escape"])
      press(key, {}, nested)
  } else press("Enter", {}, element)
  for (const key of ["ArrowRight", " ", "c", "?", "Escape"])
    press(key, {}, element)
  noActions()
})

it("leaves reading and navigation keys with a focused quoted message in chat", () => {
  state.canDraw = state.canSubmit = true
  const log = document.createElement("div")
  log.setAttribute("role", "log")
  const original = document.createElement("article")
  original.tabIndex = -1
  log.append(original)
  document.body.append(log)
  original.focus()
  for (const key of ["ArrowDown", "ArrowUp", " ", "Enter", "d", "c", "?"])
    expect(press(key, {}, original).defaultPrevented).toBe(false)
  noActions()
})

it("allows keys from ordinary non-editable content", () => {
  state.canDraw = true
  const element = document.createElement("div")
  element.setAttribute("contenteditable", "false")
  document.body.append(element)
  press("d", {}, element)
  expect(state.draw).toHaveBeenCalledOnce()
})

it.each([
  { isComposing: true },
  { keyCode: 229 },
  { repeat: true },
  { ctrlKey: true },
  { metaKey: true },
  { altKey: true },
  { shiftKey: true },
])("ignores IME, held repeats, and modified keys: %o", (options) => {
  state.canDraw = state.canSubmit = true
  press("d", options)
  press("Enter", options)
  noActions()
})

it("respects a prior handler's preventDefault", () => {
  state.canDraw = true
  const event = new KeyboardEvent("keydown", { key: "d", cancelable: true })
  event.preventDefault()
  window.dispatchEvent(event)
  noActions()
})

it.each(["native", "role", "modal"])(
  "suppresses keys while a %s dialog is open",
  (kind) => {
    state.canDraw = state.canSubmit = true
    const dialog = document.createElement(kind === "native" ? "dialog" : "div")
    if (kind === "native") dialog.setAttribute("open", "")
    if (kind === "role") dialog.setAttribute("role", "dialog")
    if (kind === "modal") dialog.setAttribute("aria-modal", "true")
    document.body.append(dialog)
    press("d")
    press("Enter")
    for (const key of ["ArrowRight", " ", "c", "?", "Escape"]) press(key)
    noActions()
    dialog.remove()
    press("d")
    expect(state.draw).toHaveBeenCalledOnce()
  }
)

it("ignores a hidden role dialog", () => {
  state.canDraw = true
  document.body.innerHTML = '<div role="dialog" aria-hidden="true"></div>'
  press("d")
  expect(state.draw).toHaveBeenCalledOnce()
})

it("uses current legality and suppresses held keys until keyup or window blur", () => {
  state.canDraw = true
  press("d")
  press("D")
  expect(state.draw).toHaveBeenCalledOnce()
  release("D")
  state.canTakePenalty = true
  press("d")
  expect(state.takePenalty).toHaveBeenCalledOnce()
  window.dispatchEvent(new Event("blur"))
  press("d")
  expect(state.takePenalty).toHaveBeenCalledTimes(2)
})

it("removes listeners and held-key state when detached", () => {
  state.canDraw = true
  press("d")
  uninstall()
  release("d")
  press("d")
  expect(state.draw).toHaveBeenCalledOnce()
  uninstall = installGameShortcuts(() => state)
  press("d")
  expect(state.draw).toHaveBeenCalledTimes(2)
})
