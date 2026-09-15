import asyncio
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # picks up your .env

from pdf_extractor import extract_text
from tidy_agent import stream_tidy, TokenType, extract_json


async def main(pdf_path: str) -> None:
    pdf_bytes = Path(pdf_path).read_bytes()
    print(f"[1] PDF read: {len(pdf_bytes)} bytes")

    text = extract_text(pdf_bytes)
    print(f"[2] Text extracted: {len(text)} chars")
    print("--- Preview (first 500 chars) ---")
    print(text[:500])
    print("---------------------------------\n")

    print("[3] Calling Hermes model…")
    output_buffer = ""
    async for chunk in stream_tidy(text):
        if chunk.token_type == TokenType.THINKING:
            print(chunk.content, end="", flush=True)
        else:
            output_buffer += chunk.content

    print("\n\n[4] Raw model output:")
    print(output_buffer)

    print("\n[5] Parsed JSON:")
    result = extract_json(output_buffer)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_local.py /path/to/invoice.pdf")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))