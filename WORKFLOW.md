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
  require_mutation_plan: true
  require_state_code_write_policy: true
  prefer_update_for_state_code_0: true
  require_insert_reason_for_versioned_write: true
  require_completeness_snapshot: true
  require_reference_flow_closure_status: true
  exclude_elementary_flows_from_provider_closure: true
  require_dry_run_before_remote_write: true
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
   - dataset-inventory
   - flow-governance
   - process-build
   - lifecyclemodel-build
   - hybrid-retrieval
   - embedding-maintenance
   - schema-repair
   - source-evidence-review
   - reference-closure
   - mutation-plan
   - publish-dry-run
   - verification
   - account-repair
   - capability-development
2. Read `AGENTS.md`, this `WORKFLOW.md`, and the relevant specification under `specs/`.
3. If the task needs LCA rules, ILCD guidance, naming conventions, or product-carbon-footprint factor database background, query the repo wiki first with `npm run wiki:fts -- "<term>"`, then read the linked Markdown pages.
4. Create or reuse the task workspace under `.foundry/workspaces/{{ issue.identifier }}`.
5. Freeze inputs before repair.
6. Treat personal account names as optional runtime display labels, not durable task scope. Read `docs/account-context-policy.md`; use `FOUNDRY_ACCOUNT_LABEL` only for human orientation and rely on credentials/session plus frozen manifests for AI execution.
7. Put every file in a governed location. Root files are only entrypoints; task seed diagnostics belong under `inputs/diagnostics/`, task records under `tasks/`, runtime outputs under `.foundry/workspaces/<task-id>/`, reusable policy under `docs/`, source knowledge under `wiki/`, and executable contracts under `specs/`. Update `docs/file-location-registry.json` whenever a file's location matters for future runs.
8. If the task needs workspace repositories, LCA skills, CLI commands, hybrid search, or schema/runtime diagnosis, read `docs/workspace-project-map.md` and `specs/workspace-capability-adapters.md`.
9. Before implementing a missing capability, classify whether it is foundry-specific or shared using `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`. Implement only foundry-owned orchestration locally; create a `capability-development` follow-up for reusable CLI, shared skill, calculator, database, Edge Function, or schema capabilities.
10. Keep audit, evidence review, repair candidates, mutation plan, dry-run, completeness snapshot, verification, and follow-up tasks separate.
11. Use the owning project surface instead of copying business logic into the foundry:
   - CLI commands through `tiangong-lca-cli`
   - reusable agent workflows through `tiangong-lca-skills`
   - hybrid search through search skills or `tiangong search ...`
   - schema validation through TIDAS SDK/tools
   - Edge Function or database diagnosis only when the failure belongs there
12. Do not perform remote database writes unless the task explicitly allows commit and all gates pass.
13. Leave machine-readable outputs, a source manifest, a completeness snapshot, and a concise report.
14. If the task uncovers missing data, ambiguous source evidence, missing CLI capability, unsafe writes, or unclear file placement, create follow-up task records instead of guessing.

Filesystem state transitions:

```text
tasks/inbox/TASK.md -> tasks/active/TASK.md -> tasks/review/TASK.md -> tasks/done/TASK.md
```

Use `tasks/review` when evidence or repair work is ready but any gate is still open. Use `tasks/done` only when schema, source/numeric, reference closure, mutation plan, dry-run, completeness, and verification gates all pass or are explicitly waived with evidence.
