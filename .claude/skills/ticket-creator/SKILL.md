---
name: ticket-creator
description: Generate a complete, Jira-ready ticket (epic, story, or UX task) from a brief description; routes to the right ticket-type template. Use when creating Jira/FuzePlan tickets.
skill: ticket-creator
version: 1.0
project: FuzePlan / PhoneDo
---

# Ticket Creator (Router)

## Purpose
Generates a complete, Jira-ready ticket from a brief description.
Routes to the correct sub-skill based on ticket type.

## Routing Table
| Ticket Type | Sub-skill to load |
|-------------|------------------|
| Epic | `ticket-creator/epic/SKILL.md` |
| Story | `ticket-creator/story/SKILL.md` |
| UX Task | `ticket-creator/ux/SKILL.md` |
| Frontend Task / Frontend Development | `ticket-creator/frontend/SKILL.md` |
| Backend Task / Backend Development | `ticket-creator/backend/SKILL.md` |
| QA Task (any test type) | `ticket-creator/qa/SKILL.md` (QA router) |
| Documentation | `ticket-creator/docs/SKILL.md` |
| DevOps Task | `ticket-creator/devops/SKILL.md` |
| Bug | `ticket-creator/bug/SKILL.md` |

## Universal Rules (apply to ALL types)
1. Load sizing rules from `../shared/templates/SIZING.md` before generating any ticket.
2. Load bug rules from `../shared/templates/BUG_RULES.md` before generating any Bug ticket.
3. Replace ALL `[placeholder]` text with real content. Mark truly unknown fields as `[TBD — ask: <your question>]`.
4. Sub-task story points must be in `{2, 4, 8}` only. If the user estimates differently, correct it and explain why.
5. Story must fit within 1 sprint. If the described scope won't fit, warn the user and suggest splitting.
6. Output only the completed ticket — no preamble, no "here is your ticket", no markdown fence around the whole output.

## If ticket type is unclear
Ask: "What type of ticket do you want to create? (Epic / Story / UX Task / Frontend / Backend / QA / Docs / DevOps / Bug)"

## If critical information is missing
Ask targeted questions before generating. Never invent facts.
Maximum 2–3 clarifying questions per generation.
