import { useEffect, useRef, useState } from 'react'
import { authApi } from '../lib/api'
import type { ParseJobStatus, ParseStreamEvent, TableOutput } from '../types/docTidy'

export interface ParseJobStreamState {
  /** The agent's transcript so far, replayed from storage then appended live. */
  thinking: string
  /** Raw model output before it parses as JSON; useful while it is still arriving. */
  output: string
  json: Record<string, unknown> | null
  table: TableOutput | null
  status: ParseJobStatus | 'idle'
  error: string | null
  /** False once the run has finished, so the caller can stop animating. */
  live: boolean
}

const IDLE: ParseJobStreamState = {
  thinking: '',
  output: '',
  json: null,
  table: null,
  status: 'idle',
  error: null,
  live: false,
}

const CONNECTING: ParseJobStreamState = { ...IDLE, status: 'pending', live: true }

/** The state, plus which subscription produced it. */
type Tracked = ParseJobStreamState & { key: string }

/**
 * Follows one parse job's reasoning stream.
 *
 * The server replays whatever it has stored before attaching the connection, so
 * this yields the same transcript whether the job is running, was opened mid-run,
 * or finished last week — the caller does not have to distinguish the cases.
 *
 * Built on `authApi.eventStream` rather than `EventSource` because the endpoint
 * needs an `Authorization` header. That helper reconnects on any stream end,
 * which is right for the always-on table stream and wrong here, so the closer is
 * invoked as soon as a terminal event arrives.
 *
 * `epoch` is bumped by the caller to re-subscribe to the same job after a re-run,
 * which the job id alone cannot express.
 */
export function useParseJobStream(jobId: string | null, epoch = 0): ParseJobStreamState {
  const key = jobId ? `${jobId}:${epoch}` : ''
  const [tracked, setTracked] = useState<Tracked>({ ...IDLE, key: '' })
  const closeRef = useRef<(() => void) | null>(null)

  // Switching jobs resets during render rather than in an effect: state left over
  // from the previous job must never be painted, not even for one frame.
  const state: ParseJobStreamState =
    tracked.key === key ? tracked : jobId ? CONNECTING : IDLE

  useEffect(() => {
    if (!jobId) return

    // Every write re-bases onto the current subscription, so a late event from
    // the previous job cannot resurrect its transcript under the new one.
    const update = (
      change: (previous: ParseJobStreamState) => Partial<ParseJobStreamState>
    ) => {
      setTracked((previous) => {
        const base: ParseJobStreamState =
          previous.key === key ? previous : CONNECTING
        return { ...base, ...change(base), key }
      })
    }

    const finish = () => {
      closeRef.current?.()
      closeRef.current = null
    }

    const close = authApi.eventStream<ParseStreamEvent>(
      `/doc-tidy/parse-jobs/${jobId}/stream`,
      (event) => {
        switch (event.type) {
          case 'connected':
          case 'status':
            update((s) => ({ status: event.status ?? s.status }))
            break
          case 'thinking':
            update((s) => ({ thinking: s.thinking + (event.content ?? '') }))
            break
          case 'output':
            update((s) => ({ output: s.output + (event.content ?? '') }))
            break
          case 'done':
            update(() => ({
              json: event.json ?? null,
              table: event.table ?? null,
              status: 'completed',
              live: false,
            }))
            finish()
            break
          case 'error':
            update(() => ({
              status: 'failed',
              error: event.message ?? 'The agent failed to parse this document',
              live: false,
            }))
            finish()
            break
        }
      },
      () => update(() => ({ live: false }))
    )

    closeRef.current = close
    return () => {
      closeRef.current = null
      close()
    }
  }, [jobId, key])

  return state
}
