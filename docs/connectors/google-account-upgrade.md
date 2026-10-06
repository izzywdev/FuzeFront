# Shared Google account upgrade

Gmail, Drive, Calendar, Contacts, Sheets, Docs, Slides and Tasks use one Google credential per FuzeFront user in FuzeKeys. Provider connection metadata and configuration remain separate. FuzeFront exchanges and refreshes tokens with its configured Google OAuth client; FuzeKeys never supplies an OAuth client secret to the caller.

The credential is bound to the stable Google `sub` returned by Google's HTTPS OIDC UserInfo endpoint and the configured OAuth client ID. Email is display metadata and never establishes account continuity. Connecting a second provider must use the same Google account and OAuth client. Its actual granted scope must include every still-connected provider's required resource scopes. Refresh retains an existing refresh token only after identity and client continuity are verified.

## Existing production connections

Deploy the matching FuzeKeys shared Google credential contract before deploying this runtime. Existing Gmail tokens lack this verified binding. The runtime returns `409 GOOGLE_REAUTHORIZATION_REQUIRED` for these credentials, including unexpired access tokens. This deliberately requires account-owner consent; rollout cannot be considered complete until the owner reconnects and a real provider read succeeds.

1. Reconnect Gmail with the intended Google account and grant offline mail access. A fresh refresh token is required to establish the legacy credential's binding.
2. If authorization reports conflicting legacy Google connections, disconnect those Google connectors first, then connect Gmail and the required providers again with the same account.
3. Changing Google accounts or OAuth clients requires disconnecting all existing Google provider connections before reconnecting. Do not migrate by matching email addresses or copying token blobs.
4. Verify Gmail's recent-message read, each required provider's read action, and a refreshed-token read before marking the connection operational.

Separate legacy provider vault entries are never silently coalesced. No runtime task can grant Google consent on behalf of the account owner. Missing scopes or unverifiable continuity produce a safe reconnect instruction rather than a merged credential or exposed upstream token response.
