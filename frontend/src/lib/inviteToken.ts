import { isSafeInviteToken } from './pendingInvite'

/**
 * The invitation token for this URL. The emailed link is `/invitations/<token>`;
 * `AppContent` renders the accept page outside a `<Route>`, so `useParams()` is
 * empty in production — read the path (and the frames' `?token=`) as the source
 * of truth and keep the router param as the in-router fast path.
 *
 * Only a bounded, path-safe opaque token is ever returned (`isSafeInviteToken`):
 * the value feeds a fetch URL and a sessionStorage entry, never markup.
 */
export function tokenFromLocation(
  param: string | undefined,
  pathname: string,
  search: string
): string | null {
  if (isSafeInviteToken(param) && param !== 'accept') return param
  const seg = /^\/invitations\/([^/?#]+)/.exec(pathname)?.[1]
  if (seg) {
    let decoded = ''
    try {
      decoded = decodeURIComponent(seg)
    } catch {
      return null
    }
    if (decoded !== 'accept' && isSafeInviteToken(decoded)) return decoded
  }
  const q = new URLSearchParams(search).get('token')
  return isSafeInviteToken(q) ? q : null
}
