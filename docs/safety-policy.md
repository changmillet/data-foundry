# Safety Policy

## Default Write Mode

`dry-run`.

## Remote Commit

Remote database writes are blocked unless:

- the task explicitly permits commit
- the workflow policy permits commit
- schema validation passes
- source evidence review passes
- reference closure passes
- state-code-aware mutation plan exists
- insert/versioned writes have explicit reasons
- state_code=100 rows have source-review records instead of direct overwrite
- a dry-run artifact exists
- matrix readiness or the configured verification gate passes

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
