# Bug Hierarchy and Spawn Rules

## Placement Options

### Option A — Direct child of Epic
Use when the bug is found independently (e.g., a production bug not tied to any specific in-progress Story).
- Create Bug directly under the relevant Epic.
- Set Jira link: Bug **relates to** the most relevant existing Story if one exists.

### Option B — Child of Story
Use when the bug is found during development or QA of a specific in-progress Story.
- Create Bug as a child of that Story (sub-task or child issue depending on Jira project config).
- Add a Jira **"Relates to [STORY-ID]"** link on the Bug.

## Spawn Rule
When a bug fix requires more than a simple code change, it spawns the same sub-task types as a Story:

| Sub-task Type | Required? | When |
|--------------|-----------|------|
| Backend Task | **Required** | Almost always — the code fix lives here |
| QA Task (Unit) | **Required** | Cover the root cause with a unit test |
| QA Task (Functional) | **Required** | Verify the user scenario no longer breaks |
| Frontend Task | Optional | If the fix touches the UI |
| UX Task | Optional | If design/flow is fundamentally broken, not just the code |
| Documentation | Optional | If the behavior was undocumented or wrongly documented |
| DevOps Task | Optional | If the root cause was infra, config, or deployment |

## Bug Lifecycle
```
Opened → Triage → In Progress → QA Verify → Release Ready → Closed (In Production)
              ↓                       ↓
         Won't Fix              Fail → Reopen → In Progress
         Duplicate
         Cannot Reproduce → Needs More Info → Opened
```

## Bug–Story Relationship Types
| Jira link type | Direction | When to use |
|---------------|-----------|-------------|
| Relates to | Bug → Story | Bug was found in the context of a Story |
| Caused by | Bug → Story | Specific Story implementation introduced the bug |
| Blocks | Story → Bug | Bug must be fixed before Story can release |
| Duplicate of | Bug → Bug | Same defect already tracked |
