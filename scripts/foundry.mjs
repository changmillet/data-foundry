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
const automatedLcaCapabilityRegistryPath = 'specs/automated-lca-capability-registry.json';
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
  const contractRelPath = contractPath || 'specs/acceptance/lca-compute-repair-20260510.artifacts.json';
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
    },
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
  } else if (task.meta.kind === 'account-repair' || task.meta.category === 'lca-compute-matrix-readiness') {
    result = runAccountComputeRepair(task, workspace);
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
} else if (command === 'compute-repair-probe') {
  const result = computeRepairProbe({ taskId: options.taskId || computeRepairTaskId });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'sample-scenarios-dry-run') {
  const result = runSampleScenariosDryRun(options);
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'orchestrate') {
  orchestrate(options).catch((error) => {
    writeStatus({ state: 'failed', error: error.message, queue_counts: queueCounts() });
    releaseLock();
    console.error(error.stack || error.message);
    process.exit(1);
  });
} else {
  console.log('Usage: node scripts/foundry.mjs init|doctor|workflow-check|workspace-map|tasks-list|tasks-check|storage-check|artifact-contract-check|acceptance-check|status|env-check|compute-repair-probe|sample-scenarios-dry-run|orchestrate [--once] [--task-id ID] [--include-review] [--interval-ms N] [--max-tasks N]');
  process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
}
