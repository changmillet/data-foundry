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
  - scripts/lib/foundry-command-metadata.mjs
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
- External source-evidence and document-extraction skills, including `tiangong-kb-sci-search` and `document-granular-decompose`, are installed or read through the npm `skills` package (`npx --yes skills@latest ...`) at runtime before use. Do not copy their retrieval or extraction logic into Foundry.
- Import-ready rows are source-language rows. Do not add bilingual completion as a pre-import gate.
- Do not implement direct database writes in Foundry.
- Runtime `.env` files may provide account credentials and command defaults, but they do not replace the task-local `source-manifest.json`, `profile-lock.json`, account/write guard evidence, checkpoints, or artifact ledger. Durable import facts must live in the task workspace.

## Default Operating Order

1. Read this file and `WORKFLOW.md`.
2. For source-evidence or shared-skill work, read `docs/runtime-skill-management.md` before evidence retrieval.
3. Run `npm run doctor` before trusting local Foundry commands.
4. Classify the task as `external-dataset-curated-import` or `source-evidence-dataset-development`.
5. Get the target TIDAS contract context through the published CLI:

```bash
npx --yes @tiangong-lca/cli@latest dataset context-pack \
  --type <process|flow|source|contact|unitgroup|flowproperty|lifecyclemodel> \
  --profile ai-import \
  --out-dir .foundry/workspaces/<task-id>/context/<type> \
  --json
```

6. For packaged datasets, convert with `npx --yes @tiangong-lca/cli@latest dataset import-lca convert` or `tidas-tools`; do not replace supported converters with AI. Keep per-process bundle generation enabled so `process-bundles/index.json` and one dependency subdirectory per converted process are available for curation. This bundle index is the generic packaged-import entrypoint for process-level dependency closure; dataset profiles may further require a specific converted bundle index. Bundle `manifest` and `tidas_dir` entries may be relative to the index directory and must be resolved before execution.
7. Before using shared skills, run `npm run skills:install:shared` when configured runtime skills may be missing or stale, and `npm run skills:update` for already installed project skills. For source-document fulltext extraction, read the latest remote skill with `npx --yes skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth`; for SCI literature evidence, read `tiangong-kb-sci-search` the same way. Record the upstream ref from `git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main`, then capture retrieved document text or papers as evidence candidates before field-level extraction.
8. Run `npx --yes @tiangong-lca/cli@latest dataset validate` and `npx --yes @tiangong-lca/cli@latest qa <type>` on converted or authored rows.
9. Build and drive the entity-level queue with `npx --yes @tiangong-lca/cli@latest dataset curation-queue build/next/verify` so support, flow, and process work has stable task, lock, blocker, closure, and run-plan artifacts owned by the CLI state machine. Parallel workers are allowed only across independent queue locks and only at the configured task parallelism; passed tasks continue, blocked tasks are recorded for later support/database repair, and reruns resume from checkpoints.
10. Run `node scripts/foundry.mjs dataset-curation-gate` with the rows, schema report, QA report, profile, full contract context files, and any generated classification/location authoring queues.
11. Use `$foundry-tidas-import` as the Foundry-local orchestration entrypoint for external package or source-document imports. Use `$foundry-tidas-authoring` only after curation-gate authoring tasks, classification decision tasks, or location decision tasks exist and only to produce structured evidence-backed decisions or patches for curation blockers. Apply classification decisions with `dataset-classification-decisions-apply`, apply location decisions with `dataset-location-decisions-apply`, collect field patches with `dataset-authoring-patch-collect`, then after deterministic apply rerun SDK validation, deterministic QA, and the Foundry curation gate on the final rows before mutation manifest.
12. Run `node scripts/foundry.mjs dataset-curation-cleanup` after source trace has been captured in authoring packages and before remote write planning.
13. Remote commit is policy-gated rather than manually supervised by default. A task may allow automated batch commit for scopes whose finalize report, mutation manifest, commit handoff, and post-write verification all pass; human input is required for policy changes, exceptional waivers, or blockers such as missing canonical unit groups, flow properties, elementary flows, or unresolved reference closure.
14. Do not treat historical `.foundry` artifacts as proof for a current task.

`annualSupplyOrProductionVolume` is schema-required. If source data does not provide a real annual volume, Foundry must use the deterministic `9999 missing-data-sentinel/year` placeholder, not `common:other` deferral. The sentinel is deliberately non-physical and searchable; database-side curation owns replacing it later.

## Implementation Pattern Requirements

These rules are mandatory for code changes in this repository:

- Read the nearby command/module implementation, tests, and routed workflow docs before editing. New behavior must match the existing Foundry pattern instead of adding one-off scripts, hidden state, or task-specific shortcuts.
- Keep Foundry as a deterministic local control plane: it may index, project, package, checkpoint, summarize blockers, aggregate gates, and call published owner commands; it must not absorb CLI, skill, SDK, converter, database, or Edge ownership.
- Packaged-library imports must make semantic decisions at library scope before projecting to process scopes. Converter-generated classifications are weak hints only; process/flow classification, identity reuse, and canonical support mapping must be backed by AI or human semantic decisions from full row context and then applied through deterministic CLI/Foundry apply reports.
- For BAFU-style packaged imports, converted placeholder support rows must not leak into write scopes. Process `referenceToDataSource` values that point to compliance/data-format/unspecified placeholders must be rewritten first to an unambiguous true report/publication/data source from the bundle context; only when no source evidence exists may Foundry generate the single database-level BAFU fallback source. Whole-database BAFU imports must reuse one canonical FOEN/BAFU contact, not per-bundle tooling contacts.
- Source-only-output process exchanges must not be silently accepted. If the source rows file proves the source process row is also Output-only and the final row preserves the non-flow-reference exchange signature, `dataset-curation-cleanup --source-rows-file` may generate deterministic `tiangongfoundry:sourceExchangeCompleteness` proof; otherwise the row must use AI `source_trace_verified` evidence or remain blocked for exchange repair/review.
- Full-context AI evidence remains valid across deterministic Foundry row transforms only when the transform reports prove the exact input/output rows and payload hashes. Source/contact rewrites, canonical support rewrites, identity reference rewrites, unresolved-exchange externalization, and cleanup must be included in curation-gate and mutation-manifest evidence scope checks. If source/contact rewrites create writable shared contact/source dependencies, prepare support finalize/handoff artifacts separately and keep dependent process/flow/lifecyclemodel scopes blocked until the support rows have been committed through the published CLI and readback-verified.
- Every new or changed Foundry command must keep its stage contract, command metadata, output artifact list, tests, and governed docs in sync with the runtime behavior.
- Do not retain empty compatibility or deprecation scaffolding. Remove old aliases, unused command categories, and orphaned draft docs once command metadata, tests, docs, and docpact show no remaining consumer.
- Tests must follow the repository test layout in `test/README.md`: pure logic in `test/unit`, command contracts in `test/commands`, multi-command workflows in `test/scenarios`, and shared row/report/command helpers in `test/fixtures`. Do not add numbered regression buckets such as `full-context-gate-07.test.mjs`; name scenario files after the behavior surface they cover.
- Every command that can block or defer scopes must write both a complete machine ledger and a reader-facing run report. The ledger is the row-level source of truth; the report must summarize concrete blocker reasons, affected scopes, blocking dependency types or examples, required human action, and the rerun path.
- Batch imports must preserve ready-only execution: blocked scopes are recorded and excluded from write queues, while independent ready scopes continue through dry-run/write/verify when their gates pass.

## Commit Rules

Keep commits small and thematic. Do not commit `.foundry/`, `.env`, logs, source packages under `tmp/`, workspace clones, credentials, or downloaded private payloads.
