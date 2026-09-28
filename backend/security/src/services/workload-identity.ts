import fs from 'fs'
import https from 'https'

const API_HOST = process.env.KUBERNETES_SERVICE_HOST
const API_PORT = process.env.KUBERNETES_SERVICE_PORT_HTTPS || '443'
const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token'
const SA_CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'

export type WorkloadIdentity = {
  service: string
  namespace: string
  serviceAccount: string
  scopes: string[]
  tokenTtlSeconds?: number
}

type KubeResponse = { status: number; body: any }

async function kubeRequest(method: string, path: string, body?: unknown): Promise<KubeResponse> {
  if (!API_HOST) throw new Error('Kubernetes API is unavailable')
  const bearer = fs.readFileSync(SA_TOKEN_PATH, 'utf8').trim()
  const ca = fs.readFileSync(SA_CA_PATH)
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: API_HOST,
      port: Number(API_PORT),
      path,
      method,
      ca,
      headers: {
        authorization: `Bearer ${bearer}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      timeout: 5000,
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let parsed: any = {}
        try { parsed = raw ? JSON.parse(raw) : {} } catch { return reject(new Error('Invalid Kubernetes API response')) }
        resolve({ status: response.statusCode || 500, body: parsed })
      })
    })
    request.on('timeout', () => request.destroy(new Error('Kubernetes API timed out')))
    request.on('error', reject)
    if (body) request.write(JSON.stringify(body))
    request.end()
  })
}

export async function authenticateKubernetesWorkload(projectedToken: string): Promise<WorkloadIdentity> {
  const review = await kubeRequest('POST', '/apis/authentication.k8s.io/v1/tokenreviews', {
    apiVersion: 'authentication.k8s.io/v1',
    kind: 'TokenReview',
    spec: { token: projectedToken, audiences: ['fuzefront-security'] },
  })
  const status = review.body?.status
  if (review.status !== 201 && review.status !== 200 || status?.authenticated !== true) {
    throw new Error('Kubernetes workload authentication failed')
  }
  const match = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(status.user?.username || '')
  if (!match) throw new Error('TokenReview did not return a ServiceAccount identity')
  const [, namespace, serviceAccount] = match

  const resources = await kubeRequest(
    'GET',
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps?labelSelector=security.fuze.dev%2Fworkload-identity%3Dtrue`,
  )
  if (resources.status !== 200) throw new Error('Workload identity registry is unavailable')
  const item = (resources.body?.items || []).find((candidate: any) =>
    candidate?.data?.serviceAccountName === serviceAccount,
  )
  const scopes = String(item?.data?.scopes || '').split(/\s+/).filter(Boolean)
  if (!item?.data?.service || scopes.length === 0) {
    throw new Error('ServiceAccount has no FuzeWorkloadIdentity declaration')
  }
  return {
    service: item.data.service,
    namespace,
    serviceAccount,
    scopes,
    tokenTtlSeconds: item.data.tokenTtlSeconds ? Number(item.data.tokenTtlSeconds) : undefined,
  }
}
