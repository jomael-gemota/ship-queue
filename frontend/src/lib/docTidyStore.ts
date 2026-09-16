import { useEffect, useState } from 'react'

/**
 * Tiny reactive counter: unread Doc Tidy messages.
 *
 * Lives outside React so the count survives when the user navigates between
 * the three Doc Tidy sub-pages (Messages, Rules, Vendors).
 *
 * DocTidy.tsx clears it on mount and increments it on SSE import events.
 * DocTidyTabs reads it via the useNewMessageCount hook.
 */
let _unread = 0
type Listener = () => void
const _listeners = new Set<Listener>()
const _notify = () => _listeners.forEach((fn) => fn())

export const newMessageStore = {
  get: (): number => _unread,
  add: (n: number): void => {
    _unread = Math.max(0, _unread + n)
    _notify()
  },
  clear: (): void => {
    if (_unread !== 0) {
      _unread = 0
      _notify()
    }
  },
  subscribe: (fn: Listener): (() => void) => {
    _listeners.add(fn)
    return () => _listeners.delete(fn)
  },
}

/** Reactive hook — returns the current unread count and re-renders on changes. */
export function useNewMessageCount(): number {
  const [count, setCount] = useState(newMessageStore.get)
  useEffect(() => newMessageStore.subscribe(() => setCount(newMessageStore.get())), [])
  return count
}
