# Workspace Project Map

Status: Draft v0

Purpose: Record the LCA workspace projects and capability surfaces that the data foundry must route through.

This file is a design input for the foundry. It does not make any sibling repository writable from here.

## Project Roots

| Role | Default path | Foundry use |
| --- | --- | --- |
| Foundry control plane | `/home/example/projects/tiangong-lca-data-foundry` | task queue, policy, workspaces, evidence, orchestration |
| LCA workspace integration repo | `/home/example/projects/workspace` | submodule graph and integration-state source |
| Current private data-governance workspace | `/home/example/projects/LCA-DATA-AGENT` | historical tasks, playbooks, promoted inputs, account artifacts |
| Standalone LCA skills source | `/home/example/projects/lca-skills` | public skill source and skill validation patterns |
| Installed runtime skills | `/home/example/.agents/skills` | currently callable agent skills, not the source of truth for new skill development |

`/home/example/projects/workspace` is the integration graph. The foundry should prefer its submodule paths when a task needs the pinned cross-repo state. Sibling checkouts such as `/home/example/projects/tiangong-cli` and `/home/example/projects/lca-skills` can still be used for development or comparison, but a run manifest must say which root was used.

## Workspace Submodules

The workspace currently coordinates these projects:

| ID | Path under workspace | Responsibility in foundry design |
| --- | --- | --- |
| `next` | `tiangong-lca-next` | product UI behavior and validation symptoms |
| `edge-functions` | `tiangong-lca-edge-functions` | Supabase Edge Functions, auth, hybrid search, embedding jobs, publish/import APIs |
| `calculator` | `tiangong-lca-calculator` | calculation and solver runtime |
| `tidas-tools` | `tidas-tools` | validation, conversion, export tooling |
| `tidas-sdk` | `tidas-sdk` | generated schema/SDK validation layer |
| `next-docs` | `tiangong-lca-next-docs` | user-facing docs and product behavior references |
| `tidas` | `tidas` | TIDAS specification and schema source |
| `data` | `tiangong-lca-data` | dataset content repository |
| `skills` | `tiangong-lca-skills` | shared skill wrappers and workflow assets |
| `mcp` | `tiangong-lca-mcp` | MCP server/tool integration layer |
| `domain-embedding` | `lca-domain-embedding` | retrieval and embedding evaluation/model assets |
| `cli` | `tiangong-lca-cli` | unified command surface for local and remote LCA operations |
| `database-engine` | `database-engine` | database schema, RPCs, triggers, indexes, Supabase governance |

## Design Boundary

The foundry owns orchestration and evidence. It should not copy business logic from these projects into `scripts/foundry.mjs`.

Default route:

1. Classify a task.
2. Freeze task inputs into `.foundry/workspaces/<task-id>/inputs/`.
3. Resolve the required capability from the project/capability registry.
4. Invoke the public CLI or skill wrapper with explicit input and output paths.
5. Persist a source manifest with repo path, command, input file, output directory, and relevant commit when available.
6. Stop at review when any gate remains open.

## LCA Skill Surfaces

The workspace `tiangong-lca-skills` source currently includes:

| Skill | Capability class |
| --- | --- |
| `current-account-dataset-review` | account/category governance, local validation, reference rewrite, lifecyclemodel graph audit |
| `embedding-ft` | embedding queue execution and troubleshooting |
| `flow-governance-review` | flow review, remediation, alias maps, process-flow repair, publish preparation |
| `flow-hybrid-search` | flow search retrieval and hybrid-search debugging |
| `lca-publish-executor` | standard publish request handoff through `tiangong publish run` |
| `lifecycleinventory-review` | process and lifecyclemodel inventory review |
| `lifecyclemodel-automated-builder` | lifecyclemodel artifact assembly from local process-build runs |
| `lifecyclemodel-hybrid-search` | lifecyclemodel retrieval and hybrid-search debugging |
| `lifecyclemodel-recursive-orchestrator` | recursive model/process assembly planning and execution |
| `lifecyclemodel-resulting-process-builder` | deterministic resulting-process construction from lifecyclemodels |
| `process-automated-builder` | `process_from_flow` local build/resume/publish preparation |
| `process-dedup-review` | duplicate-process review and evidence outputs |
| `process-hybrid-search` | process retrieval and hybrid-search debugging |
| `process-scope-statistics` | visible or owner-filtered process-scope statistics |
| `tiangong-lca-remote-ops` | remote process maintenance wrappers and verification handoff |

These skills should stay thin. If a capability is missing, the durable fix belongs in `tiangong-lca-cli` or the owning runtime repo, then the skill wrapper should call the public command.

## Hybrid Search Stack

Hybrid search is a multi-repo capability, not just three skills:

| Layer | Owner | Current surface |
| --- | --- | --- |
| Agent-facing wrappers | `tiangong-lca-skills` | `flow-hybrid-search`, `process-hybrid-search`, `lifecyclemodel-hybrid-search` |
| CLI | `tiangong-lca-cli` | `tiangong search flow/process/lifecyclemodel --input <file>` |
| Edge Functions | `tiangong-lca-edge-functions` | `flow_hybrid_search`, `process_hybrid_search`, `lifecyclemodel_hybrid_search` |
| Shared query rules | `tiangong-lca-edge-functions` | `_shared/hybrid_query_utils.ts` |
| Database RPC | `database-engine` | `hybrid_search_flows`, `hybrid_search_processes`, `hybrid_search_lifecyclemodels` |
| Embedding assets | `lca-domain-embedding` and Edge Functions | fine-tuned embedding assets plus `embedding_ft` and webhook routes |

Foundry retrieval tasks should invoke hybrid search through the CLI or skill wrapper and write the query, filter, result, and failure diagnostics into the task workspace. The foundry should not call database RPCs directly unless the task is explicitly a database-governance task.

## Adapter Priority

| Need | First route | Fallback |
| --- | --- | --- |
| Local or remote LCA command | `tiangong-lca-cli` | update CLI, then update skill |
| Agent-usable repeatable workflow | `tiangong-lca-skills` | create/update a skill after CLI contract exists |
| Current account/category governance | `current-account-dataset-review` plus CLI | `LCA-DATA-AGENT` artifacts as read-only evidence source |
| Flow governance | `flow-governance-review` plus CLI | task-specific local report only |
| Process/lifecyclemodel build | `process-automated-builder`, `lifecyclemodel-*` wrappers | CLI native builders |
| Hybrid search | search skills or `tiangong search ...` | Edge Function repo for auth/query/RPC diagnosis |
| Schema validation | `tidas-sdk` / `tidas-tools` | website/Next diagnosis only after local validation is understood |
| Database RPC/index/trigger issue | `database-engine` | Edge Function diagnosis if runtime wrapper is failing |
| UI validation symptom | `tiangong-lca-next` | derive a minimal upstream issue after local/runtime evidence |

## Required Evidence

Every cross-project run should preserve:

- task id and capability id
- project root and relative command path
- input files and output directory
- CLI or skill command
- remote-write mode and dry-run status
- commit hash or submodule pointer when cheap to collect
- gate status and residual follow-up tasks

