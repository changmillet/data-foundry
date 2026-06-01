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
