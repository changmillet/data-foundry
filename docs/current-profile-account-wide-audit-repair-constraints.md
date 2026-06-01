---
title: Current Profile Account-Wide Audit and Repair Constraints
docType: runbook
scope: data-foundry
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: zh-CN
whenToUse:
  - when auditing all process and flow rows visible under the selected TianGong LCA account profile
  - when building a repair queue from schema, review, bilingual, reference-closure, and remote-reference gates
  - when deciding whether an account-owned row may be repaired, dry-run, written, read back, or escalated
whenToUpdate:
  - when account-wide inventory starts covering additional dataset tables
  - when write policy, UI validation, readback, or compute gates change
  - when new deterministic repair classes become safe for automated draft update
checkPaths:
  - WORKFLOW.md
  - docs/account-context-policy.md
  - docs/countable-product-functional-unit-design.md
  - docs/data-governance-loop.md
  - specs/account-level-repair-cycle.md
  - specs/workspace-capability-adapters.md
  - scripts/foundry.mjs
  - scripts/with-lca-account.mjs
  - package.json
---

# Current Profile Account-Wide Audit and Repair Constraints

本文件记录当前 profile 全量数据审计和修订队列的硬约束。它不是账号凭证记录；账号选择必须通过 `scripts/with-lca-account.mjs <profile> -- ...` 和 thread guard 完成。

## 目标

对当前 TianGong LCA runtime profile 下的账号数据做系统性治理：

1. 冻结当前账号拥有的 process / flow rows。
2. 对全量 rows 跑 schema、process/flow review、bilingual scan、process required-field completion、remote reference verification 和 reference-flow closure。
3. 将问题分层，形成可追踪 repair queue。
4. 每类问题选 1-2 个样例，先推进 deterministic repair 或 agent-reviewed repair。
5. 所有写回必须先 dry-run，再 readback，再跑 schema/review/bilingual；用户可见 process 修复还要跑 UI validation；影响 graph/compute 的修复还要跑 matrix-readiness / compute gate。

## 运行入口

```bash
node scripts/with-lca-account.mjs example-account -- npm run account-wide:audit -- --task-id current-profile-account-wide-audit-2026-05-25-v3 --remote-verify-mode skip
```

输出只进入 ignored runtime workspace：

```text
.foundry/workspaces/current-profile-account-wide-audit-2026-05-25-v3/
  input-freeze/
  audit/
  gates/
  repair-candidates/
  mutation-plan/
  dry-run/
  verification/
  reports/
```

tracked repo 中只保留本约束文档和非敏感摘要，不提交完整 payload、远端 URL、token、session、source dump 或 account-private data export。

## 数据范围

当前可自动治理的成熟范围是：

- process rows owned by the current profile user
- flow rows owned by the current profile user
- process exchange references and referenced flow metadata visible to the current profile

当前不把 lifecyclemodel、source、contact、flow property、unit group 等表宣称为 fully repaired；这些表可以后续接入同一 runbook，但需要对应 inventory/list、schema/review、write and readback command 后才能纳入“全量专家级修订”完成条件。

## 当前全量审计基线

最新基线由 `current-profile-account-wide-audit-2026-05-25-v3` 生成，运行账号由 runtime profile 和 thread guard 判定；文档中不记录完整凭证或私有 payload。

| 指标 | 数量 |
| --- | ---: |
| process rows | 4756 |
| flow rows | 6799 |
| process schema invalid | 4754 |
| flow schema invalid | 3866 |
| process bilingual findings | 57709 |
| flow bilingual findings | 2989 |
| flow review findings | 2290 |
| deterministic required-field repairs | 4751 |
| required-field blockers | 3 |
| process exchanges | 29014 |
| distinct exchange flow refs | 5972 |
| reference closure blockers | 6203 |
| repair queue entries | 82565 |

reference-flow closure 当前分布：

| 状态 | 数量 | 处理规则 |
| --- | ---: | --- |
| `closed_by_existing_process` | 19304 | 可作为已闭合证据继续进入 matrix readiness。 |
| `missing_reference_process` | 4384 | 需要 provider、proxy、cutoff 或 boundary evidence。 |
| `ambiguous_flow_match` | 1789 | 需要 flow identity disambiguation 或明确 provider 选择。 |
| `flow_metadata_missing` | 30 | 先补 flow metadata 可见性，再判断 provider。 |
| `excluded_elementary_flow` | 3507 | elementary flow 不按 technosphere provider closure 阻断。 |

本轮 remote reference verify 使用 `--remote-verify-mode skip`。这不等于远端引用已通过，只表示第一轮全量审计不让无 checkpoint 的巨大远端校验阻塞基础分层；后续每个修复批次必须按 slice 重新跑 remote/readback/UI/compute 相关 gate。

2026-05-25 复跑 required-field 子 gate 时，加入 exchange-flow metadata 并修复 CLI 对数值型 `meanAmount` / `resultingAmount` 以及 Mass flow property 的处理后，`process required-field blockers` 从 51 降为 3。Foundry `account-wide-audit-run` 现在会先冻结 exchange flow metadata，再把 `flow-metadata-for-account-process-exchanges.rows.jsonl` 传给 required-field gate：

| required-field 子 gate | 数量 |
| --- | ---: |
| total process rows | 4756 |
| completed by deterministic rule | 4752 |
| existing valid | 1 |
| still blocked | 3 |

剩余 3 条 blocker 均含 `process_placeholder_content`，不能仅凭 reference flow 自动写入；它们需要 source evidence 或人工/agent 语义修订后再进入 save-draft dry-run。

## 问题分层

| 层级 | 问题类型 | 自动化边界 |
| --- | --- | --- |
| P0 | schema invalid、remote reference blocker、missing required field blocker | 阻断写入和发布；只能修复后重跑 gate。 |
| P1 | reference-flow closure failed、provider missing、flow metadata missing、ambiguous provider | 阻断 compute/publish-prep；需要 provider、proxy、cutoff、boundary 或 source evidence。 |
| P2 | bilingual mixed language、placeholder text、机械转译、flow/process review error | 可由 Codex/agent transcreation 修复，但必须产出 translation evidence 并重跑 bilingual validate。 |
| P3 | deterministic required-field completion、placeholder review metadata removal、reference version refresh | 可进入 dry-run repair queue；仍需 readback 和二次 gate。 |
| P4 | warning-only review findings | 可排入低风险批次，但不能覆盖 P0/P1。 |

## 批次推进规则

每个问题类型先取 1-2 条代表性样例，按最小可验证批次推进：

| 批次类型 | 样例选择 | 进入条件 | 完成条件 |
| --- | --- | --- | --- |
| schema + required-field combined repair | schema invalid 且 deterministic required-field 可修复的 process | 字段路径明确，修复不改变过程边界 | schema valid、required fields valid、bilingual blocker=0、save-draft dry-run prepared。 |
| bilingual transcreation repair | process/flow 中英文字段存在 blocker 或明显机器转译 | 有英文来源、字段路径、上下文和术语表 | trans-reviewed JSONL 有 evidence，apply 后 bilingual blocker=0，关键中文不含机械替换。 |
| flow governance repair | flow identity、reference property、classification、命名或版本问题 | flow state/write policy 允许或进入人工 review | flow schema/review/bilingual 通过，受影响 process 引用可 readback。 |
| reference closure repair | process exchange 引用未闭合、provider 缺失或歧义 | 能找到 provider、proxy、cutoff 或 boundary 依据 | matrix-readiness 对该 slice 通过；无法闭合时有明确 cutoff/proxy evidence。 |
| UI-visible process repair | 过程编辑器会展示或校验的字段 | dry-run passed，且字段在 UI 中可定位 | readback 后用 UI 或 computer-use 验证无红色校验错误和字段含义正确。 |

已跑通的第一个样例是 LCD monitor process `001e8cc4-afa3-4c8d-b8a8-002cce923d35@01.01.000` 的 combined repair：

- schema gate: valid。
- process review gate: `review process` strict ruleset passed；物料输入 1.020 kg，成品+制造损耗输出 1.020 kg，delta 0。
- bilingual gate: blocker 从 2 降为 0；剩余 warning 集中在参考文献中文 shortDescription 保留英文期刊名/作者名。
- save-draft dry-run: `selected=1`、`prepared=1`、`failed=0`。
- remote verify: 59 references checked，0 blocker。
- 修复内容包括：压缩超长 exchange comment、移除占位符表述、把 `annualSupplyOrProductionVolume` 从 reference flow mass 推导为 `1 kg/year`、把机械件质量设为剩余质量份额以闭合 1 kg 成品显示器物料衡算。
- remote write: 已对 example-account profile 执行 `process save-draft --commit`，远端 `modified_at=2026-05-25T02:15:43.419869+00:00`。
- readback: schema、process review、bilingual、remote verify 二次 gate 均通过；readback process review 仍为物料输入 1.020 kg、输出 1.020 kg、delta 0。
- UI validation: 已在真实 Chrome `Millet` profile 下进入 TianGong LCA Data Platform 过程编辑器并点击 `Data Check`，结果显示 `Data check successfully!`；随后 readback 显示 process `rule_verification=true`、远端 `modified_at=2026-05-25T04:10:10.771684+00:00`，且 `extracted_text` 旧值检查未再命中旧机械件质量或占位符。
- UI validation repair note: 首次 UI `Data Check` 失败不是 LCD process 字段本身，而是递归引用的 electricity flow `3d76981f-964a-4865-b588-0e067a2a1163@01.01.003` 仍指向过期 source/contact 版本。修复该 flow 后，source `9ba3ac1e-6797-4cc0-afd5-1b8f7bf28c6a` 已刷新到 `03.00.003`，contact `339fec5b-cded-4b4e-9579-5e32597bb15e` 已刷新到 `01.00.006`，contact `f4b4c314-8c4c-4c83-968f-5b3c7724f6a8` 已刷新到 `01.00.001`。
- modelling caveat: 进一步检查 output/reference flow 后，该 LCD 样例当前主 output flow 使用 `Mass` flow property，output amount 是 `1 kg`，因此它是 `mass_normalized_production_fixture`。如果目标是“1 台 LCD 显示器提供显示功能”的专家级数据，必须按 `docs/countable-product-functional-unit-design.md` 重新建模为 item-based reference flow，并用产品质量、BOM 和服务寿命证据做缩放；在此之前不能把该条宣称为 countable-product functional exemplar。

已跑通的第二个样例是 elementary flow `0058b495-c311-4dc5-81ff-e7cb3b778fc8@00.00.001` 的 schema + flow governance + bilingual repair：

- schema gate: valid。
- flow review gate: strict ruleset passed。
- bilingual gate: 0 blocker、0 warning。
- remote verify: 6 references checked，0 blocker；其中 contact reference 已刷新到最新 `01.00.001`。
- publish-reviewed-data dry-run: `prepared_flow_rows=1`、`failure_count=0`，policy 为 `upsert_current_version`。
- 修复内容包括：补齐 `@xmlns:ecn`、补齐 name 子字段、修复 `common:other` 类型、补齐 data entry/ownership contact、把 elementary categorization catId 固定为 ILCD `1 -> 1.3 -> 1.3.4`，并把工具痕迹说明改写为可审查的基本流语义说明。
- remote write: 已对 example-account profile 执行 `flow publish-reviewed-data --commit`，结果为 `status=completed_flow_publish_reviewed_data`、`success_count=1`、`failure_count=0`，operation 为 `update_existing`。
- readback: schema、flow review、bilingual、remote verify 二次 gate 均通过；远端 `modified_at=2026-05-25T03:13:45.524209+00:00`，owner 为 example-account profile user。

工具约束：`review flow --rows-file` 必须识别数据库 row envelope 中的 `flow` payload；elementary flow 的 classification leaf 必须来自 `common:elementaryFlowCategorization`，不能按 product-flow `common:classification` 误判。该能力是 flow 样例能进入 strict review 的前置条件。

工具约束：`flow publish-version` 和 `flow publish-reviewed-data --commit` 必须同样识别数据库 row envelope 中的 `flow` payload；否则 dry-run 会通过但 commit 阶段会把 payload 当空并返回 `FLOW_PUBLISH_VERSION_PAYLOAD_REQUIRED` / `UNMATCHED_PUBLISH_RESULT`。该修复已在 CLI commit `68a65f4` 中落地，后续 flow 批次必须使用包含该修复的 CLI build。

工具约束：`process complete-required-fields` 必须接受数值型 `meanAmount` / `resultingAmount`，并能从 flow property `Mass` / `质量` 推导单位 `kg`。否则截图字段 `annualSupplyOrProductionVolume` 会把合法参考流数量误分层为 blocker，或退化成 `unit/year`。该修复已在 CLI commit `76d775c` 中落地；全量 required-field 子 gate 复跑后只有 3 条真正 placeholder blocker。

编排约束：`account-wide-audit-run` 里的 required-field gate 必须使用 exchange-flow metadata，即命令中应包含 `--flows <run>/input-freeze/flow-metadata-for-account-process-exchanges.rows.jsonl`。没有该参数时，即使 blocker 数正确，也可能把质量参考流写成 `unit/year`，不能作为批量修订依据。

UI 验证约束：真实浏览器页面的账号必须与 CLI runtime profile 一致。2026-05-25 曾发现一个 Chrome 窗口登录态与 example-account runtime profile 不一致，搜索 example-account LCD process UUID 返回“暂无数据”，该结果不能计为 UI validation。后续改用 Chrome `Millet` profile 后，页面可见 example-account 目标 LCD process，过程编辑器 `Data Check` 已通过。因此 UI gate 必须记录：Chrome profile、平台内显示账号、目标 UUID/version、点击的校验动作、UI 返回消息，以及校验后的 remote readback `rule_verification`。

递归引用约束：过程编辑器的 `Data Check` 会检查 process 直接引用及其递归引用的数据集版本。若 process 本身 schema/review/remote verify 已通过但 UI 仍报“数据集不存在 / 当前版本号小于已发布版本号”，必须检查被引用 flow/source/contact 的递归版本，而不是只修 process JSON。修复顺序为：定位 UI 报错 UUID/version -> 查找直接或递归引用来源 -> 刷新到当前可见 latest published version -> dry-run + remote verify -> commit -> readback -> 重跑 UI `Data Check`。

Unit-of-analysis 约束：每条自动研制数据必须在生成 process/flow payload 前先固定 functional unit、reference flow、reference unit、declared unit 是否适用和 scaling evidence。该语义决策由 skill / Codex workflow 完成，早于 reference flow reuse/create、process quantitative reference、exchange scaling、年产量补全和 compute normalization；CLI 不另做行业判断器，只在既有 build-plan validate / process review / flow review 中检查 artifact 是否存在、字段是否完整、最终 payload 是否与 artifact 一致。缺失时应阻断生成，而不是先生成 schema 可过的数据。

离散耐用品约束：服装、鞋、显示器、家电、家具等 countable durable products 不能默认用 `kg` 作为专家级产品功能基准。若目标是产品功能或 PEF/PCR 式比较，应拆成两层：物理 reference flow 使用 `Number of items` / `Number of pairs` 等计数属性，产品质量/BOM 作为 supporting property 或 exchange evidence；功能单位在 process/model metadata 中记录服务、质量等级、寿命和使用次数。只有数据集明确声明为 `1 kg of product` 的 mass-normalized production 时，`Mass` qref 才可作为最终 reference flow。相关规则见 `docs/countable-product-functional-unit-design.md`。

## 写回策略

- `state_code=0`: 优先 update existing draft；不为普通修订制造无意义新版本。
- `state_code>=100`: 不直接覆盖；创建 source-review / manual-review queue。
- unknown `state_code`: 阻断 remote commit。
- 所有 mutation-plan entry 默认 `remote_commit_allowed=false`。
- 自动 draft-write 只允许在 deterministic repair、dry-run passed、readback passed、schema/review/bilingual passed 后开启。
- publish 或 state transition 需要 A3/A4 policy allowlist；当前不能把 repair queue 直接当 publish approval。
- 写回后的 readback 不能只校验 `processDataSet` / `flowDataSet`。若远端 row 还包含 `extracted_text`、embedding、search summary 或其他派生字段，必须检查这些派生字段是否仍引用旧数值、旧名称或旧描述；发现 stale 派生文本时，状态是 `json_gates_passed_but_derived_text_stale`，需要触发派生索引刷新或把该条放入 derived-field repair queue。

## 证据规则

- 数值字段不能凭空修。优先 source evidence；没有显式证据时，只能使用已记录的确定性规则，例如 process `annualSupplyOrProductionVolume` 可从 quantitative reference flow `meanAmount`，再从 `resultingAmount` 推导，并记录 unit source。
- 双语字段不能用“机器翻译式替换”。必须用 TIDAS/ILCD 语境、source evidence、process/flow review、术语表和上下文字段做 AI transcreation。
- 每个修复候选必须记录 field path、old value、new value 或 unresolved status、evidence、derivation、confidence、reviewer note。

### 截图字段规则

截图中的 `annualSupplyOrProductionVolume` / 年供应量或生产量属于必填建模字段。自动撰写顺序固定为：

1. 若 source evidence 明确给出年产量、产能、供应覆盖率或相同语义数据，使用证据值，并记录来源、单位和年份。
2. 若没有证据值，但 process 有 quantitative reference flow，优先使用 reference flow `meanAmount`。
3. 若 `meanAmount` 缺失，使用 reference flow `resultingAmount`。
4. 若 reference flow 也无法推导，进入 `process_required_fields_blocked`，不能凭空补数。
5. 中文说明不能写成“占位符”；必须写明“来源未给出，按参考流数量作为本数据集覆盖量/归一化生产量”，并把不确定性放入 uncertainty 或 data quality 语境中。

## 验证顺序

每个批次至少按下面顺序推进：

1. freeze current rows
2. schema validate
3. process/flow review
4. bilingual validate
5. required-field completion or repair candidate generation
6. remote reference verify/refresh
7. reference-flow closure and matrix-readiness where applicable
8. mutation plan
9. dry-run
10. remote write only when policy permits
11. readback
12. schema/review/bilingual repeat
13. UI validation for process editor-visible fields
14. compute validation for graph-affecting changes

缺任一环节时，状态是 `blocked` 或 `manual_review`，不是完成。

全量账号 run 的 `remote reference verify` 必须支持分批或样本模式。第一轮系统性审计默认使用 `--remote-verify-mode skip` 先产出全量基础 gates 和 repair queue；remote verify 必须在后续批次中按 repair queue 或 dataset slice 分批执行，不能让一个无 checkpoint 的巨大远端请求阻塞全部审计。

## 完成标准

账号级 process/flow 全量治理完成，至少需要：

- 全量 process / flow schema invalid = 0。
- process required-field blockers = 0。
- bilingual blocker = 0，且关键字段有 translation evidence。
- remote reference blockers = 0。
- non-elementary reference-flow closure blockers = 0，或有明确 cutoff / proxy / boundary evidence。
- repair queue 中没有 P0/P1 open entry。
- 样例批次已通过 dry-run、readback、二次 gate；至少一条用户可见 process 修复通过真实 UI validation。
- graph/compute 相关批次通过 matrix-readiness；如果缺真实 LCIA factors，则记录为 compute blocked，不能宣称 full compute-ready。
