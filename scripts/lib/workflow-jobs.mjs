// Job-block extraction for GitHub Actions workflow YAML, shared by the gates that need
// to ask a question about ONE job rather than about a whole file.
//
// Extracted so it can be unit-tested against the real implementation. The alternative —
// a test file carrying its own copy of the logic — proves only that the copy works, and
// a copy that drifts from the original is the exact shape of vacuous verification
// `gate-claims` exists to catch.

/** Line is a job header at job indentation (`  name:`). */
const isJobHeader = line => /^  \S.*:\s*$/.test(line)

/**
 * The YAML block of one named job: from its `  <name>:` header to the next job header at
 * the same indentation.
 *
 * Deliberately NOT `indexOf('\n  <next-job>:')`: that yields `slice(0, -1)` — almost the
 * whole file — the moment the next job is renamed, removed or reordered, silently
 * widening the window to every other job's steps. A boundary miss throws instead.
 */
export const jobBlock = (workflowText, name) => {
  const lines = workflowText.split('\n')
  const start = lines.findIndex(l => l === `  ${name}:`)
  if (start === -1) throw new Error(`job \`${name}\` not found`)
  return sliceJob(lines, start)
}

/** The job block CONTAINING line index `at` — for callers that located a line first. */
export const jobBlockAround = (lines, at) => {
  let start = 0
  for (let i = at; i >= 0; i--) {
    if (isJobHeader(lines[i])) { start = i; break }
  }
  return sliceJob(lines, start)
}

const sliceJob = (lines, start) => {
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (isJobHeader(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

/**
 * The same text with YAML comments removed, for callers that ask "is this CONFIGURED?"
 * rather than "does this string appear?".
 *
 * Found by gate-claims failing on its own workflow: a comment in gate-claims.yml
 * explaining the `continue-on-error: true` false positive was itself matched by the
 * regex looking for `continue-on-error: true`, so the gate reported its own
 * documentation as suppression. Reading prose as configuration is the same mistake as
 * grepping explanatory text for the name of the thing being verified.
 *
 * Strips whole-line comments and trailing ` #…`. A `#` with no preceding whitespace
 * (inside a quoted value, a URL fragment, a shell string) is left alone.
 */
export const stripYamlComments = text =>
  text
    .split('\n')
    .map(l => (/^\s*#/.test(l) ? '' : l.replace(/\s+#.*$/, '')))
    .join('\n')
