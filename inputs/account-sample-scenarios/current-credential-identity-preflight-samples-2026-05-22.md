---
title: Current Credential Identity Preflight Sample Scenarios
docType: test-sample-input
scope: account-sample-scenarios
status: active
owner: tiangong-lca-data-foundry
created_at_utc: 2026-05-22T11:44:51Z
source_scope: current authenticated TianGong credentials
privacy: sanitized row identifiers and metadata summaries only; no full private payload export
related_issue: https://github.com/tiangong-lca/data-foundry/issues/3
---

# Current Credential Identity Preflight Sample Scenarios

This file records a small, safe sample index for future automated LCA data-generation tests.
The operator request named a personal account, but the reusable foundry scope is the current
authenticated credential/session. Do not treat the display account label as proof of ownership
or write eligibility.

Full process and flow payload snapshots are intentionally not tracked. The local runtime
snapshot used to curate these rows was written under:

```text
.foundry/workspaces/issue-3/account-sample-scenarios/
```

## Source Queries

The sample set was selected from these query classes:

| Query class | Command shape | Rows observed |
| --- | --- | ---: |
| Current credential draft processes | `tiangong-lca process list --user-id <resolved-current-user-id> --state-code 0 --limit 10 --json` | 10 |
| Visible published processes | `tiangong-lca process list --state-code 100 --limit 10 --json` | 10 |
| Current credential draft flows | `tiangong-lca flow list --user-id <resolved-current-user-id> --state-code 0 --limit 10 --json` | 10 |
| Visible published product flows | `tiangong-lca flow list --state-code 100 --type-of-dataset "Product flow" --limit 10 --json` | 10 |
| Visible published elementary flows | `tiangong-lca flow list --state-code 100 --type-of-dataset "Elementary flow" --limit 10 --json` | 10 |

## Samples

| Sample ID | Dataset | Row reference | State | Safe name summary | Scenario | Future test expectation |
| --- | --- | --- | ---: | --- | --- | --- |
| `process-current-draft-pv-cn` | process | `44cb413e-71af-30ac-b73f-f26e8a7925b0@00.00.001` | 0 | `3kWp facade installation, multi-Si, laminated, integrated, at building {CN}` | Current-credential draft process for a PV installation in China. | Process generation must detect the current draft candidate and prefer update/reuse over inserting another canonical duplicate. |
| `process-visible-published-electrolyte` | process | `78b28ae3-5a27-4a5a-a3c3-10d116744073@01.01.000` | 100 | `Electrolyte, lithium-ion battery` | Published visible chemical process with specific production route metadata. | Process preflight must not overwrite a published row; it should reuse, block, or require an explicit new-version decision. |
| `process-visible-same-name-wind-turbines` | process group | `a62055c9-887f-4df9-9851-462285418caa@01.01.000`; `62d244e5-5dfd-4c29-a322-44a995426573@01.01.001` | 100 | `Manufacturing of wind turbines` | Same English base name appears on distinct published process rows with different technical/geographic context. | Duplicate checks must not match on name alone; route, geography, technology, and version context must be compared before deciding reuse. |
| `flow-current-draft-reference-pv-cn` | flow | `190f39ca-0ec8-5aab-b2d9-c91fc55ee58d@00.00.001` | 0 | `3kWp facade installation, multi-Si, laminated, integrated, at building {CN}` | Current-credential draft flow that can act as a reference-flow candidate for the matching PV process. | Process auto-build must close the reference flow against existing current-account flows before creating a new flow. |
| `flow-visible-product-fec` | flow | `75782613-d4dc-429b-a477-ab3a7bdfecaf@01.01.000` | 100 | `Fluoroethylene carbonate`; CAS `114435-02-8` | Published product flow with chemical identity, route, and synonym metadata. | Flow preflight should use product-flow identity fields such as base name, CAS, synonyms, route, and flow property; published rows are not draft overwrite targets. |
| `flow-visible-elementary-basic-violet` | flow | `0ce4c692-7497-41ae-b630-97f9722eee16@03.00.004` | 100 | `basic violet 2`; CAS `8004-87-3` | Published elementary flow selected through the `Elementary flow` filter. | Provider-process closure must exclude elementary flows from product-flow/provider matching while still allowing them as valid elementary exchange references. |

## Intended Coverage

These samples intentionally cover:

- current credential draft rows (`state_code = 0`);
- published visible rows (`state_code = 100`);
- process and flow identity preflight;
- name collision / disambiguation behavior;
- current-account reference-flow closure;
- product-flow versus elementary-flow handling.

When a later test needs full source payloads, re-fetch them from the current credential/session into
an ignored `.foundry/workspaces/<task-id>/` directory and keep only sanitized summaries in git.
