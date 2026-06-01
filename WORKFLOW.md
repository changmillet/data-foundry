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
  --type <process|flow|source|contact|unitgroup|flowproperty|lifecyclemodel> \
  --profile ai-import \
  --out-dir .foundry/workspaces/<task-id>/context/<type> \
  --json
```

4. For packaged imports, convert with `tiangong-lca dataset import-lca convert` or `tidas-tools`.
5. For source-document authoring, extract source evidence first and keep unresolved assumptions explicit.
6. Validate generated rows with `tiangong-lca dataset validate --type <type>`.
7. Run deterministic QA with `tiangong-lca qa <type>`.
8. Run Foundry curation:

```bash
npm run dataset:curation-gate -- \
  --type <process|flow|lifecyclemodel> \
  --rows-file <rows.jsonl> \
  --schema-report <dataset-validate-report.json> \
  --qa-report <qa-report.json> \
  --schema-file <context/schema.json> \
  --yaml-file <context/methodology.yaml> \
  --ruleset-file <context/runtime-ruleset.json> \
  --profile <generic|bafu|custom-profile-id>
```

9. If curation is blocked, Codex/skills should output structured patches or build plans. Do not write the database directly from AI output.
10. Apply patches through deterministic CLI/SDK paths, then rerun schema, QA, and curation.
11. Run cleanup after source trace has been captured in authoring packages:

```bash
npm run dataset:curation-cleanup -- \
  --type <process|flow|lifecyclemodel> \
  --rows-file <rows.jsonl> \
  --out-file <cleaned-rows.jsonl>
```

12. Revalidate cleaned rows before dry-run/publish planning.
13. Remote writes require explicit task permission, dry-run evidence, verification evidence, and human approval.

Rows remain source-language before import. Bilingual completion is a separate post-import task only when requested.
