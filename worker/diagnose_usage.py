"""Show what the configured Hermes backend reports for token usage.

Makes two tiny calls — one non-streamed, one streamed with include_usage — and
prints the model the backend echoes back, its service tier and its usage object.
That tells you what the Token Usage dashboard will be able to price, and which
model name to add a price row for.

Run:
    python diagnose_usage.py                  # loads .env
    python diagnose_usage.py --env .env.production
"""

from __future__ import annotations

import argparse
import asyncio
import json

from dotenv import load_dotenv

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--env", default=".env", metavar="FILE")
args = parser.parse_args()
load_dotenv(args.env)

from tidy_agent import _make_hermes_client  # noqa: E402  (needs env loaded first)
from usage import hermes_provider, normalize_usage  # noqa: E402

MESSAGES = [{"role": "user", "content": "Reply with the single word: ok"}]


def _dump(obj) -> str:
    if obj is None:
        return "None"
    if hasattr(obj, "model_dump"):
        obj = obj.model_dump()
    return json.dumps(obj, indent=2, default=str)


async def main() -> None:
    client, model = _make_hermes_client()
    print(f"Provider: {hermes_provider()}   requested model: {model}\n")

    print("── Non-streamed call ──")
    resp = await client.chat.completions.create(model=model, messages=MESSAGES, max_tokens=16)
    print(f"echoed model:  {resp.model}")
    print(f"service_tier:  {getattr(resp, 'service_tier', None)}")
    print(f"raw usage:     {_dump(resp.usage)}")
    print(f"normalized:    {normalize_usage(resp.usage)}\n")

    print("── Streamed call with stream_options.include_usage ──")
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=MESSAGES,
            max_tokens=16,
            stream=True,
            stream_options={"include_usage": True},
        )
        usage = None
        echoed = None
        async for chunk in stream:
            echoed = chunk.model or echoed
            if getattr(chunk, "usage", None):
                usage = chunk.usage
        print(f"echoed model:  {echoed}")
        print(f"raw usage:     {_dump(usage)}")
        print(f"normalized:    {normalize_usage(usage)}")
        if usage is None:
            print("\n!! No usage frame — streamed extraction calls will be recorded as 'missing'.")
    except Exception as exc:
        print(f"!! Streamed call with include_usage failed: {exc}")

    print(
        "\nIf the echoed model is a Hermes alias (e.g. 'hermes-agent'), add a price row "
        "for that exact name on the dashboard using the upstream model's prices.\n"
        "If Hermes runs several upstream calls per request (tools, agent loop), compare "
        "these numbers with the upstream provider's own usage page."
    )


if __name__ == "__main__":
    asyncio.run(main())
