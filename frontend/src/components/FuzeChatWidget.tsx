import { useMemo } from 'react'
import { ChatServiceClient } from '@fuzefront/chat-client'
import { ChatWidget } from '@fuzefront/chat-ui'
import '@fuzefront/chat-ui/styles.css'
import { useOrganizations } from '../lib/shared'

// Chat-service base URL. Same-origin by default: the in-pod / ingress nginx
// proxies /chat-api/ -> fuzefront-chat-service:3006/ (see frontend/nginx.conf),
// so the SSE stream stays same-origin and protocol-correct under TLS. VITE_CHAT_URL
// overrides for cross-origin / local dev against a directly-exposed service.
const CHAT_BASE_URL =
  (import.meta.env.VITE_CHAT_URL as string | undefined) ||
  (typeof window !== 'undefined' ? `${window.location.origin}/chat-api` : 'http://localhost:3006')

/**
 * FuzeChatWidget — the shell's mount point for the design-system chat assistant.
 *
 * Owns nothing but wiring: it builds the typed ChatServiceClient (same-origin
 * base + the live auth token) and the tenant context, then hands them to the
 * reusable @fuzefront/chat-ui <ChatWidget/>. All UI/state lives in the package;
 * this component only injects host concerns (auth, org, error surfacing).
 */
export function FuzeChatWidget() {
  const { activeOrganizationId } = useOrganizations()

  const client = useMemo(
    () =>
      new ChatServiceClient({
        baseUrl: CHAT_BASE_URL,
        getToken: () => localStorage.getItem('authToken'),
      }),
    [],
  )

  // No active org yet (pre-provisioning) -> don't mount the assistant.
  if (!activeOrganizationId) return null

  return (
    <ChatWidget
      client={client}
      orgId={activeOrganizationId}
      appId="fuzefront"
      onError={message => window.__FUZEFRONT__?.notify?.({ level: 'error', message })}
    />
  )
}

export default FuzeChatWidget
