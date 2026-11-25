---
title: Foundry Command Surface
docType: guide
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when deciding whether a Foundry command is public, workflow-internal, or a CLI wrapper
  - when navigating from a command name to its implementation, artifacts, and tests
whenToUpdate:
  - when adding, removing, renaming, or reclassifying a Foundry command
  - when moving command owner modules or changing command artifact contracts
checkPaths:
  - docs/foundry-command-surface.md
  - src/dev-cli.ts
  - src/package-entry.ts
  - src/public-api.ts
  - src/lib/foundry-args.ts
  - src/lib/foundry-cli.ts
  - src/lib/foundry-command-registry.ts
  - src/lib/foundry-command-metadata.ts
  - src/lib/foundry-runtime-command-policy.ts
  - src/lib/surface-audit.ts
  - src/commands/**
  - test/unit/foundry-command-metadata.test.mts
  - test/unit/surface-audit-typescript.test.mts
lastReviewedAt: 2026-11-25
lastReviewedCommit: a191bd3dbe633e60ef40ab5fb6fc5e00c015fd02
lastReviewedNote: "Foundry #306: retired completed historical JS-to-TS wave migration scaffolding tests in favor of zero-javascript-ratchet and toolchain-contract; command registry, consumer runtime disposition and public facade contracts remain unchanged."
---

# Foundry Command Surface

The internal `createFoundryApplication`/`createFoundryCommandDispatcher` APIs share the existing owner registry with the developer CLI. Programmatic dispatch returns results and rejects unknown or inherited object-property names; only the CLI adapter prints the result and applies process exit semantics. Consumer admission remains the explicit workspace runtime's responsibility. No new operator command or permission is introduced by exposing this composition boundary.

`src/lib/foundry-runtime-command-policy.ts` is the exhaustive consumer-runtime disposition table for the same 64 internal stage commands. Its `init` and `doctor` rows are the direct adapters available when W04 froze the table; developer maintenance, internal task control, native stages and task stages retain their asset/input/output, child, qualification and authorization fields. A registry command without an explicit classification fails initialization.

The user surface is a separate six-operation list in `foundry-operation-result.ts`: `workspace.init`, `doctor`, `task.start`, `task.status`, `task.resume` and `workspace.migrate`. The facade composes registered task/runtime owners and does not add these hierarchical names to the 15-command developer help output. `runtime.describe().command_policy` reports both lists explicitly. Unknown hierarchical operations still return the public envelope; unknown flat developer commands preserve their prior stderr/exit contract.

Foundry CLI-spine and command governance has these checked contracts:

- `src/lib/foundry-args.ts` is the typed positional/option/scalar parsing contract.
- `src/lib/foundry-command-registry.ts` is the typed runtime command list, help JSON, and exit-code policy.
- `src/lib/foundry-command-metadata.ts` is the typed AI-readable navigation and ownership map.
- `src/lib/surface-audit.ts` checks hidden handlers, category coverage, orphan docs, declared entrypoints, and script-only inbound imports with portable report paths. Entrypoints come from the fixed repository set, package script targets and `tsconfig.package.json.files`; arbitrary unreferenced modules still fail.

The metadata module must cover every command returned by `node src/dev-cli.ts help`. It records each command category, owner module, owner export, input artifacts, output artifacts, workflow entry audit state, and key behavior checks.

`src/dev-cli.ts` exposes 15 flat developer commands: 9 read-only diagnostics (`doctor`, `env-check`, `workflow-check`, `storage-check`, `surface-audit`, `workspace-map`, `capabilities-list`, `profiles-list`, `tidas-handshake`) and 6 offline/batch planners (`execution-capsule-admit`, `dataset-incremental-change-set-compose`, `dataset-topology-convergence-compose`, `final-delivery-promote`, `dataset-import-ledger-report`, and `library-batch-import --profile <bafu|uslci|worldsteel>`), alongside hierarchical `workspace`/`task` facade routing. The 64 consumer-policy stage commands remain available in-process via `createFoundryApplication` / `runFoundryStageCli` and are tracked in `internalStageMetadata`.

## Categories

- `public`: stable read-only operator diagnostics, capability/profile inspection, and native `tidas-handshake`.
- `workflow-internal`: offline admission/promotion/composition/ledger planners and the unified profile-selected `library-batch-import` command (`cli-wrapper` and `workflow-internal` stage owners remain recorded in `internalStageMetadata`).

Every command must have `workflowEntry.status: "active"` and at least one key behavior check, so unused surface area cannot hide as an unreviewed command. `surface-audit` is the read-only guard for hidden command aliases, empty metadata categories, unregistered orphan docs, and script modules with no inbound imports; `doctor` and `acceptance-check` include it.

`tidas-handshake`, `dataset-tidas-import`, and `dataset-tidas-validate` are the active deterministic TIDAS boundary. The handshake accepts compatible 0.2.x or 0.3.x binaries that advertise `tidas.operation-report.v1`; the import and validation adapters preserve Rust operation status, completeness, exit class/code, diagnostics, artifacts, next actions, cancellation, and atomic-output semantics. Foundry only maps official batch-validation results into its existing validation report and valid/invalid row files. It does not load a Python source tree, install a Python package, or infer a Python checkout/version.

`execution-capsule-admit` is a `workflow-internal` offline evidence gate. Its contract lives in `docs/execution-capsule-contract.md`; it may snapshot, validate, report, and seal local evidence, but it cannot execute the consumer or grant production authority.

`final-delivery-promote` is a `workflow-internal` offline delivery gate. Its contract lives in `docs/final-delivery-promotion-contract.md`; it validates manifest-bound artifacts, row algebra, workbook layout, redaction, and independent-review coverage, then emits a detached seal only on an all-PASS result. It cannot mutate delivery inputs, dispatch remote work, or grant production authority, and its seal is not an execution-authorization capsule.

`dataset-incremental-change-set-compose` is a `workflow-internal` offline planner. Its contract lives in `docs/incremental-change-set-contract.md`; it strictly validates old/candidate/current plus owner-receipt evidence, applies only entity/path/value/evidence-bound merge rules, isolates absent/held dependency closures, and emits one hash-chained terminal log event per schema-valid conversion plus a non-empty CLI-compatible candidate contract when actions exist. It has no network, database, CLI, or DML dispatch and never grants production authority.

`dataset-topology-convergence-compose` is a `workflow-internal` offline F/P/D planner. Its contract lives in `docs/topology-convergence-contract.md`; it validates a fresh census and exact candidate closure, reconstructs exchanges by source number plus occurrence, preserves approved multilingual nodes, emits separate flow-create/process-save contracts, and leaves obsolete flows behind a later all-visible zero-inbound delete barrier. It has no network, database, CLI, or DML dispatch and never grants production authority.

`dataset-commit-handoff-plan` emits authoritative `tiangong-foundry.command-spec.v1` objects for commit and post-write verify. Each spec carries a strict executable/argv contract, reader-only display, SHA-256, and the exact final-row artifact fact. Batch runners reject malformed specs, duplicate critical flags, or artifact drift before spawning without a shell. Its optional `--execution-contract-file` selects the qualified CLI native draft contract — insert or a bounded save_draft repair — for finalized Flow, Process or Source owner drafts. Both specs bind that exact file alongside final rows; handoff uses `dataset save-draft --execution-contract` and a fresh output directory. Unsupported, repeated or empty execution-contract options fail before artifact reads. Native closeout requires matching v2 action/operation/attempt evidence, including strict recovered-exact-readback rows; see the [public selection and recovery contract](public-runtime-contract.md#authorization-input) for task use.

## Navigation Contract

Every command must be reachable through this path:

```text
src/dev-cli.ts
  -> src/lib/foundry-cli.ts
  -> owner module in src/commands or src/lib/import-curation
```

Public command owner paths must be at most two jumps from `src/dev-cli.ts`. For semantic import-curation commands, prefer owner modules such as `profiles.ts`, `curation-gate.ts`, `authoring-packages.ts`, `patch-collect.ts`, `curation-cleanup.ts`, `trace-summary.ts`, and `mutation-manifest.ts` over mechanical part names. Reusable import-curation logic is exposed through focused TypeScript workflow facets under `src/lib/import-curation/internal/*-workflow.ts`.

## Maintenance Rule

When a command is added, removed, renamed, moved, or reclassified, update both:

1. `src/lib/foundry-command-registry.ts`
2. `src/lib/foundry-command-metadata.ts`

Then run:

```bash
pnpm exec node --test test/unit/foundry-command-metadata.test.mts
pnpm surface:audit
pnpm test:commands
pnpm golden:diff
pnpm test:toolchain
pnpm lint
pnpm typecheck
pnpm build
```

New command tests belong in `test/commands/` when they exercise one command's report or artifact contract. Multi-command workflow coverage belongs in `test/scenarios/`, and shared setup belongs in `test/fixtures/`. The same gates must pass after a frozen install in a clean arbitrary worktree, without another checkout's dependencies or ignored runtime artifacts.

`dataset-post-authoring-finalize` accepts explicit repeated `--qa-reference-rows` files for Process QA and `--reference-intent-file` only with remote verification selected. Invalid/missing selections fail before output creation. The latter is preserved through passing precommit evidence into handoff; a handoff flag can only assert the same selection. Both CommandSpecs bind intent/precommit/review facts, and post-write closeout rejects mismatched reference evidence even with exact root readback. Public tasks use the bounded `--reference-input` descriptor described in `public-runtime-contract.md`.

## Industrial foundry terminology

The prewrite policy treats local industrial collocations as scientific text: a metal, alloy or casting term immediately before `foundry`, or `foundry` immediately before an alloy, casting, mould/mold, sand, works, goods or industry term. Matching is case-insensitive and accepts whitespace and Unicode dash separators. The explicit `Foundry runtime` and `Foundry workspace` collocations (including plurals and dash, underscore or colon separators) take precedence even after an industrial prefix.

This classifies individual occurrences; it does not exempt a whole description or another workflow marker in the same field. Flow, Process and Lifecycle Model multilingual leaves retain the existing `workflow_state_text_in_write_payload` code, marker ID and exact JSON-pointer path. The policy never rewrites scientific wording, numbers or provenance to make a gate pass. The owning pattern remains in `specs/prewrite-content-policy.json`, with evaluator regressions in `test/unit/foundry-industrial-terminology.test.mts`.
