---
id: FU-LCA-COMPUTE-20260510-004
title: "Add dry-run update command for account process repairs"
state: Ready
kind: publish-dry-run
category: account-governance
priority: P0
allow_remote_commit: false
parent_task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
owner_project: "tiangong-lca-cli"
capability_scope: "Dry-run account process repair mutations without committing remote writes."
shared_or_project_specific: "shared"
why_not_foundry_local: "Dry-run mutation semantics must match the public remote write path and should be callable outside a single foundry task."
expected_input_contract: "State-code-aware mutation plan JSON, account/dataset scope, credentials, and explicit --dry-run --out-dir flags."
expected_output_contract: "Dry-run result JSON with would_update, would_insert, skip, manual-review, errors, and remote_commit_allowed=false."
suggested_implementation_location: "tiangong process save-draft or dataset mutation dry-run command"
---

## Blocker

The current task has no evidence-backed eligible repair payloads, and a reusable dry-run mutation command is still needed for future eligible candidates.

## Expected Output

Dry-run result listing rows that would update, insert, skip, or require manual review.

## Owning Project

tiangong-lca-cli

## Ownership Decision

Shared or project-specific: shared

Dry-run mutation semantics must match the public remote write path and should be callable outside a single foundry task.

## Expected Input Contract

State-code-aware mutation plan JSON, account/dataset scope, credentials, and explicit --dry-run --out-dir flags.

## Expected Output Contract

Dry-run result JSON with would_update, would_insert, skip, manual-review, errors, and remote_commit_allowed=false.

## Suggested Implementation Location

tiangong process save-draft or dataset mutation dry-run command

## Done Criteria

Dry-run succeeds on explicit input files and writes machine-readable operation counts without committing.

## Generated From

- parent task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
- generated at: 2026-05-12T17:29:26.751Z
- blocker context: full current-account process/exchange/flow export not available in this run; per-exchange reference-flow closure checker not available in this run; repair payloads were not generated, so dry-run was not executed; matrix readiness and compute validation were not executed
