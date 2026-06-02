#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  listImportProfiles,
  runDatasetCurationCleanup,
  runDatasetCurationGate,
} from './lib/import-curation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, 'WORKFLOW.md');
const capabilityRegistryPath = 'specs/automated-lca-capability-registry.json';
const taskQueues = {
  inbox: 'tasks/inbox',
  active: 'tasks/active',
  done: 'tasks/done',
};
const runtimeDirs = [
  '.foundry/logs',
  '.foundry/state',
  '.foundry/workspaces',
  ...Object.values(taskQueues),
];

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
  'TIANGONG_LCA_CLI_BIN',
  'TIANGONG_LCA_CLI_DIR',
  'TIANGONG_LCA_SKILLS_ROOT',
]);
const envExampleAllowedPrefixes = ['FOUNDRY_'];
const envExampleForbiddenKeys = new Map([
  ['TIANGONG_LCA_COVERAGE', 'CLI test-only toggle; keep it in tiangong-lca-cli.'],
  ['TIANGONG_LCA_TIDAS_SDK_DIR', 'CLI development override; Foundry should use CLI contract-pack outputs.'],
  ['SUPABASE_URL', 'Legacy generic Supabase env; use TIANGONG_LCA_API_* instead.'],
  ['SUPABASE_KEY', 'Legacy generic Supabase env; use TIANGONG_LCA_API_* instead.'],
  ['GITHUB_TOKEN', 'Tracker or GitHub credentials do not belong in the public env example.'],
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

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function directoryExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory());
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function repoRelativePath(filePath) {
  return path.relative(repoRoot, filePath);
}

function parseScalar(value) {
  const text = String(value ?? '').trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/u.test(text)) return Number(text);
  return text.replace(/^["']|["']$/gu, '');
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
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined && value && !String(value).startsWith('--')) {
      index += 1;
    }
    const parsed = inlineValue !== undefined || (value && !String(value).startsWith('--'))
      ? parseScalar(value)
      : true;
    if (Object.hasOwn(options, key)) {
      options[key] = Array.isArray(options[key]) ? [...options[key], parsed] : [options[key], parsed];
    } else {
      options[key] = parsed;
    }
  }
  return options;
}

function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { frontmatter: '', body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('Missing closing frontmatter marker.');
  return {
    frontmatter: text.slice(4, end),
    body: text.slice(end + 5),
  };
}

function isPlaceholderEnvValue(value) {
  const normalized = String(value ?? '').trim();
  return normalized === '' || normalized === 'REPLACE_ME';
}

function loadEnvFile(filePath, { override = false } = {}) {
  if (!filePath || !fs.existsSync(filePath)) return { file: filePath, loaded: false, keys: [] };
  const keys = [];
  for (const rawLine of readText(filePath).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.replace(/^export\s+/u, '').match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    const key = match[1];
    const value = String(match[2] ?? '').trim().replace(/^["']|["']$/gu, '');
    if (override || process.env[key] === undefined || isPlaceholderEnvValue(process.env[key])) {
      process.env[key] = value;
    }
    keys.push(key);
  }
  return { file: filePath, loaded: true, keys };
}

function loadRuntimeEnv() {
  const repoEnv = loadEnvFile(path.join(repoRoot, '.env'));
  return { repoEnv };
}

function hasUsableEnvValue(key) {
  return process.env[key] !== undefined && !isPlaceholderEnvValue(process.env[key]);
}

function envExampleKeyAllowed(key) {
  return envExampleAllowedKeys.has(key) || envExampleAllowedPrefixes.some((prefix) => key.startsWith(prefix));
}

function parseEnvAssignments(filePath) {
  if (!fileExists(filePath)) return [];
  return readText(filePath)
    .split(/\r?\n/u)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(({ raw }) => raw && !raw.startsWith('#'))
    .map(({ raw, line }) => ({ line, match: raw.replace(/^export\s+/u, '').match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u) }))
    .filter(({ match }) => match)
    .map(({ line, match }) => ({ line, key: match[1], value: match[2] ?? '' }));
}

function envExampleSurfaceCheck() {
  const envExamplePath = path.join(repoRoot, '.env.example');
  const errors = [];
  const warnings = [];
  const seen = new Map();
  if (!fileExists(envExamplePath)) {
    errors.push('.env.example is missing.');
  }
  for (const row of parseEnvAssignments(envExamplePath)) {
    if (seen.has(row.key)) {
      errors.push(`.env.example:${row.line}: duplicate variable ${row.key}; first declared on line ${seen.get(row.key)}.`);
    }
    seen.set(row.key, row.line);
    if (envExampleForbiddenKeys.has(row.key)) {
      errors.push(`.env.example:${row.line}: ${row.key} is forbidden. ${envExampleForbiddenKeys.get(row.key)}`);
    } else if (!envExampleKeyAllowed(row.key)) {
      errors.push(`.env.example:${row.line}: ${row.key} is not in the Foundry env surface allowlist.`);
    }
    const secretLike = /(?:API_KEY|TOKEN|PASSWORD|SECRET|JWT)$/u.test(row.key);
    const allowedPublicKey = row.key === 'TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY';
    if (secretLike && !allowedPublicKey && !isPlaceholderEnvValue(row.value)) {
      errors.push(`.env.example:${row.line}: ${row.key} looks secret-bearing and must not contain an example value.`);
    }
  }
  return {
    file: '.env.example',
    variable_count: parseEnvAssignments(envExamplePath).length,
    allowed_prefixes: envExampleAllowedPrefixes,
    forbidden_keys: [...envExampleForbiddenKeys.keys()],
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function initRuntime() {
  for (const dir of runtimeDirs) fs.mkdirSync(path.join(repoRoot, dir), { recursive: true });
  return { repo_root: repoRoot, created_or_verified: runtimeDirs };
}

function workflowCheck() {
  const text = readText(workflowPath);
  const { frontmatter, body } = splitFrontmatter(text);
  const missing = ['tracker:', 'workspace:', 'policy:'].filter((fragment) => !frontmatter.includes(fragment));
  return {
    workflow: 'WORKFLOW.md',
    has_frontmatter: Boolean(frontmatter),
    has_prompt_body: body.trim().length > 0,
    missing_required_fragments: missing,
    ok: missing.length === 0 && body.trim().length > 0,
  };
}

function storageCheck() {
  const registryPath = path.join(repoRoot, 'docs/file-location-registry.json');
  const allowedRootMarkdown = new Set(['AGENTS.md', 'README.md', 'WORKFLOW.md']);
  const errors = [];
  const warnings = [];
  const registry = fileExists(registryPath) ? readJson(registryPath) : null;
  if (!registry) errors.push('docs/file-location-registry.json is missing or invalid.');
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry?.id) {
      errors.push('file-location registry entry is missing id');
      continue;
    }
    if (ids.has(entry.id)) errors.push(`duplicate file-location registry id: ${entry.id}`);
    ids.add(entry.id);
    if (entry.status !== 'retired' && !fileExists(resolveRepoPath(entry.current_path))) {
      errors.push(`${entry.id}: current_path does not exist: ${entry.current_path}`);
    }
    for (const ref of entry.referenced_by ?? []) {
      if (!fileExists(resolveRepoPath(ref))) warnings.push(`${entry.id}: referenced_by path does not exist: ${ref}`);
    }
  }
  for (const name of fs.readdirSync(repoRoot).sort()) {
    if (name.endsWith('.md') && !allowedRootMarkdown.has(name)) {
      errors.push(`root markdown file is not an allowed entrypoint: ${name}`);
    }
  }
  return {
    registry: 'docs/file-location-registry.json',
    entry_count: entries.length,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function acceptanceCheck() {
  const workflow = workflowCheck();
  const storage = storageCheck();
  const envSurface = envExampleSurfaceCheck();
  const checks = [
    { name: 'workflow', ok: workflow.ok, report: workflow },
    { name: 'storage', ok: storage.ok, report: storage },
    { name: 'env_example_surface', ok: envSurface.ok, report: envSurface },
  ];
  const result = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status: checks.every((check) => check.ok) ? 'passed' : 'failed',
    checks,
  };
  writeJson(path.join(repoRoot, '.foundry/state/acceptance/latest.json'), result);
  return result;
}

function doctor() {
  return {
    repo_root: repoRoot,
    node: process.version,
    workflow_check: workflowCheck(),
    storage_check: storageCheck(),
    env_example_surface: envExampleSurfaceCheck(),
    runtime_dirs: Object.fromEntries(runtimeDirs.map((dir) => [dir, fs.existsSync(path.join(repoRoot, dir))])),
    import_profiles: listImportProfiles({ repoRoot }),
  };
}

function envCheck() {
  const requiredForRemoteWrites = [
    'TIANGONG_LCA_API_BASE_URL',
    'TIANGONG_LCA_API_KEY',
    'TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY',
  ];
  return {
    generated_at_utc: nowIso(),
    repo_env_exists: fileExists(path.join(repoRoot, '.env')),
    env_example_surface: envExampleSurfaceCheck(),
    dry_run_allowed: true,
    remote_write_policy: {
      enabled: process.env.FOUNDRY_ENABLE_REMOTE_COMMIT === 'true',
      single_record: process.env.FOUNDRY_SINGLE_RECORD_COMMIT === 'true',
      limit: Number(process.env.FOUNDRY_REMOTE_COMMIT_LIMIT ?? 1),
    },
    required_remote_env: Object.fromEntries(requiredForRemoteWrites.map((key) => [key, hasUsableEnvValue(key)])),
  };
}

function workspaceRoot() {
  const configured = process.env.FOUNDRY_LCA_WORKSPACE_ROOT;
  if (configured) return configured;
  const parent = path.dirname(repoRoot);
  return fs.existsSync(path.join(parent, '.gitmodules')) ? parent : repoRoot;
}

function workspaceMap() {
  const root = workspaceRoot();
  const candidates = {
    cli: path.join(root, 'tiangong-lca-cli'),
    skills: path.join(root, 'tiangong-lca-skills'),
    'tidas-sdk': path.join(root, 'tidas-sdk'),
    'tidas-tools': path.join(root, 'tidas-tools'),
    foundry: repoRoot,
  };
  return {
    generated_at_utc: nowIso(),
    repo_root: repoRoot,
    workspace_root: root,
    projects: Object.fromEntries(
      Object.entries(candidates).map(([name, projectPath]) => [name, {
        path: projectPath,
        exists: fs.existsSync(projectPath),
      }]),
    ),
    import_lanes: ['external-dataset-curated-import', 'source-evidence-dataset-development'],
  };
}

function readCapabilityRegistry() {
  return readJson(path.join(repoRoot, capabilityRegistryPath));
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizedList(value) {
  return ensureArray(value)
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function appendOption(args, flag, value) {
  if (value === undefined || value === null || value === false || value === '') return;
  args.push(flag, String(value));
}

function appendRepeatedOptions(args, flag, values) {
  for (const value of normalizedList(values)) {
    appendOption(args, flag, value);
  }
}

function runDatasetCurationQueueBuild(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: 'help',
      command: 'dataset-curation-queue-build',
      wraps: 'tiangong-lca dataset curation-queue build',
      usage: [
        'node scripts/foundry.mjs dataset-curation-queue-build --processes <processes.jsonl> --out-dir <queue-dir>',
        'npm run dataset:curation-queue:build -- --processes ./rows/processes.jsonl --flows ./rows/flows.jsonl --support ./rows/sources.jsonl --out-dir ./curation-queue',
      ],
      foundry_wrapper: {
        exit_code: 0,
        owner: 'tiangong-lca-cli',
      },
    };
  }
  const processes = options.processes || options.processesFile || options.processRows;
  const outDir = options.outDir || '.foundry/workspaces/dataset-curation-queue';
  const cliArgs = ['dataset', 'curation-queue', 'build', '--json'];
  appendOption(cliArgs, '--processes', processes);
  appendOption(cliArgs, '--flows', options.flows || options.flowsFile || options.flowRows);
  appendRepeatedOptions(cliArgs, '--support', options.support || options.supportFile || options.supportRows);
  appendRepeatedOptions(
    cliArgs,
    '--external-flow-ref',
    options.externalFlowRef || options.externalFlowRefs,
  );
  appendRepeatedOptions(
    cliArgs,
    '--exclude-process-id',
    options.excludeProcessId || options.excludeProcessIds,
  );
  appendOption(cliArgs, '--process-limit', options.processLimit);
  appendOption(cliArgs, '--out-dir', outDir);

  const cliBin = process.env.TIANGONG_LCA_CLI_BIN || 'tiangong-lca';
  const result = spawnSync(cliBin, cliArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  let report;
  try {
    report = JSON.parse(result.stdout || '{}');
  } catch {
    throw new Error(
      [
        'tiangong-lca dataset curation-queue build did not emit JSON.',
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (result.error) {
    throw result.error;
  }
  return {
    ...report,
    foundry_wrapper: {
      command: cliBin,
      args: cliArgs,
      exit_code: exitCode,
      stderr: result.stderr || '',
      owner: 'tiangong-lca-cli',
    },
  };
}

const taskKindRoutes = {
  'external-dataset-curated-import': [
    'tidas-contract-context',
    'external-lca-package-conversion',
    'schema-gate',
    'qa',
    'dataset-curation',
    'reference-closure',
    'publish-prep',
    'remote-verification',
  ],
  'source-evidence-dataset-development': [
    'tidas-contract-context',
    'source-document-authoring',
    'source-evidence-review',
    'schema-gate',
    'qa',
    'dataset-curation',
    'reference-closure',
    'publish-prep',
  ],
};

const gateRoutes = {
  context: ['tidas-contract-context'],
  contract: ['tidas-contract-context'],
  conversion: ['external-lca-package-conversion'],
  import: ['external-lca-package-conversion'],
  source: ['source-document-authoring', 'source-evidence-review'],
  schema: ['schema-gate'],
  qa: ['qa'],
  curation: ['dataset-curation'],
  reference: ['reference-closure'],
  'reference-closure': ['reference-closure'],
  publish: ['publish-prep'],
  remote: ['remote-verification'],
  verification: ['remote-verification'],
};

function qaClassForType(datasetType) {
  if (datasetType === 'process') return 'process-qa';
  if (datasetType === 'flow') return 'flow-qa';
  if (datasetType === 'lifecyclemodel') return 'lifecyclemodel-qa';
  return 'qa';
}

function expandRouteClass(className, datasetType) {
  return className === 'qa' ? [qaClassForType(datasetType)] : [className];
}

function capabilityMatchesDatasetType(capability, datasetType) {
  if (!datasetType || datasetType === 'all') return true;
  const id = String(capability.id ?? '');
  if (datasetType === 'process') return !id.startsWith('cli.flow.') && !id.startsWith('cli.lifecyclemodel.');
  if (datasetType === 'flow') return !id.startsWith('cli.process.') && !id.startsWith('cli.lifecyclemodel.');
  if (datasetType === 'lifecyclemodel') return !id.startsWith('cli.process.') && !id.startsWith('cli.flow.');
  return true;
}

function buildRoutePlan(options = {}) {
  const registry = readCapabilityRegistry();
  const kind = String(options.kind || options.taskKind || 'external-dataset-curated-import');
  const datasetType = String(options.datasetType || options.type || 'all').trim().toLowerCase();
  const requiredGateClasses = normalizedList(options.requiredGates)
    .flatMap((gate) => gateRoutes[gate] ?? [gate])
    .flatMap((className) => expandRouteClass(className, datasetType));
  const defaultClasses = (taskKindRoutes[kind] ?? [])
    .flatMap((className) => expandRouteClass(className, datasetType));
  const requestedClasses = normalizedList(options.classes || options.capabilityClasses)
    .flatMap((className) => expandRouteClass(className, datasetType));
  const requiredClasses = unique([...defaultClasses, ...requiredGateClasses, ...requestedClasses]);
  const capabilities = ensureArray(registry.capabilities)
    .filter((capability) => requiredClasses.includes(capability.class))
    .filter((capability) => capabilityMatchesDatasetType(capability, datasetType));
  const byClass = new Map();
  for (const capability of capabilities) {
    if (!byClass.has(capability.class)) byClass.set(capability.class, []);
    byClass.get(capability.class).push(capability);
  }
  const routes = requiredClasses.map((className) => ({
    class: className,
    status: (byClass.get(className) ?? []).length > 0 ? 'routed' : 'missing_capability',
    capability_ids: (byClass.get(className) ?? []).map((capability) => capability.id),
    owner_projects: unique((byClass.get(className) ?? []).map((capability) => capability.owner_project)),
  }));
  const missing = routes.filter((route) => route.status === 'missing_capability');
  return {
    schema_version: 2,
    generated_at_utc: nowIso(),
    task: {
      id: String(options.taskId || options.id || `route-${kind}`),
      kind,
      dataset_type: datasetType,
      required_gates: normalizedList(options.requiredGates),
    },
    status: missing.length > 0 ? 'missing_capabilities' : 'routed',
    capability_registry: capabilityRegistryPath,
    required_classes: requiredClasses,
    routes,
    selected_capabilities: capabilities,
    missing_capabilities: missing,
    next_action: missing.length > 0
      ? 'Create or route missing reusable capabilities in the owning project.'
      : 'Run the selected adapters and store their outputs in the task workspace.',
  };
}

function writeRoutePlan(plan, outDir) {
  if (!outDir) return plan;
  const resolvedOutDir = resolveRepoPath(outDir);
  writeJson(path.join(resolvedOutDir, 'capability-route-plan.json'), plan);
  return {
    ...plan,
    files: {
      capability_route_plan: repoRelativePath(path.join(resolvedOutDir, 'capability-route-plan.json')),
    },
  };
}

function capabilitiesList(options = {}) {
  const registry = readCapabilityRegistry();
  const classFilter = options.class ? String(options.class) : null;
  const ownerFilter = options.owner ? String(options.owner) : null;
  const capabilities = ensureArray(registry.capabilities)
    .filter((capability) => !classFilter || capability.class === classFilter)
    .filter((capability) => !ownerFilter || capability.owner_project === ownerFilter);
  return {
    schema_version: registry.schema_version ?? 1,
    generated_at_utc: nowIso(),
    registry: capabilityRegistryPath,
    capability_count: capabilities.length,
    capabilities,
  };
}

function listTaskFiles(queue = null) {
  const queueEntries = queue ? [[queue, taskQueues[queue]]] : Object.entries(taskQueues);
  const files = [];
  for (const [queueName, dir] of queueEntries) {
    const absDir = path.join(repoRoot, dir);
    if (!directoryExists(absDir)) continue;
    for (const name of fs.readdirSync(absDir).sort()) {
      if (name.endsWith('.md')) files.push({ queue: queueName, path: path.join(absDir, name) });
    }
  }
  return files;
}

function taskSummary(file) {
  const text = readText(file.path);
  const { frontmatter, body } = splitFrontmatter(text);
  const meta = {};
  for (const line of frontmatter.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/u);
    if (match) meta[match[1]] = parseScalar(match[2]);
  }
  return {
    queue: file.queue,
    path: repoRelativePath(file.path),
    meta,
    body_preview: body.trim().split(/\r?\n/u).slice(0, 4).join('\n'),
  };
}

function tasksList() {
  return listTaskFiles().map(taskSummary);
}

function tasksCheck() {
  const errors = [];
  const ids = new Set();
  for (const task of tasksList()) {
    for (const key of ['id', 'title', 'state', 'kind']) {
      if (!task.meta[key]) errors.push(`${task.path}: missing ${key}`);
    }
    if (task.meta.id) {
      if (ids.has(task.meta.id)) errors.push(`${task.path}: duplicate id ${task.meta.id}`);
      ids.add(task.meta.id);
    }
  }
  return { task_count: tasksList().length, errors, ok: errors.length === 0 };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function usage() {
  return {
    commands: [
      'init',
      'doctor',
      'env-check',
      'workflow-check',
      'storage-check',
      'acceptance-check',
      'workspace-map',
      'capabilities-list',
      'profiles-list',
      'route-task',
      'tasks-list',
      'tasks-check',
      'dataset-curation-queue-build',
      'dataset-curation-gate',
      'dataset-curation-cleanup',
    ],
  };
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  let result;
  let exitCode = 0;
  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      result = usage();
      break;
    case 'init':
      result = initRuntime();
      break;
    case 'doctor':
      result = doctor();
      exitCode = result.workflow_check.ok && result.storage_check.ok && result.env_example_surface.ok ? 0 : 1;
      break;
    case 'env-check':
      result = envCheck();
      exitCode = result.env_example_surface.ok ? 0 : 1;
      break;
    case 'workflow-check':
      result = workflowCheck();
      exitCode = result.ok ? 0 : 1;
      break;
    case 'storage-check':
      result = storageCheck();
      exitCode = result.ok ? 0 : 1;
      break;
    case 'acceptance-check':
      result = acceptanceCheck();
      exitCode = result.status === 'passed' ? 0 : 1;
      break;
    case 'workspace-map':
      result = workspaceMap();
      break;
    case 'capabilities-list':
      result = capabilitiesList(options);
      break;
    case 'profiles-list':
      result = listImportProfiles({ repoRoot, options });
      break;
    case 'route-task':
      result = writeRoutePlan(buildRoutePlan(options), options.outDir);
      exitCode = result.status === 'missing_capabilities' ? 1 : 0;
      break;
    case 'tasks-list':
      result = tasksList();
      break;
    case 'tasks-check':
      result = tasksCheck();
      exitCode = result.ok ? 0 : 1;
      break;
    case 'dataset-curation-queue-build':
      result = runDatasetCurationQueueBuild(options);
      exitCode = result.foundry_wrapper.exit_code;
      break;
    case 'dataset-curation-gate':
      result = runDatasetCurationGate({ repoRoot, options });
      exitCode = ['help', 'ready', 'ready_with_profile_waivers'].includes(result.status) ? 0 : 1;
      break;
    case 'dataset-curation-cleanup':
      result = runDatasetCurationCleanup({ repoRoot, options });
      break;
    default:
      console.error(`Unknown Foundry command: ${command}`);
      console.error(`Known commands: ${usage().commands.join(', ')}`);
      process.exit(2);
  }
  printJson(result);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
