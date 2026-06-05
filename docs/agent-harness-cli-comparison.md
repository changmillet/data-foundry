---
title: Acceptance Loop Notes
docType: reference
scope: acceptance-loop
status: active
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when checking why Foundry has local acceptance-loop hooks and JSON reports
  - when maintaining the Codex Stop hook or acceptance-check command shape
whenToUpdate:
  - when acceptance-check, Stop hook behavior, or artifact report policy changes
checkPaths:
  - docs/agent-harness-cli-comparison.md
  - docs/file-organization.md
  - docs/codex-stop-hook.md
  - .codex/hooks.json
  - .codex/hooks/run-foundry-acceptance-check.sh
  - scripts/commands/core.mjs
lastReviewedAt: 2026-06-05
lastReviewedCommit: 76830c7adc67126a795f5fdc1c650fe56ac7b5e2
related:
  - docs/file-organization.md
  - docs/codex-stop-hook.md
---

# Acceptance Loop Notes

Foundry keeps a lightweight acceptance loop so agent work is inspectable through artifacts rather than chat summaries.

Useful pattern:

- task-specific contracts live under `specs/acceptance/` when a task needs an explicit artifact checklist;
- deterministic checks write JSON reports under `.foundry/state/`;
- the Codex Stop hook runs `npm run acceptance:check`;
- blocking failures point the agent at concrete missing or inconsistent files.

Run:

```bash
npm run acceptance:check
```

The loop checks `.env.example` policy on every run. Task-specific artifact contracts are optional; when `specs/acceptance/` has no JSON contracts, the acceptance loop only runs repository policy checks.
