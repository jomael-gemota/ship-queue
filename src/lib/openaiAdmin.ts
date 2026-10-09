/**
 * OpenAI organization Costs and Usage APIs. Both need an admin key
 * (`OPENAI_ADMIN_KEY`) and are optionally filtered to the API keys Doc Tidy
 * uses (`OPENAI_USAGE_API_KEY_IDS`, comma-separated).
 */

export const DAY_MS = 86_400_000;

export class OpenAIAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
  }
}

export function adminKey(): string | null {
  return process.env.OPENAI_ADMIN_KEY?.trim() || null;
}

export function usageApiKeyIds(): string[] {
  return (process.env.OPENAI_USAGE_API_KEY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface Page<T> {
  data?: Array<{ start_time: number; results?: T[] }>;
  has_more?: boolean;
  next_page?: string | null;
}

/** Walks every page; `startMs`/`endMs` must be whole UTC days. */
async function fetchBuckets<T>(
  path: string,
  startMs: number,
  endMs: number,
  groupBy: string
): Promise<Array<{ startMs: number; results: T[] }>> {
  const key = adminKey();
  if (!key) throw new OpenAIAdminError('OPENAI_ADMIN_KEY is not set', 0, '');

  const days = Math.max(1, Math.ceil((endMs - startMs) / DAY_MS));
  const buckets: Array<{ startMs: number; results: T[] }> = [];
  let page: string | null | undefined;
  do {
    const params = new URLSearchParams({
      start_time: String(Math.floor(startMs / 1000)),
      end_time: String(Math.floor(endMs / 1000)),
      bucket_width: '1d',
      limit: String(Math.min(days, 31)),
    });
    params.append('group_by', groupBy);
    for (const id of usageApiKeyIds()) params.append('api_key_ids', id);
    if (page) params.set('page', page);

    const response = await fetch(`https://api.openai.com/v1/organization/${path}?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      throw new OpenAIAdminError(
        `OpenAI ${path} API returned ${response.status}`,
        response.status,
        await response.text()
      );
    }
    const body = (await response.json()) as Page<T>;
    for (const bucket of body.data ?? []) {
      buckets.push({ startMs: bucket.start_time * 1000, results: bucket.results ?? [] });
    }
    page = body.has_more ? body.next_page : null;
  } while (page);
  return buckets;
}

export interface CostLine {
  dayMs: number;
  lineItem: string;
  amount: number;
  currency: string;
}

export async function fetchDailyCosts(startMs: number, endMs: number): Promise<CostLine[]> {
  type Result = { amount?: { value?: number; currency?: string }; line_item?: string | null };
  const buckets = await fetchBuckets<Result>('costs', startMs, endMs, 'line_item');
  const lines: CostLine[] = [];
  for (const bucket of buckets) {
    for (const result of bucket.results) {
      const amount = Number(result.amount?.value ?? 0);
      if (!Number.isFinite(amount)) continue;
      lines.push({
        dayMs: bucket.startMs,
        lineItem: result.line_item ?? 'Other',
        amount,
        currency: result.amount?.currency ?? 'usd',
      });
    }
  }
  return lines;
}

export interface CompletionUsageLine {
  dayMs: number;
  model: string;
  /** Includes cached input, as in the per-call usage object. */
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export async function fetchDailyCompletionUsage(
  startMs: number,
  endMs: number
): Promise<CompletionUsageLine[]> {
  type Result = {
    model?: string | null;
    input_tokens?: number;
    output_tokens?: number;
    num_model_requests?: number;
  };
  const buckets = await fetchBuckets<Result>('usage/completions', startMs, endMs, 'model');
  return buckets.flatMap((bucket) =>
    bucket.results.map((result) => ({
      dayMs: bucket.startMs,
      model: result.model ?? 'unknown',
      inputTokens: Number(result.input_tokens ?? 0),
      outputTokens: Number(result.output_tokens ?? 0),
      requests: Number(result.num_model_requests ?? 0),
    }))
  );
}
