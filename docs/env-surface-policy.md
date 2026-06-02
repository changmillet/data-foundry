---
title: Environment Surface Policy
docType: policy
scope: runtime-env
status: active
owner: tiangong-lca-data-foundry
---

# Environment Surface Policy

Foundry `.env.example` is a public runtime contract, not a mirror of every adjacent repository environment variable.

## Allowed Variables

Only document variables that meet at least one of these conditions:

- foundry reads the variable directly;
- foundry passes the variable to a public `tiangong` CLI command as part of the documented runtime contract;
- foundry uses the variable to locate an adjacent workspace repository or local skill root;
- foundry uses the variable as an explicit local-only safety gate.

Allowed families:

- `FOUNDRY_*` for foundry-owned gates, paths, labels, and observability controls;
- public `TIANGONG_LCA_API_*`, session, QA LLM, KB search, and unstructured-document runtime keys used by CLI-backed workflows;
- `LCA_DATA_AGENT_*`, `TIANGONG_LCA_CLI_BIN`, `TIANGONG_LCA_CLI_DIR`, `TIANGONG_LCA_SKILLS_ROOT`, and `LCA_SKILLS_ROOT` path indirection keys.

## Forbidden Variables

Do not add adjacent-repo internal test or quality toggles to foundry `.env.example`.

Examples that must stay out of foundry:

- `TIANGONG_LCA_COVERAGE`
- `TIANGONG_LCA_TIDAS_SDK_DIR`
- generic `SUPABASE_URL` / `SUPABASE_KEY`
- tracker secrets such as `LINEAR_API_KEY` / `GITHUB_TOKEN`
- operator-specific source pointers such as `SOURCE_REPO_URL`

If a new variable is only needed by `tiangong-lca-cli` tests, `tiangong-lca-skills` validation, CI, or a private operator workflow, document it in the owning project or local `.env`, not here.

## Ownership Rule

When a variable is needed by more than one project, record the owner before documenting it:

- foundry-owned orchestration and safety gates live here;
- CLI runtime variables should be public CLI contract variables, not CLI internal test controls;
- skills should consume CLI variables through wrapper contracts and should not introduce database credentials or private transport variables;
- private operator convenience variables stay in local `.env` and must not become reusable project examples.

## Automatic Check

`npm run env:check` validates `.env.example` against the allowlist and forbidden-key list in `scripts/foundry.mjs`.

The same env-surface check is included in `npm run acceptance:check`, so the Codex Stop hook can block future automatic runs when an internal variable is accidentally promoted into foundry's public env example.
