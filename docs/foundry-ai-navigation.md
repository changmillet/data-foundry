---
title: Foundry AI Navigation
docType: guide
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when an AI or human maintainer needs to trace a Foundry command to implementation, artifacts, and tests
  - when deciding where new Foundry import-curation code belongs
whenToUpdate:
  - when command routing, semantic module ownership, or internal import-curation layers change
  - when adding or removing Foundry command metadata or core validation gates
checkPaths:
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
  - src/dev-cli.ts
  - src/package-entry.ts
  - src/public-api.ts
  - src/runtime-entry.ts
  - src/foundry-facade.ts
  - src/commands/**
  - src/lib/**
  - devops/**
  - specs/module-budgets.json
  - specs/import-profiles.json
  - test/README.md
lastReviewedAt: 2026-11-27
lastReviewedCommit: 921ac4898dc62873e5abf84e6435aa32ce907bff
lastReviewedNote: "Foundry #306: retired completed historical JS-to-TS wave migration scaffolding tests in favor of zero-javascript-ratchet and toolchain-contract, and added stat-guarded immutable component digest caching; navigation owners and runtime boundaries remain unchanged."
---

# Foundry AI Navigation

Consumer runtime operations route through `src/runtime-entry.ts` and `src/foundry-facade.ts` over the v2 task store, all-64 command disposition policy (`src/lib/foundry-runtime-command-policy.ts`), explicit workspace migration (`docs/workspace-migration-contract.md`), and installable package closure (`docs/package-distribution-contract.md`). Authoritative runtime contracts live in `docs/public-runtime-contract.md`, `docs/runtime-context-contract.md`, `docs/task-authorization-contract.md`, and `docs/foundry-task-contracts.md`; historical delivery narratives live in [the delivery-review archive](archive/delivery-review-history.md).

For profile/permission work, start with `docs/task-authorization-contract.md`, `src/lib/task-authorization.ts` and `import-curation/internal/profiles-config.ts`. A profile carries source rules; an immutable validated task grant carries exact action/QA exceptions. Source preparation, strict datetime/scale checks and public reference proofs remain separate from write admission. Handoff checks current rules and final rows again; a legacy ready report or serialized profile cannot approve an action.

Foundry is a thin control plane. Start from commands and artifacts, then move to the semantic owner module. Do not start from large implementation files.

For shared CLI primitives, start at `src/lib/identity-preflight-proof.ts` for public receipt parsing, `src/lib/foundry-runtime-utils.ts` for exact installed package/bin resolution, and `src/lib/batch-orchestration/` for Foundry semantic adapters around `@tiangong-lca/cli/batch`. Test receipt bytes belong only to `test/fixtures/auth-identity-receipt.ts`; installed-package public export proof is `test/unit/public-cli-batch-runtime.test.mts`. A `dist/src/**` path is a contract violation, not a navigation shortcut.

For package work, start at `docs/package-distribution-contract.md`. `src/package-entry.ts` is the public-only bin, `src/public-api.ts` is the typed host surface, `tsconfig.package.json` defines reachability, `build-foundry-package.ts` creates the sanitized stage and descriptor, and `verify-foundry-package.ts` compares that stage with the pack file set. `foundry-package-contract.ts` is the installed integrity owner; the unit package contract and `scenarios/foundry-package-consumer.test.mts` are the executable boundaries. Do not enter the internal stage graph from these files.

For exact Process validation context, start at `foundry-validation-reference-context.ts`, the registered reference input and `foundry-workflow-assessment.ts`. The projection is validation-only: complete Flow documents and current report bindings travel through preparation and finalization while business reference closure starts at the actual dataset payload. `curation-cleanup.ts` preserves the captured context through its producer-bound proof; it does not infer extra write targets from envelope metadata. The finalization Flow-evidence scenarios cover native validation and both public save-draft dry-run owners with missing, wrong-version, wrong-type, conflicting and changed evidence. Existing strict datetime behavior stays with the prewrite cleanup owner.

For generated review inputs, consume the public `quality_review_input_template` through the existing quality-review selector; do not reconstruct binding hashes or accepted decisions. For failed local CLI evidence, start at `foundry-workflow-child-failure.ts` and the original operation receipt/index. Status reads retain failures without re-dispatch; historical missing producer and mutation UNKNOWN recovery remain outside this path.

## Command paths

User workspace/task operations follow:

```text
src/dev-cli.ts
  -> src/runtime-entry.ts
  -> src/foundry-facade.ts
  -> request/task runtime owner
```

The 15 flat developer diagnostic and offline-planner commands follow:

```text
src/dev-cli.ts
  -> src/lib/foundry-cli.ts
  -> command owner module in src/commands or src/lib/import-curation
```

The 64 internal workflow stages remain indexed in `internalStageMetadata` (`src/lib/foundry-command-metadata.ts`) and governed by `src/lib/foundry-runtime-command-policy.ts`; repository build, CI, and release entrypoints live under `devops/{build,ci,release}/`.

The checked source of truth for command ownership is `src/lib/foundry-command-metadata.ts`. It maps every command returned by `node src/dev-cli.ts help` to:

- category
- owner module
- owner export
- input artifacts
- output artifacts
- key tests

`test/unit/foundry-command-metadata.test.mts` enforces that the metadata covers all registered commands, that public commands remain reachable within two jumps from `src/dev-cli.ts`, and that commit handoff metadata advertises the authoritative CommandSpec and final-row artifact evidence.

The incremental lane is owned by `src/commands/incremental-change-set.ts`, with its authoritative artifact and activation boundary in `docs/incremental-change-set-contract.md`. It composes Foundry-owned task evidence and stops before the CLI-owned mutation boundary. The related typed algorithm owners are `authoring-plan.ts` for row/task planning, `bundle-sample-rows.ts` for deterministic representative sampling, and `topology-convergence.ts` for occurrence-aware F/P/D convergence; each remains behind the same registered command and write-authority contract.

## Core Spine & Domain Leaf Navigation

- `src/lib/foundry-args.ts` and `src/lib/foundry-command-registry.ts`: positional/option/scalar parsing, the 15-command flat CLI registry, the 64-command internal stage list, and exit-code mapping (`test/unit/foundry-cli-spine.test.mts`).
- `src/lib/foundry-command-metadata.ts` and `src/lib/surface-audit.ts`: 15-command CLI metadata, 64-stage internal metadata, and inbound/orphan/category audit across `src/` and `devops/` (`test/unit/foundry-command-metadata.test.mts`, `test/unit/surface-audit-typescript.test.mts`).
- `src/lib/foundry-runtime-paths.ts` and `src/lib/foundry-runtime-environment.ts`: trusted repository/package root discovery (including cross-version `package-dist/src/package-entry.js` -> `package-dist/src/package-entry.js` runtime-adoption compatibility) and credential-free child environments.
- `src/lib/import-curation/internal/runtime-io.ts`, `prewrite-cleanup.ts`, `full-context-proof.ts`, and `profiles-config.ts`: synchronous JSON/JSONL I/O, strict timezone-qualified datetime preflight and annual-supply normalization, content-addressed context proof, and declarative profile rules.

Worldsteel's frozen adapter/profile policy is a governed cross-file contract. Start with `src/commands/worldsteel-batch-import-run.ts` for the executable batch-engine flags, then follow the `worldsteel.docs` list in `specs/import-profiles.json` for current policy, constraints, plan, and retained delivery evidence. `test/unit/worldsteel-support-mint-truth.test.mts` freezes runtime `true`, verifies that profile rules contain no inherited authorization and that current task approval is required, and requires every declared Worldsteel document to state the same truth. The hard candidate boundary is a materialized canonical-cache miss behind the profile and finalize gates; LANCA names and historical counts are evidence, not a runtime allowlist. Docpact intentionally routes wrapper/test/Worldsteel-doc changes into that evidence set but leaves the monolithic profile index under its generic trigger so a BAFU/USLCI edit does not create Worldsteel noise; the truth test supplies the reverse cross-file check.

The typed high-level orchestration path is `library-scope-workflow.ts` for profile-agnostic library/scope preparation, then `bafu-leaf-classification-tasks.ts` and `bafu-auto-authoring.ts`, then `bafu-process-scope-e2e.ts`. `src/commands/library-batch-import.ts` and `src/commands/bafu-batch-import-run.ts` are thin public facades over `src/lib/batch-orchestration/library-batch-{command-runtime,profile-strategy,runtime-helpers,paths-and-resume,stage-wiring,reporting}.ts` and the `<= 650`-line `bafu-batch-command-runtime.ts` composition root. For the generic run contract/lock use `cli-bounded-batch-runner.ts`; for Foundry scope projections, family FIFO, pause/stop, events, and readback recovery use `foundry-scope-batch-runner.ts`. Resume bugs route by evidence: source/options/stage/CLI authority to `scope-resume-contract.ts` and `scope-source-content.ts`; verified/blocked selection and repair to `scope-resume-ledger.ts` plus `scope-resume-projection.ts`; consumed mutation state to `scope-attempt-ledger.ts`; process finalize output reuse to `bafu-orchestration/process-scope-resume.ts`; and Flow carry-forward to `flow-resume-ledger.ts` plus `verified-flow-write.ts`. Retention bugs route separately: blob identity/dedupe to `control-artifact-store.ts`; receipt shape to `control-receipt-contract.ts`; original/store locator discovery to `control-reference-projection.ts`; post-prune integrity to `control-receipt-verification.ts`; scope ordering/status to `scope-control-retention.ts`; ownership/symlink deletion to `scope-safe-prune.ts`; cache eviction to `shared-context-cache-prune.ts`; and the small integration gate to `scope-scratch-policy.ts`. For authoring task filtering use `authoring-task-filter.ts`; for recovery report/blocker discovery use `scope-recovery-evidence.ts`; for commit/readback/closeout use `post-write-handoff.ts`; and for finalize/support/recovery/handoff use `scope-finalize-commit.ts`. USLCI and Worldsteel adapters import the same public facade with typed profile factories. Start at command metadata and the orchestration budget contract, then navigate to the narrowest semantic owner.

For generic `dataset-process-scope-run`, start at `library-orchestration/ready-process-scope-runner.ts` for input-order checkpoint/report semantics, `ready-scope-command.ts` for artifact-bound execution/logs, and `ready-scope-scheduler.ts` for content/policy/CLI fingerprint plus parallel/pause/stop/no-replay policy. CommandSpec behavior itself is CLI-owned: `src/lib/foundry-command-spec.ts` must remain a one-line re-export. `unit/ready-process-scope-runner.test.mts` covers real parallelism, raw/spec/artifact drift, input order and single mutation attempts; `unit/ready-scope-scheduler.test.mts` covers pause, stop and exception isolation; the library scenario proves the public command path.

For a canonical description that becomes `"[object Object]"`, disappears, or changes language/order, start at `src/lib/canonical-description.ts` and `library-orchestration/decision-apply.ts`. Follow the direct consumer chain through `batch-orchestration/identity-patch-stage.ts`, `commands/identity-decisions.ts`, `identity-reference-rewrite-utils.ts`, and `bafu-orchestration/identity-decision-carry-forward.ts`. The authoritative field remains JSON; rendered text is not a fallback. Producer bytes/SHA are pinned in `unit/library-decision-apply.test.mts`, batch resolution in `unit/batch-orchestration-identity-patch.test.mts`, end-to-end process reference transport in `scenarios/flow-identity-decisions.test.mts`, and carry-forward bytes in `unit/bafu-identity-decision-carry-forward.test.mts`.

For a post-finalize report whose command omits an option or differs from the invocation, go directly to `src/lib/bafu-orchestration/post-finalize-recovery.ts`. `runProjectedArgvStage` is the sole dispatch, authority construction, and projection verification point; `process-scope-report.ts` only retains the supplied object plus exit/log/report evidence. `unit/post-finalize-recovery-orchestration.test.mts` compares every projected command against captured invocations across identity/semantic success, nonzero, thrown, missing-report, and deliberate projector-drift cases.

For location suggestion/apply using different queues or applying after a queue replacement, start at `src/lib/batch-orchestration/location-task-queue.ts`, then its sole caller in `scope-preparation.ts`. The task queue is discovered once, and only its bound fact is re-read. `unit/batch-orchestration-scope-execution.test.mts` covers stable single lookup plus missing, byte-length, same-length SHA, and relative-path drift; the unchanged verified-resume fixture pins stable report/ledger bytes.

For BAFU flow reuse, navigate directly to `src/lib/bafu-authoring/identity-equivalence.ts`. If an exact-name candidate is reused despite property, reference-unit, geography/market, category/route, technology, or physical-meaning conflict evidence, the defect is in that leaf—not candidate search, the command envelope, or the batch composition root. `test/unit/bafu-identity-equivalence-contract.test.mts` freezes the pure decision and reason order; `test/commands/bafu-auto-authoring.test.mts` proves the resulting `create_new`/reuse decision and deterministic apply boundary.

For wrong BAFU category decision/artifact semantics, navigate to `category-map-projection.ts`; for a report that says `completed` while any manual-review JSONL is non-empty, navigate to `category-map-report.ts`. The report leaf owns closure-wide status and compact blockers; `foundry-command-registry.ts` owns its nonzero manual-review exit. `test/unit/bafu-leaf-category-map-projection.test.mts` covers unreferenced conflict/invalid/context/incomplete decisions plus resolved byte stability, and `test/commands/bafu-leaf-classification-tasks.test.mts` covers the real nonzero command/artifact boundary.

For same-id/version commit ambiguity, start at `src/lib/same-identity-commit-recovery.ts`; it is the shared structured-evidence classifier for both process and batch. Process orchestration remains in `src/lib/bafu-orchestration/process-handoff.ts`, with bounded argv helpers in `process-handoff-plan.ts` and `process-handoff-closeout.ts`. Batch discovery, verification retry, and closeout remain in `src/lib/batch-orchestration/post-write-handoff.ts`. Neither path may replay the mutation or treat display text alone as authority; follow the existing verifier for exact owner/state/id/version/payload/root proof.

The typed runtime command owners are `src/commands/cli-wrappers.ts`, `execution-capsule.ts`, and `post-write-closeout.ts`. Navigate to the wrapper for direct executable/argv delegation and process diagnostics, to the capsule for offline immutable admission and attempt-state evidence, and to closeout for already-produced commit/readback aggregation. Root uniqueness and accepted-difference decisions remain in `post-write-root-proof.ts` and `remote-verification-accepted-diff.ts`.

The typed final command owners are `src/commands/core.ts`, `identity-preflight-run.ts`, and `post-authoring-finalize.ts`. Navigate to core for local bootstrap, environment/workflow/storage/surface diagnostics and route artifacts; to identity preflight for receipt-bound CLI argv, request/target/binding hashes, positive-only cache and stdout/disk execution evidence; and to finalize for ordered rewrite, parent cleanup, nested support, validation, curation, dry-run, mutation-manifest and handoff aggregation. Finalize treats any non-completed cleanup or null cleaned artifact as `curation_cleanup_not_ready`, preserves/reports every pre-existing stale path without deleting it, appends the blocked import ledger, writes no CommandSpec, and constructs no downstream stage. Finalize utilities live at `post-authoring-finalize-utils.ts`.

The typed import-curation entry chain is `src/lib/import-curation.ts` → `import-curation/index.ts` → semantic owners. `profiles.ts` and `trace-summary.ts` are pure typed leaf barrels. Navigate through the public/index barrels to discover the complete namespace, but edit behavior only in the semantic owner named by command metadata.

The typed adapter/tooling owners are `tidas-adapter.ts` for the external Rust machine contract, `post-authoring-finalize-utils.ts` for finalize-stage path/reuse/preflight coordination, `check-tidas-cutover.ts` for authoritative cutover inventory, and `foundry-golden-diff.ts` for isolated non-HEAD normalized comparison. Golden may admit an intentional contract migration only through an exact reviewed before/after hash-and-shape pair so later drift remains visible. `foundry-golden-normalization.ts` owns those reviewed projections: the ordered command surface and its dataset-policy partition, the complete capability registry, and the surface-audit metadata category tally. Each projection is bound whole — never a filtered subset — and hashed canonically so object key order is not significant while array order still is; a projection that does not hash to exactly one of its reviewed states is compared verbatim. Tests use controlled executables and local Git/filesystem fixtures only.

The typed fixture chain starts at `test/fixtures/foundry-core.ts` and `row-builders.ts`, then branches into full-context/identity/mutation evidence and independent incremental/topology packages. Navigate to `fake-tidas.ts` only for the stable Rust operation-report/exit harness; dispatch it as `process.execPath` plus script argv. Fixture modules preserve runtime export namespaces and artifact bytes but are never semantic command owners.

All unit and scenario suites use `.test.mts`, enforced repository-wide by `zero-javascript-ratchet.test.mts` and `toolchain-contract.test.mts`; navigate from each behavior test to its existing semantic owner without treating test-side type narrowing as a new runtime abstraction.

The supported toolchain is Node.js 24, `pnpm@11.24.0`, TypeScript `7.0.2` only with erasable syntax, root-config Oxlint plus the native-suppression audit, and Prettier. Route package-manager or toolchain failures to `package.json`, `pnpm-lock.yaml`, `test/unit/toolchain-contract.test.mts`, and four-platform CI. Before merging a structural slice, verify it in a clean arbitrary Git worktree with frozen pnpm install, clean/type-error-no-emit build proof, and no dependency on sibling checkouts, external `node_modules`, credentials, or ignored `.foundry` state.

The typed handoff primitive is `src/lib/foundry-command-spec.ts`. Navigate there for exact-key parsing, canonical command hashing, critical-flag uniqueness, final-row artifact facts, or pre-spawn drift checks. Callers must never reconstruct argv from `display`.

For completed delivery packages, navigate directly from `final-delivery-promote` to `src/commands/final-delivery-promotion.ts` and `docs/final-delivery-promotion-contract.md`. This is a local gate aggregator: package-specific counts, sheets, proof columns, and reviewer coverage belong in `foundry-final-delivery-manifest.v1`, not in the command implementation.

## Import-Curation Modules

Use these semantic modules as the import-curation navigation surface:

| Module | Responsibility |
| --- | --- |
| `src/lib/import-curation/profiles.ts` | import profile listing and profile lookup |
| `src/lib/import-curation/curation-gate.ts` | curation gate report and AI authoring package creation |
| `src/lib/import-curation/authoring-packages.ts` | AI authoring task manifest/package preparation |
| `src/lib/import-curation/patch-collect.ts` | AI patch collection and patch evidence readiness |
| `src/lib/import-curation/curation-cleanup.ts` | deterministic prewrite row cleanup |
| `src/lib/import-curation/trace-summary.ts` | Foundry trace summarization |
| `src/lib/import-curation/mutation-manifest.ts` | prewrite mutation manifest and blocker aggregation |

Command runners live in the semantic modules above. The remaining reusable workflow logic is exposed through focused internal workflow facets such as `authoring-task-workflow.ts`, `authoring-patch-workflow.ts`, `curation-gate-workflow.ts`, and `mutation-manifest-workflow.ts`. New command behavior should start in the semantic owner module, with reusable helpers placed in focused internal modules.

Complex workflow commands should also publish an AI-readable `stage_pipeline` contract in their help/report payload. The shared helper is `src/lib/stage-contract.ts`; it standardizes `remote_write_mode`, `stage_pipeline[].stage`, canonical `phase`, `purpose`, `inputs`, `outputs`, `blockers`, `artifacts`, `side_effects`, and a stable `report_contract` requiring `status`, `counts`, `files`, `blockers`, and read-only `remote_write_mode`. Complex commands should expose the canonical phases `prepare`, `rewrite_cleanup`, `gate_validate`, and `report`. `test/unit/foundry-stage-contract.test.mts` currently enforces this contract for:

- `dataset-bundle-sample-rows`
- `dataset-post-authoring-finalize`
- `dataset-authoring-plan`
- `dataset-identity-preflight-run`
- `dataset-incremental-change-set-compose`

## Internal Layers

The current internal dependency direction is:

```text
semantic import-curation modules
  -> internal/*-workflow.ts
  -> internal/workflow-*.ts (acyclic; zero circular dependencies)
  -> internal/full-context-proof.ts
  -> internal/profiles-config.ts
  -> internal/trace-summary.ts
  -> internal/dataset-payload.ts
  -> internal/dataset-types.ts
  -> internal/runtime-io.ts
```

Layer rules:

- `runtime-io.ts`: generic time, array, text, JSON/JSONL, filesystem, and path helpers.
- `dataset-types.ts`: supported dataset type sets, plural names, and fallback profile constants.
- `dataset-payload.ts`: TIDAS row payload unwrap, dataset root/type detection, dataset identity, and identity map keys.
- `profiles-config.ts`: import profile loading, normalization, listing, and lookup.
- `trace-summary.ts`: Foundry trace entry collection and compact trace summaries.
- `prewrite-cleanup.ts`: strict datetime validation and atomic write-preparation transforms such as annual-supply evidence preservation and unknown-evidence normalization, import trace externalization, Foundry trace namespace repair and local locator redaction.
- `full-context-proof.ts`: full-context package/task proof loading and blocker construction.
- `authoring-task-workflow.ts`: typed facade for AI authoring package to task manifest/template preparation helpers.
- `authoring-patch-workflow.ts`: typed facade for AI patch collection, patch-set validation, and full-context readiness helpers.
- `curation-gate-workflow.ts`: typed aggregate for curation gate queue, identity-preflight, QA/schema action, and authoring context helpers.
- `mutation-manifest-workflow.ts`: typed aggregate for prewrite evidence, reference closure, dry-run proof, and write-candidate planning helpers.
- `workflow-queue-context.ts`, `workflow-identity-preflight.ts`, `workflow-identity-decision-context.ts`, `workflow-semantic-actions.ts`, `workflow-authoring-tasks.ts`, `workflow-patch-evidence.ts`, `workflow-patch-evidence-context.ts`, `workflow-patch-collect.ts`, `workflow-row-transform-context.ts`, `workflow-evidence-scope.ts`, `workflow-decision-apply-context.ts`, `workflow-decision-full-context.ts`, `workflow-dry-run-context.ts`, `workflow-source-reference-context.ts`, and `workflow-reference-closure.ts`: focused domain helpers used by the workflow facets above.

Dependencies must point strictly downward with zero circular dependencies (`allowed_cycles: []` in `specs/module-budgets.json`). Internal low-level modules must not import semantic command modules.

## Cleanup Checks

Before deleting a Foundry-local surface, prove the current replacement path and check command metadata, tests, docs, and docpact coverage. Safe deletions include old package-script aliases, empty metadata categories, and draft orchestration docs with no remaining consumer. Do not delete runtime skills, task templates, profile docs, or account-safety docs only because they are low-frequency; those may be agent entrypoints rather than code imports. Run `node src/dev-cli.ts surface-audit` to automate the local scan for hidden command aliases, empty metadata categories, unregistered orphan docs, and script modules without inbound imports.

## Behavior Freeze

The test tree is split by behavior layer:

- `test/unit/` protects pure metadata and local helper contracts.
- `test/commands/` protects single-command artifacts, reports, and stage contracts.
- `test/scenarios/` protects multi-command workflow behavior.
- `test/fixtures/` contains focused helper modules for core command runners, fixture roots, row builders, identity/finalize/full-context/mutation workflow fixtures, and similar shared setup.

Before and after structural changes, run:

```bash
pnpm golden:diff
pnpm test
pnpm test:toolchain
pnpm lint
pnpm typecheck
pnpm build
node src/dev-cli.ts doctor
git diff --check
```

Golden diff protects CLI JSON compatibility for the key command set. The full test suite protects workflow-specific artifact and proof behavior. Toolchain tests protect the pnpm/TS7 graph and migration ledger. Command metadata tests protect AI navigation.

Explicit reference selection starts at `src/lib/foundry-reference-input.ts` and the public `--reference-input` descriptor. The indexed snapshots feed `foundry-workflow-finalize.ts`; `finalize-reference-inputs.ts`, `handoff-reference-intent.ts` and `reference-intent-closeout.ts` own flat-input validation, precommit evidence transport and readback binding. The public runtime contract defines the boundary; CLI 0.1.24 owns reference eligibility and unit-aware QA.

Public goal clarification and human decisions start at `src/runtime-entry.ts` / `src/foundry-facade.ts`. `foundry-task-start-spec.ts` keeps the optional brief in the request revision. `foundry-interaction-types.ts` is the graph leaf; `foundry-interaction-input.ts` selects bounded question/answer/assumption descriptors, `foundry-interaction-scope.ts` distinguishes legacy broad and exact object keys, `foundry-interaction-projection.ts` chooses applicable decisions, and `foundry-workflow-interaction.ts` records them under the task lock and freezes new interaction after indexed authorization. `foundry-workflow-object-scope.ts` verifies unique current row identity/hash, indexed decision-bound successors and new-answer reassessment. `foundry-workflow-state.ts` and `foundry-workflow-assessment.ts` track one-set coverage and broad-context rechecks; `foundry-semantic-input.ts`, `foundry-semantic-interaction.ts` and `foundry-workflow-semantic.ts` bind exact per-item decision IDs, registered decision-task queue targets and before/after row evidence. `foundry-facade.ts` presents a question with its object identity plus live per-object context; an unrelated Process can still offer local semantic review. `foundry-workflow-authorization.ts`, `foundry-workflow-approval-continuation.ts` and `foundry-owner-execution-store.ts` recheck current interaction before write handoff. The public runtime contract owns argument/artifact shapes. Unit and dual-Process public scenarios protect scope, CAS, partial recap and no-authority behavior. Skills own wording shown to people; this owner adds no TIDAS schema, remote write or approval action.

For industrial `foundry` terminology, start at `specs/prewrite-content-policy.json` and `test/unit/foundry-industrial-terminology.test.mts`. The existing evaluator in `import-curation/internal/workflow-identity-preflight.ts` retains per-leaf findings and independent markers. The command-surface contract documents local collocations and explicit runtime/workspace precedence; do not add a whole-field or task-specific exemption.

For multilingual identity queries, use `bundle-source-context.ts` and `identity-preflight-artifacts.ts`; Flow quantitative names use `name.flowProperties`, while Process uses its own `functionalUnitFlowProperties`. The bounded query preserves language order and source rows.

For original-task continuation, navigate to `foundry-task-runtime-adoption.ts` / `foundry-task-runtime-adoption-write.ts` for qualified immutable transitions, `foundry-assessment-producer.ts` for retained locator provenance, and `foundry-workflow-identity-recovery.ts` / `identity-preflight-recovery-proof.ts` for strict retained diagnostics. Missing original authentication cannot be manufactured; see [the public contract](public-runtime-contract.md#same-task-compatibility-and-retained-identity-diagnostics).

Managed original-entry adoption starts at `foundry-managed-host.ts`, `foundry-managed-adoption.ts` and `foundry-managed-authentication.ts`. The control component reader proves exact carrier/runtime closure and brands inventory-bound Q; no CLI protocol extension or retired root controller is used. True subprocess scenarios, rather than parent-process auth mocks alone, qualify this boundary.
