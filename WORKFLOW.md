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

Fast-path routing runs before generic discovery:

- If the task mentions `external-dataset-curated-import`, BAFU/FOEN, or writing/updating/importing BAFU data into the BAFU account, classify it as `external-dataset-curated-import`.
- For BAFU, load `docs/import-profiles/bafu/profile.md`, `docs/import-profiles/bafu/constraints.md`, `docs/skill-orchestration/entity-level-curated-import-queue.md`, and the sibling skill `../tiangong-lca-skills/external-dataset-curated-import/SKILL.md` when available.
- If the task has structured TIDAS/ILCD rows or an existing curation queue, resume through `tiangong-lca dataset curation-queue next` before editing any row. The returned action and action manifest are the execution contract for the turn. For import/write/update requests, keep running `next` until the requested support, flow, and process scopes are complete; a single returned action is not a completed run. Same-name files without matching action lineage, or `artifact_class: recovered` files, are not formal completion artifacts.
- If the task starts from unstructured source material only, classify it as `source-evidence-dataset-development` first, produce structured draft rows with source evidence, then enter `external-dataset-curated-import`.
- If the task says to use latest local CLI changes, run `npm install` in `../tiangong-lca-cli` when dependency files changed or installed packages are stale, then run `npm run build` before invoking `bin/tiangong-lca.js`; alternatively use `node --import tsx src/main.ts ...` for source-level diagnostics.
- If the task is a follow-up after a failed BAFU import run, treat it as a closed-loop regression cycle: repair the owning CLI/SDK/tidas-tools/skill/profile defect, rebuild affected tools, create a fresh downstream run using the durable BAFU profile, and execute the queue until the first real blocker or until remote write/readback is complete. Do not reuse stale success or failure reports as the new result.
- Do not begin a known BAFU structured import by broad `rg` searches, old `.foundry` report inspection, or ad hoc command discovery. Use those only when the required fast-path files or returned CLI commands are missing or failing.
- A previous `run-status.md`, remote write report, or readback report is not proof that the current curation evidence gate passes. Current write permission must come from `tiangong-lca dataset curation-queue verify`.

1. Classify the task into one of:
   - account-governance
   - category-update
   - dataset-inventory
   - external-dataset-curated-import
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
   - source-evidence-dataset-development
2. Read `AGENTS.md`, this `WORKFLOW.md`, and the relevant specification under `specs/`. For fast-path imports, prefer the narrower profile/constraints/skill files listed above before generic specifications.
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
12. For `external-dataset-curated-import`, execute entity work through the queue:
   - `tiangong-lca dataset curation-queue next --queue-dir .foundry/workspaces/<task-id>/curation-queue --entity-type <support|flow|process> --limit 1 --out-dir .foundry/workspaces/<task-id>/execution-next`
   - run only the returned CLI command or child skill action, preserving returned action manifests and required `*.provenance.json` artifacts
   - call `curation-queue next` again after the action completes, repeating until status is `complete` for the requested support/flow/process scopes
   - before any final response or remote write, run `tiangong-lca dataset curation-queue guard --queue-dir .foundry/workspaces/<task-id>/curation-queue --out-dir .foundry/workspaces/<task-id>/prewrite-evidence-gate --json`; if it returns blocked with a runnable `next_action`, continue instead of stopping
   - run `tiangong-lca dataset curation-queue verify --queue-dir .foundry/workspaces/<task-id>/curation-queue --out-dir .foundry/workspaces/<task-id>/prewrite-evidence-gate` before any formal write
   - if `verify` is blocked while any `next` scope is still `ready`, continue the queue instead of treating the run as terminally blocked
13. Do not perform remote database writes unless the task explicitly allows commit and all gates pass.
14. Leave machine-readable outputs, a source manifest, a completeness snapshot, and a concise report.
15. If the task uncovers missing data, ambiguous source evidence, missing CLI capability, unsafe writes, or unclear file placement, create follow-up task records instead of guessing.

Filesystem state transitions:

```text
tasks/inbox/TASK.md -> tasks/active/TASK.md -> tasks/review/TASK.md -> tasks/done/TASK.md
```

Use `tasks/review` when evidence or repair work is ready but any gate is still open. Use `tasks/done` only when schema, source/numeric, reference closure, mutation plan, dry-run, completeness, and verification gates all pass or are explicitly waived with evidence.
