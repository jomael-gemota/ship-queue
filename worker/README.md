# Doc Tidy parsing worker

Reads the PDFs Doc Tidy captures and turns them into structured data, using the
Tidy agent (Hermes, or any OpenAI-compatible endpoint).

This runs on its own Ubuntu machine rather than on the web server: the model, OCR
and PDF work are all CPU-hungry and would otherwise compete with request
handling. It dials **out** to Ship Queue, so the box needs no inbound ports and
no public address.

## What it does with a job

1. Reads the job from `doctidy_parse_jobs` and pulls the PDF out of the
   `doctidy_pdfs` GridFS bucket. The server mirrored those bytes from Google
   Drive when the user pressed Parse, so the worker needs no Google credentials.
2. Extracts text with pdfplumber, falling back to local Tesseract OCR on pages
   that turn out to be scans.
3. Identifies the vendor from the raw text, and retrieves that vendor's past
   corrections as few-shot examples.
4. Streams the agent's reasoning back to the server token by token, which relays
   it to open browsers and appends it to the job.
5. Extracts the JSON, resolves the vendor, generates the table view, and writes
   the result.

Each step is narrated in the agent's voice, which is what the reasoning panel
renders as its steps.

## Requirements

- Python 3.10+
- Network access to Ship Queue's HTTPS domain **and** its MongoDB
- Tesseract and poppler, for scanned pages

```bash
sudo apt update
sudo apt install -y python3-venv tesseract-ocr poppler-utils
```

Without those two packages digital PDFs still parse; scanned pages are skipped.

## Setup

```bash
cd worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
$EDITOR .env
```

`DOC_TIDY_WORKER_TOKEN` must match the value in the server's `.env` — the server
rejects the WebSocket upgrade without it, and the worker exits rather than
retrying a handshake that cannot succeed.

`MONGODB_DB` must be Ship Queue's database. The worker queries collections by the
exact names in `mongo_collections.py`, which are pinned to match the `collection`
option on the server's Mongoose models. Changing one without the other silently
produces a worker that finds no jobs.

## Running

```bash
source .venv/bin/activate
python worker.py
```

Test the agent against a local file, without Mongo or the server:

```bash
python test_local.py /path/to/invoice.pdf
```

## As a service

```ini
# /etc/systemd/system/doc-tidy-worker.service
[Unit]
Description=Doc Tidy parsing worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=doctidy
WorkingDirectory=/opt/ship-queue/worker
EnvironmentFile=/opt/ship-queue/worker/.env
ExecStart=/opt/ship-queue/worker/.venv/bin/python worker.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now doc-tidy-worker
journalctl -u doc-tidy-worker -f
```

`Restart=always` matters more than it looks: on reconnect the worker announces
`ready`, and the server responds by re-dispatching every job still sitting at
`pending`. A crash mid-queue therefore costs a few seconds rather than losing
work. A job that was already `processing` when the worker died is the exception —
it stays stuck until someone re-runs it.

## Upgrading from the standalone doc-tidy app

This worker was previously part of `jomael-gemota/doc-tidy`. Against Ship Queue:

- `SERVER_WS_URL` ends in `/ws/doc-tidy`, not `/ws`.
- `DOC_TIDY_WORKER_TOKEN` is required; the old endpoint was unauthenticated.
- Collections are the pinned `doctidy_*` names, not `jobs`/`vendors`/
  `corrections`, and the GridFS bucket is `doctidy_pdfs`, not `pdfs`.
