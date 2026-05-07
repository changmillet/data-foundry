# Architecture

## Layers

1. Policy layer
   - `WORKFLOW.md`
   - task acceptance and stop rules

2. Configuration layer
   - workflow front matter
   - environment indirection
   - default policy values

3. Coordination layer
   - poll loop
   - task eligibility
   - concurrency
   - retry and reconciliation

4. Execution layer
   - per-task workspace
   - hooks
   - agent app-server or CLI subprocess

5. Data layer
   - inventory
   - category plan
   - schema/source/reference outputs
   - dry-run and verification artifacts

6. Observability layer
   - structured logs
   - status snapshots
   - task reports

## v0 Runtime

The v0 runtime is intentionally small:

- filesystem task queue
- workflow/task validation script
- no persistent database
- no remote commit by default

## v1 Runtime Direction

Add a daemon:

```text
poll tasks -> claim -> create workspace -> launch agent -> collect outputs -> update task state -> verify -> repeat
```

Then add tracker adapters and app-server integration.

