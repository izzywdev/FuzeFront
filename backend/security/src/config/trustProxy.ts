/**
 * Number of trusted reverse-proxy hops in front of the security service.
 *
 * Express derives `req.ip` from X-Forwarded-For by skipping this many hops from
 * the RIGHT (the entries our own proxies appended), so anything a client puts on
 * the LEFT of the header is ignored. Rate limiters key on `req.ip`, so this must
 * equal the real hop count: too high lets a client choose its own limiter key
 * (spoofing, one limiter bucket per fake address); too low collapses every user
 * behind the ingress into one bucket.
 *
 * Default 1 = the single k8s ingress hop (FuzeFront deploys behind one ingress
 * controller). It is declared HERE, explicitly, and overridable with
 * `TRUST_PROXY_HOPS` if the edge topology changes (e.g. a CDN in front => 2).
 * A malformed value fails startup rather than silently falling back.
 */
export const DEFAULT_TRUST_PROXY_HOPS = 1

export function resolveTrustProxyHops(raw: string | undefined = process.env.TRUST_PROXY_HOPS): number {
  if (raw === undefined || raw === '') return DEFAULT_TRUST_PROXY_HOPS
  if (!/^\d+$/.test(raw) || Number(raw) > 10) {
    throw new Error(`TRUST_PROXY_HOPS must be an integer 0-10, got "${raw}"`)
  }
  return Number(raw)
}
