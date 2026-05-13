# Orchestrator v0

The v0 orchestrator turns the filesystem queue into an executable workflow.

## Commands

```bash
npm run init:runtime
npm run workspace:map
npm run env:check
npm run orchestrator:once
npm run orchestrator:rerun-review -- --task-id DATA-001
npm run compute-repair:rerun
npm run orchestrator:run
npm run orchestrator:status
npm run tasks:check
```

## State Machine

```text
tasks/inbox -> tasks/active -> tasks/review -> tasks/done
```

- `inbox`: task accepted but not claimed.
- `active`: task claimed and currently running.
- `review`: evidence is ready, but a human or policy gate still needs to review it.
- `done`: terminal state. Only use this when all required gates pass or are explicitly waived with saved evidence.

## Runtime Outputs

Runtime state is local-only:

- `.foundry/state/orchestrator-status.json`
- `.foundry/state/orchestrator.lock`
- `.foundry/workspaces/<task-id>/inputs/`
- `.foundry/workspaces/<task-id>/outputs/`
- `.foundry/workspaces/<task-id>/reports/`
- `.foundry/workspaces/<task-id>/logs/orchestrator.ndjson`

`workspace:map` is read-only and writes no runtime state. Use it before adding or debugging handlers that depend on workspace submodules, LCA skills, hybrid search, Edge Functions, database RPCs, or installed runtime skills.

When a handler discovers a missing capability, it must classify ownership before adding new logic. Use `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json` to decide whether the fix is foundry-local orchestration or a shared development request for `tiangong-lca-cli`, `tiangong-lca-skills`, calculator, database, Edge Functions, or TIDAS tooling.

When a handler needs to name the account scope, use `docs/account-context-policy.md`: personal account names belong in local `.env` as optional `FOUNDRY_ACCOUNT_LABEL` display values, while AI execution should rely on the resolved credentials/session and frozen manifest.

## First Handler

The first implemented handler supports:

```yaml
kind: category-update
category: electricity_system
source: LCA-DATA-AGENT
```

It reads the private electricity seed work package from `LCA-DATA-AGENT`, freezes the category inventory into the task workspace, writes repair/version/dry-run plans, and moves the task to `review` when blocking gates remain.

The handler now also writes:

- `outputs/schema-repair-candidates/summary.json`
- `outputs/schema-repair-candidates/candidates.jsonl`
- `outputs/schema-repair-candidates/skipped.json`
- `outputs/reference-closure/summary.json`
- `outputs/reference-closure/closure-candidates.jsonl`
- `outputs/single-record-smoke/single-record-smoke-plan.json`
- `outputs/single-record-smoke/flow-publish-dry-run-input.jsonl`

`single-record-smoke` is a preparation artifact only. It is not a commit path unless both environment gates and task-level policy allow a one-record remote write.

## Account Compute Repair Handler

The account repair handler supports:

```yaml
kind: account-repair
category: lca-compute-matrix-readiness
```

It creates the account repair workspace layout, freezes a local diagnostic report when available, writes audit stubs and known findings, generates a completeness snapshot, creates a state-code-aware mutation plan, records dry-run and verification blockers, and writes follow-up task records for missing CLI/skill capabilities.

This handler does not claim database, KB, dry-run, or compute verification success unless those steps actually run.

`compute-repair:probe` is the remote-enabled second-cycle path for this task type. It now writes flow metadata fetch progress before and after each remote `flow list` batch:

- `input-freeze/flow-metadata-fetch/progress.jsonl`
- `input-freeze/flow-metadata-fetch/checkpoint.json`
- `input-freeze/flow-metadata-fetch/summary.json`

The probe reuses a matching completed `input-freeze/flow-metadata-for-exchange-flows.json` cache when the requested exchange flow id set is unchanged. If a batch times out or fails, the probe records the batch index, `error_class`, timeout, and partial checkpoint instead of waiting silently until the agent turn is interrupted.

## Current Friction

- The runtime environment does not guarantee `jq`, so the orchestrator uses Node built-in JSON parsing only.
- The first handler consumes existing `LCA-DATA-AGENT` artifact paths. A later version should replace these path assumptions with a source adapter configuration.
- The local inventories do not guarantee public database completeness. Reference closure can classify local exact/any-version/name matches, while live public lookup remains a remote-enabled step.
- Hybrid search is intentionally routed through `tiangong search ...` or the search skills. The foundry should use Edge Function and database repositories for diagnosis or implementation work, not as direct hidden runtime calls.
- The workspace has two relevant skills roots: workspace-pinned `tiangong-lca-skills` and an optional sibling `lca-skills` checkout. Every run manifest must record which root was used.
- Shared capabilities should become `capability-development` follow-up tasks with an owning project and explicit input/output contracts instead of being embedded into task-specific foundry handlers.
