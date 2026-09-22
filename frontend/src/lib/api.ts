const BASE_URL = '/api'
const TOKEN_KEY = 'sq_token'

/** An Error subclass that also carries the `code` field from API error responses. */
export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'An error occurred' }))
    throw new ApiError(error.message || `HTTP ${res.status}`, error.code)
  }

  return res.json()
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function authRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'An error occurred' }))
    throw new ApiError(error.message || `HTTP ${res.status}`, error.code)
  }

  return res.json()
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
}

/**
 * POSTs `body` and yields each newline-delimited JSON (NDJSON) object the server
 * streams back. Used for long-running operations that report live progress.
 * Throws an `ApiError` if the request fails before the stream starts.
 */
async function* authPostStream<T>(endpoint: string, body?: unknown): AsyncGenerator<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'An error occurred' }))
    throw new ApiError(error.message || `HTTP ${res.status}`, error.code)
  }
  if (!res.body) {
    throw new ApiError('Streaming is not supported by this browser.')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flushLines = function* (chunk: string): Generator<T> {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) yield JSON.parse(line) as T
      newline = buffer.indexOf('\n')
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    yield* flushLines(decoder.decode(value, { stream: true }))
  }
  const tail = (buffer + decoder.decode()).trim()
  if (tail) yield JSON.parse(tail) as T
}

/**
 * Opens a server-sent events stream and invokes `onEvent` for each message.
 * Returns a function that closes it.
 *
 * Uses `fetch` rather than `EventSource` because `EventSource` cannot send an
 * `Authorization` header, and the alternative — the JWT in the query string —
 * would leak the token into server access logs.
 */
function authEventStream<T>(
  endpoint: string,
  onEvent: (event: T) => void,
  onError?: (error: unknown) => void
): () => void {
  const controller = new AbortController()
  let closed = false
  let attempt = 0

  const run = async () => {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { Accept: 'text/event-stream', ...getAuthHeaders() },
      signal: controller.signal,
    })

    if (!res.ok || !res.body) throw new ApiError(`HTTP ${res.status}`)
    attempt = 0

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line.
      let split = buffer.indexOf('\n\n')
      while (split !== -1) {
        const frame = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)

        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')

        if (data) {
          try {
            onEvent(JSON.parse(data) as T)
          } catch {
            // Ignore a malformed frame rather than tearing down the stream.
          }
        }
        split = buffer.indexOf('\n\n')
      }
    }
  }

  // Reconnect with backoff: the stream is long-lived, so a dropped connection
  // is expected (sleep, network change, server restart) rather than fatal.
  const connect = () => {
    if (closed) return
    run()
      .then(() => {
        attempt += 1
        if (!closed) setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt))
      })
      .catch((err) => {
        if (closed || controller.signal.aborted) return
        onError?.(err)
        attempt += 1
        setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt))
      })
  }
  connect()

  return () => {
    closed = true
    controller.abort()
  }
}

/**
 * Uploads files as multipart/form-data. The `Content-Type` header is omitted
 * so the browser sets it automatically with the correct boundary string.
 */
async function authUpload<T>(endpoint: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'An error occurred' }))
    throw new ApiError(error.message || `HTTP ${res.status}`, error.code)
  }

  return res.json()
}

export const authApi = {
  get: <T>(endpoint: string) => authRequest<T>(endpoint),
  postStream: authPostStream,
  eventStream: authEventStream,
  post: <T>(endpoint: string, body?: unknown) =>
    authRequest<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(endpoint: string, body: unknown) =>
    authRequest<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(endpoint: string, body: unknown) =>
    authRequest<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) => authRequest<T>(endpoint, { method: 'DELETE' }),
  upload: <T>(endpoint: string, formData: FormData) => authUpload<T>(endpoint, formData),
}
