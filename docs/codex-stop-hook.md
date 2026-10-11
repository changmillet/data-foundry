---
title: Codex Stop Hook
docType: runbook
scope: repository
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when diagnosing or updating the repository-local Codex Stop hook
  - when checking which acceptance command blocks task completion
whenToUpdate:
  - when Stop-hook registration, command invocation, output, or recursion behavior changes
checkPaths:
  - docs/codex-stop-hook.md
  - docs/agent-harness-cli-comparison.md
  - .codex/hooks.json
  - .codex/hooks/run-foundry-acceptance-check.sh
  - package.json
  - scripts/commands/core.ts
lastReviewedAt: 2026-10-11
lastReviewedCommit: baaa384e1db47fb53eb29f7b3764e448510aeff1
lastReviewedNote: "Reviewed final existing-output capture verification on the working delta based on baaa384e. Current writer/runtime/job/profile and source/input checks run before, between and after two fresh output reads; an independent P2 report-before-capture late-drift repro is fixed, including a caught error returning previously written JSON. New receipt publication reloads current writer/Task/runtime and preserves final input verification; ordinary bytewriters, cached replay, sorted depth-first roster, index CAS and authority/science remain unchanged. Focused59/59 and wholeadoption23/23 pass; latejob2RED->2GREEN and retainedCLI first/second/caught negatives are recorded. No cross-operation hash cache or filesystem-wide atomicity claim. baaa preparation remained unused,87bd Native19/20 failed history remains preserved; new full Source/emitted/installed/native qualification is pending. No originalDATA requery/default034/science/release change."
---

# Codex Stop Hook

Foundry uses a repository-local Codex Stop hook to prevent an agent turn from finishing when required acceptance artifacts are missing or inconsistent.

## Files

- `.codex/hooks.json`: registers the Stop hook.
- `.codex/hooks/run-foundry-acceptance-check.sh`: runs the foundry acceptance check and translates failures into a Codex continuation decision.

## Behavior

When Codex attempts to stop:

1. the hook runs `pnpm acceptance:check`;
2. if checks pass, the hook exits without output and the turn may finish;
3. if checks fail, the hook prints JSON:

```json
{
  "decision": "block",
  "reason": "Foundry acceptance checks found blocking failures..."
}
```

For Stop hooks this means the agent should continue with the `reason` as the next prompt, repair the concrete artifacts, and rerun the acceptance check before finishing.

## Runtime Outputs

The hook writes ignored runtime files under `.foundry/state/`:

- `.foundry/state/hooks/foundry-acceptance.summary.txt`
- `.foundry/state/hooks/last-stop-hook-event.json`
- `.foundry/state/acceptance/latest.json`
- `.foundry/state/acceptance/continuation-prompt.md`

These files are local runtime evidence and should not be committed.

## Manual Debugging

```bash
pnpm acceptance:check
bash .codex/hooks/run-foundry-acceptance-check.sh
```

The hook has a recursion guard through `FOUNDRY_ACCEPTANCE_HOOK_ACTIVE=1`.
