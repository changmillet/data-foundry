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
- Repo-local background knowledge and imported source corpora belong in `wiki/`.
- Task queue files belong in `tasks/`.
- Do not implement raw database writes without an explicit dry-run and verification gate.

## Default Operating Order

1. Read this file.
2. Read `WORKFLOW.md`.
3. Apply the fast-path routing rules below before broad repository search.
4. Read the relevant task file under `tasks/`, when the task came from the file queue.
5. Read `specs/data-foundry-service.md`, unless a fast path below gives a narrower required-doc list.
6. If the task needs LCA method background, ILCD naming conventions, or product-carbon-footprint factor database guidance, query `wiki/` first.
7. If the task is account/category data governance, read `docs/data-governance-loop.md`.
8. Run `npm run doctor` before trusting local commands. Treat it as a local health check, not as the way to discover the workflow.

## Fast Path: Structured External Dataset Imports

Use this path before generic task discovery when the user asks to import, update, rerun, write, or verify a structured external dataset package. Trigger phrases include:

- `external-dataset-curated-import`
- `BAFU`, `bafu`, `FOEN`, or `Swiss Federal Administration - Federal Office for the Environment`
- "write/import/update BAFU data/account", "把 BAFU 数据写入数据库", "写入 bafu 账号", or "随机选择 ... 条 bafu 数据"
- EcoSpold/ILCD/TIDAS package import requests that already have normalized rows or a known import profile

For the BAFU import fast path, do not start by searching the repository for commands or rereading old runtime reports. Load these durable entrypoints first:

1. `docs/import-profiles/bafu/profile.md`
2. `docs/import-profiles/bafu/constraints.md`
3. `docs/skill-orchestration/entity-level-curated-import-queue.md`
4. The sibling workspace skill `../tiangong-lca-skills/external-dataset-curated-import/SKILL.md`, when available
5. `docs/workspace-project-map.md` only if a project root or command path is missing

When the task says to use the latest local CLI, make sure the sibling `../tiangong-lca-cli` install and build are fresh before invoking `bin/tiangong-lca.js`: run `npm install` if `package.json` / `package-lock.json` changed or dependency versions are stale, then run `npm run build` after local source changes, or use the source entrypoint `node --import tsx src/main.ts ...` for diagnostics. Do not silently use stale `node_modules/` or `dist/` artifacts.

If a BAFU import run uncovers a reusable CLI, SDK, tidas-tools, skill, or profile defect, fix it in the owning sibling repository, rebuild the affected local tool, and then start a fresh downstream regression run from the same durable BAFU profile. The regression must use the latest local code, not stale task-local scripts or old reports. Record the first remaining blocker with the exact entity task, command, input artifact, and validation report; if there is no blocker, continue the queue through remote write and readback verify.

If structured rows and a curation queue already exist, every worker must ask the queue for the next action before changing rows:

```bash
tiangong-lca dataset curation-queue next \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --entity-type <support|flow|process> \
  --limit 1 \
  --out-dir .foundry/workspaces/<task-id>/execution-next
```

Execute only the returned action, including its `action_manifest` / `--action-manifest` and provenance arguments, then call `curation-queue next` again. For import/write/update requests, repeat this loop until support, flow, and process scopes return `status=complete`; one returned action is not a completed import. Do not synthesize draft/apply/report files with task-local scripts: formal artifacts must carry action lineage for the current queue task, and recovered/debug backfills cannot satisfy prewrite. Use `curation-queue verify` as the prewrite evidence gate after entity actions are complete; do not use old `run-status.md`, remote write success reports, or task-local finalizers as proof that current required artifacts exist. If `verify` is blocked while any `next` scope is still `ready`, continue the queue instead of stopping.

Before any final response to a BAFU import/write request, run:

```bash
tiangong-lca dataset curation-queue guard \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --out-dir .foundry/workspaces/<task-id>/prewrite-evidence-gate \
  --json
```

If guard returns non-zero or `status=blocked`, do not present the run as complete and do not stop merely with a status report when it shows a runnable `next_action`. Continue that action or keep the automation/goal active for the next continuation.

If the input is still unstructured source material such as a PDF, report, screenshot, web page, free text, or arbitrary spreadsheet, do not use the curation queue yet. First run a source-evidence or draft-dataset authoring workflow to create structured TIDAS rows, then enter this fast path.

## Current Private Seed Sources

The project adapts these already proven local workflows. Their filenames may contain a private operator account label because they are historical source artifacts; do not copy that label into reusable templates or public-facing concepts.

- `LCA-DATA-AGENT/tasks/open/example-account-account-data-governance.md`
- `LCA-DATA-AGENT/playbooks/example-account-account-data-governance.md`
- `LCA-DATA-AGENT/skill-sources/skills/account-data-iterative-governance/SKILL.md`
- `LCA-DATA-AGENT/wiki/pages/methods/process-source-evidence-numeric-review.md`
- `wiki/pages/concepts/foundry-rulesbook-wiki.md`

## Commit Rules

Keep commits small and thematic. Do not commit `.foundry/`, `.env`, logs, workspace clones, or downloaded account payloads.
