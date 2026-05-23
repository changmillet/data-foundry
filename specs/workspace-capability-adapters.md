# Workspace Capability Adapter Specification

Status: Draft v0

Purpose: Define how the data foundry should discover and call workspace projects, LCA skills, CLI commands, and hybrid-search runtimes without absorbing their implementation.

## 1. Principle

The foundry is a control plane. It owns task state, workspace isolation, evidence, and gate reconciliation. Domain execution belongs to the owning project:

- command/runtime behavior belongs in `tiangong-lca-cli`
- agent-facing repeatable workflows belong in `tiangong-lca-skills`
- Edge Function behavior belongs in `tiangong-lca-edge-functions`
- database RPCs, triggers, and indexes belong in `database-engine`
- schema contracts belong in `tidas`, `tidas-sdk`, and `tidas-tools`
- historical private task evidence can be read from `LCA-DATA-AGENT`
- durable foundry-local source knowledge belongs in `wiki/`

Before implementing any missing capability, classify it with `specs/capability-ownership-rules.json`.

Foundry-local code is appropriate when the feature only coordinates existing commands, writes task-local manifests, or reconciles foundry gates. A development request should be routed to another project when the feature is a reusable command, reusable skill workflow, calculator/runtime behavior, database/Edge Function behavior, or schema semantics.

Shared capability follow-up tasks must include `capability_scope`, `owner_project`, `shared_or_project_specific`, `why_not_foundry_local`, `expected_input_contract`, `expected_output_contract`, `suggested_implementation_location`, and `done_criteria`.

## 2. Registry Model

The foundry needs a read-only project and capability registry before it can become a general data foundry.

Minimum project registry fields:

- `id`
- `role`
- `default_path`
- `source_kind`: `workspace-submodule`, `sibling-checkout`, `installed-runtime`, or `private-artifact-root`
- `owner_boundary`
- `write_policy`: `read-only`, `explicit-output-only`, or `repo-owned-change`
- `doctor_checks`

Minimum capability registry fields:

- `id`
- `class`
- `owner_project`
- `entrypoint`
- `input_contract`
- `output_contract`
- `remote_write_mode`
- `verification_gate`
- `source_manifest_requirements`

The current automated LCA production dry-run registry lives at
`specs/automated-lca-capability-registry.json`. It is intentionally a
Foundry-local routing contract over shared CLI primitives; it must not duplicate
the CLI implementation itself.

## 3. Capability Classes

| Class | Examples | Default write mode |
| --- | --- | --- |
| `dataset-inventory` | current-account snapshot, process scope statistics | explicit-output-only |
| `schema-validation` | local TIDAS/SDK validation | explicit-output-only |
| `source-evidence-review` | lifecycleinventory review, process numeric/source review | explicit-output-only |
| `reference-closure` | flow materialization, alias maps, process-flow repair plans | explicit-output-only |
| `hybrid-retrieval` | `tiangong search flow/process/lifecyclemodel` | explicit-output-only |
| `process-build` | `process-automated-builder` | explicit-output-only |
| `lifecyclemodel-build` | `lifecyclemodel-automated-builder`, recursive orchestrator | explicit-output-only |
| `embedding-maintenance` | `embedding-ft`, webhook troubleshooting | dry-run until explicitly committed |
| `publish-prep` | `lca-publish-executor`, publish bundles | dry-run |
| `remote-publish` | `tiangong publish run --commit`, flow/process/model save/publish | explicit approval only |

## 4. Adapter Contracts

### CLI Adapter

Use for stable operations whenever `tiangong <noun> <verb>` exists.

Required manifest:

- CLI root
- command argv
- env keys used, redacted
- input path
- output path
- exit code
- stdout/stderr capture path when retained

The foundry must pass explicit `--out-dir` or `--run-dir` for artifact-producing commands.

### Skill Adapter

Use when the repeatable workflow already exists as a skill wrapper.

Rules:

- prefer workspace `tiangong-lca-skills` when running against the pinned workspace state
- prefer sibling `lca-skills` only when intentionally developing or comparing the public skill source
- pass `--cli-dir` or `TIANGONG_LCA_CLI_DIR` explicitly when a local CLI checkout is required
- do not let skills write into their own source tree

### Hybrid Search Adapter

Use for flow, process, and lifecyclemodel retrieval.

Path:

```text
foundry task -> search skill or tiangong search -> Edge Function -> database RPC -> result artifact
```

Required artifacts:

- normalized search request
- query and filter
- dry-run request when available
- response JSON
- failure classification: auth, query rewrite, embedding provider, RPC, empty result, or filter mismatch

### Source Artifact Adapter

Use for historical task outputs under `LCA-DATA-AGENT`.

Rules:

- read only
- copy or summarize needed inputs into the task workspace
- never assume private artifact paths are durable API contracts
- replace path-specific logic with registry-backed source adapters as the foundry matures

### Wiki Knowledge Adapter

Use for reusable background knowledge and source recovery that should be available before task-specific execution starts.

Rules:

- store source-of-truth pages as Markdown under `wiki/pages/`
- preserve imported source files under `wiki/vault/`
- rebuild derived local indexes with `npm run wiki:init` or `npm run wiki:sync`
- keep `wiki/index.db` out of git
- query the wiki before LCA rules, ILCD conventions, naming, or product-carbon-footprint factor database decisions
- cite linked wiki pages or source summaries in task reports when they materially influence a repair or review decision

Required artifacts:

- source summary page
- fulltext chunk pages when source text is too large for one page
- source manifest such as `wiki/rulesbook-manifest.json`
- local wiki command and env-file used for indexing or search

### Schema Adapter

Use `tidas-sdk` and `tidas-tools` for local schema validation before diagnosing website or UI behavior.

Required artifacts:

- validator command and version/source root
- input row or package manifest
- validation report
- zero-blocking-issue proof or residual issue list

### Remote Write Adapter

Remote writes remain disabled unless the task, workflow policy, and environment gates all permit them.

Every remote write adapter must have:

- dry-run input
- dry-run result
- state-code-aware mutation plan
- commit limit
- post-write verification command
- rollback or follow-up task note when verification fails

## 5. Task Router

The router should map task metadata to one or more capability classes:

| Task signal | Capability route |
| --- | --- |
| `kind=category-update` | dataset inventory, schema validation, source evidence review, reference closure, publish-prep |
| `kind=account-governance` | current-account dataset review plus category loop |
| `kind=hybrid-retrieval` | hybrid search adapter |
| `kind=process-build` | process builder plus lifecycleinventory review |
| `kind=lifecyclemodel-build` | lifecyclemodel builder or recursive orchestrator |
| `kind=flow-governance` | flow governance review |
| `kind=embedding-maintenance` | embedding-ft and Edge Function/database diagnostics |
| `kind=publish-dry-run` | publish executor in dry-run mode |
| `kind=verification` | schema, reference, remote, and graph verification adapters |

The router can compose multiple adapters, but each adapter must write to a distinct output directory under the task workspace.

## 6. v0 Implementation Scope

v0 keeps the existing DATA-001 electricity handler and adds a read-only workspace map command. The next implementation step is to replace hardcoded source paths with registry entries, then split DATA-001 into composable adapter calls.

Expected v1 commands:

```bash
npm run workspace:map
npm run capabilities:list
npm run orchestrator:once
```

`workspace:map` is diagnostic. `capabilities:list` should become the machine-readable registry after the first adapters are extracted.
