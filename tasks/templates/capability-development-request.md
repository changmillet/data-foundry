---
id: CAP-YYYYMMDD-001
title: "Add reusable capability for <capability>"
state: Ready
kind: capability-development
category: workspace-capability
priority: P1
allow_remote_commit: false
capability_scope: "<one sentence>"
owner_project: "<tiangong-lca-cli|tiangong-lca-skills|tiangong-lca-calculator|database-engine|tiangong-lca-edge-functions|tidas-sdk|tidas-tools|tiangong-lca-data-foundry>"
shared_or_project_specific: "<shared|project-specific>"
why_not_foundry_local: "<required when owner_project is not tiangong-lca-data-foundry>"
expected_input_contract: "<files/flags/env/query inputs>"
expected_output_contract: "<JSON/JSONL/report/dry-run outputs>"
suggested_implementation_location: "<repo path or command surface>"
parent_task:
---

## Blocker

Describe the missing capability and the task it blocks.

## Ownership Decision

Explain why this belongs to `owner_project` instead of being implemented directly in foundry.

Use `specs/capability-ownership-rules.json` as the routing source.

## Expected Input Contract

List required files, flags, env variables, credentials, or adapters.

## Expected Output Contract

List expected artifacts, schemas, status fields, and error classifications.

## Done Criteria

- Capability has a stable command, skill, or runtime entrypoint in the owning project.
- Foundry can call it through a thin adapter with explicit input/output paths.
- A source manifest records the owning repo, command, inputs, outputs, and gate status.
- Dry-run or read-only mode is available when remote writes are involved.
