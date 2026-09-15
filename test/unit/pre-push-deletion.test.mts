import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helperPath = "scripts/pre-push-deletion-only.sh";
const zero = "0".repeat(40);
const oid = "1".repeat(40);
const deletion = "(delete) " + zero + " refs/heads/old " + oid + "\n";
const update = "refs/heads/main " + oid + " refs/heads/main " + "2".repeat(40) + "\n";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-pre-push-"));
  const repo = path.join(root, "repo with space");
  const home = path.join(root, "home");
  const trace = path.join(root, "trace");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_|^PATH$|^NVM_/iu.test(key)),
  );
  const originalPath = process.env.PATH ?? process.env.Path ?? "";
  Object.assign(env, {
    HOME: home,
    PATH: path.join(root, "bin") + path.delimiter + originalPath,
    FOUNDRY_HOOK_TEST_TRACE: trace,
    FOUNDRY_HOOK_TEST_GATE_EXIT: "0",
  });
  const write = (relative: string, content: string) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: 0o755 });
  };
  write(
    "repo with space/.husky/pre-push",
    fs.readFileSync(path.join(source, ".husky/pre-push"), "utf8"),
  );
  if (fs.existsSync(path.join(source, helperPath))) {
    write("repo with space/" + helperPath, fs.readFileSync(path.join(source, helperPath), "utf8"));
  }
  write(
    "home/.nvm/nvm.sh",
    'nvm() { printf "nvm|%s|%s\\n" "$1" "$2" >> "$FOUNDRY_HOOK_TEST_TRACE"; }\n',
  );
  write(
    "bin/pnpm",
    '#!/bin/sh\nif [ -n "$GIT_DIR$GIT_WORK_TREE$GIT_INDEX_FILE" ]; then exit 86; fi\nprintf "pnpm|%s\\n" "$*" >> "$FOUNDRY_HOOK_TEST_TRACE"\nexit "$FOUNDRY_HOOK_TEST_GATE_EXIT"\n',
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, env, encoding: "utf8", timeout: 15_000 });
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", ".husky");
  const shell =
    process.platform === "win32"
      ? path.resolve(git("--exec-path").trim(), "../../../bin/sh.exe")
      : "sh";
  const observed = () => (fs.existsSync(trace) ? fs.readFileSync(trace, "utf8") : "");
  const hook = (input: string | Buffer, extra: NodeJS.ProcessEnv = {}) => {
    fs.rmSync(trace, { force: true });
    return spawnSync(shell, [path.join(repo, ".husky/pre-push"), "origin", "remote with space"], {
      cwd: repo,
      env: { ...env, ...extra },
      input,
      encoding: "utf8",
      timeout: 10_000,
    });
  };
  return {
    root,
    repo,
    home,
    trace,
    env,
    shell,
    write,
    git,
    observed,
    hook,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const fullTrace = "nvm|use|24\npnpm|prepush:gate\n";

test("pure branch deletions alone avoid toolchain loading and source qualification", () => {
  const f = fixture();
  try {
    for (const input of [
      deletion,
      deletion + deletion.replace("/old ", "/other "),
      "(delete) " + "0".repeat(64) + " refs/heads/old " + "a".repeat(64) + "\n",
    ]) {
      const result = f.hook(input);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(f.observed(), "", "a pure deletion ran the source gate");
    }
  } finally {
    f.cleanup();
  }
});

test("source, mixed, tag and unproven wire inputs retain the complete ordered gate", () => {
  const f = fixture();
  try {
    const inputs = [
      update,
      update.replace("2".repeat(40), zero),
      deletion + update,
      update + deletion,
      deletion.replace("refs/heads/", "refs/tags/"),
      update.replaceAll("refs/heads/", "refs/tags/"),
      "",
      "\n",
      "(delete) " + zero + "\n",
      deletion.trimEnd(),
      deletion + "incomplete\n",
      deletion.replace("\n", " extra\n"),
      deletion.replace(oid, zero),
      deletion.replace(zero, oid),
      deletion.replace(zero, "0".repeat(50)),
      deletion.replace(oid, "a".repeat(64)),
      deletion.replace(oid, "z".repeat(40)),
      deletion.replace("/old ", "/../escape "),
      deletion.replace("refs/heads/", "refs/notes/"),
      deletion.replace("\n", "\r\n"),
      Buffer.from(deletion.replace("\n", "\0\n")),
    ];
    for (const [index, input] of inputs.entries()) {
      const result = f.hook(input, { FOUNDRY_SKIP_VALIDATION: "1" });
      assert.equal(result.status, 0, String(index) + ": " + result.stderr);
      assert.equal(f.observed(), fullTrace, "fallback " + index);
    }
    const failed = f.hook(update, { FOUNDRY_HOOK_TEST_GATE_EXIT: "73" });
    assert.equal(failed.status, 73, failed.stderr);
    assert.equal(f.observed(), fullTrace);
  } finally {
    f.cleanup();
  }
});

test("missing or failed classifier preserves the full gate and its failure", () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.repo, helperPath), { force: true });
    assert.equal(f.hook(deletion).status, 0);
    assert.equal(f.observed(), fullTrace);
    f.write("repo with space/" + helperPath, "#!/bin/sh\nexit 42\n");
    assert.equal(f.hook(deletion, { FOUNDRY_HOOK_TEST_GATE_EXIT: "71" }).status, 71);
    assert.equal(f.observed(), fullTrace);
  } finally {
    f.cleanup();
  }
});

test("real Git wire deletion skips qualification while failed source push is rejected", () => {
  const f = fixture();
  try {
    const remote = path.join(f.root, "remote with space.git");
    f.git("init", "--bare", "--quiet", remote);
    f.git("commit", "--allow-empty", "-qm", "fixture");
    f.git("remote", "add", "origin", remote);
    f.git("push", "--quiet", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/old");
    assert.equal(f.observed(), fullTrace);
    fs.rmSync(f.trace);
    f.git("push", "--quiet", "origin", "--delete", "old");
    assert.equal(f.observed(), "");
    assert.equal(f.git("ls-remote", "--heads", "origin", "old").trim(), "");
    const previous = f.git("ls-remote", "--heads", "origin", "main");
    f.git("commit", "--allow-empty", "-qm", "changed source");
    const result = spawnSync("git", ["push", "origin", "HEAD:main"], {
      cwd: f.repo,
      env: { ...f.env, FOUNDRY_HOOK_TEST_GATE_EXIT: "73" },
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.notEqual(result.status, 0);
    assert.equal(f.observed(), fullTrace);
    assert.equal(f.git("ls-remote", "--heads", "origin", "main"), previous);
  } finally {
    f.cleanup();
  }
});

test("both hook paths preserve foreign Git bindings and source qualification isolation", () => {
  const f = fixture();
  try {
    const foreign = path.join(f.root, "foreign");
    f.git("init", "--quiet", foreign);
    const gitDir = path.join(foreign, ".git");
    const config = fs.readFileSync(path.join(gitDir, "config"));
    const bindings = {
      GIT_DIR: gitDir,
      GIT_WORK_TREE: foreign,
      GIT_INDEX_FILE: path.join(gitDir, "index"),
    };
    const deleted = f.hook(deletion, bindings);
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.equal(f.observed(), "");
    const changed = f.hook(update, bindings);
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(f.observed(), fullTrace);
    assert.deepEqual(fs.readFileSync(path.join(gitDir, "config")), config);
    assert.equal(fs.existsSync(path.join(gitDir, "index")), false);
  } finally {
    f.cleanup();
  }
});
