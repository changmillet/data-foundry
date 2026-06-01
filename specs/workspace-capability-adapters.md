# Workspace Capability Adapters

Foundry adapters are routing records. They identify which shared command or skill should run and what artifacts must exist afterward. They do not own conversion, schema, AI prompt, QA, or database write business logic.

The machine-readable registry is `specs/automated-lca-capability-registry.json`.

## Core Classes

| Class | Purpose |
| --- | --- |
| `tidas-contract-context` | Fetch SDK-backed schema, methodology YAML, runtime ruleset, and AI context artifacts. |
| `external-lca-package-conversion` | Convert supported packaged LCA data through CLI/tidas-tools. |
| `source-document-authoring` | Extract source documents and prepare target context packs for AI authoring. |
| `source-evidence-review` | Plan and record public/source evidence for field-level facts. |
| `schema-gate` | Validate generated TIDAS rows. |
| `process-qa` / `flow-qa` / `lifecyclemodel-qa` | Run target-type deterministic QA gates. |
| `dataset-curation` | Build profile-aware AI authoring packages from rows, schema reports, QA reports, and optional full SDK schema/YAML context. |
| `reference-closure` | Refresh or verify local references before publish preparation. |
| `publish-prep` | Prepare local publish/import bundles without remote commit. |
| `remote-verification` | Read back remote rows when a task explicitly reaches that stage. |

## Route Examples

```bash
npm run capabilities:list -- --class tidas-contract-context
npm run capabilities:list -- --class external-lca-package-conversion
npm run capabilities:list -- --class source-document-authoring
npm run task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema,qa,curation
npm run dataset:curation-gate -- --type process --rows-file ./rows/processes.jsonl --schema-report ./schema/report.json --qa-report ./qa/process-qa-report.json --schema-file ./contract/schema.json --yaml-file ./contract/methodology.yaml --profile bafu
npm run task:route -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema,qa,curation
```

Missing classes must be resolved in the owning project. Add Foundry-local code only for task routing, manifests, reports, and policy checks.

Import lanes must not require bilingual completion before database import. Use contract context, schema, QA, curation, cleanup, reference, dry-run, and verification gates for source-language rows, then route multilingual completion separately after import if a later task explicitly asks for it.
