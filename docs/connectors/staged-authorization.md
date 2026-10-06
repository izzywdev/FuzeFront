# Pending connection approval

FuzeKeys can return HTTP 202 with status authorization_pending when a secret-free connector registration awaits reviewed instance authorization. This response does not mean credentials were stored. Front forwards the pending API status and redirects OAuth completion with authorization_pending rather than connected. Only HTTP 200 with status updated confirms storage.

The page says that connection approval is pending and asks the user to contact their administrator, then connect again. API key input is cleared after the pending response; OAuth material is not cached for later replay. Initial status reads may be denied before the exact instance read grant exists; the explicit callback or current pending response remains visibly pending rather than connected. Once reviewed grants exist, the user repeats connection/provider authorization. No secret is persisted until Keys establishes exact create and write_credential allows.

This UI does not provision grants or identify a tenant. The existing reviewed organization configuration and Security membership verification remain mandatory. Production smoke tests must verify 202 registration without vault writes, operator provisioning, successful retry, and different-owner/different-tenant denial.
