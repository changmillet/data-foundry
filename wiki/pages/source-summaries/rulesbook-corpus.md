---
pageType: "source-summary"
title: "Rulesbook Corpus"
nodeId: "rulesbook-corpus"
status: "active"
visibility: "private"
sourceRefs: []
relatedPages:
  - "concepts/foundry-rulesbook-wiki.md"
  - "source-summaries/ilcd-handbook-general-guide-detailed-guidance-2010.md"
  - "source-summaries/ilcd-handbook-nomenclature-conventions-2010.md"
  - "source-summaries/product-carbon-footprint-factor-database-guide.md"
tags:
  - "rulesbook"
  - "lca"
  - "foundry-wiki"
  - "source-corpus"
createdAt: "2026-05-14"
updatedAt: "2026-05-14"
sourceType: "pdf-corpus"
vaultPath: "wiki/vault/Rulesbook"
keyFindings:
  - "Rulesbook is available as a Foundry-local wiki corpus."
  - "Fulltext chunks are indexed through the source-fulltext-chunk type."
  - "Source PDFs are copied into the wiki vault for provenance."
---

## Source Identity

Rulesbook is the first source corpus imported into the Foundry wiki. It is copied from the LCA-DATA-AGENT input directory and normalized into source summaries plus fulltext chunks.

## Key Claims

- The corpus is preserved as source PDFs under `wiki/vault/Rulesbook/`.
- Each PDF has a source-summary page that records provenance and links to chunk pages.
- Each chunk page stores extracted text in the `fullText` field so `tiangong-wiki fts` can retrieve terms from the source material.

## Knowledge Connections

Use this corpus before Foundry tasks that need LCA methodology, ILCD conventions, or product-carbon-footprint factor database guidance.

## Evidence Pointers

| Source | Language | Pages | Chunks | Summary page |
| --- | --- | --- | --- | --- |
| ILCD Handbook General Guide for LCA Detailed Guidance (2010) | en | 417 | 82 | `source-summaries/ilcd-handbook-general-guide-detailed-guidance-2010.md` |
| ILCD Handbook Nomenclature and Other Conventions (2010) | en | 58 | 8 | `source-summaries/ilcd-handbook-nomenclature-conventions-2010.md` |
| 产品碳足迹因子数据库建设指引 | zh | 9 | 1 | `source-summaries/product-carbon-footprint-factor-database-guide.md` |
