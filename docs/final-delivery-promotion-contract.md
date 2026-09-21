---
title: Final Delivery Promotion Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when promoting a completed local delivery package into immutable reviewer-facing evidence
  - when defining exact row, algebra, workbook, redaction, and independent-review gates
whenToUpdate:
  - when the final-delivery manifest, promotion ledger, report, or detached seal contract changes
checkPaths:
  - docs/final-delivery-promotion-contract.md
  - specs/schemas/final-delivery-manifest.schema.json
  - scripts/commands/final-delivery-promotion.ts
  - scripts/lib/final-delivery-manifest.ts
  - scripts/lib/final-delivery-workbook.ts
  - scripts/lib/final-delivery-rows.ts
  - scripts/lib/final-delivery-algebra.ts
  - scripts/lib/final-delivery-redaction.ts
  - scripts/lib/final-delivery-review.ts
  - scripts/lib/final-delivery-xml.ts
  - scripts/lib/final-delivery-schema.ts
  - test/commands/final-delivery-promotion.test.mts
  - test/unit/final-delivery-workbook.test.mts
  - test/unit/final-delivery-algebra.test.mts
  - test/unit/final-delivery-redaction.test.mts
  - test/fixtures/final-delivery-fixtures.ts
lastReviewedAt: 2026-09-21
lastReviewedCommit: 57abdbc10a860aa5a100a666e9ea692d1c91e092
lastReviewedNote: "Reviewed for Foundry #30 / PR #41 at 57abdbc: the offline final-delivery validator binds exact artifact content, strict text/XML parsing, redaction and independent review; it grants no execution-capsule or public-runtime authority. Current module, environment and test boundaries remain valid."
---

# Final Delivery Promotion Contract

`final-delivery-promote` is a Foundry-owned, workflow-internal offline gate. It validates one completed local delivery package and writes immutable promotion evidence. It does not create or alter the delivery artifacts, access a network or database, dispatch another CLI, perform a mutation, or grant production authority.

## Module ownership

The gate is split by owner so no single module carries the whole contract:

| Module | Owns |
| --- | --- |
| `scripts/commands/final-delivery-promotion.ts` | the `workflow-internal` command, check orchestration, exclusive snapshot/ledger/report/seal emission |
| `scripts/lib/final-delivery-manifest.ts` | schema/ledger/report/seal identifiers, stable hashing, path confinement, exclusive writes, the PASS/FAIL check collector |
| `scripts/lib/final-delivery-workbook.ts` | the bounded ZIP reader and OOXML workbook/sheet/cell interpretation |
| `scripts/lib/final-delivery-rows.ts` | the declared row contracts (JSON object / object-with-rows / array / JSONL / CSV / XLSX / none) and JSON Pointer resolution |
| `scripts/lib/final-delivery-algebra.ts` | declarative cross-artifact numeric evaluation |
| `scripts/lib/final-delivery-redaction.ts` | credential, user-absolute-path, and forbidden-literal scanning plus coverage closure |
| `scripts/lib/final-delivery-review.ts` | independent-reviewer identity, PASS disposition, and content-bound coverage |
| `scripts/lib/final-delivery-xml.ts` | the bounded, namespace-aware XML reader used for every OOXML part |
| `scripts/lib/final-delivery-schema.ts` | real Ajv validation of the manifest against its published schema |
| `scripts/lib/stage-contract.ts` | the shared read-only stage contract reused by every offline gate |

`scripts/lib/final-delivery-*` never imports a command owner, so the library stays below the command layer and adds no cycle.

## Relationship to execution authorization

A final-delivery seal and an execution-authorization capsule are different objects and are deliberately not unified:

- `execution-capsule-admit` (see `docs/execution-capsule-contract.md`) packages staged evidence, models an unconsumed attempt, and binds a producer/consumer boundary that a later owner may execute.
- `final-delivery-promote` validates already-produced delivery artifacts and seals the _validation result_. It declares no consumer, no argv, no attempt, and no dispatchable boundary, and it never marks a workbook or any other artifact as an executable input.

They share hashing, file-safety, and independent-reviewer expectations because those are general evidence rules. `final-delivery-promote` reuses `scripts/lib/stage-contract.ts` for its stage pipeline and adds no task ledger, attempt model, or second authority surface of its own.

## Fast path

Prepare a `foundry-final-delivery-manifest.v1` file and run:

```bash
node scripts/foundry.ts final-delivery-promote \
  --manifest .foundry/workspaces/<task-id>/final-delivery/final-delivery-manifest.json \
  --out-dir .foundry/workspaces/<task-id>/final-delivery-promotion/revision-0001
```

Both paths must remain inside the repository. The manifest and every declared artifact must be regular, non-symlink files. The output directory must not already exist. A correction uses a fresh output directory; prior snapshots, ledgers, reports, and seals are never overwritten.

The manifest schema is `specs/schemas/final-delivery-manifest.schema.json`. The command validates the same safety-critical constraints at runtime and fails closed when the manifest or an artifact cannot be parsed.

## Promotion requirements

One promotion pass checks all of these:

- offline-only mode, `production_authority=false`, and declared `P0=0` / `P1=0`;
- unique, confined artifact identities and paths with exact SHA-256, byte count, schema, and row count;
- JSON object, JSON object-with-rows, JSON array, JSONL, CSV, XLSX, and explicit no-row artifact contracts;
- declarative numeric algebra over literal values, artifact row counts, JSON pointers, and sums;
- exact XLSX sheet names and order, required headers, required control cells, and aggregate data-row counts;
- bounded ZIP/XLSX parsing that rejects encryption, unsafe paths, duplicate entries, unsupported compression, and decompression limits;
- complete redaction coverage of every textual/workbook artifact for credentials, user-specific absolute paths, and manifest-declared forbidden literals;
- the manifest actually satisfying `specs/schemas/final-delivery-manifest.schema.json` under a strict Ajv 2020 validator, in addition to declaring the right `schema_version` string;
- a real namespace-aware XML parse of every OOXML part, rejecting malformed XML, undeclared prefixes, DTD/DOCTYPE declarations and any parser error, and never treating comments or CDATA as elements;
- XML bytes held to the same strict UTF-8 contract as any other text artifact, so an undecodable byte is rejected rather than substituted with U+FFFD and parsed as markup;
- element and attribute lookup that is namespace-consistent at every level, not only at the root: a foreign-namespace `sheets`/`sheet` or attribute is never read as OOXML, unqualified OOXML attributes must be in no namespace, and a sheet relationship id must be in exactly the office-document relationship namespace;
- rich-text shared and inline strings reconstructed from their runs in document order, with phonetic `<rPh>` annotation excluded because it is not the cell's main text — a literal split across runs is still reassembled, so it cannot hide from the scan;
- relationship `TargetMode` honoured: an external relationship is never resolved as a local package part, and the office-document relationship type must equal the standard URI exactly rather than merely ending with it;
- content-bound independent reviewer reports whose reviewer differs from the producer, reports `PASS` with zero P0/P1 findings, and individually binds every required artifact to the exact SHA-256 and byte count it reviewed;
- algebra operands that resolve to explicit finite numbers only, with every sum step checked for finiteness and safe range, so a missing value or an overflow can never satisfy a check;
- redaction scanning of **every** declared artifact, with decoded JSON keys **and** values and decoded CSV cells scanned alongside the raw bytes, and a non-text artifact failing closed rather than being claimed as fully scanned;
- every XML and relationships part of a workbook strictly parsed and scanned through its **decoded** text and attribute values, so an entity-escaped literal is visible; text that is not a cell's body value — phonetic annotation, a shared string no cell references — is still shipped content and is scanned rather than skipped.

## Supported text contract

A textual artifact (`json-object`, `json-object-rows`, `json-array`, `jsonl`, `csv`, `none`) must be strict UTF-8 with no unsupported control byte: tab, newline and carriage return are the only control characters permitted. Silent replacement is not acceptable — content that does not decode is rejected rather than scanned as different text. There is no content-type sniffing: the supported encodings and formats are exactly those declared here, and anything else fails closed.

A `none` row contract describes row shape only and can never weaken scanning. Its bytes are decoded and scanned under the same contract, and content that happens to be JSON or JSONL is parsed so the scan is never weaker than it would be under the matching explicit row contract.

## Reviewer report contract

A reviewer report artifact must carry a `reviewed_artifacts` array. Each entry binds one artifact by `artifact_id`, `sha256` and `bytes` — the exact values the reviewer saw:

```json
{
  "reviewer_id": "independent-reviewer",
  "status": "PASS",
  "findings": { "p0": 0, "p1": 0 },
  "reviewed_artifacts": [
    { "artifact_id": "summary", "sha256": "…", "bytes": 512 },
    { "artifact_id": "evidence", "sha256": "…", "bytes": 2048 }
  ]
}
```

The gate re-derives those values from the bytes the manifest currently binds and requires an exact match, so a report reviewed against an earlier revision of the package cannot promote a later one.

**Every** binding the report declares is verified, not only the required ones: a stale or wrong digest on a voluntarily-included artifact is still a false claim. `required_artifact_ids` sets the minimum coverage, not the set to verify. Each required artifact must be bound exactly once; unknown identities, duplicates, malformed entries, and a reviewer binding its own report are all rejected. Excluding the reviewer's own report keeps the binding acyclic — the report never has to hash itself.

The package is promoted only when every ledger row passes. Any validation failure produces a rejected report and no seal.

## Outputs and authority boundary

Every parseable invocation writes into the fresh output directory:

- `final-delivery-manifest-snapshot.json` — exact input manifest bytes;
- `final-delivery-promotion-ledger.jsonl` — machine-readable PASS/FAIL rows;
- `final-delivery-promotion-report.json` — reader-facing summary, artifact census, findings, and zero-dispatch counters.

A fully passing invocation also writes `final-delivery-promotion-seal.json`. The detached seal binds the source manifest SHA-256, sorted artifact set, manifest snapshot, ledger, report, zero findings, and zero effects.

Failure reporting is bounded and content-safe. Parse failures carry a stable category code from a fixed vocabulary (`workbook_zip_*`, `workbook_sheet_invalid`, `artifact_json_invalid`, `artifact_text_encoding_invalid`, `artifact_control_byte`, `xml_*`, …) rather than a parser message, and schema violations are reported as an Ajv keyword plus an instance location.

The manifest is scanned through its **decoded** content, so an escaped key or value cannot hide a literal from the manifest check. The declared `redaction.forbidden_literals` are applied to that scan, but the declaring field itself is excluded from the scan target: declaring a literal is the contract and must not self-report, while reusing that literal anywhere else in the manifest is a leak.

No free text from the manifest or from an artifact is echoed into the ledger or the reader-facing report. An unparseable manifest is recorded as a stable category, never as a parser message, because a parser message can carry a fragment of the manifest. Workbook failures are localised by sheet ordinal, counts and SHA-256 digests of the expected and actual sets, with the first differing ordinal named; a control cell keeps only its A1 reference, a match flag and digests. A label (artifact id, path, schema, reviewer id, delivery id) is emitted verbatim only when it carries no credential-shaped or forbidden content, and is otherwise replaced by a stable ordinal and a digest — so a failure report stays navigable without becoming a second copy of a secret. A digest can never be forged to contain a secret because SHA-256 output is fixed hex.

The seal is delivery-promotion evidence only. `production_authority` is always `false`. Publication, deployment, owner-session creation, remote write/readback, and database semantics remain owned by their existing CLI, release, and database surfaces.

## Package independence

The command contains no account, project, dataset, campaign, workbook filename, sheet name, or expected denominator. All delivery-specific expectations are declared in the content-addressed manifest. A producer may therefore apply the same gate to any final-delivery package that satisfies the schema without changing Foundry code.
