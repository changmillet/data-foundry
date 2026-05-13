---
title: Account Context Policy
docType: policy
scope: runtime-account-context
status: active
owner: tiangong-lca-data-foundry
---

# Account Context Policy

Foundry must not hard-code a personal TianGong account name in reusable docs, templates, mutation plans, or public-facing reports.

## Runtime Account Authority

The authoritative runtime scope is the resolved credential/session and the frozen dataset manifest.

`FOUNDRY_ACCOUNT_LABEL` is optional and non-secret. It exists only as a human display label when one operator has multiple local credentials and wants reports to show which local credential set was intended.

Agents must not use the display label to decide:

- which account was read;
- which records are safe to mutate;
- whether remote commit is allowed;
- whether a dry-run or verification gate passed.

Those decisions must come from credentials, source manifests, task policy, mutation plans, dry-run results, and verification artifacts.

## Private vs Public Surfaces

Private operator runs may set `FOUNDRY_ACCOUNT_LABEL` in local `.env`.

Public or reusable project surfaces should use neutral language such as:

- credential-scoped account;
- current credentials;
- configured runtime account;
- resolved TianGong session;
- account label, when explicitly referring to the optional display field.

Personal account names may appear only when they are part of a historical source artifact path or a private local task seed. In that case, document them as source artifact labels, not as general product concepts.

## Requiredness

The account label is not required for AI execution.

It can be required for a human-operated local run by setting:

```env
FOUNDRY_ACCOUNT_LABEL_REQUIRED_FOR_HUMANS=true
```

Even then, missing or mismatched labels must block only human-orientation workflows. They must not be treated as proof of data ownership or write eligibility.
