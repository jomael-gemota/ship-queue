import { Request, Response } from 'express';
import CookieJar, {
  MAX_JAR_NAME_LEN,
  isManualCookieJar,
  seedCookieJars,
  validateJarCron,
} from '../models/CookieJar';
import { executeCookieJar } from '../cookie-jar/run';
import { getFetcher } from '../cookie-jar/registry';

export interface CookieJarPublic {
  key: string;
  name: string;
  enabled: boolean;
  cron: string;
  hasCookie: boolean;
  hasFetcher: boolean;
  manual: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

function toPublic(doc: InstanceType<typeof CookieJar>): CookieJarPublic {
  return {
    key: doc.key,
    name: doc.name,
    enabled: doc.enabled,
    cron: doc.cron,
    hasCookie: Boolean(doc.get('cookie')),
    hasFetcher: Boolean(getFetcher(doc.key)),
    manual: isManualCookieJar(doc.key),
    lastRunAt: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
    lastSuccessAt: doc.lastSuccessAt ? doc.lastSuccessAt.toISOString() : null,
    lastError: doc.lastError ?? null,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** Any signed-in user may list jars. Cookie values are never included. */
export const listCookieJars = async (_req: Request, res: Response): Promise<void> => {
  try {
    await seedCookieJars();
    const rows = await CookieJar.find().select('+cookie').sort({ name: 1 });
    res.json({ data: rows.map(toPublic) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load cookie jars', error: (error as Error).message });
  }
};

/** Admin-only. Updates name / enabled / cron, and optionally the cookie (never returned). */
export const updateCookieJar = async (req: Request, res: Response): Promise<void> => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      res.status(400).json({ message: 'Jar key is required' });
      return;
    }

    const doc = await CookieJar.findOne({ key }).select('+cookie');
    if (!doc) {
      res.status(404).json({ message: 'Cookie jar not found' });
      return;
    }

    const { name, enabled, cron, cookie } = req.body as {
      name?: string;
      enabled?: boolean;
      cron?: string;
      cookie?: string;
    };
    if (name === undefined && enabled === undefined && cron === undefined && cookie === undefined) {
      res.status(400).json({ message: 'Provide name, enabled, cron, and/or cookie' });
      return;
    }

    if (name !== undefined) {
      if (typeof name !== 'string') {
        res.status(400).json({ message: 'Name must be a string' });
        return;
      }
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > MAX_JAR_NAME_LEN) {
        res.status(400).json({ message: `Name must be 1–${MAX_JAR_NAME_LEN} characters` });
        return;
      }
      doc.name = trimmed;
    }

    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ message: 'Enabled must be a boolean' });
        return;
      }
      doc.enabled = enabled;
    }

    if (cron !== undefined) {
      if (typeof cron !== 'string') {
        res.status(400).json({ message: 'Cron must be a string' });
        return;
      }
      const cronError = validateJarCron(cron);
      if (cronError) {
        res.status(400).json({ message: cronError });
        return;
      }
      doc.cron = cron.trim();
    }

    if (cookie !== undefined) {
      if (typeof cookie !== 'string') {
        res.status(400).json({ message: 'Cookie must be a string' });
        return;
      }
      doc.cookie = cookie.trim();
      if (doc.cookie) {
        doc.lastSuccessAt = new Date();
        doc.lastError = null;
      }
    }

    await doc.save();
    res.json({ data: toPublic(doc) });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message || 'Failed to update cookie jar' });
  }
};

/** Admin-only. Runs the fetcher immediately, ignoring the cron (and enabled flag). */
export const runCookieJarNow = async (req: Request, res: Response): Promise<void> => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      res.status(400).json({ message: 'Jar key is required' });
      return;
    }

    const existing = await CookieJar.findOne({ key }).select('key');
    if (!existing) {
      res.status(404).json({ message: 'Cookie jar not found' });
      return;
    }

    if (!getFetcher(key)) {
      res.status(400).json({ message: `No fetcher registered for key "${key}"` });
      return;
    }

    const { skipped } = await executeCookieJar(key);
    const doc = await CookieJar.findOne({ key }).select('+cookie');
    if (!doc) {
      res.status(404).json({ message: 'Cookie jar not found' });
      return;
    }

    res.json({
      data: toPublic(doc),
      skipped,
      message: skipped ? 'A run is already in progress' : undefined,
    });
  } catch (error) {
    res.status(500).json({ message: (error as Error).message || 'Failed to run cookie jar' });
  }
};
