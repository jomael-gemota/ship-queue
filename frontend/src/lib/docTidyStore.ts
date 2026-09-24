import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { authApi } from './api'
import type { DocTidyEvent } from '../types/docTidy'

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

/* ────────────────────────────────── shared Doc Tidy event stream ── */

interface Subscriber {
  onEvent: (event: DocTidyEvent) => void
  onError?: (error: unknown) => void
}

const _subscribers = new Set<Subscriber>()
let _closeStream: (() => void) | null = null
let _streamRefs = 0

/**
 * Holds `/doc-tidy/stream` open for as long as the returned release is not
 * called, over a single shared connection.
 *
 * Separate from `subscribeDocTidyEvents` because the progress chips need the
 * connection but not the fan-out — a table can render hundreds of them, and
 * they would otherwise each pay for every event the page receives.
 *
 * The sharing itself is the point: each component opening its own stream is
 * what exhausted the browser's six-connection budget during a large batch,
 * starving every other request the page made, including the reasoning panel's.
 * See design-log/2026-09-25-parse-progress-multiplexing.md.
 */
export function retainDocTidyStream(): () => void {
  _streamRefs += 1

  if (!_closeStream) {
    _closeStream = authApi.eventStream<DocTidyEvent>(
      '/doc-tidy/stream',
      (event) => {
        // Applied before fan-out so a listener reading the store during this
        // tick sees the new value rather than the previous one.
        if (event.type === 'parse_progress') applyProgress(event)
        // Copied: a listener may unsubscribe while the set is being walked.
        for (const current of [..._subscribers]) current.onEvent(event)
      },
      (error) => {
        for (const current of [..._subscribers]) current.onError?.(error)
      }
    )
  }

  let released = false
  return () => {
    if (released) return
    released = true
    _streamRefs -= 1
    if (_streamRefs === 0) {
      _closeStream?.()
      _closeStream = null
    }
  }
}

/** Receives every event on the shared stream until the returned function is called. */
export function subscribeDocTidyEvents(
  onEvent: (event: DocTidyEvent) => void,
  onError?: (error: unknown) => void
): () => void {
  const subscriber: Subscriber = { onEvent, onError }
  _subscribers.add(subscriber)
  const release = retainDocTidyStream()

  return () => {
    _subscribers.delete(subscriber)
    release()
  }
}

/* ──────────────────────────────────────── live parse progress ── */

export interface ParseProgress {
  /** Which reasoning step the job is on, matching the panel's numbering. */
  step: number
  /** A few words describing the current step. */
  snippet: string
}

const _progress = new Map<string, ParseProgress>()
const _progressListeners = new Map<string, Set<Listener>>()

function applyProgress(event: DocTidyEvent): void {
  const jobId = event.parseJobId
  if (!jobId) return

  _progress.set(jobId, { step: event.step ?? 1, snippet: event.snippet ?? '' })
  _progressListeners.get(jobId)?.forEach((fn) => fn())
}

function subscribeProgress(jobId: string, notify: Listener): () => void {
  let listeners = _progressListeners.get(jobId)
  if (!listeners) {
    listeners = new Set<Listener>()
    _progressListeners.set(jobId, listeners)
  }
  listeners.add(notify)

  return () => {
    listeners.delete(notify)
    if (listeners.size === 0) {
      _progressListeners.delete(jobId)
      // Nothing is displaying this job any more, so its last snippet is dead
      // weight; a re-mount just waits for the next event.
      _progress.delete(jobId)
    }
  }
}

/**
 * Live step and snippet for one running job.
 *
 * Listeners are keyed by job id so a token on one document re-renders that
 * document's chip rather than every row in the table.
 */
export function useParseProgress(jobId: string): ParseProgress | null {
  // Holding the shared stream here means a chip works on any page, without that
  // page having to know it needs one open.
  useEffect(() => retainDocTidyStream(), [])

  return useSyncExternalStore(
    useCallback((notify: Listener) => subscribeProgress(jobId, notify), [jobId]),
    useCallback(() => _progress.get(jobId) ?? null, [jobId])
  )
}
