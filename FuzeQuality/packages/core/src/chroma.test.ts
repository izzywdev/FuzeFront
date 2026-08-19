import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { ChromaClient } from './chroma'

const servers: Array<ReturnType<typeof createServer>> = []
afterEach(() => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))))

describe('ChromaClient', () => {
  it('authenticates and scopes readiness to the FuzeQuality allocation', async () => {
    const requests: Array<{ url: string; authorization?: string }> = []
    const server = createServer((request, response) => {
      requests.push({ url: request.url ?? '', authorization: request.headers.authorization })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify([{ id: 'ready-id', name: 'fuzequality_ready' }]))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')

    const client = new ChromaClient({
      url: `http://127.0.0.1:${address.port}`,
      token: 'test-token',
      tenant: 'fuzequality',
      database: 'fuzequality',
    })
    await client.assertReady()

    expect(requests).toEqual([
      {
        url: '/api/v1/collections?tenant=fuzequality&database=fuzequality',
        authorization: 'Bearer test-token',
      },
    ])
  })

  it('fails readiness when the bootstrap collection is absent', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end('[]')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')

    const client = new ChromaClient({
      url: `http://127.0.0.1:${address.port}`,
      token: 'test-token',
      tenant: 'fuzequality',
      database: 'fuzequality',
    })
    await expect(client.assertReady()).rejects.toThrow('fuzequality_ready')
  })
})
