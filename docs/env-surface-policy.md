---

title: Environment Surface Policy docType: policy scope: runtime-env status: active authoritative: true owner: tiangong-lca-data-foundry language: en whenToUse:

- when adding, removing, or documenting Foundry environment variables
- when changing credential-free toolchain or acceptance-hook environment boundaries whenToUpdate:
- when .env.example or an executable runtime environment consumer changes
- when pnpm, CLI, skill, or account-guard environment ownership changes checkPaths:
- .env.example
- .codex/hooks/run-foundry-acceptance-check.sh
- docs/env-surface-policy.md
- scripts/foundry.ts
- scripts/foundry-golden-diff.ts
- scripts/commands/core.ts
- scripts/with-lca-account.ts
- scripts/lib/foundry-runtime-environment.ts
- scripts/lib/foundry-runtime-qualification.ts
- scripts/lib/foundry-execution-admission.ts
- scripts/foundry-facade.ts
- scripts/runtime-entry.ts
- scripts/lib/tidas-adapter.ts
- scripts/lib/foundry-runtime-utils.ts
- scripts/build-foundry-package.ts
- scripts/pack-foundry-package.ts
- scripts/verify-foundry-package.ts
- scripts/package-entry.ts
- scripts/public-api.ts
- test/scenarios/foundry-package-consumer.test.mts
- test/unit/foundry-runtime-environment.test.mts lastReviewedAt: 2026-10-17 lastReviewedCommit: 010825aecc0f70d7a0301994d33335dc058ebf0b lastReviewedNote: "Foundry #259: reviewed validation-tool maintenance and fast-uri 3.1.8 at 010825a; exact Node/pnpm/TypeScript and CLI pins, public package/runtime, authorization and release boundaries remain unchanged. Fresh hosted qualification remains required."
