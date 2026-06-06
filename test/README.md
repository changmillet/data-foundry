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
  - AGENTS.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
lastReviewedAt: 2026-06-05
lastReviewedCommit: dabd3c9b9841641668caee6fe37cda37d3140739
---

# Test Layout

Foundry tests are organized by responsibility, not by the date a regression was added.

## Directories

- `unit/`: pure logic and metadata tests. These tests should avoid shelling out to Foundry commands unless the subject is command metadata or command contracts.
- `commands/`: command-level contract tests. These may run `node scripts/foundry.mjs ...` and assert stable artifacts, reports, blockers, and exit behavior for one command family.
- `scenarios/`: multi-command workflow tests. These cover realistic evidence chains such as full-context gates, post-authoring finalize, mutation manifests, and packaged-library process scopes.
- `fixtures/`: shared row builders, report builders, command runners, and file helpers split by behavior surface. Keep common command/file helpers in `foundry-core.mjs`, roots in `fixture-roots.mjs`, row payload builders in `row-builders.mjs`, and workflow-specific builders in `identity-fixtures.mjs`, `finalize-fixtures.mjs`, `full-context-fixtures.mjs`, or `mutation-fixtures.mjs`. New duplicated `runFoundry`, JSONL, row, or report helpers should go into the narrow fixture module that owns the behavior instead of a catch-all harness.

## Naming

Test files should name the behavior surface they cover, for example `post-authoring-finalize-gates.test.mjs` or `mutation-manifest-reference-closure.test.mjs`. Do not add numbered files such as `full-context-gate-07.test.mjs`.

## Commands

- `npm test`: run the full suite.
- `npm run test:unit`: run pure logic and metadata tests.
- `npm run test:commands`: run command contract tests.
- `npm run test:scenarios`: run workflow scenario tests.
