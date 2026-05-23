# Input Artifacts

`inputs/` is for repo-visible source artifacts that are needed to reproduce or understand a foundry task.

Use this directory only for inputs that are safe to keep in the repository. Full private exports, account payload snapshots, credentials, and other sensitive data stay under `.foundry/workspaces/<task-id>/` or another ignored/private artifact root.

Current subdirectories:

- `account-sample-scenarios/`: sanitized row identifiers and scenario notes for reusable account-scoped test samples.
- `diagnostics/`: sanitized diagnostic reports, incident summaries, and other task seed material.

Every non-obvious input artifact should be recorded in `docs/file-location-registry.json`.
