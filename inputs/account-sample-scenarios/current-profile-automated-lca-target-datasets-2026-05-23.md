---
title: Current Profile Automated LCA Target Dataset Selection
docType: test-sample-input
scope: account-sample-scenarios
status: active
owner: tiangong-lca-data-foundry
created_at_utc: 2026-05-23T06:50:00Z
source_scope: "local LCA account runner profile `example-account`; credential authority is the resolved TianGong session, not the display label"
privacy: sanitized row identifiers, validation results, and metadata summaries only; no full private payload export
---

# Current Profile Automated LCA Target Dataset Selection

This file records the dataset candidates selected from the locally locked `example-account`
runner profile for automated LCA data-production development.

All remote reads for this selection used:

```bash
node scripts/with-lca-account.mjs example-account -- node ../tiangong-lca-cli/bin/tiangong-lca.js ...
```

The current conversation account lock is local-only:

```text
.foundry/state/current-conversation-account.json
```

Full process/flow payloads and command outputs are intentionally not tracked. The local runtime
snapshot for this selection is under:

```text
.foundry/workspaces/example-account-dataset-selection-2026-05-23/
```

## Source Queries

| Query class | Rows observed |
| --- | ---: |
| Current-profile draft processes, modified order | 30 |
| Current-profile draft processes, id order | 30 |
| Current-profile published processes | 0 |
| Current-profile draft flows | 50 |
| Current-profile draft product flows | 50 |
| Current-profile draft elementary flows | 30 |
| Current-profile published product flows | 30 |
| Visible published product flows | 30 |
| Visible published elementary flows | 30 |

Local validation over the de-duplicated candidate pool found:

| Candidate pool | Total | Valid | Invalid | Gate |
| --- | ---: | ---: | ---: | --- |
| process candidates | 60 | 8 | 52 | `dataset validate --type process` |
| flow candidates | 170 | 25 | 145 | `dataset validate --type flow` |
| reference flows for valid process candidates | 8 | 4 | 4 | `dataset validate --type flow` |

## Recommended Test Set

| Sample ID | Dataset | Row reference | State | Role | Why selected |
| --- | --- | --- | ---: | --- | --- |
| `golden-closed-electricity-mix-cn-hb` | process + reference flow | process `012fc8f6-9a30-4d98-9b03-34ddec3a6f10@01.01.002`; flow `890a70b7-b677-4e2a-8a1b-7d017e0a10ae@01.01.004` | 0 | Best current full-chain target | Both process and reference flow pass schema. Process review completes. The process has six exchanges, clear geography (`CN-HB`), year (`2019`), quantitative reference, and natural bilingual electricity-mix wording. |
| `process-quality-hydropower-run-of-river` | process | `784fa283-86d2-413c-b105-48bb0de71a42@01.01.003` | 0 | Process-level quality benchmark | Process passes schema and process review, with good boundary text for run-of-river hydropower and eight exchanges. Its source-specific reference flow does not pass flow schema, so this is not the full-chain golden sample. |
| `semantic-rich-lcd-monitor-repair` | process + published flow | process `001e8cc4-afa3-4c8d-b8a8-002cce923d35@01.01.000`; flow `0f14f2f1-768f-44cd-b5d7-b81ecbe1a9b8@01.01.000` | process 0; flow 100 | High-semantic repair target | Bilingual field quality and source evidence are strong, but process schema fails because several exchange English `generalComment` fields exceed 500 characters. Use it to test evidence compression without losing meaning. |
| `flow-product-chemical-fec` | flow | `75782613-d4dc-429b-a477-ab3a7bdfecaf@01.01.000` | 100 | Published product-flow identity target | Published product flow with CAS `114435-02-8`, route, and bilingual chemical naming. Use for flow identity/reuse tests; never overwrite directly. |
| `flow-product-battery-electrolyte` | flow | `ce35d414-44d1-4bcd-931b-816c827c99a3@01.01.000` | 100 | Published domain flow target | Valid published product flow in the lithium-battery domain. Useful for product-flow governance and route-level identity matching. |
| `negative-provider-language-mixed` | process | `00328390-cfb3-53c2-9bc1-e127c8bc79e6@01.01.001` | 0 | Bilingual/schema negative | Provider proxy process fails schema because English fields contain Chinese. Use to ensure automated generation does not produce mixed-language names or reference descriptions. |
| `negative-long-exchange-comments` | process | `0028d8ae-f5d7-4377-91ea-9de418822ea9@01.01.000` | 0 | Evidence-length negative | Schema fails on overlong exchange `generalComment` fields. Use to test deterministic length caps and AI-assisted summarization. |
| `pv-installation-repair-candidate` | process + reference flow | process `179478ba-2be8-4852-87f7-9efabc215db7@01.01.002`; flow `b3ec83c5-2127-54ba-ac09-17134bd838fe@01.01.000` | 0 | PV-domain repair candidate | Process passes schema and has appropriate Chinese wording for PV transport/installation. Its reference flow fails flow schema on a language-tag issue, so it is a repair candidate rather than the target golden sample. |

## Final Target Choice

Use `golden-closed-electricity-mix-cn-hb` as the current target-quality dataset for end-to-end
automated LCA data-production tests.

Rationale:

- the process row passes `ProcessSchema`;
- the reference flow row passes `FlowSchema`;
- the process reference flow is closed to an existing current-profile flow;
- bilingual names, general comment, technology description, geography, time, and quantitative reference are present;
- the domain is common enough to exercise process/flow reuse, electricity mix semantics, and provider closure without relying on one-off product assumptions.

Use `process-quality-hydropower-run-of-river` as the best process-only quality benchmark. It is
more descriptive than the final full-chain target, but the paired source-specific flow currently
needs language-tag repair before it can serve as a full process+flow golden sample.

Use `semantic-rich-lcd-monitor-repair` as the high-quality semantic target for schema-compliant
evidence compression. It should not be treated as final target data until the overlong exchange
comments are repaired and revalidated.

## Validation Evidence

Local validation artifacts are in:

```text
.foundry/workspaces/example-account-dataset-selection-2026-05-23/validation/
.foundry/workspaces/example-account-dataset-selection-2026-05-23/review/
```

Key commands:

```bash
node scripts/with-lca-account.mjs example-account -- node ../tiangong-lca-cli/bin/tiangong-lca.js dataset validate --input .foundry/workspaces/example-account-dataset-selection-2026-05-23/selected/target-electricity-mix-cn-hb-process.jsonl --type process --out-dir .foundry/workspaces/example-account-dataset-selection-2026-05-23/validation/target-electricity-mix-cn-hb-process --json
node scripts/with-lca-account.mjs example-account -- node ../tiangong-lca-cli/bin/tiangong-lca.js dataset validate --input .foundry/workspaces/example-account-dataset-selection-2026-05-23/selected/target-electricity-mix-cn-hb-flow.jsonl --type flow --out-dir .foundry/workspaces/example-account-dataset-selection-2026-05-23/validation/target-electricity-mix-cn-hb-flow --json
node scripts/with-lca-account.mjs example-account -- node ../tiangong-lca-cli/bin/tiangong-lca.js review process --rows-file .foundry/workspaces/example-account-dataset-selection-2026-05-23/selected/target-electricity-mix-cn-hb-process.jsonl --out-dir .foundry/workspaces/example-account-dataset-selection-2026-05-23/review/target-electricity-mix-cn-hb-process --json
```

The previously discussed facade PV sample (`44cb413e-71af-30ac-b73f-f26e8a7925b0@00.00.001`)
was not reused here because exact `process get` did not resolve it under the locked current profile.
