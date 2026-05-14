# Foundry Wiki

This directory is the repo-local Tiangong Wiki workspace for TianGong LCA Data Foundry.

The first knowledge corpus is `Rulesbook`, imported from:

`/home/example/projects/LCA-DATA-AGENT/inputs/Rulesbook`

## Contents

- `pages/`: Markdown wiki pages indexed by `tiangong-wiki`.
- `pages/source-summaries/`: source-level summaries for each Rulesbook document.
- `pages/source-fulltext-chunks/`: extracted fulltext chunks indexed through the custom `source-fulltext-chunk` type.
- `vault/Rulesbook/`: copied source PDFs used as provenance anchors.
- `wiki.config.json`: wiki schema, including the Foundry-specific fulltext chunk page type.
- `.wiki.env`: local wiki runtime paths. It contains no secrets.

## Commands

The project pins the Tiangong Wiki CLI invocation to the latest stable npm release confirmed on 2026-05-14: `@biaoo/tiangong-wiki@0.3.13`.

```bash
npm run wiki:doctor
npm run wiki:init
npm run wiki:sync
npm run wiki:stat
npm run wiki:list
npm run wiki:fts -- "ILCD data quality"
```

Refresh the Rulesbook pages after the source PDFs change:

```bash
npm run wiki:build-rulesbook
npm run wiki:sync
```

The build script can use `document-granular-decompose` when `UNSTRUCTURED_API_BASE_URL` and `UNSTRUCTURED_AUTH_TOKEN` are available. Without those variables it falls back to local `pypdf` extraction so the wiki can still be rebuilt offline.
