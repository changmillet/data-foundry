# Input Artifacts

`inputs/` is for repo-visible source artifacts that are needed to reproduce or understand a foundry task.

Use this directory only for inputs that are safe to keep in the repository. Full private exports, account payload snapshots, credentials, and other sensitive data stay under `.foundry/workspaces/<task-id>/` or another ignored/private artifact root.

Recommended subdirectories:

- `source-packages/`: checksums, manifests, and public source notes for external LCA packages. Keep full packages out of git unless they are intentionally small and redistributable.
- `source-documents/`: extraction notes, metadata, or redacted examples for PDF, Excel, web exports, screenshots, and free-text source files.

Every non-obvious input artifact should be recorded in `docs/file-location-registry.json`.
