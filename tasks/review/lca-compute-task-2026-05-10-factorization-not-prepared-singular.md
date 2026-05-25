---
id: lca-compute-task-2026-05-10-factorization-not-prepared-singular
title: "Repair credential-scoped process graph after factorization-not-prepared singular failure"
state: Blocked
kind: account-repair
category: lca-compute-matrix-readiness
priority: P0
allow_remote_commit: false
account_env_target: current-credentials
source_report: inputs/diagnostics/lca-compute-task-2026-05-10-factorization-not-prepared-singular.md
created_at_utc: 2026-05-13T00:00:00Z
claimed_at_utc: 2026-05-12T17:29:26.708Z
updated_at_utc: 2026-05-23T15:25:08.855Z
workspace: .foundry/workspaces/lca-compute-task-2026-05-10-factorization-not-prepared-singular
run_count: 4
completed_run_at_utc: 2026-05-13T04:54:23.916Z
result: probe_completed_remote_write_blocked
report: .foundry/workspaces/lca-compute-task-2026-05-10-factorization-not-prepared-singular/reports/second-cycle-report.md
matrix_readiness_status: blocked
compute_validation_status: not_run
blocker_count: 6
follow_up_task_count: 5
remote_process_count: 6827
remote_exchange_count: 52196
closure_passed_count: 39739
closure_failed_count: 12457
repair_candidate_count: 187
mutation_entry_count: 187
dry_run_status: blocked
verification_status: blocked
online_write_performed: false
closure_target_count: 40177
closure_closed_non_elementary_count: 27720
closure_elementary_excluded_count: 12019
closure_flow_metadata_missing_count: 936
---

## Problem Summary

LCA compute produced `factorization key not prepared` after an earlier same-snapshot `matrix is singular` failure. The first cycle should treat the singular matrix as the root compute failure and the factorization-not-prepared error as a derived failure state.

## Suspected Root Cause

The current diagnostic seed points to account-owned process graph quality problems: missing quantitative references, duplicate exchange structures, service loops, and likely incomplete exchange-flow to provider reference-flow closure.

## Expected Outputs

- input freeze and source manifest
- process inventory
- exchange inventory
- flow inventory
- reference-flow closure report
- state_code inventory
- evidence gap inventory
- repair candidates
- state-code-aware mutation plan
- dry-run status
- completeness snapshot JSON and markdown
- verification status or blocker
- follow-up task records

## Write Policy

Default write mode is dry-run. Remote commit is not allowed for this task.

For `state_code=0`, ordinary account-owned working data repair should prefer update after evidence, mutation-plan, dry-run, and verification gates pass.

For `state_code=100`, do not overwrite directly. Create a source-review path and only propose a repair when evidence is sufficient.

Insert/versioned writes require an explicit reason in the mutation plan.

## Evidence Policy

Numeric and semantic repairs must record field path, old value, new value or unresolved status, unit, source, source type, source location, derivation method, confidence, and reviewer note.

Unsupported values must stay unresolved and produce follow-up tasks.

The `source_report` path is a sanitized diagnostic seed under `inputs/diagnostics/`. Do not commit full private payload exports or private source data only to satisfy traceability; freeze them under `.foundry/` or a governed private artifact root.

## Completeness Metrics

Track total processes, total exchanges, distinct exchange flows, covered reference-flow processes, missing reference-flow processes, ambiguous flow matches, missing/duplicate flows, unresolved `meanValue` evidence, unit/dimension mismatches, state_code mutation counts, matrix readiness, compute validation, blockers, and generated follow-up tasks.

## Execution Checklist

- [x] Freeze local diagnostic report and record live dataset export blocker.
- [x] Generate first audit artifacts for known process findings, state_code inventory, and evidence gaps.
- [x] Assign closure status for every process exchange.
- [x] Create first repair candidate records as review-only candidates.
- [x] Generate state-code-aware mutation plan.
- [x] Record dry-run blocker.
- [x] Generate completeness snapshot.
- [x] Record matrix readiness / compute verification blocker.
- [x] Generate follow-up tasks for missing capabilities or data.

## Done Criteria

Keep this task in `review` until all done criteria from `specs/account-level-repair-cycle.md` pass or are explicitly waived with evidence. Do not move it to `done` after only writing docs or plan stubs.
