import { Button, DataTable, EmptyState, Textarea } from '@fuzefront/design-system'
import { useState } from 'react'

export interface Mention {
  id: string
  sender: string
  message: string
  pageUrl: string
  componentXPath: string
  status: 'unread' | 'read'
  createdAt: string
}

export function MentionsTable({ mentions, loading, onOpen, onRead, onReply }: {
  mentions: Mention[]
  loading?: boolean
  onOpen: (mention: Mention) => void
  onRead: (mention: Mention) => void
  onReply: (mention: Mention, message: string) => Promise<void>
}) {
  const [selected, setSelected] = useState<Mention | null>(null)
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const select = (mention: Mention) => { setSelected(mention); onRead(mention) }
  const sendReply = async () => {
    if (!selected || !reply.trim()) return
    setSubmitting(true)
    try { await onReply(selected, reply.trim()); setReply('') } finally { setSubmitting(false) }
  }
  return <>
    <DataTable
      columns={[{ key: 'sender', header: 'From' }, { key: 'message', header: 'Message' }, { key: 'status', header: 'Status' }, { key: 'actions', header: 'Actions', align: 'right' }]}
      loading={loading}
      emptyState={<EmptyState title="No mentions yet" body="Mentions sent to your email will appear here." />}
    >
      <tbody>{mentions.map(mention => <tr key={mention.id}>
        <td>{mention.sender}</td><td><button type="button" onClick={() => select(mention)}>{mention.message}</button></td><td>{mention.status}</td>
        <td><Button variant="secondary" onClick={() => onOpen(mention)}>Open page</Button></td>
      </tr>)}</tbody>
    </DataTable>
    {selected && <section aria-label="Mention details">
      <h2>Selected mention</h2><p>{selected.message}</p><p><a href={selected.pageUrl} target="_blank" rel="noreferrer">{selected.pageUrl}</a></p><code>{selected.componentXPath}</code>
      <Textarea aria-label="Reply to sender" value={reply} onChange={event => setReply(event.target.value)} placeholder="Reply to the sender" />
      <Button variant="primary" disabled={!reply.trim() || submitting} onClick={sendReply}>{submitting ? 'Sending…' : 'Reply'}</Button>
    </section>}
  </>
}
