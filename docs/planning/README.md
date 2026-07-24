# FuzeFront Delivery Roadmap — Jira-ready Planning Backlog

> **Status:** Draft for Jira import. Atlassian/Jira is **not connected** in this environment, so
> this backlog is authored as version-controlled, **Jira-ready markdown** to be bulk-uploaded later.
> Authored and conformance-checked by the **agile-manager** using the `ticket-creator` /
> `ticket-reviewer` / `ticket-enforcer` skill discipline (epic + user-story structure, Given/When/Then
> acceptance criteria, sub-task points in `{2,4,8}`, estimate/priority hints, labels).

This is **delivery coordination only**. None of these files implement the features — each epic links to
its GitHub issue, which is the durable `@claude` delegation thread where the actual implementation work
is executed by the domain agents (`backend-engineer`, `frontend-engineer`, `billing-payments-engineer`,
`devops-engineer`, `feature-flags-engineer`, `test-engineer`, `frontend-test-engineer`, `docs-maintainer`).

---

## Epic index

| Epic Key | Title | GitHub | Domain | Priority | Status |
|----------|-------|--------|--------|----------|--------|
| [FF-EPIC-01](epics/EPIC-01-billing-payments-ux.md) | Billing / Payments UX overhaul | [#119](https://github.com/izzywdev/FuzeFront/issues/119) | Billing | High | Ready |
| [FF-EPIC-02](epics/EPIC-02-ai-chat-platform.md) | AI Chat platform (`@fuzefront/chat-ui` + chat microservice) | [#120](https://github.com/izzywdev/FuzeFront/issues/120) | AI / Chat | High | Ready |
| [FF-EPIC-03](epics/EPIC-03-security-org-management-ui.md) | Security / Org-management UI | [#121](https://github.com/izzywdev/FuzeFront/issues/121) | Identity / Security | High | Ready |
| [FF-EPIC-04](epics/EPIC-04-federated-app-platform.md) | Federated App Platform implementation | [#122](https://github.com/izzywdev/FuzeFront/issues/122) | Platform | Critical | Ready |
| [FF-EPIC-05](epics/EPIC-05-multi-product-authn-authz.md) | Multi-product AuthN / AuthZ | [#115](https://github.com/izzywdev/FuzeFront/issues/115) | Identity / Security | High | Ready |
| [FF-EPIC-06](epics/EPIC-06-feature-flags-platform.md) | Feature Flags platform (Unleash + client) | [#116](https://github.com/izzywdev/FuzeFront/issues/116) | Platform | Medium | Ready |
| [FF-EPIC-07](epics/EPIC-07-platform-hardening-residual.md) | Platform hardening residual | [#94](https://github.com/izzywdev/FuzeFront/issues/94) | DevOps / Security | High | Ready |
| [FF-EPIC-08](epics/EPIC-08-sdlc-quality-gates.md) | SDLC quality gates | [#108](https://github.com/izzywdev/FuzeFront/issues/108) | Governance / CI | Medium | In progress (PR rebase pending) |

### Multi-Tenant Portal initiative (FF-EPIC-09 … 16)

Turns FuzeFront into a multi-tenant **portal-within-portal** platform: tenant-scoped identity,
white-label tenant portals, per-portal app catalogs, reseller billing (Stripe Connect), and
tenant domains. Target Jira project: **company-managed Scrum `FFRNT` (FuzeFront SCRUM)** running the
FuzePlan workflow scheme (see `../planning/jira-scrum-provisioning.md`). 8 epics · 37 stories · 422 pts.

| Epic Key | Title | GitHub | Domain | Priority | Effort |
|----------|-------|--------|--------|----------|--------|
| [FF-EPIC-09](epics/EPIC-09-portal-core.md) | Portal core: provisioning & master-admin management | TBD | Platform | Critical | L |
| [FF-EPIC-10](epics/EPIC-10-portal-context-resolution.md) | Portal context resolution & boot | TBD | Platform | Critical | M |
| [FF-EPIC-11](epics/EPIC-11-tenant-scoped-identity.md) | Tenant-scoped identity | TBD | Identity / Security | Critical | XL |
| [FF-EPIC-12](epics/EPIC-12-per-portal-app-catalog.md) | Per-portal app catalog | TBD | Platform | High | M |
| [FF-EPIC-13](epics/EPIC-13-white-label-shell-branding.md) | White-label shell branding | TBD | Frontend / Design | High | L |
| [FF-EPIC-14](epics/EPIC-14-admin-consoles-ui.md) | Admin consoles UI (master-admin + portal-admin) | TBD | Frontend / Platform | High | L |
| [FF-EPIC-15](epics/EPIC-15-reseller-billing-stripe-connect.md) | Reseller billing (Stripe Connect) | TBD | Billing | High | XL |
| [FF-EPIC-16](epics/EPIC-16-self-service-custom-domains.md) | Self-service custom domains | TBD | Platform / DevOps | Medium | M |

**Dependency order:** 09 → 10 → {11, 12} → {13, 14} ; 15 depends on 09/10 ; 16 depends on 10 + the
FuzeInfra wildcard/custom-hostname delegation. All capabilities ship behind default-OFF feature flags.

---

## How these map to Jira (import contract)

A later script/agent can mechanically create Jira issues from these files:

- **One file = one Epic.** Each epic file carries YAML frontmatter (`key`, `title`, `label`, `github`,
  `status`, `priority`, `domain`) that a Jira-import script reads to create the Epic issue.
- **Each `## Story:` section under `## Stories` = one Story** linked to that Epic (the `Parent Epic`
  field references the epic `key`).
- **The `### 📋 Sub-Tasks` table inside each story = Jira sub-tasks** (Type / Summary / Points), with
  story points constrained to `{2, 4, 8}` per the SDLC sizing rule.
- **Acceptance criteria** use the strict `Given / When / Then` form (plus an edge case and an error
  case) so they convert 1:1 into Jira AC checklists.
- **Labels** are listed per epic; every epic carries the `fuzefront` label at minimum.

### Import order / dependency notes

1. **FF-EPIC-04** (Federated App Platform) and **FF-EPIC-05** (Multi-product authn/authz) are coupled —
   the App Manifest (`auth` section) is the integration seam. Build EPIC-04 registry first; EPIC-05's
   per-product OIDC/Permit provisioning plugs into the manifest.
2. **FF-EPIC-06** (Feature Flags) and **FF-EPIC-08** (SDLC gates) are enabling/governance epics — land
   early so feature epics can wrap risky work in flags and pass the new CI gates.
3. **FF-EPIC-07** (hardening) gates the deploy posture for everything — it changes `master` signing and
   the ruleset, so coordinate its merge inside a deploy window.

---

## Label conventions

| Label | Meaning |
|-------|---------|
| `fuzefront` | Every FuzeFront epic/story (the product label). |
| `billing` · `chat` · `identity` · `security` · `platform` · `feature-flags` · `devops` · `governance` | Domain routing labels. |
| `design-system-first` | UI work that must extend `@fuzefront/design-system` (no raw hex/spacing/type). |
| `contract-first` | Work gated on a frozen OpenAPI/event contract before fan-out. |
| `paginated` | List endpoint/UI subject to the `gate-pagination` standard. |
| `permit-gated` | AuthZ enforced by Permit.io (real authz, never a UI/feature flag). |
| `deploy-window` | Touches `master` deploy-on-push surfaces — merge only in a deploy window. |
| `needs-jira-upload` | Authored here; awaiting bulk Jira import (Atlassian not connected). |

---

## Conformance note (agile-manager)

Every story in this backlog was authored against the `ticket-creator` epic/story templates and validated
with the `ticket-reviewer` / `ticket-enforcer` rubric:

- Epic: Problem Statement (>50 chars), Goal, ≥3 Features In Scope, ≥1 Success Metric with a target,
  Out-of-Scope, dependencies.
- Story: linked Parent Epic, full `As a / I want / So that`, ≥2 Given/When/Then AC including 1 edge +
  1 error case, ≥1 dev + ≥1 QA sub-task, story points summing from `{2,4,8}` sub-tasks, DoD.

Where a genuine product decision is still open it is marked `[TBD — ask: …]` rather than invented.
