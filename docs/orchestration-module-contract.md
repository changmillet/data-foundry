---
title: Foundry Orchestration Module Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when changing library, BAFU, USLCI, or Worldsteel orchestration
  - when deciding whether logic belongs in a command owner, a Foundry semantic stage, or the CLI batch runtime
  - when adding a stage, retry, resume, artifact, or module dependency
whenToUpdate:
  - when an orchestration responsibility moves between modules or repositories
  - when module budgets, dependency direction, stage metadata, or replay contracts change
  - when the public CLI CommandSpec or batch primitive version changes
checkPaths:
  - docs/orchestration-module-contract.md
  - AGENTS.md
  - README.md
  - WORKFLOW.md
  - docs/architecture.md
  - docs/foundry-ai-navigation.md
  - docs/capability-ownership-policy.md
  - src/commands/library-scope-workflow.ts
  - src/commands/bafu-leaf-classification-tasks.ts
  - src/commands/bafu-auto-authoring.ts
  - src/commands/bafu-process-scope-e2e.ts
  - src/commands/bafu-batch-import-run.ts
  - src/commands/uslci-batch-import-run.ts
  - src/commands/worldsteel-batch-import-run.ts
  - src/commands/library-batch-import.ts
  - src/lib/bafu-authoring/**
  - src/lib/bafu-classification/**
  - src/lib/bafu-orchestration/**
  - src/lib/batch-orchestration/**
  - src/lib/library-orchestration/**
  - src/lib/foundry-command-spec.ts
  - src/lib/foundry-command-metadata.ts
  - specs/module-budgets.json
  - test/unit/*orchestration*.test.mts
  - test/unit/bafu-*-contract.test.mts
  - test/unit/library-*.test.mts
  - test/commands/bafu-*.test.mts
  - package.json
  - pnpm-lock.yaml
lastReviewedAt: 2026-11-27
lastReviewedCommit: 921ac4898dc62873e5abf84e6435aa32ce907bff
lastReviewedNote: "Reviewed final existing-output capture verification on the working delta based on baaa384e. Current writer/runtime/job/profile and source/input checks run before, between and after two fresh output reads; an independent P2 report-before-capture late-drift repro is fixed, including a caught error returning previously written JSON. New receipt publication reloads current writer/Task/runtime and preserves final input verification; ordinary bytewriters, cached replay, sorted depth-first roster, index CAS and authority/science remain unchanged. Focused59/59 and wholeadoption23/23 pass; latejob2RED->2GREEN and retainedCLI first/second/caught negatives are recorded. No cross-operation hash cache or filesystem-wide atomicity claim. baaa preparation remained unused,87bd Native19/20 failed history remains preserved; new full Source/emitted/installed/native qualification is pending. No originalDATA requery/default034/science/release change."
related:
  - https://github.com/tiangong-lca/data-foundry/issues/70
  - https://github.com/tiangong-lca/tiangong-cli/issues/232
  - https://github.com/tiangong-lca/data-foundry/issues/74
  - https://github.com/tiangong-lca/data-foundry/issues/75
  - https://github.com/tiangong-lca/data-foundry/issues/76
  - https://github.com/tiangong-lca/data-foundry/issues/77
  - specs/module-budgets.json
---

# Foundry Orchestration Module Contract

Task exception validation is owned by `src/lib/task-authorization.ts` and `docs/task-authorization-contract.md`. Library projection checks elementary, Flow Property and Unit Group actions separately, keeping FP-before-UG blocker order. Local canonical candidate preparation and public reference proof grant no write permission. Mutation manifests bind current profile rules; handoff rechecks final-row bytes, account and any used QA exception. Existing attempt/no-replay ownership and line ceilings remain unchanged.

## 1. Outcome and ownership

The high-level orchestration layer must be easy for an Agent to navigate without moving LCA semantics into generic execution code. Public command owners converge toward help, option validation, stage-contract wiring, and calls into typed semantic modules. Foundry retains profile policy, scope selection, classification and identity meaning, blocker taxonomy, artifact projection, and import-ledger interpretation. The published CLI owns reusable executable-plus-argv validation, bounded scheduling, attempt/recovery mechanics, and mutation no-replay guarantees.

Foundry consumes `@tiangong-lca/cli` CommandSpec, batch/run-lock, strict identity receipt parsing, and runtime identity strictly through the package's public `./command-spec`, `./batch`, `./auth-identity-receipt`, and `./runtime` exports; Foundry must not deep-import `dist/src/**`, expose CLI test internals, invent a compatibility wrapper, or copy the CLI scheduler/parser into semantic modules. LCA/profile semantics, Foundry reports, test-only receipt fixture bytes, and remote-write gates remain Foundry-owned adapters around those public primitives.

`cli-bounded-batch-runner.ts` is the generic executable delegation boundary: it creates the public run contract, acquires `withBatchRunLock`, and calls `runBoundedBatch`. `foundry-scope-batch-runner.ts` projects Foundry scope content/policy/executable authority, family-group exclusive keys, bounded concurrency, pause/stop, events, and readback-only mutation recovery. The callback remains Foundry-owned and returns the same scope status projection after semantic execution or explicit ambiguous/no-replay recording. The five-line command facade contains no implementation; `bafu-batch-command-runtime.ts` is the explicit composition root and contains no alternate worker counter or `Promise.all` claim loop.

## 2. Module budget and cycle ratchet

The executable ceilings are machine-owned repo-wide across `src/*.ts`, `src/**/*.ts`, `devops/*.ts`, and `devops/**/*.ts` by `specs/module-budgets.json` (`default_max_lines: 800`, `"debt_ceiling_lines": {}`, `owner_ceiling_lines`, and `semantic_module_ceiling_lines`, plus `0` `src/ -> devops/` cross-imports) and may only decrease. Every general module across `src/` and `devops/` sits within the default 800-line budget with zero remaining entries in `debt_ceiling_lines`, `src/lib/batch-orchestration/bafu-batch-command-runtime.ts` is a `<= 650`-line composition root delegating to generic `library-batch-*` strategy/helper/stage/reporting modules, and `test/unit/type-safety-ratchet.test.mts` enforces zero `as never` and zero `as unknown as` casts across the entire `src/**/*.ts` tree. A pure ordered-rule module may temporarily use the 1,200-line target only when rule precedence is one contract. Split by artifact, policy, or stage meaning rather than `part-N` filenames. See [the historical delivery archive](archive/delivery-review-history.md) for the original Issue #70 five-owner baseline (16,680 lines).

The same ratchet enforces dependency direction and zero circular dependencies (`allowed_cycles: []`). `src/lib/**` does not import command owners except the explicitly recorded dispatcher edge, and no change may reintroduce a cycle.

## 3. Semantic stage map

Navigate directly to the narrowest owner:

| Concern | Semantic owner | Command responsibility left above it |
| --- | --- | --- |
| BAFU structured name parsing and functional-unit cleanup | `src/lib/bafu-authoring/name-plan.ts` | task loading and patch/report projection |
| BAFU flow/process identity equivalence | `src/lib/bafu-authoring/identity-equivalence.ts` | decision batch I/O and command envelope |
| BAFU patch and source-trace projection | `src/lib/bafu-authoring/patch-projection.ts` | input/output files and report emission |
| BAFU process/product leaf repair | `src/lib/bafu-classification/leaf-repair.ts` | schema loading, sharding, task/report files |
| BAFU category-map closure-wide status and blocker report | `src/lib/bafu-classification/category-map-report.ts` | decision/task file I/O and artifact writes |
| Canonical description JSON validation and cloning | `src/lib/canonical-description.ts` | canonical selection, file I/O, stage orchestration, or remote authority |
| Library entity index and process-bundle scope projection | `src/lib/library-orchestration/entity-projection.ts` | directory enumeration and artifact writes |
| Ready process-scope input-order report/checkpoint projection | `src/lib/library-orchestration/ready-process-scope-runner.ts` | CommandSpec execution, generic scheduling, and CLI contract semantics |
| Artifact-bound ready-scope command execution and logs | `src/lib/library-orchestration/ready-scope-command.ts` | scope readiness, ordering, batch claims, and report aggregation |
| Ready-scope content/policy/CLI contract and scheduling adapter | `src/lib/library-orchestration/ready-scope-scheduler.ts` | LCA readiness, blockers, command results, and artifacts |
| Ready-scope filtering, classification preflight, family ordering, and preflight rows | `src/lib/batch-orchestration/scope-selection.ts` | ledger reads, profile adapters, worker execution |
| Location task-queue path/bytes/SHA binding and post-suggest verification | `src/lib/batch-orchestration/location-task-queue.ts` | task build, semantic suggestion/apply, taxonomy choice, and report aggregation |
| Universe and ledger coverage | `src/lib/batch-orchestration/universe-coverage.ts` | command help/options and report destination |
| Finalize blocker/recovery eligibility | `src/lib/bafu-orchestration/finalize-recovery-policy.ts` | subprocess, CommandSpec, retries, file reads |
| Post-finalize recovery dispatch and exact argv projection | `src/lib/bafu-orchestration/post-finalize-recovery.ts` | stage selection, report interpretation, and downstream retry policy |
| Same-id/version lost-success eligibility | `src/lib/same-identity-commit-recovery.ts` | commit dispatch, report discovery, verification, or closeout |
| Process verify and closeout argv planning | `src/lib/bafu-orchestration/process-handoff-plan.ts`, `src/lib/bafu-orchestration/process-handoff-closeout.ts` | stage execution, report parsing, retry, and semantic acceptance |
| Batch commit, post-write verify/retry, and closeout | `src/lib/batch-orchestration/post-write-handoff.ts` | stage runner, timeouts, profile/scope labels, and report aggregation |
| Per-dataset finalize, support reuse/commit, recovery, and handoff | `src/lib/batch-orchestration/scope-finalize-commit.ts` | injected finalize/identity/handoff services, paths, and profile context |
| Scope content/policy/executable resume authority and source-byte facts | `src/lib/batch-orchestration/scope-resume-contract.ts`, `scope-source-content.ts` | profile options, input discovery, and report aggregation |
| Verified/blocked contract matching and blocker re-admission | `src/lib/batch-orchestration/scope-resume-ledger.ts`, `scope-resume-projection.ts` | ledger locations and selected-scope policy |
| Durable consumed-attempt state and CLI event compaction | `src/lib/batch-orchestration/scope-attempt-ledger.ts` | command-owned files and reader counts |
| Exact flow payload carry-forward and verified-row writing | `src/lib/batch-orchestration/flow-resume-ledger.ts`, `verified-flow-write.ts` | flow finalize/commit and identity semantics |
| Process finalize checkpoint and report-byte authority | `src/lib/bafu-orchestration/process-scope-resume.ts` | process workflow options, execution, and report projection |
| Immutable control blob identity and hardlink/copy/reuse | `src/lib/batch-orchestration/control-artifact-store.ts` | scope reference choice and reader reports |
| Receipt schema, locator projection, and post-prune verification | `control-receipt-contract.ts`, `control-reference-projection.ts`, `control-receipt-verification.ts` | profile execution and payload semantics |
| Receipt-before-prune orchestration and ownership-safe deletion | `scope-control-retention.ts`, `scope-safe-prune.ts`, `scope-scratch-policy.ts` | verified-state admission and run/store locations |
| Recomputable shared-context cache eviction | `shared-context-cache-prune.ts` | cache cap and keep-scratch option |
| Authoring plan types, dependency chain, and runner (R2.2) | `src/lib/authoring-plan/{types-and-status,rows-chain,runner}.ts` | `src/commands/authoring-plan.ts` thin command wrapper |
| Representative row sampling evidence, ledger, and runner (R2.2) | `src/lib/bundle-sample-rows/{types,flow-location-evidence,process-scope-ledger,commands-and-report,runner}.ts` | `src/commands/bundle-sample-rows.ts` thin command wrapper |
| Incremental three-way merge, schema/closure, and runner (R2.2) | `src/lib/incremental-change-set/{types-and-primitives,three-way-merge,artifacts-and-schemas,dependencies-and-closure,validation-and-algebra,materialize-and-runner}.ts` | `src/commands/incremental-change-set.ts` pure re-export facade |
| Topology occurrence convergence, overlay, audit, and compose (R2.2) | `src/lib/topology-convergence/{types-and-io,exchange-and-overlay,admission-and-audit,stage-compose,runner}.ts` | `src/commands/topology-convergence.ts` pure re-export facade |
| Post-authoring finalize stage helpers, reports, and support rewrites (R2.2) | `src/lib/finalize-owners/post-authoring-{types,support-rewrites,reports,report-counts}.ts` | `src/lib/finalize-owners/post-authoring.ts` ordered prewrite orchestrator |
| Shared import-curation context types, full-context blockers, and curation/manifest report writers (R3.2) | `src/lib/import-curation/internal/{workflow-context-types,workflow-full-context-blockers,curation-gate-report,mutation-manifest-report}.ts` | `curation-gate.ts`, `mutation-manifest.ts`, and `workflow-reference-closure.ts` within the default 800-line budget with zero `as unknown as` casts |
| Repair selection, scope resolution, and preparation-report verification (R3.2) | `src/lib/foundry-workflow-repair-preparation-read.ts` | `src/lib/foundry-workflow-repair.ts` CLI/Edge/scientific repair preparation and re-exports within the default 800-line budget |
| Generic library batch profile strategy, runtime helpers, paths/resume, stage wiring, reporting, and public facade (R4.1) | `src/lib/batch-orchestration/library-batch-{profile-strategy,runtime-helpers,paths-and-resume,stage-wiring,reporting,command-runtime}.ts` | `src/lib/batch-orchestration/bafu-batch-command-runtime.ts` (`<= 650` lines) plus zero-cast typed USLCI/Worldsteel profile factories |
| Profile-specific fallback source builders and canonical/process source reference rewrites (R4.1) | `src/lib/source-semantics-{profile-fallbacks,reference-rewrites}.ts` | `src/lib/source-semantics.ts` within the default 800-line budget with zero debt ceiling |
| Import-curation decision-task proofs, row-transform readers, decision chains/identity blockers, preflight freshness/prewrite quality blockers, closeout proof builders, and import-ledger types/helpers (R4.2) | `src/lib/import-curation/internal/{full-context-decision-task-proof,workflow-row-transform-readers,workflow-decision-chain-helpers,workflow-identity-decision-full-context,workflow-identity-preflight-freshness,workflow-prewrite-quality-blockers}.ts`, `src/lib/full-context-proof-{decision,patch}-blockers.ts`, `src/lib/import-ledger-{types,helpers}.ts` | `internal/{full-context-proof,workflow-row-transform-context,workflow-decision-full-context,workflow-identity-preflight}.ts`, `src/lib/full-context-proof.ts`, and `src/lib/import-ledger.ts` within the default 800-line budget with zero debt ceilings |
| Decision-owner identity preflight helpers/index-audit, classification/location task-project helpers, decision-task types/proof readers, identity-rewrite mappings/externalization, identity-preflight search briefs, and post-write closeout helpers (R4.3) | `src/lib/decision-owners/{identity-preflight-helpers,identity-preflight-index-and-audit,classification-task-and-project,location-task-and-suggest}.ts`, `src/lib/{decision-task-types,decision-task-proof-readers,identity-reference-rewrite-mappings,identity-reference-rewrite-externalize,identity-preflight-search-brief}.ts`, `src/lib/finalize-owners/post-write-closeout-helpers.ts` | `src/lib/decision-owners/{identity-preflight,classification,location}.ts`, `src/lib/{decision-task-utils,identity-reference-rewrite-utils,identity-preflight-artifacts}.ts`, and `src/lib/finalize-owners/post-write-closeout.ts` within the default 800-line budget with zero debt ceilings |
| Final 10 debt decompositions: golden diff fixtures/helpers, production contact draft runtime/reports, capsule & delivery promotion validation, command metadata shards, runtime context fs, task adoption qualification, workflow assessment/identity-retained/semantic-scope helpers (R4.4) | `devops/ci/foundry-golden-{fixtures,diff-helpers}.ts`, `src/cases/production-contact-draft-{runtime,reports}.ts`, `src/lib/execution-capsule-{validation,checks}.ts`, `src/lib/final-delivery-validation.ts`, `src/lib/foundry-command-metadata-{core,decisions,workflows}.ts`, `src/lib/foundry-runtime-context-fs.ts`, `src/lib/foundry-task-runtime-adoption-qualification.ts`, `src/lib/foundry-workflow-assessment-queue.ts`, `src/lib/foundry-workflow-identity-stage-retained.ts`, `src/lib/foundry-workflow-semantic-scope.ts` | Zero remaining entries in `specs/module-budgets.json` `debt_ceiling_lines` (`{}`); every general module across `src/` and `devops/` stays `<= 800` lines |

Every path listed above is executable only through its reviewed code, tests, command metadata, and Docpact governance.

## 4. Execution boundary

Execution stages accept a parsed content-bound CommandSpec, never a rendered shell string. `executable` plus `argv` are authoritative; display text is diagnostic. Artifact facts are revalidated immediately before dispatch. Environment and raw child output are not durable command authority.

The CLI batch contract must provide:

- a run identity plus per-item identity, content digest, and policy digest;
- a finite concurrency ceiling and explicit claim/completion/result ordering;
- pause before claim, stop without killing in-flight work, and resource/exclusive keys;
- monotonic attempt events durably observed before an unsafe dispatch;
- read-only retry classification with injected delay, and mutation no-auto-retry;
- explicit idempotency/readback recovery for an ambiguous mutation;
- exact resume matching and rejection of incomplete or drifting authority;
- source bundle/shared context bytes, profile options, stage policy, CommandSpec projection, and exact installed CLI package in the current authority;
- one compact active state per consumed incomplete mutation attempt, with no replay until exact readback recovery succeeds;
- canonical payload SHA matching before a verified Flow row can be carried forward;
- an exclusive run-root lock before multiple processes can share output/ledger state.

Foundry injects profile and report projection. The generic engine must not know BAFU, USLCI, Worldsteel, dataset blocker codes, or Foundry filenames.

## 5. TDD, equivalence, and evidence invariants

Every extraction or behavior change begins with a failing focused contract that imports the intended semantic owner. Preserve regexes, precedence, option defaults, stage order, object insertion order, stdout, exit status, report paths, hashes, retry classification, and write authority unless a reviewed contract change explicitly migrates them.

Core invariants pinned by the current unit, command, and scenario suites:

- **CommandSpec & batch scheduling**: `foundry-command-spec.ts` re-exports the public CLI contract (`executable` + `argv` authoritative; raw arrays, malformed specs, and pre-spawn artifact drift rejected); bounded concurrency, exclusive process/family keys, pause-before-claim, stop closure, input-ordered checkpoints/reports, and one-attempt mutation failure are owned by `@tiangong-lca/cli/batch`.
- **Content-bound resume & outage recovery**: scope resume rows bind bundle/shared bytes, options, stage/CommandSpec policy, and exact installed CLI identity; legacy/drifting rows invalidate; consumed incomplete mutations compact to one row and resolve strictly through readback; process checkpoints bind report bytes; Flow reuse requires matching canonical payload SHA.
- **Control-artifact retention**: verified-scope pruning deduplicates control bytes into an immutable SHA-256 store (hardlink or verified copy fallback), writes a self-hashed receipt separating artifact identity from original/store locators, records fact-only dispositions for pruned payloads, fails closed on missing controls, drift, path escape, or symlinks, and retains scratch on failed/ambiguous scopes.
- **Semantic fidelity & fail-closed guards**: exact flow names remain subordinate to ordered physical non-equivalence reasons (`identity-equivalence.ts`); multilingual canonical descriptions clone losslessly as JSON (`canonical-description.ts`); category-map manual-review rows block closure regardless of task reachability (`category-map-report.ts`); post-finalize recovery projects exact executed `{ executable, argv, display }` (`post-finalize-recovery.ts`); location queue path/bytes/SHA is bound once before suggest/apply (`location-task-queue.ts`); and `23505` same-id/version lost-success recovery requires structured evidence plus exact owner/state/id/version/payload/root readback with zero mutation replay (`same-identity-commit-recovery.ts`).

For the historical real-run audit observations (252 GiB state / 1,358 USLCI scopes / 34 Worldsteel pilots) and per-issue #70–#83 extraction logs, see [the historical delivery archive](archive/delivery-review-history.md).

Required evidence grows with the boundary:

- pure rule: realistic cases plus exact `JSON.stringify` bytes/key order/SHA;
- artifact projection: old/new fixture files byte-identical;
- selection/resume: BAFU plus real-shaped USLCI and Worldsteel preflight/replay cases;
- execution migration: CommandSpec drift, pause/stop, ordering, ambiguity, recovery, and run-lock cases;
- repository delivery: lint, TS7 typecheck, full tests, Golden diff, surface audit, build, audit, and Docpact.

Production-account cases remain outside ordinary tests. They may use only the designated account's authorized isolated drafts, with public reads allowed and foreign/public/shared mutation plus review/publish prohibited. LangGraph remains entirely excluded.

Current source pins published `@tiangong-lca/cli` through the same reviewed public exports (`./command-spec`, `./batch`, `./auth-identity-receipt`, `./runtime`). The package-owned managed host consumes a verified non-executing L=S+K carrier and calls the existing native qualification constructor; it does not create a second runtime scheduler or business control plane. True CLI subprocess tests cover the consumer call site, with explicitly synthetic owned auth/search transport used only where separate child processes cannot inherit test mocks.
