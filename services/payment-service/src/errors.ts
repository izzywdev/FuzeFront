/**
 * Errors surfaced by the neutral gateway.
 *
 * `NotImplemented` is the SCAFFOLD signal: an adapter method that has not yet
 * been wired to the vendor throws it, and the router maps it to HTTP 501 so the
 * frozen contract is fully navigable while the money path is still dark.
 */
export class NotImplemented extends Error {
  readonly code = 'NOT_IMPLEMENTED';
  constructor(call: string) {
    super(`payment-service: '${call}' is not implemented yet (gateway scaffold).`);
    this.name = 'NotImplemented';
  }
}

export function isNotImplemented(err: unknown): err is NotImplemented {
  return err instanceof NotImplemented || (err as { code?: string })?.code === 'NOT_IMPLEMENTED';
}
