# Data Governance Loop

The data foundry loop is inherited from a private account-governance seed package and extended for account-level compute repair.

Runtime account names are optional local labels, not durable workflow identifiers. Use `docs/account-context-policy.md` when deciding whether an account label belongs in an env file, manifest, task file, or public-facing report.

```text
audit -> evidence review -> repair candidate -> mutation plan -> dry-run -> completeness snapshot -> verification / follow-up
```

## Inputs

- credential/session scope and optional non-secret account display label
- dataset tables and scope
- category profile
- source evidence rules
- schema validators
- reference resolution rules
- write policy

## Outputs

- tracked account map
- full local artifact snapshot
- category update plan
- schema issue worklist
- source evidence and numeric findings
- reference closure findings
- repair candidates
- state-code-aware mutation plan
- dry-run result
- completeness snapshot
- verification report
- follow-up task records

## First Production-Like Queue

Start with the private category seed plan:

1. electricity system
2. energy fuels
3. metals and mining
4. agriculture, biomass, and food
5. chemicals and polymers
6. construction materials
7. water, waste, and recycling
8. transport and logistics
9. electronics, equipment, and batteries
10. uncategorized

## Default Rule

An agent may propose data repairs, but it must not publish them directly unless the task and `WORKFLOW.md` policy allow remote commit.

## Account Repair Rules

Use `specs/account-level-repair-cycle.md` for compute-failure repair tasks. The short version:

- `state_code=0`: prefer in-place `update` for account-owned working data after evidence, mutation-plan, dry-run, and verification gates pass.
- `state_code=100`: do not overwrite; create a source-review path and only propose repair when source evidence is sufficient.
- insert/versioned writes require an explicit reason in the mutation plan.
- unknown or ambiguous `state_code` blocks remote write and creates a follow-up task.
- every exchange in the target matrix needs closure classification before matrix readiness can pass.
- `Elementary flow` exchanges are inventory/environmental flows, not provider process links; exclude them from reference-flow process lookup and report them separately as `excluded_elementary_flow`.
- if flow metadata is unavailable, classify the exchange as `flow_metadata_missing` and keep it as a blocker instead of assuming it is a non-elementary provider-process gap.
- only non-elementary exchange flows require a corresponding provider process whose reference flow can close the technosphere link, unless a cutoff, boundary, proxy, or other modeling rule is documented.
- every cycle must write a JSON and markdown completeness snapshot.

## Dataset Construction Principles

### Traceability

在 LCA 数据集开发中，详细记录使用数据的所有来源，包括文献、报告、技术文件和其他文档，以确保数据真实性。

每一项数值和信息都必须能够追溯到原始来源。

如果数据点在原始文件中无法直接找到，或者经过处理，必须记录处理过程。

### Transparency

所有产品系统和生命周期清单必须基于单元过程构建，且单元过程的组合和连接方式必须可见。

生命周期每个阶段、每个工序和过程都应可理解、可审查、可验证、可改进。

由于目的、边界、工艺特征、数据限制等因素只能以黑箱类型开发的数据，在构建产品系统时，各单元过程所代表的实际物理过程应尽可能精细。

### Completeness

LCA 数据集中的内容必须最大限度完整记录，包括目标、范围、边界、假设、数据收集过程、建模方法、数据质量管理、审查和验证过程。

这保证数据集及应用该数据集开展的 LCA 工作可以被完整理解、评估、审查和重现。

### Representativeness

数据集应在技术、时间、地理、精度等维度代表目标产品或服务的整体或多数情况。

必要时，应记录代表性判断依据，例如技术路线、市场份额、产量、处置量、时间范围、地理范围等。

### Security

开发 LCA 数据集及构建数据库时，应保证原始数据权属和安全。

私有数据、账号数据、企业数据、包含具体技术或材料使用情况的实际数据不得越权暴露。

必要时，应支持数据不出域、隐私计算或等效的安全处理方式。

### Consistency

生命周期评价研究全过程应使用一致的假设、方法、单位、命名、数据质量规则、证据规则、写入规则和审查规则，以得到与目的和范围一致的结论。
