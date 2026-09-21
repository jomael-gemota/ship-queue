"""
Doc Tidy Worker
---------------
Connects to the Ship Queue server over WebSocket, receives parse-job
assignments, reads each PDF out of GridFS, streams the Tidy agent's reasoning
and output back, and persists results to MongoDB.

The PDFs originate in Google Drive; the server mirrors the bytes into GridFS
when a parse is requested, so this worker needs no Google credentials.

Run:
    python worker.py                        # loads .env (default)
    python worker.py --env .env.local       # loads .env.local (e.g. Windows localhost)
    python worker.py --env .env.staging     # loads .env.staging
    python worker.py --env .env.production  # loads .env.production
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime

import motor.motor_asyncio
from bson import ObjectId
from dotenv import load_dotenv
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

from corrections import CORRECTION_TEXT_SAMPLE_CHARS, retrieve_examples
from mongo_collections import PARSE_JOBS, PDF_BUCKET
from narrator import Narrator
from pdf_extractor import extract_text
from sku import (
    detect_vendor_name_from_text,
    extract_vendor_name,
    find_line_items,
    resolve_vendor,
)
from tidy_agent import TokenType, extract_json, generate_table_data, stream_tidy

# ── Environment profile ───────────────────────────────────────────────────────
# Use --env to load a named profile, e.g.:
#   python worker.py --env .env.local       # → localhost dev server
#   python worker.py --env .env.staging     # → staging (default)
#   python worker.py --env .env.production  # → production
_arg_parser = argparse.ArgumentParser(description="Doc Tidy Worker", add_help=False)
_arg_parser.add_argument(
    "--env",
    default=".env",
    metavar="FILE",
    help="Path to the .env profile to load (default: .env)",
)
_args, _ = _arg_parser.parse_known_args()
load_dotenv(_args.env)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("worker")

SERVER_WS_URL = os.environ["SERVER_WS_URL"]  # e.g. ws://localhost:5000/ws/doc-tidy
MONGODB_URI = os.environ["MONGODB_URI"]
MONGODB_DB = os.environ.get("MONGODB_DB", "ship-queue")
# Shared secret the server checks during the WebSocket upgrade. Ship Queue is
# publicly reachable, so an unauthenticated socket here would let anyone write
# extraction output for any job.
WORKER_TOKEN = os.environ.get("DOC_TIDY_WORKER_TOKEN", "")
RECONNECT_DELAY = 5  # seconds between reconnect attempts


def get_motor_client() -> motor.motor_asyncio.AsyncIOMotorClient:
    return motor.motor_asyncio.AsyncIOMotorClient(MONGODB_URI)


def _human_size(num_bytes: int) -> str:
    """Format a byte count as a short human-readable string."""
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


async def fetch_pdf_bytes(db: motor.motor_asyncio.AsyncIOMotorDatabase, job_id: str) -> bytes:
    """Download PDF bytes from MongoDB GridFS."""
    bucket = motor.motor_asyncio.AsyncIOMotorGridFSBucket(db, bucket_name=PDF_BUCKET)

    job = await db[PARSE_JOBS].find_one({"_id": ObjectId(job_id)})
    if not job or not job.get("pdfFileId"):
        raise ValueError(f"No PDF file reference found for job {job_id}")

    stream = await bucket.open_download_stream(job["pdfFileId"])
    return await stream.read()


async def process_job(
    job_id: str,
    ws,
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
) -> None:
    """Full pipeline: fetch PDF → extract text → stream Tidy → persist result.

    Each stage is narrated into the reasoning panel as a `thinking` token so the
    UI shows a step-by-step pipeline top to bottom, even when the model itself
    exposes no chain-of-thought.
    """
    logger.info("Processing job %s", job_id)
    started = time.monotonic()

    async def send(payload: dict) -> None:
        await ws.send(json.dumps(payload))

    narrator = Narrator()
    step_counter = 0

    async def emit_thinking(text: str) -> None:
        """Emit a raw thinking token into the reasoning panel."""
        await send({
            "type": "token",
            "jobId": job_id,
            "tokenType": "thinking",
            "content": text,
        })

    async def say_intro(intent: str, fallback: str) -> None:
        """Tidy's opening line, standing on its own above the steps."""
        line = await narrator.say(intent, fallback)
        await emit_thinking(f"{line}\n\n")

    async def step_start(intent: str, fallback: str) -> None:
        """Begin a step."""
        nonlocal step_counter
        step_counter += 1
        line = await narrator.say(intent, fallback)
        await emit_thinking(f"{line}\n")

    async def step_done(intent: str, fallback: str) -> None:
        """Close the current step with an indented Tidy line."""
        line = await narrator.say(intent, fallback)
        await emit_thinking(f"   {line}\n\n")

    try:
        await db[PARSE_JOBS].update_one(
            {"_id": ObjectId(job_id)},
            {"$set": {"status": "processing"}},
        )
        await send({"type": "status", "jobId": job_id, "status": "processing"})

        job = await db[PARSE_JOBS].find_one({"_id": ObjectId(job_id)})
        filename = (job or {}).get("filename", "document.pdf")
        await say_intro(
            f"You just handed me a document named '{filename}'. Greet briefly and say "
            f"you're taking a look.",
            f"Hi! I've got your document, {filename} — let me take a look.",
        )

        await step_start(
            "Tell the user you're now fetching their PDF from storage.",
            "Let me grab your PDF from storage...",
        )
        pdf_bytes = await fetch_pdf_bytes(db, job_id)
        logger.info("Job %s: PDF fetched (%d bytes)", job_id, len(pdf_bytes))
        size_str = _human_size(len(pdf_bytes))
        await step_done(
            f"You just finished loading the PDF and it is {size_str}.",
            f"Got it — that's {size_str} loaded and ready.",
        )

        await step_start(
            "Tell the user you're now reading the text off the pages.",
            "Now I'll read the text from the pages...",
        )
        document_text = extract_text(pdf_bytes)
        logger.info("Job %s: text extracted (%d chars)", job_id, len(document_text))
        char_str = f"{len(document_text):,}"
        await step_done(
            f"You just extracted the text and it came to {char_str} characters.",
            f"Done — I pulled out {char_str} characters of text.",
        )

        # Identify the vendor from the raw text up front so correction retrieval
        # can be scoped to this vendor (extraction — and thus the extracted
        # vendorName — hasn't happened yet). Unknown vendors fall back to a
        # global similarity search inside retrieve_examples.
        detected_vendor = await detect_vendor_name_from_text(db, document_text)

        # If the detected vendor is registered, pull its setup-time sample SKU(s)
        # so Tidy can reproduce that vendor's SKU format(s) from the very first
        # run — cold-start anchors that complement retrieved corrections (see
        # design-log 2026-06-26-multiple-vendor-sku-samples.md). A vendor may have
        # several samples; legacy single `skuSample` is merged in for compat.
        detected_vendor_doc = (
            await resolve_vendor(db, detected_vendor) if detected_vendor else None
        )
        vendor_sku_samples: list[str] = []
        if detected_vendor_doc:
            vendor_sku_samples = list(detected_vendor_doc.get("skuSamples") or [])
            legacy_sample = detected_vendor_doc.get("skuSample")
            if legacy_sample:
                vendor_sku_samples.append(legacy_sample)

        # Retrieve relevant past corrections to steer this parse (graceful no-op
        # when disabled / no embedding key / no corrections yet). Vendor-scoped:
        # a vendor's fixes only apply to that vendor's documents.
        examples = await retrieve_examples(db, document_text, vendor_name=detected_vendor)
        if examples:
            vendor_phrase = (
                f" for {detected_vendor}" if detected_vendor else ""
            )
            await step_start(
                "Tell the user you're checking what you've learned from their past "
                f"corrections on this vendor's documents{vendor_phrase}.",
                f"Let me check what I've learned from your past corrections{vendor_phrase}...",
            )
            await step_done(
                f"You found {len(examples)} relevant past correction(s) to guide you.",
                f"Found {len(examples)} relevant example(s) — I'll apply what I learned.",
            )

        await step_start(
            "Tell the user that you yourself are now reading through and making sense "
            "of the document. You are doing this work directly — do not mention any "
            "separate model, parser, or tool.",
            "Now let me read through and make sense of it...",
        )

        output_buffer = ""
        saw_reasoning = False

        async for chunk in stream_tidy(
            document_text, examples=examples, vendor_sku_samples=vendor_sku_samples
        ):
            token_type_str: str = (
                "thinking" if chunk.token_type == TokenType.THINKING else "output"
            )
            await send({
                "type": "token",
                "jobId": job_id,
                "tokenType": token_type_str,
                "content": chunk.content,
            })

            if chunk.token_type == TokenType.OUTPUT:
                output_buffer += chunk.content
            else:
                saw_reasoning = True

        if saw_reasoning:
            await step_done(
                "Tell the user you've finished working through the document.",
                "Okay — I've worked through the details.",
            )
        else:
            await step_done(
                "Tell the user you went straight to the answer without showing your "
                "working this time.",
                "I went straight to the answer on this one.",
            )

        await step_start(
            "Tell the user you're now organizing everything into clean structured data.",
            "Now let me tidy this into clean, structured data...",
        )
        logger.info("Job %s: stream complete, parsing JSON", job_id)
        result_json = extract_json(output_buffer)
        await step_done(
            "Tell the user the structured data is ready and valid.",
            "All set — your structured data is ready and valid.",
        )

        # SKUs are built by Tidy itself (the model), learned per vendor from past
        # corrections — not assembled deterministically here (see design-log
        # 2026-06-25-llm-built-skus-per-vendor.md). We still resolve the vendor to
        # canonicalize the stored vendor name (so corrections key on a stable value
        # detection reproduces next time) and to flag unregistered vendors so the
        # setup UI can register them — registration is what scopes corrections to a
        # vendor and lets Tidy learn and keep that vendor's SKU format.
        vendor_needs_setup = False
        # A vendor the user confirmed for this job (e.g. via the setup card) is
        # preserved across re-runs; honor it so registering a vendor "sticks" even
        # when the model doesn't emit the name and it isn't found in the raw text.
        existing_vendor_name = (job or {}).get("vendorName")
        # Default to the vendor detected from raw text (or the confirmed one) so
        # jobs without line items still record a vendor; replaced with the
        # canonical name once resolved.
        vendor_name = detected_vendor or existing_vendor_name
        _, line_items = find_line_items(result_json)
        if line_items:
            # Try every name we know — the model's extracted value, the one detected
            # from raw text, and the user's confirmed value for this job — resolving
            # each against registered vendors. The first that resolves wins; this is
            # what makes registration stick on re-run. If none resolve, keep the best
            # name to display and flag the vendor for setup.
            candidates = [
                extract_vendor_name(result_json),
                detected_vendor,
                existing_vendor_name,
            ]
            vendor = None
            fallback_name = None
            for candidate in candidates:
                if not candidate:
                    continue
                fallback_name = fallback_name or candidate
                resolved = await resolve_vendor(db, candidate)
                if resolved:
                    vendor = resolved
                    break
            if vendor:
                # Persist the canonical vendor name so stored corrections key on a
                # stable value that vendor detection will reproduce next time.
                vendor_name = vendor.get("name", fallback_name)
            else:
                vendor_needs_setup = True
                vendor_name = fallback_name
                vname = vendor_name or "this vendor"
                await step_start(
                    f"Tell the user that {vname} looks new to you.",
                    f"Looks like {vname} is new to me...",
                )
                await step_done(
                    f"Tell the user you built the SKUs yourself for now, and that if "
                    f"they register {vname} and fix any SKU once, you'll remember its "
                    f"format next time.",
                    f"I built the SKUs myself for now — register {vname} and correct "
                    f"any SKU once, and I'll remember its format from then on.",
                )

        # Second Hermes pass: turn the JSON into a table view. Non-fatal — if it
        # fails the job still completes with table data omitted.
        await step_start(
            "Tell the user you're now laying the data out as easy-to-read tables.",
            "Now let me lay this out as easy-to-read tables...",
        )
        result_table: dict | None = None
        try:
            result_table = await generate_table_data(result_json)
            await step_done(
                "Tell the user the table view is ready.",
                "Done — the table view is ready too.",
            )
        except Exception as table_exc:
            logger.warning("Job %s: table generation failed: %s", job_id, table_exc)
            await step_done(
                "Tell the user the JSON is ready but you couldn't build the table "
                "view this time.",
                "I couldn't build the table view this time, but the JSON is ready.",
            )

        await db[PARSE_JOBS].update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "completed",
                    "jsonOutput": result_json,
                    "tableOutput": result_table,
                    "vendorName": vendor_name,
                    "vendorNeedsSetup": vendor_needs_setup,
                    "documentTextSample": document_text[:CORRECTION_TEXT_SAMPLE_CHARS],
                    "completedAt": datetime.utcnow(),
                }
            },
        )
        elapsed_str = f"{time.monotonic() - started:.1f}"
        await say_intro(
            f"Tell the user you finished the whole job in {elapsed_str} seconds.",
            f"Finished in {elapsed_str}s — here's everything I found.",
        )
        await send({
            "type": "complete",
            "jobId": job_id,
            "json": result_json,
            "table": result_table,
        })
        logger.info("Job %s: completed", job_id)

    except Exception as exc:
        logger.exception("Job %s failed: %s", job_id, exc)
        await db[PARSE_JOBS].update_one(
            {"_id": ObjectId(job_id)},
            {"$set": {"status": "failed", "error": str(exc)}},
        )
        try:
            await emit_thinking(f"\nSorry — I ran into a problem: {exc}\n")
        except Exception:
            pass
        await send({"type": "error", "jobId": job_id, "message": str(exc)})


async def run_worker() -> None:
    """Connect to the server and handle incoming job messages."""
    if not WORKER_TOKEN:
        logger.error(
            "DOC_TIDY_WORKER_TOKEN is not set. The server rejects unauthenticated "
            "connections, so set it to the same value configured there."
        )
        sys.exit(1)

    mongo_client = get_motor_client()
    db = mongo_client[MONGODB_DB]

    while True:
        try:
            logger.info("Connecting to %s…", SERVER_WS_URL)
            async with ws_connect(
                SERVER_WS_URL,
                additional_headers={"Authorization": f"Bearer {WORKER_TOKEN}"},
                ping_interval=20,   # send a ping every 20s to keep the proxy alive
                ping_timeout=10,    # wait up to 10s for a pong before treating as dead
            ) as ws:
                logger.info("Connected to server")
                await ws.send(json.dumps({"type": "ready"}))

                active_tasks: set[asyncio.Task] = set()

                async for raw_message in ws:
                    try:
                        msg = json.loads(raw_message)
                    except json.JSONDecodeError:
                        logger.warning("Received non-JSON message: %s", raw_message)
                        continue

                    msg_type = msg.get("type")

                    if msg_type == "job":
                        job_id: str = msg["jobId"]
                        task = asyncio.create_task(process_job(job_id, ws, db))
                        active_tasks.add(task)
                        task.add_done_callback(active_tasks.discard)

                    else:
                        logger.debug("Unhandled message type: %s", msg_type)

        except ConnectionClosed as exc:
            logger.warning("WebSocket closed (%s), reconnecting in %ds…", exc, RECONNECT_DELAY)
        except OSError as exc:
            logger.warning("Connection error (%s), reconnecting in %ds…", exc, RECONNECT_DELAY)
        except Exception:
            logger.exception("Unexpected error, reconnecting in %ds…", RECONNECT_DELAY)

        await asyncio.sleep(RECONNECT_DELAY)


def main() -> None:
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        logger.info("Worker stopped by user")
        sys.exit(0)


if __name__ == "__main__":
    main()
