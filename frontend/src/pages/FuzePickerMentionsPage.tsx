import { Alert, SectionHead } from '@fuzefront/design-system'
import { MentionsTable, type Mention } from '@fuzefront/fuzepicker-ui'
import { useEffect, useState } from 'react'
import { getActiveAuthToken } from '../lib/accounts'

const endpoint = '/api/fuzepicker/mentions'
async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getActiveAuthToken() || ''}`, ...(init?.headers || {}) } })
  if (!response.ok && response.status !== 204) throw new Error('Unable to complete the FuzePicker request.')
  return response.status === 204 ? undefined : response.json()
}

export default function FuzePickerMentionsPage() {
  const [mentions, setMentions] = useState<Mention[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const token = getActiveAuthToken()
    // Keep the extension on the same API origin as the shell. Local Docker
    // development sets VITE_API_URL while production uses same-origin ingress.
    const apiOrigin = import.meta.env.VITE_API_URL || window.location.origin
    if (token) window.postMessage({ type: 'FUZE_PICKER_CONNECT', token, apiOrigin }, window.location.origin)
    request(endpoint).then(data => setMentions(data.mentions)).catch(err => setError(err.message)).finally(() => setLoading(false))
  }, [])
  return <main>
    <SectionHead kicker="FuzePicker" title="Mentions" description="Open the exact page and component another collaborator shared with you." />
    {error && <Alert tone="error">{error}</Alert>}
    <MentionsTable mentions={mentions} loading={loading} onOpen={mention => window.open(mention.pageUrl, '_blank', 'noopener,noreferrer')} onRead={mention => {
      if (mention.status === 'unread') { request(`${endpoint}/${mention.id}/read`, { method: 'POST' }).catch(() => undefined); setMentions(current => current.map(item => item.id === mention.id ? { ...item, status: 'read' } : item)) }
    }} onReply={async (mention, message) => { await request(`${endpoint}/${mention.id}/replies`, { method: 'POST', body: JSON.stringify({ message }) }) }} />
  </main>
}
