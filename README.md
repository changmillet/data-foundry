# TianGong LCA Data Foundry

Control-plane project for autonomous TianGong LCA data research, manufacturing, review, repair, and publication workflows. It can run in a private operator workspace, but reusable docs, templates, and contracts should stay neutral enough for a future public tool.

The project adapts the OpenAI Symphony pattern to LCA data work:

- task intake instead of ad hoc prompts
- per-task isolated workspaces
- repo-owned `WORKFLOW.md` policy
- category-scoped data governance loops
- evidence-first process review
- dry-run and verification gates before database writes
- remote reference/version readback gates before publish-prep
- state-code-aware mutation plans and completeness snapshots

Upstream references:

- https://github.com/openai/symphony
- https://github.com/openai/symphony/blob/main/SPEC.md

## Current Scope

The first domain target is account-level TianGong LCA DATA updates, starting from a private seed governance package produced in `LCA-DATA-AGENT`.

Personal account names are runtime context, not reusable design concepts. Local operators may set `FOUNDRY_ACCOUNT_LABEL` in `.env` as a non-secret display label, but agents must use the resolved API key/session and frozen manifests as the authority for account scope. See `docs/account-context-policy.md`.

The design target is broader than that initial package: the foundry must route across the local LCA workspace, including `tiangong-lca-cli`, `tiangong-lca-skills`, hybrid search, Edge Functions, database RPCs, TIDAS validation tooling, and domain embedding assets.

The first category queue is:

1. `electricity_system`
2. `energy_fuels`
3. `metals_mining`
4. `agriculture_biomass_food`
5. `chemicals_polymers`
6. `construction_materials`
7. `water_waste_recycling`
8. `transport_logistics`
9. `electronics_equipment_batteries`
10. `other_uncategorized`

## Repository Shape

- `WORKFLOW.md`: Symphony-style runtime contract and agent prompt.
- `specs/`: project-specific service and task specifications.
- `docs/`: architecture, policy, and operating design.
- `docs/file-location-registry.json`: machine-readable record for moved or important file locations.
- `docs/account-context-policy.md`: rule for optional local account labels and public-safe account wording.
- `.codex/hooks.json`: Codex Stop hook registration for foundry acceptance checks.
- `inputs/`: safe repo-visible task inputs, such as sanitized diagnostic reports.
- `docs/workspace-project-map.md`: local workspace project and capability map.
- `wiki/`: repo-local Tiangong Wiki knowledge base and source vault.
- `tasks/`: filesystem task queue for the first private version.
- `scripts/foundry.mjs`: local workflow/task validation utility.
- `.foundry/`: local-only runtime state, logs, and workspaces.

## Commands

```bash
npm run init:runtime
npm run doctor
npm run workspace:map
npm run env:check
npm run workflow:check
npm run storage:check
npm run wiki:build-rulesbook
npm run wiki:init
npm run wiki:doctor
npm run wiki:fts -- "ILCD nomenclature"
npm run orchestrator:once
npm run orchestrator:rerun-review -- --task-id DATA-001
npm run compute-repair:artifacts:check
npm run compute-repair:probe
npm run compute-repair:rerun
npm run account-wide:audit -- --task-id current-profile-account-wide-audit-2026-05-25 --remote-verify-mode skip
npm run sample-scenarios:dry-run
npm run target-datasets:gate-run
npm run post-write:verify
npm run matrix-readiness:verify -- --sample all
npm run matrix-readiness:verify -- --target-gate-report .foundry/workspaces/issue-6-automated-lca-target-datasets/target-dataset-gate-run/target-dataset-gate-report.json --target-sample golden-closed-electricity-mix-cn-hb --provider-scope account-visible --provider-decisions inputs/account-sample-scenarios/provider-decisions/golden-closed-electricity-mix-cn-hb.provider-decisions.jsonl
npm run golden-fixtures:check
npm run capabilities:list
npm run task:route
npm run orchestrator:status
npm run tasks:list
npm run tasks:check
```

## Rulesbook Wiki

`wiki/` is the first foundry-local knowledge base. It follows `@biaoo/tiangong-wiki` and imports the `LCA-DATA-AGENT/inputs/Rulesbook` PDFs into:

- source PDFs under `wiki/vault/Rulesbook/`
- provenance pages under `wiki/pages/source-summaries/`
- fulltext chunks under `wiki/pages/source-fulltext-chunks/`
- a concept entry at `wiki/pages/concepts/foundry-rulesbook-wiki.md`

Run `npm run wiki:build-rulesbook` after refreshing the source PDFs, then `npm run wiki:init` or `npm run wiki:sync` to rebuild the local `wiki/index.db`. The database is derived local state and is intentionally ignored by git.

## Safety Posture

This project is designed for trusted private environments, but remote writes are not automatic in the initial workflow. Data-producing agents must create local repair candidates and dry-run plans before any database publish/import action.

Local `.env` may point to the existing `LCA-DATA-AGENT/.env` through `LCA_DATA_AGENT_ENV_FILE`, but this repository keeps remote commit gates off by default. A single-record database smoke test requires all of these to be explicitly true in local `.env` and task policy:

- `FOUNDRY_ENABLE_REMOTE_COMMIT=true`
- `FOUNDRY_SINGLE_RECORD_COMMIT=true`
- `FOUNDRY_REMOTE_COMMIT_LIMIT=1`
- task-level `allow_remote_commit=true`

Account-level compute repair tasks must also produce a state-code-aware mutation plan, a dry-run result, and a completeness snapshot before any remote write can be considered.

`compute-repair:probe` writes resumable flow metadata progress under the task workspace so a stuck remote batch has a concrete checkpoint and `error_class`.
