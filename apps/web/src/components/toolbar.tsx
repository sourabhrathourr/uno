import type { ReactNode } from "react"

/**
 * One shape for every header control: a borderless 36px circle that sits in a
 * shared pill. Pressing scales slightly; hover only where a pointer can hover.
 */
export const TOOLBAR_BUTTON =
  "relative inline-flex size-9 shrink-0 items-center justify-center rounded-full p-0 text-white/70 outline-none transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-white/45 disabled:opacity-50 [@media(hover:hover)]:hover:bg-white/[0.08] [@media(hover:hover)]:hover:text-white"

/** A toolbar control that is switched on (filter set, music playing...). */
export const TOOLBAR_BUTTON_ON = "bg-white/[0.1] text-white"

/** A toolbar control that is off or unavailable. */
export const TOOLBAR_BUTTON_OFF = "text-white/45"

export function ToolbarGroup({
  children,
  className = "",
  label = "Room controls",
}: {
  children: ReactNode
  className?: string
  label?: string
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={
        "flex shrink-0 items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.035] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.25)] " +
        className
      }
    >
      {children}
    </div>
  )
}

export function ToolbarDivider({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={"mx-1 h-4 w-px shrink-0 bg-white/10 " + className}
    />
  )
}
