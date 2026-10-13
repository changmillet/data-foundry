import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ComponentFile } from "@tiangong-lca/cli/runtime";
import { readFoundryReleaseGit as git } from "./foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./foundry-release-root.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { resolvePackageManagerCommand } from "./package-manager-command.ts";
import { canonicalizeFoundryPackageArchive } from "../pack-foundry-package.ts";
import { freezeFoundryReleaseValue } from "./foundry-release-component-io.ts";

export interface FoundryCliCandidateSelection {
  readonly sourceRoot: string;
  readonly commit: string;
}
export interface FoundryCliCandidateEvidence {
  readonly schema: "tiangong-foundry.local-cli-candidate.v1";
  readonly package: Readonly<{ name: "@tiangong-lca/cli"; version: string }>;
  readonly source: Readonly<{
    repository: "https://github.com/tiangong-lca/cli";
    gitCommit: string;
    tree: string;
    date: string;
    inventory_sha256: string;
  }>;
  readonly source_files: readonly ComponentFile[];
  readonly source_lock: Readonly<{ path: "pnpm-lock.yaml"; bytes: number; sha256: string }>;
  readonly tarball: Readonly<{
    url: "NOASSERTION";
    bytes: number;
    sha256: string;
    sha512: string;
    integrity: string;
  }>;
}
export interface PreparedFoundryCliCandidate {
  readonly evidence: FoundryCliCandidateEvidence;
  readonly tarballBytes: Buffer;
  readonly lockBytes: Buffer;
  readonly dependencies: Readonly<Record<string, string>>;
}
const authorities = new WeakMap<
  object,
  { selection: FoundryCliCandidateSelection; state: string }
>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CLI candidate source manifest must be an object.");
  return value as Record<string, unknown>;
}

/** Source selection binds Git and actual tracked bytes; no emitted metadata can supply this authority. */
export function inspectFoundryCliCandidateSource(selection: FoundryCliCandidateSelection) {
  if (!path.isAbsolute(selection.sourceRoot) || !/^[0-9a-f]{40}$/u.test(selection.commit))
    throw new Error("CLI candidate requires an absolute source root and exact commit.");
  const root = fs.realpathSync(selection.sourceRoot);
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    git(root, ["rev-parse", "HEAD"]).trim() !== selection.commit ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim() ||
    ![
      "https://github.com/tiangong-lca/cli.git",
      "https://github.com/tiangong-lca/cli",
      "git@github.com:tiangong-lca/cli.git",
    ].includes(git(root, ["remote", "get-url", "origin"]).trim())
  )
    throw new Error("CLI candidate requires its clean exact canonical source checkout.");
  const files: ComponentFile[] = [];
  const entries = git(root, ["ls-tree", "-rz", "HEAD"]).split("\0").filter(Boolean);
  if (!entries.length || entries.length > 10000)
    throw new Error("CLI candidate source inventory exceeds its bound.");
  let total = 0;
  for (const entry of entries) {
    const matched = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(entry);
    if (
      !matched ||
      /[\\:\p{Cc}]/u.test(matched[3]) ||
      matched[3].split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("CLI candidate source must contain portable regular files only.");
    const bytes = readFoundryReleaseArtifact(path.join(root, matched[3]), 64 * 1024 * 1024, true);
    total += bytes.length;
    if (
      total > 256 * 1024 * 1024 ||
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== matched[2]
    )
      throw new Error("CLI candidate source bytes differ from its exact Git tree.");
    const observedMode = fs.statSync(path.join(root, matched[3])).mode & 0o111;
    if (process.platform !== "win32" && Boolean(observedMode) !== (matched[1] === "100755"))
      throw new Error("CLI candidate source mode differs from its exact Git tree.");
    files.push({
      path: matched[3],
      bytes: bytes.length,
      sha256: hash(bytes),
      mode: matched[1] === "100755" ? 0o755 : 0o644,
    });
  }
  const manifest = object(
    JSON.parse(
      readFoundryReleaseArtifact(path.join(root, "package.json"), 2 * 1024 * 1024).toString("utf8"),
    ),
  );
  if (
    manifest.name !== "@tiangong-lca/cli" ||
    typeof manifest.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(manifest.version) ||
    manifest.packageManager !== "pnpm@11.24.0" ||
    object(manifest.repository).url !== "git+https://github.com/tiangong-lca/cli.git"
  )
    throw new Error("CLI candidate source package/toolchain identity is unsupported.");
  const dependencies = object(manifest.dependencies);
  if (Object.values(dependencies).some((value) => typeof value !== "string"))
    throw new Error("CLI candidate source dependencies are invalid.");
  const source = {
    repository: "https://github.com/tiangong-lca/cli" as const,
    gitCommit: selection.commit,
    tree: git(root, ["rev-parse", "HEAD^{tree}"]).trim(),
    date: new Date(git(root, ["show", "-s", "--format=%cI", "HEAD"]).trim()).toISOString(),
    inventory_sha256: hash(Buffer.from(JSON.stringify(files))),
  };
  return {
    root,
    files,
    source,
    version: manifest.version,
    dependencies: dependencies as Record<string, string>,
  };
}

export function assertPreparedFoundryCliCandidate(value: PreparedFoundryCliCandidate): void {
  const authority = authorities.get(value);
  if (
    !authority ||
    JSON.stringify(inspectFoundryCliCandidateSource(authority.selection)) !== authority.state
  )
    throw new Error(
      "CLI candidate requires fresh in-process source authority; source changed or receipt was serialized.",
    );
  if (
    hash(value.tarballBytes) !== value.evidence.tarball.sha256 ||
    hash(value.lockBytes) !== value.evidence.source_lock.sha256
  )
    throw new Error("CLI candidate prepared bytes changed.");
}

export function prepareFoundryCliCandidate(
  selection: FoundryCliCandidateSelection,
  destination: string,
  expectedVersion: string,
): PreparedFoundryCliCandidate {
  const source = inspectFoundryCliCandidateSource(selection);
  if (source.version !== expectedVersion)
    throw new Error("CLI candidate version differs from the owning Foundry dependency.");
  if (!path.isAbsolute(destination) || fs.existsSync(destination))
    throw new Error("CLI candidate build requires a new absolute destination.");
  destination = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  const relative = path.relative(source.root, destination);
  if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    throw new Error("CLI candidate build must be outside its original source checkout.");
  const invocation = resolvePackageManagerCommand("pnpm", ["--version"]);
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "PATHEXT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TZ",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  const version = spawnSync(invocation.executable, invocation.argv, {
    env: environment,
    encoding: "utf8",
    shell: false,
    timeout: 30000,
  });
  if (
    process.versions.node !== "24.19.0" ||
    version.error ||
    version.status !== 0 ||
    version.stdout.trim() !== "11.24.0"
  )
    throw new Error("CLI candidate build requires pinned Node 24.19.0 and pnpm 11.24.0.");
  fs.mkdirSync(destination, { mode: 0o700 });
  const created = fs.lstatSync(destination, { bigint: true });
  try {
    const home = path.join(destination, "home");
    fs.mkdirSync(home);
    environment.HOME = home;
    environment.USERPROFILE = home;
    environment.NPM_CONFIG_USERCONFIG = path.join(home, "empty-npmrc");
    fs.writeFileSync(environment.NPM_CONFIG_USERCONFIG, "", { flag: "wx", mode: 0o600 });
    const build = path.join(destination, "source");
    fs.mkdirSync(build);
    for (const file of source.files) {
      const bytes = readFoundryReleaseArtifact(
        path.join(source.root, file.path),
        64 * 1024 * 1024,
        true,
      );
      if (hash(bytes) !== file.sha256)
        throw new Error("CLI candidate source changed during copying.");
      const target = path.join(build, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: "wx", mode: file.mode });
    }
    // The copied CLI's existing owner build is the only compiler entry. Install never runs package lifecycle scripts.
    for (const args of [
      [
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--store-dir",
        path.join(destination, "store"),
      ],
      ["run", "build"],
      ["pack", "--config.ignore-scripts=true", "--pack-destination", destination],
    ]) {
      const command = resolvePackageManagerCommand("pnpm", args);
      const result = spawnSync(command.executable, command.argv, {
        cwd: build,
        env: environment,
        shell: false,
        encoding: "utf8",
        timeout: 300000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error || result.status !== 0)
        throw new Error(`CLI candidate owner ${args[0]} failed.`);
    }
    const tarballBytes = canonicalizeFoundryPackageArchive(
      readFoundryReleaseArtifact(
        path.join(destination, `tiangong-lca-cli-${source.version}.tgz`),
        64 * 1024 * 1024,
      ),
    );
    const lockBytes = readFoundryReleaseArtifact(
      path.join(build, "pnpm-lock.yaml"),
      16 * 1024 * 1024,
    );
    const sourceLock = source.files.find((file) => file.path === "pnpm-lock.yaml");
    if (
      !sourceLock ||
      lockBytes.length !== sourceLock.bytes ||
      hash(lockBytes) !== sourceLock.sha256
    )
      throw new Error("CLI candidate source lock changed during frozen installation.");
    if (JSON.stringify(inspectFoundryCliCandidateSource(selection)) !== JSON.stringify(source))
      throw new Error("CLI candidate source changed during build.");
    const evidence: FoundryCliCandidateEvidence = {
      schema: "tiangong-foundry.local-cli-candidate.v1",
      package: { name: "@tiangong-lca/cli", version: source.version },
      source: source.source,
      source_files: source.files,
      source_lock: { path: "pnpm-lock.yaml", bytes: lockBytes.length, sha256: hash(lockBytes) },
      tarball: {
        url: "NOASSERTION",
        bytes: tarballBytes.length,
        sha256: hash(tarballBytes),
        sha512: createHash("sha512").update(tarballBytes).digest("hex"),
        integrity: `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`,
      },
    };
    const result = freezeFoundryReleaseValue({
      evidence,
      tarballBytes,
      lockBytes,
      dependencies: source.dependencies,
    });
    authorities.set(result, { selection, state: JSON.stringify(source) });
    return result;
  } catch (error) {
    if (fs.existsSync(destination)) {
      const current = fs.lstatSync(destination, { bigint: true });
      if (
        current.isDirectory() &&
        !current.isSymbolicLink() &&
        current.dev === created.dev &&
        current.ino === created.ino
      )
        fs.rmSync(destination, { recursive: true, force: true });
    }
    throw error;
  }
}
