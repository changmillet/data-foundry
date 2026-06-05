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
  - scripts/foundry.mjs
  - scripts/lib/foundry-cli.mjs
  - scripts/lib/foundry-command-metadata.mjs
  - scripts/lib/import-curation/**
  - test/foundry-command-metadata.test.mjs
---

# Foundry AI Navigation

Foundry is a thin control plane. Start from commands and artifacts, then move to
the semantic owner module. Do not start from large implementation files.

## Command Path

Every command follows this route:

```text
scripts/foundry.mjs
  -> scripts/lib/foundry-cli.mjs
  -> command owner module
```

The checked source of truth for command ownership is
`scripts/lib/foundry-command-metadata.mjs`. It maps every command returned by
`node scripts/foundry.mjs help` to:

- category
- owner module
- owner export
- input artifacts
- output artifacts
- key tests

`test/foundry-command-metadata.test.mjs` enforces that the metadata covers all
registered commands and that public commands remain reachable within two jumps
from `scripts/foundry.mjs`.

## Import-Curation Modules

Use these semantic modules as the import-curation navigation surface:

| Module | Responsibility |
| --- | --- |
| `scripts/lib/import-curation/profiles.mjs` | import profile listing and profile lookup |
| `scripts/lib/import-curation/curation-gate.mjs` | curation gate report and AI authoring package creation |
| `scripts/lib/import-curation/authoring-packages.mjs` | AI authoring task manifest/package preparation |
| `scripts/lib/import-curation/patch-collect.mjs` | AI patch collection and patch evidence readiness |
| `scripts/lib/import-curation/curation-cleanup.mjs` | deterministic prewrite row cleanup |
| `scripts/lib/import-curation/trace-summary.mjs` | Foundry trace summarization |
| `scripts/lib/import-curation/mutation-manifest.mjs` | prewrite mutation manifest and blocker aggregation |

Command runners live in the semantic modules above. The remaining
`scripts/lib/import-curation/internal/legacy-implementation.mjs` file is a
compatibility/helper layer for workflow logic that has not yet been split into
smaller internal modules. New command behavior should start in the semantic
owner module, with reusable helpers placed in focused internal modules.

## Internal Layers

The current internal dependency direction is:

```text
semantic import-curation modules
  -> internal/legacy-implementation.mjs
  -> internal/full-context-proof.mjs
  -> internal/profiles-config.mjs
  -> internal/trace-summary.mjs
  -> internal/dataset-payload.mjs
  -> internal/dataset-types.mjs
  -> internal/runtime-io.mjs
```

Layer rules:

- `runtime-io.mjs`: generic time, array, text, JSON/JSONL, filesystem, and path helpers.
- `dataset-types.mjs`: supported dataset type sets, plural names, and fallback profile constants.
- `dataset-payload.mjs`: TIDAS row payload unwrap, dataset root/type detection, dataset identity, and identity map keys.
- `profiles-config.mjs`: import profile loading, normalization, listing, and lookup.
- `trace-summary.mjs`: Foundry trace entry collection and compact trace summaries.
- `full-context-proof.mjs`: full-context package/task proof loading and blocker construction.
- `legacy-implementation.mjs`: remaining compatibility/helper surface; do not add new command runners here.

Dependencies should point downward only. Internal low-level modules must not
import semantic command modules.

## Behavior Freeze

Before and after structural changes, run:

```bash
npm run golden:diff
node --test test/*.mjs
npm run test:full-context-gate
node scripts/foundry.mjs doctor
git diff --check
```

Golden diff protects CLI JSON compatibility for the key command set. The full
test suite protects workflow-specific artifact and proof behavior. Command
metadata tests protect AI navigation.
