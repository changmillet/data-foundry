---
title: HiQLCD Required Governance Metadata Gaps
docType: issue-archive
scope: import-profile/hiq
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/hiq/hiq-import-governance-proposal.md
  - docs/import-profiles/hiq/hiq-issue-01-reference-delivery-gaps.md
  - docs/import-profiles/hiq/hiq-issue-03-source-data-labeling-and-normalization.md
  - WORKFLOW.md
---

# HiQLCD Required Governance Metadata Gaps

This archive records information that is required for TIDAS import governance or quality review but cannot be reasonably inferred from the delivered ILCD package. These are data/governance gaps, not reasons to broaden a generic adapter.

## HIQ-GOV-001: Allocation Method And Co-Product Policy Are Not Recoverable

| Field | Detail |
| --- | --- |
| Issue type | Required method/governance metadata missing. |
| Affected objects | All 10 process datasets. The foreground production datasets model the same ethanol-to-1,3-butadiene technology family with different reference products: `丁二烯`, `乙烯`, `丙烯`, `乙醛`, `丁烯`, and `氢气`; there are both one-step and two-step variants plus a market process. |
| Evidence location | Every process `LCIMethodAndAllocation` section contains only `typeOfDataSet` and `LCIMethodPrinciple`; no `LCIMethodApproaches`, allocation factors, or allocation basis are delivered. Examples: `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:29-32`, `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:31-34`, `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:29-32`. |
| Why adapter cannot infer | A parser can read `Attributional` and the reference flow, but it cannot know whether the co-product split is mass, economic, system expansion, cut-off, a pre-allocated openLCA result, or an incorrect duplicate full-burden export. The package has separate process datasets for co-products but no allocation rule connecting them. |
| Who must confirm | Data provider or methodology owner. |
| Where confirmed data should be written | HiQLCD profile constraints and source-manifest/profile-lock; final TIDAS process `LCIMethodAndAllocation` fields or an explicit `common:other` methodology trace only if approved by the profile. |
| Impact | If multiple sibling products are imported as independent unit processes without allocation governance, downstream use may double count the same plant burden. |
| Suggested handling | Ask data provider for allocation method, allocation factors, intended system model, and whether each co-product dataset is already allocated. Do not substitute adapter heuristics. |
| Blocks import? | Yes for process write planning. |

Affected process inventory:

| Process UUID | Process file | Source baseName | Reference flow UUID / name | Method info delivered | Missing confirmation |
| --- | --- | --- | --- | --- | --- |
| `2937aa4a-4339-4534-ade6-9b76cb2caf1c` | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml` | `1,3-丁二烯,两步法` | `a588dec8-0e04-3502-95e8-3492dc4f2263` / `乙烯` | `Attributional`; no allocation approach. | Allocation basis for two-step ethylene co-product. |
| `35f1f2bc-cd0f-4b68-ba01-39b24892cdf2` | `inputs/HIQ-ILCD/processes/35f1f2bc-cd0f-4b68-ba01-39b24892cdf2.xml` | `1,3-丁二烯,一步法` | `119faa04-173d-4110-8379-15f9f0ae2bc7` / `丁烯` | `Attributional`; no allocation approach. | Allocation basis for one-step butene co-product. |
| `51e9f6c0-74af-4e15-b982-d5ec93be5224` | `inputs/HIQ-ILCD/processes/51e9f6c0-74af-4e15-b982-d5ec93be5224.xml` | `1,3-丁二烯,一步法` | `a588dec8-0e04-3502-95e8-3492dc4f2263` / `乙烯` | `Attributional`; no allocation approach. | Allocation basis for one-step ethylene co-product. |
| `55d6ddfa-e306-42a4-b4bc-61cdf7c1e164` | `inputs/HIQ-ILCD/processes/55d6ddfa-e306-42a4-b4bc-61cdf7c1e164.xml` | `1,3-丁二烯,两步法` | `b7e7d46f-740a-3843-8de1-f64a3df9b19b` / `丁二烯` | `Attributional`; no allocation approach. | Allocation basis for two-step main product. |
| `62f3e2ee-ea8d-4c87-9ca2-1c7cc220fcbf` | `inputs/HIQ-ILCD/processes/62f3e2ee-ea8d-4c87-9ca2-1c7cc220fcbf.xml` | `1,3-丁二烯,一步法` | `8ef1a6d8-85eb-3cb0-ac30-396ecab47653` / `丙烯` | `Attributional`; no allocation approach. | Allocation basis for propylene co-product. |
| `6512756f-8582-46f2-b246-fd7f446eae98` | `inputs/HIQ-ILCD/processes/6512756f-8582-46f2-b246-fd7f446eae98.xml` | `1,3-丁二烯,一步法` | `b7e7d46f-740a-3843-8de1-f64a3df9b19b` / `丁二烯` | `Attributional`; no allocation approach. | Allocation basis for one-step main product. |
| `79b93c08-3757-42d4-9512-5fff48b5bf48` | `inputs/HIQ-ILCD/processes/79b93c08-3757-42d4-9512-5fff48b5bf48.xml` | `1,3-丁二烯,一步法` | `a5de7bce-5029-4d33-8f78-255fea6518e0` / `乙醛` | `Attributional`; no allocation approach. | Allocation basis for acetaldehyde co-product. |
| `7a24fac2-aa8e-4c9b-90d9-7d83fc71c068` | `inputs/HIQ-ILCD/processes/7a24fac2-aa8e-4c9b-90d9-7d83fc71c068.xml` | `1,3-丁二烯,两步法` | `119faa04-173d-4110-8379-15f9f0ae2bc7` / `丁烯` | `Attributional`; no allocation approach. | Allocation basis for two-step butene co-product. |
| `826beb40-f152-4dd2-be5f-0788235b1691` | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml` | `1,3-丁二烯,一步法` | `b7e7d46f-740a-3843-8de1-f64a3df9b19b` / `丁二烯` market | `Attributional`; no allocation approach. | Whether market process is a separate consumption-market dataset and how it should link to production/background providers. |
| `9c864d02-025d-46e4-98c3-96ac58cb863b` | `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml` | `1,3-丁二烯,一步法` | `5c34f185-3f50-3913-970d-3eac89bdbf06` / `氢气` | `Attributional`; no allocation approach. | Allocation basis for hydrogen co-product. |

## HIQ-GOV-002: True Source And Fallback Citation Policy Are Missing

| Field | Detail |
| --- | --- |
| Issue type | Required source governance metadata missing; overlaps with reference delivery but is a separate policy blocker. |
| Affected objects | All process rows and any generated source rows. |
| Evidence location | No `sources/` directory; no `referenceToDataSource` elements in process files; narrative source text appears inside comments, e.g. `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:58`. Repeated source UUID text `0eb0c1f6-05aa-4a5a-9599-1d0444b8f640,1.2.0` appears in two-step process comments, e.g. `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:60-63`. |
| Why adapter cannot infer | A converter can preserve comment text, but it cannot decide a legally and methodologically correct source row, citation title, author list, data owner, or fallback citation for the whole package. |
| Who must confirm | Data provider, import owner, or TianGong data governance owner. |
| Where confirmed data should be written | `docs/import-profiles/hiq/` profile/constraints once created; task `source-manifest.json`; generated TIDAS `sources/*.json`; process `referenceToDataSource` after source rows are approved. |
| Impact | Wrong fallback source would misattribute HiQLCD data. Reusing BAFU fallback citation would be incorrect. |
| Suggested handling | Resolve `0eb0c1f6...` remotely first. Ask data provider for source export and citation policy. Only use AI-authored source rows where source comments provide concrete bibliographic evidence and the profile records the authoring rule. |
| Blocks import? | Yes for database write. |

## HIQ-GOV-003: Ownership, Commissioner, And Target Account Are Not Established

| Field | Detail |
| --- | --- |
| Issue type | Required ownership/write-governance metadata missing. |
| Affected objects | All write scopes: process, flow, source, contact, and any generated support rows. |
| Evidence location | Only one contact is delivered: `d76fde52-9e57-3831-9829-85e75ad7ea9b`, with `李昭君` in `xml:lang="en"` fields at `inputs/HIQ-ILCD/contacts/d76fde52-9e57-3831-9829-85e75ad7ea9b.xml:6-7`. Processes reference that contact as data generator and data entry actor, e.g. `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:37` and `:41`. Process publication fields include copyright/license but no target account or commissioner, e.g. `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:43-48`. |
| Why adapter cannot infer | The presence of a personal contact does not establish the legal owner, commissioning organization, intended TianGong account, or whether rows should be public, account-local, draft-only, or imported under a HIQ organization profile. |
| Who must confirm | Import owner and data provider. |
| Where confirmed data should be written | Task account/write guard, `source-manifest.json`, profile-lock, and final commit handoff records. If a canonical HiQLCD contact/source is created, it should be governed as reusable support. |
| Impact | Remote write could attach data to the wrong account or misrepresent ownership. |
| Suggested handling | Ask whether the owner is HiQLCD/HIQ, 李昭君 personally, TianGong, or another organization; ask for the intended target user/account and state-code/write mode. |
| Blocks import? | Yes for remote write. |

## HIQ-GOV-004: Background Provider Mapping Policy Is Undecided

| Field | Detail |
| --- | --- |
| Issue type | Required dependency governance metadata missing. |
| Affected objects | 95 package-external defaultProvider references; see `hiq-issue-01-reference-delivery-gaps.md` for the full provider table. |
| Evidence location | Missing providers include steam `f67a7086-48c1-3a3c-ab44-e06838ca2c8f`, electricity `9cdeaade-e4eb-406c-b64a-5d38fb34854f`, natural gas `c87bafe0-08bd-497e-8c8e-1895e694b72e`, and market transport providers such as `bf17bd7d-b5ef-4468-956d-ea05cc4ab8ee`. First evidence examples are listed in `hiq-issue-01-reference-delivery-gaps.md`. |
| Why adapter cannot infer | UUID equality may work only if the exact background library exists remotely. Otherwise semantic mapping requires target database search and human/AI decisions. A format adapter should not choose substitute background processes silently. |
| Who must confirm | Data governance owner, with data provider input if the provider UUIDs refer to a specific library. |
| Where confirmed data should be written | Manual mapping table or identity-decision artifacts in the task workspace; final process rows should preserve original provider UUID trace and rewritten TianGong references where approved. |
| Impact | Unresolved backgrounds can break reference closure or cause hidden model changes. |
| Suggested handling | Query remote by UUID first. Where absent, build provider mapping decisions for each unique provider UUID and flow context. Externalize unresolved providers only under an explicit profile fallback. |
| Blocks import? | Yes for closed linked import; may be policy-deferred for foreground-only import. |

## HIQ-GOV-005: Natural Gas Reference Unit Is Recoverable But Should Be Confirmed

| Field | Detail |
| --- | --- |
| Issue type | Unit/flow-property governance confirmation; not a generic parser failure. |
| Affected objects | Flow `fffbe9bc-2513-3f84-b5d2-e0d35567f4c6` / `天然气，高压`, used by 9 foreground processes with defaultProvider `c87bafe0-08bd-497e-8c8e-1895e694b72e`. |
| Evidence location | Flow dataset has empty `flowProperties`: `inputs/HIQ-ILCD/flows/fffbe9bc-2513-3f84-b5d2-e0d35567f4c6.xml:34`. Exchanges carry openLCA extension attributes for volume property and m3 unit, e.g. `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:104` uses `olca:propertyId="882ccd76-3f31-45ee-b610-7738597c03a5"` and `olca:unitId="de5b3c87-0e35-4fb0-9765-4f3ba34c99e5"`. Unit `m3` is in `inputs/HIQ-ILCD/unitgroups/93a60a57-a3c8-12da-a746-0800200c9a66.xml:147`. |
| Why adapter cannot infer | The openLCA extension gives a deterministic recovery path for this package, but pure ILCD flow metadata is incomplete. Applying the exchange-level unit as the flow reference unit is a profile/adapter design decision that should be recorded. |
| Who must confirm | Data provider or import owner. |
| Where confirmed data should be written | HiQLCD normalization rule and conversion report; final flow property/unit mapping decision. |
| Impact | Incorrect unit recovery would systematically change natural gas quantities. |
| Suggested handling | Confirm that natural gas amounts are in `m3` and that volume is the intended reference property. If confirmed, handle this in HiQLCD profile normalization or an ILCD adapter's openLCA-extension branch, with explicit trace. |
| Blocks import? | Blocks final quantity governance until confirmed; does not block investigation conversion. |

## HIQ-GOV-006: Freight Transport Unit Mapping Requires Explicit Quantity Policy

| Field | Detail |
| --- | --- |
| Issue type | Unit normalization governance. |
| Affected objects | Market process `826beb40-f152-4dd2-be5f-0788235b1691` transport exchanges for truck, train, ocean/inland shipping. |
| Evidence location | Transport flow property `30e90779-8721-4f1e-bd2a-410d6c938b32` references freight-transport-work at `inputs/HIQ-ILCD/flowproperties/30e90779-8721-4f1e-bd2a-410d6c938b32.xml:5-11`. Unit group `838aaa21-0117-11db-92e3-0800200c9a66` has `metric ton*km` unit ID `2f4daad7-5331-4f14-930c-d8bca924557d` with mean value `1.0` at `inputs/HIQ-ILCD/unitgroups/838aaa21-0117-11db-92e3-0800200c9a66.xml:47-49`, and `kg*km` has mean value `0.001` at `:27-29`. Market exchanges use `olca:unitId="2f4daad7..."`, e.g. `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:51`, `:68`, `:77`, `:86`, `:95`. |
| Why adapter cannot infer | A converter can read source units, but if TIDAS canonical support uses `kg*km`, the amount must be scaled by `1000` from t*km/metric ton*km. That policy belongs in canonical support mapping, not silent generic adapter magic. |
| Who must confirm | Import owner and canonical support owner. |
| Where confirmed data should be written | Canonical support mapping decision, conversion report, and mapping CSV. |
| Impact | Missing the scale factor causes a three-order-of-magnitude error for transport exchanges. |
| Suggested handling | Confirm target canonical unit. If target is `kg*km`, apply `amount * 1000` with explicit mapping evidence. If target keeps `metric ton*km`, preserve amounts and reference the correct canonical unit. |
| Blocks import? | Yes for market process quantity correctness. |

## HIQ-GOV-007: Annual Production Volume Is Mentioned But Not Formally Assigned Per Dataset

| Field | Detail |
| --- | --- |
| Issue type | Required TIDAS process metadata missing/formally ambiguous. |
| Affected objects | Foreground production processes; comments often mention a process design of `200 kt` annual 1,3-butadiene production, but the package does not provide a formal TIDAS annual supply/production field per process/reference product. |
| Evidence location | Example comments: `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:58`; `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:61`. |
| Why adapter cannot infer | The text describes plant design for 1,3-butadiene and may not represent annual supply for each co-product reference flow. Assigning `200 kt/year` to every co-product row would be a methodology choice. |
| Who must confirm | Data provider or methodology owner. |
| Where confirmed data should be written | Process field `annualSupplyOrProductionVolume` or, if not confirmed, Foundry's deterministic missing-data sentinel per repository policy with a profile trace. |
| Impact | TIDAS requires this field. A wrong annual volume would be misleading and hard to repair later. |
| Suggested handling | Ask provider for annual production volume per process/reference flow. If unavailable, use the Foundry sentinel policy only as a searchable missing-data marker, not as a data claim. |
| Blocks import? | Blocks high-quality finalization unless sentinel policy is explicitly accepted for HiQLCD. |
