# Workspace Capability Adapters

Foundry adapters are routing records. They identify which shared command or skill should run and what artifacts must exist afterward. They do not own conversion, schema, AI prompt, review, or database write business logic.

The machine-readable registry is `specs/automated-lca-capability-registry.json`.

## Core Classes

| Class | Purpose |
| --- | --- |
| `tidas-contract-context` | Fetch SDK-backed schema, methodology YAML, runtime ruleset, and AI context artifacts. |
| `external-lca-package-conversion` | Convert supported packaged LCA data through CLI/tidas-tools. |
| `source-document-authoring` | Extract source documents and prepare target context packs for AI authoring. |
| `source-evidence-review` | Plan and record public/source evidence review for field-level facts. |
| `schema-gate` | Validate generated TIDAS rows. |
| `process-review` / `flow-review` | Run target-type review gates. |
| `bilingual-gate` | Extract, apply, and validate bilingual fields. |
| `reference-closure` | Refresh or verify local references before publish preparation. |
| `publish-prep` | Prepare local publish/import bundles without remote commit. |
| `remote-verification` | Read back remote rows when a task explicitly reaches that stage. |

## Route Examples

```bash
npm run capabilities:list -- --class tidas-contract-context
npm run capabilities:list -- --class external-lca-package-conversion
npm run capabilities:list -- --class source-document-authoring
npm run task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema
npm run task:route -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema
```

Missing classes must be resolved in the owning project. Add Foundry-local code only for task routing, manifests, reports, and policy checks.
