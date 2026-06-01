# Workspace Project Map

Foundry should route reusable work to the owning repository instead of copying implementation locally.

| Need | Owning project | Normal surface |
| --- | --- | --- |
| TIDAS schema, methodology YAML, runtime rulesets | `tidas-sdk` | SDK contract API, CLI context pack |
| Source package conversion | `tidas-tools` and `tiangong-lca-cli` | `tiangong-lca dataset import-lca convert` |
| PDF/Excel/source extraction and authoring setup | `tiangong-lca-cli` and `tiangong-lca-skills` | `tiangong-lca dataset author`, `$tidas-data-import` |
| Agent workflow instructions | `tiangong-lca-skills` | `$tidas-contract-context`, `$tidas-data-import` |
| Schema validation and QA gates | `tiangong-lca-cli` | `dataset validate`, `qa` |
| Remote readback and publish prep | `tiangong-lca-cli`, Edge Functions, database | `dataset verify-remote`, `publish run`, Edge verification |
| Foundry task routing and manifests | `tiangong-lca-data-foundry` | `scripts/foundry.mjs route-task` |

Before implementing a missing capability, classify it with `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`.
