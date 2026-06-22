// loop.ts — single-turn agent orchestration (plan §6c, read-only RAG path).
//
// For each user turn:
//   1. Sanitize the latest user message (§10a).
//   2. Always run RAG retrieval via the read-only search_docs tool, emit a
//      `rag_sources` event with the citations (skipped when nothing matches).
//   3. Build the LLM request: structurally-separate SYSTEM_PROMPT + a labelled
//      <doc> context block (§10a/§10b) + the conversation messages.
//   4. Stream text deltas from the LiteLLM gateway, emitting `text_delta` events.
//   5. Report token usage to the caller (which emits billing.llm.usage).
//   6. Emit a terminal `done` event.
//
// The emitted event union matches @fuzefront/chat-client's documented SSE wire
// format (text_delta / rag_sources / done / error) — a deliberate deviation from
// the plan's §6f Vercel-AI-SDK data-stream protocol (flagged in the PR).
//
// Mutating tools / multi-step tool loops are DEFERRED per the task brief; this
// turn always retrieves docs then answers. The ConfirmationStore + PermitClient
// gate exists for when mutating tools are added.

import { SYSTEM_PROMPT, buildContextBlock, sanitizeUserInput } from './prompt';
import type { ChatMessage, TokenUsage, ChatStreamChunk } from '../llm/litellm';
import type { SearchDocsResult, RagSource } from './tools/search-docs';
import type { ToolRegistry } from './tools';

/** Subset of LiteLLMClient the loop needs (mockable). */
export interface StreamingLlm {
  streamChatCompletion(req: {
    system: string;
    messages: ChatMessage[];
  }): AsyncGenerator<ChatStreamChunk>;
}

/** Subset of the search_docs tool the loop needs. */
export interface SearchTool {
  execute(
    args: { query: string },
    ctx: { userId: string; orgId: string },
  ): Promise<SearchDocsResult>;
}

export interface AgentDeps {
  llm: StreamingLlm;
  searchTool: SearchTool;
  registry: Pick<ToolRegistry, 'list'>;
}

export interface AgentTurnInput {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  userId: string;
  orgId: string;
  conversationId: string;
}

/** Events emitted by a turn — matches the chat-client SSE union (packages/chat-client). */
export type AgentEvent =
  | { type: 'rag_sources'; sources: RagSource[] }
  | { type: 'text_delta'; delta: string }
  | {
      type: 'tool_pending';
      confirmationId: string;
      toolName: string;
      args: Record<string, unknown>;
      description: string;
    }
  | { type: 'tool_result'; confirmationId: string; success: boolean; summary: string }
  | { type: 'tool_denied'; toolName: string; reason: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface AgentCallbacks {
  emit(event: AgentEvent): void;
  /** Called once with token usage when the LLM reports it. */
  onUsage(usage: TokenUsage): void;
}

export async function runAgentTurn(
  deps: AgentDeps,
  input: AgentTurnInput,
  cb: AgentCallbacks,
): Promise<void> {
  // 1. Sanitize the latest user message.
  const sanitizedMessages: ChatMessage[] = input.messages.map((m) => ({
    role: m.role,
    content: m.role === 'user' ? sanitizeUserInput(m.content) : m.content,
  }));
  const lastUser = [...sanitizedMessages].reverse().find((m) => m.role === 'user');
  const query = lastUser?.content ?? '';

  // 2. RAG retrieval (read-only). Emit citations if any.
  let contextBlock = '';
  try {
    const { chunks, sources } = await deps.searchTool.execute(
      { query },
      { userId: input.userId, orgId: input.orgId },
    );
    if (sources.length > 0) {
      cb.emit({ type: 'rag_sources', sources });
      contextBlock = buildContextBlock(chunks);
    }
  } catch (err) {
    // Retrieval failure is non-fatal — answer without grounding.
    contextBlock = '';
  }

  // 3. Assemble the system prompt + context. The context block is appended to
  // the system message (still structurally separated from user content).
  const system =
    contextBlock.length > 0
      ? `${SYSTEM_PROMPT}\n\nReference documents:\n${contextBlock}`
      : SYSTEM_PROMPT;

  // 4. Stream the completion.
  try {
    for await (const chunk of deps.llm.streamChatCompletion({
      system,
      messages: sanitizedMessages,
    })) {
      if (chunk.type === 'delta') {
        cb.emit({ type: 'text_delta', delta: chunk.text });
      } else if (chunk.type === 'usage') {
        cb.onUsage(chunk.usage);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cb.emit({ type: 'error', message });
  }

  // 6. Terminal event.
  cb.emit({ type: 'done' });
}
