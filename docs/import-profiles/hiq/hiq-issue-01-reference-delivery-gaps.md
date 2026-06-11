---
title: HiQLCD ILCD Reference Delivery Gaps
docType: issue-archive
scope: import-profile/hiq
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/hiq/hiq-import-governance-proposal.md
  - docs/import-profiles/hiq/hiq-issue-02-required-governance-metadata-gaps.md
  - docs/import-profiles/hiq/hiq-issue-03-source-data-labeling-and-normalization.md
  - docs/import-profiles/bafu/profile.md
  - WORKFLOW.md
---

# HiQLCD ILCD Reference Delivery Gaps

This archive records delivery-closure problems in `inputs/HIQ-ILCD`. It intentionally separates package reference gaps from tidas-tools capabilities such as ILCD adapter support, writer multilingual output, classification passthrough, or process-bundle generation.

Current package shape:

- `processes`: 10 XML files.
- `flows`: 4,332 XML files.
- `flowproperties`: 8 XML files.
- `unitgroups`: 7 XML files.
- `contacts`: 1 XML file.
- `sources`: missing; no `inputs/HIQ-ILCD/sources/` directory is delivered.
- `lciamethods`: 762 XML files, apparently sidecar LCIA method exports rather than process import closure.

The 121 process exchange flow references are locally closed: they reference 21 unique flow datasets, and every referenced flow exists under `inputs/HIQ-ILCD/flows/`. The reference delivery problem is therefore not "the ILCD parser cannot read exchanges"; the hard gaps are missing source datasets and missing background providers.

## HIQ-REF-001: Missing True Source Dataset Delivery

| Field | Detail |
| --- | --- |
| Issue type | Reference delivery gap; true source rows are absent. |
| Affected objects | All 10 process datasets need true source attribution before TIDAS write planning. Three two-step process datasets additionally carry repeated inline source UUID hints for `0eb0c1f6-05aa-4a5a-9599-1d0444b8f640`, version `1.2.0`. |
| Evidence location | `inputs/HIQ-ILCD/sources/` is absent. Two-step source UUID hint examples: `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:60`, `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:63`, `inputs/HIQ-ILCD/processes/55d6ddfa-e306-42a4-b4bc-61cdf7c1e164.xml:62`, `inputs/HIQ-ILCD/processes/55d6ddfa-e306-42a4-b4bc-61cdf7c1e164.xml:75`. Generic source hints without source dataset rows appear in comments such as `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:58`. |
| Impact | Foundry `WORKFLOW.md` stage 17 requires source rows to be true reports, publications, or traceable source records. A generated placeholder such as `ILCD format` is not acceptable as process `referenceToDataSource`. |
| Suggested handling | First query remote/source registry for source UUID `0eb0c1f6-05aa-4a5a-9599-1d0444b8f640` version `1.2.0`. In parallel ask the data provider to deliver the missing `sources/` export or an openLCA JSON-LD export. If neither is available, author source rows from explicit literature citations only where the process comments provide enough bibliographic evidence. Use any database-level fallback only after a HiQLCD profile policy defines the fallback citation and its scope. |
| Blocks import? | Yes for final database write. Conversion can continue as an investigation artifact, but process write planning should remain blocked until true-source strategy is resolved. |

Two-step process source UUID hint inventory:

| Process UUID | Process file | Reference flow | Source hint occurrences | Evidence examples | Resolution path |
| --- | --- | --- | --: | --- | --- |
| `2937aa4a-4339-4534-ade6-9b76cb2caf1c` | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml` | `a588dec8-0e04-3502-95e8-3492dc4f2263` / `乙烯` | 41 | `:60-63`, repeated through `:198` | Remote query for `0eb0c1f6...`; provider补包; if absent, source authoring from visible citation text plus data-provider confirmation. |
| `55d6ddfa-e306-42a4-b4bc-61cdf7c1e164` | `inputs/HIQ-ILCD/processes/55d6ddfa-e306-42a4-b4bc-61cdf7c1e164.xml` | `b7e7d46f-740a-3843-8de1-f64a3df9b19b` / `丁二烯` | 41 | `:60-62`, `:72-75`, repeated through `:198` | Same as above. |
| `7a24fac2-aa8e-4c9b-90d9-7d83fc71c068` | `inputs/HIQ-ILCD/processes/7a24fac2-aa8e-4c9b-90d9-7d83fc71c068.xml` | `119faa04-173d-4110-8379-15f9f0ae2bc7` / `丁烯` | 41 | `:60-62`, `:72-75`, repeated through `:198` | Same as above. |

Processes without a formal source dataset row:

| Process UUID | Process file | Reference flow | Evidence | Suggested handling | Blocks import? |
| --- | --- | --- | --- | --- | --- |
| `2937aa4a-4339-4534-ade6-9b76cb2caf1c` | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml` | `乙烯` | Inline `0eb0c1f6...` source hints at `:60-63` and repeated exchange comments. | Remote query or provider补包 first; only then author/fallback. | Yes |
| `35f1f2bc-cd0f-4b68-ba01-39b24892cdf2` | `inputs/HIQ-ILCD/processes/35f1f2bc-cd0f-4b68-ba01-39b24892cdf2.xml` | `丁烯` | Narrative literature text, e.g. `:58`, but no `referenceToDataSource` row. | Data provider/source row required; author from literature only after citation confirmation. | Yes |
| `51e9f6c0-74af-4e15-b982-d5ec93be5224` | `inputs/HIQ-ILCD/processes/51e9f6c0-74af-4e15-b982-d5ec93be5224.xml` | `乙烯` | Narrative literature text, e.g. `:58`, but no source dataset. | Same. | Yes |
| `55d6ddfa-e306-42a4-b4bc-61cdf7c1e164` | `inputs/HIQ-ILCD/processes/55d6ddfa-e306-42a4-b4bc-61cdf7c1e164.xml` | `丁二烯` | Inline `0eb0c1f6...` source hints at `:62`, `:75`, etc. | Same. | Yes |
| `62f3e2ee-ea8d-4c87-9ca2-1c7cc220fcbf` | `inputs/HIQ-ILCD/processes/62f3e2ee-ea8d-4c87-9ca2-1c7cc220fcbf.xml` | `丙烯` | Narrative literature text, e.g. `:58`, but no source dataset. | Same. | Yes |
| `6512756f-8582-46f2-b246-fd7f446eae98` | `inputs/HIQ-ILCD/processes/6512756f-8582-46f2-b246-fd7f446eae98.xml` | `丁二烯` | Narrative literature text; no source dataset. | Same. | Yes |
| `79b93c08-3757-42d4-9512-5fff48b5bf48` | `inputs/HIQ-ILCD/processes/79b93c08-3757-42d4-9512-5fff48b5bf48.xml` | `乙醛` | Narrative literature text; no source dataset. | Same. | Yes |
| `7a24fac2-aa8e-4c9b-90d9-7d83fc71c068` | `inputs/HIQ-ILCD/processes/7a24fac2-aa8e-4c9b-90d9-7d83fc71c068.xml` | `丁烯` | Inline `0eb0c1f6...` source hints; no source dataset. | Same. | Yes |
| `826beb40-f152-4dd2-be5f-0788235b1691` | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml` | `丁二烯` market process | Market narrative at `:9-12`; no process-specific literature source dataset and no fallback source definition. | Ask provider for market source/transport assumptions; fallback policy is not enough unless the profile explicitly authorizes it. | Yes |
| `9c864d02-025d-46e4-98c3-96ac58cb863b` | `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml` | `氢气` | Narrative literature text at `:58` and other exchange comments; no source dataset. | Same. | Yes |

## HIQ-REF-002: Background Default Providers Are Mostly Not Delivered

| Field | Detail |
| --- | --- |
| Issue type | Reference delivery gap; background process/default provider references point outside the package. |
| Affected objects | 96 `olca:defaultProvider` attributes across process exchanges; 95 point to 13 unique provider UUIDs that are not delivered under `inputs/HIQ-ILCD/processes/`. |
| Evidence location | Examples: `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:53` for steam provider `f67a7086-48c1-3a3c-ab44-e06838ca2c8f`; `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:104` for natural gas provider `c87bafe0-08bd-497e-8c8e-1895e694b72e`; `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:51` for truck transport provider `bf17bd7d-b5ef-4468-956d-ea05cc4ab8ee`. |
| Impact | The package represents foreground unit processes plus provider pointers to missing background processes. A closed process import cannot silently treat those provider UUIDs as local processes. |
| Suggested handling | Query remote TianGong/openLCA source by provider UUID where available; otherwise create a manual background mapping table from source flow/provider UUID to existing TianGong process/flow identities. If provider identities cannot be resolved, preserve them as unresolved external provider trace and keep affected process scopes blocked or policy-deferred. |
| Blocks import? | Blocks closed, fully linked process import. A profile may allow foreground-only import with unresolved provider trace, but that is a deliberate fallback policy, not adapter behavior. |

Missing default provider inventory:

| Missing provider UUID | Provider flow | Occurrences | Affected process scope | First evidence | Suggested handling | Blocks import? |
| --- | --- | --: | --- | --- | --- | --- |
| `f67a7086-48c1-3a3c-ab44-e06838ca2c8f` | `bd20be8e-9b7a-4391-980f-4ecf8f2867be` / `steam, in chemical industry` | 27 | 9 foreground processes | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:53` | Remote query or manual mapping to TianGong steam background. | Yes unless externalized by policy |
| `00b6b9d7-1e59-3caf-a658-7c8d4e1c723f` | `9c5b9099-11e9-4a60-af91-c0346cdf9395` / `cooling energy` | 9 | 9 foreground processes | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:177` | Remote query or manual mapping. | Yes unless externalized |
| `163aa45e-a68a-37ad-a347-46e269d7ea59` | `16303e09-077e-4532-98c2-95fae1eb66fb` / `N,N-dimethylformamide` | 9 | 9 foreground processes | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:164` | Remote query or manual mapping. | Yes unless externalized |
| `1c3b4948-d5be-451e-800e-ae4034186b98` | `fc2bb0dc-b80c-4eae-b0a1-a9c162d5d03c` / `生活污水，平均` | 9 | 9 foreground processes | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:66` | Remote query or map to wastewater treatment background. | Yes unless externalized |
| `666481ba-eb6a-3b87-ab38-94b7667510ed` | `2be73167-58e8-4706-a68f-167c80df9f72` / `chemical, organic` | 9 | 9 foreground processes | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:125` | Remote query or manual mapping. | Yes unless externalized |
| `9cdeaade-e4eb-406c-b64a-5d38fb34854f` | `3fca3a42-df18-4d82-bd05-4ef9a2563fb3` / `电力，中压` | 9 | 9 foreground processes | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:189` | Remote query or map to China medium-voltage electricity background. | Yes unless externalized |
| `9fd2953a-8ab9-37b3-9552-54b89aa0630a` | `3a0d77a5-6488-4977-966a-731350be864a` / ethanol, 99.7% from ethylene | 9 | 9 foreground processes | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:138` | Remote query or manual ethanol background mapping. | Yes unless externalized |
| `c87bafe0-08bd-497e-8c8e-1895e694b72e` | `fffbe9bc-2513-3f84-b5d2-e0d35567f4c6` / `天然气，高压` | 9 | 9 foreground processes | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:151` | Remote query or map to natural gas background. Confirm unit handling in `hiq-issue-02`. | Yes unless externalized |
| `3f7986a0-d35c-49b5-8c1b-5d31ecd2704c` | `d44c5057-123e-4a6e-be8f-fd7887c8cf71` / ocean container ship transport | 1 | market process `826beb40...` | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:68` | Remote query or transport background mapping. | Yes unless externalized |
| `bf17bd7d-b5ef-4468-956d-ea05cc4ab8ee` | `0f05cd98-33f4-4cc0-94bc-4b462933216e` / truck freight transport | 1 | market process `826beb40...` | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:51` | Remote query or transport background mapping. | Yes unless externalized |
| `d64890f9-f23d-44b6-ad63-8ecce97b230e` | `fa34fb13-f5af-4b6a-b6f2-3c43f4537494` / inland dry bulk ship transport | 1 | market process `826beb40...` | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:86` | Remote query or transport background mapping. | Yes unless externalized |
| `f261120c-e3ac-4a4a-a3f1-49af67ba38ea` | `aa50073b-b265-4a9c-b311-25c463d46c1f` / train freight transport | 1 | market process `826beb40...` | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:95` | Remote query or transport background mapping. | Yes unless externalized |
| `ff3d18dd-15a1-47c1-92f6-ede8882d93a2` | `9901a423-7396-47d4-9bb2-92f0a55d7422` / ocean dry bulk ship transport | 1 | market process `826beb40...` | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:77` | Remote query or transport background mapping. | Yes unless externalized |

Delivered local provider exception:

| Provider UUID | Used by | Evidence | Interpretation |
| --- | --- | --- | --- |
| `6512756f-8582-46f2-b246-fd7f446eae98` | Market process `826beb40-f152-4dd2-be5f-0788235b1691` consumes `丁二烯` from local foreground production. | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:104` and local file `inputs/HIQ-ILCD/processes/6512756f-8582-46f2-b246-fd7f446eae98.xml`. | This one default provider is locally delivered and can be linked after identity/source governance is resolved. |

## HIQ-REF-003: LCIA Methods And Unreferenced Flows Are Sidecar Payload, Not Process Closure

| Field | Detail |
| --- | --- |
| Issue type | Package normalization/cropping issue; not a missing-reference blocker. |
| Affected objects | 762 `lciamethods/*.xml` files and 4,311 flow datasets that are not referenced by the 10 process exchange lists. |
| Evidence location | LCIA method count under `inputs/HIQ-ILCD/lciamethods/`; example LCIA method `inputs/HIQ-ILCD/lciamethods/a49af9c2-63a4-3df3-be18-06685c6bd216.xml:1-33`. The process exchange closure uses 21 unique flow UUIDs, leaving 4,311 unreferenced flows. |
| Impact | Importing the entire directory naively would pull LCIA method sidecars and thousands of unused elementary flows into the task scope, inflating curation and identity work without improving the 10 process closures. |
| Suggested handling | Use process-reachable cropping for HiQLCD import workspaces: keep the 10 processes, their 21 referenced flows, required flow properties/unit groups/contacts, and source/provider trace. Retain the full package as immutable source evidence, but do not treat sidecar LCIA methods or unreferenced flows as import-ready support dependencies. |
| Blocks import? | No. This is a scope-control requirement for normalization, not a data-delivery blocker. |
