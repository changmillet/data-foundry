import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import {
  command,
  isolatedEnvironment,
  packageManagerCommand,
} from "./package-consumer-process.mts";
import { managedPreparationGroups } from "./managed-process-preparation.mts";
import { verifyManagedPackageHost } from "./managed-package-host.mts";

const repo = path.resolve(import.meta.dirname, "../..");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function mode(root: string, writable: boolean): void {
  if (!fs.existsSync(root)) return;
  fs.chmodSync(root, writable ? 0o755 : 0o555);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) mode(target, writable);
    else if (entry.isFile()) fs.chmodSync(target, writable ? 0o644 : 0o444);
    else throw new Error("Installed production package must not contain links.");
  }
}

/** Each group builds in an owned source snapshot and installs only its public production closure. */
export async function verifyInstalledPreparationGroup(
  t: TestContext,
  group: keyof typeof managedPreparationGroups,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-installed-preparation-${group}-`));
  const source = path.join(root, "source-snapshot");
  const installedPackage = path.join(root, "project/node_modules/@tiangong-lca/foundry");
  t.after(() => {
    mode(installedPackage, true);
    mode(path.join(root, "managed-process-case/input/node_modules/@tiangong-lca/foundry"), true);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = command("git", ["ls-files", "-z"], repo, process.env);
  assert.equal(git.status, 0, git.stderr);
  const selected = git.stdout
    .split("\0")
    .filter(
      (file) =>
        ["package.json", "README.md", "LICENSE"].includes(file) ||
        /^tsconfig(?:\.[a-z-]+)?\.json$/u.test(file) ||
        ["scripts/", "specs/", "docs/"].some((prefix) => file.startsWith(prefix)),
    );
  assert.ok(selected.length > 0);
  const sourceFiles: Array<{ path: string; sha256: string }> = [];
  for (const file of selected) {
    assert.ok(
      !path.isAbsolute(file) && path.posix.normalize(file) === file && !file.startsWith("../"),
    );
    const original = path.join(repo, file);
    const stat = fs.lstatSync(original);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), file);
    const target = path.join(source, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(original, target);
    fs.chmodSync(target, stat.mode & 0o777);
    sourceFiles.push({ path: file, sha256: digest(fs.readFileSync(original)) });
  }
  // This link is compiler-only. The installed runtime below contains no source/path dependencies.
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(source, "node_modules"), "junction");
  const built = command(
    process.execPath,
    [path.join(source, "scripts/build-foundry-package.ts")],
    source,
    isolatedEnvironment(path.join(root, "build-home")),
  );
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const artifacts = path.join(root, "artifacts");
  fs.mkdirSync(artifacts);
  const packed = packageManagerCommand(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", artifacts],
    path.join(source, "package-stage"),
    isolatedEnvironment(path.join(root, "pack-home")),
  );
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const pack = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  assert.equal(pack.length, 1);
  const tarball = path.join(artifacts, pack[0].filename);
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const installation = packageManagerCommand(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarball,
    ],
    project,
    isolatedEnvironment(path.join(root, "install-home")),
    300_000,
  );
  assert.equal(installation.status, 0, installation.stderr || installation.stdout);
  const manifestBytes = fs.readFileSync(path.join(installedPackage, "package.json"));
  const manifest = JSON.parse(manifestBytes.toString()) as {
    version: string;
    dependencies: Record<string, string>;
  };
  assert.equal(manifest.dependencies["@tiangong-lca/cli"], "0.1.28");
  const cli = JSON.parse(
    fs.readFileSync(path.join(project, "node_modules/@tiangong-lca/cli/package.json"), "utf8"),
  );
  assert.equal(cli.version, "0.1.28");
  mode(installedPackage, false);
  await verifyManagedPackageHost(
    installedPackage,
    root,
    process.env.FOUNDRY_QUALIFICATION_PUBLIC_TIDAS_BIN,
    managedPreparationGroups[group],
  );
  assert.deepEqual(fs.readFileSync(path.join(installedPackage, "package.json")), manifestBytes);
  const cases = JSON.parse(
    fs.readFileSync(
      path.join(root, "managed-process-case/managed-process-preparation-receipt.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    cases.map((item: { case: string }) => item.case).sort(),
    [...managedPreparationGroups[group]].sort(),
  );
  if (process.env.FOUNDRY_QUALIFICATION_RECEIPT) {
    const binary = process.env.FOUNDRY_QUALIFICATION_PUBLIC_TIDAS_BIN;
    fs.writeFileSync(
      `${process.env.FOUNDRY_QUALIFICATION_RECEIPT}-${group}.json`,
      JSON.stringify(
        {
          schema: "tiangong-foundry.installed-process-preparation-qualification.v1",
          group,
          foundry_version: manifest.version,
          cli_version: cli.version,
          native_kind: binary ? "verified-public-executable" : "explicit-transport-fixture",
          native_sha256: binary ? digest(fs.readFileSync(binary)) : null,
          source_snapshot_sha256: digest(Buffer.from(JSON.stringify(sourceFiles))),
          installed_package_manifest_sha256: digest(manifestBytes),
          cases,
        },
        null,
        2,
      ),
    );
  }
}
