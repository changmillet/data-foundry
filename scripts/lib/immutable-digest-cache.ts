import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface ImmutableFileStatFact {
  readonly canonicalPath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly fingerprint: string;
  readonly stableForCache: boolean;
}

export interface ImmutableDirectoryTreeSnapshot {
  readonly canonicalRoot: string;
  readonly files: readonly string[];
  readonly treeFingerprint: string;
  readonly allFilesStableForCache: boolean;
}

interface CachedFileEntry {
  readonly fingerprint: string;
  readonly canonicalPath: string;
  readonly bytes: number;
  readonly sha256: string;
}

const MAX_FILE_CACHE_ENTRIES = 4096;
const LARGE_BINARY_THRESHOLD_BYTES = 1024n * 1024n;
const MIN_MTIME_AGE_NS = 100_000_000n;

const fileDigestCache = new Map<string, CachedFileEntry>();

function comparePortableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function statFingerprint(stat: fs.BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}`;
}

function isStatStableForCache(stat: fs.BigIntStats): boolean {
  if (stat.size >= LARGE_BINARY_THRESHOLD_BYTES) return true;
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  return nowNs > stat.mtimeNs && nowNs - stat.mtimeNs >= MIN_MTIME_AGE_NS;
}

function setBoundedCacheEntry(key: string, value: CachedFileEntry): void {
  if (fileDigestCache.has(key)) {
    fileDigestCache.delete(key);
  } else if (fileDigestCache.size >= MAX_FILE_CACHE_ENTRIES) {
    const oldest = fileDigestCache.keys().next().value;
    if (oldest !== undefined) fileDigestCache.delete(oldest);
  }
  fileDigestCache.set(key, value);
}

/**
 * Read and SHA-256 verify a regular, non-symlink read-only component or executable file,
 * reusing an in-process digest only when `(dev, ino, size, mtimeNs, ctimeNs, mode)` matches
 * and the file is past filesystem timestamp granularity (or >= 1 MiB).
 *
 * Never use this helper for mutable `.foundry/workspaces/**` task artifacts.
 */
export function captureImmutableComponentFile(
  filePath: string,
  options?: {
    readonly maxBytes?: number;
    readonly onInvalid?: (
      reason: "missing_or_linked" | "not_bounded_file" | "changed_during_read",
    ) => never;
  },
): ImmutableFileStatFact {
  const maxBytes = options?.maxBytes ?? 512 * 1024 * 1024;
  const failInvalid = (
    reason: "missing_or_linked" | "not_bounded_file" | "changed_during_read",
    message: string,
  ): never => {
    if (options?.onInvalid) return options.onInvalid(reason);
    throw new Error(message);
  };

  let outerBefore: fs.BigIntStats;
  try {
    outerBefore = fs.lstatSync(filePath, { bigint: true });
  } catch {
    return failInvalid("missing_or_linked", `Component file is missing: ${filePath}`);
  }
  if (outerBefore.isSymbolicLink()) {
    return failInvalid("missing_or_linked", `Component file must not be a symlink: ${filePath}`);
  }
  if (!outerBefore.isFile() || outerBefore.size > BigInt(maxBytes)) {
    return failInvalid(
      "not_bounded_file",
      `Component file is not a bounded regular file: ${filePath}`,
    );
  }

  let canonicalPath: string;
  try {
    const nativeResolved = fs.realpathSync.native(filePath);
    canonicalPath = nativeResolved;
  } catch {
    try {
      canonicalPath = fs.realpathSync(filePath);
    } catch {
      return failInvalid("missing_or_linked", `Component file path could not resolve: ${filePath}`);
    }
  }

  const fp = statFingerprint(outerBefore);
  const stable = isStatStableForCache(outerBefore);
  if (stable) {
    const hit = fileDigestCache.get(canonicalPath);
    if (hit && hit.fingerprint === fp) {
      return Object.freeze({
        canonicalPath: hit.canonicalPath,
        bytes: hit.bytes,
        sha256: hit.sha256,
        fingerprint: fp,
        stableForCache: true,
      });
    }
  }

  let fd: number;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return failInvalid(
      "missing_or_linked",
      `Component file could not open without symlink follow: ${filePath}`,
    );
  }

  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (
      !opened.isFile() ||
      opened.size > BigInt(maxBytes) ||
      opened.dev !== outerBefore.dev ||
      opened.ino !== outerBefore.ino ||
      opened.size !== outerBefore.size
    ) {
      return failInvalid(
        "changed_during_read",
        `Component file changed while opening: ${filePath}`,
      );
    }

    const hasher = createHash("sha256");
    const chunkSize = Math.max(1, Math.min(1024 * 1024, Number(opened.size)));
    const buffer = Buffer.allocUnsafe(chunkSize);
    let totalBytes = 0;
    while (true) {
      const readCount = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (readCount === 0) break;
      totalBytes += readCount;
      if (totalBytes > Number(opened.size)) {
        return failInvalid("changed_during_read", `Component file grew during read: ${filePath}`);
      }
      hasher.update(buffer.subarray(0, readCount));
    }

    const after = fs.fstatSync(fd, { bigint: true });
    const outerAfter = fs.lstatSync(filePath, { bigint: true });
    if (
      outerAfter.isSymbolicLink() ||
      totalBytes !== Number(opened.size) ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      outerAfter.dev !== opened.dev ||
      outerAfter.ino !== opened.ino
    ) {
      return failInvalid("changed_during_read", `Component file changed during read: ${filePath}`);
    }

    const finalFp = statFingerprint(after);
    const finalStable = isStatStableForCache(after);
    const sha256 = hasher.digest("hex");
    if (finalStable) {
      setBoundedCacheEntry(canonicalPath, {
        fingerprint: finalFp,
        canonicalPath,
        bytes: totalBytes,
        sha256,
      });
    } else {
      fileDigestCache.delete(canonicalPath);
    }

    return Object.freeze({
      canonicalPath,
      bytes: totalBytes,
      sha256,
      fingerprint: finalFp,
      stableForCache: finalStable,
    });
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Snapshot all regular files and stat metadata under an immutable package/component root
 * without reading file contents. Any added/removed file, symlink, permission change,
 * size change, or mtime/ctime change produces a distinct `treeFingerprint`.
 */
export function snapshotImmutableDirectoryTree(
  rootPath: string,
  options?: {
    readonly maxDepth?: number;
    readonly maxFiles?: number;
    readonly skipTopLevelDirectories?: ReadonlySet<string>;
    readonly onInvalidEntry?: (
      reason:
        | "depth_exceeded"
        | "file_limit_exceeded"
        | "symlink"
        | "unsupported_entry"
        | "invalid_skipped_dir",
      relativePath: string,
    ) => never;
  },
): ImmutableDirectoryTreeSnapshot {
  const canonicalRoot = fs.realpathSync(rootPath);
  const maxDepth = options?.maxDepth ?? 32;
  const maxFiles = options?.maxFiles ?? 4096;
  const skipTopLevel = options?.skipTopLevelDirectories ?? new Set<string>();
  const failEntry = (
    reason:
      | "depth_exceeded"
      | "file_limit_exceeded"
      | "symlink"
      | "unsupported_entry"
      | "invalid_skipped_dir",
    relativePath: string,
  ): never => {
    if (options?.onInvalidEntry) return options.onInvalidEntry(reason, relativePath);
    throw new Error(`Invalid component tree entry (${reason}): ${relativePath}`);
  };

  const files: string[] = [];
  const treeHasher = createHash("sha256");
  let allStable = true;

  const walk = (directory: string, relativeDirectory: string, depth: number): void => {
    if (depth > maxDepth) failEntry("depth_exceeded", relativeDirectory);
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => comparePortableStrings(left.name, right.name));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target, { bigint: true });
      if (relativeDirectory === "" && skipTopLevel.has(entry.name)) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          failEntry("invalid_skipped_dir", relative);
        }
        continue;
      }
      if (stat.isSymbolicLink()) {
        failEntry("symlink", relative);
      }
      if (stat.isDirectory()) {
        treeHasher.update(`D:${relative}:${stat.mode}\n`);
        walk(target, relative, depth + 1);
      } else if (stat.isFile()) {
        files.push(relative);
        if (files.length > maxFiles) {
          failEntry("file_limit_exceeded", relative);
        }
        if (!isStatStableForCache(stat)) {
          allStable = false;
        }
        treeHasher.update(`F:${relative}:${statFingerprint(stat)}\n`);
      } else {
        failEntry("unsupported_entry", relative);
      }
    }
  };

  walk(canonicalRoot, "", 0);
  const sortedFiles = files.sort(comparePortableStrings);
  return Object.freeze({
    canonicalRoot,
    files: Object.freeze(sortedFiles),
    treeFingerprint: treeHasher.digest("hex"),
    allFilesStableForCache: allStable,
  });
}

export function clearImmutableDigestCacheForTest(): void {
  fileDigestCache.clear();
}

export function immutableDigestCacheSizeForTest(): number {
  return fileDigestCache.size;
}
