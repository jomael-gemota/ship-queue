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

export const authApi = {
  get: <T>(endpoint: string) => authRequest<T>(endpoint),
  postStream: authPostStream,
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
}
