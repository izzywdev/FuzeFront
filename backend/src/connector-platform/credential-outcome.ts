/** Only verified credential persistence is a completed connection. */
export function credentialStoreOutcome(response: { status: number; data?: { status?: string } }): 'connected' | 'authorization_pending' {
  if (response.status === 202 && response.data?.status === 'authorization_pending') return 'authorization_pending'
  if (response.status === 200 && response.data?.status === 'updated') return 'connected'
  throw new Error('Credential storage was not confirmed')
}
