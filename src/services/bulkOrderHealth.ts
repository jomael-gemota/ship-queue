import { Cron } from 'croner';
import BulkOrderConfig, { BULK_ORDER_CONFIG_KEY, getOrCreateBulkOrderConfig } from '../models/BulkOrderConfig';
import { HhB2bAuthError, resolveHhB2bCookie } from '../lib/hhB2bConfig';
import { probeThorogoodSession } from '../lib/hhB2bThorogood';
import {
  HH_B2B_HEALTH_TIMEZONE,
  hhB2bAlertEvent,
  resolveSessionCheckTimes,
  type HhB2bAlertEvent,
  type HhB2bHealthStatus,
} from './hhB2bHealth';

const LOG = '[bulk-order-health]';
const WEBHOOK_TIMEOUT_MS = 10_000;
const MESSAGE_MAX = 500;
const BRAND = 'bulk-thorogood';

export class BulkOrderHealthBusyError extends Error {
  constructor() {
    super('A session check is already running.');
    this.name = 'BulkOrderHealthBusyError';
  }
}

export class BulkOrderWebhookTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkOrderWebhookTestError';
  }
}

interface AlertPayload {
  event: HhB2bAlertEvent;
  brand: string;
  name: string;
  supplier: string;
  status: HhB2bHealthStatus;
  message: string;
  checkedAt: string;
  latencyMs: number;
}

let inflight = false;
let schedulerStarted = false;
const boundChecks = new Map<string, { cron: string; job: Cron }>();

function truncate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MESSAGE_MAX) return trimmed;
  return `${trimmed.slice(0, MESSAGE_MAX - 1)}…`;
}

async function postAlert(url: string, payload: AlertPayload): Promise<string | null> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain',
        'User-Agent': 'ship-queue-bulk-order-health',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const detail = text.trim().slice(0, 180);
      return detail ? `Webhook returned ${res.status}: ${detail}` : `Webhook returned ${res.status}`;
    }
    return null;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return 'Webhook timed out';
    const message = err instanceof Error ? err.message : String(err);
    return truncate(message || 'Webhook request failed');
  } finally {
    clearTimeout(timerId);
  }
}

async function recordAlert(event: HhB2bAlertEvent, error: string | null): Promise<void> {
  await BulkOrderConfig.updateOne(
    { key: BULK_ORDER_CONFIG_KEY },
    {
      $set: {
        lastAlertAt: new Date(),
        lastAlertEvent: event,
        lastAlertError: error,
      },
    },
  );
}

async function classifyProbe(): Promise<{ status: HhB2bHealthStatus; message: string; latencyMs: number }> {
  const started = Date.now();
  const doc = await getOrCreateBulkOrderConfig(true);
  if (!doc.baseUrl || !doc.accountId) {
    return {
      status: 'down',
      message: 'Base URL or account ID is missing',
      latencyMs: Date.now() - started,
    };
  }
  const resolved = await resolveHhB2bCookie('thorogood', doc.cookie ?? '');
  if (!resolved.cookie) {
    const message =
      resolved.source === 'jar-empty'
        ? 'Thorogood B2B cookie jar is empty — wait for Cookie Jar to refresh, or paste a session.'
        : 'Thorogood B2B cookie is empty — paste a session or wait for Cookie Jar.';
    return { status: 'auth', message, latencyMs: Date.now() - started };
  }
  try {
    await probeThorogoodSession(doc.baseUrl, resolved.cookie, doc.accountId);
    return {
      status: 'ok',
      message: 'Session accepted and the customer API responded',
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof HhB2bAuthError) return { status: 'auth', message: truncate(err.message), latencyMs };
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'down', message: truncate(message || 'B2B request failed'), latencyMs };
  }
}

export async function runBulkOrderHealthCheck(): Promise<void> {
  if (inflight) throw new BulkOrderHealthBusyError();
  inflight = true;
  try {
    const doc = await getOrCreateBulkOrderConfig(false);
    const previous = doc.sessionCheckStatus || '';
    const webhookUrl = (doc.alertWebhookUrl || '').trim();
    const probe = await classifyProbe();
    const checkedAt = new Date();

    await BulkOrderConfig.updateOne(
      { key: BULK_ORDER_CONFIG_KEY },
      {
        $set: {
          sessionCheckStatus: probe.status,
          sessionCheckedAt: checkedAt,
          sessionCheckLatencyMs: probe.latencyMs,
          sessionCheckMessage: probe.message,
        },
      },
    );

    const event = hhB2bAlertEvent(previous, probe.status);
    if (probe.status === 'ok' && previous !== 'ok') {
      console.log(`${LOG} ok (${probe.latencyMs}ms)`);
    } else if (probe.status !== 'ok' && event) {
      console.warn(`${LOG} ${probe.status} — ${probe.message}`);
    }
    if (!event) return;
    if (!webhookUrl) {
      console.log(`${LOG} ${event} — no webhook URL configured`);
      return;
    }

    const error = await postAlert(webhookUrl, {
      event,
      brand: BRAND,
      name: 'Thorogood',
      supplier: 'Thorogood',
      status: probe.status,
      message: probe.message,
      checkedAt: checkedAt.toISOString(),
      latencyMs: probe.latencyMs,
    });
    await recordAlert(event, error);
    if (error) console.warn(`${LOG} webhook ${event} failed — ${error}`);
    else console.log(`${LOG} webhook ${event}`);
  } finally {
    inflight = false;
  }
}

export async function sendBulkOrderWebhookTest(): Promise<void> {
  const doc = await getOrCreateBulkOrderConfig(false);
  const webhookUrl = (doc.alertWebhookUrl || '').trim();
  if (!webhookUrl) throw new BulkOrderWebhookTestError('Save an alert webhook URL first.');
  const error = await postAlert(webhookUrl, {
    event: 'test',
    brand: BRAND,
    name: 'Thorogood',
    supplier: 'Thorogood',
    status: 'ok',
    message: 'Test alert from Configurations. The session was not checked.',
    checkedAt: new Date().toISOString(),
    latencyMs: 0,
  });
  await recordAlert('test', error);
  if (error) console.warn(`${LOG} webhook test failed — ${error}`);
  else console.log(`${LOG} webhook test sent`);
}

function stopCheck(key: string): void {
  const current = boundChecks.get(key);
  if (!current) return;
  current.job.stop();
  boundChecks.delete(key);
}

export async function reconcileBulkOrderHealthSchedule(): Promise<void> {
  if (process.env.HH_B2B_HEALTH_DISABLED === '1') {
    for (const key of Array.from(boundChecks.keys())) stopCheck(key);
    return;
  }

  const doc = await getOrCreateBulkOrderConfig(false);
  const times = resolveSessionCheckTimes(doc.sessionCheckTimes, Boolean(doc.sessionCheckTimesSet));
  const desired = new Map<string, string>();
  if (times.length === 0) console.log(`${LOG} has no daily check`);
  for (const time of times) {
    const [hour, minute] = time.split(':');
    desired.set(time, `${Number(minute)} ${Number(hour)} * * *`);
  }

  for (const key of Array.from(boundChecks.keys())) {
    const next = desired.get(key);
    const current = boundChecks.get(key);
    if (!next || !current || next !== current.cron) stopCheck(key);
  }

  for (const [time, cron] of desired) {
    if (boundChecks.has(time)) continue;
    const job = new Cron(
      cron,
      {
        timezone: HH_B2B_HEALTH_TIMEZONE,
        mode: '5-part',
        protect: true,
        catch: (err) => {
          console.error(`${LOG} ${time} unhandled cron error:`, err);
        },
      },
      () => {
        void runBulkOrderHealthCheck().catch((err) => {
          if (err instanceof BulkOrderHealthBusyError) {
            console.log(`${LOG} Skipping — a check is already running`);
            return;
          }
          console.error(`${LOG} check failed`, err);
        });
      },
    );
    boundChecks.set(time, { cron, job });
    console.log(`${LOG} daily at ${time} PHT`);
  }
}

export function startBulkOrderHealthScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (process.env.HH_B2B_HEALTH_DISABLED === '1') {
    console.log(`${LOG} Disabled (HH_B2B_HEALTH_DISABLED=1)`);
    return;
  }
  void reconcileBulkOrderHealthSchedule().catch((err) => {
    console.error(`${LOG} Failed to schedule session checks`, err);
  });
}
