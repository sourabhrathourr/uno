import { useLayoutEffect, useRef, useState } from "react"

export function useReadingScroll(ids: string[]) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const nearBottom = useRef(true)
  const navigationTarget = useRef<number | null>(null)
  const previous = useRef<Set<string> | null>(null)
  const [unread, setUnread] = useState(0)
  const key = ids.join(":")
  function latest() {
    navigationTarget.current = null
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
    nearBottom.current = true
    setUnread(0)
  }
  useLayoutEffect(() => {
    const prior = previous.current
    const replaced =
      !prior || prior.size === 0 || !ids.some((id) => prior.has(id))
    const added = replaced ? 0 : ids.filter((id) => !prior.has(id)).length
    previous.current = new Set(ids)
    if (replaced || nearBottom.current) latest()
    else if (added) setUnread((count) => count + added)
  }, [key])
  function onScroll() {
    const list = listRef.current
    if (!list) return
    if (navigationTarget.current !== null) {
      if (Math.abs(list.scrollTop - navigationTarget.current) > 2) return
      navigationTarget.current = null
    }
    nearBottom.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < 48
    if (nearBottom.current) setUnread(0)
  }
  function reveal(message: HTMLElement) {
    const list = listRef.current
    if (!list?.contains(message)) return false
    // Mark this immediately: new arrivals during smooth scrolling must not
    // snap the reader back to the latest message.
    nearBottom.current = false
    const top =
      message.getBoundingClientRect().top -
      list.getBoundingClientRect().top +
      list.scrollTop -
      (list.clientHeight - message.clientHeight) / 2
    navigationTarget.current = Math.max(
      0,
      Math.min(top, list.scrollHeight - list.clientHeight)
    )
    list.scrollTo({
      top: navigationTarget.current,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    })
    message.focus({ preventScroll: true })
    return true
  }
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const stopNavigation = () => {
      navigationTarget.current = null
      onScroll()
    }
    list.addEventListener("scrollend", stopNavigation)
    list.addEventListener("wheel", stopNavigation, { passive: true })
    list.addEventListener("touchstart", stopNavigation, { passive: true })
    list.addEventListener("pointerdown", stopNavigation)
    list.addEventListener("keydown", stopNavigation)
    return () => {
      list.removeEventListener("scrollend", stopNavigation)
      list.removeEventListener("wheel", stopNavigation)
      list.removeEventListener("touchstart", stopNavigation)
      list.removeEventListener("pointerdown", stopNavigation)
      list.removeEventListener("keydown", stopNavigation)
    }
  }, [])
  return { listRef, onScroll, unread, latest, reveal }
}
