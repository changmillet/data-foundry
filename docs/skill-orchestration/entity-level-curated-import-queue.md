---
title: Entity-Level Curated Import Queue
docType: design
scope: skill-orchestration
status: draft
owner: tiangong-lca-data-foundry
lastReviewedAt: 2026-05-30
related:
  - docs/skill-orchestration/dataset-authoring-skill-architecture.md
  - docs/import-profiles/bafu/profile.md
  - docs/import-profiles/bafu/constraints.md
---

# Entity-Level Curated Import Queue

Structured external imports should not curate a whole package as one large batch. A package-sized batch makes source-name context inconsistent, lets process workers rewrite shared flow text, and makes a partial failure hard to resume.

The execution unit is an entity task: one support record, one flow, or one process closure. A process closure includes the process row and dependency references, but it does not own shared flow or support rows.

The successful BAFU single-process rerun for `ffdd66da-8477-38b7-9cf8-af0c7ae7bb94` is the reference shape for process execution: one isolated workspace, complete support/flow/process dependency closure, stage checkpoints, mapping, guarded write, and readback diff. Batch execution must repeat that shape per process instead of switching to warning-only field repair.

## Queue Build

After source normalization and conversion QA, build the queue with the public CLI:

```bash
tiangong-lca dataset curation-queue build \
  --processes /abs/path/rows/processes.normalized.jsonl \
  --flows /abs/path/rows/flows.normalized.jsonl \
  --external-flow-ref /abs/path/rows/public-flow-refs.jsonl \
  --support /abs/path/rows/sources.normalized.jsonl \
  --support /abs/path/rows/contacts.normalized.jsonl \
  --support /abs/path/rows/unitgroups.normalized.jsonl \
  --support /abs/path/rows/flowproperties.normalized.jsonl \
  --out-dir /abs/path/.foundry/workspaces/<task-id>/curation-queue
```

Use `--exclude-process-id` for process rows already completed in a pilot. Use `--process-limit` only for an explicit pilot run.

Use `--external-flow-ref` for referenced public/authority flows that are already finalized. These refs are allowed dependencies for process tasks but do not create local flow curation tasks.

## Artifacts

The queue directory is the durable contract:

- `outputs/curation-queue-manifest.json`: input paths, counts, hashes, blocker summary, and task-order hash.
- `outputs/curation-queue-tasks.jsonl`: task list with `entity_type`, `task_id`, `lock_key`, `depends_on`, `input_rows_file`, `work_dir`, and `checkpoint_file`.
- `outputs/curation-queue-locks.json`: lock registry used by parallel agents.
- `outputs/curation-queue-blockers.jsonl`: missing flow/support rows and other queue blockers.
- `entities/supports/<id>__<version>/input.jsonl`: support row owned by one support task.
- `entities/flows/<id>__<version>/input.jsonl`: flow row owned by one flow task.
- `entities/processes/<id>__<version>/input.jsonl`: process row owned by one process task.
- `entities/<kind>/<id>__<version>/closure.json`: dependency refs and dependency task ids for the entity.
- `entities/<kind>/<id>__<version>/entity-run-plan.json`: the mandatory per-entity stage plan and workspace layout.
- `entities/<kind>/<id>__<version>/checkpoints/`: stage checkpoints written by the runner.

Each entity work directory also reserves the same durable surfaces used by a successful single-process run: `rows/`, `references/`, `qa/`, `curation/`, `remote/`, and `reports/`.

## Process Closure Execution

A process task is not a "process JSON row only" task. It is a process closure task:

1. Read `entity-run-plan.json` and acquire the task lock.
2. Confirm support and flow dependency task checkpoints are passed.
3. Build or refresh the process-local authority catalog from finalized support rows, finalized BAFU-owned flow rows, and public/external flow refs.
4. Materialize process references from that authority catalog. Referenced flow display text is composed from finalized flow `name` subfields, not rewritten inside the process.
5. Run process required-field completion, exchange evidence repair, year and annual-supply evidence repair, source-language name normalization, schema validation, profile QA gates, and mapping/report output.
6. Run official guarded remote dry-run/commit and readback diff for this process scope.
7. Mark the entity checkpoint passed only after its stage checkpoints, mapping, remote write report, and readback report exist or have explicit profile-backed waivers.

If a process run needs a local field repair, the repair happens inside that process entity workspace and then the full entity gates are rerun. A package-wide warning batch is not a valid substitute for the process closure workflow.

## Hard Order

1. Support tasks: contacts, sources, unit groups, flow properties, data-format sources, compliance references.
2. Flow tasks: exact lookup, semantic candidate search when needed, classification, source-language name normalization, property/unit links, provenance, schema/QA gates.
3. Process tasks: finalized flow refs, exchange repair, required fields, reference year, annual supply/production, contact/source/review refs, schema/QA gates.
4. Mapping/report: merge conversion mapping, curation deltas, source-language evidence, reference rewrites, write reports, readback reports.
5. Remote write: official CLI/platform paths only.
6. Readback verify: remote rows and referenced rows must resolve and match accepted mapping differences.

## Parallel Execution

Parallelism is allowed only across independent `lock_key` values. A worker may start a task when:

- its `depends_on` task checkpoints are passed;
- no other worker holds the same `lock_key`;
- the task input hash, constraints hash, and dependency readback hash match the checkpoint or the checkpoint is absent.

For BAFU-style process batches, the practical pattern is:

- one or more agents process pending support tasks;
- several agents process flow tasks once the support catalog is available;
- up to five agents process process closures once flow/support dependencies are finalized, with one isolated `entities/processes/<id>__<version>/` workspace per process.

Each agent runs the complete child-skill workflow for its owned entity. It should not switch into a lighter "last-function-only" mode because a previous task happened to work on classification, name normalization, or reference refresh.

## Reference Text Rule

Global references are authored once and reused. A process task materializes referenced flow/contact/source/unit/flow-property display text from the authority catalog. It must not independently reconstruct `referenceToFlowDataSet/common:shortDescription` or flow names from process context.

## Resume Rule

On restart, read the manifest, task list, locks, blockers, and entity checkpoints. Resume the first pending, failed, stale, or dependency-stale task. Already passed tasks remain authoritative unless their input hash, constraints hash, or dependency readback hash changed.
