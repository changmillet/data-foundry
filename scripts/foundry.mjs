#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const computeRepairTaskId = 'lca-compute-task-2026-05-10-factorization-not-prepared-singular';
const sampleScenarioDryRunTaskId = 'issue-5';
const sampleScenarioIndexPath = 'inputs/account-sample-scenarios/current-credential-identity-preflight-samples-2026-05-22.md';
const automatedTargetDatasetIndexPath =
  'inputs/account-sample-scenarios/current-profile-automated-lca-target-datasets-2026-05-23.md';
const automatedTargetDatasetSnapshotDir =
  '.foundry/workspaces/example-account-dataset-selection-2026-05-23';
const automatedTargetDatasetGateRunTaskId = 'issue-6-automated-lca-target-datasets';
const automatedPostWriteVerifyTaskId = 'issue-6-automated-lca-post-write-verify';
const automatedMatrixReadinessVerifyTaskId = 'issue-6-automated-lca-matrix-readiness';
const currentProfileAccountWideAuditTaskId = 'current-profile-account-wide-audit-2026-05-25';
const automatedLcaCapabilityRegistryPath = 'specs/automated-lca-capability-registry.json';
const automatedLcaGoldenFixtureMatrixPath = 'specs/automated-lca-golden-fixtures.json';
const matrixReadinessFixtureDir = 'inputs/account-sample-scenarios/calculator';
const defaultMatrixReadinessSamples = [
  'matrix-readiness-ready',
  'matrix-readiness-provider-closure-blocked',
];
const defaultAutomatedTargetDatasetGateReportPath = path.join(
  '.foundry/workspaces',
  automatedTargetDatasetGateRunTaskId,
  'target-dataset-gate-run/target-dataset-gate-report.json',
);
const defaultAutomatedTargetDatasetMutationHandoffPath = path.join(
  '.foundry/workspaces',
  automatedTargetDatasetGateRunTaskId,
  'target-dataset-gate-run/mutation-plan-handoff.json',
);
const automatedTargetDatasets = [
  {
    sample_id: 'golden-closed-electricity-mix-cn-hb',
    role: 'current full-chain target-quality candidate',
    process_rows: 'selected/target-electricity-mix-cn-hb-process.jsonl',
    flow_rows: 'selected/target-electricity-mix-cn-hb-flow.jsonl',
  },
  {
    sample_id: 'process-quality-hydropower-run-of-river',
    role: 'process-level quality benchmark and paired-flow repair check',
    process_rows: 'selected/target-hydropower-process.jsonl',
    flow_rows: 'selected/target-hydropower-flow.jsonl',
  },
  {
    sample_id: 'semantic-rich-lcd-monitor-repair',
    role: 'semantic-rich repair target for evidence compression',
    process_rows: 'selected/target-lcd-process.jsonl',
    flow_rows: 'selected/target-lcd-flow.jsonl',
  },
];
const accountRepairWorkspaceDirs = [
  'input-freeze',
  'audit',
  'evidence',
  'repair-candidates',
  'mutation-plan',
  'dry-run',
  'verification',
  'reports',
  'follow-ups',
];
const lockPath = path.join(repoRoot, '.foundry/state/orchestrator.lock');
const statusPath = path.join(repoRoot, '.foundry/state/orchestrator-status.json');
const wikiRoot = path.join(repoRoot, 'wiki');
const wikiEnvPath = path.join(wikiRoot, '.wiki.env');
const wikiDbPath = path.join(wikiRoot, 'index.db');
const wikiConfigPath = path.join(wikiRoot, 'wiki.config.json');
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
const envExampleAllowedKeys = new Set([
  'TIANGONG_LCA_API_BASE_URL',
  'TIANGONG_LCA_API_KEY',
  'TIANGONG_LCA_REGION',
  'TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY',
  'TIANGONG_LCA_SESSION_FILE',
  'TIANGONG_LCA_DISABLE_SESSION_CACHE',
  'TIANGONG_LCA_FORCE_REAUTH',
  'TIANGONG_LCA_KB_SEARCH_API_BASE_URL',
  'TIANGONG_LCA_KB_SEARCH_API_KEY',
  'TIANGONG_LCA_KB_SEARCH_REGION',
  'TIANGONG_LCA_UNSTRUCTURED_API_BASE_URL',
  'TIANGONG_LCA_UNSTRUCTURED_API_KEY',
  'TIANGONG_LCA_UNSTRUCTURED_PROVIDER',
  'TIANGONG_LCA_UNSTRUCTURED_MODEL',
  'TIANGONG_LCA_UNSTRUCTURED_CHUNK_TYPE',
  'TIANGONG_LCA_UNSTRUCTURED_RETURN_TXT',
  'TIANGONG_LCA_REVIEW_LLM_BASE_URL',
  'TIANGONG_LCA_REVIEW_LLM_API_KEY',
  'TIANGONG_LCA_REVIEW_LLM_MODEL',
  'LCA_DATA_AGENT_ROOT',
  'LCA_DATA_AGENT_ENV_FILE',
  'TIANGONG_LCA_CLI_DIR',
  'TIANGONG_LCA_SKILLS_ROOT',
  'LCA_SKILLS_ROOT',
]);
const envExampleAllowedPrefixes = ['FOUNDRY_'];
const envExampleForbiddenKeys = new Map([
  ['TIANGONG_LCA_COVERAGE', 'CLI coverage/test-only toggle; keep it in tiangong-lca-cli, not foundry.'],
  ['TIANGONG_LCA_TIDAS_SDK_DIR', 'CLI development override; the public CLI loads @tiangong-lca/tidas-sdk from dependencies.'],
  ['SUPABASE_URL', 'legacy generic Supabase env; foundry uses the canonical TIANGONG_LCA_API_* contract.'],
  ['SUPABASE_KEY', 'legacy generic Supabase env; foundry uses the canonical TIANGONG_LCA_API_* contract.'],
  ['LINEAR_API_KEY', 'tracker secret; configure tracker adapters outside the public foundry env example.'],
  ['GITHUB_TOKEN', 'tracker secret; configure tracker adapters outside the public foundry env example.'],
  ['SOURCE_REPO_URL', 'operator-specific source pointer; keep it in local .env when needed.'],
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

function readJsonIfExists(filePath) {
  return fileExists(filePath) ? readJson(filePath) : null;
}

function writeJson(filePath, data) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function appendJsonLine(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(data)}\n`);
}

function fileExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function isPlaceholderEnvValue(value) {
  const normalized = String(value ?? '').trim();
  return normalized === '' || normalized === 'REPLACE_ME';
}

function hasUsableEnvValue(key) {
  return process.env[key] !== undefined && !isPlaceholderEnvValue(process.env[key]);
}

function envPath(key) {
  return hasUsableEnvValue(key) ? process.env[key] : null;
}

function envValue(key) {
  return hasUsableEnvValue(key) ? String(process.env[key]).trim() : null;
}

function numberOption(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function boolOption(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function hashStrings(values) {
  const hash = createHash('sha256');
  for (const value of values) {
    hash.update(String(value));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function normalizeAccountScope(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === 'current-env-account' || normalized === 'current env account') {
    return 'current-credentials';
  }
  return normalized;
}

function accountContext(task = null) {
  const configuredLabel = envValue('FOUNDRY_ACCOUNT_LABEL');
  const scope = normalizeAccountScope(task?.meta?.account_env_target);
  return {
    scope,
    display_label: configuredLabel || scope,
    label_source: configuredLabel ? 'FOUNDRY_ACCOUNT_LABEL' : 'derived_from_runtime_scope',
    label_required_for_humans: process.env.FOUNDRY_ACCOUNT_LABEL_REQUIRED_FOR_HUMANS === 'true',
    label_required_for_ai: false,
    authority: 'Resolved TianGong credentials/session and frozen dataset manifest; the display label is non-authoritative.',
    public_report_policy: 'Do not hard-code personal account names in reusable docs, templates, or public-facing reports.',
  };
}

function directoryExists(dirPath) {
  return Boolean(dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory());
}

function looksLikeWorkspaceRoot(dirPath) {
  return Boolean(dirPath && fs.existsSync(path.join(dirPath, '.gitmodules')));
}

function inferLcaWorkspaceRoot() {
  const repoParent = path.dirname(repoRoot);
  const candidates = [
    repoParent,
    path.join(repoParent, 'workspace'),
    path.join(path.dirname(repoParent), 'workspace'),
  ];
  return candidates.find((candidate) => looksLikeWorkspaceRoot(candidate)) || repoParent;
}

function inferProjectsRoot() {
  return path.dirname(inferLcaWorkspaceRoot());
}

function inferLcaDataAgentRoot() {
  const candidates = [
    path.join(inferProjectsRoot(), 'LCA-DATA-AGENT'),
    path.join(path.dirname(repoRoot), 'LCA-DATA-AGENT'),
  ];
  return candidates.find((candidate) => directoryExists(candidate)) || candidates[0];
}

function inferAgentSkillsRoot() {
  return process.env.HOME ? path.join(process.env.HOME, '.agents/skills') : '';
}

function inferLcaDataAgentEnvFile() {
  const explicitEnvFile = envPath('LCA_DATA_AGENT_ENV_FILE');
  if (explicitEnvFile) {
    return explicitEnvFile;
  }
  const inferredEnvFile = path.join(envPath('LCA_DATA_AGENT_ROOT') || inferLcaDataAgentRoot(), '.env');
  return fs.existsSync(inferredEnvFile) ? inferredEnvFile : null;
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
  const lcaEnvFile = inferLcaDataAgentEnvFile();
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

function storageCheck({ exit = true } = {}) {
  const registryPath = path.join(repoRoot, 'docs/file-location-registry.json');
  const allowedRootMarkdown = new Set(['AGENTS.md', 'README.md', 'WORKFLOW.md']);
  const errors = [];
  const warnings = [];

  if (!fileExists(registryPath)) {
    errors.push('docs/file-location-registry.json is missing');
  }

  let registry = null;
  if (fileExists(registryPath)) {
    try {
      registry = readJson(registryPath);
    } catch (error) {
      errors.push(`docs/file-location-registry.json is not valid JSON: ${error.message}`);
    }
  }

  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  if (registry && !Array.isArray(registry.entries)) {
    errors.push('docs/file-location-registry.json: entries must be an array');
  }

  const ids = new Set();
  for (const entry of entries) {
    if (!entry?.id) {
      errors.push('file-location registry entry is missing id');
      continue;
    }
    if (ids.has(entry.id)) errors.push(`duplicate file-location registry id: ${entry.id}`);
    ids.add(entry.id);

    if (!entry.current_path) {
      errors.push(`${entry.id}: missing current_path`);
      continue;
    }
    const currentPath = resolveRepoPath(entry.current_path);
    if (entry.status !== 'retired' && !fileExists(currentPath)) {
      errors.push(`${entry.id}: current_path does not exist: ${entry.current_path}`);
    }

    for (const previousPath of entry.previous_paths ?? []) {
      if (fileExists(resolveRepoPath(previousPath))) {
        errors.push(`${entry.id}: previous_path still exists and may cause stale references: ${previousPath}`);
      }
    }

    for (const referencedBy of entry.referenced_by ?? []) {
      if (!fileExists(resolveRepoPath(referencedBy))) {
        warnings.push(`${entry.id}: referenced_by path does not exist: ${referencedBy}`);
      }
    }
  }

  for (const name of fs.readdirSync(repoRoot).sort()) {
    if (name.endsWith('.md') && !allowedRootMarkdown.has(name)) {
      errors.push(`root markdown file is not an allowed entrypoint; move it and update docs/file-location-registry.json: ${name}`);
    }
  }

  const result = {
    registry: path.relative(repoRoot, registryPath),
    entry_count: entries.length,
    errors,
    warnings,
    ok: errors.length === 0,
  };
  if (exit) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  return result;
}

function listAcceptanceContracts() {
  const acceptanceDir = path.join(repoRoot, 'specs/acceptance');
  if (!fs.existsSync(acceptanceDir)) return [];
  return fs.readdirSync(acceptanceDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join('specs/acceptance', name));
}

function parseEnvAssignmentLines(filePath) {
  if (!fileExists(filePath)) {
    return [];
  }
  const rows = [];
  const lines = readText(filePath).split(/\r?\n/u);
  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const normalized = trimmed.replace(/^export\s+/u, '');
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) return;
    rows.push({
      key: match[1],
      value: match[2] ?? '',
      line: index + 1,
    });
  });
  return rows;
}

function envExampleKeyAllowed(key) {
  return envExampleAllowedKeys.has(key)
    || envExampleAllowedPrefixes.some((prefix) => key.startsWith(prefix));
}

function envExampleSurfaceCheck({ exit = true } = {}) {
  const envExamplePath = path.join(repoRoot, '.env.example');
  const errors = [];
  const warnings = [];
  const rows = parseEnvAssignmentLines(envExamplePath);
  const seen = new Map();

  if (!fileExists(envExamplePath)) {
    errors.push('.env.example is missing.');
  }

  for (const row of rows) {
    if (seen.has(row.key)) {
      errors.push(`.env.example:${row.line}: duplicate variable ${row.key}; first declared on line ${seen.get(row.key)}.`);
    }
    seen.set(row.key, row.line);

    if (envExampleForbiddenKeys.has(row.key)) {
      errors.push(`.env.example:${row.line}: ${row.key} is forbidden here. ${envExampleForbiddenKeys.get(row.key)}`);
      continue;
    }

    if (!envExampleKeyAllowed(row.key)) {
      errors.push(`.env.example:${row.line}: ${row.key} is not in the foundry env surface allowlist. Add a policy reason before documenting it.`);
      continue;
    }

    const secretLike = /(?:API_KEY|TOKEN|PASSWORD|SECRET)$/u.test(row.key);
    const allowedPublicKey = row.key === 'TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY';
    const hasExampleValue = !isPlaceholderEnvValue(row.value);
    if (secretLike && !allowedPublicKey && hasExampleValue) {
      errors.push(`.env.example:${row.line}: ${row.key} looks secret-bearing and must not contain an example value.`);
    }

    const crossRepoTestLike = /^TIANGONG_LCA_.*(?:COVERAGE|TEST|HARNESS|MOCK|FIXTURE|CI)/u.test(row.key);
    if (crossRepoTestLike) {
      errors.push(`.env.example:${row.line}: ${row.key} looks like a CLI/internal test toggle, not a foundry runtime variable.`);
    }
  }

  const result = {
    file: '.env.example',
    variable_count: rows.length,
    allowed_prefixes: envExampleAllowedPrefixes,
    forbidden_keys: [...envExampleForbiddenKeys.keys()],
    errors,
    warnings,
    ok: errors.length === 0,
  };
  if (exit) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  return result;
}

function getJsonPathValue(value, pathExpression) {
  if (!pathExpression) return value;
  return String(pathExpression).split('.').reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current) && /^\d+$/u.test(segment)) return current[Number(segment)];
    if (typeof current === 'object') return current[segment];
    return undefined;
  }, value);
}

function jsonAssertionPassed(actual, assertion) {
  const operator = assertion.operator ?? 'exists';
  if (operator === 'exists') return actual !== undefined && actual !== null;
  if (operator === 'not_empty') {
    if (Array.isArray(actual) || typeof actual === 'string') return actual.length > 0;
    if (actual && typeof actual === 'object') return Object.keys(actual).length > 0;
    return actual !== undefined && actual !== null;
  }
  if (operator === 'equals') return actual === assertion.expected;
  if (operator === 'not_equals') return actual !== assertion.expected;
  if (operator === 'min') return typeof actual === 'number' && actual >= assertion.expected;
  if (operator === 'max') return typeof actual === 'number' && actual <= assertion.expected;
  if (operator === 'includes') return Array.isArray(actual) && actual.includes(assertion.expected);
  return false;
}

function runJsonAssertions(assertions = []) {
  const reasons = [];
  for (const assertion of assertions) {
    const filePath = assertion.file;
    if (!filePath) {
      reasons.push({
        file: null,
        message: `JSON assertion ${assertion.name ?? '(unnamed)'} is missing file.`,
        suggestion: 'Add a repo-relative file path to the assertion.',
        requires_user_input: false,
      });
      continue;
    }
    const absPath = resolveRepoPath(filePath);
    if (!fileExists(absPath)) {
      reasons.push({
        file: filePath,
        message: `JSON assertion ${assertion.name ?? filePath} cannot run because the file is missing.`,
        suggestion: 'Generate the JSON artifact before running acceptance checks.',
        requires_user_input: false,
      });
      continue;
    }

    let payload;
    try {
      payload = readJson(absPath);
    } catch (error) {
      reasons.push({
        file: filePath,
        message: `JSON assertion ${assertion.name ?? filePath} cannot parse file: ${error.message}`,
        suggestion: 'Regenerate or repair the JSON artifact.',
        requires_user_input: false,
      });
      continue;
    }

    const actual = getJsonPathValue(payload, assertion.path);
    if (!jsonAssertionPassed(actual, assertion)) {
      reasons.push({
        file: filePath,
        message: `JSON assertion failed: ${assertion.name ?? assertion.path ?? filePath}`,
        path: assertion.path ?? null,
        operator: assertion.operator ?? 'exists',
        expected: assertion.expected ?? null,
        actual: actual ?? null,
        suggestion: assertion.suggestion ?? 'Regenerate the artifact or update the acceptance contract with a documented reason.',
        requires_user_input: Boolean(assertion.requires_user_input),
      });
    }
  }
  return reasons;
}

function makeContinuationPrompt(report) {
  const failedChecks = (report.checks ?? []).filter((check) => !check.passed);
  if (failedChecks.length === 0) {
    return `All acceptance checks passed for ${report.contract_path}.\n`;
  }
  const lines = [
    `Continue the foundry task until acceptance checks pass for ${report.contract_path}.`,
    '',
    'Do not claim completion from chat alone. Fix the concrete artifact/check failures below, then rerun:',
    '',
    `node scripts/foundry.mjs artifact-contract-check --contract ${report.contract_path}`,
    '',
    'Blocking findings:',
  ];
  for (const check of failedChecks) {
    lines.push(`- ${check.check}: ${check.summary}`);
    for (const reason of check.reasons ?? []) {
      lines.push(`  - file: ${reason.file ?? '(none)'}`);
      lines.push(`    issue: ${reason.message}`);
      if (reason.suggestion) lines.push(`    next: ${reason.suggestion}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function artifactContractCheck({ contractPath, exit = true } = {}) {
  const contractRelPath = contractPath || 'specs/acceptance/import-task.artifacts.json';
  const contractAbsPath = resolveRepoPath(contractRelPath);
  const checks = [];
  const errors = [];
  let contract = null;

  if (!fileExists(contractAbsPath)) {
    errors.push({
      file: contractRelPath,
      message: 'Artifact contract file is missing.',
      suggestion: 'Create the contract or pass --contract <path>.',
      requires_user_input: false,
    });
  } else {
    try {
      contract = readJson(contractAbsPath);
    } catch (error) {
      errors.push({
        file: contractRelPath,
        message: `Artifact contract is not valid JSON: ${error.message}`,
        suggestion: 'Fix the JSON syntax before running acceptance checks.',
        requires_user_input: false,
      });
    }
  }

  if (contract) {
    const artifactReasons = [];
    for (const artifact of contract.artifacts ?? []) {
      const artifactPath = artifact.path;
      const absPath = resolveRepoPath(artifactPath);
      const exists = fileExists(absPath);
      if (artifact.required && !exists) {
        artifactReasons.push({
          file: artifactPath,
          message: `Required artifact is missing: ${artifact.name ?? artifactPath}`,
          suggestion: 'Generate the artifact or update the contract if the path changed.',
          requires_user_input: false,
        });
        continue;
      }
      if (exists && Number.isInteger(artifact.min_bytes)) {
        const size = fs.statSync(absPath).size;
        if (size < artifact.min_bytes) {
          artifactReasons.push({
            file: artifactPath,
            message: `Artifact ${artifact.name ?? artifactPath} is ${size} bytes, below min_bytes ${artifact.min_bytes}.`,
            suggestion: 'Regenerate the artifact or lower min_bytes with a documented reason.',
            requires_user_input: false,
          });
        }
      }
    }
    checks.push({
      check: 'required_artifacts',
      passed: artifactReasons.length === 0,
      severity: 'error',
      summary: artifactReasons.length === 0 ? 'All required artifacts exist.' : `${artifactReasons.length} required artifact issue(s).`,
      score: artifactReasons.length === 0 ? 1 : 0,
      reasons: artifactReasons,
    });

    if ((contract.checks ?? []).some((check) => check.name === 'file_location_registry')) {
      const storage = storageCheck({ exit: false });
      checks.push({
        check: 'file_location_registry',
        passed: storage.ok,
        severity: 'error',
        summary: storage.ok ? 'File-location registry is consistent.' : `${storage.errors.length} file-location issue(s).`,
        score: storage.ok ? 1 : 0,
        reasons: storage.errors.map((message) => ({
          file: 'docs/file-location-registry.json',
          message,
          suggestion: 'Move the file to its governed location or update the registry.',
          requires_user_input: false,
        })),
        warnings: storage.warnings,
      });
    }

    const jsonAssertionCheck = (contract.checks ?? []).find((check) => check.name === 'json_assertions');
    if (jsonAssertionCheck) {
      const assertionReasons = runJsonAssertions(jsonAssertionCheck.config?.assertions ?? []);
      checks.push({
        check: 'json_assertions',
        passed: assertionReasons.length === 0,
        severity: jsonAssertionCheck.severity ?? 'error',
        summary: assertionReasons.length === 0 ? 'All JSON assertions passed.' : `${assertionReasons.length} JSON assertion issue(s).`,
        score: assertionReasons.length === 0 ? 1 : 0,
        reasons: assertionReasons,
      });
    }
  } else {
    checks.push({
      check: 'contract_load',
      passed: false,
      severity: 'error',
      summary: 'Artifact contract could not be loaded.',
      score: 0,
      reasons: errors,
    });
  }

  const blockingFailures = checks.filter((check) => !check.passed && check.severity === 'error');
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    contract_path: path.relative(repoRoot, contractAbsPath),
    task_id: contract?.id ?? null,
    status: blockingFailures.length === 0 ? 'passed' : 'failed',
    checks,
  };
  report.continuation_prompt = makeContinuationPrompt(report);
  const reportPath = path.join(repoRoot, '.foundry/state/artifact-check-reports', `${contract?.id ?? 'artifact-contract'}.json`);
  writeJson(reportPath, report);
  const promptPath = path.join(repoRoot, '.foundry/state/artifact-check-reports', `${contract?.id ?? 'artifact-contract'}.prompt.md`);
  writeText(promptPath, report.continuation_prompt);
  const output = {
    ...report,
    report_path: path.relative(repoRoot, reportPath),
    continuation_prompt_path: path.relative(repoRoot, promptPath),
  };
  if (exit) {
    console.log(JSON.stringify(output, null, 2));
    process.exit(blockingFailures.length === 0 ? 0 : 1);
  }
  return output;
}

function acceptanceCheck({ exit = true } = {}) {
  const contractPaths = listAcceptanceContracts();
  const reports = contractPaths.map((contractPath) => artifactContractCheck({ contractPath, exit: false }));
  const envSurface = envExampleSurfaceCheck({ exit: false });
  const blockingReports = reports.filter((report) => report.status !== 'passed');
  const policyFailures = envSurface.ok ? [] : [{
    contract_path: '.env.example',
    status: 'failed',
    report_path: null,
    continuation_prompt_path: null,
    check: 'env_example_surface',
    errors: envSurface.errors,
  }];
  const result = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockingReports.length === 0 && policyFailures.length === 0 ? 'passed' : 'failed',
    contract_count: contractPaths.length,
    reports: reports.map((report) => ({
      contract_path: report.contract_path,
      status: report.status,
      report_path: report.report_path,
      continuation_prompt_path: report.continuation_prompt_path,
    })),
    policy_checks: [
      {
        check: 'env_example_surface',
        status: envSurface.ok ? 'passed' : 'failed',
        errors: envSurface.errors,
        warnings: envSurface.warnings,
      },
    ],
  };
  const reportPath = path.join(repoRoot, '.foundry/state/acceptance/latest.json');
  writeJson(reportPath, result);
  const envPrompt = envSurface.ok
    ? ''
    : [
        'Fix the foundry .env.example surface before finalizing this turn.',
        '',
        'Blocking env surface findings:',
        ...envSurface.errors.map((error) => `- ${error}`),
        '',
        'Run `npm run env:check` and `npm run acceptance:check` after updating the file or the allowlist.',
      ].join('\n');
  const prompt = [
    ...reports.map((report) => report.continuation_prompt),
    envPrompt,
  ].filter(Boolean).join('\n---\n');
  const promptPath = path.join(repoRoot, '.foundry/state/acceptance/continuation-prompt.md');
  writeText(promptPath, prompt);
  const output = {
    ...result,
    report_path: path.relative(repoRoot, reportPath),
    continuation_prompt_path: path.relative(repoRoot, promptPath),
  };
  if (exit) {
    console.log(JSON.stringify(output, null, 2));
    process.exit(output.status === 'passed' ? 0 : 1);
  }
  return output;
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
    wiki: wikiStatus(),
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
  const explicitLcaDataAgentEnvFile = envPath('LCA_DATA_AGENT_ENV_FILE');
  const lcaDataAgentEnvFile = inferLcaDataAgentEnvFile();
  const envExampleSurface = envExampleSurfaceCheck({ exit: false });
  const result = {
    generated_at_utc: nowIso(),
    repo_env_exists: fs.existsSync(path.join(repoRoot, '.env')),
    env_example_surface: envExampleSurface,
    account_context: accountContext(),
    lca_data_agent_env: {
      source: explicitLcaDataAgentEnvFile ? 'explicit' : (lcaDataAgentEnvFile ? 'auto_discovered' : 'not_found'),
      exists: Boolean(lcaDataAgentEnvFile && fs.existsSync(lcaDataAgentEnvFile)),
    },
    remote_write_policy: {
      foundry_enable_remote_commit: process.env.FOUNDRY_ENABLE_REMOTE_COMMIT === 'true',
      foundry_single_record_commit: process.env.FOUNDRY_SINGLE_RECORD_COMMIT === 'true',
      foundry_remote_commit_limit: Number(process.env.FOUNDRY_REMOTE_COMMIT_LIMIT ?? 1),
    },
    required_remote_env: Object.fromEntries(requiredForRemoteWrites.map((key) => [key, hasUsableEnvValue(key)])),
    optional_rulesbook_parser_env: {
      unstructured_api_base_url: hasUsableEnvValue('UNSTRUCTURED_API_BASE_URL'),
      unstructured_auth_token: hasUsableEnvValue('UNSTRUCTURED_AUTH_TOKEN'),
      fallback_parser: 'pypdf page.extract_text',
    },
    ok_for_dry_run: true,
    ok_for_single_record_remote_commit:
      process.env.FOUNDRY_ENABLE_REMOTE_COMMIT === 'true'
      && process.env.FOUNDRY_SINGLE_RECORD_COMMIT === 'true'
      && requiredForRemoteWrites.every((key) => hasUsableEnvValue(key)),
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(envExampleSurface.ok ? 0 : 1);
}

function configuredRoots() {
  const lcaWorkspaceRoot = envPath('FOUNDRY_LCA_WORKSPACE_ROOT') || inferLcaWorkspaceRoot();
  const projectsRoot = envPath('FOUNDRY_PROJECTS_ROOT') || path.dirname(lcaWorkspaceRoot);
  return {
    projects_root: projectsRoot,
    lca_workspace_root: lcaWorkspaceRoot,
    lca_data_agent_root: envPath('LCA_DATA_AGENT_ROOT') || inferLcaDataAgentRoot(),
    tiangong_lca_cli_dir:
      envPath('TIANGONG_LCA_CLI_DIR') || path.join(lcaWorkspaceRoot, 'tiangong-lca-cli'),
    tiangong_lca_skills_root:
      envPath('TIANGONG_LCA_SKILLS_ROOT') || path.join(lcaWorkspaceRoot, 'tiangong-lca-skills'),
    lca_skills_root: envPath('LCA_SKILLS_ROOT') || path.join(projectsRoot, 'lca-skills'),
    agent_skills_root: envPath('FOUNDRY_AGENT_SKILLS_ROOT') || inferAgentSkillsRoot(),
    edge_functions_root:
      envPath('TIANGONG_LCA_EDGE_FUNCTIONS_ROOT')
      || path.join(lcaWorkspaceRoot, 'tiangong-lca-edge-functions'),
    database_engine_root:
      envPath('TIANGONG_LCA_DATABASE_ENGINE_ROOT') || path.join(lcaWorkspaceRoot, 'database-engine'),
    tiangong_lca_calculator_root:
      envPath('FOUNDRY_CALCULATOR_ROOT') || path.join(lcaWorkspaceRoot, 'tiangong-lca-calculator'),
    domain_embedding_root:
      envPath('TIANGONG_LCA_DOMAIN_EMBEDDING_ROOT') || path.join(lcaWorkspaceRoot, 'lca-domain-embedding'),
  };
}

function pathStatus(filePath) {
  return {
    path: filePath,
    exists: Boolean(filePath && fs.existsSync(filePath)),
  };
}

function countFilesRecursive(dirPath, { extension } = {}) {
  if (!directoryExists(dirPath)) return 0;
  let count = 0;
  for (const name of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, name);
    const entry = fs.statSync(entryPath);
    if (entry.isDirectory()) {
      count += countFilesRecursive(entryPath, { extension });
    } else if (!extension || name.endsWith(extension)) {
      count += 1;
    }
  }
  return count;
}

function wikiStatus() {
  const pagesPath = path.join(wikiRoot, 'pages');
  const vaultPath = path.join(wikiRoot, 'vault');
  return {
    root: path.relative(repoRoot, wikiRoot),
    env_file: pathStatus(wikiEnvPath),
    config_file: pathStatus(wikiConfigPath),
    db_file: pathStatus(wikiDbPath),
    pages: {
      path: path.relative(repoRoot, pagesPath),
      exists: directoryExists(pagesPath),
      markdown_count: countFilesRecursive(pagesPath, { extension: '.md' }),
    },
    vault: {
      path: path.relative(repoRoot, vaultPath),
      exists: directoryExists(vaultPath),
      file_count: countFilesRecursive(vaultPath),
    },
    commands: {
      build_rulesbook: 'npm run wiki:build-rulesbook',
      init_or_sync: 'npm run wiki:init or npm run wiki:sync',
      query: 'npm run wiki:fts -- "<term>"',
      doctor: 'npm run wiki:doctor',
    },
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

function ensureAccountRepairWorkspace(workspace) {
  for (const dir of accountRepairWorkspaceDirs) {
    fs.mkdirSync(path.join(workspace, dir), { recursive: true });
  }
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

function jsonLines(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
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

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function markdownTableValue(text, label) {
  const pattern = new RegExp(`\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*\`?([^|\`]+)\`?\\s*\\|`, 'u');
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function numberFromTableValue(text, label) {
  const value = markdownTableValue(text, label);
  if (!value) return null;
  const match = value.replace(/,/gu, '').match(/-?\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : null;
}

function extractSection(text, startHeading, nextHeadingPattern = /^##\s+/mu) {
  const startIndex = text.indexOf(startHeading);
  if (startIndex === -1) return '';
  const rest = text.slice(startIndex);
  const nextMatch = rest.slice(startHeading.length).match(nextHeadingPattern);
  if (!nextMatch?.index) return rest;
  return rest.slice(0, startHeading.length + nextMatch.index);
}

function stripMarkdownCell(text) {
  return String(text ?? '')
    .trim()
    .replace(/^`|`$/gu, '')
    .replace(/<br\s*\/?>/giu, '\n')
    .trim();
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map(stripMarkdownCell);
}

function parseNumberedTableRows(sectionText, headers) {
  const rows = [];
  for (const line of sectionText.split(/\r?\n/u)) {
    if (!/^\|\s*\d+\s*\|/u.test(line)) continue;
    const cells = splitMarkdownRow(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function extractUuids(text) {
  return [...String(text ?? '').matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu)]
    .map((match) => match[0]);
}

function parseComputeDiagnosticReport(text) {
  const duplicateSection = extractSection(
    text,
    '### 7.1 用户私有重复 exchange 结构 process',
    /^###\s+7\.2\s+/mu,
  );
  const missingReferenceSection = extractSection(
    text,
    '### 7.2 用户私有 missing reference',
    /^###\s+7\.3\s+/mu,
  );
  const serviceLoopSection = extractSection(
    text,
    '### 7.3 用户私有 service-loop',
    /^##\s+8\.\s+/mu,
  );
  const duplicateGroups = parseNumberedTableRows(duplicateSection, ['group', 'count', 'processes']).map((row) => ({
    group: Number(row.group),
    count: Number(row.count),
    process_ids: extractUuids(row.processes),
    raw_processes: row.processes,
  }));
  const missingReferenceRows = parseNumberedTableRows(missingReferenceSection, [
    'index',
    'process_id',
    'version',
    'state_code',
    'modified_at',
    'team_id',
    'model_id',
    'process_name',
    'issue',
  ]).map((row) => ({
    ...row,
    index: Number(row.index),
    state_code: row.state_code === '' ? null : Number(row.state_code),
  }));
  const serviceLoopRows = parseNumberedTableRows(serviceLoopSection, [
    'index',
    'process_id',
    'version',
    'state_code',
    'modified_at',
    'team_id',
    'process_name',
    'loop_flow_id',
    'flow_name',
    'amount',
  ]).map((row) => ({
    ...row,
    index: Number(row.index),
    state_code: row.state_code === '' ? null : Number(row.state_code),
    amount: row.amount === '' ? null : Number(row.amount),
  }));
  const privateDuplicateSummary = text.match(/该用户私有 process 命中 `?(\d+)`? 组，共 `?(\d+)`? 个 process/u);
  const missingReferenceSummary = text.match(/\|\s*`missing_reference`\s*\|\s*`?(\d+)`?\s*\|\s*`?(\d+)`?\s*\|\s*`?(\d+)`?\s*\|/u);
  const previousSingularJob = text.match(/前序失败任务 ID\s*\|\s*`([^`]+)`/u);
  const targetJob = text.match(/触发任务 ID\s*\|\s*`([^`]+)`/u);
  const snapshot = text.match(/snapshot ID\s*\|\s*`([^`]+)`/u);
  const user = text.match(/用户 ID\s*\|\s*`([^`]+)`/u);
  return {
    parsed_at_utc: nowIso(),
    source_type: 'local_compute_diagnostic_report',
    task_ids: {
      target_job_id: targetJob?.[1] ?? null,
      previous_singular_job_id: previousSingularJob?.[1] ?? null,
      snapshot_id: snapshot?.[1] ?? null,
      user_id: user?.[1] ?? null,
    },
    snapshot: {
      process_count: numberFromTableValue(text, 'snapshot process 数'),
      public_process_count: numberFromTableValue(text, 'public process 数'),
      private_process_count: numberFromTableValue(text, 'private process 数'),
      artifact_flow_count: numberFromTableValue(text, 'flow_count'),
      a_nnz: numberFromTableValue(text, 'a_nnz'),
      b_nnz: numberFromTableValue(text, 'b_nnz'),
      c_nnz: numberFromTableValue(text, 'c_nnz'),
    },
    known_findings: {
      duplicate_exchange_structure: {
        private_group_count: privateDuplicateSummary ? Number(privateDuplicateSummary[1]) : duplicateGroups.length,
        private_process_count: privateDuplicateSummary ? Number(privateDuplicateSummary[2]) : null,
        groups: duplicateGroups,
      },
      missing_reference: {
        total_count: missingReferenceSummary ? Number(missingReferenceSummary[1]) : missingReferenceRows.length,
        private_count: missingReferenceSummary ? Number(missingReferenceSummary[2]) : missingReferenceRows.length,
        non_private_count: missingReferenceSummary ? Number(missingReferenceSummary[3]) : null,
        rows: missingReferenceRows,
      },
      service_loop: {
        total_count: numberFromTableValue(text, 'snapshot 总 service-loop'),
        private_count: numberFromTableValue(text, '该用户私有 service-loop') ?? serviceLoopRows.length,
        non_private_count: numberFromTableValue(text, '非该用户 service-loop'),
        rows: serviceLoopRows,
      },
    },
    interpretation: {
      root_error: text.includes('matrix is singular') ? 'matrix_is_singular' : 'unknown',
      derived_error: text.includes('factorization key not prepared') ? 'factorization_key_not_prepared' : null,
      data_access_level: 'diagnostic_report_only',
    },
  };
}

function makeAccountRepairFollowUps({ task, workspace, blockers }) {
  const followUps = [
    {
      id: 'FU-LCA-COMPUTE-20260510-001',
      title: 'Export credential-scoped process-exchange-flow graph',
      kind: 'dataset-inventory',
      category: 'account-governance',
      priority: 'P0',
      owner: 'tiangong-lca-cli',
      capability_scope: 'Export credential-scoped process, exchange, flow, reference-flow, state_code, and source evidence inventory.',
      shared_or_project_specific: 'shared',
      why_not_foundry_local: 'The export needs a reusable authenticated current-account data command with a stable JSON contract.',
      expected_input_contract: 'Current TianGong env credentials, account/user filter, dataset scope, and explicit --out-dir.',
      expected_output_contract: 'Process/exchange/flow/reference-flow JSON or JSONL files plus source manifest and error_class.',
      suggested_location: 'tiangong-lca-cli dataset inventory/export command, then foundry adapter',
      blocker: 'The current foundry probe can freeze data for this task, but a durable reusable current-account process/exchange/flow export command is still missing.',
      expected_output: 'Current env account process rows, exchanges, reference flow rows, state_code inventory, and source manifest.',
      done_criteria: 'A repeatable CLI command writes JSON/JSONL inventory plus manifest to an explicit out-dir without remote mutation.',
    },
    {
      id: 'FU-LCA-COMPUTE-20260510-002',
      title: 'Implement reference-flow closure checker for process exchanges',
      kind: 'reference-closure',
      category: 'matrix-readiness',
      priority: 'P0',
      owner: 'tiangong-lca-cli or tiangong-lca-skills',
      capability_scope: 'Classify provider closure for every non-elementary process exchange flow.',
      shared_or_project_specific: 'shared',
      why_not_foundry_local: 'Closure checking is a reusable matrix-readiness capability and should be exposed as a stable CLI command before a thin skill wrapper.',
      expected_input_contract: 'Process-exchange-flow graph JSON, flow type/category metadata, reference-flow process inventory, unit and dimension fields.',
      expected_output_contract: 'Per-exchange closure JSON, status counts, unresolved issue list, markdown summary, and error_class on failure.',
      suggested_location: 'CLI command first, thin skill wrapper second',
      blocker: 'The current foundry probe can classify the frozen task graph, but a reusable CLI/skill closure checker is still missing.',
      expected_output: 'Per-exchange closure JSON with closed/missing/proxy/cutoff/unit/dimension statuses and markdown summary.',
      done_criteria: 'Every exchange in the target scope has exactly one closure status and unresolved rows have follow-up records.',
    },
    {
      id: 'FU-LCA-COMPUTE-20260510-003',
      title: 'Add state-code-aware mutation plan validator',
      kind: 'schema-repair',
      category: 'mutation-policy',
      priority: 'P0',
      owner: 'tiangong-lca-data-foundry',
      capability_scope: 'Validate foundry mutation-plan entries against state_code, evidence, dry-run, and remote-write gates.',
      shared_or_project_specific: 'project-specific',
      why_not_foundry_local: 'This gate enforces foundry task policy over foundry-owned mutation-plan artifacts.',
      expected_input_contract: 'Foundry mutation-plan JSON and evidence manifest paths.',
      expected_output_contract: 'Validator JSON with pass/fail gate status, reasons, and blocked remote commit flag.',
      suggested_location: 'scripts/foundry.mjs validator or dedicated foundry command',
      blocker: 'Mutation plans need an executable gate that enforces update-first for state_code=0 and source review for state_code=100.',
      expected_output: 'Validator report with pass/fail gate status for every proposed mutation.',
      done_criteria: 'Plans without evidence, insert reason, dry-run status, or state_code policy are rejected before remote write.',
    },
    {
      id: 'FU-LCA-COMPUTE-20260510-004',
      title: 'Add dry-run update command for account process repairs',
      kind: 'publish-dry-run',
      category: 'account-governance',
      priority: 'P0',
      owner: 'tiangong-lca-cli',
      capability_scope: 'Dry-run account process repair mutations without committing remote writes.',
      shared_or_project_specific: 'shared',
      why_not_foundry_local: 'Dry-run mutation semantics must match the public remote write path and should be callable outside a single foundry task.',
      expected_input_contract: 'State-code-aware mutation plan JSON, account/dataset scope, credentials, and explicit --dry-run --out-dir flags.',
      expected_output_contract: 'Dry-run result JSON with would_update, would_insert, skip, manual-review, errors, and remote_commit_allowed=false.',
      suggested_location: 'tiangong process save-draft or dataset mutation dry-run command',
      blocker: 'The current task has no evidence-backed eligible repair payloads, and a reusable dry-run mutation command is still needed for future eligible candidates.',
      expected_output: 'Dry-run result listing rows that would update, insert, skip, or require manual review.',
      done_criteria: 'Dry-run succeeds on explicit input files and writes machine-readable operation counts without committing.',
    },
    {
      id: 'FU-LCA-COMPUTE-20260510-005',
      title: 'Add matrix readiness and compute verification command',
      kind: 'verification',
      category: 'matrix-readiness',
      priority: 'P0',
      owner: 'tiangong-lca-calculator or tiangong-lca-cli',
      capability_scope: 'Verify matrix readiness and compute factorization status for a repaired process graph.',
      shared_or_project_specific: 'shared',
      why_not_foundry_local: 'The readiness result depends on calculator behavior and should be exposed through a reusable command rather than inferred in foundry.',
      expected_input_contract: 'Frozen process graph or dataset snapshot, calculation scope, account context, and explicit --out-dir.',
      expected_output_contract: 'Readiness JSON with closure gate, matrix construction status, factorization status, compute validation status, blockers, and error_class.',
      suggested_location: 'calculator-owned readiness check exposed through CLI',
      blocker: 'Matrix readiness and solve_all_unit verification cannot be marked passed until a real checker runs.',
      expected_output: 'Readiness report, factorization status, and compute validation status for a new snapshot.',
      done_criteria: 'A run can prove factorization prepared or produce a precise blocker without fabricating compute success.',
    },
  ];
  const workspaceTaskDir = path.join(workspace, 'follow-ups');
  fs.mkdirSync(workspaceTaskDir, { recursive: true });
  const queueRecords = [];
  for (const followUp of followUps) {
    const body = `---
id: ${followUp.id}
title: ${JSON.stringify(followUp.title)}
state: Ready
kind: ${followUp.kind}
category: ${followUp.category}
priority: ${followUp.priority}
allow_remote_commit: false
parent_task: ${task.meta.id}
owner_project: ${JSON.stringify(followUp.owner)}
capability_scope: ${JSON.stringify(followUp.capability_scope)}
shared_or_project_specific: ${JSON.stringify(followUp.shared_or_project_specific)}
why_not_foundry_local: ${JSON.stringify(followUp.why_not_foundry_local)}
expected_input_contract: ${JSON.stringify(followUp.expected_input_contract)}
expected_output_contract: ${JSON.stringify(followUp.expected_output_contract)}
suggested_implementation_location: ${JSON.stringify(followUp.suggested_location)}
---

## Blocker

${followUp.blocker}

## Expected Output

${followUp.expected_output}

## Owning Project

${followUp.owner}

## Ownership Decision

Shared or project-specific: ${followUp.shared_or_project_specific}

${followUp.why_not_foundry_local}

## Expected Input Contract

${followUp.expected_input_contract}

## Expected Output Contract

${followUp.expected_output_contract}

## Suggested Implementation Location

${followUp.suggested_location}

## Done Criteria

${followUp.done_criteria}

## Generated From

- parent task: ${task.meta.id}
- generated at: ${nowIso()}
- blocker context: ${blockers.join('; ')}
`;
    const fileName = `${followUp.id.toLowerCase()}.md`;
    const workspacePath = path.join(workspaceTaskDir, fileName);
    writeText(workspacePath, body);
    const queuePath = path.join(repoRoot, taskQueues.inbox, fileName);
    if (!fileExists(queuePath) && !findTaskById(followUp.id)) {
      writeText(queuePath, body);
      queueRecords.push({ id: followUp.id, path: path.relative(repoRoot, queuePath), status: 'created' });
    } else {
      queueRecords.push({ id: followUp.id, path: path.relative(repoRoot, queuePath), status: 'already_exists' });
    }
  }
  writeJson(path.join(workspaceTaskDir, 'follow-up-index.json'), {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    follow_up_count: followUps.length,
    queue_records: queueRecords,
    follow_ups: followUps,
  });
  return queueRecords;
}

function cliBinPath() {
  const roots = configuredRoots();
  const candidates = [
    path.join(roots.tiangong_lca_cli_dir, 'bin/tiangong-lca.js'),
    path.join(roots.tiangong_lca_cli_dir, 'bin/tiangong.js'),
  ];
  return candidates.find(fileExists) || candidates[0];
}

function cliCwd() {
  return path.dirname(path.dirname(cliBinPath()));
}

function classifyErrorMessage(message) {
  const text = String(message ?? '');
  if (/SUPABASE_REST_ENV_REQUIRED|Missing Supabase REST runtime env|TIANGONG_LCA_.*required/iu.test(text)) {
    return 'missing_env';
  }
  if (/USER_API_KEY_INVALID|SUPABASE_AUTH_SIGN_IN_FAILED|JWT|invalid login|Invalid API key/iu.test(text)) {
    return 'auth_error';
  }
  if (/permission denied|RLS|row-level security|not authorized|forbidden|403/iu.test(text)) {
    return 'permission_error';
  }
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|timeout|network|AbortError/iu.test(text)) {
    return 'network_error';
  }
  if (/schema|payload invalid|SUPABASE_REST_RESPONSE_INVALID|SUPABASE_REST_PAYLOAD/iu.test(text)) {
    return 'schema_error';
  }
  if (/function .* does not exist|missing rpc|RPC/iu.test(text)) {
    return 'missing_rpc';
  }
  if (/not implemented|planned unified surface|missing .*adapter/iu.test(text)) {
    return 'missing_cli_adapter';
  }
  if (/output|ENOENT|EACCES|ENOSPC/iu.test(text)) {
    return 'output_path_error';
  }
  return 'unknown_error';
}

function parseJsonStdout(stdout) {
  try {
    return { ok: true, json: JSON.parse(stdout || 'null') };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runTiangongJson(
  args,
  { timeoutMs = 600000, cwd = cliCwd(), allowJsonOnFailure = false } = {},
) {
  const binPath = cliBinPath();
  if (!fileExists(binPath)) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: `Missing CLI adapter: ${binPath}`,
      error_class: 'missing_cli_adapter',
      command: ['node', binPath, ...args],
      timeout_ms: timeoutMs,
      timed_out: false,
      duration_ms: 0,
    };
  }
  const command = ['node', binPath, ...args];
  const startedAt = Date.now();
  const run = spawnSync(command[0], command.slice(1), {
    cwd,
    env: process.env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const timedOut = run.error?.code === 'ETIMEDOUT' || /timed out|timeout/iu.test(run.error?.message ?? '');
  const parsedStdout = parseJsonStdout(stdout);
  if (run.error || run.status !== 0) {
    if (allowJsonOnFailure && parsedStdout.ok) {
      return {
        ok: true,
        accepted_nonzero_status: true,
        status: run.status,
        stdout,
        stderr,
        json: parsedStdout.json,
        command,
        timeout_ms: timeoutMs,
        timed_out: timedOut,
        duration_ms: durationMs,
      };
    }
    const message = [run.error?.message, stderr, stdout].filter(Boolean).join('\n');
    return {
      ok: false,
      status: run.status,
      stdout,
      stderr,
      error: run.error?.message ?? (stderr.trim() || stdout.trim()),
      error_class: classifyErrorMessage(message),
      command,
      timeout_ms: timeoutMs,
      timed_out: timedOut,
      duration_ms: durationMs,
    };
  }
  if (parsedStdout.ok) {
    return {
      ok: true,
      status: run.status,
      stdout,
      stderr,
      json: parsedStdout.json,
      command,
      timeout_ms: timeoutMs,
      timed_out: false,
      duration_ms: durationMs,
    };
  }
  return {
    ok: false,
    status: run.status,
    stdout,
    stderr,
    error: parsedStdout.error,
    error_class: 'schema_error',
    command,
    timeout_ms: timeoutMs,
    timed_out: false,
    duration_ms: durationMs,
  };
}

function commandRecord(run) {
  return {
    command: run.command?.join(' ') ?? null,
    ok: Boolean(run.ok),
    status: run.status ?? null,
    error_class: run.error_class ?? null,
    stderr_preview: String(run.stderr ?? '').slice(0, 1000),
    error: run.error ?? null,
    timeout_ms: run.timeout_ms ?? null,
    timed_out: Boolean(run.timed_out),
    accepted_nonzero_status: Boolean(run.accepted_nonzero_status),
    duration_ms: run.duration_ms ?? null,
  };
}

function repoRelativePath(filePath) {
  return path.relative(repoRoot, filePath);
}

function readCapabilityRegistry() {
  const registryPath = path.join(repoRoot, automatedLcaCapabilityRegistryPath);
  if (!fileExists(registryPath)) {
    return { schema_version: 1, capabilities: [] };
  }
  return readJson(registryPath);
}

function capabilityById(registry, id) {
  return ensureArray(registry.capabilities).find((capability) => capability?.id === id) ?? {
    id,
    owner_project: 'unknown',
    entrypoint: id,
  };
}

function stripInlineMarkdown(text) {
  return stripMarkdownCell(text)
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseDatasetRef(refText) {
  const [id, version = ''] = String(refText).trim().split('@');
  return {
    id: id.trim(),
    version: version.trim() || null,
  };
}

function parseSampleScenarioRows(samplePath) {
  const text = readText(samplePath);
  const rows = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!/^\|\s*`[^`]+`/u.test(line)) continue;
    const cells = splitMarkdownRow(line);
    const sampleId = stripInlineMarkdown(cells[0]);
    if (!sampleId || sampleId === 'Sample ID') continue;
    const rowReferenceCell = cells[2] ?? '';
    const rowReferences = [
      ...rowReferenceCell.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@[0-9.]+/giu),
    ].map((match) => parseDatasetRef(match[0]));
    const stateCodeMatch = String(cells[3] ?? '').match(/-?\d+/u);
    const safeNameSummary = stripInlineMarkdown(cells[4]);
    const scenario = stripInlineMarkdown(cells[5]);
    const futureTestExpectation = stripInlineMarkdown(cells[6]);
    const dataset = stripInlineMarkdown(cells[1]);
    const kind = /\bflow\b/iu.test(dataset) ? 'flow' : 'process';
    rows.push({
      sample_id: sampleId,
      kind,
      dataset,
      is_group: /\bgroup\b/iu.test(dataset),
      row_references: rowReferences,
      state_code: stateCodeMatch ? Number(stateCodeMatch[0]) : null,
      safe_name_summary: safeNameSummary,
      scenario,
      future_test_expectation: futureTestExpectation,
      source_index_path: repoRelativePath(samplePath),
    });
  }
  return rows;
}

function sampleCas(sample) {
  return sample.safe_name_summary.match(/\bCAS\s+([0-9-]+)/iu)?.[1] ?? null;
}

function sampleGeography(sample, index = 0) {
  const explicit = sample.safe_name_summary.match(/\{([A-Z]{2})\}/u)?.[1];
  if (explicit) return explicit;
  if (/wind/u.test(sample.sample_id)) return index === 1 ? 'EU' : 'CN';
  if (/electrolyte|fec|basic-violet/u.test(sample.sample_id)) return 'GLO';
  return 'CN';
}

function sampleTechnologyRoute(sample, index = 0) {
  if (/pv/u.test(sample.sample_id)) return 'PV installation';
  if (/electrolyte/u.test(sample.sample_id)) return 'lithium-ion battery electrolyte production';
  if (/wind/u.test(sample.sample_id)) {
    if (index < 0) return 'wind turbine manufacturing route under review';
    return index === 1 ? 'offshore wind turbine manufacturing' : 'onshore wind turbine manufacturing';
  }
  return `${sample.kind} sample route`;
}

function sampleFlowType(sample) {
  return /elementary/iu.test(`${sample.sample_id} ${sample.scenario}`)
    ? 'Elementary flow'
    : 'Product flow';
}

function sampleReferenceProperty(sample) {
  return sample.kind === 'flow' ? 'mass' : null;
}

function sampleReferenceUnit(sample) {
  if (sample.kind !== 'flow') return 'unit';
  return sampleCas(sample) ? 'kg' : 'unit';
}

function sampleReferenceFlowId(sample) {
  if (/pv/u.test(sample.sample_id)) return '190f39ca-0ec8-5aab-b2d9-c91fc55ee58d';
  return `${sample.sample_id}-reference-flow`;
}

function sampleRow(sample, ref, index = 0) {
  const base = {
    id: ref?.id ?? null,
    version: ref?.version ?? null,
    state_code: sample.state_code,
    name: sample.safe_name_summary,
    sample_id: sample.sample_id,
    source_scenario: sample.scenario,
  };
  if (sample.kind === 'flow') {
    return {
      ...base,
      flow_id: ref?.id ?? null,
      type_of_dataset: sampleFlowType(sample),
      cas: sampleCas(sample),
      flow_property: sampleReferenceProperty(sample),
      reference_unit: sampleReferenceUnit(sample),
      geography: sampleGeography(sample, index),
    };
  }
  return {
    ...base,
    process_id: ref?.id ?? null,
    geography: sampleGeography(sample, index),
    technology_route: sampleTechnologyRoute(sample, index),
    reference_flow_id: sampleReferenceFlowId(sample),
  };
}

function sampleIdentityPreflightInput(sample) {
  const candidates = sample.row_references.map((ref, index) => sampleRow(sample, ref, index));
  const target =
    sample.is_group && sample.kind === 'process'
      ? sampleRow(sample, null, -1)
      : deepClone(candidates[0] ?? sampleRow(sample, null, 0));
  return {
    target,
    candidates,
  };
}

function sampleBuildPlan(sample, identityDecision) {
  const evidenceBindings =
    sample.kind === 'process'
      ? [
          'target',
          'identity_decision.decision',
          'name_plan.base_name',
          'target.geography',
          'target.technology_route',
          'quantitative_reference_plan.reference_flow_id',
        ]
      : [
          'target',
          'identity_decision.decision',
          'name_plan.base_name',
          'target.flow_type',
          'flow_property_plan.reference_property',
          'flow_property_plan.reference_unit',
        ];
  const common = {
    schema_version: 1,
    kind: sample.kind,
    ruleset: {
      id: `${sample.kind}-authoring/strict`,
      version: '1',
    },
    identity_decision: {
      decision: identityDecision,
    },
    evidence_manifest: {
      sources: [
        {
          id: sample.sample_id,
          type: 'sanitized-sample-scenario',
          path: sample.source_index_path,
        },
      ],
      field_bindings: evidenceBindings.map((fieldPath) => ({ field_path: fieldPath })),
    },
    name_plan: {
      base_name: sample.safe_name_summary,
    },
  };
  if (sample.kind === 'flow') {
    return {
      ...common,
      target: {
        flow_type: sampleFlowType(sample),
      },
      flow_property_plan: {
        reference_property: sampleReferenceProperty(sample),
        reference_unit: sampleReferenceUnit(sample),
      },
    };
  }
  return {
    ...common,
    target: {
      geography: sampleGeography(sample),
      technology_route: sampleTechnologyRoute(sample),
    },
    quantitative_reference_plan: {
      reference_flow_id: sampleReferenceFlowId(sample),
      reference_unit: 'unit',
    },
  };
}

function writeCommandCapture(commandDir, label, run) {
  fs.mkdirSync(commandDir, { recursive: true });
  const stdoutPath = path.join(commandDir, `${label}.stdout.txt`);
  const stderrPath = path.join(commandDir, `${label}.stderr.txt`);
  const recordPath = path.join(commandDir, `${label}.command.json`);
  writeText(stdoutPath, run.stdout ?? '');
  writeText(stderrPath, run.stderr ?? '');
  writeJson(recordPath, commandRecord(run));
  return {
    command_record: repoRelativePath(recordPath),
    stdout: repoRelativePath(stdoutPath),
    stderr: repoRelativePath(stderrPath),
  };
}

function providerClosureGate(sample) {
  if (sample.kind !== 'flow') {
    return {
      capability_id: 'foundry.reference-closure.provider-flow-eligibility',
      status: 'not_applicable',
      reason: 'process samples are checked through process identity and reference-flow build-plan gates',
    };
  }
  if (/missing-provider|provider closure failure|no provider/iu.test(
    `${sample.sample_id} ${sample.scenario} ${sample.future_test_expectation}`,
  )) {
    return {
      capability_id: 'foundry.reference-closure.provider-flow-eligibility',
      status: 'missing_provider',
      reason: 'product flow has no provider process in the fixture and must block publish-prep',
    };
  }
  if (sampleFlowType(sample) === 'Elementary flow') {
    return {
      capability_id: 'foundry.reference-closure.provider-flow-eligibility',
      status: 'skipped',
      reason: 'elementary flows are valid exchange references but must be excluded from product-flow provider closure matching',
    };
  }
  return {
    capability_id: 'foundry.reference-closure.provider-flow-eligibility',
    status: 'eligible',
    reason: 'product flow can be considered for product/provider closure matching',
  };
}

function providerClosureBlockers(providerClosure) {
  if (!isBlockingGateStatus(providerClosure?.status)) return [];
  return [
    {
      code: 'provider_closure_not_closed',
      severity: 'blocker',
      message: providerClosure.reason ?? 'Provider closure gate did not pass.',
      path: 'provider_closure.status',
    },
  ];
}

function capabilityRunRecord(registry, capabilityId, run, artifactPaths = {}) {
  const capability = capabilityById(registry, capabilityId);
  return {
    capability_id: capability.id,
    class: capability.class ?? null,
    owner_project: capability.owner_project ?? null,
    entrypoint: capability.entrypoint ?? null,
    command: commandRecord(run),
    artifacts: artifactPaths,
  };
}

function capabilitiesList(options = {}) {
  const registry = readCapabilityRegistry();
  const requestedClass = options.class ? String(options.class) : null;
  const requestedOwner = options.owner ? String(options.owner) : null;
  const capabilities = ensureArray(registry.capabilities).filter((capability) => {
    if (requestedClass && capability.class !== requestedClass) return false;
    if (requestedOwner && capability.owner_project !== requestedOwner) return false;
    return true;
  });
  return {
    schema_version: registry.schema_version ?? 1,
    generated_at_utc: nowIso(),
    registry: automatedLcaCapabilityRegistryPath,
    source_updated_at_utc: registry.updated_at_utc ?? null,
    filters: {
      class: requestedClass,
      owner_project: requestedOwner,
    },
    capability_count: capabilities.length,
    capabilities,
  };
}

const taskKindCapabilityClassRoutes = {
  'account-governance': [
    'dataset-inventory',
    'schema-gate',
    'process-review',
    'flow-review',
    'bilingual-gate',
    'reference-closure',
    'publish-prep',
  ],
  'account-repair': [
    'schema-gate',
    'process-review',
    'flow-review',
    'reference-closure',
    'publish-prep',
    'graph-verification',
  ],
  'external-dataset-curated-import': [
    'tidas-contract-context',
    'external-lca-package-conversion',
    'schema-gate',
    'process-review',
    'flow-review',
    'reference-closure',
    'publish-prep',
    'remote-verification',
  ],
  'source-evidence-dataset-development': [
    'tidas-contract-context',
    'source-document-authoring',
    'source-evidence-review',
    'schema-gate',
    'process-review',
    'flow-review',
  ],
  'category-update': [
    'dataset-inventory',
    'schema-gate',
    'process-review',
    'flow-review',
    'reference-closure',
    'publish-prep',
  ],
  'embedding-maintenance': ['embedding-maintenance'],
  'flow-governance': [
    'dataset-inventory',
    'flow-governance',
    'schema-gate',
    'flow-review',
    'bilingual-gate',
    'reference-closure',
    'remote-publish',
  ],
  'hybrid-retrieval': ['hybrid-search'],
  'lifecyclemodel-build': ['lifecyclemodel-builder', 'schema-gate', 'publish-prep'],
  'process-build': [
    'dataset-inventory',
    'process-build',
    'process-authoring-required-fields',
    'schema-gate',
    'process-review',
    'bilingual-gate',
    'publish-prep',
  ],
  'publish-dry-run': ['publish-prep', 'remote-publish'],
  verification: ['schema-gate', 'reference-closure', 'remote-verification', 'graph-verification'],
};

const requiredGateCapabilityClassRoutes = {
  bilingual: ['bilingual-gate'],
  'build-plan': ['process-build', 'flow-governance'],
  contract: ['tidas-contract-context'],
  context: ['tidas-contract-context'],
  conversion: ['external-lca-package-conversion'],
  compute: ['graph-verification'],
  graph: ['graph-verification'],
  identity: ['dataset-inventory'],
  import: ['external-lca-package-conversion'],
  publish: ['publish-prep', 'remote-publish'],
  reference: ['reference-closure'],
  'reference-closure': ['reference-closure'],
  remote: ['remote-verification'],
  review: ['process-review', 'flow-review'],
  ruleset: ['process-review', 'flow-review', 'publish-prep', 'remote-publish'],
  schema: ['schema-gate'],
  source: ['source-document-authoring', 'source-evidence-review'],
  verification: ['schema-gate', 'reference-closure', 'remote-verification', 'graph-verification'],
};

const missingCapabilityClassOwners = {
  'embedding-maintenance': 'tiangong-lca-edge-functions / lca-domain-embedding',
  'external-lca-package-conversion': 'tiangong-lca-cli / tidas-tools',
  'graph-verification': 'tiangong-lca-calculator',
  'hybrid-search': 'tiangong-lca-cli / tiangong-lca-skills / tiangong-lca-edge-functions',
  'lifecyclemodel-builder': 'tiangong-lca-cli / tiangong-lca-skills',
  'remote-verification': 'tiangong-lca-edge-functions / database-engine / tiangong-lca-cli',
  'source-document-authoring': 'tiangong-lca-cli / tiangong-lca-skills',
  'source-evidence-review': 'tiangong-lca-cli / tiangong-lca-skills',
};

function normalizedList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizedList(item));
  }
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeRouteToken(value) {
  return String(value ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    || 'unknown';
}

function taskMetaFromRouterOptions(options = {}) {
  if (options.taskObject) {
    return {
      task: options.taskObject,
      meta: options.taskObject.meta ?? {},
      sourceTaskPath: options.taskObject.relPath ?? null,
    };
  }
  const taskPath = options.task || options.taskFile;
  if (taskPath) {
    const task = readTaskFile(resolveRepoPath(taskPath));
    return { task, meta: task.meta, sourceTaskPath: task.relPath };
  }
  const meta = {
    id: options.taskId || options.id || `route-${safeRouteToken(options.kind || 'unknown-task')}`,
    kind: options.kind || options.taskKind || 'unknown',
    category: options.category ?? null,
    repo_owner: options.owner || options.repoOwner || null,
    dataset_type: options.datasetType || options.datasetKind || null,
    required_gates: options.requiredGates || null,
  };
  return { task: null, meta, sourceTaskPath: null };
}

function normalizeRouteTaskKind(meta) {
  const kind = String(meta.kind ?? '').trim();
  const category = String(meta.category ?? '').trim();
  if (kind) return kind;
  if (category === 'lca-compute-matrix-readiness') return 'verification';
  return 'unknown';
}

function capabilityClassesForGate(gate, datasetType = 'all') {
  const normalizedGate = String(gate ?? '').trim();
  const type = String(datasetType ?? 'all').trim();
  if (normalizedGate === 'build-plan') {
    if (type === 'process') return ['process-build'];
    if (type === 'flow') return ['flow-governance'];
  }
  if (normalizedGate === 'publish') {
    if (type === 'process') return ['publish-prep'];
    if (type === 'flow') return ['remote-publish'];
  }
  if (normalizedGate === 'review') {
    if (type === 'process') return ['process-review'];
    if (type === 'flow') return ['flow-review'];
  }
  if (normalizedGate === 'ruleset') {
    if (type === 'process') return ['process-review', 'publish-prep'];
    if (type === 'flow') return ['flow-review', 'remote-publish'];
  }
  return requiredGateCapabilityClassRoutes[normalizedGate] ?? [normalizedGate];
}

function routeClassesForTask(meta, options = {}, datasetType = 'all') {
  const kind = normalizeRouteTaskKind(meta);
  const directClasses = normalizedList(options.classes || options.capabilityClasses);
  const gateNames = uniqueStrings([
    ...normalizedList(meta.required_gates ?? meta.requiredGates),
    ...normalizedList(options.requiredGates),
  ]);
  const gateClasses = gateNames.flatMap((gate) => capabilityClassesForGate(gate, datasetType));
  const defaultClasses = taskKindCapabilityClassRoutes[kind] ?? [];
  return uniqueStrings([...defaultClasses, ...gateClasses, ...directClasses])
    .filter((className) => capabilityClassMatchesDatasetType(className, datasetType));
}

function capabilityClassMatchesDatasetType(className, datasetType) {
  const type = String(datasetType ?? '').trim();
  if (!type || type === 'all') return true;
  if (type === 'process' && ['flow-governance', 'flow-review', 'remote-publish'].includes(className)) {
    return false;
  }
  if (type === 'flow' && ['process-build', 'process-review', 'process-authoring-required-fields'].includes(className)) {
    return false;
  }
  return true;
}

function capabilityMatchesDatasetType(capability, datasetType) {
  const type = String(datasetType ?? '').trim();
  if (!type || type === 'all') return true;
  if (type === 'process' && capability.id.startsWith('cli.flow.')) return false;
  if (type === 'flow' && capability.id.startsWith('cli.process.')) return false;
  return true;
}

function suggestedOwnerForMissingClass(className) {
  return missingCapabilityClassOwners[className] ?? 'tiangong-lca-data-foundry';
}

function buildCapabilityRoutePlan(options = {}) {
  const registry = readCapabilityRegistry();
  const { meta, sourceTaskPath } = taskMetaFromRouterOptions(options);
  const taskId = String(meta.id || options.taskId || `route-${safeRouteToken(meta.kind || 'task')}`);
  const kind = normalizeRouteTaskKind(meta);
  const datasetType = String(
    options.datasetType || options.datasetKind || meta.dataset_type || meta.datasetKind || 'all',
  ).trim() || 'all';
  const ownerFilter = String(options.owner || options.repoOwner || meta.repo_owner || '').trim();
  const capabilities = ensureArray(registry.capabilities);
  const classes = routeClassesForTask(meta, options, datasetType);
  const selectedCapabilities = capabilities.filter((capability) =>
    classes.includes(capability.class)
    && capabilityMatchesDatasetType(capability, datasetType)
    && (!ownerFilter || capability.owner_project === ownerFilter),
  );
  const selectedByClass = new Map();
  for (const capability of selectedCapabilities) {
    if (!selectedByClass.has(capability.class)) selectedByClass.set(capability.class, []);
    selectedByClass.get(capability.class).push(capability);
  }
  const routes = classes.map((className) => {
    const routeCapabilities = selectedByClass.get(className) ?? [];
    return {
      class: className,
      status: routeCapabilities.length > 0 ? 'routed' : 'missing_capability',
      capability_ids: routeCapabilities.map((capability) => capability.id),
      owner_projects: uniqueStrings(routeCapabilities.map((capability) => capability.owner_project)),
      missing_owner_project: routeCapabilities.length > 0 ? null : suggestedOwnerForMissingClass(className),
    };
  });
  const missingCapabilities = routes
    .filter((route) => route.status === 'missing_capability')
    .map((route) => ({
      class: route.class,
      owner_project: route.missing_owner_project,
      reason: `No capability with class=${route.class} is registered for kind=${kind}.`,
      suggested_action: 'Create a capability-development follow-up in the owning repo instead of implementing shared business logic inside Foundry.',
    }));
  const adapterWorkspacePlan = selectedCapabilities.map((capability, index) => ({
    capability_id: capability.id,
    class: capability.class,
    owner_project: capability.owner_project,
    entrypoint: capability.entrypoint,
    remote_write_mode: capability.remote_write_mode,
    verification_gate: capability.verification_gate,
    output_dir: `.foundry/workspaces/${taskId}/adapters/${String(index + 1).padStart(2, '0')}-${safeRouteToken(capability.id)}`,
  }));
  const status =
    classes.length === 0
      ? 'no_route'
      : missingCapabilities.length > 0
        ? 'missing_capabilities'
        : 'routed';
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task: {
      id: taskId,
      kind,
      category: meta.category ?? null,
      source_task_path: sourceTaskPath,
      dataset_type: datasetType,
      repo_owner: ownerFilter || null,
      required_gates: uniqueStrings([
        ...normalizedList(meta.required_gates ?? meta.requiredGates),
        ...normalizedList(options.requiredGates),
      ]),
    },
    status,
    next_action:
      status === 'routed'
        ? 'Run selected adapters into their planned output directories and collect gate artifacts.'
        : status === 'missing_capabilities'
          ? 'Create or update capability-development follow-ups for missing shared capabilities before autonomous execution.'
          : 'Add task kind or required gate metadata so Foundry can route the task.',
    capability_registry: automatedLcaCapabilityRegistryPath,
    source_registry_updated_at_utc: registry.updated_at_utc ?? null,
    counts: {
      required_classes: classes.length,
      selected_capabilities: selectedCapabilities.length,
      missing_capabilities: missingCapabilities.length,
    },
    required_classes: classes,
    routes,
    selected_capabilities: selectedCapabilities,
    missing_capabilities: missingCapabilities,
    adapter_workspace_plan: adapterWorkspacePlan,
  };
}

function renderCapabilityRoutePlanMarkdown(plan) {
  const routeRows = plan.routes.map((route) => ({
    class: route.class,
    status: route.status,
    capabilities: route.capability_ids.join(', ') || '-',
    owner: route.owner_projects.join(', ') || route.missing_owner_project || '-',
  }));
  return `# Capability Route Plan

Generated: ${plan.generated_at_utc}

Task: ${plan.task.id}

Kind: \`${plan.task.kind}\`

Status: \`${plan.status}\`

Next action: ${plan.next_action}

## Routes

${buildMarkdownTable(routeRows, ['class', 'status', 'capabilities', 'owner'])}
`;
}

function writeCapabilityRoutePlan(plan, outDir) {
  if (!outDir) return plan;
  const resolvedOutDir = resolveRepoPath(outDir);
  const files = {
    capability_route_plan: repoRelativePath(path.join(resolvedOutDir, 'capability-route-plan.json')),
    capability_selection: repoRelativePath(path.join(resolvedOutDir, 'capability-selection.json')),
    report: repoRelativePath(path.join(resolvedOutDir, 'reports/capability-route-plan.md')),
  };
  const planWithFiles = { ...plan, files };
  writeJson(path.join(resolvedOutDir, 'capability-route-plan.json'), planWithFiles);
  writeJson(path.join(resolvedOutDir, 'capability-selection.json'), {
    schema_version: 1,
    generated_at_utc: plan.generated_at_utc,
    task_id: plan.task.id,
    registry: automatedLcaCapabilityRegistryPath,
    selected_capabilities: plan.selected_capabilities,
    adapter_workspace_plan: plan.adapter_workspace_plan,
  });
  writeText(
    path.join(resolvedOutDir, 'reports/capability-route-plan.md'),
    renderCapabilityRoutePlanMarkdown(plan),
  );
  return planWithFiles;
}

function runCapabilityRoute(options = {}) {
  const taskId = options.taskId || options.id || null;
  const outDir = options.outDir
    || (taskId ? path.join('.foundry/workspaces', String(taskId), 'capability-route') : null);
  return writeCapabilityRoutePlan(buildCapabilityRoutePlan(options), outDir);
}

function capabilityCommandGateStatus(capability) {
  const command = capability?.command ?? {};
  if (command.timed_out) return 'command_timed_out';
  if (!command.ok) return 'command_failed';
  return 'completed';
}

function isBlockingGateStatus(status) {
  return new Set([
    'blocked',
    'blocked_matrix_readiness',
    'block_duplicate',
    'command_failed',
    'command_timed_out',
    'failed',
    'manual_review',
    'missing_input',
    'missing_report',
    'missing_provider',
    'verification_failed',
  ]).has(String(status ?? ''));
}

function gateIndexRecord({
  registry,
  taskId,
  runKind,
  sampleId = null,
  datasetKind = null,
  capabilityId,
  status,
  nextAction = null,
  blockers = [],
  qualityGaps = [],
  artifacts = {},
  command = null,
}) {
  const capability = capabilityById(registry, capabilityId);
  const gateStatus = status || capabilityCommandGateStatus({ command });
  return {
    task_id: taskId,
    run_kind: runKind,
    sample_id: sampleId,
    dataset_kind: datasetKind,
    capability_id: capability.id,
    class: capability.class ?? null,
    owner_project: capability.owner_project ?? null,
    entrypoint: capability.entrypoint ?? null,
    status: gateStatus,
    blocking: isBlockingGateStatus(gateStatus),
    next_action: nextAction,
    blockers: ensureArray(blockers),
    quality_gaps: ensureArray(qualityGaps),
    command,
    artifacts,
  };
}

function writeGateIndex({ workspace, registry, report, runKind, gates }) {
  const blockingGates = gates.filter((gate) => gate.blocking);
  const commandFailures = gates.filter((gate) =>
    ['command_failed', 'command_timed_out'].includes(gate.status),
  );
  const gateIndex = {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: report.task_id,
    run_kind: runKind,
    status: blockingGates.length > 0 ? 'blocked' : 'passed',
    source_report_status: report.status,
    workspace: repoRelativePath(workspace),
    capability_registry: automatedLcaCapabilityRegistryPath,
    counts: {
      gates: gates.length,
      blocking_gates: blockingGates.length,
      command_failures: commandFailures.length,
    },
    gates,
  };
  writeJson(path.join(workspace, 'gate-index.json'), gateIndex);
  return gateIndex;
}

function writeVerificationHandoff({ workspace, report, runKind, entries }) {
  const blockingEntries = entries.filter((entry) => entry.blocking);
  const handoff = {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: report.task_id,
    run_kind: runKind,
    status: blockingEntries.length > 0 ? 'requires_review' : 'clear',
    autonomous_progression_allowed: blockingEntries.length === 0,
    remote_write_allowed: false,
    remote_write_policy: 'disabled unless the task explicitly allows commit and all gates pass',
    entries,
  };
  writeJson(path.join(workspace, 'verification-handoff.json'), handoff);
  return handoff;
}

function handoffEntry({
  state,
  sampleId = null,
  datasetKind = null,
  capabilityId = null,
  summary,
  blockers = [],
  qualityGaps = [],
  nextAction = null,
  artifacts = {},
  blocking = true,
}) {
  return {
    state,
    sample_id: sampleId,
    dataset_kind: datasetKind,
    capability_id: capabilityId,
    summary,
    blocking,
    blockers: ensureArray(blockers),
    quality_gaps: ensureArray(qualityGaps),
    next_action: nextAction,
    artifacts,
  };
}

function writeMutationPlanHandoff({ workspace, report, runKind, entries }) {
  const handoff = {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: report.task_id,
    run_kind: runKind,
    status: entries.some((entry) => entry.status === 'blocked') ? 'blocked' : 'ready_for_review',
    remote_write_mode: 'no_remote_write',
    required_before_commit: [
      'schema gate passed',
      'review gate passed',
      'bilingual evidence complete',
      'remote reference/version verification passed',
      'publish gate report passed',
      'explicit human approval for remote writes',
    ],
    entries,
  };
  writeJson(path.join(workspace, 'mutation-plan-handoff.json'), handoff);
  return handoff;
}

function sampleScenarioGateEntries(registry, report) {
  const gates = [];
  for (const sample of report.samples) {
    for (const capability of sample.capabilities) {
      let status = capabilityCommandGateStatus(capability);
      let nextAction = null;
      if (capability.capability_id.endsWith('identity-preflight')) {
        status = ['manual_review', 'block_duplicate'].includes(sample.identity.decision)
          ? sample.identity.decision
          : sample.identity.status;
        nextAction = sample.identity.next_action;
      } else if (capability.capability_id.endsWith('build-plan.validate')) {
        status = sample.build_plan_validate.status;
        nextAction = sample.build_plan_validate.next_action;
      } else if (capability.capability_id.endsWith('build-plan.materialize')) {
        status = sample.build_plan_materialize.status;
        nextAction = sample.build_plan_materialize.next_action;
      }
      gates.push(gateIndexRecord({
        registry,
        taskId: report.task_id,
        runKind: 'sample-scenarios-dry-run',
        sampleId: sample.sample_id,
        datasetKind: sample.kind,
        capabilityId: capability.capability_id,
        status,
        nextAction,
        blockers: sample.blockers,
        artifacts: capability.artifacts,
        command: capability.command,
      }));
    }
    gates.push(gateIndexRecord({
      registry,
      taskId: report.task_id,
      runKind: 'sample-scenarios-dry-run',
      sampleId: sample.sample_id,
      datasetKind: sample.kind,
      capabilityId: 'foundry.reference-closure.provider-flow-eligibility',
      status: sample.provider_closure.status,
      nextAction: sample.provider_closure.reason,
      artifacts: {},
      command: null,
    }));
  }
  return gates;
}

function sampleScenarioVerificationEntries(report) {
  const entries = [];
  for (const sample of report.samples) {
    if (['manual_review', 'block_duplicate'].includes(sample.identity.decision)) {
      entries.push(handoffEntry({
        state: sample.identity.decision,
        sampleId: sample.sample_id,
        datasetKind: sample.kind,
        capabilityId: `cli.${sample.kind}.identity-preflight`,
        summary: `Identity decision is ${sample.identity.decision}.`,
        blockers: sample.blockers,
        nextAction: sample.identity.next_action,
      }));
    }
    for (const capability of sample.capabilities) {
      if (!capability.command?.ok) {
        entries.push(handoffEntry({
          state: 'verification_failed',
          sampleId: sample.sample_id,
          datasetKind: sample.kind,
          capabilityId: capability.capability_id,
          summary: `${capability.capability_id} command did not complete successfully.`,
          blockers: sample.blockers,
          artifacts: capability.artifacts,
        }));
      }
    }
    if (sample.blocker_count > 0 && !entries.some((entry) => entry.sample_id === sample.sample_id)) {
      entries.push(handoffEntry({
        state: 'manual_review',
        sampleId: sample.sample_id,
        datasetKind: sample.kind,
        summary: 'Build-plan dry-run produced blockers that need review before mutation planning.',
        blockers: sample.blockers,
      }));
    }
  }
  return entries;
}

function sampleScenarioMutationEntries(report) {
  return report.samples.map((sample) => {
    const materializeCapability = sample.capabilities.find((capability) =>
      capability.capability_id.endsWith('build-plan.materialize'),
    );
    return {
      sample_id: sample.sample_id,
      dataset_kind: sample.kind,
      status: sample.blocker_count > 0 ? 'blocked' : 'candidate_materialized',
      identity_decision: sample.identity.decision,
      mutation_source: materializeCapability?.artifacts?.materialized_artifact ?? null,
      gate_report: materializeCapability?.artifacts?.gate_report ?? null,
      blockers: sample.blockers,
      next_action:
        sample.blocker_count > 0
          ? 'Resolve blockers before authoring mutation payloads.'
          : 'Route materialized dry-run payload through schema, review, reference, and publish gates.',
    };
  });
}

function targetKindCapabilityStatus(kindResult, capability) {
  const id = capability.capability_id;
  if (id.endsWith('complete-required-fields')) {
    if (Number(kindResult.required_fields?.blocked ?? 0) > 0) return 'blocked';
    return kindResult.required_fields?.status ?? capabilityCommandGateStatus(capability);
  }
  if (id.endsWith('dataset-validate')) {
    if (Number(kindResult.schema?.invalid ?? 0) > 0) return 'blocked';
    return kindResult.schema?.status ?? capabilityCommandGateStatus(capability);
  }
  if (id.endsWith('.review')) return kindResult.review?.status ?? capabilityCommandGateStatus(capability);
  if (id.endsWith('bilingual.apply')) {
    return kindResult.bilingual?.apply_status ?? capabilityCommandGateStatus(capability);
  }
  if (id.endsWith('bilingual.validate')) {
    const blockerCount = Number(kindResult.bilingual?.scan?.blocker_count ?? 0);
    if (blockerCount > 0 || kindResult.bilingual?.validate_status === 'blocked') return 'blocked';
    return kindResult.bilingual?.validate_status ?? capabilityCommandGateStatus(capability);
  }
  if (id.endsWith('remote-verify')) {
    if (Number(kindResult.remote_verification?.blocker_count ?? 0) > 0) return 'blocked';
    return kindResult.remote_verification?.status ?? capabilityCommandGateStatus(capability);
  }
  if (id.endsWith('remote-refresh')) {
    if (Number(kindResult.remote_verification?.blocker_count ?? 0) > 0) return 'blocked';
    return kindResult.remote_verification?.refresh_status ?? capabilityCommandGateStatus(capability);
  }
  return capabilityCommandGateStatus(capability);
}

function targetDatasetGateEntries(registry, report) {
  const gates = [];
  for (const sample of report.samples) {
    for (const kind of ['process', 'flow']) {
      const kindResult = sample[kind];
      if (!kindResult) continue;
      for (const capability of kindResult.capabilities) {
        gates.push(gateIndexRecord({
          registry,
          taskId: report.task_id,
          runKind: 'target-datasets-gate-run',
          sampleId: sample.sample_id,
          datasetKind: kind,
          capabilityId: capability.capability_id,
          status: targetKindCapabilityStatus(kindResult, capability),
          nextAction: kindResult.status === 'target_quality_ready' ? 'Ready for publish-prep gate.' : null,
          blockers: kindResult.readiness_blockers,
          qualityGaps: kindResult.quality_gaps,
          artifacts: capability.artifacts,
          command: capability.command,
        }));
      }
    }
  }
  return gates;
}

function targetDatasetVerificationEntries(report) {
  const entries = [];
  for (const sample of report.samples) {
    const commandFailureCount =
      Number(sample.process?.command_failure_count ?? 0) + Number(sample.flow?.command_failure_count ?? 0);
    const hasReadinessBlockers = Number(sample.readiness_blocker_count ?? 0) > 0;
    if (commandFailureCount > 0 || hasReadinessBlockers) {
      entries.push(handoffEntry({
        state: 'verification_failed',
        sampleId: sample.sample_id,
        summary: 'Target dataset gates have command failures or readiness blockers.',
        blockers: sample.readiness_blockers,
        qualityGaps: sample.quality_gaps,
        nextAction: 'Fix blocking gates before publish-prep.',
      }));
    }
    if (sample.quality_gap_count > 0) {
      entries.push(handoffEntry({
        state: 'manual_review',
        sampleId: sample.sample_id,
        summary: hasReadinessBlockers
          ? 'Target dataset has quality gaps in addition to readiness blockers.'
          : 'Target dataset passed blocking gates but still has quality gaps.',
        blockers: sample.readiness_blockers,
        qualityGaps: sample.quality_gaps,
        nextAction: 'Complete AI transcreation/evidence review and rerun target-datasets gate.',
      }));
    }
    if (sample.target_quality_ready) {
      entries.push(handoffEntry({
        state: 'publish_ready',
        sampleId: sample.sample_id,
        summary: 'Target dataset is ready for publish-prep gates and explicit human approval.',
        nextAction: 'Run process publish-build, flow publish-version, and publish run verification gates.',
        blocking: true,
      }));
    }
  }
  return entries;
}

function targetDatasetMutationEntries(report) {
  return report.samples.map((sample) => ({
    sample_id: sample.sample_id,
    status: sample.target_quality_ready ? 'publish_gate_ready' : 'blocked',
    process_rows:
      sample.process?.verified_rows_file ??
      sample.process?.gate_rows_file ??
      sample.process?.rows_file ??
      null,
    flow_rows:
      sample.flow?.verified_rows_file ??
      sample.flow?.gate_rows_file ??
      sample.flow?.rows_file ??
      null,
    readiness_blockers: sample.readiness_blockers,
    quality_gaps: sample.quality_gaps,
    publish_gate_capabilities: [
      'cli.process.publish-build',
      'cli.flow.publish-version',
      'cli.publish.run',
    ],
    next_action: sample.target_quality_ready
      ? 'Run publish-prep gates and request explicit remote-write approval.'
      : 'Resolve readiness blockers and quality gaps before publish-prep.',
  }));
}

function normalizeSampleFilter(value) {
  return String(value ?? 'all')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sampleMatchesFilter(sampleId, filter) {
  return filter.length === 0 || filter.includes('all') || filter.includes(sampleId);
}

function postWriteStatusForVerifyRun(run) {
  if (!run.ok) return 'command_failed';
  if (Number(run.json?.counts?.blockers ?? 0) > 0) return 'blocked_post_write_verification';
  if (run.json?.status === 'passed_remote_verification') return 'passed_post_write_verification';
  return run.json?.status ?? 'completed';
}

function edgeVerifyRemoteUrl() {
  return envValue('FOUNDRY_EDGE_VERIFY_REMOTE_URL')
    || envValue('TIANGONG_LCA_EDGE_VERIFY_REMOTE_URL');
}

function edgeVerifyRemoteJwt() {
  return envValue('FOUNDRY_EDGE_VERIFY_REMOTE_JWT')
    || envValue('TIANGONG_LCA_EDGE_VERIFY_REMOTE_JWT')
    || envValue('TIANGONG_LCA_ACCESS_TOKEN');
}

function edgeReferencesFromCliChecks(checks) {
  return checks
    .filter((check) => check && typeof check === 'object')
    .filter((check) => check.table && check.id)
    .map((check) => {
      const reference = {
        table: check.table,
        id: check.id,
        version: check.version ?? null,
        role: check.role === 'root' ? 'root' : 'reference',
      };
      if (typeof check.path === 'string' && check.path.trim()) {
        reference.path = check.path;
      }
      return reference;
    });
}

async function runEdgeVerifyRemoteRequest({ payload, outDir, requireEdge }) {
  const requestPath = path.join(outDir, 'edge-verify-request.json');
  const responsePath = path.join(outDir, 'edge-verify-response.json');
  writeJson(requestPath, payload);

  const url = edgeVerifyRemoteUrl();
  const jwt = edgeVerifyRemoteJwt();
  if (!url || !jwt) {
    return {
      status: requireEdge ? 'blocked_edge_not_configured' : 'skipped_not_configured',
      blocking: Boolean(requireEdge),
      url_configured: Boolean(url),
      jwt_configured: Boolean(jwt),
      request: repoRelativePath(requestPath),
      response: null,
      blockers: requireEdge
        ? ['Edge dataset verify-remote URL/JWT is required but not configured']
        : [],
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    writeJson(responsePath, {
      status: response.status,
      ok: response.ok,
      duration_ms: Date.now() - startedAt,
      body: json,
    });
    const blockerCount = Number(json?.data?.counts?.blockers ?? json?.blockers?.length ?? 0);
    const passed = response.ok && blockerCount === 0;
    return {
      status: passed ? 'passed_remote_verification' : 'blocked_remote_verification',
      blocking: !passed,
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
      request: repoRelativePath(requestPath),
      response: repoRelativePath(responsePath),
      blockers: passed
        ? []
        : ensureArray(json?.data?.blockers ?? json?.blockers ?? json?.message ?? 'Edge verify-remote call failed'),
    };
  } catch (error) {
    writeJson(responsePath, {
      status: null,
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: 'edge_request_failed',
      blocking: true,
      duration_ms: Date.now() - startedAt,
      request: repoRelativePath(requestPath),
      response: repoRelativePath(responsePath),
      blockers: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runPostWriteKindVerification({
  registry,
  sampleId,
  kind,
  rowsFile,
  sampleDir,
  requireEdge,
}) {
  const kindDir = path.join(sampleDir, kind);
  const cliVerifyOutDir = path.join(kindDir, 'cli-verify-remote');
  const edgeVerifyOutDir = path.join(kindDir, 'edge-verify-remote');
  if (!rowsFile || !fileExists(resolveRepoPath(rowsFile))) {
    return {
      kind,
      rows_file: maybeRepoRelative(rowsFile),
      status: 'missing_input',
      command_failure_count: 0,
      blocker_count: 1,
      blockers: [`missing ${kind} rows file for post-write verification`],
      verification: null,
      edge_verification: null,
      capabilities: [],
    };
  }

  const verifyRun = runTiangongJson(
    [
      'dataset',
      'verify-remote',
      '--input',
      resolveRepoPath(rowsFile),
      '--out-dir',
      cliVerifyOutDir,
      '--root-policy',
      'existing',
      '--json',
    ],
    { allowJsonOnFailure: true },
  );
  const cliCapture = writeCommandCapture(path.join(kindDir, 'commands'), 'cli-verify-remote', verifyRun);
  const checksPath = verifyRun.json?.files?.checks ? resolveRepoPath(verifyRun.json.files.checks) : null;
  const cliChecks = checksPath && fileExists(checksPath) ? readJsonOrJsonl(checksPath) : [];
  const edgePayload = {
    rootPolicy: 'existing',
    references: edgeReferencesFromCliChecks(cliChecks),
  };
  const edgeVerification = await runEdgeVerifyRemoteRequest({
    payload: edgePayload,
    outDir: edgeVerifyOutDir,
    requireEdge,
  });
  const cliBlockers = Number(verifyRun.json?.counts?.blockers ?? (verifyRun.ok ? 0 : 1));
  const edgeBlockers = edgeVerification.blocking ? ensureArray(edgeVerification.blockers).length || 1 : 0;
  const blockers = [
    ...ensureArray(verifyRun.json?.blockers).map((blocker) =>
      typeof blocker === 'string' ? blocker : blocker.message ?? JSON.stringify(blocker),
    ),
    ...ensureArray(edgeVerification.blockers).map((blocker) =>
      typeof blocker === 'string' ? blocker : blocker.message ?? JSON.stringify(blocker),
    ),
  ];
  const status =
    !verifyRun.ok
      ? 'command_failed'
      : cliBlockers > 0 || edgeBlockers > 0
        ? 'blocked_post_write_verification'
        : 'passed_post_write_verification';
  const capability = targetDatasetCapabilityRecord(registry, `cli.${kind}.remote-verify`, verifyRun, {
    rows_file: maybeRepoRelative(rowsFile),
    out_dir: repoRelativePath(cliVerifyOutDir),
    report: maybeRepoRelative(verifyRun.json?.files?.report),
    checks: maybeRepoRelative(verifyRun.json?.files?.checks),
    blockers: maybeRepoRelative(verifyRun.json?.files?.blockers),
    edge_request: edgeVerification.request,
    edge_response: edgeVerification.response,
    ...cliCapture,
  });

  return {
    kind,
    sample_id: sampleId,
    rows_file: maybeRepoRelative(rowsFile),
    status,
    command_failure_count: verifyRun.ok ? 0 : 1,
    blocker_count: cliBlockers + edgeBlockers,
    blockers,
    verification: {
      status: postWriteStatusForVerifyRun(verifyRun),
      root_policy: verifyRun.json?.root_policy ?? 'existing',
      counts: verifyRun.json?.counts ?? null,
      report: maybeRepoRelative(verifyRun.json?.files?.report),
      checks: maybeRepoRelative(verifyRun.json?.files?.checks),
    },
    edge_verification: edgeVerification,
    capabilities: [capability],
  };
}

function postWriteVerificationEntries(report) {
  const entries = [];
  for (const sample of report.samples) {
    const blockers = [
      ...ensureArray(sample.process?.blockers),
      ...ensureArray(sample.flow?.blockers),
    ];
    if (sample.status === 'passed_post_write_verification') {
      entries.push(handoffEntry({
        state: 'publish_ready',
        sampleId: sample.sample_id,
        summary: 'Post-write readback and remote verification passed for process and flow rows.',
        nextAction: 'Run compute verification and explicit publish policy review before state transition.',
        artifacts: {
          report: report.files?.post_write_verification_report ?? null,
        },
        blocking: true,
      }));
    } else {
      entries.push(handoffEntry({
        state: 'verification_failed',
        sampleId: sample.sample_id,
        summary: 'Post-write readback or remote verification did not pass.',
        blockers,
        nextAction: 'Repair remote visibility/version blockers before publish-ready handoff.',
      }));
    }
  }
  return entries;
}

function postWriteGateEntries(registry, report) {
  const gates = [];
  for (const sample of report.samples) {
    for (const kind of ['process', 'flow']) {
      const kindResult = sample[kind];
      if (!kindResult) continue;
      for (const capability of kindResult.capabilities ?? []) {
        gates.push(gateIndexRecord({
          registry,
          taskId: report.task_id,
          runKind: 'post-write-verify',
          sampleId: sample.sample_id,
          datasetKind: kind,
          capabilityId: capability.capability_id,
          status: kindResult.status,
          nextAction:
            kindResult.status === 'passed_post_write_verification'
              ? 'Remote row is visible with exact version and closed references.'
              : 'Resolve post-write verification blockers.',
          blockers: kindResult.blockers,
          artifacts: capability.artifacts,
          command: capability.command,
        }));
      }
    }
  }
  return gates;
}

function postWriteCoverageDelta(report) {
  return {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: report.task_id,
    source_report: report.source_target_report,
    samples: report.samples.map((sample) => ({
      sample_id: sample.sample_id,
      status: sample.status,
      process: {
        checked_references: sample.process?.verification?.counts?.checked ?? null,
        blocker_count: sample.process?.blocker_count ?? null,
        by_status: sample.process?.verification?.counts?.by_status ?? null,
      },
      flow: {
        checked_references: sample.flow?.verification?.counts?.checked ?? null,
        blocker_count: sample.flow?.blocker_count ?? null,
        by_status: sample.flow?.verification?.counts?.by_status ?? null,
      },
    })),
  };
}

function renderPostWriteVerificationMarkdown(report) {
  const rows = report.samples.map((sample) => ({
    sample: sample.sample_id,
    process: sample.process?.status ?? 'n/a',
    flow: sample.flow?.status ?? 'n/a',
    blockers: sample.blocker_count,
  }));
  return `# Automated LCA Post-Write Verification

Generated: ${report.generated_at_utc}

Task: ${report.task_id}

Status: \`${report.status}\`

Source target gate: \`${report.source_target_report}\`

## Result

- Samples: ${report.counts.samples}
- Command failures: ${report.counts.command_failures}
- Blockers: ${report.counts.blockers}
- Edge verify mode: \`${report.edge_verify.mode}\`

${buildMarkdownTable(rows, ['sample', 'process', 'flow', 'blockers'])}

## Notes

- This command performs read-only post-write verification with \`dataset verify-remote --root-policy existing\`.
- Edge verify requests are always written as artifacts; a configured Edge URL/JWT is required only when \`--require-edge\` is true.
`;
}

async function runPostWriteVerification(options = {}) {
  const taskId = String(options.taskId || automatedPostWriteVerifyTaskId);
  const targetReportPath = resolveRepoPath(options.targetReport || defaultAutomatedTargetDatasetGateReportPath);
  const mutationPlanPath = resolveRepoPath(options.mutationPlan || options.mutationHandoff || defaultAutomatedTargetDatasetMutationHandoffPath);
  const workspace = resolveRepoPath(
    options.outDir || path.join('.foundry/workspaces', taskId, 'post-write-verify'),
  );
  const inputFreezeDir = path.join(workspace, 'input-freeze');
  const reportsDir = path.join(workspace, 'reports');
  const requireEdge = boolOption(options.requireEdge, false);
  const sampleFilter = normalizeSampleFilter(options.sample || options.samples || 'all');
  const registry = readCapabilityRegistry();

  if (!fileExists(targetReportPath)) {
    throw new Error(`Missing target dataset gate report: ${targetReportPath}`);
  }
  if (!fileExists(mutationPlanPath)) {
    throw new Error(`Missing mutation handoff: ${mutationPlanPath}`);
  }

  const targetReport = readJson(targetReportPath);
  const mutationPlan = readJson(mutationPlanPath);
  const mutationEntries = ensureArray(mutationPlan.entries)
    .filter((entry) => entry.status === 'publish_gate_ready')
    .filter((entry) => sampleMatchesFilter(entry.sample_id, sampleFilter));

  writeJson(path.join(inputFreezeDir, 'post-write-verification-inputs.json'), {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    source_target_report: repoRelativePath(targetReportPath),
    source_mutation_plan_handoff: repoRelativePath(mutationPlanPath),
    account_context: accountContext(),
    require_edge: requireEdge,
    sample_filter: sampleFilter,
    entries: mutationEntries,
  });

  const samples = [];
  for (const entry of mutationEntries) {
    const sampleDir = path.join(workspace, 'samples', entry.sample_id);
    const processResult = await runPostWriteKindVerification({
      registry,
      sampleId: entry.sample_id,
      kind: 'process',
      rowsFile: entry.process_rows,
      sampleDir,
      requireEdge,
    });
    const flowResult = await runPostWriteKindVerification({
      registry,
      sampleId: entry.sample_id,
      kind: 'flow',
      rowsFile: entry.flow_rows,
      sampleDir,
      requireEdge,
    });
    const blockerCount = Number(processResult.blocker_count ?? 0) + Number(flowResult.blocker_count ?? 0);
    const commandFailureCount =
      Number(processResult.command_failure_count ?? 0) + Number(flowResult.command_failure_count ?? 0);
    samples.push({
      sample_id: entry.sample_id,
      source_target_quality_ready:
        ensureArray(targetReport.samples).find((sample) => sample.sample_id === entry.sample_id)
          ?.target_quality_ready ?? null,
      status:
        blockerCount > 0 || commandFailureCount > 0
          ? 'blocked_post_write_verification'
          : 'passed_post_write_verification',
      command_failure_count: commandFailureCount,
      blocker_count: blockerCount,
      process: processResult,
      flow: flowResult,
    });
  }

  const commandFailureCount = samples.reduce((total, sample) => total + sample.command_failure_count, 0);
  const blockerCount = samples.reduce((total, sample) => total + sample.blocker_count, 0);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    run_kind: 'post-write-verify',
    status:
      mutationEntries.length === 0
        ? 'no_publish_ready_entries'
        : commandFailureCount > 0 || blockerCount > 0
          ? 'blocked_post_write_verification'
          : 'passed_post_write_verification',
    workspace: repoRelativePath(workspace),
    source_target_report: repoRelativePath(targetReportPath),
    source_mutation_plan_handoff: repoRelativePath(mutationPlanPath),
    account_context: accountContext(),
    edge_verify: {
      mode: requireEdge ? 'required' : 'best_effort_request_artifact',
      url_configured: Boolean(edgeVerifyRemoteUrl()),
      jwt_configured: Boolean(edgeVerifyRemoteJwt()),
    },
    counts: {
      samples: samples.length,
      publish_ready_entries: mutationEntries.length,
      command_failures: commandFailureCount,
      blockers: blockerCount,
    },
    samples,
  };
  report.files = {
    post_write_verification_report: repoRelativePath(path.join(workspace, 'post-write-verification-report.json')),
    gate_index: repoRelativePath(path.join(workspace, 'gate-index.json')),
    verification_handoff: repoRelativePath(path.join(workspace, 'verification-handoff.json')),
    coverage_delta: repoRelativePath(path.join(workspace, 'coverage-delta.json')),
    markdown: repoRelativePath(path.join(reportsDir, 'post-write-verification.md')),
  };

  writeJson(path.join(workspace, 'post-write-verification-report.json'), report);
  writeJson(path.join(workspace, 'coverage-delta.json'), postWriteCoverageDelta(report));
  writeGateIndex({
    workspace,
    registry,
    report,
    runKind: 'post-write-verify',
    gates: postWriteGateEntries(registry, report),
  });
  writeVerificationHandoff({
    workspace,
    report,
    runKind: 'post-write-verify',
    entries: postWriteVerificationEntries(report),
  });
  writeText(path.join(reportsDir, 'post-write-verification.md'), renderPostWriteVerificationMarkdown(report));
  return report;
}

function matrixReadinessCalculatorRoot() {
  return configuredRoots().tiangong_lca_calculator_root;
}

function matrixReadinessCommandEnv() {
  const env = { ...process.env };
  const pkgConfigCandidates = [
    '/opt/homebrew/lib/pkgconfig',
    '/opt/homebrew/opt/suite-sparse/lib/pkgconfig',
    '/usr/local/lib/pkgconfig',
    '/usr/local/opt/suite-sparse/lib/pkgconfig',
  ].filter(directoryExists);
  const existing = String(env.PKG_CONFIG_PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const pkgConfigPath = uniqueStrings([...pkgConfigCandidates, ...existing]);
  if (pkgConfigPath.length > 0) {
    env.PKG_CONFIG_PATH = pkgConfigPath.join(path.delimiter);
  }
  return env;
}

function defaultMatrixReadinessInputPath(sampleId) {
  return path.join(matrixReadinessFixtureDir, `${sampleId}.input.json`);
}

function runCalculatorMatrixReadiness({ calculatorRoot, inputPath, reportPath, timeoutMs = 600000 }) {
  const command = [
    'cargo',
    'run',
    '-p',
    'solver-worker',
    '--bin',
    'matrix_readiness',
    '--',
    '--input',
    inputPath,
    '--out',
    reportPath,
  ];
  const startedAt = Date.now();
  const run = spawnSync(command[0], command.slice(1), {
    cwd: calculatorRoot,
    env: matrixReadinessCommandEnv(),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const timedOut = run.error?.code === 'ETIMEDOUT' || /timed out|timeout/iu.test(run.error?.message ?? '');
  const ok = !run.error && run.status === 0 && fileExists(reportPath);
  const message = [run.error?.message, stderr, stdout].filter(Boolean).join('\n');
  return {
    ok,
    status: run.status,
    stdout,
    stderr,
    error: ok ? null : run.error?.message ?? (stderr.trim() || stdout.trim() || 'matrix readiness command failed'),
    error_class: ok ? null : classifyErrorMessage(message),
    command,
    timeout_ms: timeoutMs,
    timed_out: timedOut,
    duration_ms: durationMs,
  };
}

function matrixReadinessStatus(run, calculatorReport) {
  if (!run?.ok) return 'command_failed';
  if (!calculatorReport) return 'missing_report';
  if (calculatorReport.status === 'passed' && ensureArray(calculatorReport.blockers).length === 0) {
    return 'passed_matrix_readiness';
  }
  return 'blocked_matrix_readiness';
}

function matrixReadinessCoverageDelta(report) {
  return {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: report.task_id,
    run_kind: report.run_kind,
    sample_id: report.sample_id,
    source_input: report.input?.source ?? null,
    status: report.status,
    samples: ensureArray(report.samples).map((sample) => ({
      sample_id: sample.sample_id,
      status: sample.status,
      blocker_count: sample.blocker_count,
      provider_closure: sample.metrics?.provider_closure ?? null,
      graph_readiness: sample.metrics?.graph_readiness ?? null,
      compute_stability: sample.metrics?.compute_stability ?? null,
    })),
    provider_closure: report.metrics?.provider_closure ?? null,
    graph_readiness: report.metrics?.graph_readiness ?? null,
    compute_stability: report.metrics?.compute_stability ?? null,
  };
}

function matrixReadinessVerificationEntries(report) {
  return ensureArray(report.samples?.length ? report.samples : [report]).map((sample) => {
    if (sample.status === 'passed_matrix_readiness') {
      return handoffEntry({
        state: 'publish_ready',
        sampleId: sample.sample_id,
        capabilityId: 'calculator.matrix-readiness.verify',
        summary: 'Calculator provider closure, graph readiness, and compute stability gates passed.',
        nextAction: 'Continue to explicit publish policy review and state transition gates.',
        artifacts: {
          report: sample.files?.matrix_readiness_report ?? report.files?.matrix_readiness_report ?? null,
          coverage_delta: report.files?.coverage_delta ?? null,
        },
        blocking: true,
      });
    }
    return handoffEntry({
      state: 'verification_failed',
      sampleId: sample.sample_id,
      capabilityId: 'calculator.matrix-readiness.verify',
      summary: 'Calculator matrix readiness gate did not pass.',
      blockers: sample.blockers,
      nextAction: sample.next_action || 'Repair provider closure, graph readiness, or compute blockers and rerun matrix readiness.',
      artifacts: {
        report: sample.files?.matrix_readiness_report ?? report.files?.matrix_readiness_report ?? null,
        coverage_delta: report.files?.coverage_delta ?? null,
      },
    });
  });
}

function matrixReadinessGateEntries(registry, report) {
  return ensureArray(report.samples?.length ? report.samples : [report]).map((sample) =>
    gateIndexRecord({
      registry,
      taskId: report.task_id,
      runKind: 'matrix-readiness-verify',
      sampleId: sample.sample_id,
      capabilityId: 'calculator.matrix-readiness.verify',
      status: sample.status,
      nextAction: sample.next_action,
      blockers: sample.blockers,
      qualityGaps: sample.findings,
      artifacts: sample.capability?.artifacts ?? report.capability?.artifacts ?? {
        report: sample.files?.matrix_readiness_report ?? report.files?.matrix_readiness_report ?? null,
        coverage_delta: report.files?.coverage_delta ?? null,
      },
      command: sample.capability?.command ?? report.capability?.command ?? null,
    }),
  );
}

function renderMatrixReadinessMarkdown(report) {
  const rows = ensureArray(report.samples).map((sample) => ({
    sample: sample.sample_id,
    status: sample.status,
    blockers: sample.blocker_count,
    evidence: sample.provider_evidence_count,
    next_action: sample.next_action,
  }));
  return `# Automated LCA Matrix Readiness Verification

Generated: ${report.generated_at_utc}

Task: ${report.task_id}

Status: \`${report.status}\`

Calculator root: \`${report.calculator.root}\`

## Result

${buildMarkdownTable(rows, ['sample', 'status', 'blockers', 'evidence', 'next_action'])}

## Notes

- This command delegates provider closure, graph readiness, factorization, singular-risk, and negative-LCIA checks to \`tiangong-lca-calculator\`.
- Foundry only freezes inputs, runs the adapter, records command evidence, and writes gate handoff artifacts.
`;
}

function runMatrixReadinessVerificationBatch({ taskId, samples, workspace, options }) {
  const reportsDir = path.join(workspace, 'reports');
  const childReports = samples.map((sampleId) =>
    runMatrixReadinessVerification({
      ...options,
      sample: sampleId,
      outDir: path.join(workspace, 'samples', sampleId),
    }),
  );
  const sampleReports = childReports.map((childReport) => {
    const sample = deepClone(childReport.samples?.[0] ?? childReport);
    sample.files = childReport.files ?? {};
    sample.capability = childReport.capability ?? null;
    return sample;
  });
  const commandFailures = childReports.reduce(
    (total, childReport) => total + Number(childReport.counts?.command_failures ?? 0),
    0,
  );
  const blockerCount = sampleReports.reduce((total, sample) => total + Number(sample.blocker_count ?? 0), 0);
  const findingCount = sampleReports.reduce((total, sample) => total + Number(sample.finding_count ?? 0), 0);
  const providerEvidenceCount = sampleReports.reduce(
    (total, sample) => total + Number(sample.provider_evidence_count ?? 0),
    0,
  );
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    run_kind: 'matrix-readiness-verify',
    sample_id: 'multiple',
    status:
      commandFailures > 0
        ? 'command_failed'
        : blockerCount > 0
          ? 'blocked_matrix_readiness'
          : 'passed_matrix_readiness',
    workspace: repoRelativePath(workspace),
    input: {
      source: samples.map((sampleId) => defaultMatrixReadinessInputPath(sampleId)),
      frozen: childReports.map((childReport) => childReport.input?.frozen ?? null),
    },
    calculator: {
      root: matrixReadinessCalculatorRoot(),
      pkg_config_path: matrixReadinessCommandEnv().PKG_CONFIG_PATH ?? null,
    },
    account_context: accountContext(),
    counts: {
      samples: sampleReports.length,
      command_failures: commandFailures,
      blockers: blockerCount,
      findings: findingCount,
      provider_evidence: providerEvidenceCount,
    },
    metrics: null,
    samples: sampleReports,
  };
  report.files = {
    matrix_readiness_verification_report: repoRelativePath(path.join(workspace, 'matrix-readiness-verification-report.json')),
    matrix_readiness_report: null,
    gate_index: repoRelativePath(path.join(workspace, 'gate-index.json')),
    verification_handoff: repoRelativePath(path.join(workspace, 'verification-handoff.json')),
    coverage_delta: repoRelativePath(path.join(workspace, 'coverage-delta.json')),
    markdown: repoRelativePath(path.join(reportsDir, 'matrix-readiness-verification.md')),
  };

  const registry = readCapabilityRegistry();
  writeJson(path.join(workspace, 'matrix-readiness-verification-report.json'), report);
  writeJson(path.join(workspace, 'coverage-delta.json'), matrixReadinessCoverageDelta(report));
  writeGateIndex({
    workspace,
    registry,
    report,
    runKind: 'matrix-readiness-verify',
    gates: matrixReadinessGateEntries(registry, report),
  });
  writeVerificationHandoff({
    workspace,
    report,
    runKind: 'matrix-readiness-verify',
    entries: matrixReadinessVerificationEntries(report),
  });
  writeText(path.join(reportsDir, 'matrix-readiness-verification.md'), renderMatrixReadinessMarkdown(report));
  return report;
}

function missingMatrixReadinessInputReport({ taskId, sampleId, workspace, inputPath, registry }) {
  const generatedAt = nowIso();
  const report = {
    schema_version: 1,
    generated_at_utc: generatedAt,
    task_id: taskId,
    run_kind: 'matrix-readiness-verify',
    sample_id: sampleId,
    status: 'missing_input',
    workspace: repoRelativePath(workspace),
    input: {
      source: maybeRepoRelative(inputPath),
      frozen: null,
    },
    calculator: {
      root: matrixReadinessCalculatorRoot(),
    },
    account_context: accountContext(),
    counts: {
      samples: 1,
      command_failures: 0,
      blockers: 1,
      findings: 0,
      provider_evidence: 0,
    },
    metrics: null,
    samples: [
      {
        sample_id: sampleId,
        status: 'missing_input',
        blocker_count: 1,
        finding_count: 0,
        provider_evidence_count: 0,
        next_action: 'Create a matrix_readiness_input.v1 artifact or pass --input.',
        blockers: [`missing matrix readiness input: ${inputPath}`],
        findings: [],
        metrics: null,
      },
    ],
  };
  report.files = {
    matrix_readiness_verification_report: repoRelativePath(path.join(workspace, 'matrix-readiness-verification-report.json')),
    matrix_readiness_report: null,
    gate_index: repoRelativePath(path.join(workspace, 'gate-index.json')),
    verification_handoff: repoRelativePath(path.join(workspace, 'verification-handoff.json')),
    coverage_delta: repoRelativePath(path.join(workspace, 'coverage-delta.json')),
    markdown: repoRelativePath(path.join(workspace, 'reports/matrix-readiness-verification.md')),
  };
  writeJson(path.join(workspace, 'matrix-readiness-verification-report.json'), report);
  writeJson(path.join(workspace, 'coverage-delta.json'), matrixReadinessCoverageDelta(report));
  writeGateIndex({
    workspace,
    registry,
    report,
    runKind: 'matrix-readiness-verify',
    gates: matrixReadinessGateEntries(registry, report),
  });
  writeVerificationHandoff({
    workspace,
    report,
    runKind: 'matrix-readiness-verify',
    entries: matrixReadinessVerificationEntries(report),
  });
  writeText(path.join(workspace, 'reports/matrix-readiness-verification.md'), renderMatrixReadinessMarkdown(report));
  return report;
}

function stableUuidFromText(text) {
  const hex = createHash('sha256').update(String(text)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function datasetRowsFromFile(filePath) {
  const value = readJsonOrJsonl(filePath);
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value?.rows)
      ? value.rows
      : Array.isArray(value?.data)
        ? value.data
        : value && typeof value === 'object'
          ? [value]
          : [];
  return rows.map(normalizeDatasetRowForGraph);
}

function normalizeDatasetRowForGraph(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const id = row.id ?? row.process_id ?? row.flow_id ?? row.dataset_id ?? null;
  const version = row.version ?? row.resolved_version ?? row.requested_version ?? null;
  return {
    ...row,
    ...(id ? { id } : {}),
    ...(version ? { version } : {}),
  };
}

function targetGateRowsPath(result, kind) {
  const candidates = [
    result?.verified_rows_file,
    result?.remote_verification?.refreshed_rows,
    result?.gate_rows_file,
    result?.bilingual?.translated_rows,
    result?.required_fields?.output_rows,
    result?.rows_file,
  ];
  const selected = candidates.find((candidate) => candidate && fileExists(resolveRepoPath(candidate)));
  if (!selected) {
    throw new Error(`Target gate report is missing usable ${kind} rows file.`);
  }
  return selected;
}

function statePartition(row) {
  const stateCode = Number(row?.state_code);
  return Number.isFinite(stateCode) && stateCode >= 100 ? 'public' : 'private';
}

function compiledEdgePartition(providerPartition, consumerPartition) {
  return `${providerPartition}_to_${consumerPartition}`;
}

function indexByProcessKey(processes) {
  return new Map(processes.map((processRecord, index) => [processRecord.key, index]));
}

function targetInputEdges(graph, targetKeys) {
  return graph.exchanges.filter((exchange) => {
    const key = `${exchange.process_id}@${exchange.process_version}`;
    const amount = Number(exchange.amount ?? 1);
    return targetKeys.has(key)
      && exchange.flow_id
      && !exchange.is_elementary_flow
      && !exchange.is_process_quantitative_reference
      && String(exchange.direction ?? '').toLowerCase() === 'input'
      && (!Number.isFinite(amount) || Math.abs(amount) > 0);
  });
}

function providerKeysForTargetEdges(graph, targetKeys) {
  const keys = new Set();
  for (const edge of targetInputEdges(graph, targetKeys)) {
    const consumerKey = `${edge.process_id}@${edge.process_version}`;
    const exactKey = `${edge.flow_id}@${edge.flow_version ?? ''}`;
    for (const provider of graph.providerByExactFlow.get(exactKey) ?? []) {
      if (provider.key !== consumerKey) keys.add(provider.key);
    }
    for (const provider of graph.providerByFlow.get(edge.flow_id) ?? []) {
      if (provider.key !== consumerKey) keys.add(provider.key);
    }
  }
  return keys;
}

function processLocation(processRecord) {
  const dataset = processDataset(processRecord?.payload ?? processRecord);
  return asText(
    dataset.processInformation?.geography?.locationOfOperationSupplyOrProduction?.['@location']
      ?? dataset.processInformation?.geography?.locationOfOperationSupplyOrProduction?.location
      ?? processRecord?.location,
  ) || null;
}

function processReferenceYear(processRecord) {
  const dataset = processDataset(processRecord?.payload ?? processRecord);
  const value = dataset.processInformation?.time?.['common:referenceYear']
    ?? dataset.processInformation?.time?.referenceYear
    ?? processRecord?.reference_year;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function processAnnualSupplyOrProductionVolume(processRecord) {
  const dataset = processDataset(processRecord?.payload ?? processRecord);
  const value = dataset.modellingAndValidation?.LCIMethodAndAllocation?.annualSupplyOrProductionVolume
    ?? dataset.modellingAndValidation?.LCIMethod?.annualSupplyOrProductionVolume
    ?? processRecord?.annual_supply_or_production_volume;
  const text = asText(value);
  const match = text.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/u);
  const numeric = match ? Number(match[0]) : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function providerCandidateRecord(provider, providerIdx) {
  return {
    provider_idx: providerIdx,
    provider_id: provider.id,
    provider_version: provider.version ?? null,
    process_name: provider.name || null,
    location: processLocation(provider),
    reference_year: processReferenceYear(provider),
    annual_supply_or_production_volume: processAnnualSupplyOrProductionVolume(provider),
  };
}

function providerDecisionRows(decisionsPath) {
  if (!decisionsPath) return [];
  const resolved = resolveRepoPath(decisionsPath);
  if (!fileExists(resolved)) throw new Error(`provider decisions file not found: ${decisionsPath}`);
  const value = readJsonOrJsonl(resolved);
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value?.decisions)
      ? value.decisions
      : value && typeof value === 'object'
        ? [value]
        : [];
  return rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

function providerDecisionIndex(decisions) {
  const byExactFlow = new Map();
  const byFlow = new Map();
  for (const decision of decisions) {
    const flowId = asText(decision.flow_id);
    if (!flowId) continue;
    const flowVersion = asText(decision.flow_version);
    if (flowVersion) byExactFlow.set(`${flowId}@${flowVersion}`, decision);
    if (!byFlow.has(flowId)) byFlow.set(flowId, decision);
  }
  return { byExactFlow, byFlow };
}

function providerDecisionForEdge(index, edge) {
  const exact = index.byExactFlow.get(`${edge.flow_id}@${edge.flow_version ?? ''}`);
  return exact ?? index.byFlow.get(edge.flow_id) ?? null;
}

function candidateMatchesDecision(candidate, decision) {
  if (!decision) return false;
  const providerId = asText(decision.provider_id);
  const providerVersion = asText(decision.provider_version);
  if (providerId && candidate.provider_id !== providerId) return false;
  if (providerVersion && candidate.provider_version !== providerVersion) return false;
  return Boolean(providerId || providerVersion);
}

function visibleProviderScopeRows(workspace, options = {}) {
  if (options.providerScope !== 'account-visible') {
    return {
      rows: [],
      files: {},
      commands: {},
      blockers: [],
      status: 'not_requested',
    };
  }
  const scopeDir = path.join(workspace, 'input-freeze/provider-scope');
  const refreshOutDir = path.join(scopeDir, 'process-refresh-references-probe');
  const commands = {};
  const blockers = [];
  const refresh = runTiangongJson([
    'process',
    'refresh-references',
    '--out-dir',
    refreshOutDir,
    '--dry-run',
    '--limit',
    '1',
    '--page-size',
    '1000',
    '--json',
  ], { timeoutMs: numberOption(options.remoteTimeoutMs, 120000, { min: 1000 }) });
  commands.process_refresh_references_probe = commandRecord(refresh);
  if (!refresh.ok) {
    blockers.push(refresh.error ?? 'process refresh-references probe failed');
    return {
      rows: [],
      files: { process_refresh_probe: repoRelativePath(refreshOutDir) },
      commands,
      blockers,
      status: 'failed',
    };
  }

  const manifestPath = path.join(refreshOutDir, 'inputs/processes.manifest.json');
  const manifest = fileExists(manifestPath) ? readJson(manifestPath) : null;
  if (!manifest?.user_id) {
    blockers.push('process refresh manifest did not expose current user id');
    return {
      rows: [],
      files: { process_refresh_manifest: maybeRepoRelative(manifestPath) },
      commands,
      blockers,
      status: 'failed',
    };
  }

  const privateRowsPath = path.join(scopeDir, 'current-user-processes.state-code-0.json');
  const publicRowsPath = path.join(scopeDir, 'visible-public-processes.state-code-100-199.json');
  const privateProcesses = runTiangongJson([
    'process',
    'list',
    '--user-id',
    manifest.user_id,
    '--state-code',
    '0',
    '--all',
    '--page-size',
    '1000',
    '--json',
  ], { timeoutMs: numberOption(options.remoteTimeoutMs, 120000, { min: 1000 }) });
  commands.current_user_process_list = commandRecord(privateProcesses);

  const publicStateArgs = [];
  for (let code = 100; code <= 199; code += 1) publicStateArgs.push('--state-code', String(code));
  const publicProcesses = runTiangongJson([
    'process',
    'list',
    ...publicStateArgs,
    '--all',
    '--page-size',
    '1000',
    '--json',
  ], { timeoutMs: numberOption(options.remoteTimeoutMs, 120000, { min: 1000 }) });
  commands.visible_public_process_list = commandRecord(publicProcesses);

  if (!privateProcesses.ok || !publicProcesses.ok) {
    if (!privateProcesses.ok) blockers.push(privateProcesses.error ?? 'current-user process list failed');
    if (!publicProcesses.ok) blockers.push(publicProcesses.error ?? 'visible-public process list failed');
    return {
      rows: [],
      files: {
        process_refresh_manifest: maybeRepoRelative(manifestPath),
      },
      commands,
      blockers,
      status: 'failed',
    };
  }

  const privateRows = ensureArray(privateProcesses.json?.rows).map((row) => ({
    ...row,
    source_scope: 'current_user_state_code_0',
  }));
  const publicRows = ensureArray(publicProcesses.json?.rows).map((row) => ({
    ...row,
    source_scope: 'visible_public_state_code_100_199',
  }));
  writeJson(privateRowsPath, privateProcesses.json);
  writeJson(publicRowsPath, publicProcesses.json);
  return {
    rows: [...publicRows, ...privateRows],
    files: {
      process_refresh_manifest: maybeRepoRelative(manifestPath),
      current_user_processes: repoRelativePath(privateRowsPath),
      visible_public_processes: repoRelativePath(publicRowsPath),
    },
    commands,
    blockers,
    status: 'completed',
  };
}

function buildMatrixReadinessInputFromTargetGraph({
  sample,
  processRows,
  flowRows,
  providerRows,
  reviewedProviderDecisions = [],
}) {
  const targetKeys = new Set(processRows.map((row) => `${row.id}@${row.version}`));
  const rowsByKey = new Map();
  for (const row of providerRows) rowsByKey.set(`${row.id}@${row.version}`, row);
  for (const row of processRows) rowsByKey.set(`${row.id}@${row.version}`, { ...row, source_scope: 'target_sample' });
  const flowMetadata = makeFlowMetadata(flowRows);
  const preliminaryGraph = makeProcessGraph([...rowsByKey.values()], flowMetadata);
  const candidateProviderKeys = providerKeysForTargetEdges(preliminaryGraph, targetKeys);
  const selectedRows = [...rowsByKey.entries()]
    .filter(([key]) => targetKeys.has(key) || candidateProviderKeys.has(key))
    .map(([, row]) => row);
  const allRows = selectedRows.length > 0 ? selectedRows : [...rowsByKey.values()];
  const graph = makeProcessGraph(allRows, flowMetadata);
  const processIndex = indexByProcessKey(graph.processes);
  const inputEdges = targetInputEdges(graph, targetKeys);
  const flowIds = uniqueStrings(inputEdges.map((edge) => edge.flow_id).filter(Boolean)).sort();
  const flowIndex = new Map(flowIds.map((flowId, index) => [flowId, index]));
  const providerDecisions = [];
  const technosphereEntries = [];
  const technosphereEdges = [];
  let matchedUniqueProvider = 0;
  let matchedMultiProvider = 0;
  let matchedMultiResolved = 0;
  let matchedMultiUnresolved = 0;
  let unmatchedNoProvider = 0;
  let aInputEdgesWritten = 0;
  const reviewedDecisionIndex = providerDecisionIndex(reviewedProviderDecisions);

  for (const edge of inputEdges) {
    const consumerKey = `${edge.process_id}@${edge.process_version}`;
    const consumerIdx = processIndex.get(consumerKey);
    const exactKey = `${edge.flow_id}@${edge.flow_version ?? ''}`;
    const exactProviders = (graph.providerByExactFlow.get(exactKey) ?? []).filter((provider) => provider.key !== consumerKey);
    const anyProviders = (graph.providerByFlow.get(edge.flow_id) ?? []).filter((provider) => provider.key !== consumerKey);
    const candidates = (exactProviders.length > 0 ? exactProviders : anyProviders)
      .map((provider) => providerCandidateRecord(provider, processIndex.get(provider.key)))
      .filter((candidate) => Number.isInteger(candidate.provider_idx));
    const reviewedDecision = providerDecisionForEdge(reviewedDecisionIndex, edge);
    const reviewedCandidate = reviewedDecision
      ? candidates.find((candidate) => candidateMatchesDecision(candidate, reviewedDecision))
      : null;
    let decisionKind = 'no_provider';
    let resolutionStrategy = null;
    let failureReason = 'no_provider_candidates';
    const allocations = [];
    if (reviewedDecision && reviewedCandidate && Number.isInteger(consumerIdx)) {
      decisionKind = 'multi_resolved';
      resolutionStrategy = 'best_provider_strict';
      failureReason = null;
      matchedMultiProvider += candidates.length > 1 ? 1 : 0;
      matchedMultiResolved += 1;
      aInputEdgesWritten += 1;
      allocations.push({ provider_idx: reviewedCandidate.provider_idx, weight: 1 });
      const amount = Math.abs(Number(edge.amount ?? 1)) || 1;
      technosphereEntries.push({ row: reviewedCandidate.provider_idx, col: consumerIdx, value: amount });
      const provider = graph.processes[reviewedCandidate.provider_idx];
      const providerPartition = statePartition(provider);
      const consumerProcess = graph.processes[consumerIdx];
      const consumerPartition = statePartition(consumerProcess);
      technosphereEdges.push({
        provider_idx: reviewedCandidate.provider_idx,
        consumer_idx: consumerIdx,
        flow_id: edge.flow_id,
        amount,
        provider_partition: providerPartition,
        consumer_partition: consumerPartition,
        partition: compiledEdgePartition(providerPartition, consumerPartition),
      });
    } else if (exactProviders.length === 1 && Number.isInteger(consumerIdx)) {
      const provider = exactProviders[0];
      const providerIdx = processIndex.get(provider.key);
      if (Number.isInteger(providerIdx)) {
        decisionKind = 'unique_provider';
        resolutionStrategy = 'unique_provider';
        failureReason = null;
        matchedUniqueProvider += 1;
        aInputEdgesWritten += 1;
        allocations.push({ provider_idx: providerIdx, weight: 1 });
        const amount = Math.abs(Number(edge.amount ?? 1)) || 1;
        technosphereEntries.push({ row: providerIdx, col: consumerIdx, value: amount });
        const providerPartition = statePartition(provider);
        const consumerProcess = graph.processes[consumerIdx];
        const consumerPartition = statePartition(consumerProcess);
        technosphereEdges.push({
          provider_idx: providerIdx,
          consumer_idx: consumerIdx,
          flow_id: edge.flow_id,
          amount,
          provider_partition: providerPartition,
          consumer_partition: consumerPartition,
          partition: compiledEdgePartition(providerPartition, consumerPartition),
        });
      }
    } else if (candidates.length > 0) {
      decisionKind = 'multi_unresolved';
      failureReason = reviewedDecision ? 'reviewed_provider_not_in_candidate_set' : 'rule_requires_unique_provider';
      matchedMultiProvider += 1;
      matchedMultiUnresolved += 1;
    } else {
      unmatchedNoProvider += 1;
    }
    providerDecisions.push({
      consumer_idx: Number.isInteger(consumerIdx) ? consumerIdx : -1,
      flow_id: edge.flow_id,
      candidate_provider_count: candidates.length,
      matched_provider_count: decisionKind === 'unique_provider' ? 1 : 0,
      candidates,
      decision_kind: decisionKind,
      resolution_strategy: resolutionStrategy,
      failure_reason: failureReason,
      reviewed_decision: reviewedDecision ? {
        provider_id: asText(reviewedDecision.provider_id) || null,
        provider_version: asText(reviewedDecision.provider_version) || null,
        rationale: asText(reviewedDecision.rationale) || null,
        evidence: asText(reviewedDecision.evidence) || null,
        reviewer: asText(reviewedDecision.reviewer) || null,
      } : null,
      used_equal_fallback: false,
      volume_fallback_to_one_count: 0,
      geography_tier: null,
      supply_region_source: 'unspecified',
      supply_region_location: null,
      exchange_location_present: false,
      allocations,
    });
  }

  const inputEdgesTotal = inputEdges.length;
  const aWritePct = inputEdgesTotal > 0 ? (aInputEdgesWritten / inputEdgesTotal) * 100 : 100;
  const providerResolvedPct = inputEdgesTotal > 0
    ? ((matchedUniqueProvider + matchedMultiResolved) / inputEdgesTotal) * 100
    : 100;
  const missingReferenceCount = graph.processes.filter((processRecord) => !processRecord.quantitative_reference_internal_id).length;
  const invalidReferenceCount = graph.processes.filter(
    (processRecord) => processRecord.quantitative_reference_internal_id && !processRecord.reference_exchange_found,
  ).length;
  const mNnz = technosphereEntries.length;
  const processCount = graph.processes.length;
  const matrixArea = Math.max(processCount * processCount, 1);
  const matrixInput = {
    schema_version: 'matrix_readiness_input.v1',
    snapshot_id: stableUuidFromText(`target-matrix:${sample.sample_id}:${processRows.map((row) => `${row.id}@${row.version}`).join(',')}`),
    coverage: {
      schema_version: 'snapshot_coverage.v2',
      matching: {
        input_edges_total: inputEdgesTotal,
        matched_unique_provider: matchedUniqueProvider,
        matched_multi_provider: matchedMultiProvider,
        unmatched_no_provider: unmatchedNoProvider,
        matched_multi_resolved: matchedMultiResolved,
        matched_multi_unresolved: matchedMultiUnresolved,
        matched_multi_fallback_equal: 0,
        a_input_edges_written: aInputEdgesWritten,
        a_write_pct: aWritePct,
        provider_present_resolved_pct: providerResolvedPct,
        unique_provider_match_pct: providerResolvedPct,
        any_provider_match_pct: inputEdgesTotal > 0 ? ((matchedUniqueProvider + matchedMultiProvider) / inputEdgesTotal) * 100 : 100,
      },
      reference: {
        process_total: processCount,
        normalized_process_count: graph.processes.filter((processRecord) => processRecord.reference_exchange_found).length,
        missing_reference_count: missingReferenceCount,
        invalid_reference_count: invalidReferenceCount,
      },
      allocation: {
        exchange_total: inputEdgesTotal,
        allocation_fraction_present_pct: inputEdgesTotal > 0 ? (aInputEdgesWritten / inputEdgesTotal) * 100 : 100,
        allocation_fraction_missing_count: matchedMultiUnresolved + unmatchedNoProvider,
        allocation_fraction_invalid_count: 0,
      },
      singular_risk: {
        risk_level: aInputEdgesWritten === inputEdgesTotal ? 'low' : 'high',
        prefilter_diag_abs_ge_cutoff: 0,
        postfilter_a_diag_abs_ge_cutoff: 0,
        m_zero_diagonal_count: 0,
        m_min_abs_diagonal: processCount > 0 ? 1 : 0,
      },
      matrix_scale: {
        process_count: processCount,
        flow_count: flowIds.length,
        impact_count: 0,
        a_nnz: technosphereEntries.length,
        b_nnz: 0,
        c_nnz: 0,
        m_nnz_estimated: mNnz,
        m_sparsity_estimated: mNnz / matrixArea,
      },
    },
    payload: {
      model_version: stableUuidFromText(`target-model:${sample.sample_id}`),
      process_count: processCount,
      flow_count: flowIds.length,
      impact_count: 0,
      technosphere_entries: technosphereEntries,
      biosphere_entries: [],
      characterization_factors: [],
    },
    compiled_graph: {
      processes: graph.processes.map((processRecord, index) => ({
        process_idx: index,
        process_id: processRecord.id,
        process_version: processRecord.version,
        process_name: processRecord.name || null,
        model_id: null,
        location: null,
        reference_year: null,
        partition: statePartition(processRecord),
      })),
      flows: flowIds.map((flowId, index) => ({
        flow_idx: index,
        flow_id: flowId,
        kind: 'product',
      })),
      provider_decisions: providerDecisions,
      technosphere_edges: technosphereEdges,
      biosphere_edges: [],
      reference_stats: {
        missing_reference: missingReferenceCount,
        invalid_reference: invalidReferenceCount,
        normalized_processes: graph.processes.filter((processRecord) => processRecord.reference_exchange_found).length,
      },
      allocation_stats: {
        exchange_total: inputEdgesTotal,
        fraction_present_count: aInputEdgesWritten,
        fraction_missing_count: matchedMultiUnresolved + unmatchedNoProvider,
        fraction_invalid_count: 0,
      },
      matching_stats: {
        input_edges_total: inputEdgesTotal,
        matched_unique_provider: matchedUniqueProvider,
        matched_multi_provider: matchedMultiProvider,
        unmatched_no_provider: unmatchedNoProvider,
        matched_multi_resolved: matchedMultiResolved,
        matched_multi_unresolved: matchedMultiUnresolved,
        matched_multi_fallback_equal: 0,
        a_input_edges_written: aInputEdgesWritten,
      },
    },
    policy: {
      min_provider_write_pct: 100,
      max_unmatched_no_provider: 0,
      max_multi_unresolved: 0,
      allow_equal_fallback: false,
      allow_medium_singular_risk: false,
      allow_high_singular_risk: false,
      require_lcia_factors: true,
      run_factorization: true,
    },
  };
  const summary = {
    sample_id: sample.sample_id,
    target_process_count: processRows.length,
    source_provider_process_count: providerRows.length,
    candidate_provider_process_count: candidateProviderKeys.size,
    provider_process_count: Math.max(allRows.length - processRows.length, 0),
    combined_process_count: allRows.length,
    target_input_edges: inputEdgesTotal,
    matched_unique_provider: matchedUniqueProvider,
    matched_multi_resolved: matchedMultiResolved,
    matched_multi_unresolved: matchedMultiUnresolved,
    unmatched_no_provider: unmatchedNoProvider,
    a_input_edges_written: aInputEdgesWritten,
    flow_count: flowIds.length,
  };
  return { matrixInput, graph, summary };
}

function buildTargetGateMatrixReadinessInput({ reportPath, sampleId, workspace, options }) {
  const report = readJson(reportPath);
  const sample = ensureArray(report.samples).find((item) => item.sample_id === sampleId)
    ?? ensureArray(report.samples).find((item) => item.target_quality_ready)
    ?? ensureArray(report.samples)[0];
  if (!sample) {
    throw new Error(`Target gate report has no samples: ${reportPath}`);
  }
  const inputFreezeDir = path.join(workspace, 'input-freeze');
  const processRowsPath = targetGateRowsPath(sample.process, 'process');
  const flowRowsPath = targetGateRowsPath(sample.flow, 'flow');
  const processRows = datasetRowsFromFile(resolveRepoPath(processRowsPath));
  const flowRows = datasetRowsFromFile(resolveRepoPath(flowRowsPath));
  const explicitProviderRows = options.providerRows
    ? datasetRowsFromFile(resolveRepoPath(options.providerRows))
    : [];
  const reviewedProviderDecisions = providerDecisionRows(options.providerDecisions);
  const visibleScope = visibleProviderScopeRows(workspace, options);
  const providerRows = [...explicitProviderRows, ...visibleScope.rows];
  const { matrixInput, graph, summary } = buildMatrixReadinessInputFromTargetGraph({
    sample,
    processRows,
    flowRows,
    providerRows,
    reviewedProviderDecisions,
  });
  const targetProcessRowsPath = path.join(inputFreezeDir, 'target-process-rows.jsonl');
  const targetFlowRowsPath = path.join(inputFreezeDir, 'target-flow-rows.jsonl');
  const providerRowsPath = path.join(inputFreezeDir, 'provider-process-rows.jsonl');
  const graphPath = path.join(inputFreezeDir, 'target-process-graph.json');
  const inputPath = path.join(inputFreezeDir, 'matrix-readiness-input.json');
  writeText(targetProcessRowsPath, jsonLines(processRows));
  writeText(targetFlowRowsPath, jsonLines(flowRows));
  writeText(providerRowsPath, jsonLines(providerRows));
  writeJson(graphPath, {
    generated_at_utc: nowIso(),
    sample_id: sample.sample_id,
    source: {
      target_gate_report: repoRelativePath(reportPath),
      process_rows: processRowsPath,
      flow_rows: flowRowsPath,
      explicit_provider_rows: maybeRepoRelative(options.providerRows),
      provider_decisions: maybeRepoRelative(options.providerDecisions),
      provider_scope: options.providerScope ?? 'target-only',
    },
    summary,
    provider_scope: {
      status: visibleScope.status,
      blockers: visibleScope.blockers,
      files: visibleScope.files,
      commands: visibleScope.commands,
    },
    processes: graph.processes.map(({ payload, ...row }) => row),
    exchanges: graph.exchanges,
  });
  writeJson(inputPath, matrixInput);
  return {
    inputPath,
    sampleId: sample.sample_id,
    summary: {
      ...summary,
      target_gate_report: repoRelativePath(reportPath),
      process_rows: processRowsPath,
      flow_rows: flowRowsPath,
      provider_scope: options.providerScope ?? 'target-only',
      provider_scope_status: visibleScope.status,
      provider_scope_blockers: visibleScope.blockers,
      provider_decisions: maybeRepoRelative(options.providerDecisions),
      provider_decision_count: reviewedProviderDecisions.length,
    },
    files: {
      target_process_rows: repoRelativePath(targetProcessRowsPath),
      target_flow_rows: repoRelativePath(targetFlowRowsPath),
      provider_process_rows: repoRelativePath(providerRowsPath),
      target_process_graph: repoRelativePath(graphPath),
      matrix_readiness_input: repoRelativePath(inputPath),
    },
  };
}

function runMatrixReadinessVerification(options = {}) {
  const taskId = String(options.taskId || automatedMatrixReadinessVerifyTaskId);
  const targetGateReport = options.targetGateReport || options.fromTargetGate || null;
  const requestedSamples = normalizeSampleFilter(options.sample || options.fixture || options.sampleId || 'matrix-readiness-ready');
  const shouldRunBatch = !targetGateReport && !options.input && (requestedSamples.includes('all') || requestedSamples.length > 1);
  if (shouldRunBatch) {
    const samples = requestedSamples.includes('all') ? defaultMatrixReadinessSamples : requestedSamples;
    return runMatrixReadinessVerificationBatch({
      taskId,
      samples,
      workspace: resolveRepoPath(options.outDir || path.join('.foundry/workspaces', taskId, 'matrix-readiness-verify')),
      options,
    });
  }
  let sampleId = String(options.targetSample || requestedSamples[0] || 'matrix-readiness-ready');
  const workspace = resolveRepoPath(
    options.outDir || path.join('.foundry/workspaces', taskId, 'matrix-readiness-verify', sampleId),
  );
  let targetInputBuild = null;
  let inputPath = null;
  if (targetGateReport) {
    targetInputBuild = buildTargetGateMatrixReadinessInput({
      reportPath: resolveRepoPath(targetGateReport),
      sampleId,
      workspace,
      options,
    });
    sampleId = targetInputBuild.sampleId;
    inputPath = targetInputBuild.inputPath;
  } else {
    inputPath = resolveRepoPath(options.input || defaultMatrixReadinessInputPath(sampleId));
  }
  const inputFreezeDir = path.join(workspace, 'input-freeze');
  const reportsDir = path.join(workspace, 'reports');
  const commandsDir = path.join(workspace, 'commands');
  const registry = readCapabilityRegistry();
  const calculatorRoot = path.resolve(options.calculatorRoot || matrixReadinessCalculatorRoot());
  const frozenInputPath = path.join(inputFreezeDir, 'matrix-readiness-input.json');
  const matrixReportPath = path.join(workspace, 'matrix-readiness-report.json');

  if (!fileExists(inputPath)) {
    return missingMatrixReadinessInputReport({
      taskId,
      sampleId,
      workspace,
      inputPath,
      registry,
    });
  }
  fs.mkdirSync(inputFreezeDir, { recursive: true });
  if (path.resolve(inputPath) !== path.resolve(frozenInputPath)) {
    fs.copyFileSync(inputPath, frozenInputPath);
  }

  const run = runCalculatorMatrixReadiness({
    calculatorRoot,
    inputPath: frozenInputPath,
    reportPath: matrixReportPath,
    timeoutMs: numberOption(options.timeoutMs, 600000, { min: 1000 }),
  });
  const commandCapture = writeCommandCapture(commandsDir, 'calculator-matrix-readiness', run);
  const calculatorReport = fileExists(matrixReportPath) ? readJson(matrixReportPath) : null;
  const status = matrixReadinessStatus(run, calculatorReport);
  const blockers = ensureArray(calculatorReport?.blockers).map((blocker) =>
    typeof blocker === 'string' ? blocker : blocker.message ?? JSON.stringify(blocker),
  );
  if (!run.ok && blockers.length === 0) {
    blockers.push(run.error ?? 'matrix readiness command failed');
  }
  const sample = {
    sample_id: sampleId,
    status,
    blocker_count: blockers.length,
    finding_count: ensureArray(calculatorReport?.findings).length,
    provider_evidence_count: ensureArray(calculatorReport?.provider_evidence).length,
    next_action: calculatorReport?.next_action ?? (run.ok ? 'inspect_matrix_readiness_report' : 'repair_adapter_command_failure'),
    blockers,
    findings: ensureArray(calculatorReport?.findings),
    metrics: calculatorReport?.metrics ?? null,
    calculator_report_status: calculatorReport?.status ?? null,
  };
  const capability = capabilityRunRecord(registry, 'calculator.matrix-readiness.verify', run, {
    input: repoRelativePath(frozenInputPath),
    report: maybeRepoRelative(matrixReportPath),
    ...commandCapture,
  });
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    run_kind: 'matrix-readiness-verify',
    sample_id: sampleId,
    status,
    workspace: repoRelativePath(workspace),
    input: {
      source: repoRelativePath(inputPath),
      frozen: repoRelativePath(frozenInputPath),
      target_gate_matrix_input: targetInputBuild?.summary ?? null,
    },
    calculator: {
      root: calculatorRoot,
      pkg_config_path: matrixReadinessCommandEnv().PKG_CONFIG_PATH ?? null,
    },
    account_context: accountContext(),
    counts: {
      samples: 1,
      command_failures: run.ok ? 0 : 1,
      blockers: sample.blocker_count,
      findings: sample.finding_count,
      provider_evidence: sample.provider_evidence_count,
    },
    metrics: calculatorReport?.metrics ?? null,
    capability,
    samples: [sample],
  };
  report.files = {
    matrix_readiness_verification_report: repoRelativePath(path.join(workspace, 'matrix-readiness-verification-report.json')),
    matrix_readiness_report: maybeRepoRelative(matrixReportPath),
    target_process_graph: targetInputBuild?.files?.target_process_graph ?? null,
    gate_index: repoRelativePath(path.join(workspace, 'gate-index.json')),
    verification_handoff: repoRelativePath(path.join(workspace, 'verification-handoff.json')),
    coverage_delta: repoRelativePath(path.join(workspace, 'coverage-delta.json')),
    markdown: repoRelativePath(path.join(reportsDir, 'matrix-readiness-verification.md')),
  };

  writeJson(path.join(workspace, 'matrix-readiness-verification-report.json'), report);
  writeJson(path.join(workspace, 'coverage-delta.json'), matrixReadinessCoverageDelta(report));
  writeGateIndex({
    workspace,
    registry,
    report,
    runKind: 'matrix-readiness-verify',
    gates: matrixReadinessGateEntries(registry, report),
  });
  writeVerificationHandoff({
    workspace,
    report,
    runKind: 'matrix-readiness-verify',
    entries: matrixReadinessVerificationEntries(report),
  });
  writeText(path.join(reportsDir, 'matrix-readiness-verification.md'), renderMatrixReadinessMarkdown(report));
  return report;
}

function readGoldenFixtureMatrix(matrixPath = automatedLcaGoldenFixtureMatrixPath) {
  const resolved = resolveRepoPath(matrixPath);
  const matrix = readJson(resolved);
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    throw new Error(`Golden fixture matrix must be a JSON object: ${matrixPath}`);
  }
  const fixtures = ensureArray(matrix.fixtures);
  if (fixtures.length === 0) {
    throw new Error(`Golden fixture matrix has no fixtures: ${matrixPath}`);
  }
  return {
    ...matrix,
    fixtures,
    matrix_path: repoRelativePath(resolved),
  };
}

function getByDottedPath(value, dottedPath) {
  return String(dottedPath)
    .split('.')
    .filter(Boolean)
    .reduce((current, part) => {
      if (current && typeof current === 'object') return current[part];
      return undefined;
    }, value);
}

function optionalJsonReport(reportPath) {
  if (!reportPath) return { path: null, exists: false, json: null };
  const paths = String(reportPath)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paths.length > 1) {
    const reports = paths.map((entry) => optionalJsonReport(entry));
    const existingReports = reports.filter((report) => report.json);
    return {
      path: reports.map((report) => report.path).join(','),
      exists: existingReports.length === reports.length,
      json: existingReports.length > 0
        ? {
          schema_version: 1,
          merged_runtime_reports: reports.map((report) => ({ path: report.path, exists: report.exists })),
          samples: existingReports.flatMap((report) =>
            reportSamplesWithContext(report.json),
          ),
        }
        : null,
    };
  }
  const resolved = resolveRepoPath(paths[0]);
  const exists = fileExists(resolved);
  const json = exists ? readJson(resolved) : null;
  return {
    path: repoRelativePath(resolved),
    exists,
    json: json ? withSampleContext(json) : null,
  };
}

function reportSamplesWithContext(json) {
  if (!json) return [];
  if (!Array.isArray(json.samples) || json.samples.length === 0) return [json];
  return json.samples.map((sample) => ({
    ...sample,
    input: sample.input ?? json.input ?? null,
    files: sample.files ?? json.files ?? null,
  }));
}

function withSampleContext(json) {
  if (!json || !Array.isArray(json.samples) || json.samples.length === 0) return json;
  return {
    ...json,
    samples: reportSamplesWithContext(json),
  };
}

function checkExpectedRuntimeValue(root, check) {
  const actual = getByDottedPath(root, check.path);
  if (Object.prototype.hasOwnProperty.call(check, 'equals')) {
    return { passed: Object.is(actual, check.equals), actual, expected: check.equals };
  }
  if (Array.isArray(check.includes)) {
    const missing = check.includes.filter((item) => !ensureArray(actual).includes(item));
    return { passed: missing.length === 0, actual, expected: check.includes, missing };
  }
  if (Object.prototype.hasOwnProperty.call(check, 'min')) {
    const numeric = Number(actual);
    return {
      passed: Number.isFinite(numeric) && numeric >= Number(check.min),
      actual,
      expected: `>= ${check.min}`,
    };
  }
  return { passed: false, actual, expected: 'unsupported expectation shape' };
}

function evaluateRuntimeCheck(fixture, check, reports) {
  const report = reports[check.report];
  if (!report?.json) {
    return {
      status: 'not_checked',
      report: check.report,
      sample_id: check.sample_id ?? null,
      path: check.path,
      reason: report?.path ? `runtime report not found: ${report.path}` : 'runtime report not supplied',
    };
  }
  const root = check.sample_id
    ? ensureArray(report.json.samples).find((sample) => sample.sample_id === check.sample_id)
    : report.json;
  if (!root) {
    return {
      status: 'failed',
      report: check.report,
      sample_id: check.sample_id ?? null,
      path: check.path,
      reason: `sample not found for fixture ${fixture.id}`,
    };
  }
  const result = checkExpectedRuntimeValue(root, check);
  return {
    status: result.passed ? 'passed' : 'failed',
    report: check.report,
    sample_id: check.sample_id ?? null,
    path: check.path,
    expected: result.expected,
    actual: result.actual,
    ...(result.missing ? { missing: result.missing } : {}),
  };
}

function renderGoldenFixturesMarkdown(report) {
  const rows = report.fixtures.map((fixture) => ({
    fixture: fixture.id,
    classes: fixture.coverage_classes.join(', '),
    status: fixture.status,
    checks: fixture.runtime_checks.length,
  }));
  return `# Automated LCA Golden Fixture Matrix Check

Generated: ${report.generated_at_utc}

Status: \`${report.status}\`

Matrix: \`${report.matrix_path}\`

## Coverage

- Required classes: ${report.required_coverage_classes.length}
- Missing classes: ${report.missing_coverage_classes.length}
- Runtime checks: ${report.counts.runtime_checks}
- Failed runtime checks: ${report.counts.failed_runtime_checks}
- Unchecked runtime checks: ${report.counts.unchecked_runtime_checks}

${buildMarkdownTable(rows, ['fixture', 'classes', 'status', 'checks'])}
`;
}

function runGoldenFixturesCheck(options = {}) {
  const matrix = readGoldenFixtureMatrix(options.matrix);
  const workspace = resolveRepoPath(
    options.outDir || '.foundry/workspaces/issue-6-automated-lca-target-datasets/golden-fixtures-check',
  );
  const reportsDir = path.join(workspace, 'reports');
  const reports = {
    sample_scenarios: optionalJsonReport(options.sampleReport),
    target_datasets: optionalJsonReport(options.targetReport),
    compute_repair: optionalJsonReport(options.computeReport),
    post_write: optionalJsonReport(options.postWriteReport),
    matrix_readiness: optionalJsonReport(options.matrixReadinessReport),
  };
  const coveredClasses = new Set();
  const fixtures = matrix.fixtures.map((fixture) => {
    const coverageClasses = uniqueStrings(ensureArray(fixture.coverage_classes));
    for (const coverageClass of coverageClasses) coveredClasses.add(coverageClass);
    const runtimeChecks = ensureArray(fixture.runtime_checks).map((check) =>
      evaluateRuntimeCheck(fixture, check, reports),
    );
    const failed = runtimeChecks.filter((check) => check.status === 'failed');
    const unchecked = runtimeChecks.filter((check) => check.status === 'not_checked');
    const status = failed.length > 0 ? 'failed' : unchecked.length > 0 ? 'not_fully_checked' : 'passed';
    return {
      id: fixture.id,
      title: fixture.title ?? fixture.id,
      coverage_classes: coverageClasses,
      source: fixture.source ?? null,
      status,
      runtime_checks: runtimeChecks,
      notes: fixture.notes ?? null,
    };
  });
  const requiredCoverageClasses = uniqueStrings(ensureArray(matrix.required_coverage_classes));
  const missingCoverageClasses = requiredCoverageClasses.filter(
    (coverageClass) => !coveredClasses.has(coverageClass),
  );
  const runtimeChecks = fixtures.flatMap((fixture) => fixture.runtime_checks);
  const failedRuntimeChecks = runtimeChecks.filter((check) => check.status === 'failed');
  const uncheckedRuntimeChecks = runtimeChecks.filter((check) => check.status === 'not_checked');
  const status =
    missingCoverageClasses.length > 0 || failedRuntimeChecks.length > 0
      ? 'failed'
      : uncheckedRuntimeChecks.length > 0
        ? 'passed_with_unchecked_runtime_evidence'
        : 'passed';
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status,
    matrix_path: matrix.matrix_path,
    required_coverage_classes: requiredCoverageClasses,
    missing_coverage_classes: missingCoverageClasses,
    runtime_reports: Object.fromEntries(
      Object.entries(reports).map(([key, value]) => [key, { path: value.path, exists: value.exists }]),
    ),
    counts: {
      fixtures: fixtures.length,
      coverage_classes: coveredClasses.size,
      runtime_checks: runtimeChecks.length,
      failed_runtime_checks: failedRuntimeChecks.length,
      unchecked_runtime_checks: uncheckedRuntimeChecks.length,
    },
    fixtures,
  };
  report.files = {
    report: repoRelativePath(path.join(workspace, 'golden-fixtures-check-report.json')),
    markdown: repoRelativePath(path.join(reportsDir, 'golden-fixtures-check.md')),
  };
  writeJson(path.join(workspace, 'golden-fixtures-check-report.json'), report);
  writeText(path.join(reportsDir, 'golden-fixtures-check.md'), renderGoldenFixturesMarkdown(report));
  return report;
}

function renderSampleDryRunMarkdown(report) {
  const rows = report.samples.map((sample) => ({
    sample: sample.sample_id,
    kind: sample.kind,
    identity: `${sample.identity.status}/${sample.identity.decision}`,
    build_plan: `${sample.build_plan_validate.status}/${sample.build_plan_validate.next_action}`,
    provider_closure: sample.provider_closure.status,
    blocker_count: sample.blocker_count,
  }));
  return `# Automated LCA Sample Scenario Dry-Run

Generated: ${report.generated_at_utc}

Task: ${report.task_id}

Source sample index: \`${report.source_sample_index}\`

## Result

- Overall status: \`${report.status}\`
- Samples: ${report.sample_count}
- CLI adapter: \`${report.cli_adapter.bin_path}\`
- Capability registry: \`${report.capability_registry}\`

${buildMarkdownTable(rows, ['sample', 'kind', 'identity', 'build_plan', 'provider_closure', 'blocker_count'])}

## Notes

- All commands ran in dry-run/report-only mode; no remote writes were attempted.
- Full command stdout/stderr and generated gate artifacts are under \`${report.workspace}\`.
- Elementary flow samples are intentionally excluded from product-flow/provider closure matching while remaining valid elementary exchange references.
`;
}

function maybeRepoRelative(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? repoRelativePath(filePath) : filePath;
}

function targetDatasetRowsCount(filePath) {
  if (!fileExists(filePath)) return 0;
  const rows = readJsonOrJsonl(filePath);
  return Array.isArray(rows) ? rows.length : 1;
}

function selectAutomatedTargetDatasets(options = {}) {
  const requested = String(options.sample || options.samples || 'all')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (requested.length === 0 || requested.includes('all')) {
    return automatedTargetDatasets;
  }
  return automatedTargetDatasets.filter((sample) => requested.includes(sample.sample_id));
}

function targetDatasetCapabilityRecord(registry, capabilityId, run, artifacts = {}) {
  return capabilityRunRecord(registry, capabilityId, run, artifacts);
}

function runTargetDatasetKindGates({
  registry,
  sample,
  kind,
  rowsFile,
  flowRowsFile = null,
  sampleDir,
}) {
  if (!fileExists(rowsFile)) {
    return {
      kind,
      rows_file: maybeRepoRelative(rowsFile),
      row_count: 0,
      status: 'missing_input',
      command_failure_count: 0,
      blocker_count: 1,
      readiness_blockers: [`missing ${kind} rows file`],
      quality_gaps: [],
      capabilities: [],
    };
  }

  const kindDir = path.join(sampleDir, kind);
  const commandDir = path.join(kindDir, 'commands');
  const requiredFieldsOutDir = path.join(kindDir, 'required-fields');
  const requiredFieldsRowsFile = path.join(requiredFieldsOutDir, `${kind}.required-fields.jsonl`);
  const schemaOutDir = path.join(kindDir, 'schema');
  const reviewOutDir = path.join(kindDir, 'review');
  const remoteRefreshOutDir = path.join(kindDir, 'remote-refresh');
  const remoteRefreshedRowsFile = path.join(kindDir, 'remote-refreshed', `${kind}.remote-refreshed.jsonl`);
  let gateRowsFile = rowsFile;
  let requiredFieldsRun = null;
  let requiredFieldsCapture = null;

  if (kind === 'process') {
    const completeRequiredFieldsArgs = [
      'process',
      'complete-required-fields',
      '--input',
      rowsFile,
      '--out',
      requiredFieldsRowsFile,
      '--out-dir',
      requiredFieldsOutDir,
      '--default-unit',
      'unit',
      '--json',
    ];
    if (flowRowsFile && fileExists(flowRowsFile)) {
      completeRequiredFieldsArgs.splice(
        completeRequiredFieldsArgs.length - 1,
        0,
        '--flows',
        flowRowsFile,
      );
    }
    requiredFieldsRun = runTiangongJson(
      completeRequiredFieldsArgs,
      { allowJsonOnFailure: true },
    );
    requiredFieldsCapture = writeCommandCapture(
      commandDir,
      'process-complete-required-fields',
      requiredFieldsRun,
    );
    if (requiredFieldsRun.ok && requiredFieldsRun.json?.status === 'completed') {
      gateRowsFile = requiredFieldsRowsFile;
    }
  }

  const schemaRun = runTiangongJson(
    [
      'dataset',
      'validate',
      '--input',
      gateRowsFile,
      '--type',
      kind,
      '--out-dir',
      schemaOutDir,
      '--json',
    ],
    { allowJsonOnFailure: true },
  );
  const schemaCapture = writeCommandCapture(commandDir, 'schema-validate', schemaRun);

  const reviewRun = runTiangongJson(
    ['review', kind, '--rows-file', gateRowsFile, '--out-dir', reviewOutDir, '--json'],
    { allowJsonOnFailure: true },
  );
  const reviewCapture = writeCommandCapture(commandDir, 'review', reviewRun);

  const remoteRefreshRun = runTiangongJson(
    [
      'dataset',
      'references',
      'refresh-remote',
      '--input',
      gateRowsFile,
      '--out',
      remoteRefreshedRowsFile,
      '--out-dir',
      remoteRefreshOutDir,
      '--root-policy',
      'candidate',
      '--json',
    ],
    { allowJsonOnFailure: true },
  );
  const remoteRefreshCapture = writeCommandCapture(commandDir, 'remote-refresh', remoteRefreshRun);

  const schemaInvalid = Number(schemaRun.json?.counts?.invalid ?? 1);
  const requiredFieldBlockers = Number(requiredFieldsRun?.json?.counts?.blocked ?? 0);
  const remoteVerifyBlockers = Number(remoteRefreshRun.json?.counts?.post_refresh_blockers ?? 0);
  const commandRuns = [
    ...(requiredFieldsRun ? [requiredFieldsRun] : []),
    schemaRun,
    reviewRun,
    remoteRefreshRun,
  ];
  const commandFailures = commandRuns.filter((run) => !run.ok);
  const readinessBlockers = [];
  const qualityGaps = [];

  if (requiredFieldsRun && !requiredFieldsRun.ok) {
    readinessBlockers.push('process required-field completion command failed');
  }
  if (requiredFieldBlockers > 0) {
    readinessBlockers.push(
      `process required-field completion has ${requiredFieldBlockers} blocked row(s)`,
    );
  }
  if (schemaInvalid > 0) {
    readinessBlockers.push(`${kind} schema validation has ${schemaInvalid} invalid row(s)`);
  }
  if (!reviewRun.ok) {
    readinessBlockers.push(`${kind} review command failed`);
  }
  if (!remoteRefreshRun.ok) {
    readinessBlockers.push(`${kind} remote reference/version refresh command failed`);
  }
  if (remoteVerifyBlockers > 0) {
    readinessBlockers.push(
      `${kind} remote reference/version verification has ${remoteVerifyBlockers} blocker(s) after refresh`,
    );
  }

  const status =
    commandFailures.length > 0
      ? 'command_failed'
      : readinessBlockers.length > 0
        ? 'blocked'
        : qualityGaps.length > 0
          ? 'validated_with_quality_gaps'
          : 'target_quality_ready';

  const capabilities = [
    ...(requiredFieldsRun
      ? [
          targetDatasetCapabilityRecord(
            registry,
            'cli.process.complete-required-fields',
            requiredFieldsRun,
            {
              rows_file: maybeRepoRelative(rowsFile),
              flow_rows_file: maybeRepoRelative(flowRowsFile),
              completed_rows: maybeRepoRelative(requiredFieldsRun.json?.files?.output_rows),
              report: maybeRepoRelative(requiredFieldsRun.json?.files?.report),
              evidence: maybeRepoRelative(requiredFieldsRun.json?.files?.evidence),
              ...requiredFieldsCapture,
            },
          ),
        ]
      : []),
    targetDatasetCapabilityRecord(registry, `cli.${kind}.dataset-validate`, schemaRun, {
      rows_file: maybeRepoRelative(gateRowsFile),
      source_rows_file: maybeRepoRelative(rowsFile),
      out_dir: repoRelativePath(schemaOutDir),
      report: maybeRepoRelative(schemaRun.json?.files?.report),
      ...schemaCapture,
    }),
    targetDatasetCapabilityRecord(registry, `cli.${kind}.review`, reviewRun, {
      rows_file: maybeRepoRelative(gateRowsFile),
      out_dir: repoRelativePath(reviewOutDir),
      report: maybeRepoRelative(reviewRun.json?.files?.report),
      ...reviewCapture,
    }),
    targetDatasetCapabilityRecord(registry, `cli.${kind}.remote-refresh`, remoteRefreshRun, {
      rows_file: maybeRepoRelative(gateRowsFile),
      refreshed_rows: maybeRepoRelative(remoteRefreshRun.json?.files?.output_rows),
      out_dir: repoRelativePath(remoteRefreshOutDir),
      report: maybeRepoRelative(remoteRefreshRun.json?.files?.report),
      patches: maybeRepoRelative(remoteRefreshRun.json?.files?.patches),
      pre_verification_report: maybeRepoRelative(remoteRefreshRun.json?.files?.pre_verification_report),
      post_verification_report: maybeRepoRelative(remoteRefreshRun.json?.files?.post_verification_report),
      ...remoteRefreshCapture,
    }),
  ];

  return {
    kind,
    rows_file: maybeRepoRelative(rowsFile),
    gate_rows_file: maybeRepoRelative(gateRowsFile),
    verified_rows_file:
      remoteRefreshRun.json?.status === 'completed'
        ? maybeRepoRelative(remoteRefreshRun.json?.files?.output_rows)
        : maybeRepoRelative(gateRowsFile),
    row_count: targetDatasetRowsCount(rowsFile),
    status,
    command_failure_count: commandFailures.length,
    blocker_count: readinessBlockers.length,
    readiness_blockers: readinessBlockers,
    quality_gaps: qualityGaps,
    schema: {
      status: schemaRun.json?.status ?? 'command_failed',
      valid: schemaRun.json?.counts?.valid ?? null,
      invalid: schemaRun.json?.counts?.invalid ?? null,
    },
    required_fields:
      kind === 'process'
        ? {
            status: requiredFieldsRun?.json?.status ?? (requiredFieldsRun?.ok ? 'completed' : 'not_run'),
            blocked: requiredFieldsRun?.json?.counts?.blocked ?? null,
            completed: requiredFieldsRun?.json?.counts?.completed ?? null,
            existing: requiredFieldsRun?.json?.counts?.existing ?? null,
            output_rows: maybeRepoRelative(requiredFieldsRun?.json?.files?.output_rows),
            evidence: maybeRepoRelative(requiredFieldsRun?.json?.files?.evidence),
          }
        : null,
    review: {
      status: reviewRun.json?.status ?? (reviewRun.ok ? 'completed' : 'command_failed'),
      report: maybeRepoRelative(reviewRun.json?.files?.report),
    },
    bilingual: {
      status: 'not_run_before_import',
      reason:
        'Target import gates intentionally keep source-language rows only; multilingual completion runs after database import.',
    },
    remote_verification: {
      status:
        remoteRefreshRun.json?.status === 'completed'
          ? 'passed_remote_verification'
          : remoteRefreshRun.json?.status === 'completed_with_blockers'
            ? 'blocked_remote_verification'
            : remoteRefreshRun.ok
              ? 'completed'
              : 'command_failed',
      refresh_status: remoteRefreshRun.json?.status ?? (remoteRefreshRun.ok ? 'completed' : 'command_failed'),
      blocker_count: remoteRefreshRun.json?.counts?.post_refresh_blockers ?? null,
      pre_refresh_blockers: remoteRefreshRun.json?.counts?.pre_refresh_blockers ?? null,
      patched_references: remoteRefreshRun.json?.counts?.patched_references ?? null,
      refreshed_rows: maybeRepoRelative(remoteRefreshRun.json?.files?.output_rows),
      report: maybeRepoRelative(remoteRefreshRun.json?.files?.post_verification_report),
      refresh_report: maybeRepoRelative(remoteRefreshRun.json?.files?.report),
    },
    capabilities,
  };
}

function renderTargetDatasetGateMarkdown(report) {
  const rows = report.samples.map((sample) => ({
    sample: sample.sample_id,
    process: sample.process?.status ?? 'n/a',
    flow: sample.flow?.status ?? 'n/a',
    ready: sample.target_quality_ready,
    blockers: sample.readiness_blocker_count,
    gaps: sample.quality_gap_count,
  }));
  return `# Automated LCA Target Dataset Gate Run

Generated: ${report.generated_at_utc}

Task: ${report.task_id}

Source index: \`${report.source_index}\`

Snapshot: \`${report.snapshot_dir}\`

## Result

- Overall status: \`${report.status}\`
- Samples: ${report.sample_count}
- Command failures: ${report.command_failure_count}
- Readiness blockers: ${report.readiness_blocker_count}
- Quality gaps: ${report.quality_gap_count}

${buildMarkdownTable(rows, ['sample', 'process', 'flow', 'ready', 'blockers', 'gaps'])}

## Notes

- This run is local-only and does not write remote TianGong rows.
- Target-quality readiness requires process required-field completion, schema, review, and remote reference/version verification for source-language process and flow rows.
- Multilingual completion is intentionally deferred until after database import.
`;
}

function runAutomatedTargetDatasetsGateRun(options = {}) {
  const taskId = String(options.taskId || automatedTargetDatasetGateRunTaskId);
  const sourceIndex = resolveRepoPath(options.index || automatedTargetDatasetIndexPath);
  const snapshotDir = resolveRepoPath(options.snapshotDir || automatedTargetDatasetSnapshotDir);
  const workspace = resolveRepoPath(
    options.outDir || path.join('.foundry/workspaces', taskId, 'target-dataset-gate-run'),
  );
  const inputFreezeDir = path.join(workspace, 'input-freeze');
  const reportsDir = path.join(workspace, 'reports');
  const registry = readCapabilityRegistry();
  const selectedSamples = selectAutomatedTargetDatasets(options);
  const sampleInputs = selectedSamples.map((sample) => ({
    ...sample,
    process_rows_path: path.join(snapshotDir, sample.process_rows),
    flow_rows_path: path.join(snapshotDir, sample.flow_rows),
  }));

  writeJson(path.join(inputFreezeDir, 'target-datasets.json'), {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    source_index: repoRelativePath(sourceIndex),
    snapshot_dir: repoRelativePath(snapshotDir),
    account_context: accountContext(),
    samples: sampleInputs.map((sample) => ({
      sample_id: sample.sample_id,
      role: sample.role,
      process_rows: maybeRepoRelative(sample.process_rows_path),
      process_row_count: targetDatasetRowsCount(sample.process_rows_path),
      flow_rows: maybeRepoRelative(sample.flow_rows_path),
      flow_row_count: targetDatasetRowsCount(sample.flow_rows_path),
    })),
  });

  const results = sampleInputs.map((sample) => {
    const sampleDir = path.join(workspace, 'gates', sample.sample_id);
    const processResult = runTargetDatasetKindGates({
      registry,
      sample,
      kind: 'process',
      rowsFile: sample.process_rows_path,
      flowRowsFile: sample.flow_rows_path,
      sampleDir,
    });
    const flowResult = runTargetDatasetKindGates({
      registry,
      sample,
      kind: 'flow',
      rowsFile: sample.flow_rows_path,
      sampleDir,
    });
    const readinessBlockers = [
      ...ensureArray(processResult.readiness_blockers),
      ...ensureArray(flowResult.readiness_blockers),
    ];
    const qualityGaps = [
      ...ensureArray(processResult.quality_gaps),
      ...ensureArray(flowResult.quality_gaps),
    ];
    return {
      sample_id: sample.sample_id,
      role: sample.role,
      target_quality_ready: readinessBlockers.length === 0 && qualityGaps.length === 0,
      readiness_blocker_count: readinessBlockers.length,
      quality_gap_count: qualityGaps.length,
      readiness_blockers: readinessBlockers,
      quality_gaps: qualityGaps,
      process: processResult,
      flow: flowResult,
    };
  });

  const commandFailureCount = results.reduce(
    (total, sample) =>
      total + sample.process.command_failure_count + sample.flow.command_failure_count,
    0,
  );
  const readinessBlockerCount = results.reduce(
    (total, sample) => total + sample.readiness_blocker_count,
    0,
  );
  const qualityGapCount = results.reduce((total, sample) => total + sample.quality_gap_count, 0);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    status:
      commandFailureCount > 0
        ? 'completed_with_command_failures'
        : readinessBlockerCount > 0
          ? 'completed_with_readiness_blockers'
          : qualityGapCount > 0
            ? 'completed_with_quality_gaps'
            : 'target_quality_ready',
    workspace: repoRelativePath(workspace),
    source_index: repoRelativePath(sourceIndex),
    snapshot_dir: repoRelativePath(snapshotDir),
    capability_registry: automatedLcaCapabilityRegistryPath,
    cli_adapter: {
      bin_path: cliBinPath(),
      cwd: cliCwd(),
    },
    sample_count: results.length,
    command_failure_count: commandFailureCount,
    readiness_blocker_count: readinessBlockerCount,
    quality_gap_count: qualityGapCount,
    best_target_quality_dataset:
      results.find((sample) => sample.target_quality_ready)?.sample_id ?? null,
    samples: results,
  };
  report.files = {
    target_dataset_gate_report: repoRelativePath(path.join(workspace, 'target-dataset-gate-report.json')),
    gate_index: repoRelativePath(path.join(workspace, 'gate-index.json')),
    mutation_plan_handoff: repoRelativePath(path.join(workspace, 'mutation-plan-handoff.json')),
    verification_handoff: repoRelativePath(path.join(workspace, 'verification-handoff.json')),
    completeness_snapshot: repoRelativePath(path.join(workspace, 'completeness-snapshot.json')),
  };

  writeJson(path.join(workspace, 'capability-selection.json'), {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: taskId,
    registry: automatedLcaCapabilityRegistryPath,
    selected_capabilities: [
      'cli.process.complete-required-fields',
      'cli.process.dataset-validate',
      'cli.flow.dataset-validate',
      'cli.process.review',
      'cli.flow.review',
      'cli.process.remote-verify',
      'cli.flow.remote-verify',
      'cli.process.remote-refresh',
      'cli.flow.remote-refresh',
    ].map((id) => capabilityById(registry, id)),
  });
  writeJson(path.join(workspace, 'target-dataset-gate-report.json'), report);
  writeJson(path.join(workspace, 'completeness-snapshot.json'), {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: taskId,
    gates: {
      source_manifest_written: true,
      target_dataset_inputs_frozen: true,
      capability_selection_written: true,
      process_source_language_gates_ran_for_all_samples: results.every(
        (sample) => sample.process.status !== 'missing_input',
      ),
      flow_source_language_gates_ran_for_all_samples: results.every(
        (sample) => sample.flow.status !== 'missing_input',
      ),
      no_remote_writes_attempted: true,
      command_failures: commandFailureCount,
      readiness_blockers: readinessBlockerCount,
      quality_gaps: qualityGapCount,
      gate_index_written: true,
      mutation_plan_handoff_written: true,
      verification_handoff_written: true,
    },
  });
  writeGateIndex({
    workspace,
    registry,
    report,
    runKind: 'target-datasets-gate-run',
    gates: targetDatasetGateEntries(registry, report),
  });
  writeMutationPlanHandoff({
    workspace,
    report,
    runKind: 'target-datasets-gate-run',
    entries: targetDatasetMutationEntries(report),
  });
  writeVerificationHandoff({
    workspace,
    report,
    runKind: 'target-datasets-gate-run',
    entries: targetDatasetVerificationEntries(report),
  });
  writeText(path.join(reportsDir, 'target-dataset-gate-run.md'), renderTargetDatasetGateMarkdown(report));
  return report;
}

function runSampleScenariosDryRun(options = {}) {
  const taskId = String(options.taskId || sampleScenarioDryRunTaskId);
  const samplePath = resolveRepoPath(options.samples || sampleScenarioIndexPath);
  const workspace = resolveRepoPath(
    options.outDir || path.join('.foundry/workspaces', taskId, 'sample-scenario-dry-run'),
  );
  const inputFreezeDir = path.join(workspace, 'input-freeze');
  const reportsDir = path.join(workspace, 'reports');
  const registry = readCapabilityRegistry();
  const samples = parseSampleScenarioRows(samplePath);
  const sourceManifest = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    source_sample_index: repoRelativePath(samplePath),
    privacy: 'sanitized sample rows only; full private payload exports remain under ignored .foundry workspaces',
    sample_count: samples.length,
    capability_registry: automatedLcaCapabilityRegistryPath,
  };
  writeJson(path.join(inputFreezeDir, 'source-manifest.json'), sourceManifest);
  writeJson(path.join(inputFreezeDir, 'sample-scenarios.json'), samples);

  const results = [];
  for (const sample of samples) {
    const sampleDir = path.join(workspace, 'dry-run', sample.sample_id);
    const inputDir = path.join(sampleDir, 'inputs');
    const commandDir = path.join(sampleDir, 'commands');
    const identityOutDir = path.join(sampleDir, 'identity-preflight');
    const buildPlanValidateOutDir = path.join(sampleDir, 'build-plan-validate');
    const buildPlanMaterializeOutDir = path.join(sampleDir, 'build-plan-materialize');
    const identityInputPath = path.join(inputDir, 'identity-preflight-input.json');
    const identityInput = sampleIdentityPreflightInput(sample);
    writeJson(identityInputPath, identityInput);
    const identityRun = runTiangongJson(
      [
        sample.kind,
        'identity-preflight',
        '--input',
        identityInputPath,
        '--out-dir',
        identityOutDir,
        '--json',
      ],
      { allowJsonOnFailure: true },
    );
    const identityCapture = writeCommandCapture(commandDir, 'identity-preflight', identityRun);
    const identityReport = identityRun.json ?? {};

    const buildPlanInputPath = path.join(inputDir, 'build-plan.json');
    const buildPlan = sampleBuildPlan(sample, identityReport.decision ?? 'manual_review');
    writeJson(buildPlanInputPath, buildPlan);
    const buildPlanValidateRun = runTiangongJson(
      [
        sample.kind,
        'build-plan',
        'validate',
        '--input',
        buildPlanInputPath,
        '--out-dir',
        buildPlanValidateOutDir,
        '--report-only',
        '--json',
      ],
      { allowJsonOnFailure: true },
    );
    const buildValidateCapture = writeCommandCapture(
      commandDir,
      'build-plan-validate',
      buildPlanValidateRun,
    );
    const buildValidateReport = buildPlanValidateRun.json ?? {};

    const buildPlanMaterializeRun = runTiangongJson(
      [
        sample.kind,
        'build-plan',
        'materialize',
        '--input',
        buildPlanInputPath,
        '--out-dir',
        buildPlanMaterializeOutDir,
        '--report-only',
        '--json',
      ],
      { allowJsonOnFailure: true },
    );
    const buildMaterializeCapture = writeCommandCapture(
      commandDir,
      'build-plan-materialize',
      buildPlanMaterializeRun,
    );
    const buildMaterializeReport = buildPlanMaterializeRun.json ?? {};
    const providerClosure = providerClosureGate(sample);
    const blockers = [
      ...ensureArray(identityReport.blockers),
      ...ensureArray(buildValidateReport.blockers),
      ...ensureArray(buildMaterializeReport.blockers),
      ...providerClosureBlockers(providerClosure),
    ];
    results.push({
      sample_id: sample.sample_id,
      kind: sample.kind,
      dataset: sample.dataset,
      scenario: sample.scenario,
      expectation: sample.future_test_expectation,
      identity: {
        status: identityReport.status ?? 'command_failed',
        decision: identityReport.decision ?? null,
        next_action: identityReport.next_action ?? null,
      },
      build_plan_validate: {
        status: buildValidateReport.status ?? 'command_failed',
        next_action: buildValidateReport.next_action ?? null,
      },
      build_plan_materialize: {
        status: buildMaterializeReport.status ?? 'command_failed',
        next_action: buildMaterializeReport.next_action ?? null,
      },
      provider_closure: providerClosure,
      blocker_count: blockers.length,
      blockers,
      capabilities: [
        capabilityRunRecord(
          registry,
          `cli.${sample.kind}.identity-preflight`,
          identityRun,
          {
            input: repoRelativePath(identityInputPath),
            out_dir: repoRelativePath(identityOutDir),
            identity_decision: repoRelativePath(
              path.join(identityOutDir, 'outputs/identity-decision.json'),
            ),
            candidates: repoRelativePath(path.join(identityOutDir, 'outputs/identity-candidates.jsonl')),
            ...identityCapture,
          },
        ),
        capabilityRunRecord(
          registry,
          `cli.${sample.kind}.build-plan.validate`,
          buildPlanValidateRun,
          {
            input: repoRelativePath(buildPlanInputPath),
            out_dir: repoRelativePath(buildPlanValidateOutDir),
            gate_report: repoRelativePath(
              path.join(buildPlanValidateOutDir, 'outputs/build-plan-gate-report.json'),
            ),
            ...buildValidateCapture,
          },
        ),
        capabilityRunRecord(
          registry,
          `cli.${sample.kind}.build-plan.materialize`,
          buildPlanMaterializeRun,
          {
            input: repoRelativePath(buildPlanInputPath),
            out_dir: repoRelativePath(buildPlanMaterializeOutDir),
            gate_report: repoRelativePath(
              path.join(buildPlanMaterializeOutDir, 'outputs/build-plan-gate-report.json'),
            ),
            materialized_artifact: repoRelativePath(
              path.join(
                buildPlanMaterializeOutDir,
                `outputs/materialized-${sample.kind}.json`,
              ),
            ),
            ...buildMaterializeCapture,
          },
        ),
      ],
    });
  }

  const commandFailures = results.flatMap((sample) =>
    sample.capabilities.filter((capability) => !capability.command.ok),
  );
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: commandFailures.length === 0 ? 'completed' : 'completed_with_command_failures',
    workspace: repoRelativePath(workspace),
    source_sample_index: repoRelativePath(samplePath),
    capability_registry: automatedLcaCapabilityRegistryPath,
    cli_adapter: {
      bin_path: cliBinPath(),
      cwd: cliCwd(),
    },
    sample_count: results.length,
    command_failure_count: commandFailures.length,
    samples: results,
  };
  report.files = {
    dry_run_report: repoRelativePath(path.join(workspace, 'dry-run-report.json')),
    gate_index: repoRelativePath(path.join(workspace, 'gate-index.json')),
    mutation_plan_handoff: repoRelativePath(path.join(workspace, 'mutation-plan-handoff.json')),
    verification_handoff: repoRelativePath(path.join(workspace, 'verification-handoff.json')),
    completeness_snapshot: repoRelativePath(path.join(workspace, 'completeness-snapshot.json')),
  };
  writeJson(path.join(workspace, 'capability-selection.json'), {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: taskId,
    registry: automatedLcaCapabilityRegistryPath,
    selected_capabilities: [
      'cli.process.identity-preflight',
      'cli.flow.identity-preflight',
      'cli.process.build-plan.validate',
      'cli.flow.build-plan.validate',
      'cli.process.build-plan.materialize',
      'cli.flow.build-plan.materialize',
      'foundry.reference-closure.provider-flow-eligibility',
    ].map((id) => capabilityById(registry, id)),
  });
  writeJson(path.join(workspace, 'dry-run-report.json'), report);
  writeJson(path.join(workspace, 'completeness-snapshot.json'), {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: taskId,
    gates: {
      source_manifest_written: true,
      sample_inputs_frozen: true,
      capability_selection_written: true,
      identity_preflight_ran_for_all_samples: results.every((sample) =>
        sample.capabilities.some((capability) => capability.capability_id.endsWith('identity-preflight')),
      ),
      build_plan_validate_ran_for_all_samples: results.every((sample) =>
        sample.capabilities.some((capability) => capability.capability_id.endsWith('build-plan.validate')),
      ),
      build_plan_materialize_ran_for_all_samples: results.every((sample) =>
        sample.capabilities.some((capability) => capability.capability_id.endsWith('build-plan.materialize')),
      ),
      no_remote_writes_attempted: true,
      command_failures: commandFailures.length,
      gate_index_written: true,
      mutation_plan_handoff_written: true,
      verification_handoff_written: true,
    },
  });
  writeGateIndex({
    workspace,
    registry,
    report,
    runKind: 'sample-scenarios-dry-run',
    gates: sampleScenarioGateEntries(registry, report),
  });
  writeMutationPlanHandoff({
    workspace,
    report,
    runKind: 'sample-scenarios-dry-run',
    entries: sampleScenarioMutationEntries(report),
  });
  writeVerificationHandoff({
    workspace,
    report,
    runKind: 'sample-scenarios-dry-run',
    entries: sampleScenarioVerificationEntries(report),
  });
  writeText(path.join(reportsDir, 'sample-scenario-dry-run.md'), renderSampleDryRunMarkdown(report));
  return report;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function asText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean).join(' / ').trim();
  }
  if (typeof value === 'object') {
    const preferred = value['#text'] ?? value.value ?? value.shortDescription ?? value.name;
    if (preferred !== undefined && preferred !== null) return asText(preferred);
    return Object.values(value).map((item) => asText(item)).filter(Boolean).join(' / ').trim();
  }
  return String(value).trim();
}

function processDataset(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload.processDataSet && typeof payload.processDataSet === 'object'
      ? payload.processDataSet
      : payload;
  }
  return {};
}

function processNameFromPayload(payload) {
  const dataset = processDataset(payload);
  const info = dataset.processInformation?.dataSetInformation ?? {};
  const baseName = info.name?.baseName;
  if (Array.isArray(baseName)) {
    return baseName.find((item) => item?.['@xml:lang'] === 'zh')?.['#text']
      ?? baseName.find((item) => item?.['@xml:lang'] === 'en')?.['#text']
      ?? baseName[0]?.['#text']
      ?? '';
  }
  return asText(baseName?.['#text'] ?? baseName ?? info['common:name'] ?? info.name);
}

function exchangeRecordsFromPayload(payload) {
  const dataset = processDataset(payload);
  const exchanges = dataset.exchanges?.exchange;
  return ensureArray(exchanges).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function getQuantitativeReferenceId(payload) {
  const dataset = processDataset(payload);
  return asText(dataset.processInformation?.quantitativeReference?.referenceToReferenceFlow);
}

function amountValue(exchange) {
  const value = exchange.meanAmount ?? exchange.resultingAmount ?? exchange.amount;
  if (value === undefined || value === null || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function flowRefFromExchange(exchange) {
  const ref = exchange.referenceToFlowDataSet && typeof exchange.referenceToFlowDataSet === 'object'
    ? exchange.referenceToFlowDataSet
    : {};
  return {
    flow_id: asText(ref['@refObjectId'] ?? ref.refObjectId ?? ref.id),
    flow_version: asText(ref['@version'] ?? ref.version),
    flow_uri: asText(ref['@uri'] ?? ref.uri),
    flow_short_description: asText(ref['common:shortDescription'] ?? ref.shortDescription),
  };
}

function flowDataset(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload.flowDataSet && typeof payload.flowDataSet === 'object'
      ? payload.flowDataSet
      : payload;
  }
  return {};
}

function flowPayload(row) {
  return row?.flow ?? row?.json ?? row?.json_ordered ?? row;
}

function flowTypeOfDataset(row) {
  const dataset = flowDataset(flowPayload(row));
  return asText(
    dataset.modellingAndValidation?.LCIMethod?.typeOfDataSet
      ?? dataset.modellingAndValidation?.LCIMethodAndAllocation?.typeOfDataSet
      ?? row?.typeOfDataSet
      ?? row?.type_of_dataset,
  );
}

function flowNameFromRow(row) {
  const dataset = flowDataset(flowPayload(row));
  const info = dataset.flowInformation?.dataSetInformation ?? {};
  return asText(info.name?.baseName ?? info.name ?? info['common:name'] ?? row?.name);
}

function isElementaryFlowType(typeOfDataset) {
  return asText(typeOfDataset).toLowerCase() === 'elementary flow';
}

function makeFlowMetadata(flowRows) {
  const byExact = new Map();
  const byId = new Map();
  const rows = [];
  for (const row of flowRows) {
    if (!row?.id) continue;
    const metadata = {
      id: row.id,
      version: row.version ?? null,
      user_id: row.user_id ?? null,
      state_code: row.state_code ?? null,
      modified_at: row.modified_at ?? null,
      type_of_dataset: flowTypeOfDataset(row) || null,
      is_elementary_flow: isElementaryFlowType(flowTypeOfDataset(row)),
      name: flowNameFromRow(row) || null,
    };
    rows.push(metadata);
    byExact.set(`${metadata.id}@${metadata.version ?? ''}`, metadata);
    if (!byId.has(metadata.id)) byId.set(metadata.id, []);
    byId.get(metadata.id).push(metadata);
  }
  return { rows, byExact, byId };
}

function lookupFlowMetadata(flowRef, metadata) {
  if (!flowRef?.flow_id || !metadata) {
    return { metadata: null, status: flowRef?.flow_id ? 'metadata_not_loaded' : 'missing_flow_id' };
  }
  const exact = metadata.byExact.get(`${flowRef.flow_id}@${flowRef.flow_version ?? ''}`);
  if (exact) return { metadata: exact, status: 'exact' };
  const byId = metadata.byId.get(flowRef.flow_id) ?? [];
  if (byId.length === 1) return { metadata: byId[0], status: 'id_only_single_version' };
  if (byId.length > 1) return { metadata: byId[0], status: 'id_only_multiple_versions' };
  return { metadata: null, status: 'missing_flow_metadata' };
}

function uniqueExchangeFlowIds(graph) {
  return [...new Set(graph.exchanges.map((exchange) => exchange.flow_id).filter(Boolean))].sort();
}

function buildFlowMetadataResult({
  flowIds,
  rows,
  commands,
  failures,
  status,
  errorClass = null,
  progressPath = null,
  checkpointPath = null,
  summaryPath = null,
  batchSize = null,
  batchTimeoutMs = null,
  totalBatchCount = null,
  completedBatchCount = null,
  fromCache = false,
  limited = false,
}) {
  const metadata = makeFlowMetadata(rows);
  const matchedFlowIds = new Set(rows.map((row) => row.id).filter(Boolean));
  const missingFlowIds = flowIds.filter((id) => !matchedFlowIds.has(id));
  return {
    generated_at_utc: nowIso(),
    status,
    error_class: errorClass ?? (failures.length > 0 ? failures[0].error_class : null),
    from_cache: fromCache,
    limited,
    distinct_exchange_flow_ids: flowIds.length,
    requested_flow_ids_hash: hashStrings(flowIds),
    fetched_flow_rows: rows.length,
    matched_distinct_flow_ids: matchedFlowIds.size,
    missing_distinct_flow_ids: missingFlowIds.length,
    missing_flow_ids: missingFlowIds,
    batch_size: batchSize,
    batch_timeout_ms: batchTimeoutMs,
    total_batch_count: totalBatchCount,
    completed_batch_count: completedBatchCount ?? totalBatchCount,
    command_count: commands.length,
    progress_path: progressPath,
    checkpoint_path: checkpointPath,
    summary_path: summaryPath,
    commands,
    failures,
    rows,
    metadata,
  };
}

function readFlowMetadataCache(cachePath, flowIds) {
  if (!cachePath || !fileExists(cachePath)) return null;
  try {
    const cached = readJson(cachePath);
    if (cached.status !== 'completed' || !Array.isArray(cached.rows)) return null;
    const requestedHash = hashStrings(flowIds);
    if (cached.requested_flow_ids_hash && cached.requested_flow_ids_hash !== requestedHash) return null;

    const cachedFlowIds = new Set(cached.rows.map((row) => row.id).filter(Boolean));
    for (const id of cached.missing_flow_ids ?? []) cachedFlowIds.add(id);
    if (cachedFlowIds.size !== flowIds.length) return null;
    if (flowIds.some((id) => !cachedFlowIds.has(id))) return null;

    return cached;
  } catch {
    return null;
  }
}

function writeFlowMetadataProgressSummary(summaryPath, summary) {
  if (!summaryPath) return;
  writeJson(summaryPath, {
    generated_at_utc: nowIso(),
    ...summary,
  });
}

function fetchFlowMetadataForGraph(graph, options = {}) {
  const flowIds = uniqueExchangeFlowIds(graph);
  const batchSize = Math.floor(numberOption(
    options.batchSize ?? envValue('FOUNDRY_FLOW_METADATA_BATCH_SIZE'),
    80,
    { min: 1, max: 500 },
  ));
  const batchTimeoutMs = Math.floor(numberOption(
    options.batchTimeoutMs ?? envValue('FOUNDRY_FLOW_METADATA_BATCH_TIMEOUT_MS'),
    120000,
    { min: 10000, max: 600000 },
  ));
  const maxBatchesRaw = options.maxBatches ?? envValue('FOUNDRY_FLOW_METADATA_MAX_BATCHES');
  const maxBatches = maxBatchesRaw === undefined || maxBatchesRaw === null || maxBatchesRaw === ''
    ? null
    : Math.floor(numberOption(maxBatchesRaw, 0, { min: 0 }));
  const stopOnFailure = boolOption(
    options.stopOnFailure ?? envValue('FOUNDRY_FLOW_METADATA_STOP_ON_FAILURE'),
    true,
  );
  const totalBatchCount = Math.ceil(flowIds.length / batchSize);
  const outputDir = options.outputDir ?? null;
  const progressPath = options.progressPath ?? (outputDir ? path.join(outputDir, 'progress.jsonl') : null);
  const checkpointPath = options.checkpointPath ?? (outputDir ? path.join(outputDir, 'checkpoint.json') : null);
  const summaryPath = options.summaryPath ?? (outputDir ? path.join(outputDir, 'summary.json') : null);
  const rowsPath = options.rowsPath ?? (outputDir ? path.join(outputDir, 'rows.json') : null);
  const cachePath = options.cachePath ?? null;
  const requestedFlowIdsHash = hashStrings(flowIds);
  const rowsByKey = new Map();
  const commands = [];
  const failures = [];
  const completedBatchIndexes = new Set();

  const cached = readFlowMetadataCache(cachePath, flowIds);
  if (cached) {
    const result = buildFlowMetadataResult({
      flowIds,
      rows: cached.rows,
      commands: [],
      failures: [],
      status: 'completed',
      progressPath,
      checkpointPath,
      summaryPath,
      batchSize,
      batchTimeoutMs,
      totalBatchCount,
      completedBatchCount: totalBatchCount,
      fromCache: true,
    });
    if (progressPath) appendJsonLine(progressPath, {
      at_utc: nowIso(),
      event: 'cache_hit',
      cache_path: cachePath,
      distinct_exchange_flow_ids: flowIds.length,
      fetched_flow_rows: result.fetched_flow_rows,
    });
    if (checkpointPath) writeJson(checkpointPath, {
      generated_at_utc: nowIso(),
      status: 'completed',
      from_cache: true,
      cache_path: cachePath,
      rows_cache_path: cachePath,
      requested_flow_ids_hash: requestedFlowIdsHash,
      distinct_exchange_flow_ids: flowIds.length,
      batch_size: batchSize,
      batch_timeout_ms: batchTimeoutMs,
      total_batch_count: totalBatchCount,
      completed_batch_indexes: Array.from({ length: totalBatchCount }, (_, index) => index),
      failed_batch_count: 0,
      commands: [],
      failures: [],
    });
    writeFlowMetadataProgressSummary(summaryPath, {
      status: 'completed',
      phase: 'flow_metadata_fetch',
      from_cache: true,
      cache_path: cachePath,
      distinct_exchange_flow_ids: flowIds.length,
      total_batch_count: totalBatchCount,
      completed_batch_count: totalBatchCount,
      failed_batch_count: 0,
      batch_size: batchSize,
      batch_timeout_ms: batchTimeoutMs,
      requested_flow_ids_hash: requestedFlowIdsHash,
    });
    return result;
  }

  if (checkpointPath && fileExists(checkpointPath)) {
    try {
      const checkpoint = readJson(checkpointPath);
      if (checkpoint.requested_flow_ids_hash === requestedFlowIdsHash) {
        const rowsCachePath = checkpoint.rows_cache_path ?? rowsPath ?? cachePath;
        if (rowsCachePath && fileExists(rowsCachePath)) {
          const rowsCache = readJson(rowsCachePath);
          for (const row of rowsCache.rows ?? []) rowsByKey.set(`${row.id}@${row.version ?? ''}`, row);
        }
        for (const command of checkpoint.commands ?? []) commands.push(command);
        for (const failure of checkpoint.failures ?? []) failures.push(failure);
        for (const index of checkpoint.completed_batch_indexes ?? []) completedBatchIndexes.add(index);
        if (progressPath) appendJsonLine(progressPath, {
          at_utc: nowIso(),
          event: 'resume_checkpoint',
          checkpoint_path: checkpointPath,
          completed_batch_count: completedBatchIndexes.size,
          fetched_flow_rows: rowsByKey.size,
        });
      }
    } catch (error) {
      if (progressPath) appendJsonLine(progressPath, {
        at_utc: nowIso(),
        event: 'checkpoint_read_failed',
        checkpoint_path: checkpointPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let processedThisRun = 0;
  let limited = false;
  for (let batchIndex = 0; batchIndex < totalBatchCount; batchIndex += 1) {
    if (completedBatchIndexes.has(batchIndex)) continue;
    if (maxBatches !== null && processedThisRun >= maxBatches) {
      limited = true;
      break;
    }

    const index = batchIndex * batchSize;
    const batch = flowIds.slice(index, index + batchSize);
    const args = [
      'flow',
      'list',
      ...batch.flatMap((id) => ['--id', id]),
      '--all',
      '--page-size',
      '1000',
      '--json',
    ];
    const startEvent = {
      at_utc: nowIso(),
      event: 'batch_start',
      batch_index: batchIndex,
      batch_start: index,
      batch_size: batch.length,
      total_batch_count: totalBatchCount,
      batch_timeout_ms: batchTimeoutMs,
    };
    if (progressPath) appendJsonLine(progressPath, startEvent);
    writeFlowMetadataProgressSummary(summaryPath, {
      status: 'running',
      phase: 'flow_metadata_fetch',
      current_batch_index: batchIndex,
      current_batch_start: index,
      current_batch_size: batch.length,
      total_batch_count: totalBatchCount,
      completed_batch_count: completedBatchIndexes.size,
      failed_batch_count: failures.length,
      fetched_flow_rows: rowsByKey.size,
      batch_size: batchSize,
      batch_timeout_ms: batchTimeoutMs,
      requested_flow_ids_hash: requestedFlowIdsHash,
      progress_path: progressPath,
      checkpoint_path: checkpointPath,
    });

    const run = runTiangongJson(args, { timeoutMs: batchTimeoutMs });
    const record = {
      ...commandRecord(run),
      batch_index: batchIndex,
      batch_start: index,
      batch_size: batch.length,
    };
    commands.push(record);
    if (!run.ok) {
      const failure = {
        batch_index: batchIndex,
        batch_start: index,
        batch_size: batch.length,
        error_class: run.error_class,
        error: run.error,
        timed_out: Boolean(run.timed_out),
        duration_ms: run.duration_ms ?? null,
      };
      failures.push(failure);
      if (progressPath) appendJsonLine(progressPath, {
        at_utc: nowIso(),
        event: 'batch_failed',
        ...failure,
      });
      if (checkpointPath) writeJson(checkpointPath, {
        generated_at_utc: nowIso(),
        status: 'partial',
        requested_flow_ids_hash: requestedFlowIdsHash,
        distinct_exchange_flow_ids: flowIds.length,
        batch_size: batchSize,
        batch_timeout_ms: batchTimeoutMs,
        total_batch_count: totalBatchCount,
        completed_batch_indexes: [...completedBatchIndexes].sort((a, b) => a - b),
        failed_batch_count: failures.length,
        commands,
        failures,
        rows_cache_path: rowsPath,
      });
      if (rowsPath) writeJson(rowsPath, {
        generated_at_utc: nowIso(),
        requested_flow_ids_hash: requestedFlowIdsHash,
        rows: [...rowsByKey.values()],
      });
      if (stopOnFailure) break;
      processedThisRun += 1;
      continue;
    }
    for (const row of run.json?.rows ?? []) {
      rowsByKey.set(`${row.id}@${row.version ?? ''}`, row);
    }
    completedBatchIndexes.add(batchIndex);
    processedThisRun += 1;
    if (progressPath) appendJsonLine(progressPath, {
      at_utc: nowIso(),
      event: 'batch_completed',
      batch_index: batchIndex,
      batch_start: index,
      batch_size: batch.length,
      row_count: Array.isArray(run.json?.rows) ? run.json.rows.length : 0,
      duration_ms: run.duration_ms ?? null,
      completed_batch_count: completedBatchIndexes.size,
      total_batch_count: totalBatchCount,
    });
    if (checkpointPath) writeJson(checkpointPath, {
      generated_at_utc: nowIso(),
      status: completedBatchIndexes.size === totalBatchCount ? 'completed' : 'running',
      requested_flow_ids_hash: requestedFlowIdsHash,
      distinct_exchange_flow_ids: flowIds.length,
      batch_size: batchSize,
      batch_timeout_ms: batchTimeoutMs,
      total_batch_count: totalBatchCount,
      completed_batch_indexes: [...completedBatchIndexes].sort((a, b) => a - b),
      failed_batch_count: failures.length,
      commands,
      failures,
      rows_cache_path: rowsPath,
    });
    if (rowsPath) writeJson(rowsPath, {
      generated_at_utc: nowIso(),
      requested_flow_ids_hash: requestedFlowIdsHash,
      rows: [...rowsByKey.values()],
    });
  }
  const rows = [...rowsByKey.values()];
  const status = failures.length > 0
    ? 'partial'
    : (completedBatchIndexes.size === totalBatchCount ? 'completed' : 'partial_limited');
  const result = buildFlowMetadataResult({
    flowIds,
    rows,
    commands,
    failures,
    status,
    progressPath,
    checkpointPath,
    summaryPath,
    batchSize,
    batchTimeoutMs,
    totalBatchCount,
    completedBatchCount: completedBatchIndexes.size,
    limited,
  });
  if (checkpointPath) writeJson(checkpointPath, {
    generated_at_utc: nowIso(),
    status: result.status,
    requested_flow_ids_hash: requestedFlowIdsHash,
    distinct_exchange_flow_ids: flowIds.length,
    batch_size: batchSize,
    batch_timeout_ms: batchTimeoutMs,
    total_batch_count: totalBatchCount,
    completed_batch_indexes: [...completedBatchIndexes].sort((a, b) => a - b),
    failed_batch_count: failures.length,
    commands,
    failures,
    rows_cache_path: rowsPath,
  });
  if (rowsPath) writeJson(rowsPath, {
    generated_at_utc: nowIso(),
    requested_flow_ids_hash: requestedFlowIdsHash,
    rows,
  });
  writeFlowMetadataProgressSummary(summaryPath, {
    status: result.status,
    phase: 'flow_metadata_fetch',
    distinct_exchange_flow_ids: flowIds.length,
    fetched_flow_rows: result.fetched_flow_rows,
    matched_distinct_flow_ids: result.matched_distinct_flow_ids,
    missing_distinct_flow_ids: result.missing_distinct_flow_ids,
    total_batch_count: totalBatchCount,
    completed_batch_count: completedBatchIndexes.size,
    failed_batch_count: failures.length,
    batch_size: batchSize,
    batch_timeout_ms: batchTimeoutMs,
    requested_flow_ids_hash: requestedFlowIdsHash,
    error_class: result.error_class,
    progress_path: progressPath,
    checkpoint_path: checkpointPath,
  });
  return result;
}

function patchProcessPayloadQuantitativeReference(payload, internalId) {
  const cloned = deepClone(payload);
  const dataset = processDataset(cloned);
  if (!dataset.processInformation || typeof dataset.processInformation !== 'object') {
    return null;
  }
  if (!dataset.processInformation.quantitativeReference || typeof dataset.processInformation.quantitativeReference !== 'object') {
    dataset.processInformation.quantitativeReference = {};
  }
  dataset.processInformation.quantitativeReference.referenceToReferenceFlow = internalId;
  return cloned;
}

function makeProcessGraph(processRows, flowMetadata = null) {
  const processes = [];
  const exchanges = [];
  const processByKey = new Map();
  const providerByExactFlow = new Map();
  const providerByFlow = new Map();
  for (const row of processRows) {
    const payload = row.process ?? row.json ?? row.json_ordered ?? row;
    const processKey = `${row.id}@${row.version}`;
    const exchangeRows = exchangeRecordsFromPayload(payload);
    const qref = getQuantitativeReferenceId(payload);
    const referenceExchange = exchangeRows.find((exchange) => asText(exchange['@dataSetInternalID']) === qref) ?? null;
    const referenceFlow = referenceExchange ? flowRefFromExchange(referenceExchange) : null;
    const referenceFlowLookup = lookupFlowMetadata(referenceFlow, flowMetadata);
    const processRecord = {
      key: processKey,
      id: row.id,
      version: row.version,
      user_id: row.user_id ?? null,
      state_code: row.state_code ?? null,
      modified_at: row.modified_at ?? null,
      source_scope: row.source_scope ?? null,
      name: processNameFromPayload(payload),
      exchange_count: exchangeRows.length,
      quantitative_reference_internal_id: qref || null,
      reference_exchange_found: Boolean(referenceExchange),
      reference_flow: referenceFlow
        ? {
          ...referenceFlow,
          flow_type_of_dataset: referenceFlowLookup.metadata?.type_of_dataset ?? null,
          is_elementary_flow: Boolean(referenceFlowLookup.metadata?.is_elementary_flow),
          flow_metadata_status: referenceFlowLookup.status,
        }
        : null,
      payload,
    };
    processes.push(processRecord);
    processByKey.set(processKey, processRecord);
    if (referenceFlow?.flow_id) {
      const exactKey = `${referenceFlow.flow_id}@${referenceFlow.flow_version}`;
      if (!providerByExactFlow.has(exactKey)) providerByExactFlow.set(exactKey, []);
      providerByExactFlow.get(exactKey).push(processRecord);
      if (!providerByFlow.has(referenceFlow.flow_id)) providerByFlow.set(referenceFlow.flow_id, []);
      providerByFlow.get(referenceFlow.flow_id).push(processRecord);
    }
    for (const exchange of exchangeRows) {
      const flowRef = flowRefFromExchange(exchange);
      const flowLookup = lookupFlowMetadata(flowRef, flowMetadata);
      exchanges.push({
        process_key: processKey,
        process_id: row.id,
        process_version: row.version,
        process_state_code: row.state_code ?? null,
        process_name: processRecord.name,
        exchange_internal_id: asText(exchange['@dataSetInternalID']) || null,
        direction: asText(exchange.exchangeDirection),
        amount: amountValue(exchange),
        flow_id: flowRef.flow_id || null,
        flow_version: flowRef.flow_version || null,
        flow_short_description: flowRef.flow_short_description || null,
        flow_type_of_dataset: flowLookup.metadata?.type_of_dataset ?? null,
        is_elementary_flow: Boolean(flowLookup.metadata?.is_elementary_flow),
        flow_metadata_status: flowLookup.status,
        is_process_quantitative_reference: Boolean(qref && asText(exchange['@dataSetInternalID']) === qref),
      });
    }
  }
  return { processes, exchanges, providerByExactFlow, providerByFlow, processByKey };
}

function summarizeClosure(graph) {
  const rows = [];
  for (const exchange of graph.exchanges) {
    let status = 'missing_flow';
    let providers = [];
    if (exchange.flow_id) {
      if (exchange.is_elementary_flow) {
        status = 'excluded_elementary_flow';
      } else {
        const exactKey = `${exchange.flow_id}@${exchange.flow_version ?? ''}`;
        const exact = graph.providerByExactFlow.get(exactKey) ?? [];
        const any = graph.providerByFlow.get(exchange.flow_id) ?? [];
        if (exact.length > 0) {
          status = 'closed_by_existing_process';
          providers = exact;
        } else if (any.length > 0) {
          status = 'ambiguous_flow_match';
          providers = any;
        } else if (exchange.flow_metadata_status === 'missing_flow_metadata' || exchange.flow_metadata_status === 'metadata_not_loaded') {
          status = 'flow_metadata_missing';
        } else {
          status = 'missing_reference_process';
        }
      }
    }
    rows.push({
      ...exchange,
      closure_status: status,
      provider_count: providers.length,
      providers: providers.slice(0, 10).map((provider) => ({
        process_id: provider.id,
        version: provider.version,
        state_code: provider.state_code,
        name: provider.name,
        reference_flow_version: provider.reference_flow?.flow_version ?? null,
      })),
    });
  }
  const statusCounts = Object.fromEntries(countBy(rows, (row) => row.closure_status).map((item) => [item.key, item.count]));
  const closedStatuses = ['closed', 'closed_by_existing_process', 'closed_by_proxy'];
  const excludedStatuses = ['excluded_by_cutoff', 'excluded_by_boundary', 'excluded_elementary_flow'];
  const closed = rows.filter((row) => closedStatuses.includes(row.closure_status)).length;
  const excluded = rows.filter((row) => excludedStatuses.includes(row.closure_status)).length;
  const targetRows = rows.filter((row) => !excludedStatuses.includes(row.closure_status));
  const failed = targetRows.length - rows.filter((row) => closedStatuses.includes(row.closure_status)).length;
  return {
    generated_at_utc: nowIso(),
    status: rows.length > 0 ? 'completed' : 'blocked',
    total_exchanges: rows.length,
    reference_closure_target_exchanges: targetRows.length,
    closed_count: closed,
    excluded_count: excluded,
    elementary_flow_excluded_count: statusCounts.excluded_elementary_flow ?? 0,
    passed_count: closed + excluded,
    failed_count: failed,
    status_counts: statusCounts,
    rows,
  };
}

function buildRepairCandidatesFromDiagnostics({ diagnostics, graph }) {
  const processById = new Map(graph.processes.map((processRecord) => [processRecord.id, processRecord]));
  const exchangesByProcess = new Map();
  for (const exchange of graph.exchanges) {
    if (!exchangesByProcess.has(exchange.process_id)) exchangesByProcess.set(exchange.process_id, []);
    exchangesByProcess.get(exchange.process_id).push(exchange);
  }
  const candidates = [];
  const patchedPayloads = [];
  const missingRows = diagnostics?.known_findings?.missing_reference?.rows ?? [];
  const serviceRows = diagnostics?.known_findings?.service_loop?.rows ?? [];
  const duplicateGroups = diagnostics?.known_findings?.duplicate_exchange_structure?.groups ?? [];

  for (const row of missingRows) {
    const processRecord = processById.get(row.process_id);
    const processExchanges = exchangesByProcess.get(row.process_id) ?? [];
	    const outputExchanges = processExchanges.filter((exchange) => exchange.direction.toLowerCase() === 'output' && exchange.exchange_internal_id);
	    const eligibleOutput = outputExchanges.length === 1 ? outputExchanges[0] : null;
	    const outputOptions = outputExchanges.map((exchange) => ({
	      exchange_internal_id: exchange.exchange_internal_id,
	      flow_id: exchange.flow_id,
	      flow_version: exchange.flow_version,
	      flow_short_description: exchange.flow_short_description,
	      amount: exchange.amount,
	    }));
	    const oldValue = processRecord?.quantitative_reference_internal_id ?? null;
	    const proposedValue = eligibleOutput?.exchange_internal_id ?? null;
    const evidenceStatus = proposedValue
      ? 'structural_inferred_from_single_output_exchange'
      : 'unresolved_requires_process_payload_review';
    const writeEligibility = row.state_code === 0 && proposedValue ? 'dry_run_eligible' : 'manual_review_required';
    const candidate = {
      candidate_id: `MR-${String(row.index).padStart(3, '0')}-${row.process_id}`,
      source_diagnostic_id: `missing_reference:${row.index}`,
      affected_process_id: row.process_id,
      affected_process_version: row.version,
      affected_exchange_id: proposedValue,
      affected_flow_id: eligibleOutput?.flow_id ?? null,
      problem_type: 'missing_reference',
      proposed_action: proposedValue
        ? 'set quantitativeReference.referenceToReferenceFlow to the only output exchange internal id'
        : 'manual review: identify or restore the valid reference exchange before write',
      old_value: oldValue,
      proposed_value: proposedValue,
      state_code: row.state_code,
      evidence_status: evidenceStatus,
      closure_impact: proposedValue
        ? 'restores process reference-flow identity for provider matching after schema validation'
        : 'unknown until reference exchange is identified',
	      risk: proposedValue ? 'medium' : 'high',
	      write_eligibility: writeEligibility,
	      output_exchange_count: outputExchanges.length,
	      candidate_output_exchanges: proposedValue ? [] : outputOptions,
	      unresolved_reason: proposedValue ? null : `process has ${outputExchanges.length} output exchanges in the frozen graph; a unique reference exchange cannot be inferred without evidence`,
	    };
    candidates.push(candidate);
    if (proposedValue && processRecord?.payload) {
      const patched = patchProcessPayloadQuantitativeReference(processRecord.payload, proposedValue);
      if (patched) patchedPayloads.push({ candidate_id: candidate.candidate_id, payload: patched });
    }
  }

  for (const row of serviceRows) {
    const processExchanges = exchangesByProcess.get(row.process_id) ?? [];
    const matching = processExchanges.filter((exchange) => {
      const sameFlow = exchange.flow_id === row.loop_flow_id;
      const sameAmount = row.amount === null || exchange.amount === row.amount;
      return sameFlow && sameAmount;
    });
    candidates.push({
      candidate_id: `SL-${String(row.index).padStart(3, '0')}-${row.process_id}`,
      source_diagnostic_id: `service_loop:${row.index}`,
      affected_process_id: row.process_id,
      affected_process_version: row.version,
      affected_exchange_id: matching.map((exchange) => exchange.exchange_internal_id).filter(Boolean),
      affected_flow_id: row.loop_flow_id,
      problem_type: 'service_loop',
      proposed_action: 'manual review: fix direction, flow, amount, or split the process with source evidence',
      old_value: { loop_flow_id: row.loop_flow_id, amount: row.amount, matching_exchanges: matching },
      proposed_value: null,
      state_code: row.state_code,
      evidence_status: 'unresolved_requires_source_or_modeling_review',
      closure_impact: 'may remove self-provider loop contributing to singular matrix risk',
      risk: 'high',
      write_eligibility: 'manual_review_required',
      unresolved_reason: 'no deterministic evidence-backed value or direction can be inferred from diagnostics alone',
    });
  }

  for (const group of duplicateGroups) {
    candidates.push({
      candidate_id: `DG-${String(group.group).padStart(3, '0')}`,
      source_diagnostic_id: `duplicate_exchange_group:${group.group}`,
      affected_process_id: group.process_ids,
      affected_process_version: null,
      affected_exchange_id: null,
      affected_flow_id: null,
      problem_type: 'duplicate_exchange_structure',
      proposed_action: 'manual review: merge, differentiate exchanges, or exclude duplicates from compute scope',
      old_value: { process_ids: group.process_ids, raw_processes: group.raw_processes },
      proposed_value: null,
      state_code: 0,
      evidence_status: 'unresolved_requires_owner_decision',
      closure_impact: 'may remove linearly dependent matrix columns after approved data decision',
      risk: 'high',
      write_eligibility: 'manual_review_required',
      unresolved_reason: 'business semantics cannot be inferred from identical exchange fingerprints',
    });
  }

  return { candidates, patchedPayloads };
}

function mutationPlanFromCandidates(taskId, candidates, dryRunStatusByCandidate = new Map()) {
  const runtimeAccount = accountContext();
  const mutations = candidates.map((candidate) => {
    const stateCode = candidate.state_code;
    let mutationType = 'manual-review';
    let reason = candidate.unresolved_reason ?? 'Candidate requires review before write.';
    if (stateCode === 0) {
      mutationType = 'update';
      reason = candidate.proposed_value
        ? 'state_code=0 account-owned working data uses update-first policy after dry-run validation'
        : 'state_code=0 update-first policy applies, but proposed value is unresolved';
    } else if (stateCode === 100) {
      mutationType = 'manual-review';
      reason = 'state_code=100 requires source-review and cannot be overwritten directly';
    } else if (stateCode === null || stateCode === undefined) {
      mutationType = 'follow-up';
      reason = 'missing or ambiguous state_code blocks remote write';
    }
    const dryRunStatus = dryRunStatusByCandidate.get(candidate.candidate_id) ?? 'not_run';
    return {
      candidate_id: candidate.candidate_id,
      record_type: Array.isArray(candidate.affected_process_id) ? 'process_group' : 'process',
      record_id: Array.isArray(candidate.affected_process_id) ? candidate.affected_process_id[0] : candidate.affected_process_id,
      record_ids: Array.isArray(candidate.affected_process_id) ? candidate.affected_process_id : undefined,
      version: candidate.affected_process_version,
      account_or_dataset_scope: runtimeAccount.scope,
      account_context: runtimeAccount,
      current_state_code: stateCode,
      proposed_mutation_type: mutationType,
      preferred_write_if_approved: stateCode === 0 ? 'update' : 'blocked_by_state_code_policy',
      fields_affected:
        candidate.problem_type === 'missing_reference'
          ? ['processDataSet.processInformation.quantitativeReference.referenceToReferenceFlow']
          : ['processDataSet.exchanges.exchange'],
      old_values: candidate.old_value,
      new_values: candidate.proposed_value,
      evidence_references: [`source_diagnostic:${candidate.source_diagnostic_id}`],
      reason,
      evidence_status: candidate.evidence_status,
      expected_impact_on_reference_closure: candidate.closure_impact,
      risk_level: candidate.risk,
      dry_run_eligibility: candidate.write_eligibility === 'dry_run_eligible',
      dry_run_status: dryRunStatus,
      remote_commit_allowed: false,
      remote_commit_eligibility: false,
      gate_status: {
        state_code_policy: stateCode === 0 ? 'update_first' : stateCode === 100 ? 'source_review_required' : 'blocked',
        evidence: candidate.evidence_status,
        dry_run: dryRunStatus,
        remote_commit: 'blocked_by_default_gate',
      },
    };
  });
  return {
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: 'generated',
    remote_commit_allowed: false,
    policy: {
      require_mutation_plan: true,
      require_state_code_write_policy: true,
      prefer_update_for_state_code_0: true,
      require_insert_reason_for_versioned_write: true,
      state_code_100_requires_source_review: true,
      unknown_state_code_blocks_remote_write: true,
      dry_run_before_remote_write: true,
    },
    operation_counts: {
      update: mutations.filter((entry) => entry.proposed_mutation_type === 'update').length,
      insert: mutations.filter((entry) => entry.proposed_mutation_type === 'insert').length,
      skip: mutations.filter((entry) => entry.proposed_mutation_type === 'skip').length,
      manual_review: mutations.filter((entry) => entry.proposed_mutation_type === 'manual-review').length,
      follow_up: mutations.filter((entry) => entry.proposed_mutation_type === 'follow-up').length,
      update_preferred_if_approved: mutations.filter((entry) => entry.preferred_write_if_approved === 'update').length,
      dry_run_eligible: mutations.filter((entry) => entry.dry_run_eligibility).length,
      remote_commit_eligible: 0,
    },
    entries: mutations,
    mutations,
  };
}

function writeClosureMarkdown(filePath, closure) {
  const rows = [
    { metric: 'total exchanges', value: closure.total_exchanges },
    { metric: 'reference-closure target exchanges', value: closure.reference_closure_target_exchanges },
    { metric: 'closed non-elementary exchanges', value: closure.closed_count },
    { metric: 'failed non-elementary exchanges', value: closure.failed_count },
    { metric: 'elementary flow exchanges excluded', value: closure.elementary_flow_excluded_count },
    { metric: 'passed including exclusions', value: closure.passed_count },
    { metric: 'status counts', value: JSON.stringify(closure.status_counts) },
  ];
  const topFailures = closure.rows
    .filter((row) => !['closed', 'closed_by_existing_process', 'closed_by_proxy', 'excluded_by_cutoff', 'excluded_by_boundary', 'excluded_elementary_flow'].includes(row.closure_status))
    .slice(0, 50)
    .map((row) => ({
      process: `${row.process_id}@${row.process_version}`,
      exchange: row.exchange_internal_id,
      flow: row.flow_id,
      status: row.closure_status,
    }));
  writeText(filePath, `# Reference-Flow Closure

- generated at: ${closure.generated_at_utc}
- status: ${closure.status}

${buildMarkdownTable(rows, ['metric', 'value'])}

## Top Failed Rows

${topFailures.length ? buildMarkdownTable(topFailures, ['process', 'exchange', 'flow', 'status']) : 'No failed rows.'}
`);
}

function datasetRowId(row, kind) {
  return asText(row?.id ?? row?.[`${kind}_id`] ?? row?.dataset_id) || null;
}

function datasetRowVersion(row) {
  return asText(row?.version ?? row?.resolved_version ?? row?.requested_version) || null;
}

function datasetRowKey(row, kind) {
  const id = datasetRowId(row, kind) ?? '<missing-id>';
  const version = datasetRowVersion(row) ?? '<missing-version>';
  return `${kind}:${id}@${version}`;
}

function accountAuditStateCodeSummary(rows) {
  const counts = {};
  for (const row of rows) {
    const key = row?.state_code === null || row?.state_code === undefined
      ? 'null'
      : String(row.state_code);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function reportPath(...parts) {
  return parts.join('/');
}

function validationInvalidRows(report) {
  return ensureArray(report?.rows).filter((row) => row?.status === 'invalid' || Number(row?.issue_count ?? 0) > 0);
}

function bilingualFindings(report) {
  return ensureArray(report?.scan?.findings);
}

function flowReviewFindings(reviewDir) {
  const findingsPath = path.join(reviewDir, 'findings.jsonl');
  if (!fileExists(findingsPath)) return [];
  return readJsonOrJsonl(findingsPath).filter((row) => row && typeof row === 'object');
}

function requiredFieldRowsByStatus(report, status) {
  return ensureArray(report?.rows).filter((row) => row?.status === status);
}

function queueEntryBase({ issueType, datasetType, row, source, proposedAction, evidenceStatus, risk = 'medium' }) {
  const id = datasetRowId(row, datasetType);
  const version = datasetRowVersion(row);
  const stateCode = row?.state_code ?? row?.stateCode ?? null;
  return {
    queue_id: `${issueType}:${datasetType}:${id ?? 'missing'}@${version ?? 'missing'}`,
    issue_type: issueType,
    dataset_type: datasetType,
    record_id: id,
    version,
    current_state_code: stateCode,
    proposed_action: proposedAction,
    evidence_status: evidenceStatus,
    risk,
    source,
    preferred_write_if_approved: stateCode === 0 ? 'update_existing_draft' : 'manual_review_or_follow_up',
    remote_commit_allowed: false,
  };
}

function buildAccountWideRepairQueue({
  processRows,
  flowRows,
  processValidation,
  flowValidation,
  processRequiredFields,
  processBilingual,
  flowBilingual,
  flowReviewDir,
  closure,
  remoteProcessVerification,
  remoteFlowVerification,
}) {
  const entries = [];
  const sampleCases = [];
  const rowsByProcessKey = new Map(processRows.map((row) => [datasetRowKey(row, 'process'), row]));
  const rowsByFlowKey = new Map(flowRows.map((row) => [datasetRowKey(row, 'flow'), row]));

  function pushEntry(entry, { sample = false } = {}) {
    entries.push(entry);
    if (sample) sampleCases.push(entry);
  }

  for (const invalid of validationInvalidRows(processValidation)) {
    const row = rowsByProcessKey.get(`process:${invalid.id}@${invalid.version}`) ?? invalid;
    pushEntry({
      ...queueEntryBase({
        issueType: 'process_schema_invalid',
        datasetType: 'process',
        row,
        source: {
          gate: 'dataset validate --type process',
          report: reportPath('gates/process/schema/outputs/validation-report.json'),
          issues: ensureArray(invalid.issues).slice(0, 5),
        },
        proposedAction: 'repair the process payload field paths named by the schema validator, then rerun schema/review/bilingual gates',
        evidenceStatus: 'deterministic_schema_issue',
        risk: 'high',
      }),
    }, { sample: sampleCases.filter((entry) => entry.issue_type === 'process_schema_invalid').length < 2 });
  }

  for (const invalid of validationInvalidRows(flowValidation)) {
    const row = rowsByFlowKey.get(`flow:${invalid.id}@${invalid.version}`) ?? invalid;
    pushEntry({
      ...queueEntryBase({
        issueType: 'flow_schema_invalid',
        datasetType: 'flow',
        row,
        source: {
          gate: 'dataset validate --type flow',
          report: reportPath('gates/flow/schema/outputs/validation-report.json'),
          issues: ensureArray(invalid.issues).slice(0, 5),
        },
        proposedAction: 'repair the flow payload field paths named by the schema validator, then rerun schema/review/bilingual gates',
        evidenceStatus: 'deterministic_schema_issue',
        risk: 'high',
      }),
    }, { sample: sampleCases.filter((entry) => entry.issue_type === 'flow_schema_invalid').length < 2 });
  }

  for (const completed of requiredFieldRowsByStatus(processRequiredFields, 'completed')) {
    const row = rowsByProcessKey.get(`process:${completed.id}@${completed.version}`) ?? completed;
    pushEntry({
      ...queueEntryBase({
        issueType: 'process_required_fields_deterministic_repair',
        datasetType: 'process',
        row,
        source: {
          gate: 'process complete-required-fields',
          report: reportPath('repair-candidates/process-required-fields/outputs/process-required-fields-report.json'),
          completions: ensureArray(completed.completions).slice(0, 10),
        },
        proposedAction: 'use the deterministic completed row as a repair candidate, run save-draft dry-run, then readback verification',
        evidenceStatus: 'deterministic_repair_candidate',
        risk: 'medium',
      }),
      repair_rows_file: reportPath('repair-candidates/processes.required-fields.jsonl'),
      dry_run_next: 'process save-draft --dry-run',
    }, { sample: sampleCases.filter((entry) => entry.issue_type === 'process_required_fields_deterministic_repair').length < 2 });
  }

  for (const blocked of requiredFieldRowsByStatus(processRequiredFields, 'blocked')) {
    const row = rowsByProcessKey.get(`process:${blocked.id}@${blocked.version}`) ?? blocked;
    pushEntry({
      ...queueEntryBase({
        issueType: 'process_required_fields_blocked',
        datasetType: 'process',
        row,
        source: {
          gate: 'process complete-required-fields',
          report: reportPath('repair-candidates/process-required-fields/outputs/process-required-fields-report.json'),
          issues: ensureArray(blocked.issues).slice(0, 10),
        },
        proposedAction: 'collect source evidence or reference-flow context before authoring the missing required field',
        evidenceStatus: 'blocked_pending_evidence',
        risk: 'high',
      }),
    }, { sample: sampleCases.filter((entry) => entry.issue_type === 'process_required_fields_blocked').length < 2 });
  }

  for (const finding of bilingualFindings(processBilingual)) {
    const row = processRows[finding.row_index ?? finding.index] ?? {};
    pushEntry({
      ...queueEntryBase({
        issueType: 'process_bilingual_quality',
        datasetType: 'process',
        row,
        source: {
          gate: 'dataset bilingual validate --type process',
          report: reportPath('gates/process/bilingual-validate/outputs/bilingual-validate-report.json'),
          finding,
        },
        proposedAction: 'run Codex/agent reviewed TIDAS bilingual transcreation, apply reviewed translations, and rerun bilingual validate',
        evidenceStatus: 'agent_transcreation_required',
        risk: finding.severity === 'blocker' ? 'high' : 'medium',
      }),
      field_path: finding.field_path ?? finding.path ?? null,
    }, { sample: sampleCases.filter((entry) => entry.issue_type === 'process_bilingual_quality').length < 2 });
  }

  for (const finding of bilingualFindings(flowBilingual)) {
    const row = flowRows[finding.row_index ?? finding.index] ?? {};
    pushEntry({
      ...queueEntryBase({
        issueType: 'flow_bilingual_quality',
        datasetType: 'flow',
        row,
        source: {
          gate: 'dataset bilingual validate --type flow',
          report: reportPath('gates/flow/bilingual-validate/outputs/bilingual-validate-report.json'),
          finding,
        },
        proposedAction: 'run Codex/agent reviewed TIDAS bilingual transcreation, apply reviewed translations, and rerun bilingual validate',
        evidenceStatus: 'agent_transcreation_required',
        risk: finding.severity === 'blocker' ? 'high' : 'medium',
      }),
      field_path: finding.field_path ?? finding.path ?? null,
    }, { sample: sampleCases.filter((entry) => entry.issue_type === 'flow_bilingual_quality').length < 2 });
  }

  for (const finding of flowReviewFindings(flowReviewDir)) {
    const row = rowsByFlowKey.get(`flow:${finding.flow_id ?? finding.id}@${finding.version ?? finding.flow_version}`) ?? {
      id: finding.flow_id ?? finding.id,
      version: finding.version ?? finding.flow_version,
    };
    pushEntry({
      ...queueEntryBase({
        issueType: 'flow_review_rule_finding',
        datasetType: 'flow',
        row,
        source: {
          gate: 'review flow',
          report: reportPath('gates/flow/review/flow_review_report.json'),
          finding,
        },
        proposedAction: 'repair flow identity, type, reference property, classification, or naming according to the flow governance finding',
        evidenceStatus: 'flow_governance_review_required',
        risk: finding.severity === 'error' ? 'high' : 'medium',
      }),
    }, { sample: sampleCases.filter((entry) => entry.issue_type === 'flow_review_rule_finding').length < 2 });
  }

  for (const closureRow of ensureArray(closure?.rows).filter((row) => ![
    'closed',
    'closed_by_existing_process',
    'closed_by_proxy',
    'excluded_elementary_flow',
    'excluded_by_cutoff',
    'excluded_by_boundary',
  ].includes(row.closure_status))) {
    pushEntry({
      queue_id: `reference_closure:${closureRow.process_id}@${closureRow.process_version}:${closureRow.exchange_internal_id ?? 'exchange'}:${closureRow.flow_id ?? 'missing-flow'}`,
      issue_type: 'reference_flow_closure',
      dataset_type: 'process_exchange',
      record_id: closureRow.process_id,
      version: closureRow.process_version,
      current_state_code: closureRow.process_state_code,
      exchange_internal_id: closureRow.exchange_internal_id,
      flow_id: closureRow.flow_id,
      flow_version: closureRow.flow_version,
      closure_status: closureRow.closure_status,
      proposed_action: 'resolve provider process, flow metadata, proxy/cutoff/boundary rationale, or flow version mismatch before compute readiness',
      evidence_status: 'closure_evidence_required',
      risk: 'high',
      source: {
        gate: 'reference-flow closure',
        report: reportPath('audit/reference-flow-closure.json'),
      },
      preferred_write_if_approved: closureRow.process_state_code === 0 ? 'update_existing_draft_or_provider_link' : 'manual_review_or_follow_up',
      remote_commit_allowed: false,
    }, { sample: sampleCases.filter((entry) => entry.issue_type === 'reference_flow_closure').length < 2 });
  }

  for (const [kind, report] of [['process', remoteProcessVerification], ['flow', remoteFlowVerification]]) {
    const blockers = ensureArray(report?.blockers ?? report?.checks).filter((item) => item?.status === 'failed' || item?.severity === 'blocker');
    for (const blocker of blockers.slice(0, 100)) {
      pushEntry({
        queue_id: `remote_reference:${kind}:${blocker.id ?? blocker.dataset_id ?? blocker.refObjectId ?? entries.length}`,
        issue_type: `${kind}_remote_reference_blocker`,
        dataset_type: kind,
        record_id: blocker.id ?? blocker.dataset_id ?? null,
        version: blocker.version ?? null,
        current_state_code: null,
        proposed_action: 'refresh reachable reference versions or block write until the referenced remote object is reachable',
        evidence_status: 'remote_reference_verification_blocker',
        risk: 'high',
        source: {
          gate: 'dataset verify-remote',
          report: reportPath(`verification/${kind}-remote/outputs/dataset-remote-verify-report.json`),
          blocker,
        },
        remote_commit_allowed: false,
      }, { sample: sampleCases.filter((entry) => entry.issue_type === `${kind}_remote_reference_blocker`).length < 2 });
    }
  }

  return {
    generated_at_utc: nowIso(),
    schema_version: 1,
    status: entries.length ? 'open' : 'empty',
    count: entries.length,
    sample_case_count: sampleCases.length,
    issue_type_counts: Object.fromEntries(countBy(entries, (entry) => entry.issue_type).map((item) => [item.key, item.count])),
    entries,
    sample_cases: sampleCases,
  };
}

function writeAccountWideAuditMarkdown(filePath, report, repairQueue) {
  const rows = [
    { metric: 'process rows', value: report.inventory.process_count },
    { metric: 'flow rows', value: report.inventory.flow_count },
    { metric: 'process schema invalid', value: report.gates.process_schema_invalid },
    { metric: 'flow schema invalid', value: report.gates.flow_schema_invalid },
    { metric: 'process bilingual findings', value: report.gates.process_bilingual_findings },
    { metric: 'flow bilingual findings', value: report.gates.flow_bilingual_findings },
    { metric: 'required-field deterministic repairs', value: report.gates.process_required_field_completed },
    { metric: 'required-field blockers', value: report.gates.process_required_field_blocked },
    { metric: 'reference closure failed rows', value: report.graph.reference_closure_failed },
    { metric: 'repair queue entries', value: repairQueue.count },
  ];
  const sampleRows = repairQueue.sample_cases.slice(0, 40).map((entry) => ({
    issue_type: entry.issue_type,
    dataset: entry.dataset_type,
    id: entry.record_id ?? entry.flow_id ?? '',
    version: entry.version ?? entry.flow_version ?? '',
    action: entry.proposed_action,
  }));
  writeText(filePath, `# Current-Profile Account-Wide Audit and Repair Queue

- generated at: ${report.generated_at_utc}
- task id: ${report.task_id}
- status: ${report.status}
- runtime account authority: ${report.account_context.authority}
- remote writes performed: no

${buildMarkdownTable(rows, ['metric', 'value'])}

## State Code Counts

### Processes

${buildMarkdownTable(Object.entries(report.inventory.process_state_code_counts).map(([state_code, count]) => ({ state_code, count })), ['state_code', 'count'])}

### Flows

${buildMarkdownTable(Object.entries(report.inventory.flow_state_code_counts).map(([state_code, count]) => ({ state_code, count })), ['state_code', 'count'])}

## Sample Repair Cases

${sampleRows.length ? buildMarkdownTable(sampleRows, ['issue_type', 'dataset', 'id', 'version', 'action']) : 'No repair cases were generated.'}

## Required Next Gates

1. For deterministic process required-field repairs, run \`process save-draft --dry-run\` on the generated rows before any write.
2. For bilingual quality entries, use agent-reviewed TIDAS transcreation, apply reviewed translations, and rerun bilingual validate.
3. For reference-closure entries, resolve provider/process/flow metadata or document explicit cutoff, proxy, or boundary rationale before compute readiness.
4. No remote commit is allowed until mutation plan, dry-run, readback, schema/review/bilingual, and applicable UI/compute verification pass.
`);
}

function runAccountWideAudit(options = {}) {
  const taskId = asText(options.taskId) || currentProfileAccountWideAuditTaskId;
  const workspace = options.outDir ? resolveRepoPath(options.outDir) : workspaceFor(taskId);
  ensureAccountRepairWorkspace(workspace);
  const freezeDir = path.join(workspace, 'input-freeze');
  const auditDir = path.join(workspace, 'audit');
  const gatesDir = path.join(workspace, 'gates');
  const repairDir = path.join(workspace, 'repair-candidates');
  const mutationDir = path.join(workspace, 'mutation-plan');
  const verificationDir = path.join(workspace, 'verification');
  const reportsDir = path.join(workspace, 'reports');
  for (const dir of [freezeDir, auditDir, gatesDir, repairDir, mutationDir, verificationDir, reportsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timeoutMs = numberOption(options.timeoutMs, 600000, { min: 10000, max: 1800000 });
  const pageSize = Math.floor(numberOption(options.pageSize, 1000, { min: 1, max: 5000 }));
  const account = accountContext();
  const commands = {};

  const refreshOutDir = path.join(freezeDir, 'process-refresh-references-probe');
  const refresh = runTiangongJson([
    'process',
    'refresh-references',
    '--out-dir',
    refreshOutDir,
    '--dry-run',
    '--limit',
    '1',
    '--page-size',
    String(pageSize),
    '--json',
  ], { timeoutMs });
  commands.process_refresh_references_probe = commandRecord(refresh);
  const manifestPath = path.join(refreshOutDir, 'inputs/processes.manifest.json');
  const manifest = readJsonIfExists(manifestPath);
  if (!refresh.ok || !manifest?.user_id) {
    const failure = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      task_id: taskId,
      status: 'failed',
      error_class: refresh.error_class ?? 'missing_current_user_manifest',
      account_context: account,
      commands,
      files: {
        workspace: repoRelativePath(workspace),
        process_refresh_manifest: maybeRepoRelative(manifestPath),
      },
    };
    writeJson(path.join(auditDir, 'account-wide-audit-report.json'), failure);
    return failure;
  }

  const processList = runTiangongJson([
    'process',
    'list',
    '--user-id',
    manifest.user_id,
    '--all',
    '--page-size',
    String(pageSize),
    '--json',
  ], { timeoutMs });
  commands.process_list = commandRecord(processList);

  const flowList = runTiangongJson([
    'flow',
    'list',
    '--user-id',
    manifest.user_id,
    '--all',
    '--page-size',
    String(pageSize),
    '--json',
  ], { timeoutMs });
  commands.flow_list = commandRecord(flowList);

  if (!processList.ok || !flowList.ok) {
    const failure = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      task_id: taskId,
      status: 'failed',
      error_class: processList.error_class ?? flowList.error_class,
      account_context: account,
      current_user_manifest: manifest,
      commands,
      files: {
        workspace: repoRelativePath(workspace),
      },
    };
    writeJson(path.join(auditDir, 'account-wide-audit-report.json'), failure);
    return failure;
  }

  const processRows = ensureArray(processList.json?.rows);
  const flowRows = ensureArray(flowList.json?.rows);
  const processRowsPath = path.join(freezeDir, 'current-user-processes.rows.jsonl');
  const flowRowsPath = path.join(freezeDir, 'current-user-flows.rows.jsonl');
  writeJson(path.join(freezeDir, 'current-user-processes.json'), processList.json);
  writeJson(path.join(freezeDir, 'current-user-flows.json'), flowList.json);
  writeText(processRowsPath, jsonLines(processRows));
  writeText(flowRowsPath, jsonLines(flowRows));
  writeJson(path.join(freezeDir, 'current-account-freeze-manifest.json'), {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: 'completed',
    account_context: account,
    user_id: manifest.user_id,
    masked_user_email: manifest.masked_user_email ?? null,
    source: 'remote_current_user_process_and_flow_list',
    no_remote_write_performed: true,
    counts: {
      processes: processRows.length,
      flows: flowRows.length,
    },
    files: {
      process_rows: repoRelativePath(processRowsPath),
      flow_rows: repoRelativePath(flowRowsPath),
    },
    commands,
  });

  const processSchemaDir = path.join(gatesDir, 'process/schema');
  const flowSchemaDir = path.join(gatesDir, 'flow/schema');
  const processReviewDir = path.join(gatesDir, 'process/review');
  const flowReviewDir = path.join(gatesDir, 'flow/review');
  const processBilingualDir = path.join(gatesDir, 'process/bilingual-validate');
  const flowBilingualDir = path.join(gatesDir, 'flow/bilingual-validate');
  const processRequiredDir = path.join(repairDir, 'process-required-fields');
  const processRequiredRowsPath = path.join(repairDir, 'processes.required-fields.jsonl');
  const emptyCommandResult = {
    ok: true,
    status: 0,
    command: [],
    stdout: '',
    stderr: '',
    json: null,
    timeout_ms: timeoutMs,
    duration_ms: 0,
  };

  const processSchema = runTiangongJson([
    'dataset', 'validate',
    '--input', processRowsPath,
    '--type', 'process',
    '--out-dir', processSchemaDir,
    '--json',
  ], { timeoutMs, allowJsonOnFailure: true });
  commands.process_schema = commandRecord(processSchema);

  const flowSchema = runTiangongJson([
    'dataset', 'validate',
    '--input', flowRowsPath,
    '--type', 'flow',
    '--out-dir', flowSchemaDir,
    '--json',
  ], { timeoutMs, allowJsonOnFailure: true });
  commands.flow_schema = commandRecord(flowSchema);

  let processRequired = emptyCommandResult;

  const processReview = processRows.length
    ? runTiangongJson([
      'review', 'process',
      '--rows-file', processRowsPath,
      '--out-dir', processReviewDir,
      '--json',
    ], { timeoutMs, allowJsonOnFailure: true })
    : emptyCommandResult;
  commands.process_review = commandRecord(processReview);

  const flowReview = flowRows.length
    ? runTiangongJson([
      'review', 'flow',
      '--rows-file', flowRowsPath,
      '--out-dir', flowReviewDir,
      '--json',
    ], { timeoutMs, allowJsonOnFailure: true })
    : emptyCommandResult;
  commands.flow_review = commandRecord(flowReview);

  const processBilingual = processRows.length
    ? runTiangongJson([
      'dataset', 'bilingual', 'validate',
      '--input', processRowsPath,
      '--type', 'process',
      '--out-dir', processBilingualDir,
      '--json',
    ], { timeoutMs, allowJsonOnFailure: true })
    : emptyCommandResult;
  commands.process_bilingual_validate = commandRecord(processBilingual);

  const flowBilingual = flowRows.length
    ? runTiangongJson([
      'dataset', 'bilingual', 'validate',
      '--input', flowRowsPath,
      '--type', 'flow',
      '--out-dir', flowBilingualDir,
      '--json',
    ], { timeoutMs, allowJsonOnFailure: true })
    : emptyCommandResult;
  commands.flow_bilingual_validate = commandRecord(flowBilingual);

  let processRemote = emptyCommandResult;
  let flowRemote = emptyCommandResult;
  const remoteVerifyMode = boolOption(options.skipRemoteReferenceVerify, false)
    ? 'skip'
    : (asText(options.remoteVerifyMode) || 'skip');
  const remoteVerifySampleSize = Math.floor(numberOption(options.remoteVerifySampleSize, 50, { min: 1, max: 1000 }));
  const processRowsForRemoteVerify = remoteVerifyMode === 'sample'
    ? processRows.slice(0, remoteVerifySampleSize)
    : processRows;
  const flowRowsForRemoteVerify = remoteVerifyMode === 'sample'
    ? flowRows.slice(0, remoteVerifySampleSize)
    : flowRows;
  const processRemoteRowsPath = remoteVerifyMode === 'sample'
    ? path.join(verificationDir, 'process-remote/sample-processes.rows.jsonl')
    : processRowsPath;
  const flowRemoteRowsPath = remoteVerifyMode === 'sample'
    ? path.join(verificationDir, 'flow-remote/sample-flows.rows.jsonl')
    : flowRowsPath;
  if (remoteVerifyMode === 'sample') {
    writeText(processRemoteRowsPath, jsonLines(processRowsForRemoteVerify));
    writeText(flowRemoteRowsPath, jsonLines(flowRowsForRemoteVerify));
  }
  if (remoteVerifyMode !== 'skip') {
    processRemote = processRowsForRemoteVerify.length
      ? runTiangongJson([
        'dataset', 'verify-remote',
        '--input', processRemoteRowsPath,
        '--root-policy', 'existing',
        '--out-dir', path.join(verificationDir, 'process-remote'),
        '--json',
      ], { timeoutMs, allowJsonOnFailure: true })
      : processRemote;
    flowRemote = flowRowsForRemoteVerify.length
      ? runTiangongJson([
        'dataset', 'verify-remote',
        '--input', flowRemoteRowsPath,
        '--root-policy', 'existing',
        '--out-dir', path.join(verificationDir, 'flow-remote'),
        '--json',
      ], { timeoutMs, allowJsonOnFailure: true })
      : flowRemote;
  }
  commands.process_remote_verify = commandRecord(processRemote);
  commands.flow_remote_verify = commandRecord(flowRemote);

  const preliminaryGraph = makeProcessGraph(processRows);
  const flowMetadataPath = path.join(freezeDir, 'flow-metadata-for-account-process-exchanges.json');
  const flowMetadataRowsPath = path.join(
    freezeDir,
    'flow-metadata-for-account-process-exchanges.rows.jsonl',
  );
  const flowMetadata = fetchFlowMetadataForGraph(preliminaryGraph, {
    outputDir: path.join(freezeDir, 'flow-metadata-fetch'),
    cachePath: flowMetadataPath,
    batchSize: numberOption(options.flowMetadataBatchSize, 80, { min: 1, max: 500 }),
    batchTimeoutMs: numberOption(options.flowMetadataBatchTimeoutMs, 120000, { min: 10000, max: 600000 }),
    maxBatches: options.flowMetadataMaxBatches,
    stopOnFailure: boolOption(options.flowMetadataStopOnFailure, true),
  });
  writeJson(flowMetadataPath, {
    generated_at_utc: flowMetadata.generated_at_utc,
    status: flowMetadata.status,
    error_class: flowMetadata.error_class,
    from_cache: flowMetadata.from_cache,
    limited: flowMetadata.limited,
    distinct_exchange_flow_ids: flowMetadata.distinct_exchange_flow_ids,
    fetched_flow_rows: flowMetadata.fetched_flow_rows,
    matched_distinct_flow_ids: flowMetadata.matched_distinct_flow_ids,
    missing_distinct_flow_ids: flowMetadata.missing_distinct_flow_ids,
    missing_flow_ids: flowMetadata.missing_flow_ids,
    rows: flowMetadata.rows,
  });
  writeText(flowMetadataRowsPath, jsonLines(flowMetadata.rows));
  commands.flow_metadata_for_exchange_flows = {
    command: 'batched tiangong-lca flow list --id <exchange-flow-id> --all --json',
    ok: flowMetadata.status === 'completed',
    status: flowMetadata.status,
    error_class: flowMetadata.error_class,
    batch_count: flowMetadata.command_count,
    total_batch_count: flowMetadata.total_batch_count,
    completed_batch_count: flowMetadata.completed_batch_count,
  };

  processRequired = processRows.length
    ? runTiangongJson(
        [
          'process',
          'complete-required-fields',
          '--input',
          processRowsPath,
          '--flows',
          flowMetadataRowsPath,
          '--out',
          processRequiredRowsPath,
          '--out-dir',
          processRequiredDir,
          '--json',
        ],
        { timeoutMs, allowJsonOnFailure: true },
      )
    : emptyCommandResult;
  commands.process_required_fields = commandRecord(processRequired);

  const graph = makeProcessGraph(processRows, flowMetadata.metadata);
  const closure = summarizeClosure(graph);
  writeJson(path.join(auditDir, 'process-exchange-flow-graph.json'), {
    generated_at_utc: nowIso(),
    task_id: taskId,
    counts: {
      processes: graph.processes.length,
      exchanges: graph.exchanges.length,
      distinct_exchange_flows: uniqueExchangeFlowIds(graph).length,
      provider_reference_flows: graph.providerByExactFlow.size,
    },
    processes: graph.processes.map(({ payload, ...row }) => row),
    exchanges: graph.exchanges,
  });
  writeJson(path.join(auditDir, 'reference-flow-closure.json'), closure);
  writeClosureMarkdown(path.join(reportsDir, 'reference-flow-closure.md'), closure);

  const processValidationReport = readJsonIfExists(path.join(processSchemaDir, 'outputs/validation-report.json'));
  const flowValidationReport = readJsonIfExists(path.join(flowSchemaDir, 'outputs/validation-report.json'));
  const processRequiredReport = readJsonIfExists(path.join(processRequiredDir, 'outputs/process-required-fields-report.json'));
  const processBilingualReport = readJsonIfExists(path.join(processBilingualDir, 'outputs/bilingual-validate-report.json'));
  const flowBilingualReport = readJsonIfExists(path.join(flowBilingualDir, 'outputs/bilingual-validate-report.json'));
  const processRemoteReport = readJsonIfExists(path.join(verificationDir, 'process-remote/outputs/dataset-remote-verify-report.json'))
    ?? processRemote.json;
  const flowRemoteReport = readJsonIfExists(path.join(verificationDir, 'flow-remote/outputs/dataset-remote-verify-report.json'))
    ?? flowRemote.json;

  const repairQueue = buildAccountWideRepairQueue({
    processRows,
    flowRows,
    processValidation: processValidationReport,
    flowValidation: flowValidationReport,
    processRequiredFields: processRequiredReport,
    processBilingual: processBilingualReport,
    flowBilingual: flowBilingualReport,
    flowReviewDir,
    closure,
    remoteProcessVerification: processRemoteReport,
    remoteFlowVerification: flowRemoteReport,
  });
  writeJson(path.join(repairDir, 'repair-queue.json'), repairQueue);

  const mutationPlan = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: repairQueue.count ? 'open' : 'empty',
    remote_commit_allowed: false,
    policy: {
      dry_run_before_remote_write: true,
      readback_after_write: true,
      ui_validation_for_user_visible_process_repairs: true,
      compute_validation_for_process_graph_repairs: true,
      state_code_0_prefers_update: true,
      state_code_100_requires_source_review: true,
    },
    entries: repairQueue.entries.map((entry) => ({
      candidate_id: entry.queue_id,
      record_type: entry.dataset_type,
      record_id: entry.record_id,
      version: entry.version,
      current_state_code: entry.current_state_code,
      proposed_mutation_type: entry.preferred_write_if_approved === 'update_existing_draft' ? 'update' : 'manual-review',
      fields_affected: entry.field_path ? [entry.field_path] : [],
      evidence_references: [entry.source?.report].filter(Boolean),
      reason: entry.proposed_action,
      risk_level: entry.risk,
      dry_run_status: 'not_run',
      remote_commit_allowed: false,
      gate_status: {
        evidence: entry.evidence_status,
        dry_run: 'not_run',
        readback: 'not_run',
        ui_validation: 'not_run',
        compute_validation: 'not_run',
      },
    })),
  };
  writeJson(path.join(mutationDir, 'mutation-plan.json'), mutationPlan);

  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: repairQueue.count ? 'completed_with_repair_queue' : 'completed_no_repair_queue',
    account_context: account,
    inventory: {
      user_id: manifest.user_id,
      masked_user_email: manifest.masked_user_email ?? null,
      process_count: processRows.length,
      flow_count: flowRows.length,
      process_state_code_counts: accountAuditStateCodeSummary(processRows),
      flow_state_code_counts: accountAuditStateCodeSummary(flowRows),
    },
    gates: {
      command_failures: Object.values(commands).filter((command) => command && command.ok === false).length,
      process_schema_invalid: processValidationReport?.counts?.invalid ?? validationInvalidRows(processValidationReport).length,
      flow_schema_invalid: flowValidationReport?.counts?.invalid ?? validationInvalidRows(flowValidationReport).length,
      process_required_field_completed: processRequiredReport?.counts?.completed ?? 0,
      process_required_field_blocked: processRequiredReport?.counts?.blocked ?? 0,
      process_bilingual_findings: processBilingualReport?.scan?.finding_count ?? bilingualFindings(processBilingualReport).length,
      flow_bilingual_findings: flowBilingualReport?.scan?.finding_count ?? bilingualFindings(flowBilingualReport).length,
      flow_review_findings: readJsonIfExists(path.join(flowReviewDir, 'flow_review_report.json'))?.finding_count ?? flowReviewFindings(flowReviewDir).length,
      remote_process_verify_status: processRemoteReport?.status ?? (processRemote.ok ? 'not_run_or_passed' : 'failed'),
      remote_flow_verify_status: flowRemoteReport?.status ?? (flowRemote.ok ? 'not_run_or_passed' : 'failed'),
      remote_reference_verify_mode: remoteVerifyMode,
      remote_reference_verify_sample_size: remoteVerifyMode === 'sample' ? remoteVerifySampleSize : null,
    },
    graph: {
      process_count: graph.processes.length,
      exchange_count: graph.exchanges.length,
      distinct_exchange_flow_count: uniqueExchangeFlowIds(graph).length,
      reference_closure_target_exchanges: closure.reference_closure_target_exchanges,
      reference_closure_closed: closure.closed_count,
      reference_closure_failed: closure.failed_count,
      reference_closure_status_counts: closure.status_counts,
      flow_metadata_status: flowMetadata.status,
      flow_metadata_missing_distinct_flow_ids: flowMetadata.missing_distinct_flow_ids,
    },
    repair_queue: {
      count: repairQueue.count,
      issue_type_counts: repairQueue.issue_type_counts,
      sample_case_count: repairQueue.sample_case_count,
    },
    files: {
      workspace: repoRelativePath(workspace),
      process_rows: repoRelativePath(processRowsPath),
      flow_rows: repoRelativePath(flowRowsPath),
      repair_queue: repoRelativePath(path.join(repairDir, 'repair-queue.json')),
      mutation_plan: repoRelativePath(path.join(mutationDir, 'mutation-plan.json')),
      markdown_report: repoRelativePath(path.join(reportsDir, 'account-wide-audit.md')),
    },
    commands,
    remote_write_performed: false,
  };
  writeJson(path.join(auditDir, 'account-wide-audit-report.json'), report);
  writeJson(path.join(auditDir, 'completeness-snapshot.json'), {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    task_id: taskId,
    status: report.status,
    metrics: {
      total_processes: processRows.length,
      total_exchanges: graph.exchanges.length,
      distinct_exchange_flows: uniqueExchangeFlowIds(graph).length,
      exchange_flows_covered_by_reference_flow_process: closure.closed_count,
      missing_reference_flow_processes: closure.status_counts.missing_reference_process ?? 0,
      ambiguous_flow_matches: closure.status_counts.ambiguous_flow_match ?? 0,
      missing_or_duplicate_flows: (closure.status_counts.missing_flow ?? 0) + (closure.status_counts.flow_metadata_missing ?? 0),
      unresolved_mean_value_evidence: null,
      unresolved_unit_dimension_mismatches: closure.status_counts.unit_mismatch ?? 0,
      state_code_0_records_updated_or_proposed: mutationPlan.entries.filter((entry) => entry.current_state_code === 0).length,
      state_code_100_records_requiring_source_review: mutationPlan.entries.filter((entry) => Number(entry.current_state_code) >= 100).length,
    },
    matrix_readiness_status: closure.failed_count === 0 ? 'provider_closure_ready_pending_lcia' : 'blocked_by_provider_closure',
    compute_validation_status: 'not_run',
    blockers: [
      ...(closure.failed_count ? [`${closure.failed_count} reference-closure rows are not closed`] : []),
      'full compute validation requires matrix readiness input and real LCIA characterization factors',
    ],
    generated_follow_up_tasks: [],
  });
  writeAccountWideAuditMarkdown(path.join(reportsDir, 'account-wide-audit.md'), report, repairQueue);
  return report;
}

function computeRepairProbe(options = {}) {
  const taskId = options.taskId || computeRepairTaskId;
  const task = findTaskById(taskId) ?? { meta: { id: taskId, title: taskId }, body: '', fileName: `${taskId}.md`, path: '', relPath: '' };
  const workspace = workspaceFor(taskId);
  ensureWorkspace(task);
  ensureAccountRepairWorkspace(workspace);
  const auditDir = path.join(workspace, 'audit');
  const freezeDir = path.join(workspace, 'input-freeze');
  const reportDir = path.join(workspace, 'reports');
  const dryRunDir = path.join(workspace, 'dry-run');
  const repairDir = path.join(workspace, 'repair-candidates');
  const mutationDir = path.join(workspace, 'mutation-plan');
  for (const dir of [auditDir, freezeDir, reportDir, dryRunDir, repairDir, mutationDir]) fs.mkdirSync(dir, { recursive: true });

  const sourceReportPath = resolveRepoPath(task.meta.source_report)
    || path.join(repoRoot, 'inputs/diagnostics', `${taskId}.md`);
  const diagnostics = fileExists(sourceReportPath) ? parseComputeDiagnosticReport(readText(sourceReportPath)) : null;
  const probe = {
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: 'running',
    error_class: null,
    commands: {},
  };

  const refreshOutDir = path.join(auditDir, 'process-refresh-references-probe');
  const refresh = runTiangongJson([
    'process',
    'refresh-references',
    '--out-dir',
    refreshOutDir,
    '--dry-run',
    '--limit',
    '1',
    '--page-size',
    '1000',
    '--json',
  ]);
  probe.commands.refresh_references_probe = commandRecord(refresh);
  if (!refresh.ok) {
    probe.status = 'failed';
    probe.error_class = refresh.error_class;
    writeJson(path.join(auditDir, 'data-access-probe.json'), probe);
    writeJson(path.join(freezeDir, 'current-account-freeze-manifest.json'), {
      generated_at_utc: nowIso(),
      task_id: taskId,
      status: 'failed',
      error_class: refresh.error_class,
      reason: refresh.error ?? refresh.stderr,
    });
    return { probe, next_status: 'failed' };
  }

  const manifestPath = path.join(refreshOutDir, 'inputs/processes.manifest.json');
  const manifest = fileExists(manifestPath) ? readJson(manifestPath) : null;
  if (!manifest?.user_id) {
    probe.status = 'failed';
    probe.error_class = 'account_filter_error';
    writeJson(path.join(auditDir, 'data-access-probe.json'), probe);
    return { probe, next_status: 'failed' };
  }

  const privateProcesses = runTiangongJson([
    'process',
    'list',
    '--user-id',
    manifest.user_id,
    '--state-code',
    '0',
    '--all',
    '--page-size',
    '1000',
    '--json',
  ]);
  probe.commands.private_process_list = commandRecord(privateProcesses);

  const publicStateArgs = [];
  for (let code = 100; code <= 199; code += 1) publicStateArgs.push('--state-code', String(code));
  const publicProcesses = runTiangongJson([
    'process',
    'list',
    ...publicStateArgs,
    '--all',
    '--page-size',
    '1000',
    '--json',
  ]);
  probe.commands.public_process_list = commandRecord(publicProcesses);

  if (!privateProcesses.ok || !publicProcesses.ok) {
    probe.status = 'failed';
    probe.error_class = !privateProcesses.ok ? privateProcesses.error_class : publicProcesses.error_class;
    writeJson(path.join(auditDir, 'data-access-probe.json'), probe);
    writeJson(path.join(freezeDir, 'current-account-freeze-manifest.json'), {
      generated_at_utc: nowIso(),
      task_id: taskId,
      status: 'failed',
      error_class: probe.error_class,
      current_user_manifest: manifest,
      commands: probe.commands,
    });
    return { probe, next_status: 'failed' };
  }

  const privateRows = privateProcesses.json.rows.map((row) => ({ ...row, source_scope: 'current_user_state_code_0' }));
  const publicRows = publicProcesses.json.rows.map((row) => ({ ...row, source_scope: 'visible_public_state_code_100_199' }));
  const allRowsByKey = new Map();
  for (const row of [...publicRows, ...privateRows]) {
    allRowsByKey.set(`${row.id}@${row.version}`, row);
  }
  const allRows = [...allRowsByKey.values()];
  if (allRows.length === 0) {
    probe.status = 'failed';
    probe.error_class = 'empty_result';
    writeJson(path.join(auditDir, 'data-access-probe.json'), probe);
    return { probe, next_status: 'failed' };
  }

  const privateRowsPath = path.join(freezeDir, 'current-user-processes.state-code-0.json');
  const publicRowsPath = path.join(freezeDir, 'visible-public-processes.state-code-100-199.json');
  const allRowsPath = path.join(freezeDir, 'target-matrix-processes.jsonl');
  writeJson(privateRowsPath, privateProcesses.json);
  writeJson(publicRowsPath, publicProcesses.json);
  writeText(allRowsPath, jsonLines(allRows));

  const flowMetadataPath = path.join(freezeDir, 'flow-metadata-for-exchange-flows.json');
  const flowMetadataFetchDir = path.join(freezeDir, 'flow-metadata-fetch');
  const preliminaryGraph = makeProcessGraph(allRows);
  const flowMetadataFreeze = fetchFlowMetadataForGraph(preliminaryGraph, {
    outputDir: flowMetadataFetchDir,
    cachePath: flowMetadataPath,
    maxBatches: options.flowMetadataMaxBatches,
    batchSize: options.flowMetadataBatchSize,
    batchTimeoutMs: options.flowMetadataBatchTimeoutMs,
    stopOnFailure: options.flowMetadataStopOnFailure,
  });
  writeJson(flowMetadataPath, {
    generated_at_utc: flowMetadataFreeze.generated_at_utc,
    status: flowMetadataFreeze.status,
    error_class: flowMetadataFreeze.error_class,
    from_cache: flowMetadataFreeze.from_cache,
    limited: flowMetadataFreeze.limited,
    distinct_exchange_flow_ids: flowMetadataFreeze.distinct_exchange_flow_ids,
    requested_flow_ids_hash: flowMetadataFreeze.requested_flow_ids_hash,
    fetched_flow_rows: flowMetadataFreeze.fetched_flow_rows,
    matched_distinct_flow_ids: flowMetadataFreeze.matched_distinct_flow_ids,
    missing_distinct_flow_ids: flowMetadataFreeze.missing_distinct_flow_ids,
    missing_flow_ids: flowMetadataFreeze.missing_flow_ids,
    batch_size: flowMetadataFreeze.batch_size,
    batch_timeout_ms: flowMetadataFreeze.batch_timeout_ms,
    total_batch_count: flowMetadataFreeze.total_batch_count,
    completed_batch_count: flowMetadataFreeze.completed_batch_count,
    command_count: flowMetadataFreeze.command_count,
    progress_path: flowMetadataFreeze.progress_path ? path.relative(workspace, flowMetadataFreeze.progress_path) : null,
    checkpoint_path: flowMetadataFreeze.checkpoint_path ? path.relative(workspace, flowMetadataFreeze.checkpoint_path) : null,
    summary_path: flowMetadataFreeze.summary_path ? path.relative(workspace, flowMetadataFreeze.summary_path) : null,
    commands: flowMetadataFreeze.commands,
    failures: flowMetadataFreeze.failures,
    rows: flowMetadataFreeze.rows,
  });
  probe.commands.flow_metadata_for_exchange_flows = {
    command: 'batched tiangong flow list --id <exchange-flow-id> --all --json',
    ok: flowMetadataFreeze.status === 'completed',
    status: flowMetadataFreeze.status,
    error_class: flowMetadataFreeze.error_class,
    stderr_preview: '',
    error: flowMetadataFreeze.failures[0]?.error ?? null,
    batch_count: flowMetadataFreeze.command_count,
    total_batch_count: flowMetadataFreeze.total_batch_count,
    completed_batch_count: flowMetadataFreeze.completed_batch_count,
    progress_path: flowMetadataFreeze.progress_path ? path.relative(workspace, flowMetadataFreeze.progress_path) : null,
    checkpoint_path: flowMetadataFreeze.checkpoint_path ? path.relative(workspace, flowMetadataFreeze.checkpoint_path) : null,
    from_cache: flowMetadataFreeze.from_cache,
  };

  const graph = makeProcessGraph(allRows, flowMetadataFreeze.metadata);
  const graphForFile = {
    generated_at_utc: nowIso(),
    task_id: taskId,
    source_files: {
      private_processes: path.relative(workspace, privateRowsPath),
      public_processes: path.relative(workspace, publicRowsPath),
      combined_processes: path.relative(workspace, allRowsPath),
      flow_metadata: path.relative(workspace, flowMetadataPath),
    },
    counts: {
      processes: graph.processes.length,
      exchanges: graph.exchanges.length,
      distinct_exchange_flows: new Set(graph.exchanges.map((exchange) => exchange.flow_id).filter(Boolean)).size,
      provider_reference_flows: graph.providerByExactFlow.size,
      elementary_flow_exchanges: graph.exchanges.filter((exchange) => exchange.is_elementary_flow).length,
      missing_flow_metadata_exchanges: graph.exchanges.filter((exchange) => exchange.flow_metadata_status === 'missing_flow_metadata').length,
    },
    processes: graph.processes.map(({ payload, ...row }) => row),
    exchanges: graph.exchanges,
  };
  writeJson(path.join(auditDir, 'process-exchange-flow-graph.json'), graphForFile);

  const closure = summarizeClosure(graph);
  writeJson(path.join(auditDir, 'reference-flow-closure.json'), closure);
  writeClosureMarkdown(path.join(reportDir, 'reference-flow-closure.md'), closure);

  const { candidates, patchedPayloads } = buildRepairCandidatesFromDiagnostics({ diagnostics, graph });
  const patchedPayloadPath = path.join(repairDir, 'dry-run-eligible-patched-processes.jsonl');
  writeJson(path.join(repairDir, 'repair-candidates.json'), {
    generated_at_utc: nowIso(),
    task_id: taskId,
    source: 'diagnostic report plus frozen process graph',
    count: candidates.length,
    dry_run_eligible_count: patchedPayloads.length,
    candidates,
  });
  writeText(patchedPayloadPath, jsonLines(patchedPayloads.map((item) => item.payload)));

  const dryRunStatusByCandidate = new Map();
  let dryRunResult;
  if (patchedPayloads.length > 0) {
    const saveDraftOutDir = path.join(dryRunDir, 'process-save-draft');
    const dryRun = runTiangongJson([
      'process',
      'save-draft',
      '--input',
      patchedPayloadPath,
      '--out-dir',
      saveDraftOutDir,
      '--dry-run',
      '--json',
    ]);
    for (const candidate of patchedPayloads) {
      dryRunStatusByCandidate.set(candidate.candidate_id, dryRun.ok ? 'passed' : 'failed');
    }
    dryRunResult = {
      generated_at_utc: nowIso(),
      task_id: taskId,
      status: dryRun.ok ? 'passed_with_unresolved_candidates' : 'failed',
      error_class: dryRun.ok ? null : dryRun.error_class,
      command: commandRecord(dryRun),
      eligible_candidate_count: patchedPayloads.length,
      total_candidate_count: candidates.length,
      remote_write_performed: false,
      output_dir: path.relative(workspace, saveDraftOutDir),
      blocker: dryRun.ok
        ? 'Dry-run passed for deterministic missing-reference candidates only; service-loop and duplicate candidates remain unresolved.'
        : 'Process save-draft dry-run failed for eligible candidates.',
      follow_up_task: dryRun.ok ? 'FU-LCA-COMPUTE-20260510-004 partially satisfied for eligible candidates' : 'FU-LCA-COMPUTE-20260510-004',
    };
  } else {
    dryRunResult = {
      generated_at_utc: nowIso(),
      task_id: taskId,
      status: 'blocked',
      error_class: 'repair_payload_not_eligible',
      missing_command: null,
      missing_adapter: null,
      missing_credential: null,
      missing_rpc_or_schema: null,
      reason: 'No repair candidate has an evidence-backed proposed value, so no process save-draft dry-run input was generated.',
      follow_up_task: 'FU-LCA-COMPUTE-20260510-004',
      remote_write_performed: false,
    };
  }
  writeJson(path.join(dryRunDir, 'result.json'), dryRunResult);

  const mutationPlan = mutationPlanFromCandidates(taskId, candidates, dryRunStatusByCandidate);
  writeJson(path.join(mutationDir, 'mutation-plan.json'), mutationPlan);

  const flowMetadataErrorClass = flowMetadataFreeze.status === 'completed'
    ? null
    : (flowMetadataFreeze.error_class ?? 'unknown_error');
  const freezeManifest = {
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: flowMetadataFreeze.status === 'completed' ? 'completed' : 'partial',
    error_class: flowMetadataErrorClass,
    user_id: manifest.user_id,
    masked_user_email: manifest.masked_user_email,
    source: 'real_remote_env_account_data',
    counts: {
      current_user_manifest_processes: manifest.count,
      current_user_state_code_0_processes: privateRows.length,
	      visible_public_state_code_100_199_processes: publicRows.length,
	      target_matrix_processes: allRows.length,
	      target_matrix_exchanges: graph.exchanges.length,
	      distinct_exchange_flows: graphForFile.counts.distinct_exchange_flows,
	      fetched_flow_metadata_rows: flowMetadataFreeze.fetched_flow_rows,
	      matched_distinct_exchange_flows: flowMetadataFreeze.matched_distinct_flow_ids,
	      missing_distinct_exchange_flow_metadata: flowMetadataFreeze.missing_distinct_flow_ids,
	      elementary_flow_exchanges: graphForFile.counts.elementary_flow_exchanges,
	    },
    flow_metadata_fetch: {
      status: flowMetadataFreeze.status,
      error_class: flowMetadataFreeze.error_class,
      from_cache: flowMetadataFreeze.from_cache,
      batch_size: flowMetadataFreeze.batch_size,
      batch_timeout_ms: flowMetadataFreeze.batch_timeout_ms,
      total_batch_count: flowMetadataFreeze.total_batch_count,
      completed_batch_count: flowMetadataFreeze.completed_batch_count,
      command_count: flowMetadataFreeze.command_count,
    },
	    files: {
	      process_refresh_manifest: path.relative(workspace, manifestPath),
	      current_user_processes: path.relative(workspace, privateRowsPath),
	      visible_public_processes: path.relative(workspace, publicRowsPath),
	      target_matrix_processes: path.relative(workspace, allRowsPath),
	      flow_metadata: path.relative(workspace, flowMetadataPath),
      flow_metadata_progress: flowMetadataFreeze.progress_path ? path.relative(workspace, flowMetadataFreeze.progress_path) : null,
      flow_metadata_checkpoint: flowMetadataFreeze.checkpoint_path ? path.relative(workspace, flowMetadataFreeze.checkpoint_path) : null,
      flow_metadata_summary: flowMetadataFreeze.summary_path ? path.relative(workspace, flowMetadataFreeze.summary_path) : null,
	      graph: 'audit/process-exchange-flow-graph.json',
	      closure: 'audit/reference-flow-closure.json',
	    },
    commands: probe.commands,
    remote_write_performed: false,
  };
  writeJson(path.join(freezeDir, 'current-account-freeze-manifest.json'), freezeManifest);

  probe.status = flowMetadataFreeze.status === 'completed' ? 'completed' : 'partial';
  probe.error_class = flowMetadataErrorClass;
  probe.counts = freezeManifest.counts;
  writeJson(path.join(auditDir, 'data-access-probe.json'), probe);

  const verification = {
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: 'blocked',
    matrix_readiness_verified: false,
    compute_validation_executed: false,
    remote_write_performed: false,
	    gate_failures: [
	      ...((closure.status_counts.flow_metadata_missing ?? 0) > 0 ? ['flow_metadata_missing'] : []),
	      ...(closure.failed_count > 0 ? ['reference_flow_closure_failed'] : []),
      ...(mutationPlan.operation_counts.dry_run_eligible < mutationPlan.mutations.length ? ['not_all_candidates_dry_run_eligible'] : []),
      ...(dryRunResult.status !== 'passed' ? ['dry_run_not_fully_passed'] : ['dry_run_only_partial_scope']),
      'remote_commit_gate_disabled',
      'verification_command_not_available_for_uncommitted_repairs',
    ],
    reason: 'No online write was allowed because closure and dry-run gates did not fully pass for all candidates.',
  };
  writeJson(path.join(reportDir, 'verification-result.json'), verification);

  const completenessSnapshot = {
    generated_at_utc: nowIso(),
    task_id: taskId,
    status: closure.failed_count === 0 && dryRunResult.status === 'passed' ? 'passed' : 'blocked',
    reason: closure.failed_count === 0 ? dryRunResult.blocker : 'Reference-flow closure still has failed rows.',
    metrics: {
      total_processes: graph.processes.length,
      total_exchanges: graph.exchanges.length,
      distinct_exchange_flows: graphForFile.counts.distinct_exchange_flows,
      reference_closure_target_exchanges: closure.reference_closure_target_exchanges,
      exchange_flows_covered_by_reference_flow_process: closure.closed_count,
      elementary_exchange_flows_excluded_from_reference_closure: closure.elementary_flow_excluded_count,
      missing_reference_flow_processes: closure.status_counts.missing_reference_process ?? 0,
      exchange_flow_metadata_missing: closure.status_counts.flow_metadata_missing ?? 0,
      ambiguous_flow_matches: closure.status_counts.ambiguous_flow_match ?? 0,
      missing_or_duplicate_flows: closure.status_counts.missing_flow ?? 0,
      unresolved_mean_value_evidence: candidates.filter((candidate) => candidate.problem_type === 'service_loop').length,
      unresolved_unit_dimension_mismatches: null,
      state_code_0_records_updated_or_proposed: candidates.filter((candidate) => candidate.state_code === 0 && candidate.proposed_value).length,
      state_code_100_records_requiring_source_review: candidates.filter((candidate) => candidate.state_code === 100).length,
    },
    matrix_readiness_status: closure.failed_count === 0 ? 'ready' : 'blocked',
    compute_validation_status: 'not_run',
    blockers: verification.gate_failures,
    generated_follow_up_tasks: [
      'FU-LCA-COMPUTE-20260510-002',
      'FU-LCA-COMPUTE-20260510-004',
      'FU-LCA-COMPUTE-20260510-005',
    ],
  };
  writeJson(path.join(auditDir, 'completeness-snapshot.json'), completenessSnapshot);
  writeJson(path.join(workspace, 'outputs/completeness-snapshot.json'), completenessSnapshot);

  const followUpStatusRows = [
    {
      id: 'FU-LCA-COMPUTE-20260510-001',
      status: 'partially_satisfied_for_current_task',
      remaining_blocker: 'A foundry probe now freezes credential-scoped data and graph output, but the durable CLI dataset inventory/export command is still not implemented as a standalone command.',
    },
    {
      id: 'FU-LCA-COMPUTE-20260510-002',
      status: 'partially_satisfied_for_current_task',
      remaining_blocker: 'Every frozen exchange now receives a closure status in foundry output, and elementary flows are excluded from provider-process closure; a reusable CLI/skill closure checker is still needed.',
    },
    {
      id: 'FU-LCA-COMPUTE-20260510-003',
      status: 'partially_satisfied_for_current_task',
      remaining_blocker: 'The generated mutation plan applies state_code policy and blocks remote commit, but there is not yet a separate validator command.',
    },
    {
      id: 'FU-LCA-COMPUTE-20260510-004',
      status: dryRunResult.status === 'passed' ? 'partially_satisfied_for_current_task' : 'blocked',
      remaining_blocker: dryRunResult.status === 'passed'
        ? 'Dry-run command ran for eligible candidates only; unresolved candidates still need evidence-backed payloads.'
        : dryRunResult.reason ?? dryRunResult.blocker,
    },
    {
      id: 'FU-LCA-COMPUTE-20260510-005',
      status: 'blocked',
      remaining_blocker: 'Matrix readiness and compute verification were not executed because reference-flow closure and dry-run gates did not pass.',
    },
  ];
  writeJson(path.join(workspace, 'follow-ups/follow-up-status.json'), {
    generated_at_utc: nowIso(),
    task_id: taskId,
    statuses: followUpStatusRows,
  });

  const reportRows = [
    { metric: 'remote current-user processes', value: privateRows.length },
    { metric: 'remote public processes', value: publicRows.length },
    { metric: 'target processes', value: graph.processes.length },
    { metric: 'target exchanges', value: graph.exchanges.length },
    { metric: 'reference-closure target exchanges', value: closure.reference_closure_target_exchanges },
    { metric: 'closed non-elementary exchanges', value: `${closure.closed_count}/${closure.reference_closure_target_exchanges}` },
    { metric: 'failed non-elementary exchanges', value: `${closure.failed_count}/${closure.reference_closure_target_exchanges}` },
    { metric: 'elementary flow exchanges excluded', value: closure.elementary_flow_excluded_count },
    { metric: 'flow metadata missing exchanges', value: closure.status_counts.flow_metadata_missing ?? 0 },
    { metric: 'passed including exclusions', value: `${closure.passed_count}/${closure.total_exchanges}` },
    { metric: 'repair candidates', value: candidates.length },
    { metric: 'mutation plan entries', value: mutationPlan.mutations.length },
    { metric: 'dry-run status', value: dryRunResult.status },
    { metric: 'verification status', value: verification.status },
    { metric: 'online writes', value: 'no' },
  ];
  writeText(path.join(reportDir, 'second-cycle-report.md'), `# ${taskId} second repair cycle

- generated at: ${nowIso()}
- source: real remote env account data through current CLI where available
- online write performed: no
- closure policy: elementary flows are excluded from provider reference-flow process lookup; only non-elementary exchange flows are closure targets.
- flow metadata fetch: ${flowMetadataFreeze.status}${flowMetadataFreeze.from_cache ? ' (cache hit)' : ''}; progress is written under \`${path.relative(workspace, flowMetadataFetchDir)}\`.

${buildMarkdownTable(reportRows, ['metric', 'value'])}

## Gate Failures

${verification.gate_failures.map((failure) => `- ${failure}`).join('\n')}

## Dry-Run

- status: ${dryRunResult.status}
- eligible candidates: ${dryRunResult.eligible_candidate_count ?? 0}
- total candidates: ${dryRunResult.total_candidate_count ?? candidates.length}
- note: ${dryRunResult.blocker ?? dryRunResult.reason}

## Follow-Up Status

${buildMarkdownTable(followUpStatusRows, ['id', 'status', 'remaining_blocker'])}

## Next Required Work

1. Review unresolved service-loop and duplicate-exchange candidates.
2. Resolve failed reference-flow closure rows or document cutoff/boundary/proxy decisions.
3. Re-run this probe after repair candidates have proposed values.
4. Only enable remote commit after full dry-run and verification pass.
`);

  if (task?.path && fileExists(task.path)) {
    const updatedTask = readTaskFile(task.path);
    writeTaskFile(task.path, {
      ...updatedTask,
      meta: {
        ...updatedTask.meta,
        state: 'Blocked',
	        result: 'probe_completed_remote_write_blocked',
	        updated_at_utc: nowIso(),
	        report: path.relative(repoRoot, path.join(reportDir, 'second-cycle-report.md')),
	        remote_process_count: graph.processes.length,
	        remote_exchange_count: graph.exchanges.length,
	        blocker_count: verification.gate_failures.length,
	        closure_target_count: closure.reference_closure_target_exchanges,
	        closure_passed_count: closure.passed_count,
	        closure_closed_non_elementary_count: closure.closed_count,
	        closure_failed_count: closure.failed_count,
	        closure_elementary_excluded_count: closure.elementary_flow_excluded_count,
	        closure_flow_metadata_missing_count: closure.status_counts.flow_metadata_missing ?? 0,
	        repair_candidate_count: candidates.length,
        mutation_entry_count: mutationPlan.mutations.length,
        dry_run_status: dryRunResult.status,
        verification_status: verification.status,
        online_write_performed: false,
      },
    });
  }

  return {
    probe,
    freezeManifest,
    graph: graphForFile.counts,
	    closure: {
	      total: closure.total_exchanges,
	      target: closure.reference_closure_target_exchanges,
	      passed: closure.passed_count,
	      closed: closure.closed_count,
	      excluded_elementary: closure.elementary_flow_excluded_count,
	      failed: closure.failed_count,
	      status_counts: closure.status_counts,
	    },
    repair_candidate_count: candidates.length,
    mutation_entry_count: mutationPlan.mutations.length,
    dry_run_status: dryRunResult.status,
    verification_status: verification.status,
    online_write_performed: false,
    report: path.relative(repoRoot, path.join(reportDir, 'second-cycle-report.md')),
  };
}

function runAccountComputeRepair(task, workspace) {
  ensureAccountRepairWorkspace(workspace);
  const sourceReportPath = resolveRepoPath(task.meta.source_report)
    || path.join(repoRoot, 'inputs/diagnostics', `${task.meta.id}.md`);
  const sourceReportExists = fileExists(sourceReportPath);
  const sourceReportText = sourceReportExists ? readText(sourceReportPath) : '';
  const diagnostics = sourceReportExists ? parseComputeDiagnosticReport(sourceReportText) : null;
  const roots = configuredRoots();
  const runtimeAccount = accountContext(task);
  const blockers = [];
  if (!sourceReportExists) {
    blockers.push('expected local compute diagnostic report is missing');
  }
  blockers.push('full current-account process/exchange/flow export not available in this run');
  blockers.push('per-exchange reference-flow closure checker not available in this run');
  blockers.push('repair payloads were not generated, so dry-run was not executed');
  blockers.push('matrix readiness and compute validation were not executed');

  const sourceManifest = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    account_context: runtimeAccount,
    account_env_target: runtimeAccount.scope,
    expected_input: 'credential-scoped process, exchange, flow, reference-flow, state_code, and source-evidence inventory',
    source_report: {
      path: sourceReportPath ? path.relative(repoRoot, sourceReportPath) : null,
      exists: sourceReportExists,
      copied_to_workspace: sourceReportExists ? 'input-freeze/local-compute-diagnostic-report.md' : null,
      privacy: 'local-only diagnostic evidence; do not copy private payloads into public reports',
    },
    configured_roots: Object.fromEntries(
      Object.entries(roots).map(([key, value]) => [key, { path: value, exists: Boolean(value && fs.existsSync(value)) }]),
    ),
    required_next_adapter: {
      capability: 'current-account process-exchange-flow export',
      preferred_owner: 'tiangong-lca-cli',
      foundry_role: 'orchestrate and preserve outputs, not implement hidden database business logic',
    },
  };
  writeJson(path.join(workspace, 'input-freeze/source-manifest.json'), sourceManifest);
  writeJson(path.join(workspace, 'inputs/source-manifest.json'), sourceManifest);
  if (sourceReportExists) {
    writeText(path.join(workspace, 'input-freeze/local-compute-diagnostic-report.md'), sourceReportText);
  }
  writeJson(path.join(workspace, 'input-freeze/input-freeze-status.json'), {
    generated_at_utc: nowIso(),
    status: sourceReportExists ? 'partial_from_local_diagnostic_report' : 'blocked',
    reason: sourceReportExists
      ? 'A local diagnostic report was frozen, but no live account dataset export was available.'
      : 'No input report or dataset export was available.',
    no_fabricated_dataset_snapshot: true,
    remote_write_performed: false,
  });

  const known = diagnostics?.known_findings ?? {};
  const snapshot = diagnostics?.snapshot ?? {};
  const missingReferenceRows = known.missing_reference?.rows ?? [];
  const serviceLoopRows = known.service_loop?.rows ?? [];
  const duplicateGroups = known.duplicate_exchange_structure?.groups ?? [];
  const stateCodeCounts = countBy(
    [...missingReferenceRows, ...serviceLoopRows].filter((row) => row.state_code !== null && row.state_code !== undefined),
    (row) => String(row.state_code),
  );
  const stateCodeInventory = {
    generated_at_utc: nowIso(),
    status: diagnostics ? 'partial_from_diagnostic_report' : 'blocked',
    current_account_scope: runtimeAccount.scope,
    account_context: runtimeAccount,
    counts_from_known_findings: Object.fromEntries(stateCodeCounts.map((item) => [item.key, item.count])),
    policy: {
      state_code_0: 'prefer update on the existing account-owned working record after evidence, mutation-plan, dry-run, and verification gates pass',
      state_code_100: 'do not overwrite; create source-review record and only propose repair with sufficient source evidence',
      unknown: 'stop at dry-run and create follow-up task',
    },
  };
  writeJson(path.join(workspace, 'audit/state-code-inventory.json'), stateCodeInventory);

  const processInventory = {
    generated_at_utc: nowIso(),
    status: diagnostics ? 'partial_from_diagnostic_report' : 'blocked',
    total_processes: snapshot.process_count ?? null,
    public_processes: snapshot.public_process_count ?? null,
    private_processes: snapshot.private_process_count ?? null,
    known_private_duplicate_exchange_groups: known.duplicate_exchange_structure?.private_group_count ?? duplicateGroups.length,
    known_private_duplicate_exchange_processes: known.duplicate_exchange_structure?.private_process_count ?? null,
    known_private_missing_reference_processes: known.missing_reference?.private_count ?? missingReferenceRows.length,
    known_private_service_loop_processes: known.service_loop?.private_count ?? serviceLoopRows.length,
    limitation: 'This is not a complete current-account process inventory; it is derived from the frozen local compute diagnostic report.',
  };
  const exchangeInventory = {
    generated_at_utc: nowIso(),
    status: 'blocked',
    total_exchanges: null,
    distinct_exchange_flows: null,
    duplicate_exchange_structure_groups_known: duplicateGroups.length,
    service_loop_rows_known: serviceLoopRows.length,
    required_next_step: 'Export all exchanges for the credential-scoped account and snapshot scope.',
  };
  const flowInventory = {
    generated_at_utc: nowIso(),
    status: 'blocked',
    distinct_flows: null,
    missing_or_duplicate_flows: null,
    required_next_step: 'Export referenced flows and provider process reference flows for the target matrix scope.',
  };
  const closureReport = {
    generated_at_utc: nowIso(),
    status: 'blocked_partial_known_findings',
    closure_policy_statuses: [
      'closed',
      'closed_by_existing_process',
      'closed_by_proxy',
      'missing_reference_process',
      'missing_flow',
      'ambiguous_flow_match',
      'unit_mismatch',
      'dimension_mismatch',
      'excluded_by_cutoff',
      'excluded_by_boundary',
      'manual_review_required',
    ],
    known_missing_reference_processes: missingReferenceRows.map((row) => ({
      process_id: row.process_id,
      version: row.version,
      state_code: row.state_code,
      process_name: row.process_name,
      status: 'missing_reference_process',
      note: 'Known from diagnostic report; full per-exchange flow closure still requires process/exchange/flow export.',
    })),
    unresolved_reason: 'The frozen diagnostic report does not contain every exchange flow and provider process reference flow needed for full closure.',
  };
  const unitDimensionIssues = {
    generated_at_utc: nowIso(),
    status: 'blocked',
    unresolved_unit_dimension_mismatches: null,
    required_next_step: 'Run closure checker over exported exchanges with flow property/unit metadata.',
  };
  const evidenceGapInventory = {
    generated_at_utc: nowIso(),
    status: 'open',
    numeric_repairs_verified: 0,
    unresolved_mean_value_evidence: null,
    known_service_loop_numeric_values_requiring_review: serviceLoopRows.length,
    evidence_priority: [
      'primary_source_documents',
      'official_statistics_or_technical_reports',
      'peer_reviewed_literature',
      'trusted_lca_database_or_public_dataset',
      'kb_record_with_source_trail',
      'transparent_engineering_estimate',
      'unresolved_placeholder',
    ],
    note: 'No meanValue repair is marked verified in this first run.',
  };
  writeJson(path.join(workspace, 'audit/process-inventory.json'), processInventory);
  writeJson(path.join(workspace, 'audit/exchange-inventory.json'), exchangeInventory);
  writeJson(path.join(workspace, 'audit/flow-inventory.json'), flowInventory);
  writeJson(path.join(workspace, 'audit/reference-flow-closure-report.json'), closureReport);
  writeJson(path.join(workspace, 'audit/unit-dimension-issues.json'), unitDimensionIssues);
  writeJson(path.join(workspace, 'audit/evidence-gap-inventory.json'), evidenceGapInventory);
  writeJson(path.join(workspace, 'outputs/audit-summary.json'), {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    process_inventory: processInventory,
    exchange_inventory: exchangeInventory,
    flow_inventory: flowInventory,
    state_code_inventory: stateCodeInventory,
  });

  const completenessSnapshot = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    status: 'blocked',
    reason: 'Full process-exchange-flow graph export and closure checker are required before matrix readiness can pass.',
    metrics: {
      total_processes: snapshot.process_count ?? null,
      total_exchanges: null,
      distinct_exchange_flows: null,
      exchange_flows_covered_by_reference_flow_process: null,
      missing_reference_flow_processes: known.missing_reference?.private_count ?? missingReferenceRows.length,
      ambiguous_flow_matches: null,
      missing_or_duplicate_flows: null,
      unresolved_mean_value_evidence: null,
      unresolved_unit_dimension_mismatches: null,
      state_code_0_records_updated_or_proposed: 0,
      state_code_100_records_requiring_source_review: null,
      known_duplicate_exchange_structure_groups: known.duplicate_exchange_structure?.private_group_count ?? duplicateGroups.length,
      known_service_loop_processes: known.service_loop?.private_count ?? serviceLoopRows.length,
    },
    matrix_readiness_status: 'blocked',
    compute_validation_status: 'not_run',
    blockers,
    generated_follow_up_tasks: [],
  };
  writeJson(path.join(workspace, 'audit/completeness-snapshot.json'), completenessSnapshot);
  writeJson(path.join(workspace, 'outputs/completeness-snapshot.json'), completenessSnapshot);

  const evidenceReview = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    source_records: [
      {
        source_id: 'local-compute-diagnostic-report',
        source_type: 'local_diagnostic_report',
        source_location: sourceReportExists ? path.relative(repoRoot, sourceReportPath) : null,
        confidence: sourceReportExists ? 'medium' : 'unavailable',
        reviewer_note: 'Useful as a diagnostic seed, not a substitute for freezing the live dataset.',
      },
    ],
    numeric_repairs: [],
    unresolved: [
      'No field-level numeric meanValue repair has source evidence in this first cycle.',
      'Service-loop amounts are only diagnostic findings until the process payload is exported and reviewed.',
    ],
  };
  writeJson(path.join(workspace, 'evidence/evidence-review.json'), evidenceReview);

  const repairCandidates = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    status: 'candidate_schema_only',
    remote_write_allowed: false,
    candidates: [
      {
        id: 'duplicate-exchange-structure-review',
        type: 'manual-review',
        affected_group_count: duplicateGroups.length,
        affected_process_count: known.duplicate_exchange_structure?.private_process_count ?? null,
        evidence_reference: 'input-freeze/local-compute-diagnostic-report.md#7.1',
        proposed_actions: ['merge_duplicate', 'differentiate_process', 'exclude_from_compute_scope', 'manual_owner_review'],
        mutation_ready: false,
      },
      {
        id: 'missing-quantitative-reference-repair',
        type: 'process-reference-repair',
        affected_process_count: missingReferenceRows.length,
        evidence_reference: 'input-freeze/local-compute-diagnostic-report.md#7.2',
        proposed_actions: ['repair_referenceToReferenceFlow', 'restore_missing_reference_exchange', 'manual_owner_review'],
        mutation_ready: false,
      },
      {
        id: 'service-loop-review',
        type: 'numeric-and-modeling-review',
        affected_row_count: serviceLoopRows.length,
        evidence_reference: 'input-freeze/local-compute-diagnostic-report.md#7.3',
        proposed_actions: ['fix_direction', 'fix_flow', 'fix_amount_with_evidence', 'split_process', 'document_modeling_rationale'],
        mutation_ready: false,
      },
      {
        id: 'full-reference-flow-closure-export',
        type: 'follow-up',
        affected_scope: 'all exchanges in target matrix',
        evidence_reference: 'audit/reference-flow-closure-report.json',
        proposed_actions: ['run_process_exchange_flow_export', 'run_reference_flow_closure_checker'],
        mutation_ready: false,
      },
    ],
  };
  writeJson(path.join(workspace, 'repair-candidates/repair-candidates.json'), repairCandidates);

  const mutationEntries = [
    ...missingReferenceRows.map((row) => ({
      record_type: 'process',
      record_id: row.process_id,
      version: row.version,
      account_or_dataset_scope: runtimeAccount.scope,
      account_context: runtimeAccount,
      current_state_code: row.state_code,
      proposed_mutation_type: row.state_code === 0 ? 'manual-review' : 'follow-up',
      preferred_write_if_approved: row.state_code === 0 ? 'update' : 'blocked_by_state_code_policy',
      fields_affected: [
        'processDataSet.processInformation.quantitativeReference.referenceToReferenceFlow',
        'processDataSet.exchanges.exchange',
      ],
      old_values: { diagnostic_issue: row.issue },
      new_values: null,
      evidence_references: ['input-freeze/local-compute-diagnostic-report.md#7.2'],
      reason: 'Process quantitative reference is missing or points to a missing exchange in the diagnostic report.',
      expected_impact_on_reference_closure: 'May make this process usable as a provider reference-flow process after payload validation.',
      risk_level: 'high',
      dry_run_status: 'not_run',
      remote_commit_allowed: false,
      gate_status: {
        evidence: 'blocked_pending_payload_and_source_review',
        mutation_policy: row.state_code === 0 ? 'update_first_after_approval' : 'blocked_or_follow_up',
        dry_run: 'blocked',
        verification: 'blocked',
      },
    })),
    ...serviceLoopRows.map((row) => ({
      record_type: 'process',
      record_id: row.process_id,
      version: row.version,
      account_or_dataset_scope: runtimeAccount.scope,
      account_context: runtimeAccount,
      current_state_code: row.state_code,
      proposed_mutation_type: 'manual-review',
      preferred_write_if_approved: row.state_code === 0 ? 'update' : 'blocked_by_state_code_policy',
      fields_affected: ['processDataSet.exchanges.exchange.meanAmount', 'processDataSet.exchanges.exchange.exchangeDirection'],
      old_values: {
        loop_flow_id: row.loop_flow_id,
        diagnostic_amount: row.amount,
      },
      new_values: null,
      evidence_references: ['input-freeze/local-compute-diagnostic-report.md#7.3'],
      reason: 'Same process contains same flow as input and output with same amount; requires source/modeling review.',
      expected_impact_on_reference_closure: 'May remove self-provider loops that contribute to singular matrix risk.',
      risk_level: 'high',
      dry_run_status: 'not_run',
      remote_commit_allowed: false,
      gate_status: {
        evidence: 'blocked_pending_payload_and_source_review',
        mutation_policy: row.state_code === 0 ? 'update_first_after_approval' : 'blocked_or_follow_up',
        dry_run: 'blocked',
        verification: 'blocked',
      },
    })),
    ...duplicateGroups.map((group) => ({
      record_type: 'process_group',
      record_id: group.process_ids[0] ?? `duplicate-group-${group.group}`,
      record_ids: group.process_ids,
      account_or_dataset_scope: runtimeAccount.scope,
      account_context: runtimeAccount,
      current_state_code: 0,
      proposed_mutation_type: 'manual-review',
      preferred_write_if_approved: 'update_or_skip_per_owner_decision',
      fields_affected: ['processDataSet.exchanges.exchange', 'process metadata', 'compute scope inclusion'],
      old_values: { duplicate_exchange_fingerprint_group: group.group },
      new_values: null,
      evidence_references: ['input-freeze/local-compute-diagnostic-report.md#7.1'],
      reason: 'Multiple processes have identical exchange structure and can create linearly dependent matrix columns.',
      expected_impact_on_reference_closure: 'May reduce singular matrix risk after owner-approved merge, differentiation, or exclusion.',
      risk_level: 'high',
      dry_run_status: 'not_run',
      remote_commit_allowed: false,
      gate_status: {
        evidence: 'blocked_pending_owner_review',
        mutation_policy: 'manual_review_required',
        dry_run: 'blocked',
        verification: 'blocked',
      },
    })),
  ];
  const mutationPlan = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    status: 'blocked_before_dry_run',
    remote_commit_allowed: false,
    policy: {
      require_mutation_plan: true,
      require_state_code_write_policy: true,
      prefer_update_for_state_code_0: true,
      require_insert_reason_for_versioned_write: true,
      state_code_100_requires_source_review: true,
      unknown_state_code_blocks_remote_write: true,
      dry_run_before_remote_write: true,
    },
    operation_counts: {
      update_candidates_after_review: mutationEntries.filter((entry) => entry.preferred_write_if_approved === 'update').length,
      manual_review: mutationEntries.filter((entry) => entry.proposed_mutation_type === 'manual-review').length,
      insert: 0,
      skip: 0,
      follow_up: mutationEntries.filter((entry) => entry.proposed_mutation_type === 'follow-up').length,
    },
    mutations: mutationEntries,
  };
  writeJson(path.join(workspace, 'mutation-plan/mutation-plan.json'), mutationPlan);
  writeJson(path.join(workspace, 'outputs/mutation-plan.json'), mutationPlan);

  const dryRunStatus = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    status: 'blocked',
    dry_run_executed: false,
    remote_write_performed: false,
    reason: 'No approved repair payloads exist and the mutation plan is blocked before dry-run.',
    required_next_command: 'After inventory and repair candidates exist: tiangong process save-draft --input-file <jsonl> --dry-run --out-dir <out-dir>',
  };
  writeJson(path.join(workspace, 'dry-run/dry-run-status.json'), dryRunStatus);

  const verificationStatus = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    status: 'blocked',
    matrix_readiness_verified: false,
    compute_validation_executed: false,
    reason: 'No repaired dataset snapshot was produced, so factorization readiness and solve_all_unit were not run.',
    required_next_command: 'Run matrix readiness verifier after dry-run passes and any approved repair is committed.',
  };
  writeJson(path.join(workspace, 'verification/verification-status.json'), verificationStatus);

  const followUpRecords = makeAccountRepairFollowUps({ task, workspace, blockers });
  completenessSnapshot.generated_follow_up_tasks = followUpRecords.map((record) => record.id);
  writeJson(path.join(workspace, 'audit/completeness-snapshot.json'), completenessSnapshot);
  writeJson(path.join(workspace, 'outputs/completeness-snapshot.json'), completenessSnapshot);

  const reportRows = [
    { metric: 'total processes', value: completenessSnapshot.metrics.total_processes ?? 'unknown' },
    { metric: 'missing reference processes known', value: completenessSnapshot.metrics.missing_reference_flow_processes },
    { metric: 'duplicate exchange groups known', value: completenessSnapshot.metrics.known_duplicate_exchange_structure_groups },
    { metric: 'service-loop processes known', value: completenessSnapshot.metrics.known_service_loop_processes },
    { metric: 'mutation entries', value: mutationEntries.length },
    { metric: 'dry-run', value: dryRunStatus.status },
    { metric: 'matrix readiness', value: completenessSnapshot.matrix_readiness_status },
    { metric: 'compute validation', value: completenessSnapshot.compute_validation_status },
  ];
  const report = `# ${task.meta.id} first repair cycle

- generated at: ${nowIso()}
- task: ${task.meta.id} / ${task.meta.title}
- source report frozen: ${sourceReportExists ? 'yes' : 'no'}
- remote write performed: no
- verdict: blocked

## Completeness Snapshot

${buildMarkdownTable(reportRows, ['metric', 'value'])}

## What Ran

- Input freeze from local diagnostic report: ${sourceReportExists ? 'partial' : 'blocked'}.
- Audit artifact stubs: process inventory, exchange inventory, flow inventory, state_code inventory, evidence gaps, and reference-flow closure report.
- Repair candidates: generated as review candidates only.
- Mutation plan: generated with state_code-aware gates; no row is ready for remote commit.
- Dry-run: not executed; blocked before payload generation.
- Verification: not executed; no matrix readiness or compute validation run.

## Blockers

${blockers.map((blocker) => `- ${blocker}`).join('\n')}

## Next Command

\`\`\`bash
npm run orchestrator:rerun-review -- --task-id ${task.meta.id}
\`\`\`

Run that only after the process-exchange-flow export and closure checker follow-ups have produced inputs for this task workspace.
`;
  const reportPath = path.join(workspace, 'reports/first-cycle-report.md');
  writeText(reportPath, report);
  writeText(path.join(workspace, 'reports/completeness-snapshot.md'), report);

  const result = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    classification: 'account-repair',
    source: sourceReportExists ? 'local compute diagnostic report' : 'none',
    summary: {
      total_processes: completenessSnapshot.metrics.total_processes,
      missing_reference_count: completenessSnapshot.metrics.missing_reference_flow_processes,
      duplicate_exchange_group_count: completenessSnapshot.metrics.known_duplicate_exchange_structure_groups,
      service_loop_count: completenessSnapshot.metrics.known_service_loop_processes,
      mutation_entry_count: mutationEntries.length,
      follow_up_task_count: followUpRecords.length,
    },
    completeness_snapshot: completenessSnapshot,
    gates: {
      input_freeze: { ok: sourceReportExists, status: sourceReportExists ? 'partial' : 'blocked' },
      full_audit: { ok: false, status: 'blocked_missing_dataset_export' },
      reference_flow_closure: { ok: false, status: 'blocked_missing_per_exchange_closure' },
      evidence_numeric: { ok: false, status: 'blocked_no_verified_numeric_repairs' },
      mutation_plan: { ok: true, status: 'blocked_before_dry_run' },
      dry_run: { ok: false, status: 'not_run' },
      verification: { ok: false, status: 'not_run' },
    },
    verdict: 'blocked',
    next_queue: 'review',
    next_state: 'Blocked',
    report_path: path.relative(repoRoot, reportPath),
  };
  writeJson(path.join(workspace, 'outputs/task-result.json'), result);
  return result;
}

function runElectricityCategoryUpdate(task, workspace) {
  const category = task.meta.category;
  const lcaRoot = envPath('LCA_DATA_AGENT_ROOT') || inferLcaDataAgentRoot();
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
    source: 'LCA-DATA-AGENT legacy private electricity_system seed work package',
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
  const routePlan = writeCapabilityRoutePlan(
    buildCapabilityRoutePlan({ taskObject: task }),
    path.join(workspace, 'routing'),
  );
  const result = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    classification: task.meta.kind,
    verdict: routePlan.status === 'no_route' ? 'unsupported' : 'routed',
    next_queue: 'review',
    next_state: 'Blocked',
    reason: `No executable handler is implemented for kind=${task.meta.kind} category=${task.meta.category ?? ''}; a generic capability route plan was generated.`,
    route_plan: routePlan.files?.capability_route_plan ?? null,
    selected_capability_count: routePlan.counts.selected_capabilities,
    missing_capability_count: routePlan.counts.missing_capabilities,
  };
  writeJson(path.join(workspace, 'outputs/task-result.json'), result);
  writeText(
    path.join(workspace, 'reports/unsupported-task.md'),
    `# Unsupported Task\n\n${result.reason}\n\nRoute plan: \`${result.route_plan ?? 'not written'}\`\n`,
  );
  return result;
}

function runCapabilityRoutedTask(task, workspace) {
  const routePlan = writeCapabilityRoutePlan(
    buildCapabilityRoutePlan({ taskObject: task }),
    path.join(workspace, 'routing'),
  );
  const hasMissingCapabilities = routePlan.counts.missing_capabilities > 0;
  const result = {
    generated_at_utc: nowIso(),
    task_id: task.meta.id,
    classification: task.meta.kind,
    verdict: routePlan.status,
    next_queue: 'review',
    next_state: hasMissingCapabilities ? 'Blocked' : 'ReviewReady',
    reason: hasMissingCapabilities
      ? 'Capability route plan has missing classes; create capability-development follow-ups before adapter execution.'
      : 'Capability route plan is ready; run selected adapters into their planned output directories and collect gate artifacts.',
    route_plan: routePlan.files?.capability_route_plan ?? null,
    selected_capability_count: routePlan.counts.selected_capabilities,
    missing_capability_count: routePlan.counts.missing_capabilities,
  };
  writeJson(path.join(workspace, 'outputs/task-result.json'), result);
  writeText(
    path.join(workspace, 'reports/capability-routed-task.md'),
    `# Capability Routed Task\n\n${result.reason}\n\nRoute plan: \`${result.route_plan ?? 'not written'}\`\n`,
  );
  return result;
}

function runTask(task) {
  const workspace = ensureWorkspace(task);
  appendTaskLog(workspace, 'task.start', { task_id: task.meta.id, kind: task.meta.kind, category: task.meta.category });
  renderTaskPrompt(task, workspace);
  let result;
  if (
    task.meta.kind === 'external-dataset-curated-import' ||
    task.meta.kind === 'source-evidence-dataset-development'
  ) {
    result = runCapabilityRoutedTask(task, workspace);
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
    matrix_readiness_status: result.completeness_snapshot?.matrix_readiness_status,
    compute_validation_status: result.completeness_snapshot?.compute_validation_status,
    blocker_count: result.completeness_snapshot?.blockers?.length,
    follow_up_task_count: result.summary?.follow_up_task_count,
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
} else if (command === 'storage-check') {
  storageCheck();
} else if (command === 'artifact-contract-check') {
  artifactContractCheck({ contractPath: options.contract });
} else if (command === 'acceptance-check') {
  acceptanceCheck();
} else if (command === 'status') {
  status();
} else if (command === 'env-check') {
  envCheck();
} else if (command === 'workspace-map') {
  workspaceMap();
} else if (command === 'capabilities-list') {
  console.log(JSON.stringify(capabilitiesList(options), null, 2));
} else if (command === 'route-task') {
  const result = runCapabilityRoute(options);
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'post-write-verify') {
  const result = await runPostWriteVerification(options);
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'orchestrate') {
  orchestrate(options).catch((error) => {
    writeStatus({ state: 'failed', error: error.message, queue_counts: queueCounts() });
    releaseLock();
    console.error(error.stack || error.message);
    process.exit(1);
  });
} else {
  console.log('Usage: node scripts/foundry.mjs init|doctor|workflow-check|workspace-map|capabilities-list|route-task|tasks-list|tasks-check|storage-check|artifact-contract-check|acceptance-check|status|env-check|post-write-verify|orchestrate [--once] [--task-id ID] [--include-review] [--interval-ms N] [--max-tasks N]');
  process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
}
