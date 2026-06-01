# Data Foundry Service

Data Foundry is a local control plane for producing TianGong-ready TIDAS data from external source material.

## Scope

Supported production lanes:

- `external-dataset-curated-import`: packaged LCA datasets converted through `tidas-tools` and the CLI.
- `source-evidence-dataset-development`: PDF, Excel, web exports, screenshots, or free text authored into TIDAS candidate data with explicit source evidence.

Foundry owns:

- task intake and filesystem queue state;
- workspace creation under `.foundry/workspaces/<task-id>/`;
- capability route plans;
- artifact manifests and reports;
- policy checks and handoff records.

Foundry does not own:

- TIDAS schemas, YAML methodology, or runtime rulesets;
- source package converters;
- AI authoring implementation;
- dataset validators and review engines;
- database write semantics.

Those capabilities belong in `tidas-sdk`, `tidas-tools`, `tiangong-lca-cli`, `tiangong-lca-skills`, Edge Functions, database, or calculator projects.

## Required Artifacts

Every import task should produce:

- contract context manifest for each target TIDAS type;
- source package or source document manifest;
- conversion report or source extraction report;
- validation and review reports;
- repair queue or explicit blocker report when validation fails;
- dry-run publish/import plan before any remote write;
- verification/readback artifacts when remote writes are explicitly allowed.

## Primary References

- `WORKFLOW.md`
- `docs/workspace-project-map.md`
- `specs/workspace-capability-adapters.md`
- `specs/automated-lca-capability-registry.json`
