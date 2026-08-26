import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { ConfigSecretAuditFlow, ConfigI18nProvider } from '@fuzefront/config-ui'

/**
 * `/admin/config/keys/:key/history` (flag `fuzefront.config.secrets-audit`) —
 * change history + revert, frame 09 (flow `secret-audit`).
 *
 * HONEST CONSTRAINT: `GET /v1/config/history` and the revert write-path are
 * anticipated (FF-EPIC-18-S2/S3) but do NOT exist in the frozen
 * `services/config-service/openapi.yaml` today. Rather than fabricate a
 * client method against a nonexistent endpoint, this page renders the same
 * `history-error` state the component defines for a genuine load failure,
 * with an honest message — never claiming a plaintext load attempt that
 * didn't happen. Wiring a real `GET /v1/config/history` call (and `onRevert`
 * as a replayed `set`/`unset` through `client.writeConfigValues`) is a
 * follow-up the moment that endpoint ships; `ConfigSecretAuditFlow` itself
 * needs no change to consume it — only this page's data source does.
 */
function ConfigAuditHistoryPage() {
  const { key } = useParams<{ key: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const namespace = searchParams.get('ns')

  if (!key) return null

  return (
    <ConfigI18nProvider>
      <div style={{ padding: 'var(--space-8)' }}>
        <button type="button" onClick={() => navigate(-1)} style={{ marginBottom: 'var(--space-6)' }}>
          ← Back
        </button>
        <h1 style={{ margin: '0 0 var(--space-6)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xl)' }}>{key}</h1>
        <ConfigSecretAuditFlow
          keyName={key}
          scope={{ scopeType: 'platform' }}
          nameOf={() => (namespace ? `namespace ${namespace}` : 'this scope')}
          entries={null}
          error="Change history is not available yet — the config-service history endpoint (FF-EPIC-18-S2) has not shipped."
          onRetry={() => {
            /* No real endpoint to retry against yet — see the doc comment above. */
          }}
          onRevert={async () => {
            throw new Error('Revert is not available yet (FF-EPIC-18-S3).')
          }}
        />
      </div>
    </ConfigI18nProvider>
  )
}

export default ConfigAuditHistoryPage
