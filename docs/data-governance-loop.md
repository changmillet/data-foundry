# Data Governance Loop

The data foundry loop is inherited from the current `example-account` account governance plan.

```text
snapshot -> category map -> schema scan -> source/numeric review -> reference closure -> repair candidates -> version bump plan -> dry-run publish/import -> remote verify -> repeat
```

## Inputs

- account identity
- dataset tables and scope
- category profile
- source evidence rules
- schema validators
- reference resolution rules
- write policy

## Outputs

- tracked account map
- full local artifact snapshot
- category update plan
- schema issue worklist
- source evidence and numeric findings
- reference closure findings
- repair candidates
- version bump plan
- dry-run result
- verification report

## First Production-Like Queue

Start with the `example-account` category plan:

1. electricity system
2. energy fuels
3. metals and mining
4. agriculture, biomass, and food
5. chemicals and polymers
6. construction materials
7. water, waste, and recycling
8. transport and logistics
9. electronics, equipment, and batteries
10. uncategorized

## Default Rule

An agent may propose data repairs, but it must not publish them directly unless the task and `WORKFLOW.md` policy allow remote commit.

