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

4. `Workspace Manager`
   - creates `.foundry/workspaces/<task-id>`
   - runs lifecycle hooks
   - preserves or cleans workspaces according to terminal state

5. `Data Governance Planner`
   - freezes inventory
   - builds category queues
   - maps source evidence, schema issues, reference closure, and version policy

6. `Agent Runner`
   - launches the configured coding/data agent
   - supplies the rendered task prompt
   - streams updates and terminal status

7. `Verification Gate`
   - checks schema, source evidence, reference closure, dry-run output, and version bump plan
   - blocks unsafe commit

8. `Observability`
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
- version bump plan is explicit
- dry-run output is present
- remote verification passes after any commit

## 6. Non-Goals For v0

- no multi-tenant hosted SaaS
- no direct database mutation without dry-run
- no hidden dashboard-only policy
- no full autonomous commit to production without explicit policy upgrade

## 7. v0 CLI Surface

```bash
npm run init:runtime
npm run orchestrator:once
npm run orchestrator:run
npm run orchestrator:status
npm run tasks:check
```

The first implemented handler is `kind=category-update` plus `category=electricity_system`, which reads the current `LCA-DATA-AGENT` example-account electricity work package and writes local-only evidence under `.foundry/workspaces/<task-id>/`.
