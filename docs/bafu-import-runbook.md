# BAFU 2025 V2 导入运行手册（入口文档）

> 目标读者：接手 BAFU 全量导入的任何一个 agent 会话或人工操作者。读完本文应能：知道当前进度在哪、用哪条命令继续、遇到 blocker 怎么分诊，而不需要重新逆向工程整条流水线。最后更新：2026-06-10（v50 drain 暂停点）。更新本文时同步更新「当前状态快照」一节。

---

## 0. 三十秒定位

- **目标**：把 `inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09` 下全部 **11,747** 个 process 导入远端 TIDAS 库，每个 process 最终为 _verified_ 或 _明确 non-importable_。
- **工作区**：`RUN=.foundry/workspaces/bafu-full-import-20260607T080646Z`（下文所有 `$RUN` 指它）。
- **阶段日志**：`$RUN/batch-import-v50-pending-ready-staging/v50-phase-journal.md`
- **看进度**：跑一次 coverage 报告（§5.4），或直接看最新 `batch-import-v*/import-ledger/` 行数。
- **Profile 约束与命名规范**：`docs/import-profiles/bafu/`（constraints.md、profile.md、state-code-100-name-shapes.md、leaf-process-classification-authoring.md）。
- **所有命令从仓库根目录跑**（`tiangong-lca-data-foundry/`），不要 cd 进 `$RUN` 再跑命令——报告里的路径全部是仓库相对路径。

```bash
cd /Users/davidli/projects/workspace/tiangong-lca-data-foundry
export RUN=.foundry/workspaces/bafu-full-import-20260607T080646Z
```

---

## 1. 不变式（违反任何一条 = 返工）

1. **Canonical ledger sources**（成功证据只认这些，新批次必须全部显式携带）：
   - `$RUN/batch-import-v35-targeted-variant-commit/import-ledger`
   - `$RUN/batch-import-v41-retry-classification-commit/import-ledger`
   - `$RUN/batch-import-v42-curation-fix-commit/import-ledger`（注意：只有 flow 级证据 ok.flows.verified.jsonl，无 ok.scopes.verified.jsonl）
   - `$RUN/batch-import-v45-stale-v12-flow-rewrite-commit/import-ledger`
   - `$RUN/batch-import-v49-identity-reuse-empty-flow-skip-commit/import-ledger`
   - （v50 完成后追加 `$RUN/batch-import-v50-pending-ready-commit/import-ledger`）
2. **v12、v46、v47、v48 不是 canonical 成功来源**，只能用于 forensic 分析。v12 时代的远端写入已不可信（见 §7-9 stale support identity 事故）。
3. **candidate ≠ authoritative**：classification / location / identity / authoring 的 AI 输出必须带 task bundle 证据（`authoring_context.context_bundle_sha256`）并经 deterministic apply / projection 进库；规则推导的 repair 只是 candidate 行。
4. **当前 canonical classification decisions 文件**：`$RUN/decisions-v9-pending-ready-leaf/classification-decisions.jsonl`（21,007 行）。⚠️ batch run 的默认值仍指向旧的 `decisions-v4-leaf-category-map`，**每次必须显式传** `--library-classification-decisions`（见 §7-2）。
5. `--parallel 5` 只用于 queue/ledger 证明独立的 family masters 或 master 已 verified 的 variants；runner 的 `family-master-first` 排序 + 内部锁负责这一点，不要绕过。
6. 每个新批次：独立 `--out-dir`、独立 report / run-manifest / preflight plan / ledger；coverage 报告显式列出使用的 ledger sources。

---

## 2. 目录地图

| 路径 | 是什么 |
| --- | --- | --- |
| `inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/process-bundles/` | 11,747 个 bundle（每个含 manifest + tidas 子树），`index.json` 是 universe 契约 |
| `inputs/.../tidas/processes | flows/` | 扁平 TIDAS 数据集（11,747 process / 15,120 flow 依赖） |
| `$RUN/library-index/` | `library-entity-index.jsonl`、`scope-projection.jsonl`（resolution 的输入） |
| `$RUN/decisions-v9-pending-ready-leaf/` | **当前 canonical 决策**（classification + identity + canonical-support-mappings） |
| `$RUN/decisions-v8-pending-ready-authoring/` | v9 的投影源（v7 + 1,031 条 authored flow 决策） |
| `$RUN/library-resolution-v9-pending-ready-leaf/` | **当前 canonical resolution**：`ready-scopes.jsonl`（2,940）+ `blocked-scope-ledger.jsonl`（8,807 scopes / 166,468 行） |
| `$RUN/leaf-process-classification-authoring/` | process 分类 authoring 工作区：leaf tasks（11,704）、category-map-tasks-v50/v51（带 sha 的 bundle）、category-map-decisions-v50/（projection 输入目录） |
| `$RUN/batch-import-v50-pending-ready-staging/` | v50 阶段工作台：merged scope file、flow-product authoring（round1+v51）、phase journal |
| `$RUN/batch-import-v50-pending-ready-commit/` | v50 commit 批次（**进行中，已暂停**） |
| `$RUN/universe-coverage-v5-current-canonical/` | 最近一次 canonical coverage（v6 待生成） |
| `$RUN/census-v1-full-universe-20260609T1506Z/` | 全 universe census（注意其 aggregate 口径含非 canonical ledger，见 §7-6） |
| `specs/canonical-support/flow-properties-unit-groups.json` | 远端公共 canonical FP/UG 缓存（`dataset-support-cache-refresh` 刷新） |

## 3. 流水线总览

```
inputs (bundles)
  → dataset-library-index-build            ($RUN/library-index)
  → [authoring rounds] classification/identity/support decisions   ($RUN/decisions-vN)
  → dataset-library-decisions-apply        ($RUN/library-resolution-vN: ready-scopes + blocked ledger)
  → dataset-bafu-batch-import-run --commit ($RUN/batch-import-vN-...: per-scope materialize → 语义决策
        → dependency flow commit → support commit/reuse → process commit → readback verify → ledgers)
  → dataset-bafu-universe-coverage-report  ($RUN/universe-coverage-vN)
```

每个 scope 在 commit 批次内必须逐条通过：schema → classification leaf 门禁 → location → identity → curation QA/gate → mutation manifest（reference closure 证明）→ remote write → post-write readback verify。

---

## 4. 决策 authoring 回合（解锁 blocked scopes 的主引擎）

resolution 的 blocked ledger 决定了还差什么。按 blocker 类别做对应回合，然后重新 `dataset-library-decisions-apply` 产出更大的 ready 集。

### 4.1 缺口分析（每轮先跑）

```bash
python3 - <<'EOF'
import json, collections
RUN='.foundry/workspaces/bafu-full-import-20260607T080646Z'
uniq=collections.defaultdict(set); scopes=collections.defaultdict(set)
for line in open(f'{RUN}/library-resolution-v9-pending-ready-leaf/blocked-scope-ledger.jsonl'):
    r=json.loads(line); dep=r.get('blocking_dependency') or {}
    uniq[r['reason']].add(f"{dep.get('dataset_type')}:{dep.get('id')}")
    scopes[r['reason']].add(r['blocked_process_id'])
for k in uniq: print(f'{k}: unique_deps={len(uniq[k])} scopes={len(scopes[k])}')
EOF
```

### 4.2 process leaf 分类（category-map 路线）

1. 从 resolution blocked ledger 取 `process_classification_requires_leaf_authoring` 的 process id 集。
2. 用 `decisions-vN/classification-decisions.manual-review.jsonl` 把 process 映射到 `category_key`，按类目聚合。
3. **构建带 sha256 的 task bundle**（无现成命令，复用 v50/v51 的构建方式）：每类目一个 JSON（category_key、examples ≤12、leaf 列表路径），`task-index.json` 记录每个 bundle 的 `context_bundle_sha256`。模板见 `$RUN/leaf-process-classification-authoring/category-map-tasks-v51/`。
4. Agent 撰写决策行（每行必须含 `decision_status:"completed"`、有效 leaf `selected_code`、`authoring_context.context_bundle_sha256`、evidence）。投影前集中校验（v50/v51 实际用的脚本，flow 轮把 `category_key` 换成 `(dataset_id,dataset_version)` 键即可）：

```bash
python3 - <<'EOF'
import json, glob
TASK_DIR='LEAF_AUTHORING/category-map-tasks-vNN'   # 改成本轮目录
leaf={l.split('\t')[0]: l.rstrip('\n').split('\t')[1] for l in open(f'{TASK_DIR}/process-leaf-codes.txt')}
idx={e['category_key']: e for e in json.load(open(f'{TASK_DIR}/task-index.json'))}
rows={}; errs=[]
for f in sorted(glob.glob(f'{TASK_DIR}/authored/*.jsonl')):
    for n,line in enumerate(open(f),1):
        if not line.strip(): continue
        r=json.loads(line); ck=r.get('category_key')
        if ck not in idx: errs.append(f'{f}:{n} unexpected {ck!r}'); continue
        if ck in rows: errs.append(f'{f}:{n} duplicate {ck}'); continue
        code=r.get('selected_code')
        if code not in leaf: errs.append(f'{f}:{n} invalid code {code}'); continue
        if r.get('selected_label')!=leaf[code].split(' > ')[-1]: errs.append(f'{f}:{n} label mismatch')
        if (r.get('authoring_context') or {}).get('context_bundle_sha256')!=idx[ck]['context_bundle_sha256']: errs.append(f'{f}:{n} sha mismatch')
        if r.get('decision_status')!='completed': errs.append(f'{f}:{n} not completed')
        rows[ck]=r
print('valid', len(rows), 'missing', len(set(idx)-set(rows)), 'errors', len(errs)); [print(' ',e) for e in errs[:20]]
EOF
```

全部 `errors=0、missing=0` 才能进入第 5 步。5. 组装 projection 输入目录：复制旧 shards、**删掉本轮要重写的类目的旧行**（避免 code 冲突 → manual review），加新 shard。模板：`$RUN/leaf-process-classification-authoring/category-map-decisions-v50/`。6. 投影：

```bash
node scripts/foundry.mjs dataset-bafu-leaf-classification-category-map-project \
  --task-dir "$RUN/leaf-process-classification-authoring" \
  --category-map-decisions-dir "$RUN/leaf-process-classification-authoring/category-map-decisions-vNN" \
  --source-decisions-dir "$RUN/decisions-v9-pending-ready-leaf" \
  --out-dir "$RUN/decisions-v10-..." \
  --process-category-schema /Users/davidli/projects/workspace/tiangong-lca-cli/assets/tidas-schemas/tidas_processes_category.json \
  --flow-product-category-schema /Users/davidli/projects/workspace/tiangong-lca-cli/assets/tidas-schemas/tidas_flows_product_category.json
```

注意：投影会把 source 中仍是 broad 的 flow-product 行**删除**并转 manual review（这是设计）；projected process 决策按类目覆盖同类目全部 process。

### 4.3 flow-product leaf 分类

1. blocker `flow_classification_requires_authoring` 的 flow id 集 + `library-entity-index.jsonl` 取名。
2. 分片建 bundle（~74–90 个/片，按 source_name 排序使相似名聚簇），`task-index.json` 带每片 sha。模板：`$RUN/batch-import-v50-pending-ready-staging/flow-product-authoring-v51/`。
3. Agent 撰写（字段模板见已有 authored 文件），集中校验后**直接并入下一个 decisions-vN 的 source**（替换/追加 classification-decisions.jsonl 中的对应行），再跑 §4.2 的投影统一产出。
4. 跨轮一致性约定（已沉淀）："burned in power plant"→17100；其他 "burned in X"/热输出→17300；货运卡车→65119；处置服务→943xx；分拣厂回收料→94313；电池电极/集流体部件→46430；包装服务→85400；PV 安装→53262；厂房类 infrastructure→4100/4220/53269。

### 4.4 重新 resolution

```bash
node scripts/foundry.mjs dataset-library-decisions-apply \
  --library-index "$RUN/library-index" \
  --decisions-dir "$RUN/decisions-vNN" \
  --out-dir "$RUN/library-resolution-vNN"
```

新 `ready-scopes.jsonl` 历来是旧集的超集（v9 ⊇ 旧 11 文件并集），之后 scope-file 直接用最新这一个，不要再合并旧文件。

---

## 5. 批次执行手册

### 5.1 Preflight（只读，先跑）

```bash
node scripts/foundry.mjs dataset-bafu-batch-import-run \
  --scope-file "$RUN/library-resolution-v9-pending-ready-leaf/ready-scopes.jsonl" \
  --run-dir "$RUN" \
  --out-dir "$RUN/batch-import-vNN-preflight" \
  --process-bundles-dir "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/process-bundles" \
  --library-classification-decisions "$RUN/decisions-v9-pending-ready-leaf/classification-decisions.jsonl" \
  --pending-only --require-leaf-classification --selection-order family-master-first \
  --ledger-source-dir "$RUN/batch-import-v35-targeted-variant-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v41-retry-classification-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v42-curation-fix-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v45-stale-v12-flow-rewrite-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v49-identity-reuse-empty-flow-skip-commit/import-ledger" \
  --preflight-only
```

检查 report 里 `filtered_classification_missing/not_leaf` 必须为 0；`preflight.plan.jsonl` 只含**被选中的** scope（0 选中时为空文件，缺口要用 §4.1 方法分析，别指望 plan 文件）。

### 5.2 Commit 批次

```bash
node scripts/foundry.mjs dataset-bafu-batch-import-run \
  ...（同 preflight 全部参数，去掉 --preflight-only）... \
  --target-user-id dab05739-1a42-421b-8170-3b77146d1d64 \
  --limit 25 --parallel 5 --stop-after-blocked 3 \
  --pause-file /tmp/bafu-pause.flag \
  --commit
```

- **`--target-user-id` 是 commit 模式必填**，漏了直接抛错（§7-1）。权威来源：`$RUN/account-write-guard.json`（BAFU 目标账号 `bafudata@126.com`）——用前核对该文件，不要盲信文档里的字面值。
- 新批次先 `--limit 25 --stop-after-blocked 3` 小批验证，干净后去掉 limit 全量 drain（`--stop-after-blocked` 适当放大，如 8–15）。
- 同一 `--out-dir` 重复执行即断点续跑：已 verified/blocked 的 scope 自动过滤。
- **优雅暂停**：`touch /tmp/bafu-pause.flag`，runner 不再领新 scope，在飞的做完即停。⚠️ **恢复前必须 `rm -f /tmp/bafu-pause.flag`**：runner 每领一个 scope 前都检查该文件，残留 flag 会让重启的批次立即以 `paused` 退出（0 个新 scope）。
- **恢复任何批次前**：① `pgrep -f dataset-bafu-batch-import-run` 确认旧进程已退出（同 out-dir 并发会写坏 ledger）；② 从 `<out-dir>/import-ledger/run-manifest.json` 恢复原始参数（特别是 scopeFile——不要换成更新的 ready-scopes 文件，新 scope 留给新批次）。
- 后台运行 + 监控模板：

```bash
( node scripts/foundry.mjs dataset-bafu-batch-import-run ... --commit \
    > /tmp/bafu-vNN-commit.log 2>&1; echo "exit=$?" >> /tmp/bafu-vNN-commit.log ) &
# 进度 = ledger 行数（注意 §0 已 export RUN）：
while sleep 30; do
  wc -l "$RUN"/batch-import-vNN-commit/import-ledger/{ok.scopes.verified,blocked.scopes.human-review,failed.scopes.retry}.jsonl 2>/dev/null
  grep '^exit=' /tmp/bafu-vNN-commit.log 2>/dev/null && break
done
```

- ⚠️ runner 进程启动时加载代码；**中途改了 scripts/ 不会影响在跑的批次**，必须等它停了重启（§7-5）。

### 5.3 重试 blocked / retry scopes

- `failed.scopes.retry.jsonl`（网络/工具类，如 `commit_handoff_command_failed`）：直接重跑批次即可（retry 行不阻止重选）。
- `blocked.scopes.human-review.jsonl`：修复根因（代码规则/决策）后，用**显式 process id** 重试（显式请求绕过 blocked 过滤）：

```bash
node scripts/foundry.mjs dataset-bafu-batch-import-run ...（完整参数）... \
  --process-id <uuid1> --process-id <uuid2> --commit
```

### 5.4 Coverage 报告（每轮收尾）

```bash
node scripts/foundry.mjs dataset-bafu-universe-coverage-report \
  --input-dir "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09" \
  --run-dir "$RUN" \
  --scope-file "$RUN/library-resolution-v9-pending-ready-leaf/ready-scopes.jsonl" \
  --ledger-source-dir "$RUN/batch-import-v35-targeted-variant-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v41-retry-classification-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v42-curation-fix-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v45-stale-v12-flow-rewrite-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v49-identity-reuse-empty-flow-skip-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v50-pending-ready-commit/import-ledger" \
  --out-dir "$RUN/universe-coverage-v6-current-canonical"
```

---

## 6. Blocker 分诊表

| code | 阶段 | 含义 | 处置 |
| --- | --- | --- | --- |
| `post_authoring_curation_gate_not_ready` | finalize | curation gate 报 `blocked_needs_foundry_deterministic_cleanup` 等 | 看 scope 的 `finalize-*/curation-gate/dataset-curation-gate-report.json` 的 `entities[].deterministic_cleanup_count/blocking_item_count`，定位 cleanup 项。**当前未诊断（v50 暂停时 9 例，恢复后第一优先）** |
| `bafu_name_split_unsupported` | flow/process.authoring | 名称拆分规则链没有该模式 | 在 `scripts/commands/bafu-auto-authoring.mjs` 的 `splitBafuNamePlan` 加针对性规则 + 测试，重启批次后显式重试。已加：bark after debarking、`measured as X` 属性段 |
| `bafu_process_functional_unit_location_token_unsupported` | process.authoring | FU 文本尾部地理 token 与 geography 不符 | 已修复：回退接受 name `mixAndLocationTypes` 中的代码。旧批次的此类 blocked 直接显式重试 |
| `reference_closure_unproven` | process.finalize | 引用的 support 数据集既不在写入范围也无远端证明 | 多为 stale support identity cache（v12 渗入）。已修复：reuse 后 finalize 报 missing → 自动 invalidate + 真实写入。旧 blocked 显式重试 |
| `missing_dataset`（remote verify） | precommit verify | 远端确实没有该数据集 | 看是谁声称它 verified（`verified-support-identities.jsonl` 的 `report` 字段溯源）；v12 来源即 stale |
| `commit_handoff_command_failed` / `post_write_verify_command_failed` | commit | 网络/CLI 瞬时失败 | retryable，重跑批次 |
| `elementary_flow_requires_existing_database_match` | resolution | elementary flow 需远端 identity 匹配 | identity preflight 管线（`identity-preflight-run-elementary-shard-*` 有先例），下一大主题 |
| `flow_classification_requires_authoring` | resolution | 产品流缺 leaf 分类 | §4.3 |
| `process_classification_requires_leaf_authoring` | resolution | process 分类停在 broad | §4.2 |
| `canonical_flow_property/unit_group_reference_unresolved` | resolution | generated FP/UG 无公共 canonical 对应 | **上游治理**：远端缺 my/personkm/a/hr/kmy 五对 canonical 数据集（卡 1,370 scopes）。先 `dataset-support-cache-refresh --out /tmp/x.json` 复查，仍缺则等库方建数据集 |

## 7. 已知陷阱（每条都真实踩过）

1. **`--target-user-id` commit 必填**：错误只出现在 stderr 栈尾，report JSON 不会生成。值沿用 `dab05739-1a42-421b-8170-3b77146d1d64`。
2. **decisions 默认值是旧的**：batch run 默认 `decisions-v4-leaf-category-map`。永远显式传 `--library-classification-decisions`（当前 = decisions-v9）。
3. **preflight.plan.jsonl 只含选中 scope**：选中 0 时为空，不能用于缺口诊断；用 §4.1 的脚本。
4. **category-map 旧决策两类失效**：无 `context_bundle_sha256`（现为硬性要求）；旧 code 3510/2610 已被 schema 细分（3511/3512/3513、2611/2619…）不再是 leaf。任何"再投影"前先核对 leaf 表。
5. **改代码不影响在跑的进程**：drain 中途修的规则要等该进程停止后才生效，期间产生的同类 blocked 属预期，集中显式重试。
6. **统计口径**：census-v1 的 aggregate（1,527 verified）混入了非 canonical ledger；canonical 口径以 coverage 报告 + 五个 canonical sources 为准（v5 = 1,295）。
7. **`ready_scope=false` ≠ 不可导入**：9,025 missing ready scopes 多数只是决策闭包未完成（分类/identity/FP-UG），authoring 回合可批量解锁（v9 一轮 +218 ready、process-leaf 缺口 5,531→2,156）。
8. **scope-file 不要再合并旧文件**：library-resolution-v9 的 ready-scopes.jsonl 已是历史并集的超集。
9. **stale support identity（v12 渗入）**：`verified-support-identities.jsonl` 的 `existing_support_closeout_scan` 行可能指向 v12 报告而远端已无该数据集。现 runner 已支持 `invalidated_remote_missing` 墓碑行 + reuse 失败自动回退真实写入；同文件内 last-wins。新批次的 `--ledger-source-dir` **建议新→旧排序**，让最新墓碑/证据先占位。
10. **后台跑长批次**：stdout 只有结束时的 JSON；一定 `> log 2>&1` 且追加 `echo "exit=$?"`，进度看 ledger 行数而不是日志。

## 8. 当前状态快照（2026-06-10，用户要求暂停）

**v50 commit（`$RUN/batch-import-v50-pending-ready-commit/`，可断点续跑）**

- 1,427 个 pending ready scopes：**57 verified** / 15 blocked / 2 retry / **1,353 未开始**。
- blocked 构成：9× `post_authoring_curation_gate_not_ready`（**未诊断**）、3× name-split（代码已修）、2× FU token（代码已修）、1× reference closure（代码已修）。
- canonical verified 总数 = 1,295（v5）+ 57 = 1,352。

**决策/解锁层**

- decisions-v9（21,007 行）使全部 1,427 pending 过 leaf 门禁；resolution-v9：ready 2,940（+218 新 scope 未入批）、blocked 8,807。
- v51 authoring 回合（**已完成 authoring、未投影**）：
  - 308/308 个类目决策：`$RUN/leaf-process-classification-authoring/category-map-tasks-v51/authored/`（已校验，0 错误）
  - flow-product 14/28 片完成（1,260/2,471）：`$RUN/batch-import-v50-pending-ready-staging/flow-product-authoring-v51/authored/`（0000–0013）
- 5 对 FP/UG（my、personkm、a、hr、kmy）卡 1,370 scopes，等上游建 canonical 数据集。

**本会话代码修改（已过 `npm test` 164/164）**

- `scripts/commands/bafu-auto-authoring.mjs`：bark 拆名规则、`measured as X` 属性拆名规则、FU 地理 token 回退。
- `scripts/commands/bafu-batch-import-run.mjs`：support identity 墓碑行 + reuse 失败回退真实写入 + cache 加载 last-wins/状态过滤。
- 测试：`test/commands/bafu-auto-authoring.test.mjs`、`test/commands/bafu-batch-import-run.test.mjs` 各加用例。

**恢复清单（按序）**

1. 诊断 9 例 `post_authoring_curation_gate_not_ready`（看 curation-gate 报告的 cleanup 项；大概率是 deterministic cleanup 工具缺口 → 修代码而非沉淀 human review）。
2. 重启 v50 drain——**精确恢复命令**（scopeFile 必须沿用 merged 文件，不是 resolution-v9；原始参数以 `$RUN/batch-import-v50-pending-ready-commit/import-ledger/run-manifest.json` 为准）：

```bash
rm -f /tmp/bafu-v50-pause.flag; pgrep -f dataset-bafu-batch-import-run && echo "STOP: old run alive" || \
node scripts/foundry.mjs dataset-bafu-batch-import-run \
  --scope-file "$RUN/batch-import-v50-pending-ready-staging/ready-scopes.merged.jsonl" \
  --run-dir "$RUN" \
  --out-dir "$RUN/batch-import-v50-pending-ready-commit" \
  --process-bundles-dir "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/process-bundles" \
  --library-classification-decisions "$RUN/decisions-v9-pending-ready-leaf/classification-decisions.jsonl" \
  --target-user-id dab05739-1a42-421b-8170-3b77146d1d64 \
  --pending-only --require-leaf-classification --selection-order family-master-first \
  --ledger-source-dir "$RUN/batch-import-v35-targeted-variant-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v41-retry-classification-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v42-curation-fix-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v45-stale-v12-flow-rewrite-commit/import-ledger" \
  --ledger-source-dir "$RUN/batch-import-v49-identity-reuse-empty-flow-skip-commit/import-ledger" \
  --parallel 5 --stop-after-blocked 8 --pause-file /tmp/bafu-v50-pause.flag --commit
```

之后用 `--process-id` 显式重试 15 个 blocked + 重跑覆盖 2 个 retry。3. 完成 v51 flow 0014–0027 分片 authoring → 组装 category-map-decisions-v51 目录 → 投影 decisions-v10 → resolution-v10 → v51 批次（含 +218 及新解锁 scopes）。4. 生成 universe-coverage-v6（ledger sources = 5 canonical + v50）。5. 下一大主题：1,853 个 elementary flow 的 identity preflight（7,892 scopes）。

## 10. 完成判据（最终收尾必须全部满足）

1. `process-bundles/index.json` unique process 数 = 11,747，与 `tidas/processes` unique 数一致（coverage 报告自动核对）。
2. 最终 canonical coverage 报告中，11,747 个 process scope 全部为 verified 或明确 non-importable；non-importable 必须落档：整理 `non-importable-scopes.jsonl`（含 reason/evidence），通过 `dataset-bafu-universe-coverage-report --non-importable-scopes-file <file>` 显式登记（可重复传多个），不允许"默认缺席"。
3. canonical `ok.scopes.verified` 覆盖全部可导入 process scopes；canonical `ok.flows.verified` 覆盖全部需写入的 product flows。
4. 最终批次/coverage 报告：`blocked=0`、`failed_retryable=0`、`human_review_rows=0`、`retry_rows=0`、selected pending `0`。
5. `npm test` 与 `npm run doctor` 通过；跑 `dataset-import-completion-report` 作为收尾工件；保存最终 batch report、canonical ledger、coverage report 路径。

## 9. 本阶段产物登记（v50/v51）

| 工件 | 路径 |
| --- | --- |
| merged pending scope file（2,722） | `$RUN/batch-import-v50-pending-ready-staging/ready-scopes.merged.jsonl` |
| v50 category-map bundles/决策（48） | `$RUN/leaf-process-classification-authoring/category-map-tasks-v50/` |
| v50 projection 输入目录 | `$RUN/leaf-process-classification-authoring/category-map-decisions-v50/` |
| v50 flow-product bundles/决策（1,031） | `$RUN/batch-import-v50-pending-ready-staging/flow-product-authoring/` |
| decisions v8（投影源） | `$RUN/decisions-v8-pending-ready-authoring/` |
| **decisions v9（canonical）** | `$RUN/decisions-v9-pending-ready-leaf/` |
| **resolution v9（canonical ready 集）** | `$RUN/library-resolution-v9-pending-ready-leaf/` |
| v50 preflight（v2，1,427 全选） | `$RUN/batch-import-v50-pending-ready-preflight-v2/` |
| v50 commit 批次 | `$RUN/batch-import-v50-pending-ready-commit/` |
| v51 category bundles/决策（308） | `$RUN/leaf-process-classification-authoring/category-map-tasks-v51/` |
| v51 flow bundles/决策（14/28 片） | `$RUN/batch-import-v50-pending-ready-staging/flow-product-authoring-v51/` |
| 阶段日志 | `$RUN/batch-import-v50-pending-ready-staging/v50-phase-journal.md` |
