# Task Queue

The first tracker adapter is filesystem-backed.

## Directories

- `inbox/`: new tasks
- `active/`: claimed or currently running tasks
- `review/`: completed by agent and awaiting release gate
- `done/`: terminal tasks
- `templates/`: reusable task skeletons, not part of the queue

The v0 orchestrator is filesystem-backed:

```bash
npm run orchestrator:once
npm run orchestrator:rerun-review -- --task-id DATA-001
npm run orchestrator:run
npm run orchestrator:status
```

`orchestrator:once` is the default test entrypoint. It claims one eligible task, creates `.foundry/workspaces/<task-id>/`, writes machine-readable outputs, and moves the task to `review` or `done` according to gates.

Use `orchestrator:rerun-review -- --task-id <id>` when a task is already in `review` and a new handler needs to append or refresh local evidence.

## Task File Shape

```md
---
id: DATA-001
title: Review electricity category for configured account
state: Todo
kind: category-update
category: electricity_system
priority: P1
allow_remote_commit: false
---

Task body here.
```

Account-level compute repair tasks usually use:

```md
---
id: lca-compute-task-YYYY-MM-DD-short-name
title: "Repair account process graph after LCA compute failure"
state: Ready
kind: account-repair
category: lca-compute-matrix-readiness
priority: P0
allow_remote_commit: false
account_env_target: current-credentials
source_report: inputs/diagnostics/<diagnostic-report>.md
---
```

Move these tasks to `review` after the first cycle when evidence, blockers, mutation plan, completeness snapshot, and follow-up tasks exist but dry-run or verification is still blocked.

## Capability Development Requests

Use `templates/capability-development-request.md` when a foundry task needs a missing shared capability in another workspace project.

Before creating one, classify the ownership with `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`.

Use this task type when the missing work is a reusable CLI command, a shared skill workflow, calculator/runtime behavior, database/Edge Function behavior, or TIDAS schema/tooling behavior. Keep the current foundry task in `review` when the missing capability blocks dry-run, verification, or safe remote commit.

Do not use this template for task-specific manifests, reports, file-location checks, acceptance checks, or other foundry-owned orchestration.

Task seed reports and other safe source inputs should not live in the repository root. Put them under `inputs/<kind>/`, reference them from task frontmatter, and update `docs/file-location-registry.json` in the same change.

Do not put personal account names in reusable task templates. If a human needs a visible local account hint, set `FOUNDRY_ACCOUNT_LABEL` in local `.env`; task files should normally use neutral scopes such as `current-credentials` or a dataset-specific scope id.
