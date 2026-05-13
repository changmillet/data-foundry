---
id: FU-LCA-COMPUTE-20260510-001
title: "Export credential-scoped process-exchange-flow graph"
state: Ready
kind: dataset-inventory
category: account-governance
priority: P0
allow_remote_commit: false
parent_task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
owner_project: "tiangong-lca-cli"
capability_scope: "Export credential-scoped process, exchange, flow, reference-flow, state_code, and source evidence inventory."
shared_or_project_specific: "shared"
why_not_foundry_local: "The export needs a reusable authenticated current-account data command with a stable JSON contract."
expected_input_contract: "Current TianGong env credentials, account/user filter, dataset scope, and explicit --out-dir."
expected_output_contract: "Process/exchange/flow/reference-flow JSON or JSONL files plus source manifest and error_class."
suggested_implementation_location: "tiangong-lca-cli dataset inventory/export command, then foundry adapter"
---

## Blocker

The current foundry probe can freeze data for this task, but a durable reusable current-account process/exchange/flow export command is still missing.

## Expected Output

Current env account process rows, exchanges, reference flow rows, state_code inventory, and source manifest.

## Owning Project

tiangong-lca-cli

## Ownership Decision

Shared or project-specific: shared

The export needs a reusable authenticated current-account data command with a stable JSON contract.

## Expected Input Contract

Current TianGong env credentials, account/user filter, dataset scope, and explicit --out-dir.

## Expected Output Contract

Process/exchange/flow/reference-flow JSON or JSONL files plus source manifest and error_class.

## Suggested Implementation Location

tiangong-lca-cli dataset inventory/export command, then foundry adapter

## Done Criteria

A repeatable CLI command writes JSON/JSONL inventory plus manifest to an explicit out-dir without remote mutation.

## Generated From

- parent task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
- generated at: 2026-05-12T17:29:26.750Z
- blocker context: full current-account process/exchange/flow export not available in this run; per-exchange reference-flow closure checker not available in this run; repair payloads were not generated, so dry-run was not executed; matrix readiness and compute validation were not executed
