---
tracker:
  kind: filesystem
  inbox: tasks/inbox
  active: tasks/active
  review: tasks/review
  done: tasks/done
  active_states:
    - Todo
    - Ready
    - In Progress
    - Rework
  terminal_states:
    - Done
    - Cancelled
    - Duplicate
workspace:
  root: .foundry/workspaces
  hooks:
    after_create: |
      echo "workspace created: $FOUNDRY_WORKSPACE"
    before_run: |
      npm run doctor
agent:
  max_concurrent_agents: 3
  max_turns: 20
  max_retry_backoff_ms: 300000
codex:
  command: codex app-server
  thread_sandbox: workspace-write
policy:
  default_write_mode: dry-run
  require_human_for_remote_commit: true
  require_evidence_for_numeric_repair: true
  require_version_bump_plan: true
---

You are working on a TianGong LCA data task.

Task ID: {{ issue.identifier }}
Title: {{ issue.title }}

Body:
{{ issue.description }}

Operate as a data foundry worker:

1. Classify the task into one of:
   - account-governance
   - category-update
   - schema-repair
   - source-evidence-review
   - reference-closure
   - version-bump-plan
   - publish-dry-run
   - verification
2. Read `AGENTS.md`, this `WORKFLOW.md`, and the relevant specification under `specs/`.
3. Create or reuse the task workspace under `.foundry/workspaces/{{ issue.identifier }}`.
4. Freeze inputs before repair.
5. Keep audit, repair candidates, dry-run, and commit steps separate.
6. Do not perform remote database writes unless the task explicitly allows commit and all gates pass.
7. Leave machine-readable outputs and a concise report.
8. If the task uncovers missing data, ambiguous source evidence, or unsafe writes, create follow-up task records instead of guessing.

Filesystem state transitions:

```text
tasks/inbox/TASK.md -> tasks/active/TASK.md -> tasks/review/TASK.md -> tasks/done/TASK.md
```

Use `tasks/review` when evidence or repair work is ready but any gate is still open. Use `tasks/done` only when schema, source/numeric, reference closure, version plan, and dry-run/verification gates all pass or are explicitly waived with evidence.
