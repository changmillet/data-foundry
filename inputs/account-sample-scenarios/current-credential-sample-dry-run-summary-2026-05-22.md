---
title: Current Credential Sample Scenario Dry-Run Summary
docType: test-run-summary
scope: account-sample-scenarios
status: active
owner: tiangong-lca-data-foundry
created_at_utc: 2026-05-22T13:45:39Z
source_scope: sanitized sample scenario index
privacy: sanitized decisions and artifact paths only; no full private payload export
related_issue: https://github.com/tiangong-lca/data-foundry/issues/5
---

# Current Credential Sample Scenario Dry-Run Summary

This summary records the Foundry dry-run result for the sample index in
`inputs/account-sample-scenarios/current-credential-identity-preflight-samples-2026-05-22.md`.

The full command inputs, stdout/stderr captures, and CLI-generated gate artifacts are local runtime
state under:

```text
.foundry/workspaces/issue-5/sample-scenario-dry-run/
```

Those runtime artifacts are intentionally not tracked because they can include operator-local paths.

## Capability Route

The dry-run used `specs/automated-lca-capability-registry.json` and routed each sample through:

- `process|flow identity-preflight`
- `process|flow build-plan validate`
- `process|flow build-plan materialize`
- Foundry's elementary-flow provider-closure eligibility gate

No remote writes were attempted.

## Result Table

| Sample ID | Dataset | Identity gate | BuildPlan gate | Provider closure | Outcome |
| --- | --- | --- | --- | --- | --- |
| `process-current-draft-pv-cn` | process | `passed/update_same_row` | `passed/materialize_payload` | `not_applicable` | Current draft row is selected for update instead of duplicate insert. |
| `process-visible-published-electrolyte` | process | `passed/reuse` | `passed/materialize_payload` | `not_applicable` | Published row is reused; no draft overwrite is planned. |
| `process-visible-same-name-wind-turbines` | process group | `needs_review/manual_review` | `blocked/fix_build_plan` | `not_applicable` | Same-name process rows are not auto-merged by name alone; BuildPlan materialization is blocked for review. |
| `flow-current-draft-reference-pv-cn` | flow | `passed/update_same_row` | `passed/materialize_payload` | `eligible` | Existing draft reference flow is selected for update/reuse. |
| `flow-visible-product-fec` | flow | `passed/reuse` | `passed/materialize_payload` | `eligible` | Published product flow is reused as an identity match. |
| `flow-visible-elementary-basic-violet` | flow | `passed/reuse` | `passed/materialize_payload` | `skipped` | Elementary flow remains valid as an elementary exchange reference but is excluded from product/provider closure matching. |

## Verification Commands

```bash
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run sample-scenarios:dry-run
```

The command completed with `command_failure_count = 0` across all six samples.
