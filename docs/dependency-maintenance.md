---
title: Foundry Dependency Maintenance
docType: guide
scope: repo
status: active
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when reviewing dependency proposals and updater health
  - when changing discovery or bot PR qualification
whenToUpdate:
  - when updater coverage, traffic or PR validation changes
checkPaths:
  - .github/dependabot.yml
  - .github/workflows/quality-gate.yml
  - docs/dependency-maintenance.md
lastReviewedAt: 2026-10-16
lastReviewedCommit: 6924a48c1baccdf28bba28aadc64ef18876a80e9
lastReviewedNote: "Foundry #252: bounded npm/Actions discovery reuses complete CI, keeps bot qualification unsealable and preserves consumer-qualified runtime adoption."
---

# Dependency maintenance

Dependabot monitors the single root pnpm graph through the npm ecosystem and the GitHub Actions references. Version proposals target `main` weekly on Wednesday at 06:30 and 06:45 Asia/Shanghai, with a seven-day cooldown and open-PR limits of two and one. Development-tool patch/minor updates share one group; the sole production dependency, the internal CLI, stays individually visible. Other package majors remain separately visible outside the patch/minor group. Actions share one bounded review group. Security triage/settings are separate from these version-update traffic budgets.

Keep `@types/node` on Node 24 LTS: the npm entry ignores versions `>=25.0.0`, while all 24.x patch and minor updates remain eligible under the existing monitoring policy. Revisit this exclusion only after an explicitly approved runtime/toolchain major upgrade; a newer typings major alone is not adoption approval.

Keep the current Node/pnpm/TypeScript pins, exact CLI dependency, pnpm `minimumReleaseAge`, exact release-age exceptions, build restrictions and overrides. CLI adoption, bootstrap/final locks and public runtime qualification follow their existing consumer/release contracts; a newer package or green updater job grants no adoption or rollout authority. Do not change runtime pins to accommodate the updater. The first hosted npm scan and real frozen-lock candidate remain necessary to establish updater/toolchain compatibility.

The `fast-uri: 3.1.9` override repairs the URI parser used by development-only Ajv8.20.0 within its declared `^3.0.1` range. The parser must reject encoded schemes and ambiguous domain hosts, preserve relative-reference resolution, and keep suffix paths from acquiring a scheme. The installed-consumer regression resolves the parser through Ajv and also exercises local schema references and the actual public input schemas. These controls protect source/release tooling; they do not establish a public attacker path or grant remote operation authority. Ajv and fast-uri remain outside the public package's dependency/compiler closure.

## Existing PR qualification

Use the existing complete `quality-gate` workflow. Dependency proposals retain the full test partitions, every native platform, aggregate runtime and copied bootstrap qualification. No additional job or local command is introduced. Exact version-only and independently verified reuse modes keep their existing contracts; a dependency/configuration change is not a version-only release.

Dependabot-authored PRs use the existing non-sealable source-qualification path: the immutable PR author, rather than a rerun actor, prevents privileged sealing and capsule reuse. Reopening or a human rerun does not grant the bot source attestation authority. The final aggregate still requires all selected tests, native checks, aggregation and bootstrap results; only the optional source seal is skipped. Human same-repository source PRs and reviewed release qualification retain their existing sealing behavior. Publication workflows, permissions, runtime artifacts and account/write authorization are unchanged.

A lockfile-only change keeps full validation and the required runtime/package contracts, but does not automatically require ten document review stamps. Manifest, source, runtime pin, package/public boundary, qualification and release changes retain their semantic Docpact rules. Review/update explanatory contracts whenever an accepted lock change alters those semantics.

## Acceptance and health

Automatic merging stays off. Before associating a proposal, verify both native merge state and the independent live merge-service policy, including queued work. A source guard is not deployment evidence. Leave proposals unadopted when that policy is unverified; accepted groups use one owning Issue and the existing workspace controller's preview/intake, review, merge, finish and exact integration. Neither this configuration nor source integration authorizes runtime publication or business operations.

During the normal weekly queue review, inspect the actual updater job and exact candidate CI; absence of a PR does not prove scan success. Record failed scans, lock regeneration or toolchain incompatibility in the owning Issue with the run and next action. No new reminder or unrelated feature-development gate is needed.
