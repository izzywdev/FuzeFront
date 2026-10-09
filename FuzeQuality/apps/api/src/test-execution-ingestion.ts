import { testExecutionInputSchema, type TestExecution } from '@fuzequality/contracts'

/**
 * Gives legacy S2S producers a durable external identity without weakening the
 * database invariant. Callers that know their provider identity keep it;
 * callers using the older payload shape use the generated row id consistently.
 */
export function executionRecord(
  execution: ReturnType<typeof testExecutionInputSchema.parse>,
  id: string,
): TestExecution {
  return { id, ...execution, externalRunId: execution.externalRunId ?? id }
}
