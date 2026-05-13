---
id: lca-compute-task-YYYY-MM-DD-short-name
title: "Repair account process graph after LCA compute failure"
state: Ready
kind: account-repair
category: lca-compute-matrix-readiness
priority: P0
allow_remote_commit: false
account_env_target: current-credentials
source_report:
---

## Problem Summary

Describe the compute failure and the first root-cause signal, for example `matrix is singular` or `factorization key not prepared`.

## Suspected Root Cause

State whether the suspected cause is missing reference-flow closure, duplicate exchange structure, service loops, missing quantitative reference, unit mismatch, or another matrix-readiness blocker.

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

Default write mode is dry-run. `state_code=0` prefers update after gates pass. `state_code=100` requires source review and must not be overwritten directly. Insert/versioned writes require explicit reason.

## Done Criteria

The task can move to `done` only when all process exchanges have closure status, every numeric repair has evidence or unresolved status, a mutation plan exists, dry-run and verification gates are satisfied or explicitly waived, and no unsafe remote write was performed.
