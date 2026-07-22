import { ChromaClient } from '../packages/core/src/chroma'

await ChromaClient.fromEnv().assertReady()
