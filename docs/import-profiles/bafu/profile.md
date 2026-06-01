---
title: BAFU External Dataset Import Profile
docType: import-profile
scope: bafu
status: draft
owner: tiangong-lca-data-foundry
---

# BAFU External Dataset Import Profile

This profile defines the durable orchestration contract for converting the BAFU source package into TianGong-ready ILCD/TIDAS data and writing it into the approved BAFU account. It is the Foundry-facing profile for the workflow; task-local files under `.foundry/workspaces/` are runtime artifacts, not the source of truth for the workflow.

BAFU-specific data curation rules live in `docs/import-profiles/bafu/constraints.md`. The orchestrator must lock the constraints snapshot before generating mutation plans, remote write requests, or final mapping reports.

## Execution Layers

The BAFU import must be executed through the normal Foundry stack:

```text
Foundry task / user entry
  -> Foundry task router and workspace state machine
    -> top-level external dataset curated import skill
      -> specialized skills for conversion, bilingual transcreation, flow governance, process governance, publish, and verification
        -> tiangong-lca-cli, tidas-tools, search, validation, and publish commands
```

Foundry owns task state, workspace isolation, source manifests, checkpoints, evidence, and gate reconciliation. The top-level skill owns the agent-facing workflow order and dispatches to the correct specialized skills. Shared execution primitives belong in `tiangong-lca-cli`, `tidas-tools`, and the relevant TianGong skill wrappers, not in task-specific Foundry scripts.

Historical BAFU runtime scripts under `.foundry/workspaces/` may be used as implementation evidence, but reusable execution logic must be promoted into the owning CLI or skill repository before it becomes part of a durable import workflow. The current ownership plan is recorded in `docs/skill-orchestration/dataset-authoring-skill-architecture.md`.

## Execution Entrypoint

This entrypoint is for structured entity curation. It applies after BAFU source material has been normalized into TIDAS/ILCD rows, or after another authoring workflow has produced draft structured rows. It is not a first-pass workflow for raw PDFs, reports, screenshots, web pages, free-text notes, or arbitrary spreadsheets.

For unstructured-only inputs, use an upstream source-evidence and draft-dataset authoring workflow first: extract facts, preserve citations, make source assumptions explicit, and create draft TIDAS rows. After that, build the curation queue and enter the flow below.

After the curation queue exists, every worker must ask the CLI for the next action before changing rows:

```bash
tiangong-lca dataset curation-queue next \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --entity-type <support|flow|process> \
  --limit 1 \
  --out-dir .foundry/workspaces/<task-id>/execution-next
```

The returned action is the execution contract for that turn. A worker may run the returned CLI command or invoke the returned child skill with the returned input/output artifacts, then it must call `curation-queue next` again. The returned action manifest and its hashes are part of the contract: source-name drafts, bilingual drafts, apply evidence, and validation reports must carry matching artifact lineage for the current queue task. For import, update, write, or rerun requests, this loop continues until the requested support, flow, and process scopes all return `status=complete`. Workers must not choose arbitrary process batches, select "already clean" rows, or author final names/translations/classifications through task-local scripts. Same-name files and recovered/debug backfills are not publishable completion evidence. This is the execution-time control; the prewrite evidence gate is only the final backstop.

If `curation-queue verify` is `blocked` while any `curation-queue next` scope still returns `status=ready`, the correct action is to continue the queue, not to stop the run or report a final blocker. Stop only when `next` itself is blocked, when there is no runnable next action but verify remains blocked, or when another profile gate requires human input.

Codex can still create or revise a run-level plan when the profile is new or the source is not yet structured. That plan must be persisted as profile constraints, source manifests, queue tasks, entity run plans, and checkpoints before execution starts. During entity execution, the CLI state machine provides stable order and artifact contracts; Codex provides semantic decisions only at the child-skill steps that explicitly request them.

## User Launch Contract

The user-facing trigger should be short. In Codex or Foundry, a user may write:

```text
把 BAFU 数据写入数据库
```

or:

```text
导入 BAFU 数据到 TianGong
```

Foundry/Codex should route these requests to `external-dataset-curated-import`, then resolve this BAFU profile, the BAFU constraints file, the source manifest, the BAFU account profile, and any existing checkpoints. The user should not need to paste the stage list, account guard command, source paths, or detailed constraints in the prompt when those durable files exist.

If the source manifest or account context cannot be resolved, stop and ask only for the missing item. Do not ask the user to restate the full workflow.

## Closed-Loop Regression Contract

When a BAFU import attempt exposes a reusable defect in the CLI, SDK, tidas-tools, shared skills, or this profile, the next run must be treated as a regression cycle rather than an isolated manual retry:

1. Fix the defect in the owning repository and rebuild the affected local tool before invoking it from Foundry.
2. Start a fresh downstream workspace from this BAFU profile and the current normalized/source manifest selected by the user.
3. Run `curation-queue next` through support, flow, and process scopes until the requested scope returns `complete`, or stop at the first blocker whose `next` action cannot proceed.
4. If blocked, report the exact entity task, command, input artifact, output artifact, validation report, and owning repository defect. Do not summarize a prewrite gate with remaining runnable `next` actions as the final blocker.
5. If not blocked, run prewrite verify, formal BAFU account write, and readback verify.

This lets a user start from a short instruction such as `把 BAFU 数据写入数据库`; the durable profile, constraints, account guard, queue, and checkpoints carry the detailed workflow.

## Resume Contract

The workflow is a resumable nine-stage state machine. Every stage must write a checkpoint before the next stage starts:

```text
.foundry/workspaces/<task-id>/checkpoints/<NN>-<stage-id>.json
```

Each checkpoint must include:

- `stage_id`, `stage_number`, `status`, and timestamps.
- input file paths plus content hashes or source record ids.
- output file paths plus content hashes.
- commands or skills invoked, including project root and version/commit when available.
- gate report path and pass/fail counts.
- remote-write mode, if relevant.
- residual blockers and follow-up task hints.

Allowed checkpoint statuses are `pending`, `running`, `passed`, `failed`, and `waived`. A waiver must include explicit evidence and reviewer intent. On restart, the orchestrator resumes from the first stage whose checkpoint is absent, failed, running-stale, waived-with-expired-inputs, or whose input hashes no longer match. If any upstream stage is invalidated, all downstream stages must be treated as invalid until rerun.

## Prewrite Evidence Gate

Before stage 8 may commit anything to the BAFU account, Foundry must run:

```bash
tiangong-lca dataset curation-queue verify \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --out-dir .foundry/workspaces/<task-id>/prewrite-evidence-gate
```

The gate report must be `passed` and referenced by the stage 8 checkpoint. It must check action lineage for the current queue task, not only artifact filenames. It is not enough for a runtime script to write `checkpoints/*.json` or for `dataset bilingual validate`, schema validation, name-quality validation, remote dry-run, or readback verification to pass afterward. Those gates validate rows; they do not prove that the required entity closure, name-plan authoring, and Codex bilingual transcreation steps actually happened.

If the gate is blocked, do not publish. Resume the missing support/flow/process entity tasks from their queue work directories and regenerate the affected stage checkpoints. Task-local report finalizers may summarize completed gates, but they must not synthesize passed checkpoints without the child artifacts named by the prewrite evidence gate.

## Stage Order

| No. | Stage | Purpose | Required output | Gate before next stage |
| --- | --- | --- | --- | --- |
| 1 | Source intake | Freeze source package identity. | source manifest with zip path, checksum, source URL/evidence, package version, extraction directory, and license/source notes. | checksum and extraction manifest present; source identity is unambiguous. |
| 2 | Normalize | Convert source formats into working ILCD/TIDAS artifacts. | TIDAS JSON, ILCD output, mapping CSV, conversion report, and command manifest. | `tidas-tools import-lca` completed; outputs exist; conversion report has no blocking failure. |
| 3 | Conversion QA | Check conversion quality before curation. | QA report for exchange direction, EcoSpold trace, schema validation, and mapping completeness. | exchange direction and trace are usable; schema/mapping blockers are zero or explicitly recorded for repair. |
| 4 | Support curation | Curate contact, source, compliance system, unit group, and flow property records first. | support rows, support mapping, bilingual evidence, validation report, and reuse/new-create decisions. | all required support refs resolve; TianGong public support records are reused when suitable; BAFU-specific records have evidence. |
| 5 | Flow curation | Curate all referenced flows before process curation. | flow rows with public-flow matching, classification, name split, bilingual text, property/unit refs, provenance, and validation reports. | every process-referenced flow has `curated_pass`; elementary flows use TianGong public flows unless recorded as approved BAFU private exceptions. |
| 6 | Process curation | Curate processes against finalized support and flow refs. | process rows with refreshed global refs, exchanges, reference year, annual supply/production, review/source/contact, bilingual text, provenance, and validation reports. | all process refs point to finalized support/flow rows; required fields are filled with traceable evidence; schema and semantic gates pass, except profile-declared review-code waivers recorded in the checkpoint. |
| 7 | Mapping/report | Record every material difference from source to final TianGong TIDAS payload. | final `mapping.csv`, methodology report, unresolved issue reports, and principles-new-add file if new rules were discovered. | mapping covers source ids, final ids, field-level changed values, reuse decisions, and unresolved exceptions. |
| 8 | Remote write | Commit approved rows to the formal BAFU account. | prewrite evidence gate report, `dataset publish-support` report for source/contact/unitgroup/flowproperty rows, flow/process publish/upsert/update reports, retry reports, and duration metrics. | `dataset curation-queue verify` passed for the committed scope; write uses official account-guarded CLI/platform paths only; no direct table writes; failures are isolated for targeted retry. |
| 9 | Readback verify | Verify the remote account state after commit. | remote readback snapshots, diff report against stage 7 outputs, final write status, and final verification summary. | every committed row is found remotely and matches the intended final payload or has a documented accepted difference. |

## Stage Rules

### 1. Source Intake

Record the exact source zip, checksum, source location, package title/version, and extraction directory. The source package itself remains runtime/private input unless separately approved for tracking.

### 2. Normalize

Use `tidas-tools import-lca` as the conversion entrypoint. Produce ILCD output, TIDAS JSON, mapping CSV, and a conversion report in the task workspace. The normalized output is not yet TianGong-ready data.

### 3. Conversion QA

Check conversion artifacts before any data curation. Known BAFU conversion risks include exchange direction, EcoSpold source trace retention, schema validity, and source-to-target mapping coverage.

### 4. Support Curation

Support records are upstream dependencies. Curate them before flows and processes so later global references are materialized from approved support records, not retranslated or regenerated inside each process.

### 5. Flow Curation

Flow curation must include identity matching, classification, name-part construction, bilingual transcreation, flow property/unit group selection, and provenance. Flow classification must use the TianGong/TIDAS taxonomy selected through curation; source classifications must be preserved as provenance, not copied as final target taxonomy when they are not valid TianGong classifications.

### 6. Process Curation

Process curation must consume finalized flow and support records. It must refresh global references before validation instead of failing late on stale refs. Required process fields such as reference year and annual supply/production must be filled from traceable source evidence or an explicitly documented package-level fallback rule.

Profile-specific review waivers are allowed only when named in `docs/import-profiles/bafu/constraints.md` and recorded with evidence in the stage checkpoint. For BAFU, `process_material_balance_deviation` is an account-level QA observation rather than a remote-write blocker; all other process review blockers remain blocking unless the constraints file is explicitly updated.

### 7. Mapping And Report

The final mapping must combine format conversion mapping and TianGong curation mapping. It must show where final TianGong TIDAS payloads differ from the source-derived TIDAS artifacts, including ids, versions, refs, names, classifications, bilingual text, support refs, and documented exceptions.

### 8. Remote Write

Remote writes must use the approved account context and official CLI/platform write paths. Direct table writes, RLS bypasses, or task-local database shortcuts are not allowed. `delete` is not part of the automated write workflow; rows that should be removed must be listed for human action.

### 9. Readback Verify

The workflow is not complete when the write command succeeds. It is complete only after remote readback confirms that all intended rows exist in the BAFU account and match the final curated payloads or an explicitly documented accepted difference.

## New Principle Capture

If a run discovers a new rule that should become durable policy, write it to the task workspace as `principles-new-add.md` and reference it from the stage 7 checkpoint. Do not silently fold new rules into the run without review.
