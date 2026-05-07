# Symphony Adaptation Notes

OpenAI Symphony is an issue-tracker-driven orchestration pattern for autonomous implementation runs. This project adapts the same control-plane idea to LCA data production.

Upstream references:

- https://github.com/openai/symphony
- https://github.com/openai/symphony/blob/main/SPEC.md

## Mapping

| Symphony concept | Data Foundry equivalent |
| --- | --- |
| Issue tracker | filesystem task queue first; Linear/GitHub later |
| Issue | data task |
| Per-issue workspace | per-data-task workspace |
| `WORKFLOW.md` | data task runtime contract |
| Coding agent | LCA data worker agent |
| PR proof | schema/source/reference/dry-run/verification proof |
| Terminal issue state | done/cancelled/duplicate task state |

## Data-Specific Extensions

- data category classifier
- source-evidence and KB queue generation
- process numeric risk scan
- reference closure resolver
- version bump planner
- dry-run publish/import gate
- post-commit remote re-snapshot

## Initial Tracker Choice

Use a filesystem queue for v0 because it is private, auditable, easy to version, and does not require external task-system credentials. The service spec keeps the tracker adapter pluggable.
