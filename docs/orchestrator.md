# Orchestrator v0

The v0 orchestrator turns the filesystem queue into an executable workflow.

## Commands

```bash
npm run init:runtime
npm run workspace:map
npm run env:check
npm run orchestrator:once
npm run orchestrator:rerun-review -- --task-id DATA-001
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

## First Handler

The first implemented handler supports:

```yaml
kind: category-update
category: electricity_system
source: LCA-DATA-AGENT
```

It reads the example-account electricity work package from `LCA-DATA-AGENT`, freezes the category inventory into the task workspace, writes repair/version/dry-run plans, and moves the task to `review` when blocking gates remain.

The handler now also writes:

- `outputs/schema-repair-candidates/summary.json`
- `outputs/schema-repair-candidates/candidates.jsonl`
- `outputs/schema-repair-candidates/skipped.json`
- `outputs/reference-closure/summary.json`
- `outputs/reference-closure/closure-candidates.jsonl`
- `outputs/single-record-smoke/single-record-smoke-plan.json`
- `outputs/single-record-smoke/flow-publish-dry-run-input.jsonl`

`single-record-smoke` is a preparation artifact only. It is not a commit path unless both environment gates and task-level policy allow a one-record remote write.

## Current Friction

- The runtime environment does not guarantee `jq`, so the orchestrator uses Node built-in JSON parsing only.
- The first handler consumes existing `LCA-DATA-AGENT` artifact paths. A later version should replace these path assumptions with a source adapter configuration.
- The local inventories do not guarantee public database completeness. Reference closure can classify local exact/any-version/name matches, while live public lookup remains a remote-enabled step.
- Hybrid search is intentionally routed through `tiangong search ...` or the search skills. The foundry should use Edge Function and database repositories for diagnosis or implementation work, not as direct hidden runtime calls.
- The workspace has two relevant skills roots: workspace-pinned `tiangong-lca-skills` and an optional sibling `lca-skills` checkout. Every run manifest must record which root was used.
