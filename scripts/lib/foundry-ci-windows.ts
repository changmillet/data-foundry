import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FoundryTestShard } from "./foundry-ci-plan.ts";

export interface FoundryWindowsExecutionInput {
  readonly exclusiveFiles: readonly Readonly<{ file: string; index: number }>[];
  readonly retainedFiles: readonly string[];
  readonly observedSeconds: Readonly<Record<string, number>>;
  readonly observationsSha256: string;
}
const exclusiveFiles = [
  { file: "test/scenarios/foundry-public-native-draft.test.mts", index: 1 },
  { file: "test/scenarios/foundry-repair-successor.test.mts", index: 9 },
] as const;
export const isFoundryCiTestPath = (value: string) =>
  value.startsWith("test/") &&
  value.endsWith(".test.mts") &&
  path.posix.normalize(value) === value &&
  !value.includes("\\") &&
  !value.includes(":") &&
  !value.split("").some((character) => character.charCodeAt(0) < 32);

export function foundryTestWallSeconds(
  files: readonly string[],
  durations: Readonly<Record<string, number>>,
  concurrency: number,
): number {
  const workers = Array.from({ length: concurrency }, () => 0);
  for (const file of [...files].sort()) {
    const first = workers.reduce(
      (least, next, index) => (next < workers[least] ? index : least),
      0,
    );
    workers[first] += durations[file] ?? 1;
  }
  return Math.max(...workers);
}

/** Declared retained callers remain protected. New or source-changed files are conservatively retained. */
export function foundryRetainedTestFiles(
  root: string,
  files: readonly string[],
  registered: readonly string[],
  ordinarySourceHashes: Readonly<Record<string, string>>,
): string[] {
  const retained = new Set(registered);
  return files
    .filter((file) => {
      if (!isFoundryCiTestPath(file)) throw new Error("Invalid CI test path.");
      if (retained.has(file)) return true;
      const absolute = path.join(root, file);
      if (!fs.lstatSync(absolute).isFile())
        throw new Error("CI execution classes require regular source files.");
      return (
        createHash("sha256")
          .update(fs.readFileSync(absolute, "utf8").replace(/\r\n/gu, "\n"))
          .digest("hex") !== ordinarySourceHashes[file]
      );
    })
    .sort();
}

export function loadFoundryWindowsExecutionInput(
  root: string,
  files: readonly string[],
  reference: unknown,
): FoundryWindowsExecutionInput {
  if (!reference || typeof reference !== "object" || Array.isArray(reference))
    throw new Error("Invalid Windows observation reference.");
  const ref = reference as Record<string, unknown>;
  if (
    ref.file !== "specs/ci/windows-test-observations.json" ||
    typeof ref.canonical_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(ref.canonical_sha256)
  )
    throw new Error("Invalid Windows observation reference.");
  const filename = path.join(root, ref.file);
  if (!fs.existsSync(filename)) throw new Error("Windows observation input is missing.");
  if (!fs.lstatSync(filename).isFile()) throw new Error("Invalid Windows observation input.");
  const bytes = fs.readFileSync(filename);
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid Windows observation evidence.");
  const value = parsed as Record<string, unknown>;
  const records = value.files;
  const ordinary = value.ordinary_files;
  const retained = value.retained_files;
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (digest !== ref.canonical_sha256)
    throw new Error("Windows observation input differs from its source binding.");
  if (
    value.schema !== "tiangong-foundry.windows-test-observations.v1" ||
    value.platform !== "win32-x64" ||
    JSON.stringify(value.columns) !== '["seconds","source_sha256_lf"]' ||
    typeof value.source !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.source) ||
    typeof value.source_tree !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.source_tree) ||
    typeof value.run_id !== "string" ||
    !/^[1-9]\d*$/u.test(value.run_id) ||
    value.attempt !== 1 ||
    typeof value.prior_plan_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.prior_plan_sha256) ||
    !records ||
    typeof records !== "object" ||
    Array.isArray(records) ||
    !ordinary ||
    typeof ordinary !== "object" ||
    Array.isArray(ordinary) ||
    !Array.isArray(retained) ||
    !retained.every((file) => typeof file === "string" && isFoundryCiTestPath(file)) ||
    new Set(retained).size !== retained.length ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length !== 10
  )
    throw new Error("Invalid Windows observation evidence.");
  const observedSeconds: Record<string, number> = {},
    ordinarySourceHashes: Record<string, string> = {};
  for (const [file, row] of Object.entries(records)) {
    if (
      !isFoundryCiTestPath(file) ||
      !Array.isArray(row) ||
      row.length !== 2 ||
      typeof row[0] !== "number" ||
      !Number.isFinite(row[0]) ||
      row[0] <= 0 ||
      typeof row[1] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(row[1])
    )
      throw new Error("Invalid Windows observation duration/source.");
    observedSeconds[file] = row[0];
    ordinarySourceHashes[file] = row[1];
  }
  if (!Object.keys(observedSeconds).length) throw new Error("Empty Windows observation evidence.");
  for (const [file, hash] of Object.entries(ordinary)) {
    if (
      !isFoundryCiTestPath(file) ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(hash) ||
      retained.includes(file)
    )
      throw new Error("Invalid Windows ordinary execution class.");
    ordinarySourceHashes[file] = hash;
  }
  if (
    createHash("sha256")
      .update(JSON.stringify(Object.keys(observedSeconds).sort()))
      .digest("hex") !== value.inventory_sha256
  )
    throw new Error("Windows observation inventory differs from its digest.");
  const indices = new Set<number>(),
    ids = new Set<string>();
  for (const item of value.artifacts) {
    const row = item as Record<string, unknown>;
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      typeof row.index !== "number" ||
      !Number.isInteger(row.index) ||
      row.index < 1 ||
      row.index > 10 ||
      indices.has(row.index) ||
      typeof row.id !== "string" ||
      !/^[1-9]\d*$/u.test(row.id) ||
      ids.has(row.id) ||
      ![row.archive_sha256, row.events_sha256].every(
        (x) => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x),
      )
    )
      throw new Error("Invalid Windows observation artifact.");
    indices.add(row.index);
    ids.add(row.id);
  }
  return {
    exclusiveFiles,
    retainedFiles: foundryRetainedTestFiles(
      root,
      files,
      retained as string[],
      ordinarySourceHashes,
    ),
    observedSeconds,
    observationsSha256: digest,
  };
}

export function planFoundryWindowsShards(
  weighted: readonly Readonly<{ file: string; seconds: number }>[],
  durations: Readonly<Record<string, number>>,
  count: number,
  execution: FoundryWindowsExecutionInput,
  concurrency: number,
): readonly FoundryTestShard[] {
  const files = weighted.map((x) => x.file),
    observed = execution.observedSeconds;
  if (count !== 10 || concurrency !== 2 || !/^[a-f0-9]{64}$/u.test(execution.observationsSha256))
    throw new Error("Invalid Windows execution policy.");
  for (const [file, time] of Object.entries(observed))
    if (!isFoundryCiTestPath(file) || !Number.isFinite(time) || time <= 0)
      throw new Error("Invalid Windows observation duration.");
  if (
    execution.exclusiveFiles.length > 2 ||
    execution.exclusiveFiles.some((x) => !isFoundryCiTestPath(x.file)) ||
    execution.retainedFiles.some((file) => !isFoundryCiTestPath(file))
  )
    throw new Error("Invalid Windows execution-class input.");
  if (
    new Set(execution.exclusiveFiles.map((x) => x.file)).size !== execution.exclusiveFiles.length ||
    new Set(execution.exclusiveFiles.map((x) => x.index)).size !==
      execution.exclusiveFiles.length ||
    execution.exclusiveFiles.some(
      (x) => !Number.isInteger(x.index) || x.index < 1 || x.index > count,
    )
  )
    throw new Error("Invalid Windows exclusive partitions.");
  const reservations = execution.exclusiveFiles.filter(({ file }) => files.includes(file));
  const shards = Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    total: count,
    files: [] as string[],
    estimatedSeconds: 0,
  }));
  for (const { file, index } of reservations) {
    shards[index - 1].files.push(file);
    shards[index - 1].estimatedSeconds = durations[file] ?? 1;
  }
  const exclusive = new Set(reservations.map((x) => x.file)),
    reservedIndices = new Set(reservations.map((x) => x.index));
  const other = shards.filter((x) => !reservedIndices.has(x.index));
  const retained = new Set(
    execution.retainedFiles.filter((file) => files.includes(file) && !exclusive.has(file)),
  );
  const cap = Math.ceil(retained.size / other.length);
  const fileCap = Math.ceil((files.length - reservations.length) / other.length);
  const scenario = Object.fromEntries(
    files.map((file) => [file, observed[file] ?? durations[file] ?? 1]),
  );
  for (const item of [...weighted].sort(
    (a, b) =>
      Number(retained.has(b.file)) - Number(retained.has(a.file)) ||
      Math.max(b.seconds, scenario[b.file]) - Math.max(a.seconds, scenario[a.file]) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  )) {
    if (exclusive.has(item.file)) continue;
    const choices = other
      .filter(
        (s) =>
          s.files.length < fileCap &&
          (!retained.has(item.file) || s.files.filter((f) => retained.has(f)).length < cap),
      )
      .map((s) => {
        const formal = foundryTestWallSeconds([...s.files, item.file], durations, concurrency);
        const measured = foundryTestWallSeconds([...s.files, item.file], scenario, concurrency);
        return { shard: s, score: Math.max(formal, measured), formal };
      })
      .sort(
        (a, b) =>
          a.score - b.score ||
          a.formal - b.formal ||
          a.shard.files.length - b.shard.files.length ||
          a.shard.index - b.shard.index,
      );
    if (!choices.length) throw new Error("Windows execution-class capacity is exhausted.");
    choices[0].shard.files.push(item.file);
    choices[0].shard.estimatedSeconds += item.seconds;
  }
  return shards.map((s) => {
    const estimatedWallSeconds = foundryTestWallSeconds(s.files, durations, concurrency);
    const observedScenarioWallSeconds = foundryTestWallSeconds(s.files, scenario, concurrency);
    if (
      !s.files.length ||
      [estimatedWallSeconds, observedScenarioWallSeconds].some((x) => x * 1.2 + 90 >= 2400)
    )
      throw new Error("Windows partition exceeds the unchanged planning budget.");
    return Object.freeze({
      ...s,
      files: Object.freeze(s.files),
      estimatedWallSeconds,
      observedScenarioWallSeconds,
    });
  });
}
