# AGENTS.md - TianGong LCA Data Foundry

This repository is the local control plane for external LCA data import and TIDAS authoring work.

## Mission

Receive external LCA packages or source documents, choose the correct import lane, collect SDK-backed TIDAS contract context, produce evidence-backed TIDAS rows, and keep iterating until the task has current validation, curation, dry-run, and verification evidence.

## Boundaries

- Do not store API keys, tokens, `.env`, database dumps, or full private payload exports in git.
- Runtime state belongs under ignored `.foundry/`.
- Foundry owns task routing, local manifests, import profiles, curation packages, cleanup reports, and policy checks.
- Foundry does not own TIDAS schemas/YAML, package converters, dataset validators, deterministic QA engines, reusable skills, or remote write semantics.
- Import-ready rows are source-language rows. Do not add bilingual completion as a pre-import gate.
- Do not implement direct database writes in Foundry.

## Default Operating Order

1. Read this file and `WORKFLOW.md`.
2. Run `npm run doctor` before trusting local Foundry commands.
3. Classify the task as `external-dataset-curated-import` or `source-evidence-dataset-development`.
4. Get the target TIDAS contract context through the sibling CLI:

```bash
tiangong-lca dataset context-pack \
  --type <process|flow|source|contact|unitgroup|flowproperty|lifecyclemodel> \
  --profile ai-import \
  --out-dir .foundry/workspaces/<task-id>/context/<type> \
  --json
```

5. For packaged datasets, convert with `tiangong-lca dataset import-lca convert` or `tidas-tools`; do not replace supported converters with AI.
6. Run `tiangong-lca dataset validate` and `tiangong-lca qa <type>` on converted or authored rows.
7. Build the entity-level queue with `npm run dataset:curation-queue:build` so support, flow, and process work has stable task, lock, blocker, closure, and run-plan artifacts.
8. Run `npm run dataset:curation-gate` with the rows, schema report, QA report, profile, full contract context files, and any generated classification/location authoring queues.
9. Use `$foundry-tidas-import` as the Foundry-local orchestration entrypoint for external package or source-document imports. Use `$foundry-tidas-authoring` only after curation-gate authoring tasks, classification decision tasks, or location decision tasks exist and only to produce structured evidence-backed decisions or patches for curation blockers. Apply classification decisions with `dataset-classification-decisions-apply`, apply location decisions with `dataset-location-decisions-apply`, collect field patches with `dataset-authoring-patch-collect`, then after deterministic apply rerun SDK validation, deterministic QA, and the Foundry curation gate on the final rows before mutation manifest.
10. Run `npm run dataset:curation-cleanup` after source trace has been captured in authoring packages and before remote write planning.
11. Do not treat historical `.foundry` artifacts as proof for a current task.

`annualSupplyOrProductionVolume` is schema-required. If source data does not provide a real annual volume, Foundry must use the deterministic `9999 missing-data-sentinel/year` placeholder, not `common:other` deferral. The sentinel is deliberately non-physical and searchable; database-side curation owns replacing it later.

## Commit Rules

Keep commits small and thematic. Do not commit `.foundry/`, `.env`, logs, source packages under `tmp/`, workspace clones, credentials, or downloaded private payloads.
