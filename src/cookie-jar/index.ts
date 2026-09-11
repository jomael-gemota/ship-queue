import '../config/env';
import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { seedCookieJars } from '../models/CookieJar';
import { startHealthServer } from './health';
import { startCookieJarScheduler, stopCookieJarScheduler } from './scheduler';

const start = async (): Promise<void> => {
  await connectDB();
  await seedCookieJars();

  const server = startHealthServer();
  await startCookieJarScheduler();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cookie-jar] ${signal} received, shutting down`);
    stopCookieJarScheduler();
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
};

start().catch((err) => {
  console.error('[cookie-jar] Failed to start:', err);
  process.exit(1);
});
