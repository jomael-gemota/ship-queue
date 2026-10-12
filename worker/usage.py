"""Token usage reporting — one event per LLM call, sent to the server for costing.

Every call site passes the provider's ``usage`` object straight through; nothing
here estimates tokens from text. The server prices the event and attributes it
to a workspace (see design-log/2026-10-10-doc-tidy-token-usage-and-cost-dashboard.md).

The sink is a ``ContextVar`` set once per job in ``worker.process_job``. asyncio
tasks copy the context they were created in, so every call made while running a
job — however deeply nested — reports against that job without the WebSocket
being threaded through ``tidy_agent``, ``narrator`` and ``embeddings``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any

logger = logging.getLogger(__name__)

UsageSink = Callable[[dict], Awaitable[None]]

_sink: ContextVar[UsageSink | None] = ContextVar("usage_sink", default=None)


def set_usage_sink(sink: UsageSink | None) -> None:
    _sink.set(sink)


def hermes_provider() -> str:
    """``openai`` when the Hermes client is pointed at OpenAI's own host."""
    return "hermes" if os.environ.get("HERMES_BASE_URL") else "openai"


def _get(obj: Any, name: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    value = getattr(obj, name, None)
    if value is None:
        extra = getattr(obj, "model_extra", None) or {}
        value = extra.get(name)
    return value


def _int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def normalize_usage(usage: Any) -> dict | None:
    """Map Chat Completions, Responses or Embeddings usage onto one shape.

    ``cached`` and ``cache_write`` are subsets of input, matching how OpenAI
    reports them; the server subtracts both to get ordinary input.
    """
    if usage is None:
        return None

    input_tokens = _get(usage, "prompt_tokens")
    if input_tokens is None:
        input_tokens = _get(usage, "input_tokens")
    output_tokens = _get(usage, "completion_tokens")
    if output_tokens is None:
        output_tokens = _get(usage, "output_tokens")
    if input_tokens is None and output_tokens is None:
        return None

    in_details = _get(usage, "prompt_tokens_details") or _get(usage, "input_tokens_details")
    out_details = _get(usage, "completion_tokens_details") or _get(usage, "output_tokens_details")

    return {
        "inputTokens": _int(input_tokens),
        "cachedInputTokens": _int(_get(in_details, "cached_tokens")),
        "cacheWriteTokens": _int(_get(in_details, "cache_write_tokens")),
        "outputTokens": _int(output_tokens),
        "reasoningTokens": _int(_get(out_details, "reasoning_tokens")),
    }


async def report_usage(
    *,
    purpose: str,
    provider: str,
    model: str | None,
    usage: Any,
    service_tier: str | None = None,
) -> None:
    """Send one usage event to the current job's sink. Never raises."""
    sink = _sink.get()
    if sink is None:
        return

    normalized = normalize_usage(usage)
    event = {
        "purpose": purpose,
        "provider": provider,
        "model": model or "unknown",
        "serviceTier": service_tier,
        "usageSource": "reported" if normalized else "missing",
        **(normalized or {}),
    }
    try:
        await sink(event)
    except Exception as exc:  # pragma: no cover - reporting must never break a job
        logger.warning("Failed to report %s usage: %s", purpose, exc)
