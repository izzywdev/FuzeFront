import { Response } from 'express';
import { NotificationDTO } from '../db/repositories/notifications';

/**
 * StreamHub — the in-process registry of open SSE connections, keyed by user.
 *
 * SSE rather than WebSockets: the stream is one-directional server→client, it
 * needs no protocol upgrade through the ingress, and `EventSource` handles
 * reconnection itself. The client re-fetches the unread count on reconnect, so
 * an event missed during a drop self-heals instead of leaving the badge
 * permanently low.
 *
 * SCOPE: in-process. With more than one replica a publish only reaches clients
 * attached to the SAME pod. That is a deliberate, bounded degradation, not an
 * oversight: a missed live push costs at most a delayed badge, which the
 * client's own reconnect/refetch corrects, and the inbox read is always
 * authoritative from Postgres. Making it cross-pod means a Redis pub/sub fan-out
 * — additive, and worth doing when replicas > 1 (see the plan doc).
 */

export interface StreamClient {
  userId: string;
  res: Response;
  heartbeat: NodeJS.Timeout;
}

export class StreamHub {
  private readonly clients = new Map<string, Set<StreamClient>>();

  constructor(
    private readonly heartbeatMs: number,
    private readonly maxPerUser: number
  ) {}

  /**
   * Attach a connection. Returns null when the user is already at
   * `maxPerUser` — a bound, not a nicety: without it a client stuck in a
   * reconnect loop can pin every socket on the pod.
   */
  add(userId: string, res: Response): StreamClient | null {
    const existing = this.clients.get(userId) ?? new Set<StreamClient>();
    if (existing.size >= this.maxPerUser) return null;

    // A comment frame every heartbeat: proxies reap an idle connection, and a
    // silently dead stream is worse than no stream (the client believes it is
    // live and never falls back to polling the count).
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        this.remove(client);
      }
    }, this.heartbeatMs);
    // Do not hold the event loop open on the heartbeat alone.
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    const client: StreamClient = { userId, res, heartbeat };
    existing.add(client);
    this.clients.set(userId, existing);
    return client;
  }

  remove(client: StreamClient): void {
    clearInterval(client.heartbeat);
    const set = this.clients.get(client.userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.clients.delete(client.userId);
  }

  /** Push one notification to every stream this user has open on THIS pod. */
  publish(userId: string, notification: NotificationDTO): void {
    const set = this.clients.get(userId);
    if (!set || set.size === 0) return;

    const frame = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
    for (const client of Array.from(set)) {
      try {
        client.res.write(frame);
      } catch {
        // A write to a half-closed socket must not take the publish loop down
        // with it — drop that client and keep delivering to the rest.
        this.remove(client);
      }
    }
  }

  countFor(userId: string): number {
    return this.clients.get(userId)?.size ?? 0;
  }

  get size(): number {
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }

  /** Close every stream — used on shutdown so pods drain cleanly. */
  closeAll(): void {
    for (const set of this.clients.values()) {
      for (const client of set) {
        clearInterval(client.heartbeat);
        try {
          client.res.end();
        } catch {
          /* already gone */
        }
      }
    }
    this.clients.clear();
  }
}
