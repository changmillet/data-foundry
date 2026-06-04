# Safety Policy

## Default Write Mode

`dry-run`.

## Remote Commit

Remote database writes are blocked unless:

- the task explicitly permits commit
- the workflow policy permits commit
- schema validation passes
- deterministic QA and Foundry curation pass
- source evidence is present for authored fields
- profiles that require full-context AI semantic completion have an AI authoring package containing SDK schema, methodology YAML, runtime ruleset, profile constraints, queue/dependency closure, source row, and current entity payload before any semantic field is accepted
- blocked Foundry authoring packages, when present, were converted into explicit `dataset-authoring-task-build` task artifacts before AI output was accepted
- AI-authored patch outputs, when produced as task files, were collected through `dataset-authoring-patch-collect` with a `ready_for_patch_apply` report and no incomplete template, unresolved placeholder, missing evidence, package mismatch, or unclosed action-item blocker
- AI-authored field changes, when present, were applied through `dataset-patch-apply` / `tiangong-lca dataset patch apply` with a completed apply report
- AI-authored patches, when produced from Foundry authoring packages, carry package lineage, close the package action items they resolve, and have an `authoring_package_sha256` that matches a readable full-context authoring package from the patch task manifest or curation gate
- full-context authoring packages must contain non-empty SDK schema, methodology YAML, and runtime ruleset text, not only file paths
- full-context AI patch operations must carry both a basis and structured evidence with source plus quote/trace/path/citation pointer; generic basis-only patches are not enough for remote write planning
- AI-authored patch evidence includes `resolution.mode` and `resolution.used_context_kinds`, so final manifests can distinguish evidence-backed completion, source-language normalization, source-trace verification, and `common:other` deferral; classification and location queue fixes are proven by their dedicated decision-apply reports instead of patch operations
- `common:other` deferral is allowed only for action items whose allowed resolution modes include `deferred_to_common_other`; it must be produced by AI patch evidence for the same row, write structured `tiangongfoundry:unresolvedTrace` with status, action item code, blocked path, reason, structured evidence, and next action, and close the matching action item; evidence must include source plus quote/trace/path/citation pointer
- mandatory schema fields cannot be marked resolved by moving the missing value to `common:other`; they need evidence-backed values or remain blocked before remote write
- source-only-output exchange acceptance must be produced by same-row AI patch evidence with `resolution.mode=source_trace_verified`, and must write structured `tiangongfoundry:sourceExchangeCompleteness` with accepted status and structured source trace evidence; evidence must include source plus quote/trace/path/citation pointer
- for profiles that require full-context AI semantic completion, deterministic AI evidence is mandatory, not optional: classification queue fixes must carry completed `classification-decisions-apply` evidence, location queue fixes must carry completed `location-decisions-apply` evidence, and other patches must carry patch collect/apply evidence with `authoring_package_sha256` and `closes_action_items`
- reference closure passes in the post-authoring mutation manifest; mutually-referencing writable contact/source rows must be grouped into a mixed `support` write scope when needed, Flow Properties and Unit Groups must resolve through the canonical support cache to existing database rows, and any referenced dataset outside the exact write scope must be proven by `dataset verify-remote` after its row exists remotely, or the dependent write scope remains blocked before commit handoff
- support/source write scopes contain only true source identities for source rows; data-format, compliance-system, and placeholder identities such as `ILCD format` or `Not specified` must remain canonical reference rewrites/provenance and are blocked by the mutation manifest before commit handoff; true source rows with empty or type-only descriptions such as `Report` must be repaired from citation/name evidence before write planning
- curation cleanup has run and cleaned rows were revalidated
- post-authoring Foundry curation gate passes on the exact final rows and references a deterministic QA report for those rows
- state-code-aware mutation plan exists
- Foundry `dataset-mutation-manifest` is `ready_for_remote_write` for the exact write scope
- blocked mutation manifests must not export executable rows in `*.write-candidates.jsonl`; planned-but-blocked rows belong only in `*.blocked-write-candidates.jsonl`
- when `common:other.tiangongfoundry:unresolvedTrace` or `sourceExchangeCompleteness` entries exist, the mutation manifest exports them as JSONL follow-up queues for later database-side curation
- mutation-manifest evidence reports point to the exact write rows: schema and remote verification `input_path` match the rows file, cleanup `cleaned_rows_file` matches the rows file, and AI patch apply output chains into cleanup input when AI patching was used
- `dataset-commit-handoff-plan` reports `ready_for_explicit_commit` for the exact finalize report, mutation manifest, final rows file, target user id, and expected state_code
- insert/versioned writes have explicit reasons
- state_code=100 rows have source-review records instead of direct overwrite
- a dry-run artifact exists
- the configured remote/readback verification gate passes
- after commit, `tiangong-lca dataset verify-remote --compare-root-payload --target-user-id <id> --state-code <code>` passes for the exact committed rows
- after commit and readback, Foundry `dataset-post-write-closeout` reports `completed`; it must prove the handoff was ready, the CLI commit report was a real commit with no row failures, post-write verification used the same final rows, root readback checks have equal local/remote payload hashes, owner/state_code match the handoff, profile-required full schema/YAML/context AI proof and evidence counts remain attached, and any `common:other` trace queues remain attached
- for a task with one or more committed scopes, Foundry `dataset-import-completion-report` reports `completed` after aggregating every closeout report required by the task; missing closeouts, duplicate closeouts for the same dataset type/final rows, non-completed closeouts, mismatched finalize/mutation scopes, missing profile-required full-context proof or evidence counts, unreadable trace queues, or missing required dataset types keep the task blocked
- Foundry task state moves from `tasks/active` to `tasks/done` only through `task-complete`, which requires a matching `dataset-import-completion-report.completed` for the same task id, at least one post-write closeout scope, and profile-required full schema/YAML/context AI completion proof before entry

For `state_code=0`, ordinary account-owned working-data repair should use update-first semantics. For missing or ambiguous `state_code`, stop at dry-run and create a follow-up task.

## Secrets

Never commit:

- `.env`
- API keys
- access tokens
- full database payload dumps
- runtime logs with credentials

## Human Involvement

The long-term goal is minimal human involvement, but v0 keeps human approval for remote commit. Humans should approve policy and exceptional waivers, not supervise every scan or repair candidate.
