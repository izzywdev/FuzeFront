# A2A Runtime Standard

**Source of truth: FuzeSDLC `governance/a2a-runtime-standard.md`.**  
This copy is seeded here by `sdlc-bootstrap` for local reference and for tooling that reads it from the consuming repo. If this copy and FuzeSDLC diverge, FuzeSDLC wins — open a PR against FuzeSDLC, not here.

---

## §1 One image, config-only variation

There is exactly **one** A2A image: `ghcr.io/izzywdev/fuze-a2a`, built from `fuzeagent/agent-templates/a2a/Dockerfile` by FuzeAgent's `release.yml`. It serves both the shared multi-tenant server and per-product single-tenant pods; they differ only in the mounted values document.

**Never build a second A2A image.** A second A2A Dockerfile anywhere in the family is a defect — report it, do not accept it as a variant.

## §2 Per-product pod shape

A per-product pod is the shared image (`ghcr.io/izzywdev/fuze-a2a`) with a values document (mounted `values.json`) that configures exactly one tenant:

| Field | Required | Notes |
|---|---|---|
| `a2a.enabled` | `true` | In `values-prod.yaml` |
| `a2a.image.repository` | `ghcr.io/izzywdev/fuze-a2a` | The ONE shared image |
| `a2a.image.tag` | pinned SHA | Never `latest` in prod |
| `a2a.inClusterUrl` | set | MUST resolve to this pod's own Service — omitting it publishes the shared server's card URL |
| `a2a.auth.oidcIssuerUrl` | set | Authentik OIDC issuer for token validation |
| `a2a.cardSigning.keySecretRef` | set | SealedSecret reference, never the raw key |
| `a2a.tenants[]` | exactly one | The product's own repo, role, and provider refs |

## §3 inClusterUrl is the field that silently breaks everything

A pod that omits `inClusterUrl` starts, passes its probes, and publishes the **shared** server's endpoint in its Agent Card — every caller that follows the card reaches the wrong pod while all health signals stay green. This must be the pod's own Service DNS name: `http://<service-name>.<namespace>.svc.cluster.local:<port>/rpc`.

## §4 Skills and product knowledge

A serving role's `skills[]` declares the filesystem bundles that make the pod a product-specific agent rather than a generic one. Each entry MUST be the name of a real `.claude/skills/<name>/SKILL.md` bundle in the consuming repo.

- **Rule 4.1** — a named skill absent from the filesystem is ALWAYS FATAL and cannot be ratcheted.
- **Rule 4.2** — zero bundle skills on any serving role is governed by `skills.adoption` in `governance/a2a-policy.json`.
- **Rule 4.3** — missing root `CLAUDE.md` is governed by `skills.adoption` in `governance/a2a-policy.json`.

## §5 Secret references

The values document carries **references** to secrets (`{name, key}` pairs pointing at SealedSecrets), never secret values. Every referenced `{name, key}` pair must be wired to a SealedSecret that carries the named key, or declared in `governance/a2a-policy.json` as `creds.externallyProvisioned` with a reason naming who provisions it.

The `a2a-maintainer` and `gate_a2a.py` verify wiring, never values.

## §6 Deployment reality

`a2a.enabled: true` in `.fuze/manifest.json` with no corresponding `a2a:` block in any chart values file is a **gate failure**, not a skip. A declared surface deployed nowhere is the failure mode this standard exists to prevent.

## §7 Memory — client only

The A2A pod is a **client** of the family's existing Chroma service, using a per-tenant collection. It never runs a Chroma server. `chromadb` carries PYSEC-2026-311 (unfixable pre-auth code injection in the server's collections handler); FuzeAgent is unaffected only because it never serves that endpoint.

If ingest is wired, reuse FuzeAgent's hardened helpers (`_ensure_within`, `_validate_public_url`, `_fetch_url_safely`). A re-implementation regresses a fixed path-traversal and a fixed SSRF.

## §8 API surface — MCP only

The pod reaches a product's API through that product's MCP gateway, pointed at the product's full OpenAPI document. **Never add a raw-REST fallback.** Adding a raw path bypasses `classify.ts` (mutating/irreversible classification), `safety.ts` (prototype-pollution guards), and `upstream.ts` (caller-token forwarding, which has deliberately no service-token option and fails closed). If an operation is unreachable over MCP, the fix is to complete the OpenAPI document, not to open a second unclassified path.

## §9 Verification gate

Run `python3 scripts/gate_a2a.py .` before reporting the A2A surface as maintained. The four checks:

| Check | What it verifies |
|---|---|
| **I1** | Image repository is the shared canonical (`ghcr.io/izzywdev/fuze-a2a`) |
| **I2** | Image tag resolves in GHCR (anonymous manifest GET) |
| **S4.1–4.3** | Skills bundle resolution (4.1 always fatal) |
| **C1** | SecretRef wiring to a SealedSecret |
| **D1** | Deployment reality (enabled values block + Helm template) |

A surface whose gate output you did not actually run is not verified.
