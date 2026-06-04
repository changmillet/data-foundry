---
title: TianGong LCA Data Foundry
docType: guide
scope: repo
status: active
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when checking Foundry lanes, public commands, runtime skill usage, or repository shape
  - when looking for user-facing examples for route-task, profiles, and owner-routed CLI work
whenToUpdate:
  - when Foundry public commands, lane names, runtime skill policy, or repository layout change
checkPaths:
  - README.md
  - package.json
  - scripts/foundry.mjs
  - docs/architecture.md
  - docs/runtime-skill-management.md
  - docs/foundry-task-contracts.md
  - specs/import-profiles.json
lastReviewedAt: 2026-06-04
lastReviewedCommit: 77dfa0de95629e228759e2fe84ea96f23d08623c
---

# TianGong LCA Data Foundry

Control plane for turning external source material into validated, import-ready TIDAS data.

Foundry is intentionally thin. It owns task routing, local workspaces, import profiles, curation packages, cleanup reports, and policy checks. Reusable schema, conversion, validation, QA, skill, and database behavior belongs in `tidas-sdk`, `tidas-tools`, `tiangong-lca-cli`, `tiangong-lca-skills`, Edge Functions, or database projects.

## Import Lanes

- `external-dataset-curated-import`: packaged LCA datasets converted through `tiangong-lca dataset import-lca convert` / `tidas-tools`, with default per-process dependency bundles under `process-bundles/`, then validated, QA checked, curated, cleaned, dry-run, and verified.
- `source-evidence-dataset-development`: PDF, Excel, web exports, images, markdown, or free text extracted through CLI/skills, authored into candidate TIDAS rows with source evidence, then sent through the same validation and curation gates.

Rows stay source-language before database import. Missing bilingual text is not an import blocker.

## Core Commands

```bash
npm run init:runtime
npm run doctor
npm run workflow:check
npm run storage:check
npm run acceptance:check
npm run skills:source-evidence:use:sci
npm run workspace:map
npm run capabilities:list -- --class tidas-contract-context
npm run profiles:list
npm run task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema,qa,curation
npm run task:run -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema,qa,curation
```

Use owner-routed execution commands for dataset work:

```bash
tiangong-lca dataset curation-queue build \
  --processes ./rows/processes.jsonl \
  --flows ./rows/flows.jsonl \
  --support ./rows/sources.jsonl \
  --out-dir ./curation-queue

tiangong-lca dataset curation-queue next \
  --queue-dir ./curation-queue \
  --json

tiangong-lca dataset curation-queue verify \
  --queue-dir ./curation-queue \
  --type process \
  --json

npm run legacy:dataset:curation-gate -- \
  --type process \
  --rows-file ./rows/processes.jsonl \
  --schema-report ./schema/report.json \
  --qa-report ./qa/process-qa-report.json \
  --schema-file ./context/process/schema.json \
  --yaml-file ./context/process/methodology.yaml \
  --ruleset-file ./context/process/runtime-ruleset.json \
  --queue-dir ./curation-queue \
  --classification-queue ./classification-authoring-queue.jsonl \
  --location-queue ./location-authoring-queue.jsonl \
  --identity-preflight-index ./identity-preflight-requests/identity-preflight-requests.jsonl \
  --profile bafu
```

Foundry no longer exposes `dataset:*` npm scripts as its primary API. Queue state belongs to `tiangong-lca dataset curation-queue build/next/verify`; conversion, validation, QA, remote write, and readback verification also belong to CLI-owned commands. `legacy:dataset:*` scripts remain only as a migration bridge for Foundry-specific curation packages and gate aggregation while those pieces move to their owning CLI/skill surfaces.

`annualSupplyOrProductionVolume` remains a required process field. When source data does not provide it, Foundry uses the deterministic `9999 missing-data-sentinel/year` value rather than AI trace deferral. The sentinel is intentionally non-physical and easy to bulk search so later database-side curation can replace it; that replacement is outside Foundry's import task.

`--profile generic` is the default. Dataset-specific behavior is configured in `specs/import-profiles.json`; BAFU is one profile, not a special code path.

## Runtime Skills

Foundry-local skills under `.agents/skills` are for Foundry orchestration only. Fast-moving source-evidence skills are resolved at runtime with `npx skills` and are not vendored into this repository.

For SCI literature evidence, use the latest remote `tiangong-kb-sci-search` skill from `https://github.com/tiangong-ai/skills`:

```bash
npm run skills:source-evidence:use:sci
```

Persistent local installs are optional operator state:

```bash
npm run skills:source-evidence:install:sci
npm run skills:update
```

If installed locally, `.agents/skills/tiangong-kb-*/` and `skills-lock.json` remain ignored by default. Source-evidence tasks should instead record the resolved upstream ref, `npx skills` command, and evidence artifacts under `.foundry/workspaces/<task-id>/runtime-skills/`.

## Repository Shape

- `scripts/foundry.mjs`: small Foundry command surface.
- `scripts/lib/import-curation.mjs`: generic dataset curation/cleanup implementation.
- `specs/automated-lca-capability-registry.json`: capability routing registry.
- `specs/import-profiles.json`: data-driven import profiles.
- `docs/foundry-task-contracts.md`: minimal task, source, seed, checkpoint, and artifact ledger contracts.
- `docs/runtime-skill-management.md`: `npx skills` runtime dependency contract.
- `docs/import-profiles/bafu/`: BAFU profile context and constraints.
- `tasks/`: lightweight task queue and task templates.
- `.foundry/`: ignored runtime state and generated workspaces.

Remote writes are never automatic. A task must pass schema, QA, curation, cleanup, dry-run, and verification gates, and explicit write policy must allow commit before any database mutation.
