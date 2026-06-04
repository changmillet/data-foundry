---
title: USLCI Import Constraints
docType: constraints
scope: import-profile
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/uslci/profile.md
  - specs/import-profiles.json
---

# USLCI Import Constraints

No USLCI-specific waivers are currently approved.

Until a pilot run proves otherwise, use the generic gates:

- schema validation blockers remain blockers;
- deterministic QA blockers remain blockers;
- unresolved support/flow/process identity remains blocking;
- missing source evidence for authored fields remains blocking;
- remote write requires dry-run, queue verify, commit handoff, closeout, and readback verification.
