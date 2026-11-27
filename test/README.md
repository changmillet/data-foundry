---
title: Foundry Test Layout
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when adding, moving, or reviewing Foundry tests
  - when deciding whether a test belongs in unit, commands, scenarios, or fixtures
whenToUpdate:
  - when test directory ownership, naming, scripts, or harness rules change
checkPaths:
  - test/README.md
  - package.json
  - tsconfig*.json
  - devops/ci/**
  - specs/ci/**
  - specs/module-budgets.json
  - test/**
lastReviewedAt: 2026-11-27
lastReviewedCommit: 4ac3ee89f1180a3c2374ff1dab1fa09a02d136ea
lastReviewedNote: "R4.5: dehydrated historical per-PR/wave changelog narratives into docs/archive/delivery-review-history.md while retaining authoritative test directory layout, naming, commands, permanent ratchets, CI partition contract, and native scientific repair qualification."
---

# Test Layout

Foundry tests are organized strictly by behavior responsibility rather than chronological incident order. Historical per-PR test evolution logs and CI shard timing-refresh provenance are archived in [docs/archive/delivery-review-history.md](../docs/archive/delivery-review-history.md).

## Directories

- `test/unit/`: pure logic, metadata, schema, budget, toolchain, and boundary contract tests. Avoid shelling out to Foundry CLI commands unless the subject under test is command metadata, CLI spine parsing, or installed-entry contracts.
- `test/commands/`: single-command contract tests asserting stable reports, artifacts, blockers, and exit codes. Flat developer CLI commands run `node src/dev-cli.ts ...`; internal pipeline stages run through `test/fixtures/run-internal-stage.ts` (or `test/fixtures/foundry-core.ts`), including `test/commands/authoring-plan.test.mts`, `test/commands/authoring-task-context.test.mts`, `test/commands/classification-decisions.test.mts`, and `test/commands/location-decisions.test.mts`.
- `test/scenarios/`: multi-command workflow, public facade, package consumer, runtime migration, and managed-adoption scenarios using isolated workspaces, fake/synthetic remote transports, or real installed packages.
- `test/fixtures/`: shared row builders, report builders, command runners, file helpers, and process-boundary fakes (`foundry-core.ts`, `fixture-roots.ts`, `row-builders.ts`, `identity-fixtures.ts`, `finalize-fixtures.ts`, `full-context-fixtures.ts`, `mutation-fixtures.ts`, `auth-identity-receipt.ts`, `fake-tidas.ts`). Fakes model published protocol reports/exits/cancellation only and never reimplement TIDAS schema or CLI business logic.
- `test/helpers/`: shared runtime-manifest, retained-runtime, managed-adoption, and installed-package test staging helpers (`foundry-runtime-manifest.mts`, `retained-foundry-runtime.mts`, `managed-adoption-fixture.mts`, `shared-installed-package-template.mts`). Shared host-temp caches materialize the immutable `b57ae116` retained workspace and current-source `package-stage` snapshot template once per host across concurrent test processes while keeping per-test `HOME`/`TMPDIR` and checkout-mutating cases isolated.

## Naming And Authorship Rules

- Name test files after the behavior surface they verify (for example `post-authoring-finalize-gates.test.mts` or `mutation-manifest-reference-closure.test.mts`). Do not add numbered regression buckets such as `full-context-gate-07.test.mts`.
- All test files use `.test.mts` (native TypeScript). Do not add `.js`/`.mjs` tests or migration-scaffolding suites duplicating permanent whole-repo ratchets.
- Follow TDD: start with a failing focused contract for the touched semantic owner, preserve exact bytes/hashes/order/fail-closed invariants, and run focused suites before full validation.
- Clean-worktree portability is mandatory: every suite must pass from an arbitrary clean Git worktree with `pnpm install --frozen-lockfile` and zero reliance on sibling checkouts, `.foundry/`, `.env`, or live credentials.

## Canonical Test Commands

| Script | Scope |
| --- | --- |
| `pnpm test:unit` | All `test/unit/*.test.mts` suites |
| `pnpm test:commands` | All `test/commands/*.test.mts` suites |
| `pnpm test:scenarios` | All `test/scenarios/*.test.mts` suites |
| `pnpm test:toolchain` | Toolchain, zero-JS ratchet, suppression audit, and build contract suites |
| `pnpm test:fast` | Fast local unit + command feedback loop (excludes heavy package/adoption scenarios) |
| `pnpm test:smoke:public` | Public facade & installed-entry smoke verification |
| `pnpm test` | Complete local behavior suite (`unit` + `commands` + `scenarios`) |
| `pnpm golden:diff` | Isolated non-`HEAD` normalized output diff against merge-base |
| `pnpm prepush:gate` | Fast local pre-push gate (lint, toolchain, `test:fast` unit + commands, Golden, surface audit, build, package build/check, audit) |
| `pnpm prepush:gate:full` | Complete local pre-push gate including all scenario suites (`pnpm test`) |

## Permanent Whole-Repository Ratchets

- `test/unit/zero-javascript-ratchet.test.mts`: zero tracked first-party JavaScript, zero `.jsx`/`.tsx`, global Oxlint `typescript/no-explicit-any` and `typescript/ban-ts-comment` errors, disabled nested configs, and complete Git-to-lint/typecheck inventory reconciliation.
- `test/unit/toolchain-contract.test.mts`: Node.js 24, `pnpm@11.24.0`, sole root lockfile, TypeScript `7.0.2` with `erasableSyntaxOnly`, guarded stale-`dist` cleanup, and `noEmitOnError`.
- `test/unit/lint-suppression-audit.test.mts`: comment-aware suppression scanning with inherited Git hook variables cleared.
- `test/unit/orchestration-module-budget.test.mts`: repo-wide 800-line default module ceiling across `src/` and `devops/` (`"debt_ceiling_lines": {}`), shrink-only owner/semantic ceilings, `src/lib/` below `src/commands/`, zero circular dependencies (`allowed_cycles: []`), and zero `src/ -> devops/` cross-imports.
- `test/unit/type-safety-ratchet.test.mts`: zero `as never` casts and zero `as unknown as` casts across `src/**/*.ts`, plus centralized CLI compatibility helper coverage (`src/lib/cli-compatibility-capabilities.ts`).
- `test/unit/foundry-command-metadata.test.mts`, `test/unit/foundry-cli-spine.test.mts`, and `test/unit/surface-audit-typescript.test.mts`: exact 15-command flat CLI + 64-stage internal registry, two-hop command reachability, zero hidden aliases, zero empty metadata categories, and zero unregistered orphan docs.
- `test/unit/worldsteel-support-mint-truth.test.mts`: cross-file alignment between `src/commands/worldsteel-batch-import-run.ts`, `specs/import-profiles.json`, and Worldsteel profile docs.
- `test/unit/pre-push-deletion.test.mts`: pure branch-deletion fast path vs. full gate for code/tag/mixed pushes under both `C` and `en_US.UTF-8` locales.

## Boundary Coverage Model

- **Public runtime & task lifecycle**: `unit/foundry-operation-result.test.mts`, `unit/foundry-task-start-spec.test.mts`, `unit/foundry-facade-schemas.test.mts`, `unit/foundry-runtime-command-policy.test.mts`, `unit/foundry-runtime-qualification.test.mts`, `scenarios/foundry-public-facade.test.mts`, `scenarios/foundry-public-workflow.test.mts`, `scenarios/foundry-facade-request-store.test.mts`, and `scenarios/foundry-execution-admission.test.mts`.
- **Task authorization, OAuth & account safety**: `unit/task-authorization.test.mts`, `unit/task-profile-authority.test.mts`, `unit/oauth-identity-contract.test.mts`, and `commands/account-context-wrapper.test.mts`. Tests use explicit opt-in fixtures (`fixtures/task-authorizations.ts`, `fixtures/auth-identity-receipt.ts`) and never contact live Supabase/production accounts.
- **Package distribution & managed adoption**: `unit/foundry-package-contract.test.mts`, `unit/foundry-installed-entry.test.mts`, `scenarios/foundry-package-consumer.test.mts`, and the six `scenarios/foundry-managed-*.test.mts` adoption suites (exercising real Node + CLI IPC with synthetic native fixtures; private real-account acceptance remains outside public CI).
- **Release & CI integrity**: `unit/foundry-release-*.test.mts`, `commands/foundry-release-*.test.mts`, `unit/foundry-ci-*.test.mts`, and `unit/foundry-golden-normalization.test.mts` (explicit whole-projection Golden normalizations only).

## CI Test Partitioning And Release Lanes

- Full four-platform source CI partitions the complete test inventory into 8 shards on `linux-x64` (`--test-concurrency=4`), 4 on `linux-arm64` (`--test-concurrency=4`), 4 on `darwin-arm64` (`--test-concurrency=3`), and 10 on `win32-x64` (`--test-concurrency=2`), using `max-parallel: 26` with Windows and macOS shards admitted first (26 receipts total, 40-minute job limit, isolated Node processes per file).
- `devops/ci/ci-plan.ts` binds the global plan hash over every platform shard and concurrency mapping using `specs/ci/test-durations.json` and the digest-bound `specs/ci/windows-test-observations.json` dual timing scenario; Windows reserves dedicated partitions for the native-draft and repair-successor suites and bounds remaining partitions under `estimatedWallSeconds * 1.2 + 90 < 2400`.
- `devops/ci/ci-test-reporter.ts` loads by `file:` URL for Windows drive-letter portability and writes a separate native TAP diagnostic file alongside the machine event report; hosted Windows shard receipts attach diagnostic-only `host_observation` (`tiangong-foundry.ci-test-host.v1`) without affecting pass/fail qualification.
- Pull requests select fail-closed lanes: `docs-only` (`ci-docs-gate.ts` on `ubuntu-latest`), `pr-fast` (all test files across 8 `linux-x64` shards + `pr-checks` + `build-package` on `ubuntu-latest`), `version-only` (`ci-version-gate.ts`), or `full` (automatic for release/CI/build/packaging/toolchain/managed-runtime paths or `ci:full` label). Final release `workflow_call` workflows always require complete four-platform tests, native qualification, aggregation, and copied bootstrap.

## Native Scientific Repair Qualification

`unit/foundry-scientific-repair-runtime.test.mts` and `commands/scientific-repair-fixture.test.mts` verify synthetic Worker and CLI QA contracts in ordinary CI. `scenarios/foundry-scientific-repair-native.test.mts` executes the full registered repair flow against deployed native Worker and TIDAS executables when `TIANGONG_FOUNDRY_SCIENTIFIC_REPAIR_QA_CONFIG` points to an absolute JSON config:

```json
{
  "schema": "tiangong-foundry.scientific-repair-qa.v1",
  "host_config_root": "/absolute/host-config",
  "tidas_executable": "/absolute/tidas/bin/tidas",
  "tidas_sha256": "<reviewed executable SHA-256>",
  "tidas_version": "0.3.4",
  "tidas_asset_fingerprint": "<reviewed validation asset fingerprint>",
  "evidence_directory": "/absolute/scientific-repair-qa-evidence"
}
```

`host_config_root/tiangong-foundry/provider-impact-runtime.json` supplies the deployment-owned Worker executable and SHA-256 outside the workspace/cache/task sources. Every mutation request remains inside the test's synthetic remote transport while retaining preparation reports, task state, and a machine receipt under `evidence_directory`:

```bash
TIANGONG_FOUNDRY_SCIENTIFIC_REPAIR_QA_CONFIG=/absolute/scientific-repair-qa.json node --test test/scenarios/foundry-scientific-repair-native.test.mts
```
