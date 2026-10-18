/**
 * Reproduces the previous `handleCredentialsSubmit` catch block's error-message
 * taxonomy (timeout / provider-outage 503 / rejected-credentials 401 / network
 * / 500 / fallback) so AuthPanel — which just surfaces `Error.message` as-is —
 * shows the exact same wording as before. Kept here (not in AuthPanel) because
 * it is a mapping of THIS app's axios/Security-API error shapes, not a
 * generic UI concern. Shared by LoginPage and the invitation sign-up
 * (AcceptInvitePageV2) so both surface identical wording.
 */
export function mapAuthError(err: any): string {
  const isTimeout = err?.code === 'ECONNABORTED' || err?.name === 'CanceledError'
  const isNetworkError = !isTimeout && (err?.code === 'NETWORK_ERROR' || !err?.response)
  const status = err?.response?.status

  if (isTimeout) {
    // The request was bounded and did not answer in time — this is NOT "you
    // typed the wrong password"; word it as a service condition.
    return 'Sign-in is taking longer than expected — the service may be busy. Please try again.'
  }
  if (status === 503) {
    // The Security API distinguishes a provider outage from a rejected
    // credential (503 PROVIDER_UNAVAILABLE vs 401) — say the true thing and
    // nothing else, never mention credentials.
    return err?.response?.data?.code === 'PROVIDER_UNAVAILABLE'
      ? 'The sign-in service is temporarily unavailable. Your details are fine — please try again in a moment.'
      : err?.response?.data?.error ||
          'The sign-in service is temporarily unavailable. Please try again in a moment.'
  }
  if (status === 401) {
    // Genuinely means "these credentials were rejected" (outage moved to 503
    // above). Deliberately doesn't name WHICH field is wrong.
    return 'Incorrect email or password. Please try again.'
  }
  if (isNetworkError) {
    return (
      (err?.message || 'Authentication failed') +
      ' (Network connection failed — check if the service is running)'
    )
  }
  if (status === 500) {
    return (
      (err?.response?.data?.error || err?.message || 'Authentication failed') +
      ' (Server error — please try again shortly)'
    )
  }
  return err?.response?.data?.error || err?.message || 'Authentication failed'
}
