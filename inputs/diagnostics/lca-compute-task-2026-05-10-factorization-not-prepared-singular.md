# LCA 计算任务失败排查与数据整改报告（2026-05-10）

## 1. 概述

本报告记录计算任务 `f1489ed4-9c71-48af-9bce-1cb1cc030c89` 的失败排查、根因分析和数据整改建议。

排查结论：

- 该任务不是 worker 停止消费、pgmq 队列堆积或数据库状态写入失败。
- 该任务表面错误为 `factorization key not prepared`，但同一 snapshot 的前序任务已经先触发 `matrix is singular`。
- 直接根因仍是用户 `dbcf5d8a-60bb-4dfc-a2b3-e8b4ab9352c0` 的私有 process 数据质量问题导致技术系数矩阵奇异。
- 本次问题与 2026-04-12 记录的“私有 process 结构重复致 matrix singular”同类，但当前用户私有数据规模和异常数量已进一步扩大。

## 2. 关联对象

| 对象 | 值 |
| --- | --- |
| 触发任务 ID | `f1489ed4-9c71-48af-9bce-1cb1cc030c89` |
| 前序失败任务 ID | `ebe129bd-b4a3-480d-89fc-66192841b28b` |
| build snapshot 任务 ID | `f2e1614e-8cae-4faf-aa5b-1129ae322e0b` |
| snapshot ID | `77416da3-4eac-465d-ba81-fe1a8794a330` |
| 用户 ID | `dbcf5d8a-60bb-4dfc-a2b3-e8b4ab9352c0` |
| 任务类型 | `solve_all_unit` |
| snapshot scope | `filtered_library`，包含 public states `100..199` + 该用户私有 process |
| snapshot process 数 | `5788` |
| public process 数 | `1983` |
| private process 数 | `3805` |

## 3. 时间线

| 时间（UTC） | 事件 |
| --- | --- |
| 2026-05-10 09:56:32 | `build_snapshot` 任务 `f2e1614e` 创建 |
| 2026-05-10 09:56:32 | `build_snapshot` 开始运行 |
| 2026-05-10 09:59:28 | snapshot `77416da3` 构建完成，状态 `ready` |
| 2026-05-10 09:59:30 | 前序 `solve_all_unit` 任务 `ebe129bd` 创建 |
| 2026-05-10 09:59:53 | `ebe129bd` 失败，错误为 `factorization failed: matrix is singular` |
| 2026-05-10 10:01:06 | 目标任务 `f1489ed4` 创建并开始运行 |
| 2026-05-10 10:01:13 | `f1489ed4` 失败，错误为 `factorization key not prepared for model 77416da3-4eac-465d-ba81-fe1a8794a330` |
| 2026-05-10 10:07:56 | 检查 pgmq metrics，`lca_jobs` 队列长度为 `0` |

## 4. 直接现象

目标任务状态：

| 字段 | 值 |
| --- | --- |
| `job_type` | `solve_all_unit` |
| `status` | `failed` |
| `created_at` | `2026-05-10 10:01:06.189+00` |
| `started_at` | `2026-05-10 10:01:06.376843+00` |
| `finished_at` | `2026-05-10 10:01:13.386782+00` |
| 运行耗时 | `00:00:07.009939` |
| error | `factorization key not prepared for model 77416da3-4eac-465d-ba81-fe1a8794a330` |

前序同 snapshot 任务状态：

| 字段 | 值 |
| --- | --- |
| `job_id` | `ebe129bd-b4a3-480d-89fc-66192841b28b` |
| `job_type` | `solve_all_unit` |
| `status` | `failed` |
| `created_at` | `2026-05-10 09:59:30.781+00` |
| `finished_at` | `2026-05-10 09:59:53.165518+00` |
| error | `factorization failed: matrix is singular` |

## 5. 排除项

### 5.1 排除 worker / pgmq 静默停滞

检查 `pgmq.metrics('lca_jobs')`：

| 字段 | 值 |
| --- | --- |
| `queue_length` | `0` |
| `queue_visible_length` | `0` |
| `total_messages` | `1017` |

目标任务已经被 worker 拉取并执行，且在 7 秒内写入 failed 状态。因此不属于 2026-04-12 的 worker pgmq 静默停滞问题。

### 5.2 排除 snapshot 构建未完成

snapshot `77416da3-4eac-465d-ba81-fe1a8794a330` 状态为 `ready`，其 snapshot artifact 也为 `ready`。

| 字段 | 值 |
| --- | --- |
| artifact format | `snapshot-hdf5:v1` |
| process_count | `5788` |
| flow_count | `80674` |
| impact_count | `25` |
| `a_nnz` | `217663` |
| `b_nnz` | `10250` |
| `c_nnz` | `224070` |
| artifact size | `20457616` bytes |

## 6. 根因分析

### 6.1 根因一：矩阵奇异

前序任务 `ebe129bd` 在同一个 snapshot 上失败为：

```text
factorization failed: matrix is singular
```

这是本次任务链的首个实质性失败。`solve_all_unit` 在执行前会先准备 factorization。factorization 阶段失败后，后续复用同一 snapshot / request 的任务无法得到 ready factorization。

### 6.2 根因二：重复 exchange 结构导致线性相关列

失败诊断中识别到：

- `39` 组不同 process 具有完全相同的 exchange 结构。
- 共涉及 `98` 个 process。
- 其中该用户私有 process 命中 `12` 组，共 `27` 个 process。
- 这些重复列会使 `M = I - A` 中的列出现线性相关，导致 UMFPACK factorization 报 `matrix is singular`。

该结论与历史事件一致。2026-04-12 的排查记录已经确认：不同 ID 但 exchange 内容完全相同的 process 会在技术系数矩阵中产生重复列，导致 singular。

### 6.3 根因三：service-loop 进一步增加数值不稳定风险

当前 snapshot 中检测到：

- `179` 个 service-loop process。
- 其中该用户私有 process 命中 `94` 个。

service-loop 指同一个 process 内同一个 `flow_id` 同时作为 Input 和 Output 出现，且 amount 相同。该模式通常表示 process 在模型中“自我提供”，会引入数值不稳定或不可解结构。

### 6.4 表面错误为何是 `factorization key not prepared`

目标任务 `f1489ed4` 的表面错误不是首因，而是前序 factorization 失败后的后续表现。

当前 worker 逻辑中，`solve_all_unit` 会先调用 `ensure_prepared`：

- 如果 factorization 状态为 `None`，则加载 snapshot 并 prepare。
- 如果 factorization 状态已经存在，则不重新 prepare。
- 前序任务 factorization failed 后，缓存中存在 failed 状态但没有 ready factorization。
- 后续任务跳过重新 prepare，进入 solve 时发现没有 ready factorization，于是报 `factorization key not prepared`。

因此：

- `matrix is singular` 是根因错误。
- `factorization key not prepared` 是后续任务在 failed cache 状态下的派生错误。

## 7. 数据问题清单

### 7.1 用户私有重复 exchange 结构 process

以下为当前命中的 12 组该用户私有 process 重复结构。每组内 process 的 exchange 指纹一致，应由业务或数据治理规则确认保留一个、合并、删除或补充差异化 exchange。

| 组 | 数量 | process ID / 名称 |
| --- | ---: | --- |
| 1 | 4 | `04e30c71-f127-4b1b-9c5e-8b8d4dc10ede` 通航建筑物建设（景洪水电站）<br>`85bc6e73-c56a-416b-b0ec-d62d7451734f` 风力发电机组安装<br>`ad4f9bfe-a8aa-4e57-9f47-80365ff0d857` WKTY cathode copper<br>`bc3f456f-78c1-4581-8fff-d1c359cb8ed2` 材料更换维护（景洪水电站） |
| 2 | 3 | `d25676e7-0150-4a92-b212-afa7d7bc7e9c` 风电场退役<br>`ddb3f84d-f7bc-4304-b059-f23175c3f936` 风电场退役<br>`f495276e-633f-46a5-af0b-10d53c52924a` 风电场退役 |
| 3 | 2 | `27460e30-3706-4349-9690-caba0252dcff` Cotton fiber logistics<br>`f2c7d44c-5923-4022-a7f6-675ed9110658` Cotton fiber transport |
| 4 | 2 | `161b29ff-6b6d-4592-b214-5d4b47e41eea` 交流电生产<br>`456d3c74-50b2-400c-a362-a308509ced54` 交流电生产 |
| 5 | 2 | `784fa283-86d2-413c-b105-48bb0de71a42` 交流电生产<br>`c416d7bf-449c-4ded-b01c-3d7cb11566ea` 交流电生产 |
| 6 | 2 | `8b2930a9-d976-47f4-b50e-72e96f7a8373` 交流电生产<br>`9e6d5c60-11b4-4919-84bb-bbc72a290cee` 交流电生产 |
| 7 | 2 | `179478ba-2be8-4852-87f7-9efabc215db7` 光伏系统运输和安装<br>`8d5b6349-e2b3-45d8-848f-ebf6f0978ff1` 光伏系统安装 |
| 8 | 2 | `9057e886-4561-4488-bccb-325ea891fbef` Dismantling and reuse of polycrystalline silicon photovoltaic modules<br>`a95db509-e67f-4c9f-926f-5caddcb43889` 光伏组件生产 |
| 9 | 2 | `1dbf3ef8-4cb4-4f82-9e0b-729040422300` alternating current production<br>`2ac1a908-c865-410c-a0cd-d32daad8e4d0` alternating current production |
| 10 | 2 | `1620052e-62a3-40af-899e-f8b604ab7b6a` Waste paper/paperboard collection<br>`6e844959-e664-439d-b682-c6dce760d3ed` Wastepaper collection |
| 11 | 2 | `b34003f9-fd04-49fc-a9b1-626da28f9ad7` Cocoa bean primary processing<br>`b4791d3a-4842-47a2-ad73-d765e2118d6b` Cocoa bean reception |
| 12 | 2 | `23d50a35-3d36-4c0b-9dd8-66da150b5a24` 交流电生产<br>`839ff96c-bd76-4a67-beee-d7a14d372062` 交流电生产 |

其中第 3、10、11 组已经在 2026-04-12 历史排查中出现，说明旧的数据问题仍未完全整改。

### 7.2 用户私有 missing reference

当前 snapshot reference 诊断：

| 问题 | 总数 | 该用户私有数量 | 非该用户数量 |
| --- | ---: | ---: | ---: |
| `missing_reference` | `81` | `81` | `0` |

说明当前 81 个 missing reference 全部来自该用户私有 process。

可操作明细如下。`team_id` / `model_id` 当前为空，说明本批异常主要需要按用户私有数据 owner 和 `modified_at` 批次追踪。

| # | process_id | version | state_code | modified_at | team_id | model_id | process_name | issue |
| ---: | --- | --- | ---: | --- | --- | --- | --- | --- |
| 1 | `ef036585-9f30-4411-8b18-5e4c9baaeb50` | `01.01.001` | `0` | `2026-05-09 09:33:47` | `` | `` | `水口山炼铜法` | `missing_reference` |
| 2 | `f5515102-9ec9-408b-a5ec-180e6258d413` | `01.01.001` | `0` | `2026-05-09 09:33:46` | `` | `` | `管道运输` | `missing_reference` |
| 3 | `f0deb4ce-8c8c-40bf-bea2-719a6633dad3` | `01.01.001` | `0` | `2026-05-09 09:33:46` | `` | `` | `水口山炼铜工艺` | `missing_reference` |
| 4 | `e90eee3e-f430-4ebb-9cc0-67d8e0c8e620` | `01.01.001` | `0` | `2026-05-09 09:33:46` | `` | `` | `锌材料冶炼` | `missing_reference` |
| 5 | `d47368e6-f287-4d10-800a-23bc3cb6905f` | `01.01.001` | `0` | `2026-05-09 09:33:36` | `` | `` | `铜基混合废物回收` | `missing_reference` |
| 6 | `d244e9ca-728f-4480-a94b-65cc44bb4f2d` | `01.01.001` | `0` | `2026-05-09 09:33:36` | `` | `` | `再生铜生产` | `missing_reference` |
| 7 | `b40afc62-2979-481b-9b12-2a99232ebec5` | `01.01.001` | `0` | `2026-05-09 09:33:34` | `` | `` | `水口山炼铜工艺` | `missing_reference` |
| 8 | `952823af-37a1-4279-9282-eef7e20ec08e` | `01.01.001` | `0` | `2026-05-09 09:33:26` | `` | `` | `火法炼铜` | `missing_reference` |
| 9 | `91182e46-b834-4d14-b2dc-082485822e28` | `01.01.001` | `0` | `2026-05-09 09:33:25` | `` | `` | `二次铜生产` | `missing_reference` |
| 10 | `2d600e46-21c7-49cc-8e54-e6080e6a512a` | `01.01.001` | `0` | `2026-05-09 09:33:16` | `` | `` | `金峰炼铜` | `missing_reference` |
| 11 | `2a2ec973-740f-43ed-b7b3-39616829e40f` | `01.01.001` | `0` | `2026-05-09 09:33:15` | `` | `` | `金峰炼铜工艺` | `missing_reference` |
| 12 | `20fd66a5-b3e6-4fe1-b1c2-3fe4d57b4ed7` | `01.01.001` | `0` | `2026-05-09 09:33:10` | `` | `` | `二次铜生产` | `missing_reference` |
| 13 | `85bc6e73-c56a-416b-b0ec-d62d7451734f` | `01.01.001` | `0` | `2026-05-09 09:30:14` | `` | `` | `风力发电机组安装` | `missing_reference` |
| 14 | `fa81aa2f-3b8d-4aff-beb7-c0fc2879ce35` | `01.01.001` | `0` | `2026-05-09 09:24:05` | `` | `` | `阴极铜生产` | `missing_reference` |
| 15 | `f8a53693-5658-4c0c-a783-7bfe8e48431f` | `01.01.001` | `0` | `2026-05-09 09:24:03` | `` | `` | `铜精矿选矿` | `missing_reference` |
| 16 | `f87fb772-7ced-4306-98fc-f72dc0aa4a0c` | `01.01.001` | `0` | `2026-05-09 09:24:03` | `` | `` | `火法炼铜` | `missing_reference` |
| 17 | `f2c54fed-7753-4846-bc07-0db145b8926f` | `01.01.001` | `0` | `2026-05-09 09:23:49` | `` | `` | `湿法炼铜` | `missing_reference` |
| 18 | `ee1b8f44-c757-4db3-af81-b09fc394e486` | `01.01.001` | `0` | `2026-05-09 09:23:33` | `` | `` | `再生铜生产` | `missing_reference` |
| 19 | `ed0a97b6-da44-4bc5-9cf2-1b6a41f7944e` | `01.01.001` | `0` | `2026-05-09 09:23:32` | `` | `` | `水口山炼铜工艺` | `missing_reference` |
| 20 | `dd04ee02-83bb-425a-8f0f-800fda237ffc` | `01.01.001` | `0` | `2026-05-09 09:23:06` | `` | `` | `阴极铜生产` | `missing_reference` |
| 21 | `da9d7f7c-f6e7-40d1-ac3a-9664a06aaab2` | `01.01.001` | `0` | `2026-05-09 09:23:03` | `` | `` | `鼓风炉炼锌` | `missing_reference` |
| 22 | `d3ff7647-ee9a-4c34-a0f9-973607976371` | `01.01.001` | `0` | `2026-05-09 09:22:45` | `` | `` | `金峰炼铜工艺` | `missing_reference` |
| 23 | `d079265d-859c-40ab-8a2f-0029b4b90abf` | `01.01.001` | `0` | `2026-05-09 09:22:43` | `` | `` | `铜精矿开采` | `missing_reference` |
| 24 | `ca25338c-6e4a-4cf7-9578-a5fb48f86ef5` | `01.01.001` | `0` | `2026-05-09 09:22:23` | `` | `` | `阴极铜生产` | `missing_reference` |
| 25 | `c8a96cc1-ec80-45db-8a9a-f70903894f66` | `01.01.001` | `0` | `2026-05-09 09:22:22` | `` | `` | `铜灰回收` | `missing_reference` |
| 26 | `bc3f456f-78c1-4581-8fff-d1c359cb8ed2` | `01.01.001` | `0` | `2026-05-09 09:22:02` | `` | `` | `材料更换维护（景洪水电站）` | `missing_reference` |
| 27 | `b833816c-deea-4ebf-ab63-ae86deedca77` | `01.01.001` | `0` | `2026-05-09 09:21:56` | `` | `` | `再生铜生产（火法）` | `missing_reference` |
| 28 | `b3ef62f9-088d-492b-8938-ec469ad6e41d` | `01.01.001` | `0` | `2026-05-09 09:21:43` | `` | `` | `硫化铜矿的开采选矿` | `missing_reference` |
| 29 | `b02f3bf6-f992-4fd4-a784-c27984b94958` | `01.01.001` | `0` | `2026-05-09 09:21:42` | `` | `` | `金峰炼铜工艺` | `missing_reference` |
| 30 | `ad6e87ec-089d-41f4-9188-e0c2d94c317d` | `01.01.001` | `0` | `2026-05-09 09:21:36` | `` | `` | `湿法炼铜` | `missing_reference` |
| 31 | `ad4f9bfe-a8aa-4e57-9f47-80365ff0d857` | `01.01.001` | `0` | `2026-05-09 09:21:32` | `` | `` | `WKTY阴极铜` | `missing_reference` |
| 32 | `a99caf49-b8a6-4203-aaf6-1593a591dfde` | `01.01.001` | `0` | `2026-05-09 09:21:23` | `` | `` | `铜火法冶金阳极泥回收` | `missing_reference` |
| 33 | `a958e734-7de8-4ec3-bfe8-e37ab0372575` | `01.01.001` | `0` | `2026-05-09 09:21:15` | `` | `` | `湿法提铜` | `missing_reference` |
| 34 | `a813d3cb-4208-4f2f-a158-af007ed8149b` | `01.01.001` | `0` | `2026-05-09 09:21:12` | `` | `` | `火法炼铜` | `missing_reference` |
| 35 | `a34851c5-f882-4f2a-8e3b-95b823062228` | `01.01.001` | `0` | `2026-05-09 09:21:05` | `` | `` | `水口山炼铜工艺` | `missing_reference` |
| 36 | `9bce3559-8781-4d5d-a222-a114bd0dbf7b` | `01.01.001` | `0` | `2026-05-09 09:20:53` | `` | `` | `锌冶金工艺` | `missing_reference` |
| 37 | `93224dc3-bca6-4180-a1a4-b594a8377b96` | `01.01.001` | `0` | `2026-05-09 09:20:27` | `` | `` | `金峰炼铜工艺` | `missing_reference` |
| 38 | `92f5c57a-34cb-43b1-91e6-470cb688bd95` | `01.01.001` | `0` | `2026-05-09 09:20:22` | `` | `` | `铜基混合废料再生工艺——冶炼过程` | `missing_reference` |
| 39 | `9266dcba-fa44-40d3-aa3c-816350aa3e89` | `01.01.001` | `0` | `2026-05-09 09:20:22` | `` | `` | `湿法炼铜` | `missing_reference` |
| 40 | `8e8baaee-8aad-4473-8e49-aa5438f6bb6a` | `01.01.001` | `0` | `2026-05-09 09:20:09` | `` | `` | `废锰-锌电池回收` | `missing_reference` |
| 41 | `8d127e5e-5376-4f15-b2f4-091f8a8c2384` | `01.01.001` | `0` | `2026-05-09 09:19:56` | `` | `` | `生物湿法冶金回收废锌-锰电池` | `missing_reference` |
| 42 | `8c974a4b-eca1-4c08-a00d-90bfd5b37dc8` | `01.01.001` | `0` | `2026-05-09 09:19:55` | `` | `` | `国内铜精矿运输` | `missing_reference` |
| 43 | `89f07066-c942-4ae4-98cf-46b4e5c20b7d` | `01.01.001` | `0` | `2026-05-09 09:19:55` | `` | `` | `块煤开采` | `missing_reference` |
| 44 | `882c077a-a4df-4ff2-afa3-28123a94c060` | `01.01.001` | `0` | `2026-05-09 09:19:43` | `` | `` | `湿法炼铜` | `missing_reference` |
| 45 | `813142cd-f6f7-49b0-ba67-378e8d2fe802` | `01.01.001` | `0` | `2026-05-09 09:19:35` | `` | `` | `硫酸铜矿开采和选矿作业` | `missing_reference` |
| 46 | `7f5d43b7-4f59-43d0-9a40-c8b5c42216e2` | `01.01.001` | `0` | `2026-05-09 09:19:34` | `` | `` | `火法炼铜冶炼炉渣回收` | `missing_reference` |
| 47 | `7e5aaca3-ede1-4786-a1a9-ac03929e443e` | `01.01.001` | `0` | `2026-05-09 09:19:34` | `` | `` | `铜精矿（品位-16%）生产` | `missing_reference` |
| 48 | `79674901-a9bd-4274-ab4e-76b61f3dd0a8` | `01.01.001` | `0` | `2026-05-09 09:19:25` | `` | `` | `铜基混合废料再生工艺——精炼过程` | `missing_reference` |
| 49 | `78844f17-ce45-45d8-8526-dd8cb69559aa` | `01.01.001` | `0` | `2026-05-09 09:19:24` | `` | `` | `阴极铜生产` | `missing_reference` |
| 50 | `6e68b9b4-983d-4293-8525-3afa8c011572` | `01.01.001` | `0` | `2026-05-09 09:19:14` | `` | `` | `二次铜生产` | `missing_reference` |
| 51 | `6d673f62-64c2-4415-9886-f3ab307be5c8` | `01.01.001` | `0` | `2026-05-09 09:19:14` | `` | `` | `铜基混合废料再生工艺——金银回收过程` | `missing_reference` |
| 52 | `68c7df0d-8b4d-42f5-8d62-9cafe003ffa2` | `01.01.001` | `0` | `2026-05-09 09:19:04` | `` | `` | `阴极铜生产` | `missing_reference` |
| 53 | `646a64eb-e955-44fa-b3f1-0b345fc7437b` | `01.01.001` | `0` | `2026-05-09 09:19:03` | `` | `` | `铜基混合废料再生工艺——电解过程` | `missing_reference` |
| 54 | `639e223b-dda2-476a-b8e7-44fceae74386` | `01.01.001` | `0` | `2026-05-09 09:19:03` | `` | `` | `进口再生铜资源化` | `missing_reference` |
| 55 | `632ea2c6-0980-47dd-920e-14d04ffc957c` | `01.01.001` | `0` | `2026-05-09 09:18:55` | `` | `` | `阴极铜生产` | `missing_reference` |
| 56 | `60892f52-7349-46c9-a06b-c27a173b13e5` | `01.01.001` | `0` | `2026-05-09 09:18:52` | `` | `` | `再生铜生产` | `missing_reference` |
| 57 | `5ca7f27a-b6cb-432a-a13a-2ea4b50375eb` | `01.01.001` | `0` | `2026-05-09 09:18:42` | `` | `` | `铅锌矿开采和选矿` | `missing_reference` |
| 58 | `5bc37db6-ec78-4076-b235-0c35ebefd79f` | `01.01.001` | `0` | `2026-05-09 09:18:37` | `` | `` | `湿法冶锌` | `missing_reference` |
| 59 | `5767ce2f-6154-4a36-9c9d-a68c74c2c6bb` | `01.01.001` | `0` | `2026-05-09 09:18:32` | `` | `` | `铜基混合废料再生工艺——矿渣浮选过程` | `missing_reference` |
| 60 | `5668ea3d-ba8d-4de7-b6c0-6edafb209c73` | `01.01.001` | `0` | `2026-05-09 09:18:22` | `` | `` | `再生铜生产` | `missing_reference` |
| 61 | `51e10f52-852d-4458-b044-19cafd7ea35f` | `01.01.001` | `0` | `2026-05-09 09:18:14` | `` | `` | `铅锌矿的冶炼` | `missing_reference` |
| 62 | `4ee80fee-83ce-4de1-b5c7-e49ecdc4051d` | `01.01.001` | `0` | `2026-05-09 09:18:02` | `` | `` | `液化天然气开采` | `missing_reference` |
| 63 | `4b15aee4-9c8b-4a1e-8891-8084162b3147` | `01.01.001` | `0` | `2026-05-09 09:17:52` | `` | `` | `电力动力铁路运输` | `missing_reference` |
| 64 | `496221e8-40ff-43d0-a63b-d3a76c6547a7` | `01.01.001` | `0` | `2026-05-09 09:17:50` | `` | `` | `精炼铜生产` | `missing_reference` |
| 65 | `42e72363-d98f-4bbe-976f-39f4e91ccf10` | `01.01.001` | `0` | `2026-05-09 09:17:42` | `` | `` | `生物湿法冶金回收废锌-锰电池` | `missing_reference` |
| 66 | `3bdc903d-05d1-4bec-9a31-cc5320851fc1` | `01.01.001` | `0` | `2026-05-09 09:17:24` | `` | `` | `铜基混合废料再生工艺——锌回收过程` | `missing_reference` |
| 67 | `35d14ac5-74f8-4c0d-8ad9-f2c7ecae5bc1` | `01.01.001` | `0` | `2026-05-09 09:17:13` | `` | `` | `铅锌矿的采矿与选矿` | `missing_reference` |
| 68 | `330d8219-68f1-4afa-b02e-29d31507bf50` | `01.01.001` | `0` | `2026-05-09 09:17:03` | `` | `` | `国内废铜资源化` | `missing_reference` |
| 69 | `2fbcb62d-0a05-434c-abf2-823dc3a81967` | `01.01.001` | `0` | `2026-05-09 09:16:54` | `` | `` | `石英石开采` | `missing_reference` |
| 70 | `2e35ca7b-8d9e-43b2-9b49-c644534586b4` | `01.01.001` | `0` | `2026-05-09 09:16:52` | `` | `` | `铜精矿生产` | `missing_reference` |
| 71 | `1e87e52f-070b-4151-9ef9-e75212f06951` | `01.01.001` | `0` | `2026-05-09 09:16:32` | `` | `` | `进口铜精矿运输` | `missing_reference` |
| 72 | `1d279460-b6dc-4e6e-85c5-4c038a551863` | `01.01.001` | `0` | `2026-05-09 09:16:22` | `` | `` | `电力生产` | `missing_reference` |
| 73 | `19f0f2b2-8923-4f24-ba16-b28749ce37e3` | `01.01.001` | `0` | `2026-05-09 09:16:06` | `` | `` | `原生铜生产` | `missing_reference` |
| 74 | `1755c557-bcf0-4b97-9422-8d5c2e773dab` | `01.01.001` | `0` | `2026-05-09 09:16:03` | `` | `` | `火法炼铜` | `missing_reference` |
| 75 | `1458ff32-e9ba-4b95-a9c7-35c5a6d20654` | `01.01.001` | `0` | `2026-05-09 09:15:52` | `` | `` | `铜精矿开采、选矿过程` | `missing_reference` |
| 76 | `13dbbbf9-4f4b-427b-a6dd-9f40397b91ab` | `01.01.001` | `0` | `2026-05-09 09:15:52` | `` | `` | `国内铜精矿运输` | `missing_reference` |
| 77 | `119409ea-c957-43a7-9518-36a5e00cbaf6` | `01.01.001` | `0` | `2026-05-09 09:15:45` | `` | `` | `火法炼铜` | `missing_reference` |
| 78 | `133d91e7-b4cb-47a0-bb92-8acf4b615156` | `01.01.001` | `0` | `2026-05-09 09:15:42` | `` | `` | `` | `missing_reference` |
| 79 | `04e30c71-f127-4b1b-9c5e-8b8d4dc10ede` | `01.01.001` | `0` | `2026-05-09 09:15:11` | `` | `` | `通航建筑物建设（景洪水电站）` | `missing_reference` |
| 80 | `0101971a-86de-409a-a0d7-6ae925c89ac0` | `01.01.001` | `0` | `2026-05-09 09:15:02` | `` | `` | `公路运输` | `missing_reference` |
| 81 | `0016d864-1d9b-4f54-83b3-a1c61ba9564d` | `01.01.001` | `0` | `2026-05-09 09:15:02` | `` | `` | `阴极铜生产` | `missing_reference` |

### 7.3 用户私有 service-loop

当前 service-loop 诊断：

| 指标 | 数量 |
| --- | ---: |
| snapshot 总 service-loop | `179` |
| 该用户私有 service-loop | `94` |
| 非该用户 service-loop | `85` |

service-loop 不一定每个都会单独导致 singular，但在当前 already-singular 的数据集中，它是高优先级整改对象。

可操作明细如下。每一行代表同一 process 内同一个 `flow_id` 同时作为 Input 和 Output 出现，且 amount 相同。

| # | process_id | version | state_code | modified_at | team_id | process_name | loop_flow_id | flow_name | amount |
| ---: | --- | --- | ---: | --- | --- | --- | --- | --- | ---: |
| 1 | `c1982139-9f0e-4357-99d6-f3e2edfc6fe4` | `01.01.001` | `0` | `2026-05-09 09:33:35` | `` | `单晶硅光伏系统` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `10.963981031153567` |
| 2 | `b03aac49-1c47-49fd-af3c-57db44336d95` | `01.01.004` | `0` | `2026-05-09 09:33:26` | `` | `超纯水制备` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `1.25e-05` |
| 3 | `9ec5a532-db88-426b-9dce-ec3d56b18bf1` | `01.01.001` | `0` | `2026-05-09 09:33:24` | `` | `多晶硅光伏组件打包与运输` | `5bdcaef5-1689-4ad5-8ce2-c1543b0ff811` | `` | `7105` |
| 4 | `179478ba-2be8-4852-87f7-9efabc215db7` | `01.01.002` | `0` | `2026-05-09 09:30:45` | `` | `光伏系统运输和安装` | `3f66ec10-aedd-4032-baff-5f7764c1670e` | `` | `1` |
| 5 | `f054d521-e345-4a51-b5f9-5f7f9966002c` | `01.01.001` | `0` | `2026-05-09 09:23:43` | `` | `风机吊装（牦牛坪风电场）` | `e4ae4246-b93d-44ab-bb73-58671139c50b` | `` | `1` |
| 6 | `cbd75fea-8cb7-4456-8906-135206b944e0` | `01.01.001` | `0` | `2026-05-09 09:22:33` | `` | `多晶硅光伏系统----发电test` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `0.0000000010906450658928013` |
| 7 | `6f41b295-a4fa-427c-b169-cfda4ed73ffd` | `01.01.001` | `0` | `2026-05-09 09:19:14` | `` | `原料运输（陆良云伊电投）` | `3f66ec10-aedd-4032-baff-5f7764c1670e` | `` | `1` |
| 8 | `42999753-3bac-41e6-9b3a-a3f412da467a` | `01.01.001` | `0` | `2026-05-09 09:17:33` | `` | `BOS系统打包与运输` | `a71fe450-5ce6-4522-86a4-9a265924de96` | `` | `1` |
| 9 | `391436c5-ae63-45b1-93b3-1eb9063277ed` | `01.01.001` | `0` | `2026-05-09 09:17:22` | `` | `单晶硅光伏系统----发电test` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `0.00000022741542081924933` |
| 10 | `33e91b48-4d2c-4292-8fe1-b0e02c7e09e1` | `01.01.001` | `0` | `2026-05-09 09:17:15` | `` | `单晶硅光伏组件打包与运输` | `fbfc81aa-aefd-49ec-aaf6-81b9416a7b78` | `` | `6371` |
| 11 | `1714bb7f-ced9-4c3f-8fac-af40ef8dd5fb` | `01.01.001` | `0` | `2026-05-09 09:15:54` | `` | `多晶硅光伏系统` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `0.021169590309552195` |
| 12 | `ffd5b4cb-03cc-4693-b13a-68ef1fd8e305` | `01.01.002` | `0` | `2026-05-09 09:08:25` | `` | `交流电生产` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `2.2741542081927678e-7` |
| 13 | `eec0e09b-6fd5-41c9-9a12-41300c9e6cfa` | `01.01.002` | `0` | `2026-05-09 09:07:58` | `` | `交流电生产` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `3.088638983087562e-11` |
| 14 | `d31ace68-c949-4800-ad2e-dba08468da7f` | `01.01.002` | `0` | `2026-05-09 09:06:42` | `` | `交流电生产` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `6.517055287628942e-10` |
| 15 | `ce0e0b88-7c47-4e7c-b94e-35233858ce57` | `01.01.002` | `0` | `2026-05-09 09:06:17` | `` | `交流电生产` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `6.103454647725996e-10` |
| 16 | `bee7c038-5059-4bf0-83a3-b313ba541f22` | `01.01.002` | `0` | `2026-05-09 09:05:34` | `` | `交流电生产` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `3.088638983087562e-11` |
| 17 | `8d5b6349-e2b3-45d8-848f-ebf6f0978ff1` | `01.01.002` | `0` | `2026-05-09 09:04:01` | `` | `光伏系统安装` | `3f66ec10-aedd-4032-baff-5f7764c1670e` | `` | `1` |
| 18 | `7b12c46d-8070-4b1c-8325-dd4143fccbb2` | `01.01.002` | `0` | `2026-05-09 09:03:40` | `` | `交流电生产` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `2.946612271596606e-11` |
| 19 | `21084c23-87a9-4e84-af4e-d8b45550a1a2` | `01.01.002` | `0` | `2026-05-09 08:59:30` | `` | `交流电生产` | `35cd1d1c-188f-402e-a57c-02df5e47c76d` | `` | `3.088638983087562e-11` |
| 20 | `aed74499-85de-4b69-b4cc-1dafe55f7f17` | `01.01.001` | `0` | `2026-05-09 08:54:02` | `` | `风力发电机组运输` | `512275a9-031a-40ae-a10f-55b26ceb192d` | `` | `15` |
| 21 | `4368e5e3-c7a3-4afc-9a2b-2de0deeacfef` | `01.01.000` | `0` | `2026-04-10 09:44:37` | `` | `四季豆收获和农场大门产出` | `ddf54bf7-5413-49f1-bf1c-2f3cc2724695` | `` | `1` |
| 22 | `f4e8b8f4-53b7-4fd5-b6df-d7286bee583b` | `01.01.000` | `0` | `2026-04-10 09:44:36` | `` | `青豌豆生产` | `b0d5d264-fa1a-4230-8bf8-423b8125d8a7` | `` | `1` |
| 23 | `e7d10314-df5a-4f79-b6fb-329648310940` | `01.01.000` | `0` | `2026-04-10 09:44:35` | `` | `绿蚕豆和马豆的收获及农场门处理` | `2a6f5664-5fda-45e8-81c2-989d822b3417` | `` | `1` |
| 24 | `5fe57a48-9354-47f2-a78d-41b70c2955ea` | `01.01.000` | `0` | `2026-04-10 09:44:34` | `` | `牛油果采收与农场大门交付` | `30de963a-f2a7-42d4-9a56-7993627510b4` | `` | `1` |
| 25 | `67c682e1-3f34-4256-b120-012ed81bda11` | `01.01.000` | `0` | `2026-04-10 09:44:33` | `` | `香蕉收获` | `7c496507-1583-4181-9a3a-2cf56d54b99c` | `` | `1` |
| 26 | `b25b1508-d5cb-4117-a0c7-1a4ba45bfed1` | `01.01.000` | `0` | `2026-04-10 09:44:27` | `` | `农场门口收获与发运` | `1d90292a-2ed1-4a03-b9ed-47741132ac44` | `` | `1` |
| 27 | `de0ca286-2e06-4eda-aacf-04a675a24802` | `01.01.000` | `0` | `2026-04-10 09:44:23` | `` | `果园栽培与收获` | `d79c5399-1e8f-4cc8-87e7-ca7ce7f218a9` | `` | `1` |
| 28 | `3c80cab1-4c30-4b04-8387-88e0607f4688` | `01.01.000` | `0` | `2026-04-10 09:44:19` | `` | `带壳榛子的干燥与基本处理` | `7e2e5ae9-0997-4bef-8292-0fb8592dac09` | `` | `1` |
| 29 | `7317d854-3433-4431-9499-1bb0ca839b84` | `01.01.000` | `0` | `2026-04-10 09:44:09` | `` | `亚麻籽收获与农场大门处理` | `b5ee43d6-cd60-48df-8ac2-c3bc5ca9011f` | `` | `1` |
| 30 | `899eca4f-ca55-4e7f-b751-d1a0ed15aa04` | `01.01.000` | `0` | `2026-04-10 09:43:50` | `` | `干燥可可豆` | `3c54da37-f1ab-4b4c-8363-5c32b638005c` | `` | `1` |
| 31 | `aaab17f4-da9a-4cdd-a089-d999d0f745f8` | `01.01.000` | `0` | `2026-04-10 09:43:28` | `` | `芋头作物管理` | `e510909a-6352-44e7-b616-336d7fd10549` | `` | `1` |
| 32 | `47163f0a-c0f4-4388-bbb3-b149ef77d662` | `01.01.000` | `0` | `2026-04-10 09:42:58` | `` | `其他针叶材原木` | `3dbbedd2-fb9d-478e-a4b4-4a76a4d97804` | `` | `1` |
| 33 | `b9e81003-4a21-45eb-8044-619be52f6b4f` | `01.01.000` | `0` | `2026-04-10 09:42:57` | `` | `森林路边处理与装载准备` | `b8b84d78-13c2-4dab-9b6d-8e7d9dc32f3b` | `` | `1` |
| 34 | `66d815b1-96c1-4619-b5b8-92d77892fe25` | `01.01.000` | `0` | `2026-04-10 09:42:56` | `` | `采伐集材至路边并堆垛` | `b8b84d78-13c2-4dab-9b6d-8e7d9dc32f3b` | `` | `850` |
| 35 | `4e5b66d3-e2e8-498b-b52c-7d9670fdb73e` | `01.01.000` | `0` | `2026-04-10 09:42:56` | `` | `针叶木原木（其他工业用原木分类）` | `3dbbedd2-fb9d-478e-a4b4-4a76a4d97804` | `` | `900` |
| 36 | `30e0071e-534f-43b8-bf3b-80eda50eb3da` | `01.01.000` | `0` | `2026-04-10 09:42:37` | `` | `鳕形目幼鱼（鱼苗），活体，运送至海水养殖场` | `7c71a876-d795-4344-9158-e5603fbe2601` | `` | `1` |
| 37 | `a965d176-8711-4eb6-9ca9-42a8d8609776` | `01.01.000` | `0` | `2026-04-10 09:42:35` | `` | `野生岩龙虾及其他海螯虾，活的，鲜的或冷藏的` | `d4c49353-3a5b-4383-a618-8b1e483b0797` | `` | `1` |
| 38 | `84ed33df-88c4-4945-bb3f-b1db89a04990` | `01.01.000` | `0` | `2026-04-10 09:42:33` | `` | `野生蟹，活的，鲜或冷藏` | `4e91c015-0fa1-496a-88bc-63f518f31664` | `` | `1` |
| 39 | `5e11e2b1-e59c-4d98-a25f-e172da57af6a` | `01.01.000` | `0` | `2026-04-10 09:42:31` | `` | `野生龙虾（Homarus 属），活体，新鲜或冷藏` | `0af2e3ca-6017-4539-91ea-9473c403da6c` | `` | `1` |
| 40 | `87a8b2bd-beeb-4c49-a666-d4e70adc9053` | `01.01.000` | `0` | `2026-04-10 09:42:26` | `` | `船上渔获处理` | `6f53adcb-feaa-49b3-b648-4b48db863541` | `` | `1` |
| 41 | `51906161-a75c-4893-bf7e-f1155a1babb4` | `01.01.000` | `0` | `2026-04-10 09:42:26` | `` | `野生虾/对虾的登陆与卸货` | `6f53adcb-feaa-49b3-b648-4b48db863541` | `` | `1` |
| 42 | `770329b7-5ad1-4afb-9199-cb12a4f32652` | `01.01.000` | `0` | `2026-04-10 09:42:21` | `` | `野生扇贝（船上处理至登陆品质）` | `74bb26c8-c7da-413f-a392-e0795415bb0f` | `` | `1` |
| 43 | `c5c9570e-b3e8-43c8-8fc8-01fad800f24f` | `01.01.000` | `0` | `2026-04-10 09:42:09` | `` | `海参幼体（苗种）供应` | `84814111-6d8d-4386-b685-68a1ee2c6c04` | `` | `1` |
| 44 | `2a7de2ab-f57e-4822-adf8-72f3eae30034` | `01.01.000` | `0` | `2026-04-10 09:41:53` | `` | `冰雪` | `1ff2c05e-4b5d-4971-9883-65f2a6b0007f` | `` | `1` |
| 45 | `df7b1a3e-759d-407a-9829-2c8eb4523161` | `01.01.000` | `0` | `2026-04-10 09:41:35` | `` | `次烟煤` | `a3573912-328b-402e-8f64-f39e34a6a00c` | `` | `1` |
| 46 | `d3ef1c65-4c51-41a5-9f18-5c06a5edf0cd` | `01.01.000` | `0` | `2026-04-10 09:41:33` | `` | `次烟煤` | `a3573912-328b-402e-8f64-f39e34a6a00c` | `` | `1` |
| 47 | `30e27a29-3648-4fcf-af96-c7790e8d3f15` | `01.01.000` | `0` | `2026-04-10 09:41:13` | `` | `整条鳕形目鱼类，在加工厂接收` | `a2d4cc31-2a32-4c1e-a8d9-f0c90f770314` | `` | `1` |
| 48 | `0dcb597e-f086-479f-b5fb-2889c1e7de54` | `01.01.000` | `0` | `2026-04-10 09:41:08` | `` | `活珍珠鸡运送至屠宰场` | `cf28b5aa-56c1-46b7-9ec5-b91d3daaf2d3` | `` | `1` |
| 49 | `b7851896-1bc2-43cf-aa24-58391d0ad107` | `01.01.000` | `0` | `2026-04-10 09:40:58` | `` | `着陆与卸载` | `e51735cd-08ba-4052-bb11-0e5d936b87f2` | `` | `1` |
| 50 | `5576a9ac-19ff-4f3d-8318-3f3bb6d8b58c` | `01.01.000` | `0` | `2026-04-10 09:40:57` | `` | `冷冻远洋鱼类的登陆与卸载` | `c8aa403f-97b6-44b2-afa8-862d825fec2f` | `` | `1` |
| 51 | `7bd010cd-5bf3-4aa1-89dc-97053e310200` | `01.01.000` | `0` | `2026-04-10 09:40:22` | `` | `葡萄干` | `e2741aa4-2dfe-487f-a0fe-fd5d6dd3302d` | `` | `1` |
| 52 | `af0c8087-a87b-4a6c-8a42-a34ccc6f627d` | `01.01.000` | `0` | `2026-04-10 09:39:37` | `` | `脱脂残渣处理` | `98984fb7-e8b6-4d33-b6c7-130f38acbf15` | `` | `1` |
| 53 | `c6ea2e6f-38f2-458e-8f4b-bca120343dc0` | `01.01.000` | `0` | `2026-04-10 09:39:24` | `` | `油籽运输至榨油厂` | `be87e81e-303f-4607-a1f5-0cb5ef2d8f74` | `` | `1` |
| 54 | `c888462d-064e-448b-9e41-c0e508b5215f` | `01.01.000` | `0` | `2026-04-10 09:39:19` | `` | `生水牛乳运输` | `790fcd48-b398-4049-898a-f9535f08f97b` | `` | `1` |
| 55 | `54c9298b-3098-481a-86c0-33613eabf5bd` | `01.01.000` | `0` | `2026-04-10 09:39:18` | `` | `羊奶奶酪包装与发运` | `d2800438-b79a-4065-98ab-b7b0fe10ce97` | `` | `1` |
| 56 | `b3e857b1-f8fd-43d9-8c76-f95be2621107` | `01.01.000` | `0` | `2026-04-10 09:39:03` | `` | `新鲜橄榄` | `b07470dd-3947-4e02-8058-11967225f927` | `` | `1` |
| 57 | `dcee7047-c108-4f8c-8739-f434dfb78bc9` | `01.01.000` | `0` | `2026-04-10 09:38:41` | `` | `酿酒葡萄` | `fb08aee8-0e5a-4b82-8995-d16b5cc214c6` | `` | `1` |
| 58 | `5ffa10ca-6643-4d8f-b56b-637024f8800e` | `01.01.000` | `0` | `2026-04-10 09:38:37` | `` | `带壳鸡蛋运输` | `175f80a5-37cf-4df7-ae06-8987c70b052c` | `` | `1` |
| 59 | `7b15f100-9b4c-4cd2-b355-04e79480ee76` | `01.01.000` | `0` | `2026-04-10 09:38:27` | `` | `轧花棉纤维` | `dd9f2248-bc28-43b9-8d57-d77756754f4d` | `` | `1` |
| 60 | `78588234-9985-4a07-b001-2679f7620286` | `01.01.000` | `0` | `2026-04-10 09:38:15` | `` | `清洁后的胡椒浆果（Piper spp.）` | `99d5d3c5-870f-458f-b492-a610d37c8034` | `` | `1` |
| 61 | `709db99f-06e4-41b9-ac55-2a88b367552f` | `01.01.000` | `0` | `2026-04-10 09:37:50` | `` | `本色棉毛圈织物的前处理` | `61be29ff-288e-4570-8335-4e03760c9255` | `` | `1` |
| 62 | `821c07c0-8af9-4046-8f1d-1f4344cc3b14` | `01.01.000` | `0` | `2026-04-10 09:37:50` | `` | `棉质毛巾布的漂白和/或染色` | `61be29ff-288e-4570-8335-4e03760c9255` | `` | `1` |
| 63 | `eccac063-cfb9-4e37-9e81-32a486253bd8` | `01.01.000` | `0` | `2026-04-10 09:37:48` | `` | `棉毛巾布的热干燥与后整理` | `61be29ff-288e-4570-8335-4e03760c9255` | `` | `1` |
| 64 | `51175211-f419-426a-b45f-196c8dc7be00` | `01.01.000` | `0` | `2026-04-10 09:37:45` | `` | `染色/后整理废水的现场废水处理` | `d2d44ce1-c0f4-461d-9413-f4b33e0d200f` | `` | `0.001` |
| 65 | `e9fb9672-3cfd-4c97-8b75-a386ec84bf01` | `01.01.000` | `0` | `2026-04-10 09:37:08` | `` | `棉纤维运输` | `dd9f2248-bc28-43b9-8d57-d77756754f4d` | `` | `1` |
| 66 | `7a1a1e9a-9d58-4e2a-bad5-b9326c034b0c` | `01.01.000` | `0` | `2026-04-10 09:37:04` | `` | `棉绒生产` | `dd9f2248-bc28-43b9-8d57-d77756754f4d` | `` | `1` |
| 67 | `c2fdfcff-541c-485a-8d16-855aecb447e8` | `01.01.000` | `0` | `2026-04-10 09:36:58` | `` | `棉纤维运输至纺织厂` | `dd9f2248-bc28-43b9-8d57-d77756754f4d` | `` | `1` |
| 68 | `f2c7d44c-5923-4022-a7f6-675ed9110658` | `01.01.000` | `0` | `2026-04-10 09:36:57` | `` | `棉纤维运输` | `dd9f2248-bc28-43b9-8d57-d77756754f4d` | `` | `1` |
| 69 | `27460e30-3706-4349-9690-caba0252dcff` | `01.01.000` | `0` | `2026-04-10 09:36:53` | `` | `棉纤维物流` | `dd9f2248-bc28-43b9-8d57-d77756754f4d` | `` | `1` |
| 70 | `e8c7b41f-214c-46c0-a744-50b8ac747597` | `01.01.000` | `0` | `2026-04-10 09:36:36` | `` | `未浸渍的木制铁路或有轨电车枕木（横枕）` | `3dbbedd2-fb9d-478e-a4b4-4a76a4d97804` | `` | `1.0` |
| 71 | `58df0e2e-7037-44a3-b12b-a911efad1b8e` | `01.01.000` | `0` | `2026-04-10 09:36:32` | `` | `竹条/竹片干燥` | `0fe2e549-0389-46bd-b0e0-a5cd53585138` | `` | `1` |
| 72 | `abbf0d7d-949a-4736-8647-2975ff5c94e8` | `01.01.000` | `0` | `2026-04-10 09:35:24` | `` | `铀-235浓缩` | `1fd727d2-a1bf-430d-80ba-2bfa822ea822` | `` | `1` |
| 73 | `b5b5b91a-9d13-4346-b282-79f0fecd3ced` | `01.01.000` | `0` | `2026-04-10 09:34:49` | `` | `玻璃板清洗` | `1b43024e-16ea-42d2-830d-329c4a2abc3d` | `` | `1` |
| 74 | `d58565e7-5822-432c-9aa3-ce7b70208811` | `01.01.000` | `0` | `2026-04-10 09:34:25` | `` | `座椅，主要为金属框架` | `2b8511ea-6bd0-4283-b430-29da5bf2f701` | `` | `1.0` |
| 75 | `f2a680ad-06ce-42bd-9ded-dba6901cf3ec` | `01.01.000` | `0` | `2026-04-10 09:33:57` | `` | `剪发收集与汇集` | `77657862-1731-4045-bbc0-97ae8f242661` | `` | `1.0` |
| 76 | `d71cab25-9fcb-4634-ba2d-c11cd6a3c0f6` | `01.01.000` | `0` | `2026-04-10 09:33:56` | `` | `未加工人发的分拣/分级与包装` | `77657862-1731-4045-bbc0-97ae8f242661` | `` | `1.0` |
| 77 | `16f4b0d1-9787-4333-aecc-de2da59f9f27` | `01.01.000` | `0` | `2026-04-10 09:33:36` | `` | `淀粉制造残渣及类似残渣` | `94c05999-994b-4adf-8681-b50b60c6041d` | `` | `1.0` |
| 78 | `e4ec087f-b655-4fff-837b-bde89917e4f7` | `01.01.000` | `0` | `2026-04-10 09:33:14` | `` | `原料粒径减小` | `3fa2a6a7-224c-4d99-bd55-a214f0a83161` | `` | `0.00153846` |
| 79 | `199fd0fe-a8b1-40d1-82db-8c30827b9deb` | `01.01.000` | `0` | `2026-04-10 09:32:48` | `` | `铝土矿制备` | `bd0c6203-d2b3-4e7f-8602-027aa93e87df` | `` | `1` |
| 80 | `70d0ff16-e2c9-4c23-8db7-858ed11644a5` | `01.01.000` | `0` | `2026-04-10 09:30:24` | `` | `包装与工厂大门交付` | `2c706125-e4a7-4af1-a5c7-78ad7bce62f6` | `` | `1` |
| 81 | `eb0862b2-ec9f-48c6-9a22-952ce234cb73` | `01.01.000` | `0` | `2026-04-10 09:29:44` | `` | `工厂测试与调试` | `d1abf37d-4e2e-4caa-b6c2-009245d4f4f3` | `` | `1` |
| 82 | `154daa53-5d6a-4698-bfdc-1da64b5d5ab9` | `01.01.000` | `0` | `2026-04-10 09:28:59` | `` | `捣固机和道路压路机，自走式` | `cfdba1d0-b123-4fb3-8c75-2fc7c6f9b9c1` | `` | `1` |
| 83 | `45d24b53-0ed1-4a2c-9ffc-e8cd61048ed9` | `01.01.000` | `0` | `2026-04-10 09:28:59` | `` | `捣固机和道路压路机，自走式` | `cfdba1d0-b123-4fb3-8c75-2fc7c6f9b9c1` | `` | `1` |
| 84 | `1942a40f-ceaf-4a17-b24a-5e19899ebbc1` | `01.01.000` | `0` | `2026-04-10 09:26:42` | `` | `光盘表面印刷` | `b4e24ad6-6c52-4158-b19f-a30bdf4da53a` | `` | `1` |
| 85 | `89f245ee-2bb8-43a4-9859-6479a8e30b41` | `01.01.000` | `0` | `2026-04-10 09:26:36` | `` | `不锈钢供应` | `de2a5069-b64b-412b-9abf-aecd9d946fbe` | `` | `1` |
| 86 | `94f91343-baa7-440d-9432-bda6f61a4b5c` | `01.01.000` | `0` | `2026-04-10 09:26:30` | `` | `电诊断设备` | `81ec0b79-a1f0-4fb0-bc88-e6ac81427ebe` | `` | `1` |
| 87 | `22685d84-b0c1-42a5-9c66-0647ccac3ed4` | `01.01.000` | `0` | `2026-04-10 09:26:29` | `` | `电诊断设备` | `81ec0b79-a1f0-4fb0-bc88-e6ac81427ebe` | `` | `1` |
| 88 | `56f787a6-675f-4e50-924e-57a26bf9fb88` | `01.01.000` | `0` | `2026-04-10 09:26:28` | `` | `电诊断设备` | `81ec0b79-a1f0-4fb0-bc88-e6ac81427ebe` | `` | `1` |
| 89 | `a64821f9-38e8-427b-83fa-f792eeeaa65a` | `01.01.000` | `0` | `2026-04-10 09:25:58` | `` | `子类 48263 和 48264 商品的零部件和配件` | `8dfe6e44-df14-41ed-860a-44ff6165f7e0` | `` | `1` |
| 90 | `c01ab098-43e2-4420-ad3d-1ed2de25fe36` | `01.01.000` | `0` | `2026-04-10 09:24:31` | `` | `道路工程与机电安装装修` | `8865dff9-be95-43e7-8861-ac2981c86ecf` | `` | `1` |
| 91 | `8cb660a6-c4a5-42b9-930f-bbf23964ce42` | `01.01.000` | `0` | `2026-04-10 09:24:07` | `` | `印刷用纸` | `936bdcb2-06b6-4ee9-8e7c-2f7762aba298` | `` | `1` |
| 92 | `134f5f80-2605-4bdd-b348-002a7c5ec39b` | `01.01.000` | `0` | `2026-04-10 09:24:03` | `` | `焦炭破碎与筛分` | `7384eff9-1da1-49c8-9d67-1ca70c6fc44f` | `` | `1` |
| 93 | `11f45aef-3afe-42c1-af89-b74944c67dc2` | `01.01.000` | `0` | `2026-04-10 09:21:43` | `` | `木薯` | `98eeec70-fa0d-41c5-967f-6b6dd000b5f7` | `` | `1` |
| 94 | `2afbd949-976e-440b-9f55-dec7090a54ca` | `01.01.000` | `0` | `2026-04-10 09:20:41` | `` | `用于农业或园艺的机械装置，用于投射、分散或喷洒液体或粉末` | `add1cc52-3d10-40c4-864c-97e4a4c428e7` | `` | `1` |

## 8. 数据整改方案

### 8.1 整改原则

1. 不建议在 solver 中自动删除重复 process。
   - 不同 ID 的 process 即使 exchange 完全相同，也可能代表不同业务含义。
   - 自动去重会改变用户数据语义，属于数据治理决策，不应由计算引擎隐式执行。
2. 数据层应保证进入计算的 process 有可解的技术矩阵结构。
3. 对用户私有数据，建议先做可解释的数据整改，再重新构建 snapshot 和计算。

### 8.2 重复 exchange process 整改

对每一组重复 process 执行以下决策：

| 情况 | 建议操作 |
| --- | --- |
| 实际是重复导入或重复创建 | 保留一个 process，其余标记为删除、归档或不进入计算 scope |
| 实际代表不同年份 / 地域 / 技术路线 | 补充能区分它们的 exchange、provider、地理或时间属性，避免 exchange 指纹完全相同 |
| 实际是同一过程的不同名称 | 合并为一个 canonical process，其他 process 改为引用或别名，不参与矩阵列构建 |
| 无法判断业务含义 | 暂时从计算 scope 排除，待数据 owner 确认 |

优先整改顺序：

1. 先处理 12 组用户私有重复 exchange process。
2. 优先处理已在历史事故中出现且仍存在的 3 组：`27460e30/f2c7d44c`、`1620052e/6e844959`、`b34003f9/b4791d3a`。
3. 再处理数量为 4 或 3 的大组，因为它们对矩阵秩的影响更明显。

### 8.3 missing reference 整改

对 81 个 missing reference：

1. 检查 `quantitativeReference.referenceToReferenceFlow` 是否为空。
2. 如果为空，补齐 reference exchange internal ID。
3. 如果 ID 存在但 exchange 不存在，修正 reference ID 或补回对应 exchange。
4. 确保 reference exchange 的 amount 是有效非零数值。

### 8.4 service-loop 整改

对 94 个用户私有 service-loop：

1. 检查同一 process 中同一 flow 同时作为 Input 和 Output 的记录。
2. 如果是误填，修正其中一侧的方向、flow 或 amount。
3. 如果确实表示回收、循环或自用，应拆分为更明确的过程，避免同一 process 自我供给。
4. 对 tiny amount 的自循环，也应确认是否由单位换算或自动生成过程造成。

### 8.5 state_code / scope 治理

历史记录中已经指出，该用户私有 process 大量 `state_code = 0`，但 `include_user_id` 逻辑会把该用户私有 process 纳入 snapshot，不受 public state `100..199` 过滤限制。

建议：

- 未完成、草稿或实验性私有 process 不应进入生产计算 snapshot。
- 若业务允许，增加用户私有 process 的计算准入状态规则。
- 在前端或导入流程中增加数据质量检查，避免明显不可解数据进入计算队列。

## 9. 验证方案

整改后按以下步骤验证：

1. 重新扫描该用户私有 process 的重复 exchange 结构。
2. 重新扫描 missing reference。
3. 重新扫描 service-loop。
4. 重新 build snapshot。
5. 对新 snapshot 执行 `solve_all_unit`。
6. 确认：
   - `lca_jobs.status = completed`
   - `lca_result_cache.status = ready`
   - `lca_results` 写入 artifact metadata
   - `lca_latest_all_unit_results` 更新到新 job

验收标准：

| 检查项 | 目标 |
| --- | --- |
| 用户私有重复 exchange 组 | `0`，或每组都有明确业务豁免并不进入计算 scope |
| 用户私有 missing reference | `0` |
| 用户私有 service-loop | `0`，或有明确建模解释并验证不导致 singular |
| `solve_all_unit` | `completed` |
| 新 snapshot factorization | 可成功准备 |

## 10. 建议的代码改进

这次根因是数据问题，但当前 worker 的错误呈现会误导排查。

建议改进 `ensure_prepared`：

- 如果 factorization 状态为 `Failed`，应返回 cached failure 或重新 prepare。
- 如果状态为 `Stale`，应重新 prepare。
- 不应在 failed 状态下继续进入 solve，并产生 `factorization key not prepared` 这类派生错误。

这样可以让后续任务直接暴露真实首因：`matrix is singular`。

## 11. 参考排查 SQL

### 11.1 查看目标任务

```sql
SELECT
  id,
  job_type,
  status,
  snapshot_id,
  requested_by,
  created_at,
  started_at,
  finished_at,
  updated_at,
  diagnostics ->> 'error' AS error
FROM public.lca_jobs
WHERE id = 'f1489ed4-9c71-48af-9bce-1cb1cc030c89'::uuid;
```

### 11.2 查看同 snapshot 相邻任务

```sql
WITH target AS (
  SELECT snapshot_id, created_at
  FROM public.lca_jobs
  WHERE id = 'f1489ed4-9c71-48af-9bce-1cb1cc030c89'::uuid
)
SELECT
  j.id,
  j.job_type,
  j.status,
  j.created_at,
  j.started_at,
  j.finished_at,
  j.diagnostics ->> 'error' AS error
FROM public.lca_jobs j
JOIN target t ON j.snapshot_id = t.snapshot_id
WHERE j.created_at >= t.created_at - interval '2 hours'
  AND j.created_at <= t.created_at + interval '30 minutes'
ORDER BY j.created_at;
```

### 11.3 查看 pgmq 队列状态

```sql
SELECT * FROM pgmq.metrics('lca_jobs');
```

### 11.4 扫描用户私有重复 exchange process

```sql
WITH latest_procs AS (
  SELECT DISTINCT ON (id) id, version, json
  FROM public.processes
  WHERE user_id = 'dbcf5d8a-60bb-4dfc-a2b3-e8b4ab9352c0'::uuid
    AND json ? 'processDataSet'
  ORDER BY id, version DESC
),
exchange_fingerprint AS (
  SELECT
    p.id,
    p.version,
    COALESCE(
      p.json #>> '{processDataSet,processInformation,dataSetInformation,name,baseName}',
      ''
    ) AS name,
    md5(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'flow', ex.value -> 'referenceToFlowDataSet' ->> '@refObjectId',
            'dir', ex.value ->> 'exchangeDirection',
            'amt', COALESCE(ex.value ->> 'meanAmount', ex.value ->> 'resultingAmount', '')
          )
          ORDER BY
            ex.value -> 'referenceToFlowDataSet' ->> '@refObjectId',
            ex.value ->> 'exchangeDirection'
        )
        FROM jsonb_array_elements(
          CASE jsonb_typeof(p.json #> '{processDataSet,exchanges,exchange}')
            WHEN 'array' THEN p.json #> '{processDataSet,exchanges,exchange}'
            ELSE '[]'::jsonb
          END
        ) ex
      )::text
    ) AS fingerprint
  FROM latest_procs p
)
SELECT
  fingerprint,
  COUNT(*) AS dup_count,
  jsonb_agg(
    jsonb_build_object('id', id::text, 'version', version, 'name', name)
    ORDER BY id
  ) AS processes
FROM exchange_fingerprint
GROUP BY fingerprint
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;
```

### 11.5 扫描用户私有 missing reference

```sql
WITH latest_procs AS (
  SELECT DISTINCT ON (id) id, version, json
  FROM public.processes
  WHERE user_id = 'dbcf5d8a-60bb-4dfc-a2b3-e8b4ab9352c0'::uuid
    AND json ? 'processDataSet'
  ORDER BY id, version DESC
),
ref_scan AS (
  SELECT
    p.id,
    p.version,
    COALESCE(
      p.json #>> '{processDataSet,processInformation,dataSetInformation,name,baseName}',
      ''
    ) AS name,
    NULLIF(
      btrim(p.json #>> '{processDataSet,processInformation,quantitativeReference,referenceToReferenceFlow}'),
      ''
    ) AS ref_internal_id,
    (
      SELECT ex.value
      FROM jsonb_array_elements(
        CASE jsonb_typeof(p.json #> '{processDataSet,exchanges,exchange}')
          WHEN 'array' THEN p.json #> '{processDataSet,exchanges,exchange}'
          ELSE '[]'::jsonb
        END
      ) ex
      WHERE btrim(ex.value ->> '@dataSetInternalID') = NULLIF(
        btrim(p.json #>> '{processDataSet,processInformation,quantitativeReference,referenceToReferenceFlow}'),
        ''
      )
      LIMIT 1
    ) AS ref_exchange
  FROM latest_procs p
)
SELECT
  id::text AS process_id,
  version,
  LEFT(name, 120) AS name,
  CASE
    WHEN ref_internal_id IS NULL THEN 'missing_reference'
    WHEN ref_exchange IS NULL THEN 'exchange_not_found'
    ELSE NULL
  END AS issue,
  ref_internal_id
FROM ref_scan
WHERE ref_internal_id IS NULL
   OR ref_exchange IS NULL
ORDER BY issue, id;
```

## 12. 后续动作建议

1. 建立该用户私有 process 的数据整改清单，先处理本报告列出的 12 组重复结构。
2. 按 7.2 明细修复 81 个 missing reference，交由数据 owner 逐行确认。
3. 按 7.3 明细修复 94 个 service-loop，优先按 `modified_at` 批次和 process owner 分组整改。
4. 修复 worker `ensure_prepared` 的 failed/stale 状态处理，避免后续任务报错偏离首因。
5. 数据整改完成后重新构建 snapshot 并重新运行 `solve_all_unit`。
