# TianGong LCA Data Foundry

Control plane for turning external source material into validated, import-ready TIDAS data.

Foundry is intentionally thin. It owns task routing, local workspaces, import profiles, curation packages, cleanup reports, and policy checks. Reusable schema, conversion, validation, QA, skill, and database behavior belongs in `tidas-sdk`, `tidas-tools`, `tiangong-lca-cli`, `tiangong-lca-skills`, Edge Functions, or database projects.

## Import Lanes

- `external-dataset-curated-import`: packaged LCA datasets converted through `tiangong-lca dataset import-lca convert` / `tidas-tools`, then validated, QA checked, curated, cleaned, dry-run, and verified.
- `source-evidence-dataset-development`: PDF, Excel, web exports, images, markdown, or free text extracted through CLI/skills, authored into candidate TIDAS rows with source evidence, then sent through the same validation and curation gates.

Rows stay source-language before database import. Missing bilingual text is not an import blocker.

## Core Commands

```bash
npm run init:runtime
npm run doctor
npm run workflow:check
npm run storage:check
npm run acceptance:check
npm run workspace:map
npm run capabilities:list -- --class tidas-contract-context
npm run profiles:list
npm run task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema,qa,curation
```

Use the generic curation commands for every supported TIDAS type:

```bash
npm run dataset:curation-queue:build -- \
  --processes ./rows/processes.jsonl \
  --flows ./rows/flows.jsonl \
  --support ./rows/sources.jsonl \
  --out-dir ./curation-queue

npm run dataset:identity-preflight-query:audit -- \
  --index ./identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir ./identity-preflight-query-audit

npm run dataset:identity-preflight:run -- \
  --index ./identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir ./identity-preflight-run \
  --only-pending

npm run dataset:curation-gate -- \
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
  --require-identity-preflight \
  --profile bafu

npm run dataset:authoring-plan -- \
  --curation-gate-report ./curation-gate/dataset-curation-gate-report.json \
  --out-dir ./authoring-plan

npm run dataset:identity-decision-task:build -- \
  --curation-gate-report ./curation-gate/dataset-curation-gate-report.json \
  --out-dir ./identity-decision-task

npm run dataset:classification-decision-task:build -- \
  --classification-queue ./classification-authoring-queue.jsonl \
  --out-dir ./classification-decision-task

npm run dataset:location-decision-task:build -- \
  --location-queue ./location-authoring-queue.jsonl \
  --out-dir ./location-decision-task

npm run dataset:curation-cleanup -- \
  --type process \
  --rows-file ./rows/processes.jsonl \
  --out-file ./rows/processes.cleaned.jsonl

npm run dataset:support-cache:refresh -- \
  --out specs/canonical-support/flow-properties-unit-groups.json
```

`dataset:curation-queue:build` is a thin wrapper over `tiangong-lca dataset curation-queue build`; set `TIANGONG_LCA_CLI_BIN` only when a local sibling CLI checkout should be used for validation. For packaged bundle samples, pass the generated `classification-authoring-queue.jsonl`, `location-authoring-queue.jsonl`, and `identity-preflight-requests.jsonl` into `dataset:curation-gate` so target taxonomy, `tidas_locations_category.json`, and completed `process_hybrid_search` / `flow_hybrid_search` evidence become concrete AI authoring context. Before running remote identity preflight, run `dataset:identity-preflight-query:audit`; it verifies that the actual Edge request body has a complete fielded `query` and no placeholder/source-format noise because Edge ignores local-only `profile_hints`. `dataset:authoring-plan` is the read-only coordinator after curation: it inspects the curation gate report plus any existing decision/task/apply reports and tells Codex/skills whether to build tasks, write AI decisions/patches, run deterministic apply, or move to post-authoring finalize. `dataset:identity-preflight:run` is read-only; `blocked` and `needs_review` identity findings are retained as evidence. Full-context process/flow profiles require completed current/dependency identity searches automatically at curation and finalize gates; `--require-identity-preflight` remains accepted as an explicit hard-gate flag. Identity manual-review action items must be turned into `identity-decisions.jsonl` from a ready `dataset:identity-decision-task:build` output and then applied through `dataset:identity-decisions:apply`; AI must decide `reuse_existing_reference`, `create_new`, or `block_unresolved` from the full authoring package and candidate evidence, and elementary flows must never choose `create_new`. When the authoring package directory is known, identity apply commands include `--authoring-package-dir` so deterministic apply can require readable package proof. The curation gate also attaches the bundled TIDAS category schemas and location schema as full-text contract context for full-context AI authoring. Identity/classification/location decision task builders can be chunked with `--dataset-type`, `--dataset-id`, `--bundle-id`/`--process-id`, `--limit`, `--offset`, and `--chunk-label` where supported; they return `blocked_missing_full_context` instead of a ready AI task when schema, methodology YAML, runtime ruleset, category/location schema, authoring package, identity evidence, or converted row payload context is missing. Non-identity/non-classification/non-location authoring task build uses the same readiness gate, and `dataset:authoring-patch:collect` rechecks the manifest/task full-context proof so stale or incomplete AI tasks cannot be collected into patches. Apply commands accept repeated `--decision-task` values where task-bundle proof is required so independently authored chunks can be proven against one source queue; identity decisions retain `authoring_package_sha256` instead. Every classification or location decision must keep the task template's `authoring_context.context_bundle_sha256` so the prewrite manifest can prove the exact schema/YAML/context bundle. Real source rows should be literature, reports, publications, or traceable source records; format/compliance placeholders such as `ILCD format` or `Not specified` remain provenance/reference rewrites, not imported BAFU source rows. True source rows with empty or generic `sourceDescriptionOrComment` values such as `Report` are repaired from `sourceCitation` / `common:shortName` before write planning. Flow Properties and Unit Groups are reference-only: Foundry keeps the small public canonical set in `specs/canonical-support/flow-properties-unit-groups.json`, rewrites converted references to those existing rows, requires the selected Flow Property's Reference Unit Group to be proven in the same cache, and never writes account-local My Data rows for those types. The mutation manifest blocks support/source write scopes that still try to write format/compliance/placeholder identities as source identity or account-local unit group / flow property support rows.

`annualSupplyOrProductionVolume` remains a required process field. When source data does not provide it, Foundry uses the deterministic `9999 missing-data-sentinel/year` value rather than AI trace deferral. The sentinel is intentionally non-physical and easy to bulk search so later database-side curation can replace it; that replacement is outside Foundry's import task.

`--profile generic` is the default. Dataset-specific behavior is configured in `specs/import-profiles.json`; BAFU is one profile, not a special code path.

## Repository Shape

- `scripts/foundry.mjs`: small Foundry command surface.
- `scripts/lib/import-curation.mjs`: generic dataset curation/cleanup implementation.
- `specs/automated-lca-capability-registry.json`: capability routing registry.
- `specs/import-profiles.json`: data-driven import profiles.
- `docs/import-profiles/bafu/`: BAFU profile context and constraints.
- `tasks/`: lightweight task queue and task templates.
- `.foundry/`: ignored runtime state and generated workspaces.

Remote writes are never automatic. A task must pass schema, QA, curation, cleanup, dry-run, and verification gates, and explicit write policy must allow commit before any database mutation.
