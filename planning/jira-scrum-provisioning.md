# Multi-Tenant Portal — Jira (Scrum + FuzePlan workflow) provisioning

The multi-tenant portal backlog (`docs/planning/epics/EPIC-09..16`) is created in a **company-managed
Scrum** Jira project running the **FuzePlan workflow scheme**. This file records how that project is
stood up. The existing FuzeFront board **KAN** is *team-managed (next-gen)*, which **cannot** carry a
company-managed workflow scheme — so a new company-managed project is required, and KAN is retired
once the new project is live (KAN currently holds 0 issues, so nothing migrates).

## Why a new project (not "convert KAN")
- Jira has no in-place team-managed → company-managed conversion.
- The FuzePlan workflow (8 per-issue-type workflows: Epic / Story / Backend / Frontend / UX / Bug /
  Task, with statuses like `Ideation → Story Planning → Deveolping → Released`) is a **company-managed
  workflow scheme** (`/workspace/fuzeplan/skills/ticket-workflow`, doc
  `docs/jira-workflows/FUZEPLAN_AGILE_WORKFLOW.md`). Team-managed projects carry their own per-project
  workflows and are out of scope for that scheme.
- Provisioning the scheme is **site-admin only** and runs via a Python script with a site-admin API
  token — not the `write:jira-work` connection used to create issues.

## Steps (run by a site admin)

1. **Create the project** — Jira → Create project → **Company-managed** → **Scrum** template.
   Suggested name **FuzeFront Portal**, key e.g. **FFP**. (Company-managed + Scrum is required; the
   name/key are yours to choose — just tell the ticket-creation step the final key.)

2. **Add the FuzePlan issue types** to the project's issue-type scheme if you want native
   `Backend Development` / `Frontend Development` / `UX Design` types (otherwise standard
   `Epic / Story / Sub-task` are used and the sub-task discipline is carried in the summary prefix
   `[Backend] / [Frontend] / [QA] / [UX] / [Docs]`).

3. **Provision the workflow scheme** with a site-admin API token (token from
   `id.atlassian.com/manage-profile/security/api-tokens` — set it as an env var locally, never paste
   it into chat or commit it):
   ```bash
   cd /workspace/fuzeplan/skills/ticket-workflow/scripts
   export JIRA_BASE_URL=https://fuzefront.atlassian.net
   export JIRA_EMAIL=<site-admin email>
   export JIRA_API_TOKEN=<site-admin token>

   python recreate_workflows.py --validate            # writes nothing; surfaces status-name collisions
   python recreate_workflows.py --apply               # create statuses + 8 workflows + the scheme
   python recreate_workflows.py --apply --project FFP # bind the scheme to the new project
   ```
   - Expect `NON_UNIQUE_STATUS_NAME` on common names (`To Do`/`In Progress`/`Done`) already present on
     the site — resolve per the `ticket-workflow` SKILL (reuse or rename), then re-apply.
   - Binding a scheme to a project migrates in-flight issues by status; the new project is empty, so
     the mapping is trivial.

4. **Enable Scrum sprints/backlog** (company-managed Scrum board is created with the template; confirm
   the backlog + sprints are on).

5. **Tell the ticket-creation step the final project key.** Then all `EPIC-09..16` epics, their
   stories, and sub-tasks are created via the Atlassian MCP with FuzePlan-compliant content
   (`ticket-creator` standard: SIZING {2,4,8} sub-task points, Given/When/Then AC, labels).

6. **Retire KAN** — once the new project is confirmed live, delete/archive the old team-managed
   `FuzeFront` (KAN) project. It has no issues to preserve. (Project deletion is a site-admin action.)

## Content standard
Every epic/story/sub-task follows the FuzePlan `ticket-creator` skill and is validated against the
`ticket-reviewer` / `ticket-enforcer` rubric (Epic: problem >50 chars, goal, ≥3 features, ≥1 metric;
Story: parent epic, As-a/I-want/So-that, ≥2 Given/When/Then incl. edge + error, ≥5 DoD items, ≥1 dev
+ ≥1 QA sub-task, points sum from {2,4,8}). The version-controlled source of truth is
`docs/planning/epics/EPIC-09..16-*.md`.
