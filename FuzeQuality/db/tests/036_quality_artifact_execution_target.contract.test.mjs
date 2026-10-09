import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/036_quality_artifact_execution_target.sql', import.meta.url), 'utf8')

test('performance execution targets are fail-closed scanner evidence', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS execution_target jsonb/i)
  assert.match(migration, /kind IN \('load-test', 'stress-test'\)/i)
  assert.match(migration, /execution_target->>'trigger' = 'workflow_dispatch'/i)
  assert.match(migration, /execution_target->>'workflowPath' = source_path/i)
})
