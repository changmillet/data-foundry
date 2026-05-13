# Data Foundry Service Specification

Status: Draft v0

Purpose: Define the private orchestration service that turns data tasks into isolated autonomous LCA data work runs.

## 1. Problem

TianGong LCA data updates currently require a human to decide scope, run inventory, classify datasets, inspect schema and semantic quality, generate repair candidates, run dry-runs, and verify the result. The target system should turn that into an always-on workflow where humans mostly provide task intent and policy.

## 2. Design Borrowed From Symphony

This project follows the Symphony service shape:

- a long-running orchestrator reads tasks from a tracker or queue
- each task gets an isolated workspace
- workflow policy lives in repo-owned `WORKFLOW.md`
- agent execution is bounded by concurrency, retry, and terminal-state rules
- structured logs and status surfaces make runs operable

For LCA data work, the task tracker starts as filesystem-backed Markdown files. Later adapters can support Linear, GitHub Issues, Notion, Slack, or database queues.

## 3. Core Components

1. `Workflow Loader`
   - reads `WORKFLOW.md`
   - parses front matter and prompt body
   - validates required policy keys

2. `Task Intake`
   - reads tasks from `tasks/inbox`
   - normalizes task metadata into a stable task model
   - classifies work type

3. `Orchestrator`
   - owns polling, eligibility, concurrency, retries, and terminal reconciliation
   - dispatches task workspaces

4. `Project Registry`
   - maps the local LCA workspace submodules, sibling checkouts, and installed skill roots
   - keeps ownership boundaries explicit
   - records which roots are read-only references and which roots are executable surfaces

5. `Capability Router`
   - maps a task class to CLI, skill, source-artifact, hybrid-search, schema, Edge Function, or database adapters
   - prevents hidden direct database writes
   - emits source manifests for every cross-project invocation

6. `Workspace Manager`
   - creates `.foundry/workspaces/<task-id>`
   - runs lifecycle hooks
   - preserves or cleans workspaces according to terminal state

7. `Data Governance Planner`
   - freezes inventory
   - builds category queues
   - maps source evidence, schema issues, reference closure, completeness, and state-code-aware mutation policy

8. `Agent Runner`
   - launches the configured coding/data agent
   - supplies the rendered task prompt
   - streams updates and terminal status

9. `Verification Gate`
   - checks schema, source evidence, reference closure, dry-run output, completeness, and mutation plan
   - blocks unsafe commit

10. `Observability`
   - writes structured logs
   - exposes status snapshots for operators

## 4. Task Lifecycle

```text
Inbox -> Classified -> WorkspaceReady -> Running -> EvidenceReady -> DryRunReady -> ReviewReady -> Done
```

The v0 filesystem implementation materializes the main queue transitions as:

```text
tasks/inbox -> tasks/active -> tasks/review -> tasks/done
```

The orchestrator may stop in `tasks/review` when a task has generated evidence but still has open schema, source/numeric, reference, version, or dry-run gates.

Failure states:

- `Needs Evidence`
- `Blocked`
- `Rework`
- `Cancelled`

## 5. Data Work Stop Conditions

A category or task is not complete until:

- schema blocking issues are zero
- P0/P1 source/numeric findings are resolved or waived with evidence
- account-owned references are closed
- state-code-aware mutation plan is explicit
- insert/versioned writes have reasons
- `state_code=0` repairs prefer update
- `state_code=100` repairs have a source-review path
- dry-run output is present
- completeness snapshot is present
- remote verification passes after any commit

## 6. Non-Goals For v0

- no multi-tenant hosted SaaS
- no direct database mutation without dry-run
- no hidden dashboard-only policy
- no full autonomous commit to production without explicit policy upgrade

## 7. v0 CLI Surface

```bash
npm run init:runtime
npm run workspace:map
npm run orchestrator:once
npm run orchestrator:run
npm run orchestrator:status
npm run tasks:check
```

The first implemented handler is `kind=category-update` plus `category=electricity_system`, which reads a private `LCA-DATA-AGENT` electricity seed work package and writes local-only evidence under `.foundry/workspaces/<task-id>/`.

`workspace:map` is the first read-only registry diagnostic. It records the local workspace submodules, LCA skills, installed runtime skills, CLI roots, and hybrid-search surfaces that future handlers should use through adapters.

## 8. Remote Write Gate

Remote writes are disabled unless every gate below is true:

- local `.env` sets `FOUNDRY_ENABLE_REMOTE_COMMIT=true`
- local `.env` sets `FOUNDRY_SINGLE_RECORD_COMMIT=true`
- local `.env` sets `FOUNDRY_REMOTE_COMMIT_LIMIT=1`
- the task sets `allow_remote_commit=true`
- the candidate has a state-code-aware mutation plan and dry-run input
- insert/versioned writes have explicit reasons
- a dry-run succeeds before commit

For the first database smoke test, use one generated flow candidate from `outputs/single-record-smoke/flow-publish-dry-run-input.jsonl` and run the TianGong CLI with `--limit 1`.

## 9. Workspace Capability Design

The foundry must design against the full local LCA workspace, not only the initial `LCA-DATA-AGENT` artifact package.

Authoritative local references:

- `docs/workspace-project-map.md`
- `specs/workspace-capability-adapters.md`
- workspace `AGENTS.md`
- workspace `.docpact/config.yaml`
- workspace `_docs/reference/workspace-repo-graph.yaml`

Design rule:

- use `tiangong-lca-cli` as the default execution surface
- use `tiangong-lca-skills` as a thin agent-facing wrapper layer
- use `tiangong search ...` or the hybrid-search skills for retrieval
- use Edge Function and database repositories for diagnosis and implementation, not routine foundry runtime shortcuts
- keep `LCA-DATA-AGENT` as a source-artifact adapter until current-account inventory/export is fully CLI-owned
