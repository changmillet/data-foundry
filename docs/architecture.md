# Architecture

## Layers

1. Policy layer
   - `WORKFLOW.md`
   - task acceptance and stop rules

2. Configuration layer
   - workflow front matter
   - environment indirection
   - default policy values

3. Workspace registry layer
   - local project graph
   - capability catalog
   - source-root and skill-root discovery
   - owner and write-policy boundaries

4. Coordination layer
   - poll loop
   - task eligibility
   - concurrency
   - retry and reconciliation

5. Execution layer
   - per-task workspace
   - hooks
   - agent app-server or CLI subprocess
   - CLI, skill, source-artifact, hybrid-search, schema, and publish adapters

6. Data layer
   - inventory
   - category plan
   - schema/source/reference outputs
   - dry-run and verification artifacts

7. Observability layer
   - structured logs
   - status snapshots
   - task reports

## v0 Runtime

The v0 runtime is intentionally small:

- filesystem task queue
- workflow/task validation script
- read-only workspace map diagnostic
- no persistent database
- no remote commit by default

## v1 Runtime Direction

Add a daemon:

```text
poll tasks -> claim -> create workspace -> launch agent -> collect outputs -> update task state -> verify -> repeat
```

Then add tracker adapters and app-server integration.

## Workspace-Aware Direction

The foundry should call the owning workspace surface instead of absorbing implementation:

- `tiangong-lca-cli`: default command surface for data operations
- `tiangong-lca-skills`: agent-facing wrappers over CLI commands
- `tiangong-lca-edge-functions`: Edge Function runtime, including hybrid search and embedding jobs
- `database-engine`: database RPCs, triggers, vector indexes, and schema governance
- `tidas`, `tidas-sdk`, `tidas-tools`: schema and validation contracts
- `LCA-DATA-AGENT`: read-only source artifacts and historical playbooks until equivalent CLI inventory/export exists

See `docs/workspace-project-map.md` and `specs/workspace-capability-adapters.md` for the routing contract.
