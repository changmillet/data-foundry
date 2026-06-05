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
lastReviewedAt: 2026-06-05
lastReviewedCommit: 18b9caed641add8f7c82f4d7abc5c9e34e50c29d
---

# Workspace Project Map

Foundry should route reusable work to the owning repository instead of copying implementation locally.

| Need | Owning project | Normal surface |
| --- | --- | --- |
| TIDAS schema, methodology YAML, runtime rulesets | `tidas-sdk` | SDK contract API, `npx --yes @tiangong-lca/cli@latest dataset context-pack` |
| Source package conversion | `tidas-tools` and `tiangong-lca-cli` | `npx --yes @tiangong-lca/cli@latest dataset import-lca convert` |
| Entity curation queue state | `tiangong-lca-cli` | `npx --yes @tiangong-lca/cli@latest dataset curation-queue build/next/verify` |
| PDF/Excel/source extraction and authoring setup | `tiangong-lca-cli` and `tiangong-lca-skills` | `npx --yes @tiangong-lca/cli@latest dataset author`, `$tidas-data-import` |
| SCI literature evidence retrieval for source-evidence tasks | `tiangong-ai/skills` | `npx --yes skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth`; install/update with the npm `skills` package |
| Agent workflow instructions | `tiangong-lca-skills` | `$tidas-contract-context`, `$tidas-data-import` |
| Schema validation and QA gates | `tiangong-lca-cli` | `npx --yes @tiangong-lca/cli@latest dataset validate`, `npx --yes @tiangong-lca/cli@latest qa` |
| Remote commit, readback, and publish prep | `tiangong-lca-cli`, Edge Functions, database | `dataset-post-authoring-finalize` handoff, published CLI commit commands, `npx --yes @tiangong-lca/cli@latest dataset verify-remote`, `publish run`, Edge verification |
| Foundry task routing and manifests | `tiangong-lca-data-foundry` | `scripts/foundry.mjs route-task` |
| Write/execution policy and blocked-scope ledgers | `tiangong-lca-data-foundry` | `foundry-job.json`, library entity indexes, process-scope projections, checkpoints, mutation manifest aggregation, closeout reports |

Before implementing a missing capability, classify it with `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`.
