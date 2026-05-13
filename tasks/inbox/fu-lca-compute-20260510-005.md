---
id: FU-LCA-COMPUTE-20260510-005
title: "Add matrix readiness and compute verification command"
state: Ready
kind: verification
category: matrix-readiness
priority: P0
allow_remote_commit: false
parent_task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
owner_project: "tiangong-lca-calculator or tiangong-lca-cli"
capability_scope: "Verify matrix readiness and compute factorization status for a repaired process graph."
shared_or_project_specific: "shared"
why_not_foundry_local: "The readiness result depends on calculator behavior and should be exposed through a reusable command rather than inferred in foundry."
expected_input_contract: "Frozen process graph or dataset snapshot, calculation scope, account context, and explicit --out-dir."
expected_output_contract: "Readiness JSON with closure gate, matrix construction status, factorization status, compute validation status, blockers, and error_class."
suggested_implementation_location: "calculator-owned readiness check exposed through CLI"
---

## Blocker

Matrix readiness and solve_all_unit verification cannot be marked passed until a real checker runs.

## Expected Output

Readiness report, factorization status, and compute validation status for a new snapshot.

## Owning Project

tiangong-lca-calculator or tiangong-lca-cli

## Ownership Decision

Shared or project-specific: shared

The readiness result depends on calculator behavior and should be exposed through a reusable command rather than inferred in foundry.

## Expected Input Contract

Frozen process graph or dataset snapshot, calculation scope, account context, and explicit --out-dir.

## Expected Output Contract

Readiness JSON with closure gate, matrix construction status, factorization status, compute validation status, blockers, and error_class.

## Suggested Implementation Location

calculator-owned readiness check exposed through CLI

## Done Criteria

A run can prove factorization prepared or produce a precise blocker without fabricating compute success.

## Generated From

- parent task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
- generated at: 2026-05-12T17:29:26.751Z
- blocker context: full current-account process/exchange/flow export not available in this run; per-exchange reference-flow closure checker not available in this run; repair payloads were not generated, so dry-run was not executed; matrix readiness and compute validation were not executed
