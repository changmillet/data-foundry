---
title: TianGong LCA Data Foundry Agent Guide
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when operating a Foundry import or source-evidence authoring task
  - when deciding which project owns conversion, validation, curation, skill, or write behavior
whenToUpdate:
  - when Foundry ownership boundaries or default operating order change
  - when runtime skill, profile, workspace, or gate contracts change
checkPaths:
  - AGENTS.md
  - README.md
  - WORKFLOW.md
  - docs/architecture.md
  - docs/capability-ownership-policy.md
  - docs/runtime-skill-management.md
  - docs/foundry-task-contracts.md
  - package.json
  - scripts/foundry.mjs
  - specs/**
lastReviewedAt: 2026-06-05
lastReviewedCommit: 76830c7adc67126a795f5fdc1c650fe56ac7b5e2
---

# AGENTS.md - TianGong LCA Data Foundry

This repository is the local control plane for external LCA data import and TIDAS authoring work.

## Mission

Receive external LCA packages or source documents, choose the correct import lane, collect SDK-backed TIDAS contract context, produce evidence-backed TIDAS rows, and keep iterating until the task has current validation, curation, dry-run, and verification evidence.

## Boundaries

- Do not store API keys, tokens, `.env`, database dumps, or full private payload exports in git.
- Runtime state belongs under ignored `.foundry/`.
- Foundry owns task routing, local manifests, import profiles, curation packages, cleanup reports, and policy checks.
- Foundry does not own TIDAS schemas/YAML, package converters, dataset validators, deterministic QA engines, reusable skills, or remote write semantics.
- `.agents/skills` is the single project-visible skill root. Foundry-owned local skills listed in `.agents/shared-skills.json` are tracked with this repository. Shared/runtime skills listed in the same config may also be installed there, but their directories and `skills-lock.json` stay untracked unless a task explicitly changes to a pinned reproducibility policy.
- External source-evidence research skills, including `tiangong-kb-sci-search`, are installed or read through the npm `skills` package (`npx --yes skills@latest ...`) at runtime before use. Do not copy their retrieval logic into Foundry.
- Import-ready rows are source-language rows. Do not add bilingual completion as a pre-import gate.
- Do not implement direct database writes in Foundry.

## Default Operating Order

1. Read this file and `WORKFLOW.md`.
2. For source-evidence or shared-skill work, read `docs/runtime-skill-management.md` before evidence retrieval.
3. Run `npm run doctor` before trusting local Foundry commands.
4. Classify the task as `external-dataset-curated-import` or `source-evidence-dataset-development`.
5. Get the target TIDAS contract context through the sibling CLI:

```bash
tiangong-lca dataset context-pack \
  --type <process|flow|source|contact|unitgroup|flowproperty|lifecyclemodel> \
  --profile ai-import \
  --out-dir .foundry/workspaces/<task-id>/context/<type> \
  --json
```

6. For packaged datasets, convert with `tiangong-lca dataset import-lca convert` or `tidas-tools`; do not replace supported converters with AI. Keep per-process bundle generation enabled so `process-bundles/index.json` and one dependency subdirectory per converted process are available for curation.
7. Before using shared skills, run `npm run skills:install:shared` when configured runtime skills may be missing or stale, and `npm run skills:update` for already installed project skills. For SCI literature evidence in source-evidence tasks, read the latest remote skill with `npx --yes skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth`, record the upstream ref from `git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main`, then capture retrieved papers as evidence candidates before field-level extraction.
8. Run `tiangong-lca dataset validate` and `tiangong-lca qa <type>` on converted or authored rows.
9. Build and drive the entity-level queue with `tiangong-lca dataset curation-queue build/next/verify` so support, flow, and process work has stable task, lock, blocker, closure, and run-plan artifacts owned by the CLI state machine.
10. Run `node scripts/foundry.mjs dataset-curation-gate` with the rows, schema report, QA report, profile, full contract context files, and any generated classification/location authoring queues.
11. Use `$foundry-tidas-import` as the Foundry-local orchestration entrypoint for external package or source-document imports. Use `$foundry-tidas-authoring` only after curation-gate authoring tasks, classification decision tasks, or location decision tasks exist and only to produce structured evidence-backed decisions or patches for curation blockers. Apply classification decisions with `dataset-classification-decisions-apply`, apply location decisions with `dataset-location-decisions-apply`, collect field patches with `dataset-authoring-patch-collect`, then after deterministic apply rerun SDK validation, deterministic QA, and the Foundry curation gate on the final rows before mutation manifest.
12. Run `node scripts/foundry.mjs dataset-curation-cleanup` after source trace has been captured in authoring packages and before remote write planning.
13. Do not treat historical `.foundry` artifacts as proof for a current task.

`annualSupplyOrProductionVolume` is schema-required. If source data does not provide a real annual volume, Foundry must use the deterministic `9999 missing-data-sentinel/year` placeholder, not `common:other` deferral. The sentinel is deliberately non-physical and searchable; database-side curation owns replacing it later.

## Commit Rules

Keep commits small and thematic. Do not commit `.foundry/`, `.env`, logs, source packages under `tmp/`, workspace clones, credentials, or downloaded private payloads.
