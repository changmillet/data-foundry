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
lastReviewedAt: 2026-10-08
lastReviewedCommit: d07ac492a3a5891502039a6cc83ef30b9fbba50b
lastReviewedNote: "Reviewed Foundry #237 exact three-field 0.1.16 to 0.1.17 release projection from eligible PR236 Main d07ac492; CLI/native pins, lock closure, authorization and all business source remain unchanged. Official publication and final managed qualification remain pending."
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
