# Task Queue

The first tracker adapter is filesystem-backed.

## Directories

- `inbox/`: new tasks
- `active/`: claimed or currently running tasks
- `review/`: completed by agent and awaiting release gate
- `done/`: terminal tasks

The v0 orchestrator is filesystem-backed:

```bash
npm run orchestrator:once
npm run orchestrator:run
npm run orchestrator:status
```

`orchestrator:once` is the default test entrypoint. It claims one eligible task, creates `.foundry/workspaces/<task-id>/`, writes machine-readable outputs, and moves the task to `review` or `done` according to gates.

## Task File Shape

```md
---
id: DATA-001
title: Review electricity category for example-account account
state: Todo
kind: category-update
category: electricity_system
priority: P1
allow_remote_commit: false
---

Task body here.
```
