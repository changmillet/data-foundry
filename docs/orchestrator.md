# Foundry Orchestrator

The Foundry orchestrator is a thin control plane. It routes tasks, creates isolated workspaces, records selected capabilities, and checks that artifact gates exist. Reusable data logic belongs in the owning project: CLI, skills, SDK, tools, database, Edge Functions, or calculator.

## Runtime Commands

```bash
npm run task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema
npm run task:route -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema
npm run orchestrator:once
npm run orchestrator:status
```

## Supported Lanes

`external-dataset-curated-import` is for packaged LCA datasets. The orchestrator must select contract-context, converter, schema, QA, reference, publish-prep, and verification capabilities.

`source-evidence-dataset-development` is for PDF, Excel, web exports, screenshots, and free text. The orchestrator must select contract-context, source-document authoring, evidence review, schema, and QA capabilities.

## Missing Capability Rule

When a handler discovers missing shared behavior, it must classify ownership before adding new local code. Use `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`.

Foundry-owned changes are limited to routing, task state, reports, manifests, and policy checks. Shared implementation belongs in the owning project and should be tracked through a capability-development task.
