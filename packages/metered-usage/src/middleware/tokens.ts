import type { MeteringClient } from '../client';

/**
 * Emit a token-consumption usage event.
 *
 * Call this at the point where you know the token count for an LLM inference
 * call (or other token-counted operation).  The call is fire-and-forget;
 * errors are swallowed inside MeteringClient.emit().
 *
 * @param client      - the MeteringClient instance for the service
 * @param entityId    - the billable entity (org id or user id)
 * @param tokens      - number of tokens consumed
 * @param entityType  - 'organization' | 'user' (default: 'organization')
 *
 * @example
 * ```ts
 * const result = await llm.complete(prompt);
 * emitTokenUsage(client, req.user.orgId, result.usage.totalTokens);
 * ```
 */
export function emitTokenUsage(
  client: MeteringClient,
  entityId: string,
  tokens: number,
  entityType: 'organization' | 'user' = 'organization',
): void {
  client
    .emit({
      meterEventName: 'tokens_consumed',
      quantity: tokens,
      entityType,
      entityId,
      timestamp: new Date().toISOString(),
    })
    .catch(() => {
      // MeteringClient.emit() swallows errors internally — this is an extra
      // safety net for synchronous throw paths.
    });
}

/**
 * Emit a storage-usage event.
 *
 * Call this when you write to or read from durable storage and wish to record
 * the bytes transferred.
 *
 * @param client      - the MeteringClient instance for the service
 * @param entityId    - the billable entity (org id or user id)
 * @param bytes       - bytes written or read
 * @param entityType  - 'organization' | 'user' (default: 'organization')
 *
 * @example
 * ```ts
 * const written = await s3.putObject({ Body: buffer, ... });
 * emitStorageUsage(client, req.user.orgId, buffer.byteLength);
 * ```
 */
export function emitStorageUsage(
  client: MeteringClient,
  entityId: string,
  bytes: number,
  entityType: 'organization' | 'user' = 'organization',
): void {
  client
    .emit({
      meterEventName: 'storage_bytes',
      quantity: bytes,
      entityType,
      entityId,
      timestamp: new Date().toISOString(),
    })
    .catch(() => {
      // belt-and-suspenders — see emitTokenUsage
    });
}
