import { timingSafeEqual } from 'crypto';
import type { IncomingMessage, Server } from 'http';
import type { Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Types } from 'mongoose';
import DocTidyParseJob from '../models/DocTidyParseJob';
import { broadcast } from './docTidyEvents';
import { writeMatchCacheForJob } from './invoiceMatchCache.service';

/**
 * Transport between the Express server and the Python worker that runs the
 * Hermes agent on a separate machine.
 *
 * The worker dials out to us and holds one persistent socket. Jobs are pushed
 * down it; reasoning tokens come back up it and are fanned out to whichever
 * browsers currently have that job's panel open.
 *
 * Deliberately not a queue: this is a single-worker topology, and the worker
 * itself runs jobs as concurrent tasks. See
 * design-log/2026-09-11-doc-tidy-agent-parsing.md.
 */

export const WORKER_WS_PATH = '/ws/doc-tidy';

interface WorkerMessage {
  type?: string;
  jobId?: string;
  tokenType?: 'thinking' | 'output';
  content?: string;
  status?: string;
  message?: string;
  json?: Record<string, unknown>;
  table?: Record<string, unknown> | null;
}

interface JobStreamEvent {
  type: 'thinking' | 'output' | 'status' | 'done' | 'error' | 'connected';
  content?: string;
  status?: string;
  message?: string;
  json?: Record<string, unknown> | null;
  table?: Record<string, unknown> | null;
}

let workerSocket: WebSocket | null = null;
const jobClients = new Map<string, Set<Response>>();

export function hasWorker(): boolean {
  return workerSocket !== null && workerSocket.readyState === WebSocket.OPEN;
}

export function sendToWorker(message: object): boolean {
  if (!hasWorker()) return false;
  workerSocket!.send(JSON.stringify(message));
  return true;
}

/** Registers an SSE response against one job and returns a cleanup function. */
export function addJobClient(jobId: string, res: Response): () => void {
  let clients = jobClients.get(jobId);
  if (!clients) {
    clients = new Set<Response>();
    jobClients.set(jobId, clients);
  }
  clients.add(res);

  return () => {
    const set = jobClients.get(jobId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) jobClients.delete(jobId);
  };
}

export function pushToJob(jobId: string, event: JobStreamEvent): void {
  const clients = jobClients.get(jobId);
  if (!clients || clients.size === 0) return;

  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

/* --------------------------------------------------- live progress digest */

/**
 * Per-job summary of a running transcript: the step number and the few words a
 * table row shows while the job works.
 *
 * Derived here, once per job, rather than in each browser: a table watching a
 * large batch used to open one stream per row and re-derive this from the whole
 * accumulated transcript on every token, which is what made a 200-file batch
 * unusable. See design-log/2026-09-25-parse-progress-multiplexing.md.
 */
interface JobProgress {
  /** Blank-line separators seen so far — i.e. how many steps have closed. */
  breaks: number;
  /** Trailing characters of the previous chunk, so a separator split across two
   *  chunks is still recognised. */
  carry: string;
  /** Recent transcript, capped: only the current step is ever read from it. */
  tail: string;
  timer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
}

const PROGRESS_THROTTLE_MS = 800;
const PROGRESS_TAIL_CHARS = 600;
const PROGRESS_CARRY_CHARS = 8;
const SNIPPET_WORDS = 7;

const jobProgress = new Map<string, JobProgress>();

/**
 * A run of blank lines separating two blocks. A run rather than a single blank
 * line, so a longer gap counts as one break — matching how `ReasoningStepper`
 * splits the same transcript with `/\n\n+/`.
 */
const STEP_BREAK = /\n[^\S\n]*(?:\n[^\S\n]*)+/g;

const countBreaks = (text: string): number => (text.match(STEP_BREAK) ?? []).length;

/** Strips markdown noise and clips to a few words, so the chip reads as a phrase. */
function summarize(line: string): string {
  const cleaned = line.replace(/[#*`_~>|[\]()\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const words = cleaned.split(' ');
  const text = words.slice(0, SNIPPET_WORDS).join(' ').replace(/[.,;:!?]+$/, '');
  return words.length > SNIPPET_WORDS ? `${text}…` : text;
}

function flushProgress(jobId: string): void {
  const progress = jobProgress.get(jobId);
  if (!progress || !progress.dirty) return;
  progress.dirty = false;

  // Everything after the last blank line is the step currently being written.
  const currentStep = progress.tail.split(STEP_BREAK).pop() ?? '';
  const lines = currentStep.split('\n').map(line => line.trim()).filter(Boolean);

  broadcast({
    type: 'parse_progress',
    parseJobId: jobId,
    step: Math.max(1, progress.breaks + (lines.length > 0 ? 1 : 0)),
    snippet: summarize(lines[lines.length - 1] ?? ''),
  });
}

function recordProgress(jobId: string, chunk: string): void {
  if (!chunk) return;

  let progress = jobProgress.get(jobId);
  if (!progress) {
    progress = { breaks: 0, carry: '', tail: '', timer: null, dirty: false };
    jobProgress.set(jobId, progress);
  }

  // Counting over `carry + chunk` and subtracting what `carry` already
  // contributed is what stops a "\n" + "\n" arriving separately from being
  // missed, without counting the same separator twice.
  const combined = progress.carry + chunk;
  progress.breaks += countBreaks(combined) - countBreaks(progress.carry);
  progress.carry = combined.slice(-PROGRESS_CARRY_CHARS);
  progress.tail = (progress.tail + chunk).slice(-PROGRESS_TAIL_CHARS);
  progress.dirty = true;

  if (progress.timer) return;
  progress.timer = setTimeout(() => {
    const current = jobProgress.get(jobId);
    if (current) current.timer = null;
    flushProgress(jobId);
  }, PROGRESS_THROTTLE_MS);
  if (typeof progress.timer.unref === 'function') progress.timer.unref();
}

/** Drops a finished job's digest. Exported for the abort path, which ends a run
 *  without the worker reporting anything. */
export function clearJobProgress(jobId: string): void {
  const progress = jobProgress.get(jobId);
  if (!progress) return;
  if (progress.timer) clearTimeout(progress.timer);
  jobProgress.delete(jobId);
}

/**
 * Appends to the job's transcript with a `$concat` pipeline update.
 *
 * `$push` cannot be used because `thinking` is a string, and read-modify-write
 * would drop tokens: they arrive faster than a round trip and several jobs may
 * be streaming at once.
 */
async function appendThinking(jobId: string, chunk: string): Promise<void> {
  await DocTidyParseJob.collection.updateOne({ _id: new Types.ObjectId(jobId) }, [
    { $set: { thinking: { $concat: [{ $ifNull: ['$thinking', ''] }, chunk] } } },
  ]);
}

/**
 * Tells every open results table that one job's chip changed. Exported because
 * the parse service announces the same transition when it queues a job, before
 * the worker has said anything.
 */
export function announceParseStatus(jobId: string, status: string): void {
  broadcast({ type: 'parse_status', parseJobId: jobId, parseStatus: status });
}

async function handleWorkerMessage(msg: WorkerMessage): Promise<void> {
  const { type, jobId } = msg;
  if (!type || !jobId) return;

  if (type === 'token') {
    const content = msg.content ?? '';
    const tokenType = msg.tokenType === 'output' ? 'output' : 'thinking';
    // Relay first: a slow database write must not delay or drop a live token.
    pushToJob(jobId, { type: tokenType, content });
    if (tokenType === 'thinking') {
      recordProgress(jobId, content);
      appendThinking(jobId, content).catch(err =>
        console.error('[doc-tidy worker] failed to persist reasoning for', jobId, err)
      );
    }
    return;
  }

  if (type === 'status') {
    const status = msg.status ?? 'processing';
    await DocTidyParseJob.updateOne({ _id: jobId }, { $set: { status } });
    pushToJob(jobId, { type: 'status', status });
    announceParseStatus(jobId, status);
    return;
  }

  if (type === 'complete') {
    // Guard: if the job was aborted while the worker was running, do not let
    // this late completion overwrite the user-requested failed status.
    const result = await DocTidyParseJob.updateOne(
      { _id: jobId, status: { $ne: 'failed' } },
      {
        $set: {
          status: 'completed',
          jsonOutput: msg.json ?? null,
          tableOutput: msg.table ?? null,
          error: null,
          completedAt: new Date(),
        },
      }
    );
    if (result.modifiedCount === 0) {
      // Job was already aborted — discard this stale completion silently.
      clearJobProgress(jobId);
      return;
    }
    clearJobProgress(jobId);
    pushToJob(jobId, { type: 'done', json: msg.json ?? null, table: msg.table ?? null });
    announceParseStatus(jobId, 'completed');
    // Fire-and-forget: write matched invoice fields onto any order imports that
    // correspond to this job's PO # + SKU.  Must not block the worker loop.
    writeMatchCacheForJob(jobId).catch(err =>
      console.error('[doc-tidy worker] failed to write invoice match cache for', jobId, err)
    );
    return;
  }

  if (type === 'error') {
    const message = msg.message ?? 'The agent failed to parse this document';
    // Same guard: don't overwrite a user-initiated abort with a generic error.
    await DocTidyParseJob.updateOne(
      { _id: jobId, status: { $ne: 'failed' } },
      { $set: { status: 'failed', error: message } }
    );
    clearJobProgress(jobId);
    pushToJob(jobId, { type: 'error', message });
    announceParseStatus(jobId, 'failed');
  }
}

/**
 * Re-dispatches everything still waiting. A worker restart loses whatever it was
 * holding, so this is how those jobs get picked back up without a user noticing.
 */
async function dispatchPending(): Promise<void> {
  const pending = await DocTidyParseJob.find({ status: 'pending' })
    .select('_id')
    .sort({ createdAt: 1 })
    .lean();

  for (const job of pending) {
    sendToWorker({ type: 'job', jobId: String(job._id) });
  }

  if (pending.length > 0) {
    console.log(`[doc-tidy worker] re-dispatched ${pending.length} pending job(s)`);
  }
}

function tokenFromRequest(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return '';
}

/**
 * Constant-time comparison that also tolerates a length mismatch, which
 * `timingSafeEqual` throws on.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Attaches the worker WebSocket endpoint to the HTTP server.
 *
 * The handshake is authenticated because this server is publicly reachable: an
 * open socket here would let anyone write extraction output for an arbitrary
 * job. Without a configured token the endpoint stays closed rather than open.
 */
export function startDocTidyWorkerServer(server: Server): WebSocketServer {
  const expectedToken = process.env.DOC_TIDY_WORKER_TOKEN ?? '';
  if (!expectedToken) {
    console.warn(
      '[doc-tidy worker] DOC_TIDY_WORKER_TOKEN is not set — the worker endpoint will reject every connection'
    );
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (!url.startsWith(WORKER_WS_PATH)) return;

    if (!expectedToken || !tokenMatches(tokenFromRequest(req), expectedToken)) {
      console.warn('[doc-tidy worker] rejected an unauthenticated worker connection');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', ws => {
    // One worker at a time. A second connection replaces the first rather than
    // being refused, so a worker that restarted before its old socket timed out
    // can still take over.
    if (workerSocket && workerSocket !== ws) {
      try {
        workerSocket.close();
      } catch {
        // Already closing.
      }
    }
    workerSocket = ws;
    console.log('[doc-tidy worker] connected');
    broadcast({ type: 'worker_status', workerOnline: true });

    ws.on('message', raw => {
      let msg: WorkerMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        console.warn('[doc-tidy worker] ignored a non-JSON message');
        return;
      }

      if (msg.type === 'ready') {
        dispatchPending().catch(err =>
          console.error('[doc-tidy worker] failed to re-dispatch pending jobs', err)
        );
        return;
      }

      handleWorkerMessage(msg).catch(err =>
        console.error('[doc-tidy worker] failed to handle a', msg.type, 'message', err)
      );
    });

    ws.on('close', () => {
      if (workerSocket === ws) {
        workerSocket = null;
        console.log('[doc-tidy worker] disconnected');
        broadcast({ type: 'worker_status', workerOnline: false });
      }
    });

    ws.on('error', err => console.error('[doc-tidy worker] socket error', err));
  });

  return wss;
}
