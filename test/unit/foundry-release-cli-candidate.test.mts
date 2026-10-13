import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseFoundryRuntimePreparationArgs } from "../../scripts/release-prepare-runtime.ts";
import {
  inspectFoundryCliCandidateSource,
  prepareFoundryCliCandidate,
  assertPreparedFoundryCliCandidate,
  type PreparedFoundryCliCandidate,
} from "../../scripts/lib/foundry-release-cli-candidate.ts";
import {
  preparedFoundryRuntimeAuthority,
  type PreparedFoundryRuntimeComponents,
} from "../../scripts/lib/foundry-release-components.ts";

function sourceFixture(buildable = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-source-"));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
      shell: false,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "-q"]);
  git(["remote", "add", "origin", "https://github.com/tiangong-lca/cli.git"]);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "@tiangong-lca/cli",
      version: "0.1.27",
      packageManager: "pnpm@11.24.0",
      repository: { type: "git", url: "git+https://github.com/tiangong-lca/cli.git" },
      dependencies: {},
      ...(buildable
        ? {
            scripts: {
              prepack: 'node -e "process.exit(97)"',
              build:
                "node -e \"require('node:fs').mkdirSync('bin'); require('node:fs').writeFileSync('bin/tiangong-lca.js', 'console.log(123)\\n')\"",
            },
            files: ["bin/", "LICENSE"],
          }
        : {}),
    }),
  );
  fs.writeFileSync(
    path.join(root, "pnpm-lock.yaml"),
    buildable
      ? "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n"
      : "lockfileVersion: '9.0'\n",
  );
  if (buildable) {
    fs.writeFileSync(path.join(root, "LICENSE"), "Fixture only license\n");
    fs.writeFileSync(path.join(root, "EMPTY"), "");
    git(["add", "LICENSE", "EMPTY"]);
  }
  git(["add", "package.json", "pnpm-lock.yaml"]);
  git([
    "-c",
    "user.name=Candidate Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
  return { root, git, selection: { sourceRoot: root, commit: git(["rev-parse", "HEAD"]) } };
}

test("runtime CLI local source selection is explicit, complete, and unavailable to published mode", () => {
  assert.deepEqual(
    parseFoundryRuntimePreparationArgs([
      "--output",
      "/tmp/new",
      "--cli-source",
      "/tmp/cli",
      "--cli-commit",
      "a".repeat(40),
    ]),
    {
      output: "/tmp/new",
      scope: "source-candidate",
      cliCandidate: { sourceRoot: "/tmp/cli", commit: "a".repeat(40) },
    },
  );
  assert.deepEqual(parseFoundryRuntimePreparationArgs(["--output", "/tmp/new", "--published"]), {
    output: "/tmp/new",
    scope: "published-release",
    cliCandidate: undefined,
  });
  for (const args of [
    ["--output", "/tmp/new", "--cli-source", "/tmp/cli"],
    ["--output", "/tmp/new", "--cli-commit", "a".repeat(40)],
    [
      "--output",
      "/tmp/new",
      "--published",
      "--cli-source",
      "/tmp/cli",
      "--cli-commit",
      "a".repeat(40),
    ],
    ["--output", "/tmp/new", "--output", "/tmp/other"],
  ])
    assert.throws(() => parseFoundryRuntimePreparationArgs(args), /Usage/u);
});

test("CLI source inspection binds real source bytes and rejects changed, stale, or foreign inputs", () => {
  const f = sourceFixture();
  try {
    const observed = inspectFoundryCliCandidateSource(f.selection);
    assert.equal(observed.source.gitCommit, f.selection.commit);
    assert.equal(observed.version, "0.1.27");
    assert.equal(observed.files.length, 2);
    assert.throws(
      () => inspectFoundryCliCandidateSource({ ...f.selection, commit: "0".repeat(40) }),
      /clean exact canonical/u,
    );
    fs.appendFileSync(path.join(f.root, "pnpm-lock.yaml"), "changed\n");
    assert.throws(() => inspectFoundryCliCandidateSource(f.selection), /clean exact canonical/u);
    fs.writeFileSync(path.join(f.root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    f.git(["remote", "set-url", "origin", "https://github.com/other/cli.git"]);
    assert.throws(() => inspectFoundryCliCandidateSource(f.selection), /clean exact canonical/u);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("tracked bytes and modes are checked even when Git status hides working-tree changes", () => {
  const f = sourceFixture();
  try {
    f.git(["update-index", "--assume-unchanged", "pnpm-lock.yaml"]);
    fs.appendFileSync(path.join(f.root, "pnpm-lock.yaml"), "hidden change\n");
    assert.equal(f.git(["status", "--porcelain"]), "");
    assert.throws(() => inspectFoundryCliCandidateSource(f.selection), /source bytes differ/u);
    fs.writeFileSync(path.join(f.root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    if (process.platform !== "win32") {
      f.git(["config", "core.fileMode", "false"]);
      fs.chmodSync(path.join(f.root, "pnpm-lock.yaml"), 0o755);
      assert.equal(f.git(["status", "--porcelain"]), "");
      assert.throws(() => inspectFoundryCliCandidateSource(f.selection), /source mode differs/u);
    }
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("wrong candidate version fails before building or creating output", () => {
  const f = sourceFixture();
  const output = path.join(os.tmpdir(), `candidate-uncreated-${process.pid}`);
  try {
    assert.throws(
      () => prepareFoundryCliCandidate(f.selection, output, "0.1.28"),
      /owning Foundry dependency/u,
    );
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("serialized candidate and runtime metadata never recover process-local preparation authority", () => {
  assert.throws(
    () => assertPreparedFoundryCliCandidate(JSON.parse("{}") as PreparedFoundryCliCandidate),
    /in-process source authority/u,
  );
  assert.throws(
    () => preparedFoundryRuntimeAuthority(JSON.parse("{}") as PreparedFoundryRuntimeComponents),
    /in-process prepared component authority/u,
  );
});

test("the isolated owner build creates source-bound candidate facts and stale bytes cannot qualify", () => {
  const f = sourceFixture(true);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-build-"));
  try {
    const candidate = prepareFoundryCliCandidate(f.selection, path.join(parent, "build"), "0.1.27");
    assertPreparedFoundryCliCandidate(candidate);
    assert.equal(candidate.evidence.schema, "tiangong-foundry.local-cli-candidate.v1");
    assert.equal(candidate.evidence.tarball.url, "NOASSERTION");
    assert.equal(candidate.evidence.source.gitCommit, f.selection.commit);
    assert.equal(candidate.evidence.source_files.length, 4);
    assert.equal(candidate.evidence.source_files.find((file) => file.path === "EMPTY")?.bytes, 0);
    assert.equal(f.git(["status", "--porcelain", "--untracked-files=all"]), "");
    assert.throws(
      () =>
        assertPreparedFoundryCliCandidate(
          JSON.parse(JSON.stringify(candidate)) as PreparedFoundryCliCandidate,
        ),
      /in-process source authority/u,
    );
    const byte = candidate.tarballBytes[20];
    candidate.tarballBytes[20] = byte ^ 1;
    assert.throws(() => assertPreparedFoundryCliCandidate(candidate), /prepared bytes changed/u);
    candidate.tarballBytes[20] = byte;
    f.git(["update-index", "--assume-unchanged", "pnpm-lock.yaml"]);
    fs.appendFileSync(path.join(f.root, "pnpm-lock.yaml"), "hidden change\n");
    assert.throws(() => assertPreparedFoundryCliCandidate(candidate), /source bytes differ/u);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
