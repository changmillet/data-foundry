---
title: Data Import Loop
docType: reference
scope: data-import-loop
status: active
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when needing a compact conceptual summary of the import loop
  - when drafting high-level task or onboarding language, not executable step order
whenToUpdate:
  - when Foundry import lanes, required artifact classes, or remote-write policy changes
checkPaths:
  - docs/data-governance-loop.md
  - WORKFLOW.md
  - docs/foundry-task-contracts.md
  - specs/workspace-capability-adapters.md
  - specs/automated-lca-capability-registry.json
lastReviewedAt: 2026-06-05
lastReviewedCommit: 76830c7adc67126a795f5fdc1c650fe56ac7b5e2
related:
  - WORKFLOW.md
  - docs/foundry-task-contracts.md
  - specs/workspace-capability-adapters.md
---

# Data Import Loop

Foundry now centers on importing external source material into TIDAS data.

```text
source intake -> contract context -> conversion or source extraction -> AI repair/authoring -> schema/QA gates -> dry-run publish/import -> verification / follow-up
```

## Inputs

- source package manifest or source document note
- target TIDAS dataset type
- SDK-backed schema, methodology YAML, and runtime ruleset context
- source evidence requirements
- write policy and allowed remote mode

## Outputs

- contract context manifest
- conversion report or source extraction report
- candidate TIDAS rows
- validation and QA findings
- repair queue or explicit blocker report
- mutation/publish dry-run plan
- completeness snapshot
- verification or readback report when remote writes are explicitly allowed

## Default Rule

An agent may propose data repairs and candidate rows, but it must not publish them directly unless the task and `WORKFLOW.md` policy allow remote commit.

## Dataset Construction Principles

### Traceability

Record the source of every factual value, including documents, tables, reports, web pages, conversion traces, and transformation assumptions.

If a value is inferred or normalized, record the transformation and the evidence boundary.

### Transparency

Keep unresolved assumptions explicit. Do not silently convert weak evidence into final data.

### Validation

Candidate rows must pass TIDAS schema validation, semantic QA, reference closure, and dry-run publish/import gates before they can be considered ready.
