# Agentic SDLC threat-intelligence gate

This directory is the auditable, data-only threat feed for the software factory. The
nightly workflow collects **metadata**, never executes or evaluates remote content, and
opens a pull request containing only previously unseen records. A human-reviewed merge
is required before a new threat becomes part of the baseline.

## Initial gates

| Gate                          | CI expectation                                                                                                                                                 | Threats addressed                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Untrusted-content boundary    | Treat issue text, diffs, logs, web pages, documents, OCR, image metadata and tool output as data; never concatenate them into privileged instructions.         | Direct, indirect, multimodal and encoded prompt injection |
| Multimodal normalization      | OCR/transcribe images and media in a sandbox, strip metadata, label extracted text untrusted and run the same policy checks as typed input.                    | Instructions hidden in pictures, audio, PDFs and metadata |
| Instruction hierarchy         | Keep system/developer policy out of retrieved context and reject attempts to redefine role, policy or delimiters.                                              | Prompt override and prompt leakage                        |
| Tool least privilege          | Per-agent allowlists, read-only defaults, scoped short-lived credentials and deny-by-default network/filesystem access.                                        | Excessive agency and confused-deputy attacks              |
| Human authorization           | Require an explicit, contextual approval immediately before destructive, external, financial, deployment or privilege-changing actions.                        | Unauthorized autonomous action                            |
| Plan/action binding           | Bind approval to canonical tool name, arguments, resource and expiry; reject changed or replayed calls.                                                        | Approval bypass, argument swapping and replay             |
| Tool-input validation         | Validate typed schemas, destinations, paths, protocols and size limits independently of model output.                                                          | Command injection, SSRF and path traversal                |
| Tool-output isolation         | Escape output, cap it, attach provenance and prevent tool results from becoming instructions.                                                                  | Tool-result and MCP prompt injection                      |
| Egress control                | Destination allowlists, DNS/IP revalidation, private-address denial and outbound audit logs.                                                                   | Exfiltration and SSRF                                     |
| Secret isolation              | Never expose secrets to model context; use brokered opaque handles, redaction and canary-secret tests.                                                         | Credential theft and context exfiltration                 |
| Memory/RAG provenance         | Tenant isolation, signed provenance, trust labels, retention limits and quarantine before indexing.                                                            | Memory poisoning and cross-tenant retrieval               |
| Supply-chain trust            | Pin actions/tools/models, verify signatures and hashes, scan dependencies and require review for MCP/plugin changes.                                           | Malicious tools, plugins, skills and dependencies         |
| Sandboxed execution           | Ephemeral non-root workers, resource/time limits, no host socket and clean state per task.                                                                     | Generated-code execution and persistence                  |
| Output/data-loss prevention   | Schema validation, contextual encoding, secret/PII scanning and policy checks before publication or tool use.                                                  | Unsafe output handling and data leakage                   |
| Identity and delegation       | Authenticate every agent/tool, propagate user identity, constrain delegated scopes and cap delegation depth.                                                   | Agent impersonation and privilege escalation              |
| Observability and kill switch | Tamper-evident traces of prompts/tool calls/approvals, anomaly budgets, rate limits and immediate revocation.                                                  | Repudiation, loops and runaway cost/action                |
| Adversarial regression        | Test direct/indirect injection, Unicode/encoding, poisoned retrieval, malicious tool output, multimodal payloads and approval bypass on every relevant change. | Control regression                                        |
| Fail closed                   | Timeouts, unavailable classifiers, malformed content and policy ambiguity deny sensitive actions rather than bypassing checks.                                 | Safety-component bypass                                   |

`controls.json` is the machine-readable register. `baseline.json` records the initial
research and `state.json` contains stable IDs already seen by the collector. Run:

```bash
python3 scripts/agentic_threat_intel.py validate
python3 -m unittest scripts.tests.test_agentic_threat_intel
```

## Nightly operation

`.github/workflows/agentic-threat-intel-nightly.yml` runs at 02:37 UTC. It queries the
configured sources with a short overlap window, canonicalizes records, de-duplicates by
source ID, and produces `latest-report.md`. When there is a delta it updates a single
review branch and pull request; it does not change executable gates directly. The report
is also emailed through SendGrid.

Repository configuration required:

- secret `SENDGRID_API_KEY`
- secret `AGENTIC_REPORT_FROM_EMAIL` (a verified SendGrid sender)

The recipient is deliberately fixed in the workflow. Reports contain titles, dates and
links only. Remote abstracts/bodies are neither stored nor rendered, limiting the feed's
ability to act as an indirect prompt-injection channel.

## Research basis

The initial register uses primary or standards-body sources: OWASP's LLM and Agentic AI
security projects, the NIST adversarial machine-learning taxonomy, MITRE ATLAS, CISA's
secure-by-design guidance, GitHub Actions hardening guidance, and relevant published
multimodal prompt-injection research. URLs and access dates are recorded in
`baseline.json`; they should be reviewed before promoting a newly discovered threat into
an enforced control.
