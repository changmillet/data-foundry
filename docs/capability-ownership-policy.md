---
title: Capability Ownership Policy
docType: policy
scope: workspace-adapters
status: active
owner: tiangong-lca-data-foundry
---

# Capability Ownership Policy

Foundry must distinguish project-specific orchestration from shared TianGong capabilities before implementing new logic.

## Boundary

Foundry owns:

- task queue and task state;
- per-task workspace layout;
- evidence, source manifests, and reports;
- mutation-plan and remote-write gates;
- acceptance contracts and Stop-hook feedback loops;
- thin adapters that call existing CLI or skill entrypoints.

Foundry does not own:

- reusable TianGong data commands;
- shared agent workflow skills;
- calculator internals;
- database RPC/schema/index behavior;
- Edge Function API behavior;
- TIDAS schema semantics.

## Decision Rule

Use this order before adding code:

1. If the change only coordinates existing commands or checks foundry task artifacts, implement it in foundry.
2. If the change is a reusable primitive command with stable input/output and remote access, create a development request for `tiangong-lca-cli`.
3. If the change is a reusable agent workflow that composes CLI commands, create a development request for `tiangong-lca-skills`.
4. If the change depends on calculator, database, Edge Function, or schema internals, route it to that owning repo.

When unsure, keep the foundry implementation as a thin adapter or stub, stop at dry-run/review, and create a follow-up task with an explicit `owner_project`.

## Shared vs Project-Specific

Treat a capability as shared when any of these are true:

- more than one task type will need it;
- another repo or agent runtime should call it;
- it requires authenticated remote reads or writes;
- it defines a stable data contract;
- it changes business logic or runtime semantics.

Treat a capability as foundry-specific when all of these are true:

- it only checks foundry-owned artifacts;
- it only controls task state, workspace layout, or gate reconciliation;
- it does not duplicate CLI, skill, database, Edge, calculator, or schema behavior.

## Follow-Up Requirement

Every missing shared capability follow-up must include:

- `capability_scope`
- `owner_project`
- `shared_or_project_specific`
- `why_not_foundry_local`
- `expected_input_contract`
- `expected_output_contract`
- `suggested_implementation_location`
- `done_criteria`

The machine-readable rules live in `specs/capability-ownership-rules.json`.
