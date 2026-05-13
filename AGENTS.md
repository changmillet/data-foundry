# AGENTS.md - TianGong LCA Data Foundry

This repository is the private orchestration layer for autonomous TianGong LCA data work.

## Mission

Build an AI-operable data foundry that can receive data tasks, judge the task type, run the right data-governance workflow, produce evidence, and continue iterating until the task reaches a verified terminal state.

Humans should mostly manage policy, credentials, and final release posture. Agents should manage inventory, review, repair candidates, dry-run plans, verification, and work logs.

## Boundaries

- Do not store API keys, access tokens, `.env`, database dumps, or full private payload exports in git.
- Do not hard-code a personal account name as reusable task scope. Use `FOUNDRY_ACCOUNT_LABEL` only as an optional, non-secret human display label; credential/session resolution and frozen manifests are authoritative for AI execution.
- Runtime state belongs under `.foundry/` and is ignored.
- Source-of-truth task policy belongs in `WORKFLOW.md`.
- Project-level specifications belong in `specs/`.
- Reusable operating knowledge belongs in `docs/`.
- Task queue files belong in `tasks/`.
- Do not implement raw database writes without an explicit dry-run and verification gate.

## Default Operating Order

1. Read this file.
2. Read `WORKFLOW.md`.
3. Read the relevant task file under `tasks/`.
4. Read `specs/data-foundry-service.md`.
5. If the task is account/category data governance, read `docs/data-governance-loop.md`.
6. Run `npm run doctor` before trusting local commands.

## Current Private Seed Sources

The project adapts these already proven local workflows. Their filenames may contain a private operator account label because they are historical source artifacts; do not copy that label into reusable templates or public-facing concepts.

- `LCA-DATA-AGENT/tasks/open/example-account-account-data-governance.md`
- `LCA-DATA-AGENT/playbooks/example-account-account-data-governance.md`
- `LCA-DATA-AGENT/skill-sources/skills/account-data-iterative-governance/SKILL.md`
- `LCA-DATA-AGENT/wiki/pages/methods/process-source-evidence-numeric-review.md`

## Commit Rules

Keep commits small and thematic. Do not commit `.foundry/`, `.env`, logs, workspace clones, or downloaded account payloads.
