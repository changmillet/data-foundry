# Orchestrator v0

The v0 orchestrator turns the filesystem queue into an executable workflow.

## Commands

```bash
npm run init:runtime
npm run orchestrator:once
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

## First Handler

The first implemented handler supports:

```yaml
kind: category-update
category: electricity_system
source: LCA-DATA-AGENT
```

It reads the example-account electricity work package from `LCA-DATA-AGENT`, freezes the category inventory into the task workspace, writes repair/version/dry-run plans, and moves the task to `review` when blocking gates remain.

## Current Friction

- The runtime environment does not guarantee `jq`, so the orchestrator uses Node built-in JSON parsing only.
- The first handler consumes existing `LCA-DATA-AGENT` artifact paths. A later version should replace these path assumptions with a source adapter configuration.
