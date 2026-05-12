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
const defaultProjectsRoot = '/home/example/projects';
const defaultLcaWorkspaceRoot = path.join(defaultProjectsRoot, 'workspace');
const defaultLcaRoot = '/home/example/projects/LCA-DATA-AGENT';
const lcaSkillNames = new Set([
  'current-account-dataset-review',
  'embedding-ft',
  'flow-governance-review',
  'flow-hybrid-search',
  'forum-v1-data-toolchain',
  'lca-publish-executor',
  'lifecycleinventory-review',
  'lifecyclemodel-automated-builder',
  'lifecyclemodel-hybrid-search',
  'lifecyclemodel-recursive-orchestrator',
  'lifecyclemodel-resulting-process-builder',
  'lifecyclemodel-resulting-process-projector',
  'process-automated-builder',
  'process-dedup-review',
  'process-hybrid-search',
  'process-scope-statistics',
  'tiangong-lca-remote-ops',
]);

loadRuntimeEnv();

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

function isPlaceholderEnvValue(value) {
  const normalized = String(value ?? '').trim();
  return normalized === '' || normalized === 'REPLACE_ME';
}

function hasUsableEnvValue(key) {
  return process.env[key] !== undefined && !isPlaceholderEnvValue(process.env[key]);
}

function loadEnvFile(filePath, { override = false, fillPlaceholders = false } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { file: filePath, loaded: false, keys: [] };
  }
  const keys = [];
  for (const rawLine of readText(filePath).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^export\s+/u, '');
    value = value.replace(/^["']|["']$/gu, '');
    if (override || process.env[key] === undefined || (fillPlaceholders && isPlaceholderEnvValue(process.env[key]))) {
      process.env[key] = value;
    }
    keys.push(key);
  }
  return { file: filePath, loaded: true, keys };
}

function loadRuntimeEnv() {
  const repoEnv = loadEnvFile(path.join(repoRoot, '.env'));
  const lcaEnvFile = process.env.LCA_DATA_AGENT_ENV_FILE;
  const lcaEnv = lcaEnvFile ? loadEnvFile(lcaEnvFile, { fillPlaceholders: true }) : { file: null, loaded: false, keys: [] };
  return { repoEnv, lcaEnv };
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

function envCheck() {
  const requiredForRemoteWrites = [
    'TIANGONG_LCA_API_BASE_URL',
    'TIANGONG_LCA_API_KEY',
    'TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY',
  ];
  const result = {
    generated_at_utc: nowIso(),
    repo_env_exists: fs.existsSync(path.join(repoRoot, '.env')),
    lca_data_agent_root: process.env.LCA_DATA_AGENT_ROOT || defaultLcaRoot,
    lca_data_agent_env_file: process.env.LCA_DATA_AGENT_ENV_FILE || null,
    lca_data_agent_env_file_exists: process.env.LCA_DATA_AGENT_ENV_FILE ? fs.existsSync(process.env.LCA_DATA_AGENT_ENV_FILE) : false,
    remote_write_policy: {
      foundry_enable_remote_commit: process.env.FOUNDRY_ENABLE_REMOTE_COMMIT === 'true',
      foundry_single_record_commit: process.env.FOUNDRY_SINGLE_RECORD_COMMIT === 'true',
      foundry_remote_commit_limit: Number(process.env.FOUNDRY_REMOTE_COMMIT_LIMIT ?? 1),
    },
    required_remote_env: Object.fromEntries(requiredForRemoteWrites.map((key) => [key, hasUsableEnvValue(key)])),
    ok_for_dry_run: true,
    ok_for_single_record_remote_commit:
      process.env.FOUNDRY_ENABLE_REMOTE_COMMIT === 'true'
      && process.env.FOUNDRY_SINGLE_RECORD_COMMIT === 'true'
      && requiredForRemoteWrites.every((key) => hasUsableEnvValue(key)),
  };
  console.log(JSON.stringify(result, null, 2));
}

function configuredRoots() {
  const projectsRoot = process.env.FOUNDRY_PROJECTS_ROOT || defaultProjectsRoot;
  const lcaWorkspaceRoot = process.env.FOUNDRY_LCA_WORKSPACE_ROOT || defaultLcaWorkspaceRoot;
  return {
    projects_root: projectsRoot,
    lca_workspace_root: lcaWorkspaceRoot,
    lca_data_agent_root: process.env.LCA_DATA_AGENT_ROOT || defaultLcaRoot,
    tiangong_lca_cli_dir:
      process.env.TIANGONG_LCA_CLI_DIR || path.join(lcaWorkspaceRoot, 'tiangong-lca-cli'),
    tiangong_lca_skills_root:
      process.env.TIANGONG_LCA_SKILLS_ROOT || path.join(lcaWorkspaceRoot, 'tiangong-lca-skills'),
    lca_skills_root: process.env.LCA_SKILLS_ROOT || path.join(projectsRoot, 'lca-skills'),
    agent_skills_root: process.env.FOUNDRY_AGENT_SKILLS_ROOT || path.join(process.env.HOME || '/home/example', '.agents/skills'),
    edge_functions_root:
      process.env.TIANGONG_LCA_EDGE_FUNCTIONS_ROOT
      || path.join(lcaWorkspaceRoot, 'tiangong-lca-edge-functions'),
    database_engine_root:
      process.env.TIANGONG_LCA_DATABASE_ENGINE_ROOT || path.join(lcaWorkspaceRoot, 'database-engine'),
    domain_embedding_root:
      process.env.TIANGONG_LCA_DOMAIN_EMBEDDING_ROOT || path.join(lcaWorkspaceRoot, 'lca-domain-embedding'),
  };
}

function pathStatus(filePath) {
  return {
    path: filePath,
    exists: Boolean(filePath && fs.existsSync(filePath)),
  };
}

function parseGitmodules(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const entries = [];
  let current = null;
  for (const rawLine of readText(filePath).split(/\r?\n/u)) {
    const line = rawLine.trim();
    const header = line.match(/^\[submodule "(.+)"\]$/u);
    if (header) {
      if (current) entries.push(current);
      current = { name: header[1] };
      continue;
    }
    if (!current) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
    if (match) {
      current[match[1]] = match[2];
    }
  }
  if (current) entries.push(current);
  return entries;
}

function safeGitCommit(repoPath) {
  const gitHeadPath = path.join(repoPath, '.git');
  const headFilePath = path.join(repoPath, '.git/HEAD');
  try {
    if (fs.existsSync(headFilePath)) {
      const head = readText(headFilePath).trim();
      if (head.startsWith('ref: ')) {
        const refPath = path.join(repoPath, '.git', head.slice('ref: '.length));
        return fs.existsSync(refPath) ? readText(refPath).trim() : null;
      }
      return head || null;
    }
    if (fs.existsSync(gitHeadPath) && fs.statSync(gitHeadPath).isFile()) {
      const gitdir = readText(gitHeadPath).trim().replace(/^gitdir:\s*/u, '');
      const absGitDir = path.resolve(repoPath, gitdir);
      const headPath = path.join(absGitDir, 'HEAD');
      if (!fs.existsSync(headPath)) return null;
      const head = readText(headPath).trim();
      if (head.startsWith('ref: ')) {
        const refPath = path.join(absGitDir, head.slice('ref: '.length));
        return fs.existsSync(refPath) ? readText(refPath).trim() : null;
      }
      return head || null;
    }
  } catch {
    return null;
  }
  return null;
}

function listWorkspaceRepos(workspaceRoot) {
  return parseGitmodules(path.join(workspaceRoot, '.gitmodules')).map((entry) => {
    const absPath = path.join(workspaceRoot, entry.path ?? '');
    return {
      id: entry.name,
      path: entry.path,
      abs_path: absPath,
      url: entry.url ?? null,
      exists: fs.existsSync(absPath),
      commit: fs.existsSync(absPath) ? safeGitCommit(absPath) : null,
    };
  });
}

function readSkillMetadata(skillPath) {
  const text = readText(skillPath);
  const { frontmatter } = splitFrontmatter(text);
  const meta = parseFlatFrontmatter(frontmatter);
  return {
    name: meta.name || path.basename(path.dirname(skillPath)),
    description: meta.description || '',
  };
}

function listSkills(root, { lcaOnly = false } = {}) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const rows = [];
  for (const name of fs.readdirSync(root).sort()) {
    const skillPath = path.join(root, name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const meta = readSkillMetadata(skillPath);
    if (lcaOnly && !lcaSkillNames.has(String(meta.name))) {
      continue;
    }
    rows.push({
      name: meta.name,
      dir: name,
      description: meta.description,
      path: skillPath,
      has_scripts: fs.existsSync(path.join(root, name, 'scripts')),
      has_references: fs.existsSync(path.join(root, name, 'references')),
      has_assets: fs.existsSync(path.join(root, name, 'assets')),
    });
  }
  return rows;
}

function hybridSearchSurfaces(roots) {
  const edgeBase = path.join(roots.edge_functions_root, 'supabase/functions');
  const dbBase = path.join(
    roots.database_engine_root,
    'supabase/workspace/schemas/public/functions',
  );
  return [
    {
      corpus: 'flow',
      skill: 'flow-hybrid-search',
      cli: 'tiangong search flow --input <file>',
      edge_function: 'flow_hybrid_search',
      database_rpc: 'hybrid_search_flows',
    },
    {
      corpus: 'process',
      skill: 'process-hybrid-search',
      cli: 'tiangong search process --input <file>',
      edge_function: 'process_hybrid_search',
      database_rpc: 'hybrid_search_processes',
    },
    {
      corpus: 'lifecyclemodel',
      skill: 'lifecyclemodel-hybrid-search',
      cli: 'tiangong search lifecyclemodel --input <file>',
      edge_function: 'lifecyclemodel_hybrid_search',
      database_rpc: 'hybrid_search_lifecyclemodels',
    },
  ].map((surface) => ({
    ...surface,
    edge_path: path.join(edgeBase, surface.edge_function, 'index.ts'),
    edge_exists: fs.existsSync(path.join(edgeBase, surface.edge_function, 'index.ts')),
    rpc_path: path.join(dbBase, surface.database_rpc, 'definition.sql'),
    rpc_exists: fs.existsSync(path.join(dbBase, surface.database_rpc, 'definition.sql')),
  }));
}

function workspaceMap() {
  const roots = configuredRoots();
  const workspaceSkills = listSkills(roots.tiangong_lca_skills_root);
  const siblingSkills = listSkills(roots.lca_skills_root);
  const installedLcaSkills = listSkills(roots.agent_skills_root, { lcaOnly: true });
  const result = {
    generated_at_utc: nowIso(),
    repo_root: repoRoot,
    roots: Object.fromEntries(
      Object.entries(roots).map(([key, value]) => [key, pathStatus(value)]),
    ),
    workspace_repos: listWorkspaceRepos(roots.lca_workspace_root),
    skills: {
      workspace_source: {
        root: roots.tiangong_lca_skills_root,
        exists: fs.existsSync(roots.tiangong_lca_skills_root),
        count: workspaceSkills.length,
        skills: workspaceSkills,
      },
      sibling_source: {
        root: roots.lca_skills_root,
        exists: fs.existsSync(roots.lca_skills_root),
        count: siblingSkills.length,
        skills: siblingSkills,
      },
      installed_lca_runtime: {
        root: roots.agent_skills_root,
        exists: fs.existsSync(roots.agent_skills_root),
        count: installedLcaSkills.length,
        skills: installedLcaSkills,
      },
    },
    hybrid_search: {
      domain_embedding_root: pathStatus(roots.domain_embedding_root),
      surfaces: hybridSearchSurfaces(roots),
    },
    design_docs: [
      'docs/workspace-project-map.md',
      'specs/workspace-capability-adapters.md',
    ],
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

function pickInboxTask({ taskId, includeReview = false } = {}) {
  if (taskId) {
    const task = findTaskById(taskId);
    if (!task) return null;
    return task.queue === 'inbox' || task.queue === 'active' || (includeReview && task.queue === 'review') ? task : null;
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

function readJsonOrJsonl(filePath) {
  const text = readText(filePath).trim();
  if (!text) return [];
  if (filePath.endsWith('.jsonl')) {
    return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  }
  return readJson(filePath);
}

function datasetKey(record) {
  return `${record.table}:${record.id}:${record.version}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseDatasetPath(pathText) {
  return pathText.split('.').map((segment) => (/^\d+$/u.test(segment) ? Number(segment) : segment));
}

function getAtPath(root, pathText) {
  let current = root;
  for (const segment of parseDatasetPath(pathText)) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
}

function getParentAtPath(root, pathText) {
  const segments = parseDatasetPath(pathText);
  const key = segments.pop();
  let parent = root;
  for (const segment of segments) {
    if (parent == null) return { parent: undefined, key };
    parent = parent[segment];
  }
  return { parent, key };
}

function setAtPath(root, pathText, value) {
  const { parent, key } = getParentAtPath(root, pathText);
  if (parent == null || key === undefined) return false;
  parent[key] = value;
  return true;
}

function hasChinese(text) {
  return /[\u3400-\u9FFF]/u.test(String(text ?? ''));
}

function compactToLimit(text, limit = 500) {
  const value = String(text ?? '').replace(/\s+/gu, ' ').trim();
  if (value.length <= limit) return value;
  const tags = value.match(/\[[^\]]+\]/gu) ?? [];
  const tagText = tags.length > 0 ? ` ${tags.join(' ')}` : '';
  const suffix = ` ...${tagText}`;
  const headLength = Math.max(0, limit - suffix.length);
  return `${value.slice(0, headLength).trimEnd()}${suffix}`.slice(0, limit);
}

function localizedPair(enText, zhText) {
  return [
    { '@xml:lang': 'en', '#text': enText },
    { '@xml:lang': 'zh', '#text': zhText },
  ];
}

function splitNameParts(text) {
  return String(text ?? '').split(/[;；]/u).map((part) => part.trim()).filter(Boolean);
}

function deriveRequiredLocalizedValue(issue, fieldName) {
  const enParts = splitNameParts(issue.name_en);
  const zhParts = splitNameParts(issue.name_zh);
  if (fieldName === 'treatmentStandardsRoutes' && (enParts[1] || zhParts[1])) {
    return localizedPair(enParts[1] || 'unspecified treatment or route', zhParts[1] || '未指定处理或路线');
  }
  if (fieldName === 'mixAndLocationTypes' && (enParts[2] || zhParts[2])) {
    return localizedPair(enParts[2] || 'unspecified mix and location', zhParts[2] || '未指定混合与地点');
  }
  if (fieldName === 'flowProperties' && (enParts[3] || zhParts[3])) {
    return localizedPair(enParts[3] || 'unspecified flow property', zhParts[3] || '未指定流属性');
  }
  return null;
}

function incrementVersion(version) {
  const parts = String(version ?? '').split('.');
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/u.test(part))) {
    return null;
  }
  const nextPatch = String(Number(parts[2]) + 1).padStart(parts[2].length, '0');
  return `${parts[0]}.${parts[1]}.${nextPatch}`;
}

function extractFlowName(row, lang = 'en') {
  const info = row.json_ordered?.flowDataSet?.flowInformation?.dataSetInformation;
  const name = info?.name ?? {};
  const parts = ['baseName', 'treatmentStandardsRoutes', 'mixAndLocationTypes', 'flowProperties']
    .map((field) => {
      const value = name[field];
      if (Array.isArray(value)) {
        return value.find((item) => item?.['@xml:lang'] === lang)?.['#text'] ?? value[0]?.['#text'];
      }
      return value?.['#text'];
    })
    .filter(Boolean);
  return parts.join('; ');
}

function normalizeName(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/[，,]/gu, ',')
    .trim();
}

function loadTargetRows(sourcePaths) {
  const rowPaths = {
    flows: sourcePaths.target_flows,
    processes: sourcePaths.target_processes,
  };
  const byKey = new Map();
  for (const [table, filePath] of Object.entries(rowPaths)) {
    for (const row of readJsonOrJsonl(filePath)) {
      byKey.set(`${table}:${row.id}:${row.version}`, { ...row, table, dataset_type: table === 'flows' ? 'flow' : 'process' });
    }
  }
  return byKey;
}

function makeSchemaRepairCandidates({ task, workspace, sourcePaths, category, schemaIssues }) {
  const rowsByKey = loadTargetRows(sourcePaths);
  const grouped = new Map();
  for (const issue of schemaIssues) {
    const key = datasetKey(issue);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(issue);
  }

  const outDir = path.join(workspace, 'outputs/schema-repair-candidates');
  fs.mkdirSync(outDir, { recursive: true });
  const candidates = [];
  const skipped = [];
  for (const [key, issues] of grouped) {
    const sourceRow = rowsByKey.get(key);
    if (!sourceRow) {
      skipped.push({ key, reason: 'source row not found in target integration candidate rows', issue_count: issues.length });
      continue;
    }
    const patchedRow = deepClone(sourceRow);
    const patches = [];
    const needsAuthoring = [];
    for (const issue of issues) {
      if (issue.message.includes('Too big') && issue.path.endsWith('.#text')) {
        const original = getAtPath(patchedRow.json_ordered, issue.path);
        const updated = compactToLimit(original, 500);
        if (updated !== original && setAtPath(patchedRow.json_ordered, issue.path, updated)) {
          patches.push({
            kind: 'string-length',
            path: issue.path,
            original_length: String(original ?? '').length,
            updated_length: updated.length,
          });
        }
        continue;
      }
      if (issue.message.includes('@xml:lang') && issue.path.endsWith('.#text')) {
        const { parent } = getParentAtPath(patchedRow.json_ordered, issue.path);
        const text = parent?.['#text'];
        if (parent && issue.message.includes("values starting with 'zh'") && !hasChinese(text)) {
          const originalLang = parent['@xml:lang'];
          parent['@xml:lang'] = 'en';
          patches.push({ kind: 'language-tag', path: issue.path.replace(/\.#text$/u, '.@xml:lang'), original: originalLang, updated: 'en' });
          continue;
        }
        if (parent && issue.message.includes("values starting with 'en'") && hasChinese(text)) {
          const originalLang = parent['@xml:lang'];
          parent['@xml:lang'] = 'zh';
          patches.push({ kind: 'language-tag', path: issue.path.replace(/\.#text$/u, '.@xml:lang'), original: originalLang, updated: 'zh' });
          continue;
        }
      }
      if (issue.message === 'Required') {
        const fieldName = String(issue.path).split('.').at(-1);
        const derived = deriveRequiredLocalizedValue(issue, fieldName);
        if (derived && setAtPath(patchedRow.json_ordered, issue.path, derived)) {
          patches.push({ kind: 'required-localized-name-part', path: issue.path, field: fieldName, updated_count: derived.length });
          continue;
        }
        needsAuthoring.push({
          path: issue.path,
          message: issue.message,
          reason: 'required value cannot be safely derived from bilingual flow name parts',
        });
      }
    }
    if (patches.length === 0 && needsAuthoring.length === 0) {
      skipped.push({ key, reason: 'no deterministic patch rule matched', issue_count: issues.length });
      continue;
    }
    const proposedVersion = incrementVersion(sourceRow.version);
    candidates.push({
      key,
      id: sourceRow.id,
      source_version: sourceRow.version,
      proposed_publish_version: proposedVersion,
      table: sourceRow.table,
      dataset_type: sourceRow.dataset_type,
      state_code: sourceRow.state_code,
      patch_count: patches.length,
      needs_authoring_count: needsAuthoring.length,
      validation_status: 'not_validated',
      version_policy: 'Keep source row version during repair. Use proposed_publish_version only immediately before publish/import.',
      patches,
      needs_authoring: needsAuthoring,
      patched_row: patchedRow,
    });
  }

  const deterministic = candidates.filter((candidate) => candidate.patch_count > 0);
  const flowSmokeCandidate = deterministic.find((candidate) => candidate.table === 'flows' && candidate.proposed_publish_version);
  const smokeDir = path.join(workspace, 'outputs/single-record-smoke');
  fs.mkdirSync(smokeDir, { recursive: true });
  let smokePlan = null;
  if (flowSmokeCandidate) {
    const publishRow = deepClone(flowSmokeCandidate.patched_row);
    publishRow.version = flowSmokeCandidate.proposed_publish_version;
    smokePlan = {
      generated_at_utc: nowIso(),
      task_id: task.meta.id,
      candidate_key: flowSmokeCandidate.key,
      dataset_type: 'flow',
      id: publishRow.id,
      source_version: flowSmokeCandidate.source_version,
      proposed_publish_version: publishRow.version,
      commit_command: 'npm run tiangong -- flow publish-version --input-file <jsonl> --out-dir <out-dir> --limit 1 --commit',
      dry_run_command: 'npm run tiangong -- flow publish-version --input-file <jsonl> --out-dir <out-dir> --limit 1 --dry-run',
      gates: {
        allow_remote_commit: Boolean(task.meta.allow_remote_commit),
        foundry_enable_remote_commit: process.env.FOUNDRY_ENABLE_REMOTE_COMMIT === 'true',
        foundry_single_record_commit: process.env.FOUNDRY_SINGLE_RECORD_COMMIT === 'true',
        limit_one: Number(process.env.FOUNDRY_REMOTE_COMMIT_LIMIT ?? 1) === 1,
      },
      status: 'prepared_dry_run_input_only',
    };
    writeText(path.join(smokeDir, 'flow-publish-dry-run-input.jsonl'), `${JSON.stringify(publishRow)}\n`);
    writeJson(path.join(smokeDir, 'single-record-smoke-plan.json'), smokePlan);
  }

  const summary = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    category,
    issue_dataset_count: grouped.size,
    candidate_count: candidates.length,
    deterministic_candidate_count: deterministic.length,
    skipped_count: skipped.length,
    patch_count: candidates.reduce((sum, candidate) => sum + candidate.patch_count, 0),
    needs_authoring_count: candidates.reduce((sum, candidate) => sum + candidate.needs_authoring_count, 0),
    validation_status: 'not_validated',
    smoke_candidate: smokePlan,
  };
  writeJson(path.join(outDir, 'summary.json'), summary);
  writeText(path.join(outDir, 'candidates.jsonl'), candidates.map((candidate) => JSON.stringify(candidate)).join('\n') + (candidates.length ? '\n' : ''));
  writeJson(path.join(outDir, 'skipped.json'), skipped);
  return summary;
}

function loadFlowInventories(sourcePaths) {
  const candidates = [
    ['target_integration_candidate', sourcePaths.target_flows],
    ['source_power_system', path.join(path.dirname(sourcePaths.target_flows), 'source_power_system.flows.rows.json')],
    ['source_pv_yunnan', path.join(path.dirname(sourcePaths.target_flows), 'source_pv_yunnan.flows.rows.json')],
    ['source_wind', path.join(path.dirname(sourcePaths.target_flows), 'source_wind.flows.rows.json')],
    ['source_accounts', path.join(path.dirname(sourcePaths.target_flows), 'source-accounts.flows.rows.jsonl')],
  ];
  const exact = new Map();
  const anyVersion = new Map();
  const byName = new Map();
  for (const [inventory, filePath] of candidates) {
    if (!fs.existsSync(filePath)) continue;
    for (const row of readJsonOrJsonl(filePath)) {
      const role = row.account_role ?? inventory;
      const entry = {
        inventory,
        account_role: role,
        id: row.id,
        version: row.version,
        user_id: row.user_id,
        state_code: row.state_code,
        name_en: extractFlowName(row, 'en'),
        name_zh: extractFlowName(row, 'zh'),
        row,
      };
      const exactKey = `${entry.id}@${entry.version}`;
      if (!exact.has(exactKey)) exact.set(exactKey, []);
      exact.get(exactKey).push(entry);
      if (!anyVersion.has(entry.id)) anyVersion.set(entry.id, []);
      anyVersion.get(entry.id).push(entry);
      for (const name of [entry.name_en, entry.name_zh].map(normalizeName).filter(Boolean)) {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(entry);
      }
    }
  }
  return { exact, anyVersion, byName };
}

function makeReferenceClosure({ workspace, sourcePaths, category, unresolvedRefs }) {
  const inventory = loadFlowInventories(sourcePaths);
  const rows = [];
  for (const ref of unresolvedRefs) {
    const exactKey = `${ref.flow_id}@${ref.flow_version}`;
    const exactMatches = inventory.exact.get(exactKey) ?? [];
    const anyVersionMatches = inventory.anyVersion.get(ref.flow_id) ?? [];
    const nameMatches = inventory.byName.get(normalizeName(ref.flow_name)) ?? [];
    let status = 'unresolved_needs_fetch_or_create';
    if (exactMatches.length > 0) status = 'exact_inventory_match';
    else if (anyVersionMatches.length > 0) status = 'any_version_inventory_match';
    else if (nameMatches.length > 0) status = 'name_match_review';
    rows.push({
      ...ref,
      status,
      exact_match_count: exactMatches.length,
      any_version_match_count: anyVersionMatches.length,
      name_match_count: nameMatches.length,
      suggested_action:
        status === 'exact_inventory_match'
          ? 'mark as externally resolvable or copy/publish canonical flow into integration account if policy requires account-owned closure'
          : status === 'any_version_inventory_match'
            ? 'review version drift and either update process reference version or publish/copy required version'
            : status === 'name_match_review'
              ? 'manual review required before rewriting by normalized name'
              : 'query live public/current inventories or create/import missing flow before process reference repair',
      matches: {
        exact: exactMatches.slice(0, 5).map(({ row, ...match }) => match),
        any_version: anyVersionMatches.slice(0, 5).map(({ row, ...match }) => match),
        name: nameMatches.slice(0, 5).map(({ row, ...match }) => match),
      },
    });
  }
  const byStatus = Object.fromEntries(countBy(rows, (row) => row.status).map((item) => [item.key, item.count]));
  const processCount = new Set(rows.map((row) => `${row.process_id}@${row.process_version}`)).size;
  const outDir = path.join(workspace, 'outputs/reference-closure');
  fs.mkdirSync(outDir, { recursive: true });
  const summary = {
    generated_at_utc: nowIso(),
    category,
    total_refs: rows.length,
    affected_process_count: processCount,
    status_counts: byStatus,
    source_inventory_note: 'local source/current inventories only; live public DB lookup is deferred to remote-enabled run',
  };
  writeJson(path.join(outDir, 'summary.json'), summary);
  writeJson(path.join(outDir, 'closure-candidates.json'), rows);
  writeText(path.join(outDir, 'closure-candidates.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  return summary;
}

function runElectricityCategoryUpdate(task, workspace) {
  const category = task.meta.category;
  const lcaRoot = process.env.LCA_DATA_AGENT_ROOT || defaultLcaRoot;
  const artifactRoot = path.join(lcaRoot, 'artifacts/example-account-account-data-governance-20260506');
  const electricityArtifactRoot = path.join(lcaRoot, 'artifacts/electricity-multi-account-governance-20260505');
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
    target_flows: path.join(electricityArtifactRoot, 'inputs/target_integration_candidate.flows.rows.json'),
    target_processes: path.join(electricityArtifactRoot, 'inputs/target_integration_candidate.processes.rows.json'),
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
  const schemaRepairCandidateSummary = makeSchemaRepairCandidates({
    task,
    workspace,
    sourcePaths,
    category,
    schemaIssues,
  });
  const referenceClosureSummary = makeReferenceClosure({
    workspace,
    sourcePaths,
    category,
    unresolvedRefs,
  });
  const repairCandidatePlan = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    category,
    remote_commit_allowed: Boolean(task.meta.allow_remote_commit),
    generated_payload_candidate_count: schemaRepairCandidateSummary.candidate_count,
    reference_closure_candidate_count: referenceClosureSummary.total_refs,
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
    schema_repair_candidates: schemaRepairCandidateSummary,
    reference_closure_candidates: referenceClosureSummary,
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

## 4. 新增 Handler 产物

- schema repair candidate payload：${schemaRepairCandidateSummary.candidate_count} 个 dataset candidate，${schemaRepairCandidateSummary.patch_count} 个 deterministic patch，${schemaRepairCandidateSummary.needs_authoring_count} 项仍需语义补写。
- reference closure：${referenceClosureSummary.total_refs} 条引用候选，状态分布 ${JSON.stringify(referenceClosureSummary.status_counts)}。
- single-record smoke：${schemaRepairCandidateSummary.smoke_candidate ? `${schemaRepairCandidateSummary.smoke_candidate.id}@${schemaRepairCandidateSummary.smoke_candidate.proposed_publish_version}` : '未找到可用 flow candidate'}。

## 5. 下一步

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
    schema_candidate_count: result.schema_repair_candidates?.candidate_count,
    reference_closure_candidate_count: result.reference_closure_candidates?.total_refs,
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
      const picked = pickInboxTask({ taskId: options.taskId, includeReview: Boolean(options.includeReview) });
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
} else if (command === 'env-check') {
  envCheck();
} else if (command === 'workspace-map') {
  workspaceMap();
} else if (command === 'orchestrate') {
  orchestrate(options).catch((error) => {
    writeStatus({ state: 'failed', error: error.message, queue_counts: queueCounts() });
    releaseLock();
    console.error(error.stack || error.message);
    process.exit(1);
  });
} else {
  console.log('Usage: node scripts/foundry.mjs init|doctor|workflow-check|workspace-map|tasks-list|tasks-check|status|env-check|orchestrate [--once] [--task-id ID] [--include-review] [--interval-ms N] [--max-tasks N]');
  process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
}
