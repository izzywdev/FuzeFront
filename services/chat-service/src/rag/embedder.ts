// embedder.ts — turns text into embedding vectors via the LiteLLM gateway.
//
// Thin adapter over LiteLLMClient.embed so the indexer/retriever depend on a
// narrow `Embeddable` interface (easy to mock) rather than the whole client.
// Batch embedding is sequential to stay within gateway rate budgets for the
// doc-scale corpus; parallelism can be added later if ingestion latency matters.

export interface Embeddable {
  embed(text: string): Promise<number[]>;
}

export class Embedder {
  constructor(private readonly llm: Embeddable) {}

  /** Embed a single query string. */
  async embedQuery(text: string): Promise<number[]> {
    return this.llm.embed(text);
  }

  /** Embed many documents, preserving input order. */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) {
      out.push(await this.llm.embed(t));
    }
    return out;
  }
}
