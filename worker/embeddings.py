"""Text embeddings via OpenAI, used to retrieve relevant past corrections.

Must use the same model (and therefore vector dimensionality) as the server's
``embedText`` so query vectors match stored correction vectors. Degrades to
``None`` when no key is configured, in which case retrieval is skipped and
parsing falls back to today's stateless behavior.
"""

from __future__ import annotations

import logging
import os

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
# Match the server's slice; keep well under the model's token limit.
EMBED_MAX_CHARS = int(os.environ.get("EMBED_MAX_CHARS", 8000))


async def embed_text(text: str) -> list[float] | None:
    """Return the embedding vector for ``text``, or ``None`` if unavailable."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.info("OPENAI_API_KEY not set — skipping embedding/retrieval")
        return None

    try:
        client = AsyncOpenAI(api_key=api_key)
        response = await client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text[:EMBED_MAX_CHARS],
        )
        return response.data[0].embedding
    except Exception as exc:
        logger.warning("Embedding request failed: %s", exc)
        return None
