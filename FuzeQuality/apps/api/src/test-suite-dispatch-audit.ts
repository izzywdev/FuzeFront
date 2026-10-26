import type { TestSuiteDispatch } from '@fuzequality/contracts'

export type DispatchAuditPersistence = 'persisted' | 'pending'

type TerminalDispatchWriter = (dispatch: TestSuiteDispatch) => Promise<void>

export async function persistTerminalTestSuiteDispatch(
  write: TerminalDispatchWriter,
  dispatch: TestSuiteDispatch,
  attempts = 3,
): Promise<DispatchAuditPersistence> {
  const boundedAttempts = Math.max(1, attempts)
  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    try {
      await write(dispatch)
      return 'persisted'
    } catch {
      // The provider call cannot be rolled back. Retry the idempotent upsert and
      // report an explicit uncertainty if durable audit storage remains down.
    }
  }
  return 'pending'
}
