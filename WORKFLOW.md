---
tracker:
  kind: filesystem
  inbox: tasks/inbox
  active: tasks/active
  done: tasks/done
workspace:
  root: .foundry/workspaces
policy:
  default_write_mode: dry-run
  require_human_for_remote_commit: true
  require_contract_context_before_ai: true
  require_schema_gate: true
  require_qa_gate: true
  require_location_code_gate: true
  require_curation_gate: true
  require_cleanup_before_remote_write: true
  require_dry_run_before_remote_write: true
  source_language_only_before_import: true
---

You are working on a TianGong LCA data import task.

Task ID: {{ issue.identifier }}
Title: {{ issue.title }}

Body:
{{ issue.description }}

## Classify

Choose one lane:

- `external-dataset-curated-import`: packaged LCA data that can be converted through `tidas-tools` or the CLI.
- `source-evidence-dataset-development`: PDF, Excel, screenshot, web page, markdown, image, or free text that must be authored into TIDAS candidate rows.

## Required Order

1. Create or reuse `.foundry/workspaces/<task-id>/`.
2. Freeze the source package or source document manifest.
3. Fetch SDK-backed contract context before AI repair or authoring:

```bash
tiangong-lca dataset context-pack \
  --type <process|flow|source|contact|lifecyclemodel> \
  --profile ai-import \
  --out-dir .foundry/workspaces/<task-id>/context/<type> \
  --json
```

4. For packaged imports, convert with `tiangong-lca dataset import-lca convert` or `tidas-tools`.
5. For source-document authoring, extract source evidence first and keep unresolved assumptions explicit.
6. Validate generated rows with `tiangong-lca dataset validate --type <type>`.
7. Run deterministic QA with `tiangong-lca qa <type>`.
8. Build the entity-level import curation queue:

```bash
npm run dataset:curation-queue:build -- \
  --processes <process-rows.jsonl> \
  --flows <flow-rows.jsonl> \
  --support <source-or-contact-rows.jsonl> \
  --external-flow-ref <external-flow-ref-rows.jsonl> \
  --out-dir .foundry/workspaces/<task-id>/curation-queue
```

The queue build is a Foundry wrapper around `tiangong-lca dataset curation-queue build`. It writes task, lock, blocker, closure, input, and run-plan artifacts; it does not run AI or write the database.

Before AI curation for process/flow imports, audit and then run the generated identity-preflight request index. The audit checks the exact `flow_hybrid_search` / `process_hybrid_search` Edge request body before any remote call: Edge only parses `query`, `filter`/`filter_condition`, match/page options, and `data_source`, so complete identity and source evidence must be present in the compact fielded `query`. Foundry may include `remote_candidate_search.profile_hints` in the request for source-derived facts such as elementary categories, flow property, reference unit, geography, reference flow names, technology, and system boundary; the CLI uses those hints only for local target profiling and candidate scoring, not as Edge Function request fields.

```bash
npm run dataset:identity-preflight-query:audit -- \
  --index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-query-audit
npm run dataset:identity-preflight:run -- \
  --index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-run \
  --only-pending
```

If a later AI patch or deterministic cleanup changes the current process/flow rows, rebuild and rerun identity preflight for the exact patched rows. Pass the original full index as `--source-index` so refreshed requests inherit the original `source_file` trace context; then merge that refreshed current-scope index back into the original full index so dependency evidence is preserved:

```bash
npm run dataset:identity-preflight-requests:build -- \
  --type process \
  --rows-file .foundry/workspaces/<task-id>/rows/processes.patched.jsonl \
  --source-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh
npm run dataset:identity-preflight-query:audit -- \
  --index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh-query-audit
npm run dataset:identity-preflight:run -- \
  --index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh-run
npm run dataset:identity-preflight-index:merge -- \
  --base-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --update-index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-index-merge
```

9. Run Foundry curation:

```bash
npm run dataset:curation-gate -- \
  --type <process|flow|lifecyclemodel> \
  --rows-file <rows.jsonl> \
  --schema-report <dataset-validate-report.json> \
  --qa-report <qa-report.json> \
  --schema-file <context/schema.json> \
  --yaml-file <context/methodology.yaml> \
  --ruleset-file <context/runtime-ruleset.json> \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --classification-queue .foundry/workspaces/<task-id>/classification-authoring-queue.jsonl \
  --location-queue .foundry/workspaces/<task-id>/location-authoring-queue.jsonl \
  --identity-preflight-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --require-identity-preflight \
  --profile <generic|bafu|custom-profile-id>
```

The classification and location queue files may be empty, but when they exist they must be passed through so taxonomy and `tidas_locations_category.json` blockers enter the AI authoring package. For process/flow imports, the identity-preflight index must also be passed through; full-context process/flow profiles automatically block AI authoring on missing or pending current/dependency identity results until the runner has produced evidence. Foundry also attaches the bundled TIDAS category schemas and location schema as full-text contract context so AI decisions can cite the taxonomy it used. Decision task build must return a ready status before AI authoring; `blocked_missing_full_context` means schema, methodology YAML, runtime ruleset, category/location schema, identity-preflight evidence, authoring package, or converted row payload context is incomplete and must be fixed first. The same full-context rule applies to non-decision authoring tasks built from curation-gate packages; a `blocked_missing_full_context` task manifest is not valid AI input.

Before choosing one of the AI authoring paths below, run `npm run dataset:authoring-plan -- --curation-gate-report <dataset-curation-gate-report.json>`. The plan is read-only: it aggregates identity/classification/location/field-patch readiness, points to missing task builds or deterministic apply commands, and prevents skipping from a blocked curation gate directly to write planning.

10. If curation is blocked on identity manual-review action items, Codex/skills should output structured identity decisions only from a ready `identity-decision-task.json`, preserve each template decision's `decision_status=completed`, `authoring_package`, `authoring_package_sha256`, `used_context_kinds`, structured `evidence`, and `closes_action_items`, then apply them through `npm run dataset:identity-decisions:apply` with the matching `--authoring-package-dir` whenever the package directory is available. `reuse_existing_reference` must include canonical id/version. Product/process rows may choose `create_new` only with full candidate evidence; elementary flow rows must choose `reuse_existing_reference` or `block_unresolved`. Do not patch row JSON directly for identity decisions.
11. If curation is blocked on classification queue rows, Codex/skills should output structured classification decisions only from a ready `classification-decision-task.json`, preserve each template decision's `decision_status=completed` and `authoring_context.context_bundle_sha256`, then apply them through `npm run dataset:classification-decisions:apply -- --decision-task <classification-decision-task.json>`. Large queues may be split with `--dataset-type`, `--bundle-id`/`--process-id`, `--limit`, `--offset`, and `--chunk-label`; use one `--shared-context-cache-dir` across chunks so repeated schema/YAML/category/location context is read from one stable bundle, and when decisions from multiple chunk tasks are applied to the source queue, pass every task with repeated `--decision-task`. Do not patch classification JSON directly when the classification decision workflow is available.
12. If curation is blocked on location queue rows, Codex/skills should output structured location decisions only from a ready `location-decision-task.json`, preserve each template decision's `decision_status=completed` and `authoring_context.context_bundle_sha256`, then apply them through `npm run dataset:location-decisions:apply -- --decision-task <location-decision-task.json>`. Large queues may be split with the same chunk flags and the same `--shared-context-cache-dir`; when decisions from multiple chunk tasks are applied to the source queue, pass every task with repeated `--decision-task`. Do not patch location fields directly when the location decision workflow is available.
13. For non-identity/non-classification/non-location curation blockers, first build explicit authoring tasks with `dataset-authoring-task-build`. Use the same `--shared-context-cache-dir` as decision tasks when rebuilding or splitting work so repeated schema/YAML/ruleset/category/location context is read from one stable bundle. The manifest must be `ready_for_ai_authoring_batch`; if it is `blocked_missing_full_context`, fix the missing schema/YAML/ruleset/category/location/source-row context before Codex/skills write patches. AI patch files must declare `patch_status=completed`; `dataset-authoring-patch-collect` rechecks full-context readiness from the manifest/tasks, verifies any referenced shared-context bundle still exists with the recorded stable `sha256`, and blocks stale, draft, incomplete, or non-completed task artifacts. Do not write the database directly from AI output.
14. Apply identity decisions, classification decisions, location decisions, patches, or build plans through deterministic CLI/SDK paths, then rerun schema, QA, queue build when references changed, and curation.
15. Run cleanup after source trace has been captured in authoring packages:

```bash
npm run dataset:curation-cleanup -- \
  --type <process|flow|lifecyclemodel> \
  --rows-file <rows.jsonl> \
  --out-file <cleaned-rows.jsonl>
```

16. Revalidate cleaned rows before dry-run/publish planning. For every final write scope, including mixed support rows and process/flow/lifecyclemodel rows, run the post-authoring finalizer so `tiangong-lca dataset classification audit --type location` checks schema-derived location-code fields against `tidas_locations_category.json`; `counts.location_audit_blockers` must be `0`.
17. The post-authoring mutation manifest must prove reference closure before commit handoff. For mutually-referencing writable support records, use a mixed `--type support` scope containing only contact/source rows, so the support closure is proven inside one exact scope and committed through `tiangong-lca dataset save-draft --type auto`. Flow Properties and Unit Groups are reference-only support choices: refresh `specs/canonical-support/flow-properties-unit-groups.json`, rewrite converted references to existing canonical database rows, and block the import if no acceptable canonical row exists. Source rows in the support scope must be true reports, publications, or traceable source records; `ILCD format`, `Not specified`, data-format, and compliance-system identities are blocked as source rows and should remain only as canonical reference rewrites/provenance. True source rows must not keep empty or type-only descriptions such as `Report`; Foundry repairs those from citation/name evidence during bundle materialization. Missing `annualSupplyOrProductionVolume` source evidence is not deferred to `common:other`; Foundry writes `9999 missing-data-sentinel/year`, an intentionally non-physical searchable sentinel that later database-side curation owns replacing. If final rows contain `common:other.tiangongfoundry:*` trace, the manifest must prove same-row AI patch evidence created or accepted that trace; identity/classification/location decisions alone cannot authorize trace入库. References outside the exact write scope must either already exist in the remote account/public library as proven by `dataset verify-remote`, or their writable rows must be written in an earlier scope and verified before the dependent process/flow/lifecyclemodel scope can proceed.
18. Remote writes require explicit task permission, dry-run evidence, location-code audit evidence, reference-closure evidence, verification evidence, and human approval.
19. When restarting an ordered import after a successful post-authoring finalize, `dataset-import-commit-run --reuse-ready-finalize-reports` may reuse the existing `flow/finalize` or `process/finalize` report for the same delayed finalize args and out-dir. Reuse is only a runtime shortcut: Foundry still requires the finalize report to be `ready_for_remote_write`, the delayed args rows-file to match the report rows-file, the mutation manifest and full-context proof to pass, and a fresh commit handoff plan before any write command is exposed.
20. After `dataset-commit-handoff-plan` has proven every final-row `common:other.tiangongfoundry:unresolvedTrace` / `sourceExchangeCompleteness` entry matches the retained trace queue JSONL, run the explicit commit command. Then run post-write remote verification and `dataset-post-write-closeout` for each committed write scope; the commit report and post-write verification report must both point to the same final rows file from handoff, profile-required full schema/YAML/context AI proof and evidence counts must still be attached, and closeout must recheck the same trace queue coverage for later database-side curation.
21. A task with committed scopes is done only after `dataset-import-completion-report` aggregates every required closeout, rechecks profile-required full-context proof for every scope, and reports `completed`.
22. Move `tasks/active/<task>.md` to `tasks/done/` only through `task-complete --completion-report <dataset-import-completion-report.json>`, so the task id, closeout scope, and profile-required full schema/YAML/context AI completion proof are checked before the file state changes.

Rows remain source-language before import. Bilingual completion is a separate post-import task only when requested.
