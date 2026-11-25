import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { writeRuntimeComponentArchive, type ComponentFile } from "@tiangong-lca/cli/runtime";
import { command, isolatedEnvironment } from "./package-consumer-process.mts";

const repo = path.resolve(import.meta.dirname, "../..");
const canonicalTmpDir = fs.realpathSync(os.tmpdir());
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export interface InstalledPreparationTemplate {
  readonly templateRoot: string;
  readonly sourceSnapshotSha256: string;
  readonly foundryVersion: string;
  readonly cliVersion: string;
  readonly installedManifestBytes: Buffer;
}

let inProcessTemplate: InstalledPreparationTemplate | null = null;

function resolvePackageRoot(fromFile: string, packageName: string): string {
  const resolved = createRequire(fromFile)
    .resolve.paths(packageName)
    ?.map((dir) => path.join(dir, packageName, "package.json"))
    .find((candidate) => fs.existsSync(candidate));
  assert.ok(resolved, `Unable to resolve ${packageName} from ${fromFile}`);
  return fs.realpathSync(path.dirname(resolved));
}

function collectCliProductionClosure(
  cliRoot: string,
): ReadonlyArray<{ readonly name: string; readonly version: string; readonly root: string }> {
  const visited = new Map<
    string,
    { readonly name: string; readonly version: string; readonly root: string }
  >();
  const walk = (pkgRoot: string): void => {
    const manifestFile = path.join(pkgRoot, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as {
      name: string;
      version: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    const existing = visited.get(manifest.name);
    if (existing) {
      assert.equal(existing.version, manifest.version, manifest.name);
      return;
    }
    visited.set(manifest.name, { name: manifest.name, version: manifest.version, root: pkgRoot });
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      walk(resolvePackageRoot(manifestFile, dep));
    }
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      try {
        walk(resolvePackageRoot(manifestFile, peer));
      } catch (error) {
        if (!manifest.peerDependenciesMeta?.[peer]?.optional) throw error;
      }
    }
  };
  walk(cliRoot);
  return [...visited.values()];
}

export function copyRegularPackageTreeSync(sourceRoot: string, targetRoot: string): void {
  fs.mkdirSync(targetRoot, { recursive: true, mode: 0o755 });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".bin" ||
      entry.name === ".package-lock.json"
    ) {
      continue;
    }
    const origin = path.join(sourceRoot, entry.name);
    const destination = path.join(targetRoot, entry.name);
    const stat = fs.lstatSync(origin);
    assert.equal(stat.isSymbolicLink(), false, `Package tree must not contain symlinks: ${origin}`);
    if (stat.isDirectory()) {
      copyRegularPackageTreeSync(origin, destination);
    } else if (stat.isFile()) {
      fs.copyFileSync(origin, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, stat.mode & 0o777);
    }
  }
}

export function acquireDirectoryLockSync(lockDir: string, timeoutMs = 180_000): () => void {
  const deadline = Date.now() + timeoutMs;
  const spinBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      fs.writeFileSync(
        path.join(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      );
      return () => {
        fs.rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for shared test lock: ${lockDir}`);
      }
      Atomics.wait(spinBuffer, 0, 0, 100);
    }
  }
}

async function acquireDirectoryLockAsync(
  lockDir: string,
  timeoutMs = 180_000,
): Promise<() => void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      fs.writeFileSync(
        path.join(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      );
      return () => {
        fs.rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for shared archive lock: ${lockDir}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/**
 * Reuse verified deterministic `.tar.gz` component archives across subtests and test processes
 * whenever the complete `ComponentFile[]` inventory (path, bytes, sha256, mode) is identical.
 */
export async function writeOrCopyCachedComponentArchive(
  sourceRoot: string,
  files: readonly ComponentFile[],
  targetArchive: string,
): Promise<{ bytes: number; sha256: string }> {
  const cacheDir = path.join(canonicalTmpDir, "foundry-component-archives-v1");
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const filesKey = digest(JSON.stringify(files));
  const cachedArchive = path.join(cacheDir, `${filesKey}.tar.gz`);
  const cachedMeta = path.join(cacheDir, `${filesKey}.json`);
  const lockDir = path.join(cacheDir, `${filesKey}.lock`);

  const releaseLock = await acquireDirectoryLockAsync(lockDir);
  try {
    if (!fs.existsSync(cachedArchive) || !fs.existsSync(cachedMeta)) {
      const tempArchive = path.join(
        cacheDir,
        `${filesKey}.${process.pid}.${Date.now()}.tmp.tar.gz`,
      );
      try {
        const archiveFact = await writeRuntimeComponentArchive(sourceRoot, [...files], tempArchive);
        fs.renameSync(tempArchive, cachedArchive);
        fs.writeFileSync(cachedMeta, `${JSON.stringify(archiveFact)}\n`);
      } finally {
        fs.rmSync(tempArchive, { force: true });
      }
    }
    const meta = JSON.parse(fs.readFileSync(cachedMeta, "utf8")) as {
      bytes: number;
      sha256: string;
    };
    fs.mkdirSync(path.dirname(targetArchive), { recursive: true });
    fs.copyFileSync(cachedArchive, targetArchive);
    assert.equal(fs.statSync(targetArchive).size, meta.bytes);
    return meta;
  } finally {
    releaseLock();
  }
}

/**
 * Build `package-stage` and materialize a verified production `node_modules` closure once
 * per source snapshot across concurrent test files in the same shard, avoiding redundant
 * TypeScript compilation, tarball packing, and cold empty-HOME registry downloads.
 */
export function ensureSharedInstalledPreparationTemplate(): InstalledPreparationTemplate {
  if (
    inProcessTemplate &&
    fs.existsSync(path.join(inProcessTemplate.templateRoot, ".ready.json"))
  ) {
    return inProcessTemplate;
  }

  const git = command(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    repo,
    process.env,
  );
  assert.equal(git.status, 0, git.stderr);
  const selected = git.stdout
    .split("\0")
    .filter(
      (file) =>
        Boolean(file) &&
        fs.existsSync(path.join(repo, file)) &&
        (["package.json", "README.md", "LICENSE"].includes(file) ||
          /^tsconfig(?:\.[a-z-]+)?\.json$/u.test(file) ||
          ["scripts/", "src/", "devops/", "specs/", "docs/"].some((prefix) =>
            file.startsWith(prefix),
          )),
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
    sourceFiles.push({ path: file, sha256: digest(fs.readFileSync(original)) });
  }
  const sourceSnapshotSha256 = digest(Buffer.from(JSON.stringify(sourceFiles)));
  const templateBase = path.join(
    canonicalTmpDir,
    `foundry-installed-prep-v1-${sourceSnapshotSha256.slice(0, 20)}`,
  );
  const readyFile = path.join(templateBase, ".ready.json");
  const lockDir = `${templateBase}.lock`;

  const releaseLock = acquireDirectoryLockSync(lockDir);
  try {
    if (!fs.existsSync(readyFile)) {
      fs.rmSync(templateBase, { recursive: true, force: true });
      fs.mkdirSync(templateBase, { recursive: true, mode: 0o700 });
      const sourceDir = path.join(templateBase, "source-snapshot");
      for (const { path: file } of sourceFiles) {
        const original = path.join(repo, file);
        const stat = fs.lstatSync(original);
        const target = path.join(sourceDir, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(original, target);
        fs.chmodSync(target, stat.mode & 0o777);
      }
      fs.symlinkSync(
        path.join(repo, "node_modules"),
        path.join(sourceDir, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const buildScript = fs.existsSync(
        path.join(sourceDir, "devops/build/build-foundry-package.ts"),
      )
        ? path.join(sourceDir, "devops/build/build-foundry-package.ts")
        : path.join(sourceDir, "scripts/build-foundry-package.ts");
      const built = command(
        process.execPath,
        [buildScript],
        sourceDir,
        isolatedEnvironment(path.join(templateBase, "build-home")),
      );
      assert.equal(built.status, 0, built.stderr || built.stdout);

      const projectDir = path.join(templateBase, "project");
      const nodeModulesDir = path.join(projectDir, "node_modules");
      fs.mkdirSync(nodeModulesDir, { recursive: true, mode: 0o755 });
      fs.writeFileSync(
        path.join(projectDir, "package.json"),
        `${JSON.stringify({ private: true, type: "module" })}\n`,
      );

      const sourceManifest = JSON.parse(
        fs.readFileSync(path.join(sourceDir, "package.json"), "utf8"),
      ) as {
        version: string;
        dependencies: Record<string, string>;
      };
      const expectedCliVersion = sourceManifest.dependencies["@tiangong-lca/cli"];
      assert.match(expectedCliVersion, /^\d+\.\d+\.\d+$/u);

      const cliRoot = resolvePackageRoot(path.join(repo, "package.json"), "@tiangong-lca/cli");
      for (const pkg of collectCliProductionClosure(cliRoot)) {
        copyRegularPackageTreeSync(pkg.root, path.join(nodeModulesDir, pkg.name));
      }
      copyRegularPackageTreeSync(
        path.join(sourceDir, "package-stage"),
        path.join(nodeModulesDir, "@tiangong-lca/foundry"),
      );

      const installedManifestPath = path.join(nodeModulesDir, "@tiangong-lca/foundry/package.json");
      const installedManifest = JSON.parse(fs.readFileSync(installedManifestPath, "utf8")) as {
        version: string;
        dependencies: Record<string, string>;
      };
      assert.equal(installedManifest.dependencies["@tiangong-lca/cli"], expectedCliVersion);
      const installedCliManifest = JSON.parse(
        fs.readFileSync(path.join(nodeModulesDir, "@tiangong-lca/cli/package.json"), "utf8"),
      ) as { version: string };
      assert.equal(installedCliManifest.version, expectedCliVersion);

      // Remove compiler-only source snapshot to keep template lean; retain only verified installed project.
      fs.rmSync(sourceDir, { recursive: true, force: true });
      fs.rmSync(path.join(templateBase, "build-home"), { recursive: true, force: true });

      fs.writeFileSync(
        readyFile,
        `${JSON.stringify(
          {
            sourceSnapshotSha256,
            foundryVersion: installedManifest.version,
            cliVersion: installedCliManifest.version,
          },
          null,
          2,
        )}\n`,
      );
    }
  } finally {
    releaseLock();
  }

  const readyMeta = JSON.parse(fs.readFileSync(readyFile, "utf8")) as {
    sourceSnapshotSha256: string;
    foundryVersion: string;
    cliVersion: string;
  };
  const installedManifestBytes = fs.readFileSync(
    path.join(templateBase, "project/node_modules/@tiangong-lca/foundry/package.json"),
  );
  inProcessTemplate = Object.freeze({
    templateRoot: templateBase,
    sourceSnapshotSha256: readyMeta.sourceSnapshotSha256,
    foundryVersion: readyMeta.foundryVersion,
    cliVersion: readyMeta.cliVersion,
    installedManifestBytes,
  });
  return inProcessTemplate;
}

export function materializeIsolatedInstalledProject(
  targetProjectDir: string,
): InstalledPreparationTemplate {
  const template = ensureSharedInstalledPreparationTemplate();
  const templateProject = path.join(template.templateRoot, "project");
  fs.mkdirSync(targetProjectDir, { recursive: true, mode: 0o755 });
  fs.copyFileSync(
    path.join(templateProject, "package.json"),
    path.join(targetProjectDir, "package.json"),
  );
  const templateNodeModules = path.join(templateProject, "node_modules");
  const targetNodeModules = path.join(targetProjectDir, "node_modules");
  for (const entry of fs.readdirSync(templateNodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith("@")) {
      for (const scoped of fs.readdirSync(path.join(templateNodeModules, entry.name), {
        withFileTypes: true,
      })) {
        if (scoped.isDirectory()) {
          copyRegularPackageTreeSync(
            path.join(templateNodeModules, entry.name, scoped.name),
            path.join(targetNodeModules, entry.name, scoped.name),
          );
        }
      }
    } else if (entry.isDirectory()) {
      copyRegularPackageTreeSync(
        path.join(templateNodeModules, entry.name),
        path.join(targetNodeModules, entry.name),
      );
    }
  }
  return template;
}
