/**
 * Text embeddings via OpenAI, used to index Doc Tidy corrections for retrieval.
 *
 * Uses global fetch rather than the OpenAI SDK to keep the server's dependency
 * surface small — the worker is the only tier that needs the full client.
 *
 * Returns null when no key is configured or the call fails, so callers degrade
 * instead of rejecting the user's correction: an unembedded correction is still
 * stored and still visible, it just cannot be retrieved as a few-shot example
 * until it is re-embedded.
 */

const DEFAULT_MODEL = 'text-embedding-3-small';

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[embeddings] OPENAI_API_KEY is not set — storing without an embedding');
    return null;
  }

  const input = text.slice(0, 8000); // Comfortably inside the model's token limit.
  if (!input.trim()) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.EMBEDDING_MODEL ?? DEFAULT_MODEL,
        input,
      }),
    });

    if (!res.ok) {
      console.error('[embeddings] OpenAI returned', res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding ?? null;
  } catch (error) {
    console.error('[embeddings] request failed:', error);
    return null;
  }
}
