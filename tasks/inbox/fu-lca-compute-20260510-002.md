---
id: FU-LCA-COMPUTE-20260510-002
title: "Implement reference-flow closure checker for process exchanges"
state: Ready
kind: reference-closure
category: matrix-readiness
priority: P0
allow_remote_commit: false
parent_task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
owner_project: "tiangong-lca-cli or tiangong-lca-skills"
capability_scope: "Classify provider closure for every non-elementary process exchange flow."
shared_or_project_specific: "shared"
why_not_foundry_local: "Closure checking is a reusable matrix-readiness capability and should be exposed as a stable CLI command before a thin skill wrapper."
expected_input_contract: "Process-exchange-flow graph JSON, flow type/category metadata, reference-flow process inventory, unit and dimension fields."
expected_output_contract: "Per-exchange closure JSON, status counts, unresolved issue list, markdown summary, and error_class on failure."
suggested_implementation_location: "CLI command first, thin skill wrapper second"
---

## Blocker

The current foundry probe can classify the frozen task graph, but a reusable CLI/skill closure checker is still missing.

## Expected Output

Per-exchange closure JSON with closed/missing/proxy/cutoff/unit/dimension statuses and markdown summary.

## Owning Project

tiangong-lca-cli or tiangong-lca-skills

## Ownership Decision

Shared or project-specific: shared

Closure checking is a reusable matrix-readiness capability and should be exposed as a stable CLI command before a thin skill wrapper.

## Expected Input Contract

Process-exchange-flow graph JSON, flow type/category metadata, reference-flow process inventory, unit and dimension fields.

## Expected Output Contract

Per-exchange closure JSON, status counts, unresolved issue list, markdown summary, and error_class on failure.

## Suggested Implementation Location

CLI command first, thin skill wrapper second

## Done Criteria

Every exchange in the target scope has exactly one closure status and unresolved rows have follow-up records.

## Generated From

- parent task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
- generated at: 2026-05-12T17:29:26.750Z
- blocker context: full current-account process/exchange/flow export not available in this run; per-exchange reference-flow closure checker not available in this run; repair payloads were not generated, so dry-run was not executed; matrix readiness and compute validation were not executed
