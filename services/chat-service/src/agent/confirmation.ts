// confirmation.ts — in-memory pending-tool confirmation state machine
// (plan §6c, T4.5). A mutating tool the LLM wants to run is registered here as
// "pending"; the browser shows a ConfirmationCard and POSTs /chat/confirm/:id to
// release it. Pending entries expire after a TTL (default 5 min, plan §6c).
//
// Confirmation is owner-scoped: only the user who created the pending tool can
// confirm/cancel it (§10c/§10d — no cross-user confirmation). Each entry is
// single-use: confirming or cancelling removes it.
//
// In-memory is acceptable for the single-replica local/dev target; a Redis-backed
// store is the production follow-up (noted in the PR). The mutating tools that
// consume confirmations are deferred per the task brief — this store + route are
// the read-side state machine they will plug into.

import { randomUUID } from 'crypto';

export interface PendingTool {
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ConfirmationStoreOptions {
  /** Time-to-live for a pending confirmation, in ms. Default 5 minutes. */
  ttlMs?: number;
}

interface Entry extends PendingTool {
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class ConfirmationStore {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, Entry>();

  constructor(opts: ConfirmationStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Register a pending tool and return its confirmation id. */
  register(tool: PendingTool): { confirmationId: string } {
    const confirmationId = randomUUID();
    this.entries.set(confirmationId, {
      ...tool,
      expiresAt: Date.now() + this.ttlMs,
    });
    return { confirmationId };
  }

  /**
   * Confirm a pending tool. Returns the pending payload and consumes the entry,
   * or null if unknown / expired / not owned by `userId`.
   */
  confirm(confirmationId: string, userId: string): PendingTool | null {
    const entry = this.get(confirmationId);
    if (!entry || entry.userId !== userId) return null;
    this.entries.delete(confirmationId);
    return { userId: entry.userId, toolName: entry.toolName, args: entry.args };
  }

  /** Cancel a pending tool. Returns true if an owned entry was cleared. */
  cancel(confirmationId: string, userId: string): boolean {
    const entry = this.get(confirmationId);
    if (!entry || entry.userId !== userId) return false;
    this.entries.delete(confirmationId);
    return true;
  }

  /** Internal: fetch a non-expired entry, lazily evicting expired ones. */
  private get(confirmationId: string): Entry | null {
    const entry = this.entries.get(confirmationId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(confirmationId);
      return null;
    }
    return entry;
  }
}
