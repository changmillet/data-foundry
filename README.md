# TianGong LCA Data Foundry

Private project for autonomous TianGong LCA data research, manufacturing, review, repair, and publication workflows.

The project adapts the OpenAI Symphony pattern to LCA data work:

- task intake instead of ad hoc prompts
- per-task isolated workspaces
- repo-owned `WORKFLOW.md` policy
- category-scoped data governance loops
- evidence-first process review
- dry-run and verification gates before database writes

Upstream references:

- https://github.com/openai/symphony
- https://github.com/openai/symphony/blob/main/SPEC.md

## Current Scope

The first domain target is account-level TianGong LCA DATA updates, starting from the `example-account` account governance plan produced in `LCA-DATA-AGENT`.

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
- `tasks/`: filesystem task queue for the first private version.
- `scripts/foundry.mjs`: local workflow/task validation utility.
- `.foundry/`: local-only runtime state, logs, and workspaces.

## Commands

```bash
npm run init:runtime
npm run doctor
npm run workflow:check
npm run tasks:list
npm run tasks:check
```

## Safety Posture

This project is designed for trusted private environments, but remote writes are not automatic in the initial workflow. Data-producing agents must create local repair candidates and dry-run plans before any database publish/import action.
