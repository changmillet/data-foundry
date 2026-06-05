---
title: Data Foundry Service
docType: service-contract
scope: data-foundry
status: active
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when checking the service-level scope of Foundry lanes and artifact classes
  - when comparing high-level service boundaries against current workflow docs
whenToUpdate:
  - when supported production lanes, owner boundaries, or required artifact classes change
related:
  - WORKFLOW.md
  - docs/workspace-project-map.md
  - specs/workspace-capability-adapters.md
  - specs/automated-lca-capability-registry.json
---

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
- policy checks and handoff records;
- gate aggregation across owner-produced artifacts.

Foundry does not own:

- TIDAS schemas, YAML methodology, or runtime rulesets;
- source package converters;
- AI authoring implementation;
- external source-evidence research skills;
- dataset validators and QA engines;
- curation queue state machines;
- database write semantics.

Those capabilities belong in `tidas-sdk`, `tidas-tools`, `tiangong-lca-cli`, `tiangong-lca-skills`, external runtime skill repositories such as `tiangong-ai/skills`, Edge Functions, database, or calculator projects.

## Required Artifacts

Every import task should produce:

- contract context manifest for each target TIDAS type;
- runtime skill resolution manifest when an external source-evidence skill is used;
- source package or source document manifest;
- conversion report or source extraction report;
- CLI curation queue build/next/verify reports;
- validation and QA reports;
- repair queue or explicit blocker report when validation fails;
- dry-run publish/import plan before any remote write;
- write policy, account guard, commit handoff, and verification/readback artifacts when remote writes are profile-gated and explicitly in scope.

## Primary References

- `WORKFLOW.md`
- `docs/workspace-project-map.md`
- `specs/workspace-capability-adapters.md`
- `specs/automated-lca-capability-registry.json`
