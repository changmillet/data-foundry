# Data Import Loop

Foundry now centers on importing external source material into TIDAS data.

```text
source intake -> contract context -> conversion or source extraction -> AI repair/authoring -> schema/QA gates -> dry-run publish/import -> verification / follow-up
```

## Inputs

- source package manifest or source document note
- target TIDAS dataset type
- SDK-backed schema, methodology YAML, and runtime ruleset context
- source evidence requirements
- write policy and allowed remote mode

## Outputs

- contract context manifest
- conversion report or source extraction report
- candidate TIDAS rows
- validation and QA findings
- repair queue or explicit blocker report
- mutation/publish dry-run plan
- completeness snapshot
- verification or readback report when remote writes are explicitly allowed

## Default Rule

An agent may propose data repairs and candidate rows, but it must not publish them directly unless the task and `WORKFLOW.md` policy allow remote commit.

## Dataset Construction Principles

### Traceability

Record the source of every factual value, including documents, tables, reports, web pages, conversion traces, and transformation assumptions.

If a value is inferred or normalized, record the transformation and the evidence boundary.

### Transparency

Keep unresolved assumptions explicit. Do not silently convert weak evidence into final data.

### Validation

Candidate rows must pass TIDAS schema validation, semantic QA, reference closure, and dry-run publish/import gates before they can be considered ready.
