import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(
  new URL('../migrations/054_executable_quality_artifact_targets.sql', import.meta.url),
  'utf8',
)

test('all executable test workflow kinds accept fail-closed dispatch targets', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS repository_quality_artifacts_execution_target_check/i)
  assert.match(
    migration,
    /kind IN \('integration-test', 'post-production-test', 'load-test', 'stress-test'\)/i,
  )
  assert.match(migration, /jsonb_typeof\(execution_target\) = 'object'/i)
  assert.match(migration, /execution_target \?& ARRAY\['provider', 'trigger', 'workflowPath'\]/i)
  assert.match(migration, /execution_target->>'provider' = 'github-actions'/i)
  assert.match(migration, /execution_target->>'trigger' = 'workflow_dispatch'/i)
  assert.match(migration, /execution_target->>'workflowPath' = source_path/i)
  assert.match(migration, /source_path ~ '\^\\\.github\/workflows\/\.\+\\\.ya\?ml\$'/i)
  assert.match(migration, /\) IS TRUE\)/i)
})
