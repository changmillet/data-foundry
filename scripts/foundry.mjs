#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, 'WORKFLOW.md');
const taskQueues = {
  inbox: 'tasks/inbox',
  active: 'tasks/active',
  review: 'tasks/review',
  done: 'tasks/done',
};
const taskDirs = Object.values(taskQueues);
const foundryDirs = ['.foundry/logs', '.foundry/workspaces', '.foundry/state'];
const lockPath = path.join(repoRoot, '.foundry/state/orchestrator.lock');
const statusPath = path.join(repoRoot, '.foundry/state/orchestrator-status.json');

function nowIso() {
  return new Date().toISOString();
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeJson(filePath, data) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) {
    return { frontmatter: '', body: text };
  }
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error('Missing closing frontmatter marker.');
  }
  return {
    frontmatter: text.slice(4, end),
    body: text.slice(end + 5),
  };
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/u.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/gu, '');
}

function parseFlatFrontmatter(text) {
  const output = {};
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim() || line.startsWith(' ') || line.trim().startsWith('-')) {
      continue;
    }
    const index = line.indexOf(':');
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (value) {
      output[key] = parseScalar(value);
    }
  }
  return output;
}

function serializeScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_.@/:-]+$/u.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function serializeFrontmatter(meta) {
  return Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${serializeScalar(value)}`)
    .join('\n');
}

function readTaskFile(filePath) {
  const text = readText(filePath);
  const { frontmatter, body } = splitFrontmatter(text);
  return {
    path: filePath,
    relPath: path.relative(repoRoot, filePath),
    fileName: path.basename(filePath),
    meta: parseFlatFrontmatter(frontmatter),
    body,
  };
}

function writeTaskFile(filePath, task) {
  const text = `---\n${serializeFrontmatter(task.meta)}\n---\n${task.body.startsWith('\n') ? task.body : `\n${task.body}`}`;
  writeText(filePath, text);
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      options[key] = parseScalar(inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = parseScalar(next);
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function workflowCheck({ exit = true } = {}) {
  const text = readText(workflowPath);
  const { frontmatter, body } = splitFrontmatter(text);
  const requiredFragments = [
    'tracker:',
    'workspace:',
    'agent:',
    'codex:',
    'policy:',
  ];
  const missing = requiredFragments.filter((fragment) => !frontmatter.includes(fragment));
  const result = {
    workflow: path.relative(repoRoot, workflowPath),
    has_frontmatter: Boolean(frontmatter),
    has_prompt_body: body.trim().length > 0,
    missing_required_fragments: missing,
    ok: missing.length === 0 && body.trim().length > 0,
  };
  if (exit) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  return result;
}

function listTaskFiles({ queue } = {}) {
  const queueEntries = queue ? [[queue, taskQueues[queue]]] : Object.entries(taskQueues);
  const files = [];
  for (const [queueName, dir] of queueEntries) {
    const absDir = path.join(repoRoot, dir);
    if (!fs.existsSync(absDir)) {
      continue;
    }
    for (const name of fs.readdirSync(absDir).sort()) {
      if (name.endsWith('.md')) {
        files.push({ queue: queueName, path: path.join(absDir, name) });
      }
    }
  }
  return files;
}

function readTasks() {
  return listTaskFiles().map((file) => {
    const task = readTaskFile(file.path);
    return {
      path: task.relPath,
      queue: file.queue,
      meta: task.meta,
      body_preview: task.body.trim().split(/\r?\n/u).slice(0, 5).join('\n'),
    };
  });
}

function tasksList() {
  console.log(JSON.stringify(readTasks(), null, 2));
}

function tasksCheck() {
  const tasks = readTasks();
  const errors = [];
  const ids = new Set();
  const allowedStateByQueue = {
    inbox: new Set(['Todo', 'Ready', 'Rework']),
    active: new Set(['In Progress', 'Running']),
    review: new Set(['ReviewReady', 'Blocked', 'Failed', 'Needs Evidence']),
    done: new Set(['Done', 'Cancelled', 'Duplicate']),
  };
  for (const task of tasks) {
    for (const key of ['id', 'title', 'state', 'kind']) {
      if (!task.meta[key]) {
        errors.push(`${task.path}: missing ${key}`);
      }
    }
    if (task.meta.id) {
      if (ids.has(task.meta.id)) {
        errors.push(`${task.path}: duplicate id ${task.meta.id}`);
      }
      ids.add(task.meta.id);
    }
    const allowedStates = allowedStateByQueue[task.queue];
    if (task.meta.state && allowedStates && !allowedStates.has(task.meta.state)) {
      errors.push(`${task.path}: state ${task.meta.state} does not match queue ${task.queue}`);
    }
  }
  const result = { task_count: tasks.length, errors, ok: errors.length === 0 };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

function initRuntime({ print = true } = {}) {
  for (const dir of [...taskDirs, ...foundryDirs]) {
    fs.mkdirSync(path.join(repoRoot, dir), { recursive: true });
  }
  const result = {
    repo_root: repoRoot,
    created_or_verified: [...taskDirs, ...foundryDirs],
  };
  if (print) {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

function doctor() {
  const result = {
    repo_root: repoRoot,
    node: process.version,
    workflow_exists: fs.existsSync(workflowPath),
    workflow_check: workflowCheck({ exit: false }),
    task_dirs: Object.fromEntries(taskDirs.map((dir) => [dir, fs.existsSync(path.join(repoRoot, dir))])),
    foundry_dirs: Object.fromEntries(foundryDirs.map((dir) => [dir, fs.existsSync(path.join(repoRoot, dir))])),
    lock_exists: fs.existsSync(lockPath),
  };
  console.log(JSON.stringify(result, null, 2));
}

function queueCounts() {
  return Object.fromEntries(
    Object.keys(taskQueues).map((queue) => [queue, listTaskFiles({ queue }).length]),
  );
}

function status() {
  const result = {
    generated_at_utc: nowIso(),
    queue_counts: queueCounts(),
    orchestrator_status: fs.existsSync(statusPath) ? readJson(statusPath) : null,
    tasks: readTasks().map((task) => ({
      id: task.meta.id,
      title: task.meta.title,
      queue: task.queue,
      state: task.meta.state,
      kind: task.meta.kind,
      category: task.meta.category,
      result: task.meta.result,
      workspace: task.meta.workspace,
    })),
  };
  console.log(JSON.stringify(result, null, 2));
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  initRuntime({ print: false });
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    if (isProcessAlive(lock.pid)) {
      throw new Error(`Orchestrator already running with pid ${lock.pid}.`);
    }
    fs.rmSync(lockPath, { force: true });
  }
  writeJson(lockPath, { pid: process.pid, started_at_utc: nowIso() });
}

function releaseLock() {
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    if (lock.pid === process.pid) {
      fs.rmSync(lockPath, { force: true });
    }
  }
}

function writeStatus(statusData) {
  const previous = fs.existsSync(statusPath) ? readJson(statusPath) : {};
  const retained = {};
  for (const key of ['last_task_id', 'last_result']) {
    if (!(key in statusData) && previous[key]) {
      retained[key] = previous[key];
    }
  }
  writeJson(statusPath, {
    updated_at_utc: nowIso(),
    pid: process.pid,
    ...retained,
    ...statusData,
  });
}

function findTaskById(taskId) {
  for (const file of listTaskFiles()) {
    const task = readTaskFile(file.path);
    if (task.meta.id === taskId) {
      return { ...task, queue: file.queue };
    }
  }
  return null;
}

function pickInboxTask({ taskId } = {}) {
  if (taskId) {
    const task = findTaskById(taskId);
    if (!task) return null;
    return task.queue === 'inbox' || task.queue === 'active' ? task : null;
  }
  const files = listTaskFiles({ queue: 'inbox' });
  if (files.length === 0) return null;
  const sorted = files
    .map((file) => ({ ...readTaskFile(file.path), queue: file.queue }))
    .sort((a, b) => String(a.meta.priority ?? 'P9').localeCompare(String(b.meta.priority ?? 'P9')));
  return sorted[0];
}

function workspaceFor(taskId) {
  return path.join(repoRoot, '.foundry/workspaces', taskId);
}

function ensureWorkspace(task) {
  const workspace = workspaceFor(task.meta.id);
  for (const dir of ['inputs', 'outputs', 'reports', 'logs', 'tmp']) {
    fs.mkdirSync(path.join(workspace, dir), { recursive: true });
  }
  return workspace;
}

function appendTaskLog(workspace, event, data = {}) {
  const line = JSON.stringify({
    ts: nowIso(),
    event,
    ...data,
  });
  fs.appendFileSync(path.join(workspace, 'logs/orchestrator.ndjson'), `${line}\n`);
}

function claimTask(task) {
  if (task.queue === 'active') {
    return task;
  }
  const workspace = workspaceFor(task.meta.id);
  const updatedTask = {
    ...task,
    meta: {
      ...task.meta,
      state: 'In Progress',
      claimed_at_utc: task.meta.claimed_at_utc ?? nowIso(),
      updated_at_utc: nowIso(),
      workspace: path.relative(repoRoot, workspace),
      run_count: Number(task.meta.run_count ?? 0) + 1,
    },
  };
  const dest = path.join(repoRoot, taskQueues.active, task.fileName);
  writeTaskFile(dest, updatedTask);
  fs.rmSync(task.path, { force: true });
  return readTaskFile(dest);
}

function moveTaskToQueue(task, queue, metaUpdates) {
  const sourcePath = task.path;
  const dest = path.join(repoRoot, taskQueues[queue], task.fileName);
  const updatedTask = {
    ...task,
    meta: {
      ...task.meta,
      ...metaUpdates,
      updated_at_utc: nowIso(),
    },
  };
  writeTaskFile(dest, updatedTask);
  if (path.resolve(sourcePath) !== path.resolve(dest)) {
    fs.rmSync(sourcePath, { force: true });
  }
  return readTaskFile(dest);
}

function copyJson(sourcePath, destPath) {
  writeJson(destPath, readJson(sourcePath));
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function uniqueDatasets(items) {
  const seen = new Map();
  for (const item of items) {
    const key = `${item.table}:${item.id}:${item.version}`;
    if (!seen.has(key)) {
      seen.set(key, {
        table: item.table,
        dataset_type: item.dataset_type,
        id: item.id,
        version: item.version,
        state_code: item.state_code,
        name_zh: item.name_zh,
        name_en: item.name_en,
      });
    }
  }
  return [...seen.values()];
}

function renderTaskPrompt(task, workspace) {
  const workflow = readText(workflowPath);
  const { body } = splitFrontmatter(workflow);
  const prompt = body
    .replaceAll('{{ issue.identifier }}', String(task.meta.id))
    .replaceAll('{{ issue.title }}', String(task.meta.title))
    .replaceAll('{{ issue.description }}', task.body.trim());
  writeText(path.join(workspace, 'prompt.md'), prompt);
}

function buildMarkdownTable(rows, headers) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${headers.map((header) => String(row[header] ?? '')).join(' | ')} |`);
  return [headerLine, divider, ...body].join('\n');
}

function runElectricityCategoryUpdate(task, workspace) {
  const category = task.meta.category;
  const lcaRoot = process.env.LCA_DATA_AGENT_ROOT || '/home/example/projects/LCA-DATA-AGENT';
  const artifactRoot = path.join(lcaRoot, 'artifacts/example-account-account-data-governance-20260506');
  const outputRoot = path.join(artifactRoot, 'outputs');
  const categoryRoot = path.join(outputRoot, 'categories', category);
  const sourcePaths = {
    account_map: path.join(lcaRoot, 'inputs/context/example-account-account-data-map.json'),
    category_work_package: path.join(categoryRoot, 'work-package-summary.json'),
    schema_top_issues: path.join(categoryRoot, 'schema-top-issues.json'),
    account_external_flow_refs_top: path.join(categoryRoot, 'account-external-flow-ref-top.json'),
    schema_issues: path.join(outputRoot, 'schema-review/schema-validation-issues.json'),
    unresolved_refs: path.join(outputRoot, 'reference-closure/unresolved-process-flow-refs.json'),
    process_source_summary: path.join(outputRoot, 'process-source-review/process-source-summary.json'),
    category_report: path.join(artifactRoot, 'reports/category-electricity-system-workplan.zh-CN.md'),
  };
  for (const [name, sourcePath] of Object.entries(sourcePaths)) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing source input ${name}: ${sourcePath}`);
    }
  }

  const accountMap = readJson(sourcePaths.account_map);
  const workPackage = readJson(sourcePaths.category_work_package);
  const schemaTopIssues = readJson(sourcePaths.schema_top_issues);
  const topRefs = readJson(sourcePaths.account_external_flow_refs_top);
  const schemaIssues = readJson(sourcePaths.schema_issues).filter((issue) => issue.primary_category === category);
  const unresolvedRefs = readJson(sourcePaths.unresolved_refs).filter((ref) => ref.category === category);
  const processSourceSummary = readJson(sourcePaths.process_source_summary);
  const records = accountMap.records.filter((record) => record.primary_category === category);
  const issueDatasets = uniqueDatasets(schemaIssues);
  const referenceProcessDatasets = uniqueDatasets(
    unresolvedRefs.map((ref) => ({
      table: 'processes',
      dataset_type: 'process',
      id: ref.process_id,
      version: ref.process_version,
      state_code: 0,
      name_zh: ref.process_name,
      name_en: '',
    })),
  );

  copyJson(sourcePaths.category_work_package, path.join(workspace, 'inputs/work-package-summary.json'));
  copyJson(sourcePaths.schema_top_issues, path.join(workspace, 'inputs/schema-top-issues.json'));
  copyJson(sourcePaths.account_external_flow_refs_top, path.join(workspace, 'inputs/account-external-flow-ref-top.json'));
  writeJson(path.join(workspace, 'inputs/source-manifest.json'), {
    generated_at_utc: nowIso(),
    lca_data_agent_root: lcaRoot,
    source_paths: sourcePaths,
  });
  writeJson(path.join(workspace, 'inputs/frozen-category-inventory.json'), {
    generated_at_utc: nowIso(),
    account: accountMap.account,
    category,
    source_map_generated_at_utc: accountMap.generated_at_utc,
    counts_from_account_map: {
      total: records.length,
      flows: records.filter((record) => record.dataset_type === 'flow').length,
      processes: records.filter((record) => record.dataset_type === 'process').length,
      lifecyclemodels: records.filter((record) => record.dataset_type === 'lifecyclemodel').length,
    },
    records,
  });

  const schemaIssueGroups = countBy(schemaIssues, (issue) => `${issue.path}|${issue.message}`).slice(0, 20);
  const generalCommentTooLong = schemaIssues.filter((issue) => issue.path.includes('generalComment') && issue.message.includes('Too big'));
  const languageMismatch = schemaIssues.filter((issue) => issue.message.includes('@xml:lang'));
  const missingRequired = schemaIssues.filter((issue) => issue.message === 'Required');
  const repairCandidatePlan = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    category,
    remote_commit_allowed: Boolean(task.meta.allow_remote_commit),
    candidates: [
      {
        id: 'schema-general-comment-length',
        kind: 'schema-repair',
        priority: 'P1',
        affected_issue_count: generalCommentTooLong.length,
        affected_dataset_count: uniqueDatasets(generalCommentTooLong).length,
        action: 'Shorten exchange generalComment values to <=500 characters while preserving evidence/source meaning in source references or compact wording.',
        requires_local_payload_patch: true,
      },
      {
        id: 'schema-language-mismatch',
        kind: 'schema-repair',
        priority: 'P1',
        affected_issue_count: languageMismatch.length,
        affected_dataset_count: uniqueDatasets(languageMismatch).length,
        action: 'Align @xml:lang values with actual text language; zh fields must contain Chinese text and en fields must not contain Chinese text.',
        requires_local_payload_patch: true,
      },
      {
        id: 'schema-required-name-parts',
        kind: 'schema-repair',
        priority: 'P1',
        affected_issue_count: missingRequired.length,
        affected_dataset_count: uniqueDatasets(missingRequired).length,
        action: 'Fill required flow name parts such as treatmentStandardsRoutes and mixAndLocationTypes from the existing process/flow semantics.',
        requires_local_payload_patch: true,
      },
      {
        id: 'reference-closure',
        kind: 'reference-closure',
        priority: 'P1',
        affected_reference_count: unresolvedRefs.length,
        affected_process_count: referenceProcessDatasets.length,
        action: 'Resolve flow references against public/current/source inventories before marking any reference as missing; keep legal external references explicit.',
        requires_inventory_resolution: true,
      },
    ],
  };

  const versionBumpPlan = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    category,
    rule: 'Increase dataset row version only after local repair payloads pass validation and immediately before publish/import.',
    mode: 'append-only integration account update',
    remote_commit_allowed: Boolean(task.meta.allow_remote_commit),
    candidate_schema_dataset_count: issueDatasets.length,
    candidate_reference_process_count: referenceProcessDatasets.length,
    candidate_datasets_sample: issueDatasets.slice(0, 20),
    status: issueDatasets.length > 0 || referenceProcessDatasets.length > 0 ? 'required-after-repair' : 'not-required',
  };

  const dryRunPlan = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    category,
    remote_commit_allowed: Boolean(task.meta.allow_remote_commit),
    status: 'plan-only',
    prerequisites: [
      'local repair candidate payloads generated',
      'schema validation blocking issues cleared',
      'reference closure checked against public/current/source inventories',
      'version bump plan materialized for modified datasets',
    ],
    blocked_reason: Boolean(task.meta.allow_remote_commit)
      ? null
      : 'Task policy sets allow_remote_commit=false; publish/import must remain dry-run only.',
  };

  const gates = {
    schema: {
      ok: schemaIssues.length === 0,
      invalid_dataset_count: workPackage.schema.invalid_dataset_count,
      issue_count: schemaIssues.length,
    },
    source_evidence_numeric: {
      ok: workPackage.process_source.blocking_finding_count === 0,
      process_count: workPackage.process_source.process_count,
      missing_evidence_source_count: workPackage.process_source.missing_evidence_source_count,
      blocking_finding_count: workPackage.process_source.blocking_finding_count,
      account_wide_process_source_summary: processSourceSummary,
    },
    reference_closure: {
      ok: unresolvedRefs.length === 0,
      unresolved_or_external_ref_count: unresolvedRefs.length,
      affected_process_count: referenceProcessDatasets.length,
    },
    version_bump_plan: {
      ok: versionBumpPlan.status === 'required-after-repair',
      status: versionBumpPlan.status,
    },
    dry_run_policy: {
      ok: !Boolean(task.meta.allow_remote_commit),
      remote_commit_allowed: Boolean(task.meta.allow_remote_commit),
      status: 'dry-run-only',
    },
  };
  const blockingGateCount = Object.values(gates).filter((gate) => !gate.ok && gate !== gates.version_bump_plan).length;
  const result = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    category,
    classification: 'category-update',
    source: 'LCA-DATA-AGENT example-account electricity_system work package',
    summary: {
      total: workPackage.counts.total,
      flows: workPackage.counts.flows,
      processes: workPackage.counts.processes,
      lifecyclemodels: workPackage.counts.lifecyclemodels,
      schema_issue_count: schemaIssues.length,
      schema_invalid_dataset_count: workPackage.schema.invalid_dataset_count,
      unresolved_reference_count: unresolvedRefs.length,
      process_source_blocking_finding_count: workPackage.process_source.blocking_finding_count,
    },
    top_schema_issues: schemaTopIssues.slice(0, 10),
    top_unresolved_refs: topRefs.slice(0, 10),
    schema_issue_groups: schemaIssueGroups,
    gates,
    verdict: blockingGateCount === 0 ? 'ready_for_human_review' : 'repair_required',
    next_queue: 'review',
    next_state: blockingGateCount === 0 ? 'ReviewReady' : 'Blocked',
  };

  writeJson(path.join(workspace, 'outputs/electricity-governance-test-result.json'), result);
  writeJson(path.join(workspace, 'outputs/repair-candidates-plan.json'), repairCandidatePlan);
  writeJson(path.join(workspace, 'outputs/version-bump-plan.json'), versionBumpPlan);
  writeJson(path.join(workspace, 'outputs/dry-run-plan.json'), dryRunPlan);

  const reportRows = [
    { 指标: '总数据集', 数值: result.summary.total },
    { 指标: 'flow/process/model', 数值: `${result.summary.flows}/${result.summary.processes}/${result.summary.lifecyclemodels}` },
    { 指标: 'schema issue', 数值: result.summary.schema_issue_count },
    { 指标: 'schema invalid dataset', 数值: result.summary.schema_invalid_dataset_count },
    { 指标: 'P0/P1 source finding', 数值: result.summary.process_source_blocking_finding_count },
    { 指标: '待闭合 flow ref', 数值: result.summary.unresolved_reference_count },
  ];
  const report = `# DATA-001 电力系统数据 Orchestrator 测试报告

- 生成时间：${result.generated_at_utc}
- 任务：${task.meta.id} / ${task.meta.title}
- 类别：${category}
- 远端写入：${task.meta.allow_remote_commit ? '允许' : '不允许'}
- 结论：${result.verdict}
- 下一队列：${result.next_queue}
- 下一状态：${result.next_state}

## 1. 测试范围

${buildMarkdownTable(reportRows, ['指标', '数值'])}

## 2. Gate 结果

- schema：${gates.schema.ok ? '通过' : `未通过，${gates.schema.issue_count} 个 issue / ${gates.schema.invalid_dataset_count} 条 invalid dataset`}
- source/numeric：${gates.source_evidence_numeric.ok ? '通过' : '未通过'}
- reference closure：${gates.reference_closure.ok ? '通过' : `未通过，${gates.reference_closure.unresolved_or_external_ref_count} 条账号外部或待解析引用`}
- version bump plan：${gates.version_bump_plan.ok ? '已生成' : '未生成'}
- dry-run policy：${gates.dry_run_policy.ok ? '符合 dry-run-only 策略' : '需要远端写入授权'}

## 3. 修复候选

${repairCandidatePlan.candidates.map((candidate) => `- ${candidate.id}：${candidate.action}`).join('\n')}

## 4. 下一步

1. 生成本地 payload repair candidates。
2. 对 schema 修复候选重新 validation。
3. 对 ${unresolvedRefs.length} 条 flow reference 做 public/current/source inventory 闭合。
4. 只在所有 gate 通过后，执行 version bump plan 和 publish/import dry-run。
`;
  const reportPath = path.join(workspace, 'reports/electricity-system-test.zh-CN.md');
  writeText(reportPath, report);

  return {
    ...result,
    report_path: path.relative(repoRoot, reportPath),
  };
}

function runUnsupportedTask(task, workspace) {
  const result = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    classification: task.meta.kind,
    verdict: 'unsupported',
    next_queue: 'review',
    next_state: 'Blocked',
    reason: `No handler is implemented for kind=${task.meta.kind} category=${task.meta.category ?? ''}`,
  };
  writeJson(path.join(workspace, 'outputs/task-result.json'), result);
  writeText(path.join(workspace, 'reports/unsupported-task.md'), `# Unsupported Task\n\n${result.reason}\n`);
  return result;
}

function runTask(task) {
  const workspace = ensureWorkspace(task);
  appendTaskLog(workspace, 'task.start', { task_id: task.meta.id, kind: task.meta.kind, category: task.meta.category });
  renderTaskPrompt(task, workspace);
  let result;
  if (task.meta.kind === 'category-update' && task.meta.category === 'electricity_system') {
    result = runElectricityCategoryUpdate(task, workspace);
  } else {
    result = runUnsupportedTask(task, workspace);
  }
  writeJson(path.join(workspace, 'status.json'), {
    task_id: task.meta.id,
    updated_at_utc: nowIso(),
    state: result.next_state,
    queue: result.next_queue,
    result,
  });
  appendTaskLog(workspace, 'task.finish', {
    task_id: task.meta.id,
    verdict: result.verdict,
    next_queue: result.next_queue,
    next_state: result.next_state,
  });
  const nextTask = moveTaskToQueue(task, result.next_queue, {
    state: result.next_state,
    completed_run_at_utc: nowIso(),
    result: result.verdict,
    report: result.report_path,
    schema_issue_count: result.summary?.schema_issue_count,
    unresolved_reference_count: result.summary?.unresolved_reference_count,
  });
  return { task: nextTask, result };
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function orchestrate(options) {
  acquireLock();
  let processed = 0;
  let stopping = false;
  const intervalMs = Number(options.intervalMs ?? 10000);
  const maxTasks = Number(options.maxTasks ?? (options.once ? 1 : Number.POSITIVE_INFINITY));
  const onSignal = () => {
    stopping = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    do {
      writeStatus({ state: 'polling', queue_counts: queueCounts(), processed });
      const picked = pickInboxTask({ taskId: options.taskId });
      if (picked) {
        const claimed = claimTask(picked);
        const activeTask = readTaskFile(path.join(repoRoot, taskQueues.active, claimed.fileName));
        writeStatus({ state: 'running', task_id: activeTask.meta.id, queue_counts: queueCounts(), processed });
        const run = runTask(activeTask);
        processed += 1;
        writeStatus({
          state: 'idle',
          last_task_id: run.task.meta.id,
          last_result: run.result.verdict,
          queue_counts: queueCounts(),
          processed,
        });
      } else {
        writeStatus({ state: 'idle', queue_counts: queueCounts(), processed });
      }
      if (options.once || processed >= maxTasks) {
        break;
      }
      await sleep(intervalMs);
    } while (!stopping);
    const finalStatus = { state: stopping ? 'stopped' : 'finished', queue_counts: queueCounts(), processed };
    writeStatus(finalStatus);
    console.log(JSON.stringify(finalStatus, null, 2));
  } finally {
    releaseLock();
  }
}

const command = process.argv[2] ?? 'help';
const options = parseArgs(process.argv.slice(3));

if (command === 'init') {
  initRuntime();
} else if (command === 'doctor') {
  doctor();
} else if (command === 'workflow-check') {
  workflowCheck();
} else if (command === 'tasks-list') {
  tasksList();
} else if (command === 'tasks-check') {
  tasksCheck();
} else if (command === 'status') {
  status();
} else if (command === 'orchestrate') {
  orchestrate(options).catch((error) => {
    writeStatus({ state: 'failed', error: error.message, queue_counts: queueCounts() });
    releaseLock();
    console.error(error.stack || error.message);
    process.exit(1);
  });
} else {
  console.log('Usage: node scripts/foundry.mjs init|doctor|workflow-check|tasks-list|tasks-check|status|orchestrate [--once] [--task-id ID] [--interval-ms N] [--max-tasks N]');
  process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
}
