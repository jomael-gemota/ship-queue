const SPHERE_HH_SPORTSWEAR_URL =
  'http://sphere.outdoorequippedservice.com/api/v1/cookie/provide/b2b-hhsportswear';

const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 90_000;

class SphereHttpError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'SphereHttpError';
    this.retryable = retryable;
  }
}

/**
 * Pulls the Helly Hansen Sports B2B cookie from Sphere.
 *
 * The CookieJar key stays `helly-hansen-sports-b2b`. `b2b-hhsportswear` is only
 * the Sphere provider id in the URL. Sphere currently listens on HTTP :80 only
 * — HTTPS :443 is refused. Auth is a raw `Authorization` header (not Bearer).
 * Token is `COOKIE_JAR_HH_SPORTSWEAR_TOKEN`, falling back to
 * `COOKIE_JAR_OE_US_TOKEN` when the sportswear token is unset. Payload is
 * `data.cookie` (sometimes top-level `cookie`).
 */
export async function fetchHellyHansenSportsB2b(): Promise<string> {
  const url = process.env.COOKIE_JAR_HH_SPORTSWEAR_URL?.trim() || SPHERE_HH_SPORTSWEAR_URL;
  const token =
    process.env.COOKIE_JAR_HH_SPORTSWEAR_TOKEN?.trim() || process.env.COOKIE_JAR_OE_US_TOKEN?.trim();
  if (!token) {
    throw new Error('COOKIE_JAR_HH_SPORTSWEAR_TOKEN is not set');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchCookieOnce(url, token);
    } catch (err) {
      lastError = err;
      const retryable = !(err instanceof SphereHttpError) || err.retryable;
      if (retryable && attempt < MAX_RETRIES) {
        await delay(400 * attempt);
        continue;
      }
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchCookieOnce(url: string, token: string): Promise<string> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((err: unknown) => {
    const cause =
      err instanceof Error && 'cause' in err && err.cause instanceof Error
        ? err.cause.message
        : '';
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Sphere cookie fetch failed: ${message}${cause ? ` (${cause})` : ''}`);
  });

  if (!res.ok) {
    const detail = await readSphereError(res);
    const retryable = res.status === 429 || res.status >= 502;
    throw new SphereHttpError(
      `Sphere cookie fetch failed: ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`,
      retryable
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('Sphere cookie response was not valid JSON');
  }

  return extractCookiePayload(body);
}

async function readSphereError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body?.message === 'string' && body.message.trim()) {
      return body.message.trim().slice(0, 500);
    }
  } catch {
    return '';
  }
  return '';
}

function extractCookiePayload(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('Sphere cookie response missing a cookie payload');
  }

  const root = body as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : undefined;
  const raw = root.cookie ?? nested?.cookie;

  if (typeof raw === 'string' && raw.trim()) return raw.trim();

  if (Array.isArray(raw) && raw.length > 0) {
    if (raw.every((item) => typeof item === 'string' && item.trim())) {
      return raw.map((item) => String(item).trim()).join('; ');
    }
    return JSON.stringify(raw);
  }

  if (raw && typeof raw === 'object') return JSON.stringify(raw);

  throw new Error('Sphere cookie response missing a cookie payload');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
