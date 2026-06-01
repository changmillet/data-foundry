# AGENTS.md - TianGong LCA Data Foundry

This repository is the orchestration layer for autonomous TianGong LCA data import and TIDAS authoring work.

## Mission

Build an AI-operable data foundry that can receive external LCA packages or source documents, choose the right import lane, produce evidence-backed TIDAS data, and continue iterating until the task reaches a verified terminal state.

Humans should mostly manage policy, credentials, and final release posture. Agents should manage source intake, contract-context collection, conversion or authoring artifacts, review, repair candidates, dry-run plans, verification, and work logs.

## Boundaries

- Do not store API keys, access tokens, `.env`, database dumps, or full private payload exports in git.
- Do not hard-code a personal account name as reusable task scope. Use `FOUNDRY_ACCOUNT_LABEL` only as an optional, non-secret human display label; credential/session resolution and frozen manifests are authoritative for AI execution.
- Runtime state belongs under `.foundry/` and is ignored.
- Source-of-truth task policy belongs in `WORKFLOW.md`.
- Project-level specifications belong in `specs/`.
- Reusable operating knowledge belongs in `docs/`.
- Repo-local background knowledge and imported source corpora belong in `wiki/`.
- Task queue files belong in `tasks/`.
- Do not implement raw database writes without an explicit dry-run and verification gate.

## Default Operating Order

1. Read this file.
2. Read `WORKFLOW.md`.
3. Apply the fast-path routing rules below before broad repository search.
4. Read the relevant task file under `tasks/`, when the task came from the file queue.
5. Read `specs/data-foundry-service.md`, unless a fast path below gives a narrower required-doc list.
6. If the task needs LCA method background, ILCD naming conventions, or product-carbon-footprint factor database guidance, query `wiki/` first.
7. If the task is data import or source-document authoring, read `specs/workspace-capability-adapters.md` and the matching task template under `tasks/templates/`.
8. Run `npm run doctor` before trusting local commands. Treat it as a local health check, not as the way to discover the workflow.

## Fast Path: Data Import Production

Use this path before generic task discovery when the user asks to import, update, author, write, or verify LCA data from external source material.

There are two primary lanes:

- `external-dataset-curated-import`: packaged LCA data that can be converted through `tidas-tools` or a CLI wrapper.
- `source-evidence-dataset-development`: PDF, Excel, web page, image, free text, or other source material that must be authored into TIDAS candidate rows.

For both lanes, fetch the target TIDAS contract before AI authoring or repair:

```bash
tiangong-lca dataset context-pack \
  --type <process|flow|source|contact|unitgroup|flowproperty|lifecyclemodel> \
  --profile ai-import \
  --out-dir .foundry/workspaces/<task-id>/context/<type> \
  --json
```

When the task says to use the latest local CLI, make sure the sibling `../tiangong-lca-cli` install and build are fresh before invoking `bin/tiangong-lca.js`: run `npm install` if `package.json` / `package-lock.json` changed or dependency versions are stale, then run `npm run build` after local source changes, or use the source entrypoint `node --import tsx src/main.ts ...` for diagnostics. Do not silently use stale `node_modules/` or `dist/` artifacts.

For packaged LCA imports, use deterministic conversion first. AI may repair conversion gaps or schema blockers with the contract context pack, but it must not replace a converter for formats already supported by `tidas-tools`.

For PDF/Excel/source-document authoring, extract evidence first, then generate candidate rows with the contract context pack. Candidate rows must pass schema validation before they can enter mutation planning.

Import-ready rows are source-language rows. Do not run bilingual extract/apply/validate or generate extra multilingual text before database import; multilingual completion is a separate post-import workflow.

Do not present old runtime reports, stale `.foundry` artifacts, or prior write/readback reports as current proof. Current proof must come from the task workspace's contract manifest, validation reports, mutation plan, dry-run report, and verification artifacts.

## Commit Rules

Keep commits small and thematic. Do not commit `.foundry/`, `.env`, logs, workspace clones, or downloaded account payloads.
