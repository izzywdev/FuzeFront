import express from 'express'
import { createDelegationClient, createWorkloadAuthClient } from '@fuzefront/service-auth'
import { forwardFuzex } from '../services/fuzex-proxy'

const router = express.Router()
const securityUrl = process.env.FUZEFRONT_SECURITY_URL || 'http://fuzefront-security:3002'
const workload = createWorkloadAuthClient({ baseUrl: securityUrl })
const delegation = createDelegationClient({ baseUrl: securityUrl, serviceAuth: workload })

// Release flag, default OFF. Owner: FuzeFront backend/FUZX integration.
// Remove once the hosted migration is complete and this is the normal API route.
async function enabled(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const flags = require('@fuzefront/feature-flags')
    return await flags.getClient().getBooleanValue('fuzefront.fuzex.hosted-review', false, {
      environment: process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local',
      app: 'fuzefront-backend',
      tenantId: process.env.FUZX_AUTHZ_TENANT,
    })
  } catch { return false }
}

// Browser base: /api/v1/fuzex, followed by the existing FuzeX /api/v1 path.
// Security verifies the subject's session and active organization membership
// during exchange. Only the workload and audience-bound delegation go upstream;
// cookies, client-supplied delegation and browser identity claims never do.
router.use(async (req, res) => {
  const result = await forwardFuzex({ method: req.method, url: req.url, authorization: req.headers.authorization, body: req.body }, {
    baseUrl: process.env.FUZX_API_URL || '',
    tenant: process.env.FUZX_AUTHZ_TENANT || '',
    enabled,
    credentials: async (subjectToken, scope, tenant) => {
      const delegated = await delegation.exchange({ subjectToken, audience: 'service:fuzex', scopes: [scope], tenant })
      return { workloadToken: await workload.getToken(), delegatedToken: delegated.accessToken }
    },
  })
  res.setHeader('Cache-Control', 'no-store')
  if (result.body === null) res.status(result.status).end()
  else res.status(result.status).json(result.body)
})

export default router
