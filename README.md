---
title: TianGong LCA Data Foundry
docType: guide
scope: repo
status: active
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when checking Foundry lanes, public commands, runtime skill usage, or repository shape
  - when looking for user-facing examples for route-task, profiles, and owner-routed CLI work
whenToUpdate:
  - when Foundry public commands, lane names, runtime skill policy, or repository layout change
checkPaths:
  - README.md
  - package.json
  - pnpm-workspace.yaml
  - tsconfig*.json
  - src/dev-cli.ts
  - src/package-entry.ts
  - src/public-api.ts
  - src/runtime-entry.ts
  - src/commands/**
  - src/lib/import-curation.ts
  - devops/**
  - docs/architecture.md
  - docs/public-runtime-contract.md
  - docs/package-distribution-contract.md
  - specs/import-profiles.json
  - test/unit/zero-javascript-ratchet.test.mts
lastReviewedAt: 2026-11-27
lastReviewedCommit: 4ac3ee89f1180a3c2374ff1dab1fa09a02d136ea
lastReviewedNote: "Foundry #306: retired completed historical JS-to-TS wave migration scaffolding tests in favor of zero-javascript-ratchet and toolchain-contract, added fast local unit/command and public smoke scripts, and introduced stat-guarded immutable component digest caching; public runtime, qualification, authorization and release boundaries remain unchanged."
---

# TianGong LCA Data Foundry

The ordinary user entry is the independently installed [TianGong Foundry skill](https://github.com/tiangong-lca/agent-skills/tree/main/foundry-tidas-import). It uses the environment-selected managed runtime for a separate user workspace; deployment owns the verified release selection. The internal authoring role is maintained in the same Skills repository and loads for current semantic work items. This source checkout retains the developer commands and runtime owners described below; it carries no second maintained copy of either skill.

The public task protocol can retain a short goal and scope, register evidence-bound questions and raw answers, and distinguish task-wide, dataset-type-wide and exact registered-object choices. An object choice carries a versioned identity and current row hash; independent Process work can continue while another Process awaits an answer. Semantic results record only applicable decision IDs and their indexed before/after row hashes, while a concise recap points back to full evidence. The entry skill explains human decisions in plain language and accepts natural answers; Foundry presents the question, impact and next step before the exact record locator while preserving full evidence in indexed artifacts. The CLI keeps scientific validation and write permission separate. A source checkout implementing this protocol does not itself update the independently qualified installed runtime selection.

Use `task prepare-input` to bind an interaction or semantic submission to current task evidence. An existing owner draft can enter the scientific repair workflow with a reviewed before/candidate pair, field-level sources and a Worker provider-impact report. The [public task contract](docs/public-runtime-contract.md) describes the required files and recovery behavior.

The explicit consumer workspace runtime (`src/runtime-entry.ts`, `src/foundry-facade.ts`) exposes the hierarchical `workspace` and `task` operations over a v2 persisted task store, descriptor-bound installable package closure (`@tiangong-lca/foundry`), CLI-managed IPC admission, and explicit workspace migration transfer/adoption. All 64 internal stage commands retain explicit public/internal/excluded, path, child, qualification, and authorization dispositions; import profiles distribute source rules only and grant no write permission on their own. Authoritative specifications live in [the public runtime contract](docs/public-runtime-contract.md), [the runtime context contract](docs/runtime-context-contract.md), [the package distribution contract](docs/package-distribution-contract.md), [the task authorization contract](docs/task-authorization-contract.md), [the workspace migration contract](docs/workspace-migration-contract.md), and [the task contracts](docs/foundry-task-contracts.md).

The source checkout can exercise the future package facade now:

```sh
node src/dev-cli.ts workspace init --workspace /absolute/project --json
node src/dev-cli.ts doctor --workspace /absolute/project --json
node src/dev-cli.ts task start --workspace /absolute/project --spec /absolute/task.json --json
node src/dev-cli.ts task status --workspace /absolute/project --task <task-id> --actor <actor-id> --json
node src/dev-cli.ts task resume --workspace /absolute/project --task <task-id> --actor <actor-id> --json
node src/dev-cli.ts workspace migrate --workspace /absolute/project --dry-run --json
```

Each command emits one compact machine object. Use only structured next-action argv with its recorded CWD. Task start is local and does not log in. `pnpm package:build && pnpm package:check` qualifies the W06 candidate, and `pnpm package:pack` creates the local tarball from its sanitized staging tree. The candidate is not the public F1 release until W08.

Control plane for turning external source material into validated, import-ready TIDAS data.

Foundry is intentionally thin. It owns task routing, local workspaces, import profiles, curation packages, cleanup reports, stable owner-command adapters, and policy checks. Deterministic package import/conversion/schema validation belongs to unified Rust `tidas`; contract context, QA, curation, skills, and database behavior belongs in `tiangong-lca-cli`, `tidas-sdk`, `tiangong-lca-skills`, Edge Functions, or database projects.

Identity-preflight candidate requests use the current Hybrid Search contract: one `lexical_weight` for the database `extracted_md` branch and one `semantic_weight` for `embedding_ft`.

Remote verification is visibility-bound. A `missing_dataset` reference that is foreign or hidden by RLS remains a blocker and cannot be converted to passed from a trusted-key list or another account's observation. The only retained accepted-difference mechanism is exact root readback whose sole normalized difference is `tiangongfoundry:importTraceSummary.traceHash`; production-test account cases accept no difference at all.

The packaged task facade now continues sealed approvals through registered owner execution and independent readback. It uses the published CLI batch engine, persists a consumed marker before dispatch, and resumes uncertain attempts only through the original readback request. Indexed execution evidence is verified against producer receipts and current file hashes. Reference-only tasks independently verify the semantic decisions’ canonical targets before completion, with zero writes. See [public execution and recovery](docs/public-runtime-contract.md#owner-execution-and-recovery).

## OAuth account execution

Use the exact installed CLI's `auth login` to create a private OAuth session. An ignored account profile binds `TIANGONG_LCA_SESSION_FILE` (absolute private file), `FOUNDRY_EXPECTED_PROJECT_REF`, and `FOUNDRY_EXPECTED_USER_ID`. The wrapper executes only after a fresh server-verified, intent-bound identity receipt passes TTL, hash, account and OAuth-session checks:

```sh
pnpm account:run -- <profile> -- <trusted-executable> [args...]
```

Public project/client settings may be blank for the official Production profile; the CLI owns defaults. Custom projects need the complete public OAuth configuration. Do not copy username/password, legacy API keys or session contents into account profiles. Existing task authorization, thread guards and sealed attempts remain separate gates. `dataset-support-cache-refresh` delegates to the published CLI support export with the account intent. It accepts public state 100 only, preserves existing mappings and replaces the local cache only after validating complete export evidence. Use the qualified CLI release before running this path.

## Toolchain And Typed Spine

Foundry is a pnpm-only, non-JSX Node.js 24 project. The reproducible toolchain is `pnpm@11.24.0`, TypeScript `7.0.2` as the only compiler anywhere in the dependency graph, Oxlint for linting, and Prettier for formatting; tracked `.jsx`/`.tsx` are rejected. TypeScript enforces erasable-only runtime syntax; root lint ignores nested Oxlint configs, bans TypeScript error-suppression comments, runs a comment-aware tracked-source audit that rejects native disable directives without treating strings as directives, and reconciles every Git-enumerated `.ts`/`.mts`/`.cts` file against intentional first-party includes. The audit clears inherited repository-local Git bindings before inspecting its target, preventing pre-push hook state from redirecting temporary fixtures into the parent index. Builds use the Node-native safe cleaner to remove stale `dist` output before `tsc`; `noEmitOnError` guarantees that TypeScript diagnostics emit no replacement JavaScript, without claiming arbitrary I/O failure atomicity. Source and built commands resolve one trusted repository root and their active `.ts`/`.js` entry independently of CWD. The repository keeps one root `pnpm-workspace.yaml` and `pnpm-lock.yaml`; npm/Yarn lockfiles, TypeScript 5/6 aliases, `@typescript-eslint`, and TypeScript-compiler-backed formatting plugins are outside the supported graph.

The permanent `test/unit/zero-javascript-ratchet.test.mts` requires zero tracked first-party JavaScript and a TypeScript-only compiler, lint, and test graph, `test/unit/type-safety-ratchet.test.mts` enforces zero `as never` and zero `as unknown as` casts across `src/**/*.ts`, and `specs/module-budgets.json` enforces an 800-line default module ceiling (`"debt_ceiling_lines": {}`), zero circular dependencies (`allowed_cycles: []`), and zero `src/ -> devops/` imports.

High-level orchestration and batch execution are decomposed by semantic stage under `src/lib/{batch-orchestration,library-orchestration,bafu-orchestration,bafu-authoring,bafu-classification}/`: generic multi-library execution delegates through `library-batch-*` modules and `cli-bounded-batch-runner.ts` over published `@tiangong-lca/cli` subpaths (`./command-spec`, `./batch`, `./auth-identity-receipt`, `./runtime`), with content-bound resume/attempt ledgers, immutable SHA-256 control-artifact retention before scratch pruning, lossless JSON canonical descriptions, physical-first flow equivalence, closure-wide category-map reporting, captured post-finalize recovery projections, readback-only `23505` lost-success recovery, and content-bound location queue verification. See [the orchestration module contract](docs/orchestration-module-contract.md) for current module ownership and [the historical delivery archive](docs/archive/delivery-review-history.md) for Issue #70–#83 and W03–W10 delivery history.

Every toolchain or migration change must also pass from a clean arbitrary Git worktree: install with `pnpm install --frozen-lockfile`, then run the canonical lint, typecheck, build, toolchain, and test gates without borrowing sibling checkouts, another worktree's `node_modules`, ignored `.foundry` artifacts, or credentials.

The Golden gate checks normalized command artifacts against a non-`HEAD` merge-base (normally `origin/main`) with a Node-native recursive comparator, so committed PR changes cannot degrade into a self-comparison and Windows runners do not depend on a Unix `diff` binary. Both sides receive the same explicit allowlisted environment and isolated HOME/temp/npm/git/corepack state; ambient credentials, `NODE_OPTIONS`, and the live checkout's `.env` cannot affect only the current side. Script-backed test executables such as fake TIDAS run through `process.execPath` on every platform, and `.gitattributes` keeps repository text at LF so Prettier observes the same bytes on every checkout. An intentional outward contract migration may normalize only an exact reviewed before/after hash-and-shape pair; a third value or crossed pair must continue to fail Golden.

Artifact paths recorded by fixtures must accept both platform separators. Durable JSON writers fsync the same writable descriptor they opened; POSIX permission-bit assertions apply only where the operating system implements those bits.

Remote handoff commands are machine contracts, not shell snippets. `dataset-commit-handoff-plan` emits `tiangong-foundry.command-spec.v1` objects whose `executable` and `argv` are authoritative. `display` is derived for readers and is excluded from the command hash. Both commit and post-write verify specs bind the exact final rows path, bytes, and SHA-256; batch runners verify the binding immediately before `shell=false` execution.

CI uses fail-closed tiered PR lanes (`docs-only`, `pr-fast` across 8 parallel `linux-x64` shards covering the full test inventory, `version-only`, and `full` four-platform qualification on release/CI/packaging/managed-runtime paths or the `ci:full` label), while final releases always run the complete four-platform gate (`max-parallel: 26`, per-platform test concurrency, verified package reuse, native assembly, aggregation, copied bootstrap, and signed capsules). Local `pnpm prepush:gate` runs the fast pre-push gate (`test:fast` + lint/toolchain/golden/surface/build/package/audit), with `pnpm prepush:gate:full` and `pnpm test` retaining the complete local scenario suite. Details are in `docs/package-distribution-contract.md`.

## Production Case TDD

Production-backed development is an explicit case lane, not an ordinary test or CI secret path. The guarded contact case performs offline TIDAS validation and save-draft dry-run before reading credentials, then runs two fresh intent-bound CLI identity receipts, one bounded public `state_code=100` flow read, one bounded current-owner `state_code=0` process read, one new contact root collision probe, exactly one owner-draft contact mutation, and one unique owner/state/payload readback. A transport-ambiguous mutation is never retried automatically.

```bash
pnpm case:production:contact-draft -- \
  --env-file <ignored-foundry-.env> \
  --expected-project-ref <project-ref> \
  --expected-user-id <user-id> \
  --out-dir .foundry/cases/<new-case-id>
```

The runner accepts no API key or alternate CLI path on argv. It reads only `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`, and `TIANGONG_LCA_TEST_API_KEY`; the test key exists only in the child environment. The env file must be a regular non-symlink file with POSIX mode `0600` or stricter and, when it is inside this repository, must be git-ignored. The new output directory must also be inside this repository, git-ignored, and reached without a symlinked parent.

This production lane is POSIX-only. Windows execution fails closed until the runner can verify a user-exclusive ACL; Windows CI covers that refusal rather than a live case. On POSIX, the runner snapshots the exact installed CLI 0.1.28 package inside its pnpm dependency island, hashes and rechecks the full pnpm installation plus Foundry source/build/lock facts before every child boundary, executes from a clean directory with `shell=false`, fsyncs create-only private evidence, and publishes a content-addressed case manifest only after the runtime snapshot is removed. Any detected secret in stdout, a report, or a sidecar artifact fails the case and leaves only redacted failure evidence. The created contact remains isolated, unreviewed, and unpublished under the authenticated test account for later case evidence; the lane never performs review/publish transitions or mutates foreign/public/shared rows.

Credential-scoped commands use `pnpm account:run -- <profile> -- <executable> [args...]`. The ignored profile supplies both the expected Supabase project ref and canonical user UUID. The wrapper resolves the pinned installed `@tiangong-lca/cli`, obtains a fresh intent-bound `auth identity-receipt`, and executes the requested argv without a shell and without inheriting unrelated parent environment variables. Production modules consume CLI primitives exclusively through the published `./command-spec`, `./batch`, `./auth-identity-receipt`, and `./runtime` subpaths; the toolchain ratchet rejects every `@tiangong-lca/cli/dist/src/**` import. Authentication bypass flags are unsupported.

## Import Lanes

- `external-dataset-curated-import`: packaged LCA datasets converted through the Foundry adapter over Rust `tidas import`, with default per-process dependency bundles under `process-bundles/`, then validated by Rust tidas, QA checked, curated, cleaned, dry-run, committed, and verified through queue/checkpoint-driven scopes.
- `source-evidence-dataset-development`: PDF, Excel, web exports, images, markdown, or free text extracted through CLI/skills, authored into candidate TIDAS rows with source evidence, then sent through the same validation and curation gates.

Raw rows may preserve source-language text, but final import/write-ready rows must include English for TIDAS-required multilingual fields while preserving non-English source-language variants.

For a newer release over an existing owner-draft import, use the incremental lane instead of rebuilding or rewriting every row. `dataset-incremental-change-set-compose` strictly validates a SHA-bound old/candidate/current request plus owner-snapshot receipt, then emits only INSERT/UPDATE candidates, explicit NOOP/HOLD ledgers, dependency order, a non-empty CLI execution contract when actions exist, and exactly one terminal JSONL log event per schema-valid conversion. Entity/path/value/evidence-bound rules preserve reviewed work without opening whole rows; unstable arrays and absent dependencies hold only their closure. The command is offline and non-authoritative; fresh reconciliation and capsule admission remain separate gates. See `docs/incremental-change-set-contract.md`.

When the release changes flow identities or ordered process exchanges, use `dataset-topology-convergence-compose` after a fresh SELECT-only census. It keys exchanges by process UUID, source exchange number, and occurrence; preserves owner non-exchange content plus approved German/Chinese nodes; emits separate F flow-create and P process-save contracts; and leaves D as zero-inbound delete candidates for the CLI maintenance barrier. See `docs/topology-convergence-contract.md`.

## Core Commands

```bash
pnpm init:runtime
pnpm doctor
pnpm workflow:check
pnpm storage:check
pnpm surface:audit
pnpm acceptance:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:toolchain
pnpm test:unit
pnpm test:commands
pnpm test:scenarios
pnpm skills:install:shared
pnpm skills:list
pnpm workspace:map
pnpm capabilities:list -- --class tidas-contract-context
pnpm profiles:list
node src/dev-cli.ts tidas-handshake
pnpm task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema,qa,curation
pnpm task:route -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema,qa,curation
pnpm skills:source-evidence:use:document
pnpm skills:source-evidence:use:sci
node src/dev-cli.ts dataset-incremental-change-set-compose --request <request.json> --out-dir <fresh-output-dir>
node src/dev-cli.ts dataset-topology-convergence-compose --request <request.json> --out-dir <fresh-output-dir>
```

Tests are organized by behavior layer in `test/README.md`. Use `pnpm test` for the full suite and `pnpm test:unit|test:commands|test:scenarios` for targeted checks; `pnpm test:toolchain` protects the pnpm/TS7 contract. Old incident-numbered test aliases are not part of the maintained surface.

Use owner-routed execution commands for dataset work:

```bash
node src/dev-cli.ts dataset-tidas-import \
  --input ./source-package \
  --output ./.foundry/workspaces/<task-id>/conversion

node src/dev-cli.ts dataset-tidas-validate \
  --rows-file ./rows/processes.jsonl \
  --type process \
  --out-dir ./schema

pnpm exec tiangong-lca dataset curation-queue build \
  --processes ./rows/processes.jsonl \
  --flows ./rows/flows.jsonl \
  --support ./rows/sources.jsonl \
  --out-dir ./curation-queue

pnpm exec tiangong-lca dataset curation-queue next \
  --queue-dir ./curation-queue \
  --json

pnpm exec tiangong-lca dataset curation-queue verify \
  --queue-dir ./curation-queue \
  --type process \
  --json

node src/dev-cli.ts dataset-curation-gate \
  --type process \
  --rows-file ./rows/processes.jsonl \
  --schema-report ./schema/report.json \
  --qa-report ./qa/process-qa-report.json \
  --schema-file ./context/process/schema.json \
  --yaml-file ./context/process/methodology.yaml \
  --ruleset-file ./context/process/runtime-ruleset.json \
  --queue-dir ./curation-queue \
  --classification-queue ./classification-authoring-queue.jsonl \
  --location-queue ./location-authoring-queue.jsonl \
  --identity-preflight-index ./identity-preflight-requests/identity-preflight-requests.jsonl \
  --profile bafu
```

Foundry does not expose dataset package-script aliases. Queue state belongs to the exact installed CLI via `pnpm exec tiangong-lca dataset curation-queue build/next/verify`; conversion, validation, QA, remote write/delete/redo, and readback verification belong to CLI-owned commands and checked-in skills. Foundry-local dataset commands are policy and artifact helpers only: curation packages, mutation manifests, commit handoff plans, closeout checks, and task completion reports.

`process-bundles/index.json` is a generic packaged-import contract, not a BAFU-only path. Bundle `manifest` and `tidas_dir` entries may be relative to the index directory; Foundry resolves them before scope projection. A batch runner may process independent bundle/entity tasks in parallel when the queue lock and dependency checks allow it. The configured parallelism belongs in the task workspace policy, and completed scopes should continue through commit and readback automatically when all hard gates pass. Missing public canonical unit groups, flow properties, or elementary flows are blocked by default; a frozen profile may instead authorize an account-local `state_code=0` candidate path that keeps private support outside the public cache and proves owner, unit-scale, closure, audit, and readback. Schema/QA blockers and unresolved reference closure always stay out of executable commit scopes. Each run that defers scopes writes both `blocked-scope-ledger.jsonl` for complete row-level blocker facts and `blocked-scope-report.json` for reason, affected-scope, dependency, human-action, and rerun summaries.

The operational entry point for the BAFU 2025 V2 full import — directory map, full command templates, blocker triage, and the current resume checklist — is `docs/bafu-import-runbook.md`.

For BAFU ready-scope resumes, `dataset-bafu-batch-import-run` supports `--pending-only` to filter already verified and active human-review scopes before `--limit`, `--selection-order estimated-weight-asc` to process lighter scopes first, `--pause-file` for graceful operator pauses, and `--stop-after-blocked <n>` to stop claiming new scopes once a blocker pattern is repeating. When starting a fresh batch directory, pass one or more `--ledger-source-dir <previous-batch-or-import-ledger-dir>` values so `--pending-only` can carry forward prior `ok.scopes.verified`, `ok.flows.verified`, active blocked scopes, and verified support identities while the new batch still writes its own independent ledgers. `--preflight-only` writes a read-only selected-scope plan without requiring `--commit` or starting remote writes. The runner also maintains `import-ledger/verified-support-identities.jsonl`; every profile caches verified contact/source support, and an adapter that explicitly enables unmatched FP/UG support additionally caches verified unitgroup/flowproperty identities. Later dependent scopes may reuse those identities only after support closeout/readback; a failed support scope is deferred while independent ready scopes may continue. Use `dataset-bafu-universe-coverage-report` with explicit `--ledger-source-dir` values to compare the full input `process-bundles/index.json` and `tidas/processes` universe against ready scopes, verified ledgers, retry ledgers, active blockers, and process-referenced product flow coverage. Retryable tool/network failures such as npm registry lookup failures are written to `failed.scopes.retry.jsonl` instead of active human-review.

Whole-library packaged imports should first deduplicate root TIDAS entities, then project the resulting decisions back to process scopes:

```bash
node src/dev-cli.ts dataset-library-index-build \
  --source-dir <converted-library-root> \
  --process-bundles-dir <converted-library-root>/process-bundles \
  --out-dir <run-dir>/library-index

node src/dev-cli.ts dataset-library-authoring-plan \
  --library-index <run-dir>/library-index \
  --out-dir <run-dir>/authoring-plan

node src/dev-cli.ts dataset-library-decisions-apply \
  --library-index <run-dir>/library-index \
  --decisions-dir <run-dir>/decisions \
  --out-dir <run-dir>/library-resolution

node src/dev-cli.ts dataset-process-scope-run \
  --process-bundles-dir <converted-library-root>/process-bundles \
  --library-resolution <run-dir>/library-resolution/library-resolution.json \
  --scope-file <run-dir>/library-resolution/scope-checkpoints.jsonl \
  --parallel 5 \
  --dry-run
```

`dataset-library-decisions-apply` writes `<run-dir>/library-resolution/blocked-scope-report.json` every time it evaluates scope closure. `dataset-process-scope-run` writes `<run-dir>/process-scope-run/blocked-scope-report.json` for runner-level deferrals such as non-ready scopes.

`annualSupplyOrProductionVolume` remains a required process field. Foundry preserves real evidence — a single object or a language array — byte-semantically and in original element order, and never invents a quantity from a reference flow or a default unit. When source data does not provide it, deterministic cleanup normalizes the field to the supported empty array `[]` and records a row-level evidence gap in `annual_supply_evidence_gaps` rather than AI trace deferral; the historical `9999 missing-data-sentinel/year` value survives only as a read-only recognition marker for rows written by earlier rounds. Downstream schema, authoring, curation, and write gates own rejecting or repairing what cleanup leaves non-importable.

For process rows whose source exchange list is truly output-only, pass the original converted source rows to cleanup with `--source-rows-file`. Foundry may then write deterministic `sourceExchangeCompleteness` proof only when the source row is output-only and the final row preserves the non-flow-reference exchange signature; otherwise AI `source_trace_verified` evidence or exchange repair is still required.

`--profile generic` is the default. Dataset-specific behavior is configured in `specs/import-profiles.json`; BAFU is one profile, not a special code path.

## Runtime Skills

`.agents/skills` is the single project-visible skill root. Foundry-local skills are tracked there by git; shared/runtime skills are also installed there when needed, but their names are managed by `.agents/shared-skills.json` and their installed directories remain ignored unless a task explicitly chooses pinned reproducibility.

Use the `skills` registry package through pnpm before a task needs shared skills:

```bash
pnpm skills:install:shared
pnpm skills:update
pnpm skills:list
```

For deleting, retiring, repairing, or redoing rows from a bad import under current-user RLS, route to the checked-in `tiangong-lca-skills` `$dataset-rls-maintenance` workflow and the CLI-owned `pnpm exec tiangong-lca dataset maintenance plan/apply/verify` surface. Do not add Foundry-local Supabase delete or redo commands.

For document fulltext extraction and SCI literature evidence, use the latest remote skills from `https://github.com/tiangong-ai/skills`:

```bash
pnpm dlx skills@latest use https://github.com/tiangong-ai/skills \
  --skill document-granular-decompose \
  --full-depth

pnpm dlx skills@latest use https://github.com/tiangong-ai/skills \
  --skill tiangong-kb-sci-search \
  --full-depth

git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main
```

Persistent local installs are optional operator state:

```bash
pnpm dlx skills@latest add https://github.com/tiangong-ai/skills \
  --skill tiangong-kb-sci-search document-granular-decompose \
  --agent '*' \
  --yes \
  --full-depth
pnpm skills:update
```

Installed shared runtime skills such as `.agents/skills/tiangong-kb-sci-search/`, `.agents/skills/document-granular-decompose/`, `.agents/skills/external-dataset-curated-import/`, and `skills-lock.json` remain ignored by default. Source-evidence tasks should record the resolved upstream ref, `pnpm dlx skills` command, and evidence artifacts under `.foundry/workspaces/<task-id>/runtime-skills/`.

## Repository Shape

- `src/dev-cli.ts`: 15-command flat developer diagnostic and offline-planner CLI (`doctor`, `env-check`, `workflow-check`, `storage-check`, `surface-audit`, `workspace-map`, `capabilities-list`, `profiles-list`, `tidas-handshake`, `execution-capsule-admit`, `dataset-incremental-change-set-compose`, `dataset-topology-convergence-compose`, `final-delivery-promote`, `dataset-import-ledger-report`, and `library-batch-import --profile <bafu|uslci|worldsteel>`) plus hierarchical `workspace`/`task` routing.
- `src/`: public package/facade entries (`package-entry.ts`, `public-api.ts`, `runtime-entry.ts`, `foundry-facade.ts`, `foundry-runtime.ts`), stage command owners (`src/commands/`), and typed domain/runtime libraries (`src/lib/`).
- `devops/{build,ci,release}/`: repository build/staging, CI shard/Golden/lint-audit, and four-platform release scripts (`0` imports from `src/` into `devops/`).
- `specs/module-budgets.json`: repo-wide 800-line default module ceiling, shrink-only debt/owner/semantic budgets, and dependency-direction ratchet.
- `src/lib/import-curation.ts`: typed public barrel for generic dataset curation/cleanup owners.
- `.agents/shared-skills.json`: configured Foundry-local and shared runtime skills that may appear under `.agents/skills`.
- `specs/automated-lca-capability-registry.json`: capability routing registry.
- `specs/import-profiles.json`: data-driven import profiles.
- `docs/foundry-task-contracts.md`: minimal task, source, seed, checkpoint, and artifact ledger contracts.
- `docs/execution-capsule-contract.md`: reusable offline stage, exact predecessor lineage, content-addressed boundary admission, CAS evidence, and immutable seal contract.
- `docs/final-delivery-promotion-contract.md`: reusable final-delivery content, algebra, workbook, redaction, independent-review, and detached-seal contract.
- `docs/runtime-skill-management.md`: `pnpm dlx skills` runtime dependency contract.
- `docs/import-profiles/bafu/`: BAFU profile context and constraints.
- `tasks/`: lightweight task queue and task templates.
- `.foundry/`: ignored runtime state and generated workspaces.

Remote writes are never ungated. A task must pass schema, QA, curation, cleanup, dry-run, mutation-manifest/reference-closure, commit handoff, and post-write verification gates before any database mutation. When deterministic source/contact rewrites create a writable shared contact or source dependency, Foundry may prepare a separate support finalize/handoff artifact, but dependent process/flow/lifecyclemodel scopes remain blocked until that support row is committed through the published CLI and verified. When the task write policy permits automated batch commit, ready scopes may commit without per-row human approval; human input is reserved for policy changes, exceptional waivers, and support gaps not already covered by a frozen profile's explicit account-local policy.

Tasks may set `account_intent.account_mode` to `production-test` for strict payload verification. Ordinary tasks retain the narrowly proven import-trace `traceHash` normalization path. See [public verification policy](docs/public-runtime-contract.md#account-verification-mode).

Same-task compatibility and retained identity diagnostics now have an explicit [public runtime contract](docs/public-runtime-contract.md#same-task-compatibility-and-retained-identity-diagnostics). Multilingual names preserve their valid language nodes; Process-only read-only dependencies reach initial queue/QA/CLI validation without changing scientific payloads or mutation targets. Supported manual-review diagnostics become semantic work, while incomplete historical provenance remains UNKNOWN. Local candidate qualification, original-consumer validation and release adoption are distinct facts.

A reviewed Process mass-screening observation can be handled before finalization through the [preparation quality-review contract](docs/public-runtime-contract.md#preparation-quality-review). The explicit input preserves the raw observation and exact inventory while ordinary write authorization remains separate.

## Use an installed managed runtime

Install the public Foundry package and retain a verified Foundry release manifest and its independently verified digest. Configure `TIANGONG_FOUNDRY_MANIFEST` and `TIANGONG_FOUNDRY_MANIFEST_SHA256` in the deployment environment. Optional `TIANGONG_FOUNDRY_CACHE_DIR` selects the absolute component cache. Install the release's components through the existing CLI `runtime ensure` command.

```bash
tiangong-foundry --help
tiangong-foundry runtime describe --json \
  --require-protocol tiangong-foundry.task-start.v1
```

Use normal public workspace/task arguments after configuration. For an upgrade, install and inspect the successor, then change the environment's manifest/digest pair together. Keep the preceding pair and components for rollback and task recovery. Existing tasks continue their exact returned commands. The same Skill can use compatible successor releases without editing its own release lock. See [the public runtime contract](docs/public-runtime-contract.md#environment-selected-installed-entry) for status and error behavior.
