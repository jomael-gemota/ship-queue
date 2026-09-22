import { Cron } from 'croner';
import HHB2bConfig, { getOrCreateHhB2bConfig } from '../models/HHB2bConfig';
import { hhBrand, HH_BRAND_IDS, type HHBrandId } from '../lib/hhBrand';
import { HhB2bAuthError, loadHhB2bConfig, loadHhB2bCookie } from '../lib/hhB2bConfig';
import { probeHhB2bSession } from '../lib/hhB2bHellyHansen';

const LOG = '[hh-b2b-health]';
export const HH_B2B_HEALTH_TIMEZONE = 'Asia/Manila';
export const HH_B2B_HEALTH_DEFAULT_TIMES = ['20:00', '04:00'];
const MAX_CHECK_TIMES = 12;
const WEBHOOK_TIMEOUT_MS = 10_000;
const MESSAGE_MAX = 500;

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export type HhB2bHealthStatus = 'ok' | 'auth' | 'down';
export type HhB2bAlertEvent = 'failed' | 'recovered' | 'test';

export class HhB2bHealthBusyError extends Error {
  constructor() {
    super('A session check is already running.');
    this.name = 'HhB2bHealthBusyError';
  }
}

export class HhB2bWebhookTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HhB2bWebhookTestError';
  }
}

export interface HhB2bAlertPayload {
  event: HhB2bAlertEvent;
  brand: HHBrandId;
  name: string;
  supplier: string;
  status: HhB2bHealthStatus;
  message: string;
  checkedAt: string;
  latencyMs: number;
}

const inflight = new Set<HHBrandId>();

interface BoundCheck {
  cron: string;
  job: Cron;
}

const boundChecks = new Map<string, BoundCheck>();
let schedulerStarted = false;

function truncate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MESSAGE_MAX) return trimmed;
  return `${trimmed.slice(0, MESSAGE_MAX - 1)}…`;
}

function isFailureStatus(status: string): status is 'auth' | 'down' {
  return status === 'auth' || status === 'down';
}

/** Notify on a new failure, a change of failure kind, or a recovery. Repeat failures stay quiet. */
export function hhB2bAlertEvent(previous: string, next: HhB2bHealthStatus): HhB2bAlertEvent | null {
  const wasFailing = isFailureStatus(previous);
  const failing = isFailureStatus(next);
  if (failing && !wasFailing) return 'failed';
  if (failing && wasFailing && previous !== next) return 'failed';
  if (!failing && wasFailing) return 'recovered';
  return null;
}

/** Until a time list is saved, use 8:00 PM and 4:00 AM Philippines. A saved empty list means no daily check. */
export function resolveSessionCheckTimes(stored: unknown, configured: boolean): string[] {
  if (!configured) return [...HH_B2B_HEALTH_DEFAULT_TIMES];
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is string => typeof item === 'string');
}

export function parseSessionCheckTimes(value: unknown): { times: string[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'Check times must be a list.' };
  if (value.length > MAX_CHECK_TIMES) return { error: `At most ${MAX_CHECK_TIMES} check times.` };
  const times: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return { error: 'Each check time must be HH:MM.' };
    const match = /^(\d{1,2}):(\d{2})$/.exec(item.trim());
    if (!match) return { error: 'Each check time must be HH:MM in 24-hour time.' };
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return { error: 'Each check time must be a valid clock time.' };
    const normalized = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (seen.has(normalized)) return { error: `${normalized} is listed more than once.` };
    seen.add(normalized);
    times.push(normalized);
  }
  return { times };
}

function isLinkLocal(host: string): boolean {
  return host.startsWith('169.254.') || host.toLowerCase().startsWith('fe80:');
}

export function parseAlertWebhookUrl(value: string): { url: string } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { url: '' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'Webhook URL must be an http(s) URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: 'Webhook URL must be an http(s) URL.' };
  }
  if (parsed.username || parsed.password) {
    return { error: 'Webhook URL cannot include a username or password.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.startsWith('127.') || host.endsWith('.localhost') || isLinkLocal(host)) {
    return { error: 'Webhook URL cannot point at this machine or a link-local address.' };
  }
  return { url: parsed.toString() };
}

async function postAlert(url: string, payload: HhB2bAlertPayload): Promise<string | null> {
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
        'User-Agent': 'ship-queue-b2b-health',
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

async function classifyProbe(brand: HHBrandId): Promise<{ status: HhB2bHealthStatus; message: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const config = await loadHhB2bConfig(brand);
    if (!config.baseUrl || !config.catalog || !config.accountId) {
      return { status: 'down', message: 'B2B base URL, catalog, or account id is missing', latencyMs: Date.now() - started };
    }
    const cookie = await loadHhB2bCookie(brand);
    await probeHhB2bSession(config, cookie);
    return { status: 'ok', message: 'Session accepted and the catalog API responded', latencyMs: Date.now() - started };
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof HhB2bAuthError) {
      return { status: 'auth', message: truncate(err.message), latencyMs };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'down', message: truncate(message || 'B2B request failed'), latencyMs };
  }
}

export async function runHhB2bHealthCheck(brand: HHBrandId): Promise<void> {
  if (inflight.has(brand)) throw new HhB2bHealthBusyError();
  inflight.add(brand);
  try {
    const def = hhBrand(brand);
    const doc = await getOrCreateHhB2bConfig(brand, false);
    const previous = doc.sessionCheckStatus || '';
    const webhookUrl = (doc.alertWebhookUrl || '').trim();
    const probe = await classifyProbe(brand);
    const checkedAt = new Date();

    await HHB2bConfig.updateOne(
      { key: def.configKey },
      {
        $set: {
          sessionCheckStatus: probe.status,
          sessionCheckedAt: checkedAt,
          sessionCheckLatencyMs: probe.latencyMs,
          sessionCheckMessage: probe.message,
        },
      }
    );

    const event = hhB2bAlertEvent(previous, probe.status);
    if (probe.status === 'ok' && previous !== 'ok') {
      console.log(`${LOG} ${brand} ok (${probe.latencyMs}ms)`);
    } else if (probe.status !== 'ok' && event) {
      console.warn(`${LOG} ${brand} ${probe.status} — ${probe.message}`);
    }

    if (!event) return;

    if (!webhookUrl) {
      console.log(`${LOG} ${brand} ${event} — no webhook URL configured`);
      return;
    }

    const payload: HhB2bAlertPayload = {
      event,
      brand,
      name: def.name,
      supplier: def.supplier,
      status: probe.status,
      message: probe.message,
      checkedAt: checkedAt.toISOString(),
      latencyMs: probe.latencyMs,
    };
    const error = await postAlert(webhookUrl, payload);
    await recordAlert(def.configKey, event, error);
    if (error) console.warn(`${LOG} ${brand} webhook ${event} failed — ${error}`);
    else console.log(`${LOG} ${brand} webhook ${event}`);
  } finally {
    inflight.delete(brand);
  }
}

async function recordAlert(configKey: string, event: HhB2bAlertEvent, error: string | null): Promise<void> {
  await HHB2bConfig.updateOne(
    { key: configKey },
    {
      $set: {
        lastAlertAt: new Date(),
        lastAlertEvent: event,
        lastAlertError: error,
      },
    }
  );
}

/** POST a test payload to the saved webhook. Does not call Helly Hansen. */
export async function sendHhB2bWebhookTest(brand: HHBrandId): Promise<void> {
  const def = hhBrand(brand);
  const doc = await getOrCreateHhB2bConfig(brand, false);
  const webhookUrl = (doc.alertWebhookUrl || '').trim();
  if (!webhookUrl) {
    throw new HhB2bWebhookTestError('Save an alert webhook URL first.');
  }
  const payload: HhB2bAlertPayload = {
    event: 'test',
    brand,
    name: def.name,
    supplier: def.supplier,
    status: 'ok',
    message: 'Test alert from Configurations. The B2B session was not checked.',
    checkedAt: new Date().toISOString(),
    latencyMs: 0,
  };
  const error = await postAlert(webhookUrl, payload);
  await recordAlert(def.configKey, 'test', error);
  if (error) console.warn(`${LOG} ${brand} webhook test failed — ${error}`);
  else console.log(`${LOG} ${brand} webhook test sent`);
}

function checkKey(brand: HHBrandId, time: string): string {
  return `${brand}|${time}`;
}

function stopCheck(key: string): void {
  const current = boundChecks.get(key);
  if (!current) return;
  current.job.stop();
  boundChecks.delete(key);
}

export async function reconcileHhB2bHealthSchedule(): Promise<void> {
  if (process.env.HH_B2B_HEALTH_DISABLED === '1') {
    for (const key of Array.from(boundChecks.keys())) stopCheck(key);
    return;
  }

  const desired = new Map<string, { brand: HHBrandId; cron: string; time: string }>();
  for (const brand of HH_BRAND_IDS) {
    const doc = await getOrCreateHhB2bConfig(brand, false);
    const times = resolveSessionCheckTimes(doc.sessionCheckTimes, Boolean(doc.sessionCheckTimesSet));
    if (times.length === 0) console.log(`${LOG} ${brand} has no daily check`);
    for (const time of times) {
      const [hour, minute] = time.split(':');
      desired.set(checkKey(brand, time), {
        brand,
        time,
        cron: `${Number(minute)} ${Number(hour)} * * *`,
      });
    }
  }

  for (const key of Array.from(boundChecks.keys())) {
    const next = desired.get(key);
    const current = boundChecks.get(key);
    if (!next || !current || next.cron !== current.cron) stopCheck(key);
  }

  for (const [key, next] of desired) {
    if (boundChecks.has(key)) continue;
    const job = new Cron(
      next.cron,
      {
        timezone: HH_B2B_HEALTH_TIMEZONE,
        mode: '5-part',
        protect: true,
        catch: (err) => {
          console.error(`${LOG} ${next.brand} ${next.time} unhandled cron error:`, err);
        },
      },
      () => {
        void runHhB2bHealthCheck(next.brand).catch((err) => {
          if (err instanceof HhB2bHealthBusyError) {
            console.log(`${LOG} Skipping ${next.brand} — a check is already running`);
            return;
          }
          console.error(`${LOG} ${next.brand} check failed`, err);
        });
      }
    );
    boundChecks.set(key, { cron: next.cron, job });
    console.log(`${LOG} ${next.brand} daily at ${next.time} PHT`);
  }
}

export function startHhB2bHealthScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (process.env.HH_B2B_HEALTH_DISABLED === '1') {
    console.log(`${LOG} Disabled (HH_B2B_HEALTH_DISABLED=1)`);
    return;
  }
  void reconcileHhB2bHealthSchedule().catch((err) => {
    console.error(`${LOG} Failed to schedule session checks`, err);
  });
}

export function stopHhB2bHealthScheduler(): void {
  for (const key of Array.from(boundChecks.keys())) stopCheck(key);
  schedulerStarted = false;
}
