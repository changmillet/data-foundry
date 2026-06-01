# TianGong LCA Data Foundry

Control-plane project for autonomous TianGong LCA data import, authoring, review, repair, and publication-prep workflows. It can run in a private operator workspace, but reusable docs, templates, and contracts should stay neutral enough for a future public tool.

The project adapts the OpenAI Symphony pattern to LCA data work:

- task intake instead of ad hoc prompts
- per-task isolated workspaces
- repo-owned `WORKFLOW.md` policy
- packaged LCA import and source-document authoring lanes
- evidence-first process review
- dry-run and verification gates before database writes
- remote reference/version readback gates before publish-prep
- state-code-aware mutation plans and completeness snapshots

Upstream references:

- https://github.com/openai/symphony
- https://github.com/openai/symphony/blob/main/SPEC.md

## Current Scope

The primary scope is importing external source material into validated TIDAS data and preparing it for database import.

Personal account names are runtime context, not reusable design concepts. Local operators may set `FOUNDRY_ACCOUNT_LABEL` in `.env` as a non-secret display label, but agents must use the resolved API key/session and frozen manifests as the authority for account scope. See `docs/account-context-policy.md`.

There are two supported production lanes:

- Packaged LCA datasets supported by `tidas-tools`: convert through the CLI/tools surface, validate as TIDAS, then prepare dry-run database import.
- PDF, Excel, and other source documents: extract source evidence, use target TIDAS contract context packs for AI authoring, validate candidate rows, repair blockers, then prepare dry-run database import.

The foundry must route across the local LCA workspace, including `tiangong-lca-cli`, `tiangong-lca-skills`, `tidas-sdk`, `tidas-tools`, hybrid search, Edge Functions, database RPCs, and domain embedding assets. Shared reusable logic belongs in those owning projects, not in Foundry-local scripts.

## Repository Shape

- `WORKFLOW.md`: Symphony-style runtime contract and agent prompt.
- `specs/`: project-specific service and task specifications.
- `docs/`: architecture, policy, and operating design.
- `docs/file-location-registry.json`: machine-readable record for moved or important file locations.
- `docs/account-context-policy.md`: rule for optional local account labels and public-safe account wording.
- `.codex/hooks.json`: Codex Stop hook registration for foundry acceptance checks.
- `inputs/`: safe repo-visible task inputs, such as source package manifests and document evidence notes.
- `docs/workspace-project-map.md`: local workspace project and capability map.
- `wiki/`: repo-local Tiangong Wiki knowledge base and source vault.
- `tasks/`: filesystem task queue and reusable import task templates.
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
npm run capabilities:list -- --class tidas-contract-context
npm run task:route -- --kind external-dataset-curated-import --required-gates contract,schema
npm run task:route -- --kind source-evidence-dataset-development --required-gates context,schema
npm run orchestrator:once
npm run post-write:verify
npm run orchestrator:status
npm run tasks:list
npm run tasks:check
```

## Rulesbook Wiki

`wiki/` is the foundry-local knowledge base. It follows `@biaoo/tiangong-wiki` and stores source summaries plus full-text chunks that agents can query before authoring or repairing TIDAS data.

Run `npm run wiki:init` or `npm run wiki:sync` to rebuild the local `wiki/index.db`. The database is derived local state and is intentionally ignored by git.

## Safety Posture

This project is designed for trusted private environments, but remote writes are not automatic in the initial workflow. Data-producing agents must create local repair candidates and dry-run plans before any database publish/import action.

A single-record database smoke test requires all of these to be explicitly true in local `.env` and task policy:

- `FOUNDRY_ENABLE_REMOTE_COMMIT=true`
- `FOUNDRY_SINGLE_RECORD_COMMIT=true`
- `FOUNDRY_REMOTE_COMMIT_LIMIT=1`
- task-level `allow_remote_commit=true`

Every import task must produce a contract manifest, validation reports, a state-code-aware mutation plan, a dry-run result, and a completeness snapshot before any remote write can be considered.
