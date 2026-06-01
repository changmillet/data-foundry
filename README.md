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
npm run dataset:curation-gate -- \
  --type process \
  --rows-file ./rows/processes.jsonl \
  --schema-report ./schema/report.json \
  --qa-report ./qa/process-qa-report.json \
  --schema-file ./context/process/schema.json \
  --yaml-file ./context/process/methodology.yaml \
  --ruleset-file ./context/process/runtime-ruleset.json \
  --profile bafu

npm run dataset:curation-cleanup -- \
  --type process \
  --rows-file ./rows/processes.jsonl \
  --out-file ./rows/processes.cleaned.jsonl
```

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
