import { useLayoutEffect, useRef, useState } from "react"

export function useReadingScroll(ids: string[]) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const nearBottom = useRef(true)
  const previous = useRef<Set<string> | null>(null)
  const [unread, setUnread] = useState(0)
  const key = ids.join(":")
  function latest() {
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
    nearBottom.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < 48
    if (nearBottom.current) setUnread(0)
  }
  return { listRef, onScroll, unread, latest }
}
