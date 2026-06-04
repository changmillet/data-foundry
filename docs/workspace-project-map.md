---
title: Foundry Workspace Project Map
docType: reference
scope: workspace-adapters
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when routing Foundry capabilities to sibling TianGong LCA projects
  - when checking whether a missing capability should be implemented in Foundry or another repo
whenToUpdate:
  - when workspace project ownership, normal surfaces, or routing boundaries change
checkPaths:
  - docs/workspace-project-map.md
  - docs/architecture.md
  - docs/capability-ownership-policy.md
  - specs/capability-ownership-rules.json
  - specs/workspace-capability-adapters.md
lastReviewedAt: 2026-06-04
lastReviewedCommit: 77dfa0de95629e228759e2fe84ea96f23d08623c
---

# Workspace Project Map

Foundry should route reusable work to the owning repository instead of copying implementation locally.

| Need | Owning project | Normal surface |
| --- | --- | --- |
| TIDAS schema, methodology YAML, runtime rulesets | `tidas-sdk` | SDK contract API, CLI context pack |
| Source package conversion | `tidas-tools` and `tiangong-lca-cli` | `tiangong-lca dataset import-lca convert` |
| Entity curation queue state | `tiangong-lca-cli` | `tiangong-lca dataset curation-queue build/next/verify` |
| PDF/Excel/source extraction and authoring setup | `tiangong-lca-cli` and `tiangong-lca-skills` | `tiangong-lca dataset author`, `$tidas-data-import` |
| SCI literature evidence retrieval for source-evidence tasks | `tiangong-ai/skills` | `npx --yes skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth`; install/update with the npm `skills` package |
| Agent workflow instructions | `tiangong-lca-skills` | `$tidas-contract-context`, `$tidas-data-import` |
| Schema validation and QA gates | `tiangong-lca-cli` | `dataset validate`, `qa` |
| Remote readback and publish prep | `tiangong-lca-cli`, Edge Functions, database | `dataset verify-remote`, `publish run`, Edge verification |
| Foundry task routing and manifests | `tiangong-lca-data-foundry` | `scripts/foundry.mjs route-task` |

Before implementing a missing capability, classify it with `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`.
