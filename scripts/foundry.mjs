#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, 'WORKFLOW.md');
const taskDirs = ['tasks/inbox', 'tasks/active', 'tasks/review', 'tasks/done'];
const foundryDirs = ['.foundry/logs', '.foundry/workspaces', '.foundry/state'];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
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

function workflowCheck() {
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
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

function listTaskFiles() {
  const files = [];
  for (const dir of taskDirs) {
    const absDir = path.join(repoRoot, dir);
    if (!fs.existsSync(absDir)) {
      continue;
    }
    for (const name of fs.readdirSync(absDir).sort()) {
      if (name.endsWith('.md')) {
        files.push(path.join(absDir, name));
      }
    }
  }
  return files;
}

function readTasks() {
  return listTaskFiles().map((filePath) => {
    const text = readText(filePath);
    const { frontmatter, body } = splitFrontmatter(text);
    return {
      path: path.relative(repoRoot, filePath),
      meta: parseFlatFrontmatter(frontmatter),
      body_preview: body.trim().split(/\r?\n/u).slice(0, 5).join('\n'),
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
  }
  const result = { task_count: tasks.length, errors, ok: errors.length === 0 };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

function initRuntime() {
  for (const dir of [...taskDirs, ...foundryDirs]) {
    fs.mkdirSync(path.join(repoRoot, dir), { recursive: true });
  }
  console.log(JSON.stringify({
    repo_root: repoRoot,
    created_or_verified: [...taskDirs, ...foundryDirs],
  }, null, 2));
}

function doctor() {
  const result = {
    repo_root: repoRoot,
    node: process.version,
    workflow_exists: fs.existsSync(workflowPath),
    task_dirs: Object.fromEntries(taskDirs.map((dir) => [dir, fs.existsSync(path.join(repoRoot, dir))])),
    foundry_dirs: Object.fromEntries(foundryDirs.map((dir) => [dir, fs.existsSync(path.join(repoRoot, dir))])),
  };
  console.log(JSON.stringify(result, null, 2));
}

const command = process.argv[2] ?? 'help';
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
} else {
  console.log('Usage: node scripts/foundry.mjs init|doctor|workflow-check|tasks-list|tasks-check');
  process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
}
