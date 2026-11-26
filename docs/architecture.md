---
title: Data Foundry Architecture
docType: guide
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when deciding what belongs in Foundry versus CLI, skills, tools, SDK, database, or Edge projects
  - when reviewing public Foundry command surface or retired daemon/runtime assumptions
whenToUpdate:
  - when Foundry ownership, lane architecture, runtime model, or cross-project routing changes
checkPaths:
  - docs/architecture.md
  - AGENTS.md
  - src/**
  - devops/**
  - specs/module-budgets.json
  - docs/public-runtime-contract.md
  - docs/package-distribution-contract.md
  - docs/orchestration-module-contract.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
lastReviewedAt: 2026-11-27
lastReviewedCommit: 10feea4149832907c71166582cec23199e022427
lastReviewedNote: "Foundry #306: retired completed historical JS-to-TS wave migration scaffolding tests in favor of zero-javascript-ratchet and toolchain-contract, and introduced stat-guarded immutable component digest caching; runtime architecture, qualification, authorization and release boundaries remain unchanged."
---

# Architecture

The ordinary Foundry entry and its on-demand semantic authoring package are maintained in `tiangong-lca-skills`. This repository owns the runtime task protocol and deterministic stages; its skill inventory resolves canonical installed packages and keeps local copies untracked. The import-orchestration capability identifies Skills as the entry owner while completion/runtime capabilities retain Foundry ownership.

Managed process admission is a Foundry adapter over the public CLI host context. CLI owns IPC, component verification and leases; Foundry binds its installed package, CLI/TIDAS expectations, workspace access and target manifest before public operations. The shared runtime-cache path guard excludes workspace and migration roots from the manager cache. This adds no authentication, installer or business-write owner.

Migration transfer planning is governed by [the workspace migration contract](workspace-migration-contract.md). W10 provides explicit source/queue/input staging, current-owner task adoption, audited v2 activation and separate runtime read/write selection. Preserved history blocks replay across requests and migrations; none of these records grants business permission. Operational qualification and release integration remain tracked in #108/#980.

The v2 task store persists registered job/source/profile identity, account intent, producer receipts and artifact lineage; deterministic local retries reuse verified results. Exact C1/TIDAS qualification, all-command disposition, derived authorization and child admission form the W04 authority boundary. The W05 hierarchical facade adds strict result/task schemas, deterministic request revisions, actor-bound status/resume, local preparation and read-only migration inventory. W06 compiles that facade into the descriptor-bound `@tiangong-lca/foundry` candidate; W08 still owns F1 publication and platform components. See `docs/public-runtime-contract.md`, `docs/runtime-context-contract.md`, `docs/package-distribution-contract.md`, `docs/task-authorization-contract.md` and `docs/foundry-task-contracts.md`.

Task-local interaction is a small owner over the existing facade and artifact transaction. The optional brief stays in the immutable request revision; question, raw-answer, interpreted-decision and AI-assumption events are indexed under the task lock. Legacy task/type-wide events retain their meaning; an optional object scope identifies one current registered dataset by type, id, version and exact source-row hash. Registration and the task lock verify that proof against unique indexed rows, never a caller-provided name alone. Assessment still projects one type per resume, but its reusable type digest excludes object-only changes; status projects a fresh context for each current authoring item so another Process does not receive or wait for a Process-specific answer. Semantic apply binds exactly applicable decision IDs to each selected patch object or registered decision-task queue object and records before/after row hashes. An old row proof may follow only an indexed decision-bound successor; a new answer after prior object work still needs its own adoption, an assumption on changed bytes needs explicit re-review, and an unproven identity rewrite blocks the affected scope. The type-level write gate requires adoption of every current narrow answer at authorization, prepared-approval continuation and owner execution under current indexed evidence. Initial answers still permit local assessment before this boundary; an authorized task cannot quietly replace its interaction history. Foundry derives a readable recap source from task/completion evidence, while Skills writes the human-facing wording. These records supply context, not scientific data or remote write authority.

Native validation failure evidence is a separate assessment result, not a partially valid schema report. `foundry-native-validation-failure.ts` checks the TIDAS exit/report and bounds full diagnostics/stderr against the selected row set before the task transaction indexes them. The facade rechecks the registered result, active row manifest and file hashes, then projects an actionable blocker after restart without retrying the same operation or reaching write planning. The native path fix itself belongs to the TIDAS Toolkit; this Foundry adapter preserves the evidence and prevents the generic error from hiding it.

The explicit workspace runtime is defined by `docs/runtime-context-contract.md`: package layout comes from `package.json.foundryRuntime`, emitted execution needs no source TypeScript or Git, and selected inputs/task outputs are bound to an immutable runtime context. `src/runtime-entry.ts` now implements workspace init/migration, consumer doctor and task start/status/resume as the separate hierarchical facade. All 64 internal stage commands retain explicit public/internal/excluded, path, child, qualification and authorization dispositions; the facade reaches them only through registered task state and never falls back to the developer runner.

`createFoundryApplication` constructs the existing command factories for one explicit root and optional injected runtime utilities. Its `execute` method uses the same `createFoundryCommandDispatcher` registry as the CLI and returns a promise without the dispatcher printing or exiting the host. Construction does not load `.env` or discover operator state; independent applications retain independent root bindings. The developer `main(argv)` alone loads its environment and chooses the process adapter under `import.meta.main`. Consumer commands still require individual task/I/O admission through `runtime-entry.ts`; this internal composition API does not make every legacy owner safe for an installed consumer or authorize a write.

Import profiles distribute source rules only. Historical BAFU/USLCI/Worldsteel account overrides, QA waivers and the Worldsteel full-context relaxation grant no permission to a new task. `docs/task-authorization-contract.md` owns the separate workspace/task/actor/account/profile/input binding and exact action evidence. Local candidate preparation and checked public-reference proofs remain available; current final-row hashes, task permissions and all content/closure/no-replay gates are required before a restricted write handoff.

The public task facade delegates sealed owner execution to `foundry-workflow-execution.ts`, request/attempt state to `foundry-owner-execution-store.ts`, and independent owner verification to `foundry-owner-readback.ts`. The existing closeout factory lives under `lib/finalize-owners` with its developer-command re-export preserved. Local operation receipts capture evidence only; the CLI batch boundary owns one-shot mutation and readback recovery. `foundry-workflow-reference-verify.ts` selects canonical targets from identity rewrite evidence and verifies them through the published CLI; it never turns retained original reference rows into mutation or payload-equality requirements. See [public execution and recovery](public-runtime-contract.md#owner-execution-and-recovery).

## OAuth identity boundary

Foundry selects a private session reference and exact project/user intent, then calls the published CLI for a fresh server-verified identity receipt. It validates TTL, canonical hash, expected identity and current OAuth session metadata without owning login, password decoding, token exchange or refresh. Candidate Golden execution uses an isolated Git-visible source snapshot so ignored operator state cannot change qualification. Support-cache transport is owned by the public CLI export. Foundry validates the fresh identity, project, public-state scope, completion marker, artifact paths and hashes, then summarizes rows and atomically replaces only the requested local cache. The CLI runs in a private temporary cwd with an allowlisted OAuth environment; the operator checkout .env and unrelated secrets cannot enter that child. Exact public CLI 0.1.27 and reviewed TIDAS 0.2.x/0.3.x expectations are independently selected and re-observed through the W04 qualification boundary. F1 component provenance and package qualification remain W06/W08 gates.

## Qualified execution boundary

`foundry-runtime-command-policy.ts` explicitly classifies all 64 internal stage commands. Package assets, workspace selections, task-lineage inputs, state/artifact outputs, native/CLI child ownership and restricted authorization are separate fields. Adding a command without a disposition fails module initialization. Repository maintenance is excluded from the consumer surface; local preparation does not acquire task permission merely because it is a task stage.

`foundry-runtime-qualification.ts` binds current Foundry package identity to exact public CLI and independently selected native TIDAS bytes/protocols. `foundry-execution-admission.ts` then binds the current source lineage, derived final rows, active grant/actions/QA evidence and owner CLI CommandSpec. Rehydration in a new process reconstructs every process-local proof and checks the exact owner-draft argv shape before returning the spec. Mutation dispatch, attempt transitions and readback remain with the existing CLI/orchestration owners.

The local descriptor preparer in `foundry-task-input-preparation.ts` derives digests from indexed task state. The scientific repair path in `foundry-scientific-repair.ts` binds the field sources, reviewer and native comparison. `foundry-repair-census.ts` independently observes visible identities and dependencies for preparation and original-attempt verification. [Public repair workflow](public-runtime-contract.md#scientific-process-repair)

## Public facade composition

Preparation quality review is a Foundry-owned local policy decision over retained CLI QA evidence. `foundry-quality-review-input.ts` selects strict descriptors; `foundry-quality-review.ts` registers and rehydrates task-indexed evidence; `foundry-quality-review-lineage.ts` verifies the existing cleanup producer's exact validation-context derivation. Assessment, curation, finalization and execution admission consume the same narrow receipt. The CLI continues to own numerical QA, existing reference owners continue to own closure, and ordinary task authorization continues to own write permission. No separate task/state store or dataset writer is introduced.

`src/foundry-facade.ts` is the public orchestration composition entrypoint (`<= 500` lines), delegating support helpers, queue/scope/assessment projection, migration handlers, and explicit/automatic resume stages to `src/lib/foundry-facade/{facade-support,facade-queue-and-scope,facade-task-projection,facade-migration-handlers,facade-resume-inputs,facade-resume-stages}.ts`. `foundry-operation-result.ts` owns the strict single-result envelope and exits; `foundry-task-start-spec.ts` owns bounded user intent; `foundry-facade-store.ts` owns deterministic request/revision indexes and task pointers; `foundry-migration-inventory.ts` owns the read-only W10 input plan. The facade calls `createFoundryRuntime` for task creation, inspection, deterministic cleanup, qualified native conversion and CLI contract-context preparation. Each local stage uses the existing task transaction. It does not instantiate the legacy command graph for public requests.

`foundry-workflow-decisions.ts` prepares classification/location work through the reusable factories in `lib/decision-owners/`; the original flat command modules remain thin adapters. `foundry-decision-owners.ts` composes these factories with installed CLI schemas, canonical row helpers and isolated local CLI execution. Semantic submission dispatches the selected owner against its exact current task context, publishes successful rows and requires reassessment before another owner consumes them.

`foundry-preparation-cli-validation.ts` verifies the public CLI report transport and exact candidate/dependency bindings, then projects owner findings into existing authoring actions. `tidas-process-flow-context.ts` preserves explicit local Flow context in native batches and rejects identity/content conflicts. These adapters do not implement scientific validators; native TIDAS and the owning CLI retain their profiles.

`foundry-workflow-identity.ts` performs fresh account verification and read-only CLI preflight before locally registering captured evidence. `foundry-identity-owners.ts` composes the existing query/request/runner owners with explicit executable/environment facts; `bundle-source-context.ts` shares unchanged source-trace and name extraction. `foundry-authentication-environment.ts` supplies the narrow authentication environment used by verification and preflight. A current preflight report invalidates the earlier assessment so manual-review findings become identity tasks.

`foundry-workflow-identity-apply.ts` admits exact task/snapshot/context-bound decisions, delegates identity partitioning and dependent process-reference rewrites to existing owners, and verifies that partition contents preserve current scope. The semantic transaction activates only successful resolved output, retaining identity/rewrite report lineage. Unresolved partitions remain diagnostic with unchanged current rows.

`foundry-finalize-owners.ts` composes the existing finalize, handoff and queue factories under `lib/finalize-owners/` with explicit environments and the qualified installed CLI. Original command modules remain thin compatible adapters. `foundry-workflow-finalize.ts` follows current row-manifest ancestry, supplies current evidence and per-type contract context, isolates fresh preflight outputs, and captures owner reports after read-only work. It never dispatches a mutation. Current finalization is bound to both rows and assessment; success requests task authorization, while blockers retain concrete diagnostic reports. Owner write and readback integration remain pending.

Request and task records form a two-level index: one request retains monotonic revisions, while each revision points to one immutable v2 task. The latest identical fingerprint is reused; a changed canonical path or byte hash produces a new task with a predecessor. This preserves old attempts and avoids using user-visible filenames or current directories as identity. Status resolves through the task pointer and requires actor intent before loading task content.

Runtime selection is an injected host capability. Direct/unqualified use can initialize, diagnose, create, inspect and locally prepare tasks; child-required stages need a CLI-manager selection that W06/W08 will derive from an immutable product manifest. No environment variable or task document can choose the CLI/TIDAS trust anchor.

`foundry-authorization-input.ts` captures explicit grant/evidence selections. `foundry-workflow-authorization.ts` binds them to a current finalization scope, calls the existing fresh-identity registration/loader, rebuilds the owner handoff and seals exact final-row intent through the existing execution-admission API. It records approval metadata without executing the command. `foundry-workflow-approval-continuation.ts` re-finalizes prepared-row approval, activates the original owner’s exact derived grant or reuses a proven equal-byte descendant, and recovers interrupted sealing against the active pointer. Mutation/readback dispatch remains separate work.

## Package boundary

The repository and public package have separate composition roots. `src/dev-cli.ts` retains all developer owners. The public bin calls only `runFoundryPublicCommand`, and `src/public-api.ts` binds its own module identity before exposing the typed host facade. `tsconfig.package.json` follows those two roots to the descriptor-bound JavaScript closure plus declarations; internal command/case implementations and source maps never enter the package tree.

`build-foundry-package.ts` creates a sanitized publish stage without scripts, dev dependencies or package-manager metadata, copies only the reviewed allowlist and writes a strict file descriptor. Installed v2 package resolution checks that descriptor and the complete semantic manifest before returning a context. Exact file hashes protect code/assets; W08 provenance and component signatures protect distribution origin.

## Current Shape

Foundry is a thin local control plane. It owns task intake, profile locks, workspace ledgers, owner routing, and gate aggregation. It does not own reusable dataset execution logic.

For command ownership and navigation, use `docs/foundry-ai-navigation.md`, `docs/foundry-command-surface.md`, and the checked `src/lib/foundry-command-metadata.ts` map. Those files classify every Foundry command and link each command to its owner module, artifacts, and tests without changing the runtime `help` output.

The minimum runtime shape is:

```text
Foundry
  = task + workspace + profile + checkpoint + gate aggregator

tiangong-lca-cli
  = conversion + validation + QA + curation queue state + remote write/verify

tiangong-lca-skills
  = top-level workflows + child semantic authoring skills

tiangong-ai/skills
  = floating source-evidence and document-extraction runtime skills resolved with pnpm dlx skills

profiles
  = generic / bafu / uslci constraints
```

## Toolchain And Typed-Spine Boundary

Foundry's non-JSX Node runtime is standardized on Node.js 24, `pnpm@11.24.0`, TypeScript `7.0.2`, Oxlint, and Prettier. pnpm is the sole dependency manager and owns the only root workspace and lockfile. The compiler graph must contain TypeScript 7.0.2 only and enforce erasable-only runtime syntax; tracked `.jsx`/`.tsx`, TypeScript 5/6 aliases, `@typescript-eslint`, and formatting plugins that load the TypeScript compiler API are not compatibility paths. Git inventory is reconciled against intentional first-party Oxlint and typecheck file lists; root lint disables nested configs, bans TypeScript suppression comments, and runs a comment-aware tracked-TypeScript native-disable audit before Oxlint. Repository-local Git environment is stripped before that audit or its fixture commands target another root, keeping hook state out of the parent index. The build removes the exact stale `dist` tree before compilation, and `noEmitOnError` prevents TypeScript diagnostics from emitting replacement JavaScript; arbitrary I/O failures are outside that guarantee. Emitted and source runtimes use one trusted-root/active-entry resolver rather than deriving repository state from an output directory or CWD.

The permanent zero-JavaScript ratchet and TypeScript-only compiler, test, and lint graph define the current typed spine:

```text
entrypoint + args
  -> command registry + metadata
  -> runtime I/O + artifact/receipt contracts
  -> semantic command families
  -> scenario and real-case fixtures
```

Physical source ownership is split into `src/` (public package/runtime facade, the typed 15-command `src/dev-cli.ts` diagnostic/offline-planner CLI composition root within the default 800-line budget, and the 64 consumer-policy internal stages) and `devops/{build,ci,release}/` (package staging, CI sharding/Golden/lint gates, and four-platform release orchestration). `specs/module-budgets.json` enforces an 800-line default module ceiling across all top-level and nested files in `src/` and `devops/` (`src/*.ts`, `src/**/*.ts`, `devops/*.ts`, `devops/**/*.ts`), shrink-only debt/owner/semantic ceilings, `src/lib/` below `src/commands/`, zero circular dependencies (`allowed_cycles: []`), and zero `src/ -> devops/` imports. `test/unit/type-safety-ratchet.test.mts` enforces zero `as never` and zero `as unknown as` casts across the entire `src/**/*.ts` tree (`MAX_AS_UNKNOWN_AS_CASTS = 0`); `src/lib/ajv2020-factory.ts` centralizes Draft 2020-12 Ajv instantiation without casts, `src/lib/batch-orchestration/library-batch-{profile-strategy,runtime-helpers,paths-and-resume,stage-wiring,reporting,command-runtime}.ts` decouple generic multi-library batch execution from BAFU-specific strategies, `src/lib/source-semantics-{profile-fallbacks,reference-rewrites}.ts` separate library fallback sources and reference rewrites out of `src/lib/source-semantics.ts`, and `src/lib/cli-compatibility-capabilities.ts` centralizes retained CLI compatibility version predicates (`0.1.22`/`0.1.27`/`0.1.28` and `0.4.0`).

The shared BAFU/USLCI/Worldsteel batch path splits resume by evidence. `cli-bounded-batch-runner.ts` owns only the generic run contract/lock; `foundry-scope-batch-runner.ts` owns item projections and CLI event/recovery adaptation. `scope-resume-contract.ts` plus `scope-source-content.ts` bind source/shared bytes, options, stage/CommandSpec and CLI identity. `scope-resume-ledger.ts` plus `scope-resume-projection.ts` admit only exact verified/blocked rows and re-admit repaired contracts. `scope-attempt-ledger.ts` compacts consumed incomplete attempts, while `scope-mutation-recovery.ts` accepts only exact process closeout readback. `process-scope-resume.ts` binds finalize checkpoint and current report bytes; `flow-resume-ledger.ts` plus `verified-flow-write.ts` bind canonical Flow payload SHA. These local contracts can prevent replay or require reprocessing, but they cannot authorize a new remote mutation.

Verified-scope retention is split again by evidence meaning. `control-artifact-store.ts` owns immutable SHA-256 blobs and hardlink/copy/reuse verification; `control-receipt-contract.ts` owns the self-hashed receipt shape; `control-reference-projection.ts` separates required control locators from disposable payload locators; `control-receipt-verification.ts` rechecks every required blob after pruning; `scope-safe-prune.ts` owns symlink-free scope deletion; `scope-control-retention.ts` orders receipt → report binding → prune → verification; and `shared-context-cache-prune.ts` owns explicit recomputable-cache eviction. The store is run-level, while each scope report retains its own artifact identities, original/store locators, receipt SHA, and prune outcome. This is filesystem evidence/retention only and grants no mutation authority.

Canonical description transport is a small shared JSON boundary under that orchestration. `src/lib/canonical-description.ts` accepts scalar strings or losslessly cloneable JSON objects/arrays, preserves insertion/language/value order, and rejects unsupported values or cycles before any reference mutation. Library decision apply uses that one value for authoritative multilingual process-reference and rewrite-ledger evidence; batch identity resolution, identity apply/reference rewrite, and BAFU carry-forward preserve it without display coercion. This changes evidence fidelity only—canonical selection, payload preservation hashes outside the selected description, paths, and mutation authority stay fixed.

Post-finalize recovery command evidence has one construction boundary in `src/lib/bafu-orchestration/post-finalize-recovery.ts`. The helper derives `{ executable, argv, display }`, dispatches a fresh copy of the same executable/argv, passes that authority to the reader projection, and verifies the projected object exactly before returning. Thus success, failure, exception, and missing-report branches cannot diverge or hide options. This is local execution/report fidelity; it adds no CommandSpec mutation authority and does not change recovery semantics or stage ordering.

Location decision queue identity is a bounded artifact boundary in `src/lib/batch-orchestration/location-task-queue.ts`. Scope preparation discovers the generated queue once, stores relative path/bytes/SHA, drives suggestion from that fact, and verifies the same resolved file and relative path before apply. The drift path emits exact expected/observed facts; the stable path adds no report stage or byte change. Taxonomy choice stays with location decision tooling, while this leaf owns only local artifact continuity.

BAFU flow identity equivalence is a narrow semantic boundary inside that layer. Candidate search remains Edge/database-owned, while `src/lib/bafu-authoring/identity-equivalence.ts` deterministically reviews returned candidates. Exact normalized names can rank a candidate but cannot suppress an ordered non-equivalence reason; only a zero-conflict exact candidate can be reused. Physically conflicting exact-name candidates flow through local `create_new` evidence and deterministic identity apply without changing the source flow UUID.

BAFU category-map handling is split into two bounded leaves. `category-map-projection.ts` retains every supplied decision and manual-review artifact independent of task reachability; `category-map-report.ts` derives reader status/counts/blockers from that complete closure. Manual rows add compact source/reason/artifact blockers, produce `completed_with_manual_review`, and force a nonzero command exit; fully resolved inputs preserve the historical report bytes/status. This is local evidence control and does not move taxonomy choice or remote authority.

Process and batch commit handoffs share `src/lib/same-identity-commit-recovery.ts` as the sole same-id/version lost-success classifier. It admits only structured `23505` evidence with exact same-id/version semantics; text-only, mixed, malformed, and incomplete failures reject. `process-handoff-plan.ts` and `process-handoff-closeout.ts` keep process verification and closeout argv construction bounded, while the main process handoff preserves one mutation dispatch and carries recovery as pending until exact readback succeeds.

The batch engine delegates its asynchronous post-write closure to `src/lib/batch-orchestration/post-write-handoff.ts`. That stage discovers the exact commit and verification reports, uses the shared strict recovery classifier without replaying a mutation, retries only classified read-only verification failures, delegates ordinary trace-hash normalization policy, and invokes Foundry closeout only after exact owner/state/id/version/payload/root readback. The command owner continues to supply process isolation, timeouts, paths, and profile context.

`src/lib/batch-orchestration/scope-finalize-commit.ts` composes finalize and handoff without absorbing their owners. It holds the support-commit serialization queue and verified identity set adapter, invalidates stale support reuse, reruns finalize after support or evidence recovery, and preserves the exact three-attempt post-finalize recovery ceiling before delegating the content-bound main handoff.

Build and test resolution must be worktree-local. A clean arbitrary Git worktree must be able to run `pnpm install --frozen-lockfile`, lint, typecheck, build, toolchain tests, and the full test suite without a superproject-relative dependency, another checkout's `node_modules`, ignored `.foundry` state, or credentials.

Cross-platform characterization is also explicit: the Golden harness compares normalized outputs to a non-`HEAD` merge-base, performs recursive comparison in Node rather than calling an external Unix utility, and uses full Git history in CI. Script-backed executable overrides are represented as an executable plus argv prefix and run through Node on macOS, Linux, and Windows. The root `.gitattributes` fixes text files to LF while allowing Windows launcher exceptions, preventing checkout policy from masquerading as format drift.

The first credential-bearing entrypoint on that spine is `src/with-lca-account.ts`. It does not authenticate against Supabase itself. It resolves the exact installed CLI 0.1.27, requests `auth identity-receipt` with both expected project and user assertions, accepts only a fresh intent-bound forced signin, and then launches the requested executable plus argv with `shell:false` and a restricted environment. The CLI owns session and live identity behavior; Foundry owns the profile/thread intent checks and safe process boundary.

`src/lib/identity-preflight-proof.ts` imports the strict parser from the public `@tiangong-lca/cli/auth-identity-receipt` subpath. `test/fixtures/auth-identity-receipt.ts` is the sole test-only wire-fixture owner and produces bytes that must pass that public parser. No production module or fixture may load CLI `dist/src/**`; the installed-package contract also exercises public batch scheduling/run-lock behavior and proves the private path remains closed.

The artifact layer treats JSON paths as portable identifiers: scope extraction normalizes separators, transitional command parsers retain native backslashes, and durable writers flush a writable descriptor before close. POSIX file-mode assertions are evidence on POSIX platforms rather than a fabricated Windows contract.

The handoff execution boundary is typed and content-addressed. `src/lib/foundry-command-spec.ts` strictly parses `tiangong-foundry.command-spec.v1`, rejects duplicate safety-critical flags, and hashes `executable`, `argv`, and artifact bindings. `display` is derived but non-authoritative. Commit and verify bind the same `final_rows_artifact`; BAFU runners re-read its byte count and SHA-256 before spawning the published CLI without a shell.

## Foundry-Owned Layers

1. Task intake
   - create or classify a task
   - choose `external-dataset-curated-import` or `source-evidence-dataset-development`
   - freeze `source-manifest.json` or `seed-manifest.json`

2. Profile lock
   - resolve profile id
   - freeze constraints hash
   - record account/write policy guard

3. Workspace ledger
   - manage `.foundry/workspaces/<task-id>/`
   - maintain `foundry-job.json`, checkpoints, and `artifact-index.jsonl`
   - record runtime skill resolution when external evidence skills are used

4. Route to owner
   - call published CLI commands or top-level skills
   - do not duplicate owner behavior locally

5. Gate aggregate
   - check that schema, QA, curation, queue verify, dry-run, closeout, and readback artifacts exist
   - verify artifacts point to the same rows scope
   - accept identity/classification/location evidence across deterministic row transforms such as source/contact rewrites, canonical support rewrites, identity reference rewrites, unresolved-exchange externalization, and cleanup
   - reconcile deterministic source-only-output exchange proofs from cleanup against final-row `sourceExchangeCompleteness` traces
   - validate completed delivery packages against manifest-bound content, row algebra, workbook, redaction, and independent-review contracts, then emit an offline detached seal only when every finding is zero
   - generate completion reports

6. Whole-library scope orchestration
   - build root TIDAS unique-entity indexes for packaged imports
   - project library-level identity/classification/support decisions back to process scopes
   - resolve bundle manifest and `tidas_dir` paths relative to `process-bundles/index.json`
   - record ready scope checkpoints, blocked-scope ledgers, and reader-facing blocked-scope reports without turning blocked scopes into write candidates

7. Incremental release planning
   - compare old source semantics, new candidate semantics, and a current owner-draft snapshot under one SHA-bound request
   - enforce strict Draft 2020-12 inputs/outputs and entity/path/value/evidence-bound three-way rules, then emit minimal INSERT/UPDATE candidates, complete NOOP/HOLD evidence, stable dependency order, and one hash-chained terminal log event per schema-valid conversion
   - stop at an offline `production_authority=false` CLI candidate contract; fresh reconciliation, owner session, capsule admission, mutation, and readback remain outside Foundry

8. Topology convergence planning
   - bind a complete candidate flow/process closure to one package digest and one fresh owner/public/foreign SELECT-only census
   - classify target flows without overwriting public or foreign rows, reconstruct ordered process exchanges by process-local source number plus occurrence, and preserve only explicitly audited multilingual overlays
   - emit separate F flow-create and P process-save contracts while keeping D as zero-inbound delete candidates; protected transactions, attempt state, post-P inbound proof, and delete execution remain CLI/database responsibilities

9. Local behavior test structure
   - keep unit tests, command contract tests, multi-command scenarios, and shared fixtures in the `test/README.md` layout
   - protect Foundry orchestration and artifact contracts locally without absorbing reusable CLI, skill, SDK, database, or Edge behavior

10. Surface cleanup

- remove compatibility aliases, empty command categories, and draft orchestration references once current commands, metadata, tests, docs, and docpact show no remaining consumer
- keep historical or dataset-specific guidance only when it has an active route, profile, task, or retained reference role

## v0 Runtime

The v0 runtime is intentionally small:

- filesystem task queue
- queue/checkpoint-aware batch execution contracts, including task-scoped `max_parallelism`
- workflow/task validation script
- read-only workspace map diagnostic
- no persistent database
- no direct database commit from Foundry code; remote commit is allowed only through official CLI/platform commands when profile gates, write policy, commit handoff, and post-write verification are satisfied
- profile-authorized owner-draft support maintenance remains a CLI/database responsibility: Foundry freezes the candidate registry and complete-plan evidence, while the CLI submits one database-atomic plan and records its audit/readback proof; Foundry must not split that plan into independently committed dimension batches
- remote verification never treats a foreign or RLS-hidden `state_code=0` row as reusable evidence: `missing_dataset` remains blocking until the importing account can read an allowed public or same-owner reference. The retained normalization is limited to exact root payloads differing only in import-trace `traceHash`, and production-test accounts disable even that acceptance.
- generated support rows may get Foundry-prepared finalize and commit-handoff artifacts. They are contact/source by default; a frozen adapter/profile pair may add canonical-cache-miss Unit Group/Flow Property candidates through the explicitly enabled generic support path. Canonical rows remain public-cache reuse, candidates remain same-owner drafts, and dependent process/flow/lifecyclemodel scopes must wait for support commit and readback while independent ready scopes may continue
- the exact installed CLI dependency is the default command path: `pnpm exec tiangong-lca ...`
- test execution is local and layered: `pnpm test` runs all behavior layers, while `pnpm test:unit`, `pnpm test:commands`, and `pnpm test:scenarios` target specific Foundry-owned surfaces; `pnpm test:toolchain` protects the pnpm/TS7 graph and migration inventory

## Retired v1 Daemon Direction

Poll loops, persistent daemons, app-server integration, unbounded concurrency orchestration, retry schedulers, and reconciliation workers are not part of the current Foundry architecture. Bounded parallel batch execution is represented as task workspace policy plus CLI queue locks/checkpoints, not as a resident Foundry daemon. Broader runtime workers may be reconsidered only after the two lane workflows are stable and the owner command surfaces are complete.

Retired direction:

```text
poll tasks -> claim -> create workspace -> launch agent -> collect outputs -> update task state -> verify -> repeat
```

## Workspace-Aware Direction

The foundry should call the owning workspace surface instead of absorbing implementation:

- `tidas-tools`: unified Rust `tidas` owner for deterministic format detection, package import/conversion, schema validation, stable machine reports/exits, cancellation, and atomic publication
- `tiangong-lca-cli`: default command surface for contract context, source authoring, QA/curation, remote data operations, and handoff
- `tiangong-lca-skills`: agent-facing wrappers over CLI commands
- `tiangong-ai/skills`: runtime-only source-evidence and document extraction skills such as `document-granular-decompose` and `tiangong-kb-sci-search`, resolved through `pnpm dlx skills@latest`
- `tiangong-lca-edge-functions`: Edge Function runtime, including Hybrid Search request orchestration and `embedding_ft` jobs; Foundry forwards one `lexical_weight` and one `semantic_weight`
- `database-engine`: database RPCs, triggers, vector indexes, and schema governance
- `tidas`: TIDAS specification
- `tidas-sdk`: compatibility SDK and context APIs

See `docs/workspace-project-map.md` and `specs/workspace-capability-adapters.md` for the routing contract.

The public traceHash adapter delegates normalization to `remote-verification-accepted-diff.ts`. It supplies qualified CLI reads, retains original/accepted reports, and binds the fresh domain payload to the original remote hash. Canonical row envelopes are unwrapped only for comparison. Explicit account verification mode survives task registration and migration templates; production-test mode cannot enter the accepted-difference path.

The prepared-approval adapter can bridge cleanup byte changes for an otherwise valid support scope by using the existing registered grant derivation, then re-running the finalize owner on the bound descendant. Eligibility is limited to the support-permission blocker with complete scoped write/mint actions. It preserves completed dependency generations and stops on unchanged blocked authorization state. No profile hash check or write admission guard is relaxed.

Source CI execution is separate from the consumer runtime: complete isolated test partitions and exact version-only PR classification are owned by CI tooling. One verified package snapshot may be reused across native qualification and signing through independently supplied artifact digests and exact source/toolchain/run binding. Downloaded manifests and serialized receipts cannot issue snapshot authority. The final release always performs full four-platform qualification; consumer credentials, task state, authorization and no-replay behavior are unchanged.

## Qualified original-task continuation

Foundry owns the same-task compatibility receipt chain and retained report interpretation described in [the public runtime contract](public-runtime-contract.md#same-task-compatibility-and-retained-identity-diagnostics). It keeps historical producer locators separate from current context/assessment coverage. The narrow identity diagnostic validator admits supported manual review without making a semantic decision; CLI continues to own authentication and identity search.

Read-only reference transport supplies the existing queue/QA/CLI-validation owners, using an unchanged-payload validation wrapper. Authorization freshness is refreshed only through the explicit same-CLI host callback after locked metadata validation. These changes do not create another data writer, task ledger or scientific validator.

Managed qualification remains Foundry-owned: the existing generic CLI v1 IPC transports the independently reviewed carrier L. Foundry admits only L=S+K with identical complete executing runtime records and no executable control files; Q binds sealed complete S. Workspace/runtime identity S and launch carrier L are explicit verified roles, not interchangeable targets. No CLI protocol fork, alternate business caller or scientific writer is added.

The installed package entry selects a deployment-owned verified manifest before delegating to the public CLI runtime manager. Its read-only `runtime describe` reports selected identity, declared protocols and cache readiness. Once IPC admission begins, the managed host and exact task binding retain authority. Skills depend on the public interface rather than a release-specific bootstrap lock.
