---
title: Runtime Skill Management
docType: contract
scope: skill-orchestration
status: active
owner: tiangong-lca-data-foundry
related:
  - AGENTS.md
  - WORKFLOW.md
  - docs/skill-orchestration/source-evidence-top-level-skill-design.md
  - specs/automated-lca-capability-registry.json
---

# Runtime Skill Management

Foundry treats skills as execution surfaces, not as a place to copy reusable business logic.

Project-owned Foundry skills may live under `.agents/skills` when they only orchestrate Foundry task state, manifests, curation packages, or deterministic gates. External fast-moving retrieval and research skills must be resolved at runtime with `npx skills`, then recorded as task evidence. Do not vendor those external skills into this repository.

## Skill Classes

| Class | Source | Storage rule | Update rule |
| --- | --- | --- | --- |
| Foundry-local orchestration skills | this repository | tracked under `.agents/skills` | changed through normal Foundry PRs |
| TianGong LCA shared skills | `tiangong-lca-skills` | preferably consumed from the shared repo or installed by operator choice | update with `npx skills update` when installed |
| Source-evidence research skills | external skill repos such as `tiangong-ai/skills` | runtime only; ignored if installed locally | resolve latest before each source-evidence run |

The external source-evidence class is intentionally floating. Reproducibility is kept by task artifacts that record the resolved repository ref, command, retrieved evidence, and timestamps, not by committing a copied skill version to Foundry.

## Required SCI Evidence Skill

For academic paper and scientific journal evidence, agents must use the latest `tiangong-kb-sci-search` skill from:

```text
https://github.com/tiangong-ai/skills/tree/main/tiangong-kb-sci-search
```

This skill is for the `sci` source channel. It must not be treated as a report, patent, general web, or all-source search wrapper. If a field requires reports, patents, standards, company disclosures, or web pages, route those channels through separate evidence steps and keep their evidence records distinct.

## Runtime Commands

List available remote skills:

```bash
npx --yes skills@latest add https://github.com/tiangong-ai/skills --list --full-depth
```

Read and use the latest SCI skill instructions for the current agent turn without installing them into the project:

```bash
npx --yes skills@latest use https://github.com/tiangong-ai/skills \
  --skill tiangong-kb-sci-search \
  --full-depth
```

Install the SCI skill into the local checkout only when an operator wants a persistent local runtime copy:

```bash
npx --yes skills@latest add https://github.com/tiangong-ai/skills \
  --skill tiangong-kb-sci-search \
  --agent '*' \
  --yes \
  --full-depth
```

Update locally installed project skills before a source-evidence run:

```bash
npx --yes skills@latest update --project --yes
```

Inspect local project skill state:

```bash
npx --yes skills@latest list --json
```

Confirm the latest upstream ref when a task needs an audit trail:

```bash
git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main
```

For GitHub URL sources, do not use `<repo>@<skill>` syntax. Use the repository URL plus `--skill tiangong-kb-sci-search`.

## Task Artifact Contract

Each `source-evidence-dataset-development` workspace that uses runtime skills should write:

```text
.foundry/workspaces/<task-id>/runtime-skills/runtime-skill-resolution.json
```

Minimum fields:

```json
{
  "resolved_at_utc": "2026-06-04T00:00:00Z",
  "skills_cli_package": "skills@latest",
  "source_repo": "https://github.com/tiangong-ai/skills",
  "source_ref": "refs/heads/main",
  "resolved_commit": "<git-ls-remote-sha>",
  "skill_name": "tiangong-kb-sci-search",
  "resolution_command": "npx --yes skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth",
  "evidence_channel": "sci",
  "output_artifacts": [
    "evidence/sources.jsonl",
    "evidence/field-evidence.jsonl"
  ]
}
```

If an operator installs the skill locally, `.agents/skills/tiangong-kb-*/` and `skills-lock.json` remain local runtime state by default. Commit them only when the task deliberately changes from a floating-latest policy to a pinned reproducibility policy, and record that decision in the relevant issue or design document.

## Agent Rules

- Resolve latest external source-evidence skills before SCI evidence retrieval.
- Read the current remote skill instructions in the same session before relying on them.
- Record the resolved upstream commit and command in the task workspace.
- Treat search results as evidence candidates until they are captured in the evidence dossier with field-level support and limitations.
- Keep Foundry code free of copied retrieval logic from external skill repositories.
- Do not let a runtime skill write database rows. Source-evidence skills may retrieve and summarize evidence; Foundry and CLI gates still own row authoring, curation, dry-run, commit handoff, and readback verification.
