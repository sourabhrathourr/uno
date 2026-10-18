import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

export function ShortcutGuide({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => previous?.focus()
  }, [])
  return createPortal(
    <div
      className="fixed inset-0 z-[150] grid place-items-center bg-black/65 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-guide-title"
        className="w-full max-w-sm rounded-2xl border border-white/20 bg-neutral-950 p-5 text-white shadow-2xl"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (
            event.key === "Escape" &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey
          ) {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
          if (event.key === "Tab") {
            event.preventDefault()
            close.current?.focus()
          }
        }}
      >
        <h2 id="shortcut-guide-title" className="font-semibold">
          Keyboard shortcuts
        </h2>
        <dl className="my-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt>← ↑ → ↓</dt>
          <dd>Navigate your hand</dd>
          <dt>Space</dt>
          <dd>Stage or unstage the focused card</dd>
          <dt>D</dt>
          <dd>Draw, or take the stacked penalty</dd>
          <dt>Enter</dt>
          <dd>Play your legal selection, or pass after drawing</dd>
          <dt>C</dt>
          <dd>Open and focus chat</dd>
          <dt>Escape</dt>
          <dd>Close the panel, then clear your selection</dd>
          <dt>?</dt>
          <dd>Open this guide</dd>
        </dl>
        <p className="mb-4 text-xs text-white/60">
          Game actions require your turn. Shortcuts pause while typing or using
          a dialog. Tab and Shift+Tab keep their normal focus navigation.
        </p>
        <button
          ref={close}
          type="button"
          onClick={onClose}
          className="rounded-lg bg-white px-3 py-2 text-sm text-black"
        >
          Close guide
        </button>
      </section>
    </div>,
    document.body
  )
}
