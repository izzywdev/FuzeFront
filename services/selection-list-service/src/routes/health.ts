// health.ts — probes and scrape endpoint. All three are unauthenticated and
// mounted BEFORE the /v1 auth gate (app.ts), like /docs.
//
//   GET /health   LIVENESS. Cheap and dependency-free on purpose: if the event
//                 loop can answer, the process is alive. It must never touch the
//                 DB — a flapping dependency must not make the kubelet restart a
//                 healthy process.
//   GET /ready    READINESS. Checks the DB with a bounded timeout (SELECT 1).
//                 503 takes the pod out of the Service endpoints without
//                 restarting it. Bounded so a hung pool cannot hang the probe.
//   GET /metrics  Prometheus exposition (lib/metrics.ts).

import { Request, Response } from 'express';
import type { Knex } from 'knex';
import { db } from '../db';
import { createRouter } from '../lib/http';
import { getLog } from '../lib/logger';
import { renderMetrics } from '../lib/metrics';

const router = createRouter();

/** Upper bound for the readiness DB ping (env READY_DB_TIMEOUT_MS, default 2000ms). */
const parsedTimeout = Number.parseInt(process.env.READY_DB_TIMEOUT_MS ?? '', 10);
export const READY_DB_TIMEOUT_MS = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 2000;

export type DbCheck = 'ok' | 'timeout' | 'error';

/** SELECT 1 with a hard deadline. Never throws. */
export async function checkDb(
  conn: Pick<Knex, 'raw'> = db,
  timeoutMs: number = READY_DB_TIMEOUT_MS,
): Promise<DbCheck> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref?.();
  });
  try {
    const ping = Promise.resolve(conn.raw('select 1')).then(() => 'ok' as const);
    // If the deadline wins, the ping may still settle later; swallow it so a late
    // rejection is not an unhandled one.
    ping.catch(() => undefined);
    return await Promise.race([ping, deadline]);
  } catch {
    return 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// GET /health — liveness.
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'selection-list-service' });
});

// GET /ready — readiness (DB, bounded).
router.get('/ready', async (req: Request, res: Response) => {
  const dbState = await checkDb();
  if (dbState === 'ok') {
    res.json({ status: 'ready', service: 'selection-list-service', checks: { db: 'ok' } });
    return;
  }
  getLog(req).warn({ check: 'db', result: dbState, timeoutMs: READY_DB_TIMEOUT_MS }, 'readiness check failed — 503');
  res.status(503).json({ status: 'unavailable', service: 'selection-list-service', checks: { db: dbState } });
});

// GET /metrics — Prometheus.
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const { contentType, body } = await renderMetrics();
    res.set('Content-Type', contentType);
    res.end(body);
  } catch (err) {
    // Full error server-side only; the scraper gets a generic body.
    getLog(req).error({ err }, 'metrics collection failed');
    res.status(500).type('text/plain').end('# metrics collection failed\n');
  }
});

export default router;
