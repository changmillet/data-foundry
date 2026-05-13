# Account-Level Repair Cycle Specification

Status: Draft v0

Purpose: Define the repeatable account-level data repair cycle used when an LCA compute task fails because the target process graph cannot produce a stable matrix.

## 1. Runtime Loop

The account repair loop is:

```text
audit -> evidence review -> repair candidate -> mutation plan -> dry-run -> completeness snapshot -> verification / follow-up
```

The foundry owns orchestration, traceability, output layout, and gate reconciliation. Domain commands should stay in the owning project surface, normally `tiangong-lca-cli` first and `tiangong-lca-skills` as a thin wrapper second.

## 2. Hard Invariants

Every run must preserve:

- traceability: every proposed repair has field path, old value, new value or unresolved status, source, derivation, confidence, and reviewer note
- transparency: unit processes, exchanges, flows, reference-flow links, assumptions, and lifecycle connections remain inspectable
- completeness tracking: every cycle writes a completeness snapshot in JSON and markdown
- evidence-first numeric repair: no `meanValue` or semantic numeric value is marked verified without source evidence or explicit unresolved status
- state_code-aware mutation policy: write type is decided from record state and source ownership
- dry-run before remote write: remote mutation is blocked until dry-run and verification gates pass
- reference-flow closure status for all exchanges: missing links cannot be hidden behind aggregate fixes
- no fabricated execution results: unavailable DB, KB, web, dry-run, or compute steps are recorded as blocked
- no unsafe remote writes or private source leakage

## 3. State Code Write Policy

For `state_code=0`, prefer `update` on the existing account-owned working record after evidence, validation, mutation-plan, dry-run, and verification gates pass. Ordinary account repair must not create meaningless duplicate versions.

Use `insert` or a new version only with an explicit reason, such as public-library-derived content, immutable/published records, cross-account sharing rules, or semantic preservation of the old record.

For `state_code=100`, do not overwrite. Trace the source through KB, documents, web, or source fields, create a source-review record, and only generate a repair candidate when evidence is sufficient.

For missing or ambiguous `state_code`, stop at dry-run, create a follow-up task, and block remote commit.

## 4. Reference-Flow Closure Status

Every target exchange must receive one status:

- `closed`
- `closed_by_existing_process`
- `closed_by_proxy`
- `excluded_elementary_flow`
- `missing_reference_process`
- `missing_flow`
- `flow_metadata_missing`
- `ambiguous_flow_match`
- `unit_mismatch`
- `dimension_mismatch`
- `excluded_by_cutoff`
- `excluded_by_boundary`
- `manual_review_required`

Elementary flows are not product-system provider links and must not be resolved by searching for a process whose reference flow provides them. The closure checker must first classify each exchange flow by `typeOfDataSet`; `Elementary flow` exchanges receive `excluded_elementary_flow` and are excluded from the non-elementary reference-flow closure denominator. If the referenced flow metadata cannot be loaded, use `flow_metadata_missing` instead of assuming that the exchange needs a provider process. Only confirmed non-elementary exchange flows, such as product or waste flows, require provider reference-flow process lookup.

Before proposing a new flow or process for non-elementary exchanges, search existing flows and processes, compare synonyms and naming variants, verify category, unit, and dimension, and avoid creating duplicates. Proxy, cutoff, market, and boundary assumptions must record modeling rationale.

## 5. Evidence Record

A repair evidence record must include:

- record type, record id, version, and account/dataset scope
- field path
- old value and new/proposed value, if any
- unit and dimension, if applicable
- source and source type
- source location: URL, KB id, document id, page, table, section, or local artifact path
- derivation method when transformed
- confidence
- reviewer note
- unresolved status when evidence is insufficient

Evidence priority:

1. primary source documents
2. official statistics or official technical reports
3. peer-reviewed literature
4. trusted LCA databases or public datasets
5. KB records with source trail
6. transparent engineering estimate
7. unresolved placeholder

## 6. Completeness Snapshot

A completeness snapshot must track at least:

- total processes
- total exchanges
- distinct exchange flows
- exchange flows covered by reference-flow process
- missing reference-flow processes
- ambiguous flow matches
- missing or duplicate flows
- unresolved `meanValue` evidence
- unresolved unit/dimension mismatches
- state_code=0 records updated/proposed
- state_code=100 records requiring source review
- matrix readiness status
- compute validation status
- blockers
- generated follow-up tasks

Use `specs/schemas/completeness-snapshot.schema.json` for the minimum machine-readable shape.

## 7. Mutation Plan

A mutation plan is required before dry-run or remote commit. It must include:

- record type, id, version, and account/dataset scope
- current `state_code`
- proposed mutation type: `update`, `insert`, `skip`, `manual-review`, or `follow-up`
- fields affected
- old values and new values
- evidence references
- reason
- expected impact on reference closure
- risk level
- dry-run status
- `remote_commit_allowed`
- gate status

Use `specs/schemas/mutation-plan.schema.json` for the minimum machine-readable shape.

## 8. Output Layout

Account repair workspaces should use these local-only directories:

- `input-freeze/`
- `audit/`
- `evidence/`
- `repair-candidates/`
- `mutation-plan/`
- `dry-run/`
- `verification/`
- `reports/`
- `follow-ups/`

Tracked task files should only contain summaries and pointers. Private payload snapshots, logs, and source documents stay under ignored runtime paths or private source roots.

## 9. Follow-Up Generation

Create follow-up task records when any required capability is missing:

- database access or env configuration
- process-exchange-flow export
- reference-flow closure checker
- completeness snapshot generator
- KB or web evidence search
- source manifest generator
- dry-run update command
- matrix readiness verifier
- compute validation command
- state_code mutation validator

Each follow-up must name the blocker, expected output, owning project, suggested implementation location, and done criteria.
