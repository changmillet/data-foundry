---

title: TianGong LCA Data Foundry Agent Guide docType: contract scope: repo status: active authoritative: true owner: tiangong-lca-data-foundry language: en whenToUse:

- when operating a Foundry import or source-evidence authoring task
- when deciding which project owns conversion, validation, curation, skill, or write behavior whenToUpdate:
- when Foundry ownership boundaries or default operating order change
- when runtime skill, profile, workspace, or gate contracts change checkPaths:
- AGENTS.md
- README.md
- WORKFLOW.md
- .docpact/config.yaml
- docs/**
- specs/**
- scripts/**
- test/**
- .agents/**
- .github/workflows/**
- .githooks/**
- package.json
- pnpm-lock.yaml
- pnpm-workspace.yaml
- .nvmrc
- .oxlintrc.json
- prettier.config.ts
- tsconfig*.json lastReviewedAt: 2026-10-17 lastReviewedCommit: 010825aecc0f70d7a0301994d33335dc058ebf0b lastReviewedNote: "Foundry #259: reviewed validation-tool maintenance and fast-uri 3.1.8 at 010825a; exact Node/pnpm/TypeScript and CLI pins, public package/runtime, authorization and release boundaries remain unchanged. Fresh hosted qualification remains required."
