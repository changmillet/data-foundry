import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { resolvePackageManagerCommand } from "./package-manager-command.ts";

const hostFields = [
  "runner_os",
  "image_os",
  "image_version",
  "os_release",
  "architecture",
  "cpu_models",
  "logical_cpus",
  "available_parallelism",
  "node_version",
  "node_sha256",
  "pnpm_version",
  "pnpm_sha256",
  "lock_sha256",
] as const;
type HostField = (typeof hostFields)[number];
type Field = HostField | "run_id" | "attempt";
type Fact = string | number | string[];
export interface FoundryCiTestHostContext {
  source: string;
  plan_sha256: string;
  index: number;
  outcome: "passed" | "failed" | "cancelled" | "signalled";
  signal: NodeJS.Signals | null;
}

export function foundryCiObservedTestOutcome(
  status: string,
  counts: Record<string, unknown> | null,
  signal: NodeJS.Signals | null,
): FoundryCiTestHostContext["outcome"] {
  if (typeof counts?.failed === "number" && counts.failed > 0) return "failed";
  if (signal !== null) return "signalled";
  if (typeof counts?.cancelled === "number" && counts.cancelled > 0) return "cancelled";
  return status === "passed" ? "passed" : "failed";
}

function hostReader(root: string): (field: Field) => unknown {
  let cpus: ReturnType<typeof os.cpus> | undefined;
  let pnpm: ReturnType<typeof resolvePackageManagerCommand> | undefined;
  const manager = () => (pnpm ??= resolvePackageManagerCommand("pnpm", ["--version"]));
  const cpu = () => (cpus ??= os.cpus());
  const hash = (file: string, limit = 128 * 1024 * 1024) =>
    createHash("sha256").update(readFoundryReleaseArtifact(file, limit)).digest("hex");
  return (field) => {
    switch (field) {
      case "runner_os":
        return process.env.RUNNER_OS;
      case "image_os":
        return process.env.ImageOS;
      case "image_version":
        return process.env.ImageVersion;
      case "os_release":
        return os.release();
      case "architecture":
        return process.arch;
      case "cpu_models":
        return [...new Set(cpu().map((item) => item.model))].sort();
      case "logical_cpus":
        return cpu().length;
      case "available_parallelism":
        return os.availableParallelism();
      case "node_version":
        return process.version;
      case "node_sha256":
        return hash(process.execPath);
      case "pnpm_version":
        return execFileSync(manager().executable, manager().argv, {
          cwd: root,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 1024,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
      case "pnpm_sha256":
        return hash(manager().executable);
      case "lock_sha256":
        return hash(path.join(root, "pnpm-lock.yaml"), 16 * 1024 * 1024);
      case "run_id":
        return process.env.GITHUB_RUN_ID;
      case "attempt":
        return process.env.GITHUB_RUN_ATTEMPT;
    }
    return undefined;
  };
}

function valid(field: Field, value: unknown): value is Fact {
  if (field === "cpu_models")
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 64 &&
      value.every(
        (item: unknown) =>
          typeof item === "string" &&
          item.trim().length > 0 &&
          /^[A-Za-z0-9 ()@+.,_-]{1,160}$/u.test(item),
      )
    );
  if (field === "logical_cpus" || field === "available_parallelism")
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 65536;
  if (typeof value !== "string") return false;
  switch (field) {
    case "runner_os":
      return value === "Windows";
    case "architecture":
      return value === "x64";
    case "image_os":
      return /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/u.test(value);
    case "image_version":
      return /^\d{8}\.\d{1,8}\.\d{1,8}$/u.test(value);
    case "os_release":
      return /^\d{1,6}(?:\.\d{1,6}){1,3}$/u.test(value);
    case "node_version":
      return /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/u.test(value);
    case "pnpm_version":
      return /^\d{1,4}\.\d{1,4}\.\d{1,4}$/u.test(value);
    case "run_id":
      return /^[1-9]\d{0,19}$/u.test(value);
    case "attempt":
      return /^[1-9]\d{0,5}$/u.test(value);
    default:
      return /^[0-9a-f]{64}$/u.test(value);
  }
}

/** Diagnostic-only projection; an omission never changes the test outcome or its gate. */
export function captureFoundryCiTestHost(
  root: string,
  context: FoundryCiTestHostContext,
  read: (field: Field) => unknown = hostReader(root),
) {
  const omissions: Array<{ field: Field; reason: "missing" | "invalid" | "unavailable" }> = [];
  const take = (field: Field): Fact | null => {
    try {
      const value = read(field);
      if (valid(field, value)) return value;
      omissions.push({
        field,
        reason: value === null || value === undefined ? "missing" : "invalid",
      });
    } catch {
      omissions.push({ field, reason: "unavailable" });
    }
    return null;
  };
  const host = Object.fromEntries(hostFields.map((field) => [field, take(field)]));
  const run = take("run_id"),
    attempt = take("attempt");
  return {
    schema: "tiangong-foundry.ci-test-host.v1",
    source: context.source,
    platform: "win32-x64",
    plan_sha256: context.plan_sha256,
    index: context.index,
    run_id: run,
    attempt: attempt === null ? null : Number(attempt),
    outcome: context.outcome,
    signal: context.signal,
    host,
    status: omissions.length ? "partial" : "complete",
    omissions,
    qualification: false,
  };
}
