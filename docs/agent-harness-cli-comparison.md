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
  - scripts/commands/core.ts
lastReviewedAt: 2026-10-11
lastReviewedCommit: baaa384e1db47fb53eb29f7b3764e448510aeff1
lastReviewedNote: "Reviewed final existing-output capture verification on the working delta based on baaa384e. Current writer/runtime/job/profile and source/input checks run before, between and after two fresh output reads; an independent P2 report-before-capture late-drift repro is fixed, including a caught error returning previously written JSON. New receipt publication reloads current writer/Task/runtime and preserves final input verification; ordinary bytewriters, cached replay, sorted depth-first roster, index CAS and authority/science remain unchanged. Focused59/59 and wholeadoption23/23 pass; latejob2RED->2GREEN and retainedCLI first/second/caught negatives are recorded. No cross-operation hash cache or filesystem-wide atomicity claim. baaa preparation remained unused,87bd Native19/20 failed history remains preserved; new full Source/emitted/installed/native qualification is pending. No originalDATA requery/default034/science/release change."
related:
  - docs/file-organization.md
  - docs/codex-stop-hook.md
---

# Acceptance Loop Notes

Foundry keeps a lightweight acceptance loop so agent work is inspectable through artifacts rather than chat summaries.

Useful pattern:

- task-specific contracts live under `specs/acceptance/` when a task needs an explicit artifact checklist;
- deterministic checks write JSON reports under `.foundry/state/`;
- the Codex Stop hook runs `pnpm acceptance:check`;
- blocking failures point the agent at concrete missing or inconsistent files.

The pnpm/TS7 migration extends the same evidence model: `pnpm test:toolchain` checks the single lock/compiler graph and permanent compatibility ratchets, while a clean arbitrary-worktree run proves the project did not borrow dependencies, credentials, or ignored runtime state from the developer checkout. Issue #70 additionally proves exact CLI 0.1.3 public batch/auth consumption without changing acceptance-loop authority or artifact locations.

`scripts/commands/core.ts` owns the local acceptance aggregation invoked by the existing package script. Its TypeScript migration preserves workflow, storage, environment and surface-check order plus the same `.foundry/state/acceptance/latest.json` artifact; it does not change Stop-hook registration or introduce a remote check.

Run:

```bash
pnpm acceptance:check
```

The loop checks `.env.example` policy on every run. Task-specific artifact contracts are optional; when `specs/acceptance/` has no JSON contracts, the acceptance loop only runs repository policy checks.
