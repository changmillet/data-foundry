---
title: USLCI Import Profile
docType: profile
scope: import-profile
status: draft
owner: tiangong-lca-data-foundry
related:
  - specs/import-profiles.json
  - docs/foundry-task-contracts.md
  - docs/skill-orchestration/dataset-authoring-skill-architecture.md
---

# USLCI Import Profile

This profile is the placeholder for USLCI package imports. It exists to keep USLCI as data/profile configuration, not as a Foundry code path.

## Lane

Use `external-dataset-curated-import` for structured USLCI source packages. Source extraction, conversion, validation, QA, curation queue state, and write/readback behavior must stay in the owning CLI, tools, skills, and database surfaces.

## Initial Policy

- No profile-specific QA waivers are defined yet.
- Preserve source-language/source-package evidence before row repair.
- Build entity queues with `tiangong-lca dataset curation-queue build`.
- Drive resumable work with `tiangong-lca dataset curation-queue next`.
- Require `tiangong-lca dataset curation-queue verify` before write planning.

## Open Decisions

- Source package format detection and converter owner.
- USLCI source citation/source row policy.
- Any profile-specific QA observations that should be warnings rather than blockers.
- Account/state-code/write policy.
