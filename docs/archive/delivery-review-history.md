---
title: Foundry Delivery And Review History Archive
docType: reference
scope: repo
status: historical
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when looking up historical Issue/PR/Wave rationale, baseline metrics, or prior CI timing-refresh provenance migrated out of active contracts
whenToUpdate:
  - when archiving completed historical delivery narratives or superseded baseline measurements from active contracts
checkPaths:
  - docs/archive/delivery-review-history.md
lastReviewedAt: 2026-11-27
lastReviewedCommit: 921ac4898dc62873e5abf84e6435aa32ce907bff
lastReviewedNote: "R4.5: created historical delivery-review archive and migrated historical Issue/PR/Wave narratives and superseded baseline logs out of active state-of-the-world contracts."
related:
  - AGENTS.md
  - README.md
  - WORKFLOW.md
  - docs/architecture.md
  - docs/orchestration-module-contract.md
  - docs/foundry-ai-navigation.md
  - docs/package-distribution-contract.md
  - test/README.md
---

# Foundry Delivery And Review History Archive

> This document is **historical reference material (`status: historical`, `authoritative: false`)**. Current executable contracts, module budgets, commands, and navigation live in the active documents: `AGENTS.md`, `README.md`, `WORKFLOW.md`, `docs/architecture.md`, `docs/orchestration-module-contract.md`, `docs/foundry-ai-navigation.md`, `docs/package-distribution-contract.md`, `docs/public-runtime-contract.md`, and `test/README.md`.

## 1. Orchestration Decomposition Baseline And Real-Run Evidence (Issues #70–#83)

### Initial five-owner baseline (Issue #70)

Issue #70 started from five high-level orchestration owners totaling 16,680 lines:

| Command owner                       | Initial lines |                     Target |
| ----------------------------------- | ------------: | -------------------------: |
| `library-scope-workflow.ts`         |         2,810 |                     <= 500 |
| `bafu-leaf-classification-tasks.ts` |         2,343 |                     <= 500 |
| `bafu-auto-authoring.ts`            |         3,028 |                     <= 500 |
| `bafu-process-scope-e2e.ts`         |         2,204 |                     <= 500 |
| `bafu-batch-import-run.ts`          |         6,295 | <= 500 after CLI migration |

During Issue #70, `src/commands/bafu-batch-import-run.ts` was reduced to a 5-line facade over a 1,649–1,700-line `bafu-batch-command-runtime.ts` composition root, and CLI batch/receipt subpaths (`@tiangong-lca/cli/batch`, `@tiangong-lca/cli/auth-identity-receipt`) were first adopted on CLI 0.1.3 while removing 367 lines of duplicated local CommandSpec code.

### Historical ignored-runtime audit observations

An audit of local ignored runtime state (excluding credentials, receipt bodies, and data payloads) recorded approximately 252 GiB of historical state, including ~173 GiB of Worldsteel batch/pilot copies. One USLCI run produced 10,830 checkpoints across 1,358 scopes over six resume rounds (up to 50 snapshots per scope); of 75,400 historical artifact locators, 326 survived scratch cleanup. Identity preflight consumed ~39.4 cumulative hours, and one outage produced 129 retryable finalize timeouts that later cleared. These counts shaped the sanitized fixtures for 1,358-scope outage transitions and 34 Worldsteel pilot + 6×1,358 USLCI control-blob deduplication.

### Historical Issue #74–#83 milestones

- **Issue #74**: Replaced raw-argv / fake-parallel execution in `dataset-process-scope-run` with artifact-bound `tiangong-foundry.command-spec.v1` and locked `@tiangong-lca/cli/batch` execution.
- **Issue #75**: Bound batch/process/flow resume authority to exact source/shared bytes, options, stage/CommandSpec policy, CLI package identity, and compact single-row incomplete-mutation state.
- **Issue #76**: Added SHA-256 immutable control-artifact retention, self-hashed receipts, hardlink/copy fallback, post-prune verification, and symlink-safe scratch pruning before verified-scope cleanup.
- **Issue #77**: Closed exact-name product-flow reuse bypass in `identity-equivalence.ts` so physical non-equivalence conflicts cannot be overridden by exact normalized name matches.
- **Issue #78**: Replaced lossy object coercion with lossless JSON cloning in `canonical-description.ts` across library decision apply, identity apply, reference rewrites, and BAFU carry-forward.
- **Issue #79**: Added closure-wide manual-review reporting (`category-map-report.ts`) returning `completed_with_manual_review` and nonzero exit whenever any emitted manual-review artifact is non-empty.
- **Issue #80**: Unified post-finalize recovery command dispatch and projection in `runProjectedArgvStage` (`post-finalize-recovery.ts`) so reported `{ executable, argv, display }` always matches exact execution.
- **Issue #81**: Shared structured `23505` same-id/version lost-success recovery classification (`same-identity-commit-recovery.ts`) across process and batch handoffs with readback-only resolution and zero replay.
- **Issue #82**: Toolchain-only package-manager compatibility alignment across `package.json`, `pnpm-lock.yaml`, and four-platform CI.
- **Issue #83**: Eliminated location-queue TOCTOU by binding `{ path, bytes, sha256 }` once in `location-task-queue.ts` and verifying before apply.

## 2. Historical Wave Rollout And CLI/Package Adoption Notes (W03–W10, Foundry #206–#298)

### Phased W03–W10 rollout summary

- **W03**: Task authorization (`docs/task-authorization-contract.md`, `src/lib/task-authorization.ts`) separated immutable task grants from declarative import profiles.
- **W04**: Explicit workspace runtime context, all-64 internal stage command disposition (`foundry-runtime-command-policy.ts`), exact CLI/TIDAS qualification, and derived execution admission.
- **W05**: Hierarchical public facade (`src/runtime-entry.ts`, `src/foundry-facade.ts`), deterministic request/revision store, strict operation envelopes, and read-only migration inventory.
- **W06**: Source-free installable `@tiangong-lca/foundry` npm candidate (`package-dist/`, `package-stage/`, `foundry-package-descriptor.json`) and installed-consumer qualification suite.
- **W08**: Four-platform release preparation, component aggregation, bootstrap lock, provenance signing, and Trusted Publishing workflow.
- **W10**: Explicit workspace migration transfer planning, staging, current-owner task adoption, v2 activation, and separate runtime read/write selection.

### Historical CLI adoption & release provenance notes

- **Foundry #215**: Adopted CLI `0.1.23` in source while retaining package version `0.1.13` (published `0.1.13` bundled CLI `0.1.22`); `#210` added terminal decision-recap test characterization.
- **CLI 0.1.27 source adoption**: Kept Foundry package version at `0.1.15` while published `0.1.15` retained CLI `0.1.24`, requiring a separate version-only release and four-platform publication before deployment adoption.
- **Current source baseline**: Pins `@tiangong-lca/cli@0.4.0` in `package.json` and `specs/release/runtime-inputs.json`, with retained compatibility predicates centralized in `src/lib/cli-compatibility-capabilities.ts` (`0.1.22`/`0.1.27`/`0.1.28` and `0.4.0`).

### Historical CI Windows/macOS shard-timing refresh provenance

- **Foundry #206**: Refreshed heavy Windows scenario weights from run `36003098891` (plus original run `34520209609` job `103015642293` and repair-successor run `35993959632`) across 368 test files.
- **Foundry #223**: Split preparation regressions into 10 registered-source cases and 14 installed managed cases locked by `unit/foundry-preparation-layout.test.mts`.
- **Foundry #252**: Retained 371 Windows timings from run `38849795312` and refreshed 379 file timings from run `38855272872` (414 measured files total, including the 1,167.642s quality-review suite and 5 unmeasured local helper/lint suites).
- **Foundry #260**: Refreshed 414 unchanged-source Windows timings from run `39011872241` attempts 1–2 and moved Windows CI to 10 shards under the `estimatedWallSeconds * 1.2 + 90 < 2400` planning allowance.
- **Foundry #296**: Added optional diagnostic-only `host_observation` (`tiangong-foundry.ci-test-host.v1`) on hosted Windows shard receipts.
- **Foundry #298**: Added exclusive Windows retained-suite scheduling backed by 441 whole-file observations from run `44603639659` (`ab115d56455377cd211b20653d47b0c8b09f3d5d`) in `specs/ci/windows-test-observations.json`, plus macOS 8-shard / Windows 10-shard splits informed by runs `43840188788`, `43858349736`, and `43852924546`.

## 3. Systematic Refactoring Convergence (R0–R4)

- **R0 + R1**: Established the repo-wide 800-line default budget in `specs/module-budgets.json`, split repository build/CI/release tooling into `devops/{build,ci,release}/` (`0` `src/ -> devops/` imports), and converged the developer CLI (`src/dev-cli.ts`) to 15 flat diagnostic/offline-planner commands plus hierarchical `workspace`/`task` routing while keeping all 64 internal workflow stages intact in `src/lib/foundry-runtime-command-policy.ts`.
- **R2**: Eliminated the 3-module `import-curation/internal` authoring SCC (`allowed_cycles: []`), decomposed `src/foundry-facade.ts` (`<= 500` LOC) and the five >1,200-line command/finalize owners (`authoring-plan`, `bundle-sample-rows`, `incremental-change-set`, `topology-convergence`, `post-authoring`).
- **R3**: Retired 41 completed historical JS-to-TS migration scaffolding tests, added stat-guarded immutable digest caching and fast local test scripts (`test:fast`, `test:smoke:public`), introduced `test/unit/type-safety-ratchet.test.mts`, `src/lib/ajv2020-factory.ts`, and `src/lib/cli-compatibility-capabilities.ts`, and eliminated `as unknown as` casts across boundary owners.
- **R4**: Reduced `as never` and `as unknown as` casts to `0` across all `src/**/*.ts`, decomposed `bafu-batch-command-runtime.ts` (`1,702 -> <= 650` LOC) into generic `library-batch-*` strategy/helper/stage/reporting modules, decomposed all remaining debt-ceiling files (`24 -> 0`, `"debt_ceiling_lines": {}`), archived historical narratives here, and replaced blanket `src/**` Docpact triggers with domain-scoped rules.
