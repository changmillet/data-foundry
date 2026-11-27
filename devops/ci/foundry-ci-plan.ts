import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import {
  foundryTestWallSeconds,
  isFoundryCiTestPath,
  loadFoundryWindowsExecutionInput,
  planFoundryWindowsShards,
  type FoundryWindowsExecutionInput,
} from "./foundry-ci-windows.ts";

export const foundryCiTestConcurrency = 2;

export const foundryCiPlatformTestConcurrency = Object.freeze({
  "linux-x64": 4,
  "linux-arm64": 4,
  "darwin-arm64": 3,
  "win32-x64": 2,
});

export function foundryCiTestConcurrencyForPlatform(platform: string): number {
  switch (platform) {
    case "linux-x64":
    case "linux-arm64":
      return 4;
    case "darwin-arm64":
      return 3;
    case "win32-x64":
      return 2;
    default:
      throw new Error("Unsupported CI test platform.");
  }
}

export type FoundryCiMode = "full" | "pr-fast" | "docs-only" | "version-only";

export interface FoundryTestShard {
  readonly index: number;
  readonly total: number;
  readonly files: readonly string[];
  readonly estimatedSeconds: number;
  readonly estimatedWallSeconds: number;
  readonly observedScenarioWallSeconds?: number;
}

function estimatedWallSeconds(
  files: readonly string[],
  durations: Readonly<Record<string, number>>,
  concurrency = foundryCiTestConcurrency,
): number {
  return foundryTestWallSeconds(files, durations, concurrency);
}

export interface FoundryTestPlan {
  readonly schema: "tiangong-foundry.ci-test-plan.v1";
  readonly planSha256: string;
  readonly unprofiledFiles: readonly string[];
  readonly shards: readonly FoundryTestShard[];
  readonly platformShards?: Readonly<Record<string, readonly FoundryTestShard[]>>;
}

export function planFoundryTestShards(
  selectedFiles: readonly string[],
  durations: Readonly<Record<string, number>>,
  count: number,
  execution?: FoundryWindowsExecutionInput,
  concurrency = foundryCiTestConcurrency,
): FoundryTestPlan {
  if (!Number.isInteger(count) || count < 1 || count > selectedFiles.length)
    throw new Error("CI shard count must select at least one test file per shard.");
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("CI test concurrency must be a positive integer.");
  const files = [...selectedFiles].sort();
  if (new Set(files).size !== files.length)
    throw new Error("CI test inventory contains duplicate paths.");
  for (const file of files) {
    if (!isFoundryCiTestPath(file))
      throw new Error(`Invalid CI test path: ${JSON.stringify(file)}`);
  }
  for (const [file, duration] of Object.entries(durations)) {
    if (!files.includes(file))
      throw new Error(`CI duration refers to an unknown test file: ${file}`);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error(`Invalid CI test duration: ${file}`);
  }
  const weighted = files.map((file) => ({ file, seconds: durations[file] ?? 1 }));
  if (execution && count >= 10) {
    const shards = planFoundryWindowsShards(weighted, durations, count, execution, concurrency);
    const boundExecution = {
      exclusiveFiles: [...execution.exclusiveFiles].sort(
        (a, b) => a.index - b.index || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
      ),
      retainedFiles: [...new Set(execution.retainedFiles)].sort(),
      observedSeconds: Object.fromEntries(
        Object.entries(execution.observedSeconds).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
      observationsSha256: execution.observationsSha256,
    };
    return Object.freeze({
      schema: "tiangong-foundry.ci-test-plan.v1",
      planSha256: createHash("sha256")
        .update(JSON.stringify({ count, weighted, execution: boundExecution, shards }))
        .digest("hex"),
      unprofiledFiles: Object.freeze(files.filter((file) => durations[file] === undefined)),
      shards: Object.freeze(shards),
    });
  }
  const shards = Array.from({ length: count }, (_, offset) => ({
    index: offset + 1,
    total: count,
    files: [] as string[],
    estimatedSeconds: 0,
  }));
  for (const item of [...weighted].sort(
    (a, b) => b.seconds - a.seconds || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  )) {
    const shard = shards.reduce((least, next) =>
      next.estimatedSeconds < least.estimatedSeconds ? next : least,
    );
    shard.files.push(item.file);
    shard.estimatedSeconds += item.seconds;
  }
  if (shards.some((shard) => shard.files.length === 0))
    throw new Error("CI shard count produced an empty shard.");
  const digestInput =
    concurrency === foundryCiTestConcurrency
      ? { count, weighted }
      : { count, weighted, concurrency };
  const planSha256 = createHash("sha256").update(JSON.stringify(digestInput)).digest("hex");
  return Object.freeze({
    schema: "tiangong-foundry.ci-test-plan.v1",
    planSha256,
    unprofiledFiles: Object.freeze(files.filter((file) => durations[file] === undefined)),
    shards: Object.freeze(
      shards.map((shard) =>
        Object.freeze({
          ...shard,
          estimatedWallSeconds: estimatedWallSeconds(shard.files, durations, concurrency),
          files: Object.freeze(shard.files),
        }),
      ),
    ),
  });
}

function isNormalizedRelativePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !filePath.startsWith("/") &&
    !filePath.includes("\\") &&
    !filePath.includes(":") &&
    path.posix.normalize(filePath) === filePath &&
    !filePath.startsWith("../") &&
    filePath !== ".." &&
    !filePath.split("").some((character) => character.charCodeAt(0) < 32)
  );
}

/** Strict allowlist for PRs eligible for the fast docs-only verification lane. */
export function isFoundryDocsOnlyPath(filePath: string): boolean {
  if (!isNormalizedRelativePath(filePath)) return false;
  return (
    /^[^/]+\.md$/u.test(filePath) ||
    filePath === "test/README.md" ||
    filePath.startsWith("docs/") ||
    filePath.startsWith(".docpact/") ||
    filePath.startsWith("tasks/")
  );
}

const fullQualificationExactPaths = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".nvmrc",
  ".gitattributes",
  "src/package-entry.ts",
  "src/public-api.ts",
  "src/lib/foundry-package-contract.ts",
  "src/lib/foundry-installed-entry.ts",
  "src/lib/foundry-runtime-paths.ts",
]);

const fullQualificationPrefixes = [
  ".github/workflows/",
  "devops/ci/",
  "devops/release/",
  "devops/build/",
  "specs/release/",
  "specs/ci/",
  "src/lib/foundry-managed-",
] as const;

/** Paths touching CI, release, packaging, toolchain, or cross-platform managed-runtime contracts always escalate PRs to full four-platform qualification. */
export function isFoundryFullQualificationPath(filePath: string): boolean {
  if (!isNormalizedRelativePath(filePath)) return true;
  if (fullQualificationExactPaths.has(filePath)) return true;
  if (/^tsconfig(?:\.[a-z-]+)?\.json$/u.test(filePath)) return true;
  return fullQualificationPrefixes.some((prefix) => filePath.startsWith(prefix));
}

export function selectFoundryCiMode(
  eventName: string,
  reusableSource: string | undefined,
  inspection: import("../release/foundry-release-contract.ts").FoundryReleaseChange,
  options?: { readonly forceFull?: boolean },
): FoundryCiMode {
  if (eventName !== "pull_request" || reusableSource !== undefined) return "full";
  if (options?.forceFull === true) return "full";
  if (inspection.release) return "version-only";
  if (!inspection.changedPaths.length) return "full";
  if (inspection.changedPaths.every(isFoundryDocsOnlyPath)) return "docs-only";
  if (inspection.changedPaths.some(isFoundryFullQualificationPath)) return "full";
  return "pr-fast";
}

export function loadFoundryTestPlan(root: string, count = 4): FoundryTestPlan {
  const walk = (relative: string): string[] => {
    const directory = path.join(root, relative);
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
      throw new Error("CI test inventory requires real source directories.");
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`CI test inventory cannot follow links: ${file}`);
      if (entry.isDirectory()) return walk(file);
      return entry.isFile() && file.endsWith(".test.mts") ? [file] : [];
    });
  };
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(root, "specs/ci/test-durations.json"), "utf8"),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CI duration input must be an object.");
  const input = value as Record<string, unknown>;
  if (
    input.schema !== "tiangong-foundry.ci-test-durations.v1" ||
    !input.weights_seconds ||
    typeof input.weights_seconds !== "object" ||
    Array.isArray(input.weights_seconds)
  )
    throw new Error("CI duration input has an unsupported schema.");
  const estimates = input.estimated_weights ?? {};
  if (typeof estimates !== "object" || Array.isArray(estimates))
    throw new Error("CI duration estimates must be a file-to-seconds object.");
  const durations: Record<string, number> = {};
  for (const [file, seconds] of Object.entries({ ...input.weights_seconds, ...estimates })) {
    if (typeof seconds !== "number") throw new Error(`Invalid CI test duration: ${file}`);
    durations[file] = seconds;
  }
  const files = walk("test");
  const selectedDurations = Object.fromEntries(
    files.filter((file) => durations[file] !== undefined).map((file) => [file, durations[file]]),
  );
  const base = planFoundryTestShards(files, selectedDurations, count);
  const counts = input.shards_by_platform;
  if (
    !counts ||
    typeof counts !== "object" ||
    Array.isArray(counts) ||
    JSON.stringify(Object.keys(counts).sort()) !==
      JSON.stringify(Object.keys(foundryCiPlatformHosts).sort())
  )
    throw new Error("CI shard counts must bind every supported platform exactly.");
  const configured = counts as Record<string, unknown>;
  const plans = Object.keys(foundryCiPlatformHosts).map((platform) => {
    const size = configured[platform];
    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > (platform === "win32-x64" ? 16 : 8)
    )
      throw new Error("Invalid platform CI shard count.");
    return [
      platform,
      planFoundryTestShards(
        files,
        selectedDurations,
        size,
        platform === "win32-x64" && size >= 10 && input.windows_execution !== undefined
          ? loadFoundryWindowsExecutionInput(root, files, input.windows_execution)
          : undefined,
        foundryCiTestConcurrencyForPlatform(platform),
      ),
    ] as const;
  });
  return Object.freeze({
    ...base,
    planSha256: createHash("sha256")
      .update(
        JSON.stringify(
          plans.map(([platform, plan]) => ({ platform, plan_sha256: plan.planSha256 })),
        ),
      )
      .digest("hex"),
    platformShards: Object.freeze(
      Object.fromEntries(plans.map(([platform, plan]) => [platform, plan.shards])),
    ),
  });
}

export const foundryCiPlatformHosts = Object.freeze({
  "linux-x64": "ubuntu-latest",
  "linux-arm64": "ubuntu-24.04-arm",
  "darwin-arm64": "macos-latest",
  "win32-x64": "windows-latest",
});

const admissionPriority = new Map<string, number>([
  ["win32-x64", 0],
  ["darwin-arm64", 1],
  ["linux-arm64", 2],
  ["linux-x64", 3],
]);

export function foundryPlatformTestShards(
  plan: FoundryTestPlan,
  platform: string,
): readonly FoundryTestShard[] {
  if (!Object.hasOwn(foundryCiPlatformHosts, platform))
    throw new Error("Unsupported CI test platform.");
  const shards = plan.platformShards?.[platform] ?? plan.shards;
  if (!shards.length) throw new Error("CI platform must select test shards.");
  return shards;
}

export function foundryCiTestMatrix(plan: FoundryTestPlan, selectedPlatforms?: readonly string[]) {
  let allowed: Set<string> | null = null;
  if (selectedPlatforms !== undefined) {
    if (!selectedPlatforms.length) throw new Error("CI matrix must select at least one platform.");
    allowed = new Set<string>();
    for (const platform of selectedPlatforms) {
      if (!Object.hasOwn(foundryCiPlatformHosts, platform))
        throw new Error("Unsupported CI test platform.");
      allowed.add(platform);
    }
  }
  // Admission preference prioritizes slowest/scarcest runners without altering hash inputs.
  const hosts = Object.entries(foundryCiPlatformHosts)
    .filter(([platform]) => allowed === null || allowed.has(platform))
    .sort(
      ([left], [right]) =>
        (admissionPriority.get(left) ?? 99) - (admissionPriority.get(right) ?? 99),
    );
  return {
    include: hosts.flatMap(([platform, os]) =>
      foundryPlatformTestShards(plan, platform).map(({ index: shard }) => ({
        os,
        platform,
        shard,
      })),
    ),
  };
}
