# Changelog

## 0.1.1

- Reject malformed platform principal identifiers and roles before requesting
  authorization; string roles cannot satisfy platform administrator checks.
- Preserve immutable in-memory suggestion-decision payloads and attribution.
- Add regression coverage for tenant denial, terminal-decision retries,
  expected-test approval, audit provenance, and PostgreSQL audit-write rollback.
