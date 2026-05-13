---
id: FU-LCA-COMPUTE-20260510-003
title: "Add state-code-aware mutation plan validator"
state: Ready
kind: schema-repair
category: mutation-policy
priority: P0
allow_remote_commit: false
parent_task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
owner_project: "tiangong-lca-data-foundry"
capability_scope: "Validate foundry mutation-plan entries against state_code, evidence, dry-run, and remote-write gates."
shared_or_project_specific: "project-specific"
why_not_foundry_local: "This gate enforces foundry task policy over foundry-owned mutation-plan artifacts."
expected_input_contract: "Foundry mutation-plan JSON and evidence manifest paths."
expected_output_contract: "Validator JSON with pass/fail gate status, reasons, and blocked remote commit flag."
suggested_implementation_location: "scripts/foundry.mjs validator or dedicated foundry command"
---

## Blocker

Mutation plans need an executable gate that enforces update-first for state_code=0 and source review for state_code=100.

## Expected Output

Validator report with pass/fail gate status for every proposed mutation.

## Owning Project

tiangong-lca-data-foundry

## Ownership Decision

Shared or project-specific: project-specific

This gate enforces foundry task policy over foundry-owned mutation-plan artifacts.

## Expected Input Contract

Foundry mutation-plan JSON and evidence manifest paths.

## Expected Output Contract

Validator JSON with pass/fail gate status, reasons, and blocked remote commit flag.

## Suggested Implementation Location

scripts/foundry.mjs validator or dedicated foundry command

## Done Criteria

Plans without evidence, insert reason, dry-run status, or state_code policy are rejected before remote write.

## Generated From

- parent task: lca-compute-task-2026-05-10-factorization-not-prepared-singular
- generated at: 2026-05-12T17:29:26.751Z
- blocker context: full current-account process/exchange/flow export not available in this run; per-exchange reference-flow closure checker not available in this run; repair payloads were not generated, so dry-run was not executed; matrix readiness and compute validation were not executed
