---
title: Agent Harness CLI Comparison
docType: design-note
scope: repository
status: active
owner: tiangong-lca-data-foundry
source:
  - https://github.com/Biaoo/agent-harness-cli
---

# Agent Harness CLI Comparison

This note compares `Biaoo/agent-harness-cli` with the current foundry design and records the useful ideas adopted into this repository.

## External Design Summary

`agent-harness-cli` focuses on artifact acceptance loops for AI-agent work. Its core shape is:

```text
task.json + project-owned check commands + report store + paginated report viewer
```

Important design points:

- the harness CLI is thin;
- domain logic stays in workspace-owned check scripts;
- checks emit structured JSON;
- deterministic checks are preferred before model-assisted judgment;
- warning checks guide agents while error checks block handoff;
- Stop hooks can turn blocking failures into the next agent continuation prompt.

## Difference From Foundry

Foundry is a data-governance control plane, not a generic artifact harness.

| Area | `agent-harness-cli` | data foundry |
| --- | --- | --- |
| Primary unit | artifact contract | LCA data repair task |
| Runtime shape | task JSON plus check commands | filesystem task queue plus per-task workspace |
| Domain logic | external check scripts | foundry policies plus TianGong CLI/skills/calculator adapters |
| Reports | check report store and paginated viewer | workspace audit, closure, mutation, dry-run, verification reports |
| Stop hook | optional Codex continuation loop | currently manual/CLI-driven gate loop |
| Data safety | generic artifact checks | state_code policy, evidence-first repair, dry-run gates, private-data handling |

## Adopted Ideas

Foundry should not import a separate agent runtime for LCA data governance, but these ideas are directly useful:

1. Artifact contracts should be explicit and machine-readable.
2. Narrow deterministic checks should run before claiming a task is ready.
3. Checks should produce structured reasons with file paths and suggested fixes.
4. Severity should distinguish guidance from blocking handoff failures.
5. Failed checks should become the next repair prompt.

## Repo-Native Adoption

The foundry now keeps a repo-native acceptance contract for the current compute repair task:

- `specs/acceptance/lca-compute-repair-20260510.artifacts.json`

The foundry runner can check it without adding a new dependency:

```bash
npm run compute-repair:artifacts:check
```

The first adopted check is file placement:

```bash
npm run storage:check
```

The contract runner also supports JSON assertions over produced artifacts and writes a continuation prompt next to the structured report:

```bash
npm run acceptance:check
```

The Codex Stop hook is wired in:

- `.codex/hooks.json`
- `.codex/hooks/run-foundry-acceptance-check.sh`

When Codex tries to stop, the hook runs `npm run acceptance:check`. Passing checks allow the turn to finish. Blocking failures are translated into a Codex Stop hook response with `decision: "block"` and a continuation prompt that points at the generated acceptance report.

This keeps the useful harness idea while preserving foundry's domain boundary: LCA-specific repair logic stays in foundry and adjacent TianGong tooling; the acceptance contract records what artifacts must exist, where they live, and which deterministic output fields must be present before handoff.
