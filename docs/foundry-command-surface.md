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
  - scripts/lib/foundry-command-registry.mjs
  - scripts/lib/foundry-command-metadata.mjs
  - test/foundry-command-metadata.test.mjs
---

# Foundry Command Surface

Foundry command governance has two layers:

- `scripts/lib/foundry-command-registry.mjs` is the runtime command list and exit-code policy.
- `scripts/lib/foundry-command-metadata.mjs` is the AI-readable navigation and ownership map.

The metadata module must cover every command returned by `node scripts/foundry.mjs help`.
It records each command category, owner module, owner export, input artifacts, output
artifacts, workflow entry audit state, and key behavior checks.

## Categories

- `public`: stable operator-facing commands for runtime setup, diagnostics, task routing, profile listing, and task state.
- `workflow-internal`: Foundry policy or artifact helpers used inside the import/authoring workflow.
- `cli-wrapper`: compatibility wrappers over sibling `tiangong-lca` CLI behavior that Foundry does not own.
- `candidate-deprecate`: commands that may be deprecated only after evidence shows no command, test, doc, or artifact dependency still requires them.

Every non-deprecated command must have `workflowEntry.status: "active"` and at
least one key behavior check. A `candidate-deprecate` command must instead carry
explicit `deprecation.deletionConditions`, so unused surface area cannot hide as
an unreviewed command.

## Navigation Contract

Every command must be reachable through this path:

```text
scripts/foundry.mjs
  -> scripts/lib/foundry-cli.mjs
  -> owner module in scripts/commands or scripts/lib/import-curation
```

Public command owner paths must be at most two jumps from `scripts/foundry.mjs`.
For semantic import-curation commands, prefer owner modules such as
`profiles.mjs`, `curation-gate.mjs`, `authoring-packages.mjs`, `patch-collect.mjs`,
`curation-cleanup.mjs`, `trace-summary.mjs`, and `mutation-manifest.mjs` over
mechanical part names. Reusable import-curation logic should be exposed through
focused workflow facets under `scripts/lib/import-curation/internal/*-workflow.mjs`.

## Maintenance Rule

When a command is added, removed, renamed, moved, or reclassified, update both:

1. `scripts/lib/foundry-command-registry.mjs`
2. `scripts/lib/foundry-command-metadata.mjs`

Then run:

```bash
node --test test/foundry-command-metadata.test.mjs
npm run golden:diff
```
