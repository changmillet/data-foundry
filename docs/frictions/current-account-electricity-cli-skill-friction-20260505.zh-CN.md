# 当前账号电力数据 review 暴露的 CLI / Skill 摩擦

日期：`2026-05-05`

来源 case：`artifacts/current-account-dataset-validation-review-loop-20260421`

任务范围：当前 `.env` 账号下电力相关 `flow=46`、`process=214`、`lifecyclemodel=22` 的统计、schema validation、字段语义 review、修复、写回和远端复验。

最终结果已经闭环：目标版本远端命中 `46/214/22`，三类 schema issue 均为 `0`，lifecyclemodel 连接结构问题数为 `0`。本文件只整理过程中暴露出的 CLI / skill 产品摩擦，用于后续优化。

## 1. 关键证据

- 执行流水：`artifacts/current-account-dataset-validation-review-loop-20260421/reports/operations-log.md`
- 主报告：`artifacts/current-account-dataset-validation-review-loop-20260421/reports/electricity-current-account-review.commit.zh-CN.md`
- 最终复验：`artifacts/current-account-dataset-validation-review-loop-20260421/reports/electricity-current-account-review.final-verification.zh-CN.md`
- 远端复验 JSON：`artifacts/current-account-dataset-validation-review-loop-20260421/outputs/electricity-current-account-review/final-remote-verification.json`
- 版本冲突补写摘要：`artifacts/current-account-dataset-validation-review-loop-20260421/outputs/electricity-current-account-review/targeted-repair/repair-summary.json`
- case-local 主脚本：`artifacts/current-account-dataset-validation-review-loop-20260421/scripts/review-electricity-current-account.mjs`
- case-local 补写脚本：`artifacts/current-account-dataset-validation-review-loop-20260421/scripts/repair-electricity-flow-version-conflict.mjs`

## 2. CLI 摩擦

| 优先级 | 摩擦 | 本次表现 | 建议优化 |
| --- | --- | --- | --- |
| P0 | 缺少 current-account 多类型 inventory 命令 | 需要分别走 `flow list`、`process list` 和 lifecyclemodel REST 查询，再手工按当前 token 解析 `user_id`。 | 增加 `tiangong dataset inventory --current-user --types flow,process,lifecyclemodel --state-code 0,20,100,200 --out-dir ...`，输出冻结清单、账号信息、分页日志和可复验 manifest。 |
| P0 | version bump 缺少 RLS/唯一约束感知 | dry-run 通过，但 commit 时 `890a70b7-b677-4e2a-8a1b-7d017e0a10ae@01.01.001` 被远端唯一约束拒绝；可见版本里还有其他账号 `01.01.002`。 | `flow publish-version` 应提供 server-side `next_available_version` 或 conflict retry；dry-run 必须暴露“当前账号可见版本、全局唯一约束风险、最终将使用版本”。 |
| P0 | 跨类型引用重写没有原生命令 | flow 改写到 `01.01.003` 后，需要手工找出并更新 `96` 个 process 的 `referenceToFlowDataSet.@version`。 | 增加 `tiangong dataset references rewrite --from flow:<id>@<old> --to flow:<id>@<new> --scope current-user --types process,lifecyclemodel --dry-run/--commit`。 |
| P0 | 没有统一的 schema validation / remote verification 命令 | 本地和远端复验都要在 case-local 脚本里直接 import SDK schema 并写 REST 查询。 | 增加 `tiangong dataset validate --type auto --input rows.jsonl` 和 `tiangong dataset verify-remote --manifest ... --schema --references`。 |
| P1 | lifecyclemodel 写回没有稳定公开 CLI surface | 本次需要直接 import `syncLifecyclemodelBundleRecord`，属于依赖 `dist/src/lib` 的内部模块。 | 增加 `tiangong lifecyclemodel save-draft` / `publish-version` / `verify`，避免 runtime repo 直接调用内部 dist 文件。 |
| P1 | process save-draft 大批量写入缺少实时进度 | `214` 个 process 写入期间长期无输出，只到结束才写 `progress.jsonl`。 | `process save-draft` 支持 incremental progress、失败即时 flush、`--resume-from progress.jsonl`、并发参数和 ETA。 |
| P1 | publish partial failure 后缺少可控恢复计划 | flow `45/46` 成功、process/model 已成功写入后，不能全量重跑，否则会把已写入版本再次 bump。 | 所有 publish/save-draft 命令应输出 machine-readable `failure_plan.json`，包含安全 retry 范围、依赖影响、是否允许全量 rerun。 |
| P1 | lifecyclemodel 图结构检查缺少 CLI | 本次手工生成 DOT/SVG 检查 `processInstance`、`outputExchange`、`downstreamProcess`。 | 增加 `tiangong lifecyclemodel graph --input rows.jsonl --format svg --check-connections --out-dir ...`。 |
| P1 | 多类型 scope 的引用闭包由脚本临时实现 | 电力范围需要 `flow` 关键词识别，再把引用这些 flow 的 process、引用这些 process 的 lifecyclemodel 纳入。 | 增加 `tiangong dataset scope expand --seed flows.jsonl --include-referencing process,lifecyclemodel --reason-log`。 |
| P2 | 字段定义语义 review 缺少可执行规则入口 | schema 能判断必填和类型，但字段内容是否符合字段定义只能写启发式。 | 提供 schema annotation extractor 或 `dataset review fields --rules <rulebook>`，把字段定义、枚举、业务语义映射为可执行检查。 |

## 3. Skill 摩擦

| 优先级 | 摩擦 | 本次表现 | 建议优化 |
| --- | --- | --- | --- |
| P0 | 缺少“当前账号多类型数据治理”skill | 现有 skill 更偏 process review / 构建 / publish handoff，不能直接覆盖 flow + process + lifecyclemodel 的账号级治理。 | 新增或扩展 skill：`current-account-dataset-review`，固定步骤为账号解析、inventory、scope、schema validation、语义 review、repair、dry-run、commit、remote verify。 |
| P0 | 缺少 publish 前版本规划与依赖更新 primitive | skill 没有明确告诉 agent：先规划所有新版本，再写入；若某个上游版本冲突，必须只修受影响闭包。 | 在 skill 里沉淀 `version-plan -> dependency-rewrite -> publish -> verify` 的强制流程，并禁止 partial failure 后直接全量 rerun。 |
| P1 | 电力数据字段语义规则没有沉淀 | 本次规则临时写在 case 脚本里，例如 AC/DC baseName、发电/输配电分类、生产组合/消费组合、35-330kV 等。 | 建立 `references/electricity-review-rules.md` 和可执行规则脚本，覆盖 classification、name 四段式、flow/process/model 的对应关系。 |
| P1 | lifecyclemodel 可视化审查没有 skill-level 入口 | 用户明确允许“有必要可以上视觉”，但 skill 没有自动生成图和检查结构的约定。 | 在 skill 中增加 graph audit 步骤：自动产出 DOT/SVG、连接问题 JSON、人工可读索引。 |
| P1 | 远端写回后的 verification 不是 skill 标准收尾 | 最终复验必须另写脚本完成。 | skill 的 done criteria 应固定包含远端再取回、SDK schema 验证、目标版本命中、state_code 分布、关键引用版本分布。 |
| P1 | skill 与 CLI 边界不够清晰 | 为完成任务直接 import CLI 内部 dist 模块；这说明 skill 当前没有足够的 CLI public surface 可调用。 | skill 应只调用 public CLI；如果必须 import 内部模块，应把该项自动登记为 CLI 缺口，而不是让 case 脚本长期依赖内部 API。 |
| P2 | artifact 报告结构没有统一模板 | 本次生成了多个 JSON/MD，但主报告、补写报告、最终复验报告的字段不是统一模板。 | skill 提供 `run-summary.json`、`patch-plan.json`、`publish-summary.json`、`final-verification.json` 的固定 schema。 |

## 4. 建议优先级

第一批应先补 CLI，而不是先把 case-local 脚本包装成 skill：

1. `dataset inventory --current-user`
2. `dataset validate`
3. `publish-version` / `save-draft` 的 `next_available_version` 与 conflict retry
4. `dataset references rewrite`
5. `dataset verify-remote`
6. `lifecyclemodel save-draft` 与 `lifecyclemodel graph`

原因：本次主要复杂度不是 agent 不知道流程，而是缺少稳定 CLI 原语，导致 skill 只能直接调用内部模块或写 REST/SDK glue。先补 CLI 后，skill 才能保持薄编排。

第二批再沉淀 skill：

1. `current-account-dataset-review`
2. `electricity-dataset-review-rules`
3. `publish-partial-failure-recovery`

这些 skill 应该只编排 public CLI，并把规则、artifact 模板、停止条件和复验条件固定下来。

## 5. 复用的停止规则

- 任何 commit 前必须有 dry-run，且 dry-run 需要列出将写入的最终版本。
- 如果 commit 出现 partial failure，禁止全量重跑；必须先判断已成功写入范围，再做 targeted repair。
- 修改上游 flow / process 版本后，必须复验下游引用版本分布。
- lifecyclemodel 复验不能只看 schema；还要检查 instance id、downstream id、flowUUID 和 process reference 是否连贯。
- 远端复验必须重新查询数据库，不接受只读本地 patch-plan 作为完成依据。

## 6. 2026-05-05 workspace 修复状态

本 friction 已在当前 workspace 中完成第一批可落地修复：

- `tiangong-lca-cli`
  - 已新增 `tiangong dataset validate`。
  - 已新增 `tiangong dataset references rewrite`。
  - 已新增 `tiangong lifecyclemodel save-draft`。
  - 已新增 `tiangong lifecyclemodel graph`。
- `tiangong-lca-skills`
  - 已修复本地 workspace 联调时误用 stale CLI `dist/` 的问题；skill launcher 在使用本地 CLI checkout 时会自动检查并重建过期 dist。
  - 已新增 `current-account-dataset-review` 薄编排 skill，当前只调用 public CLI，不再鼓励直接 import CLI 内部 `dist/src/lib/**`。

仍未根治、需要后续单独进入 CLI/server 任务的缺口：

- `dataset inventory --current-user`
- `dataset verify-remote`
- `flow publish-version` 的 server-side next available version / conflict retry
- `dataset scope expand`
- `process save-draft` 的实时进度、resume 与 failure plan
- `lifecyclemodel publish-version` / `verify`
- 电力字段语义规则的可执行入口
