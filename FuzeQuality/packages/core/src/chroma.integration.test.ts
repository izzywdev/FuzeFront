import { describe, expect, it } from 'vitest'
import { ChromaClient } from './chroma'

const runLive = process.env.FUZEQUALITY_CHROMA_INTEGRATION === 'true'

describe.skipIf(!runLive)('FuzeQuality Chroma integration', () => {
  it('indexes and retrieves a Jira requirement in the isolated allocation', async () => {
    const client = ChromaClient.fromEnv()
    await client.assertReady()
    const collectionName = client.temporaryCollectionName()
    const collection = await client.createCollection(collectionName)
    try {
      await client.upsert(collection.id, {
        id: 'FQ-INTEGRATION-1',
        document: 'As a reviewer, I can approve a proposed user flow.',
        embedding: [0.1, 0.2, 0.3, 0.4],
        metadata: { source: 'jira', issueKey: 'FQ-INTEGRATION-1' },
      })
      const result = await client.get(collection.id, 'FQ-INTEGRATION-1')
      expect(result.ids).toEqual(['FQ-INTEGRATION-1'])
      expect(result.documents[0]).toContain('approve a proposed user flow')
      expect(result.metadatas[0]?.issueKey).toBe('FQ-INTEGRATION-1')
    } finally {
      await client.deleteCollection(collectionName)
    }
  })
})
