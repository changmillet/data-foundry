# 当前账号电力数据 CLI / Skill 摩擦的 workspace 联调结论

日期：`2026-05-05`

关联 friction：`docs/frictions/current-account-electricity-cli-skill-friction-20260505.zh-CN.md`

## 1. 当前仓库关联性判断

本次问题主要落在两个子仓库：

- `tiangong-lca-cli`：拥有 public `tiangong` 命令面，P0/P1 CLI 原语应在这里根治。
- `tiangong-lca-skills`：拥有 skill wrapper 和 `SKILL.md` 编排，应该保持薄包装，只调用 public CLI。

`lca-workspace` 的角色不是实现业务逻辑，而是把 CLI / skills / schema / data 等子仓库放到一个可联调的 pinned 状态下。相关依赖关系是：

- `tidas -> tidas-sdk -> tiangong-lca-cli`：schema validation 能力来自 SDK。
- `database-engine -> tiangong-lca-cli`：远端表结构、RLS、唯一约束会影响 publish/save-draft。
- `tiangong-lca-cli -> tiangong-lca-skills`：skills 调用 CLI，不应直接 import CLI 内部 `dist/src/lib/**`。
- `lca-workspace -> tiangong-lca-cli / tiangong-lca-skills`：workspace 只负责 pin 和联调。

## 2. 本次实际问题定位

准备联调时看到 `process save-draft` / `process refresh-references` 像是未实现，根因不是源码缺失，而是：

- `tiangong-lca-cli/bin/tiangong.js` 固定加载 `dist/src/main.js`；
- `dist/` 是本地 ignored build artifact；
- root workspace 更新后，CLI `src/` 已包含新命令，但本地 `dist/` 仍是旧构建；
- 因此 wrapper 调用本地 CLI 时跑到了旧命令表。

本地执行 `npm run build` 后，真实入口已能看到并运行：

- `tiangong process save-draft --help`
- `tiangong process refresh-references --help`
- `tiangong process verify-rows --help`

另一个 workspace 状态问题是 `database-engine` 子模块目录为空，已通过 `git submodule update --init --recursive` 恢复到 root pinned commit。

## 3. 已做更新

在 `tiangong-lca-cli` 新建本地分支：

- `fix/current-account-dataset-cli`

更新内容：

- 新增 public CLI 原语：
  - `tiangong dataset validate`
  - `tiangong dataset references rewrite`
  - `tiangong lifecyclemodel save-draft`
  - `tiangong lifecyclemodel graph`
- 新增本地数据读取/unwrap 公共模块，支持 JSON/JSONL、`rows[]`、`json_ordered` / `jsonOrdered` / `json` / `payload` 等常见行包装。
- `dataset validate` 统一调用 TIDAS SDK schema，对 flow / process / lifecyclemodel 自动识别并输出 `validation-report.json`、`valid-rows.jsonl`、`invalid-rows.jsonl`。
- `dataset references rewrite` 当前先覆盖 flow 引用在 process `referenceToFlowDataSet` 与 lifecyclemodel `@flowUUID` 中的本地重写；`--commit` 会转交 `process save-draft` 和 `lifecyclemodel save-draft`。
- `lifecyclemodel save-draft` 公开了此前只能直接 import 内部 `syncLifecyclemodelBundleRecord` 才能完成的写回路径，并在远端写入前执行 LifeCycleModelSchema 本地 gate。
- `lifecyclemodel graph` 输出 JSON / DOT / SVG，并支持 `--check-connections` 对 `processInstance` 连线缺失做机器可读 findings。

在 `tiangong-lca-skills` 新建本地分支：

- `fix/local-cli-auto-build`

更新内容：

- `scripts/lib/cli-launcher.mjs`
  - 当 wrapper 使用本地 CLI checkout 时，自动检查 `dist/src/main.js` 是否缺失或早于 `src/`、`bin/tiangong.js`、`package.json`、`tsconfig.build.json`。
  - 如果缺失或过期，先在 CLI checkout 里执行 `npm run build`，再调用 `bin/tiangong.js`。
  - 支持 `prepareLocalCli: false` 作为测试或特殊调用禁用开关。
- `test/cli-launcher.test.mjs`
  - 增加 stale local CLI 自动 rebuild 的单测。

这项更新根治的是“本地 workspace 联调误跑旧 CLI dist”的问题，不改变 CLI public command surface。

同时新增 skill：

- `current-account-dataset-review`
  - 只作为 public CLI 薄编排入口。
  - 当前支持 `validate`、`rewrite-references`、`save-lifecyclemodels`、`graph-lifecyclemodels` 四个动作。
  - 明确禁止直接 import CLI 内部 `dist/src/lib/**`，把缺口继续登记为 CLI 能力缺口。

## 4. 本次联调验证

已通过：

- `tiangong-lca-cli`
  - `npm run build`
  - `node --import tsx --test test/process-save-draft-run.test.ts test/process-refresh-references.test.ts test/process-verify-rows.test.ts`
  - `node --import tsx --test --test-name-pattern "process save-draft|process refresh-references|process verify-rows" test/cli.test.ts`
  - `node --import tsx --test test/flow-publish-version.test.ts test/flow-publish-reviewed-data.test.ts test/flow-validate-processes.test.ts`
  - `node --import tsx --test test/lifecyclemodel-publish-build.test.ts test/lifecyclemodel-validate-build.test.ts test/lifecyclemodel-resulting-process.test.ts`
  - `node --import tsx --test test/dataset-validate.test.ts test/dataset-references-rewrite.test.ts test/lifecyclemodel-save-draft-run.test.ts test/lifecyclemodel-graph.test.ts`
  - `node --import tsx --test --test-name-pattern "dataset and lifecyclemodel friction-fix|main help|lifecyclemodel namespace" test/cli.test.ts`
  - `node bin/tiangong.js dataset --help`
  - `node bin/tiangong.js dataset validate --help`
  - `node bin/tiangong.js dataset references rewrite --help`
  - `node bin/tiangong.js lifecyclemodel save-draft --help`
  - `node bin/tiangong.js lifecyclemodel graph --help`
- `tiangong-lca-skills`
  - `node --test test/cli-launcher.test.mjs`
  - `node scripts/validate-skills.mjs --cli-dir ../tiangong-lca-cli`

未能执行：

- `docpact validate-config`
- `docpact lint`

原因：当前 shell 中 `docpact` 不在 `PATH`，`uv run docpact` 也找不到可执行文件。

## 5. 仍需正式根治的产品缺口

friction 里列出的 P0/P1 大部分不是 workspace 层能根治，应进入 `tiangong-lca-cli`：

1. `tiangong dataset inventory --current-user`
2. `flow publish-version` 的 server-side next available version / conflict retry
3. `tiangong dataset verify-remote`
4. `tiangong dataset scope expand`
5. `process save-draft` 的 incremental progress、resume 和 machine-readable failure plan
6. `lifecyclemodel publish-version` / `verify`
7. 字段语义规则的可执行入口，例如 `dataset review fields --rules <rulebook>`

已补的 CLI/skill 原语：

1. `tiangong dataset validate`
2. `tiangong dataset references rewrite`
3. `tiangong lifecyclemodel save-draft`
4. `tiangong lifecyclemodel graph`
5. `current-account-dataset-review` skill 薄编排
6. 本地 CLI stale `dist/` 自动 rebuild

停止规则保持不变：commit 前必须 dry-run；partial failure 后禁止全量重跑；上游版本变化后必须复验下游引用；lifecyclemodel 不能只看 schema；远端复验必须重新查询数据库。
