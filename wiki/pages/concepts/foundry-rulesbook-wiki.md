---
pageType: "concept"
title: "Foundry Rulesbook Wiki"
nodeId: "foundry-rulesbook-wiki"
status: "active"
visibility: "private"
sourceRefs:
  - "source-summaries/rulesbook-corpus.md"
  - "source-summaries/ilcd-handbook-general-guide-detailed-guidance-2010.md"
  - "source-summaries/ilcd-handbook-nomenclature-conventions-2010.md"
  - "source-summaries/product-carbon-footprint-factor-database-guide.md"
relatedPages:
  - "source-summaries/rulesbook-corpus.md"
  - "source-summaries/ilcd-handbook-general-guide-detailed-guidance-2010.md"
  - "source-summaries/ilcd-handbook-nomenclature-conventions-2010.md"
  - "source-summaries/product-carbon-footprint-factor-database-guide.md"
tags:
  - "foundry"
  - "rulesbook"
  - "wiki"
  - "lca"
  - "knowledge-base"
createdAt: "2026-05-14"
updatedAt: "2026-05-14"
confidence: "medium"
masteryLevel: "medium"
prerequisites: []
---

## Definition

Foundry Rulesbook Wiki is the repo-local Tiangong Wiki knowledge layer that turns the LCA Rulesbook PDFs into queryable source summaries and indexed fulltext chunks for TianGong LCA Data Foundry tasks.

## Prerequisites

Use it from the foundry repository root with the npm `wiki:*` commands. The wiki stores Markdown as source of truth and derives `wiki/index.db` through `tiangong-wiki sync`.

## Formal Specification

- Source PDFs live under `wiki/vault/Rulesbook/`.
- Provenance pages use `pageType: source-summary`.
- Extracted source text uses `pageType: source-fulltext-chunk` and stores chunk text in the `fullText` field for FTS indexing.
- `wiki/index.db` is a derived local index and should be rebuilt with `npm run wiki:sync`.
- Future PDF refreshes should run `npm run wiki:build-rulesbook` before `npm run wiki:sync`.

## Intuition & Analogy

Treat this wiki as Foundry's local rulebook memory: source PDFs stay as provenance, source summaries tell the agent what each document is, and fulltext chunk pages make exact source wording recoverable without re-opening the PDFs.

## Typical Applications

- Query ILCD or product-carbon-footprint background before data-governance work.
- Find exact terminology or convention text with `npm run wiki:fts -- "<term>"`.
- Give Foundry workers a stable source layer before using CLI, skills, or database adapters.

## Boundary & Confusion

This wiki is not the task queue and not a replacement for source PDFs. Task execution still belongs in `tasks/` and `.foundry/workspaces/`; the wiki provides reusable background knowledge and source recovery.

## Open Questions

- Whether the wiki daemon/dashboard should later be started for interactive browsing.
- Whether the unstructured parser should replace the current local extraction snapshot once `UNSTRUCTURED_*` credentials are available.
