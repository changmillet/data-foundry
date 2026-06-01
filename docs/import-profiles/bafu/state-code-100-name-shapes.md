---
title: BAFU-Visible State Code 100 Name Shapes
docType: import-reference
scope: bafu
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/bafu/constraints.md
  - docs/import-profiles/bafu/profile.md
---

# BAFU-Visible State Code 100 Name Shapes

This note records the observed name/display field shapes from TianGong open datasets visible through the BAFU account. It is used only as platform-shape evidence for import authoring; it does not mean BAFU may overwrite these public rows.

Query evidence:

- Account profile: BAFU guarded account.
- Filter: `state_code=100`, no `user_id` filter. A `user_id=bafu` filter returned zero rows, so these are BAFU-account-visible public examples rather than BAFU-owned open rows.
- Sample time: 2026-05-31 UTC.

Observed row counts visible from the account:

| Table | Visible `state_code=100` count | Primary name/display shape |
|---|---:|---|
| `sources` | 1432 | `sourceDataSet.sourceInformation.dataSetInformation.common:shortName` |
| `contacts` | 372 | `contactDataSet.contactInformation.dataSetInformation.common:name` and `common:shortName` |
| `unitgroups` | 14 | `unitGroupDataSet.unitGroupInformation.dataSetInformation.common:name` |
| `flowproperties` | 105 | `flowPropertyDataSet.flowPropertiesInformation.dataSetInformation.common:name` |
| `lifecyclemodels` | 25 | `lifeCycleModelDataSet.lifeCycleModelInformation.dataSetInformation.name.*` four-part name |
| `flows` | 103351 | `flowDataSet.flowInformation.dataSetInformation.name.*` four-part name |
| `processes` | 2086 | `processDataSet.processInformation.dataSetInformation.name.*` four-part name |
| `lciamethods` | 0 | No open examples visible; use TIDAS schema: `LCIAMethodDataSet.LCIAMethodInformation.dataSetInformation.common:name` and optional `common:shortName` |

Authoring implications:

- Flow, process, and lifecycle model rows use the structured four-part name plan: `baseName`, `treatmentStandardsRoutes`, `mixAndLocationTypes`, and optional `functionalUnitFlowProperties`.
- Source rows should not be forced into four-part names. The source display identity is `common:shortName`; source description/comment fields remain source-language descriptive fields.
- Contact rows use `common:name` and `common:shortName`. Address, central contact point, and contact description remain source-language descriptive fields, not name-plan fields.
- Unit group rows use `common:name`.
- Flow property rows use `common:name`; the schema key is `flowPropertiesInformation`, plural.
- LCIA method rows have no visible public sample in this account; use the TIDAS schema shape until a public example is available.

Workflow implication:

- `tiangong-lca dataset name-plan extract/apply/validate` must be run for owned support rows as well as flow/process/lifecyclemodel rows.
- Support-row drafts must return only the fields listed by each unit's `target_name_fields`; they must not invent flow/process `baseName` or route/mix fields.
