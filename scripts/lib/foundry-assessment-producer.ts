import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { readTaskBytes } from "./foundry-task-io.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { readFoundryTaskRuntimeAdoptionChain } from "./foundry-task-runtime-adoption.ts";

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fail(): never {
  throw new FoundryContextError(
    "workflow_assessment_invalid",
    "The retained assessment producer is not proven by this task's original receipt and runtime identity.",
  );
}

/** Retain producer locator meaning; this proof permits no execution of the old package or old stages. */
export function verifyRegisteredAssessmentProducer(
  context: FoundryRuntimeContext,
  entry: ArtifactEntry,
  value: Record<string, unknown>,
  entries: readonly ArtifactEntry[],
): string {
  const assessedBytes = readTaskBytes(context, entry.path);
  if (
    assessedBytes.length !== entry.bytes ||
    hash(assessedBytes) !== entry.sha256 ||
    sha256Json(JSON.parse(assessedBytes.toString("utf8"))) !== sha256Json(value)
  )
    fail();
  if (typeof value.owner_base !== "string" || !path.isAbsolute(value.owner_base)) fail();
  const base = path.resolve(value.owner_base);
  if (base === context.assetRoot) return base;
  try {
    if (fs.realpathSync(base) !== base || !fs.statSync(base).isDirectory()) fail();
    const jobBytes = readTaskBytes(context, "foundry-job.json"),
      job: unknown = JSON.parse(jobBytes.toString("utf8"));
    const receiptBytes = readTaskBytes(context, entry.receipt.path),
      receipt: unknown = JSON.parse(receiptBytes.toString("utf8"));
    if (
      hash(receiptBytes) !== entry.receipt.sha256 ||
      !object(job) ||
      !object(job.runtime_identity) ||
      job.task_id !== context.taskId ||
      job.actor_id !== context.actorId ||
      !object(receipt) ||
      receipt.status !== "completed" ||
      receipt.mode !== "deterministic-local" ||
      receipt.job_sha256 !== hash(jobBytes) ||
      !object(receipt.plan) ||
      typeof receipt.plan.path !== "string" ||
      !Array.isArray(receipt.outputs)
    )
      fail();
    const planBytes = readTaskBytes(context, receipt.plan.path),
      plan: unknown = JSON.parse(planBytes.toString("utf8"));
    if (
      hash(planBytes) !== receipt.plan.sha256 ||
      !object(plan) ||
      plan.command !== "dataset-workflow-assessment" ||
      plan.operation_id !== entry.operation_id ||
      plan.job_sha256 !== hash(jobBytes) ||
      plan.input_scope_sha256 !== entry.input_scope_sha256 ||
      !receipt.outputs.some(
        (item) =>
          object(item) &&
          item.path === entry.path &&
          item.bytes === entry.bytes &&
          item.sha256 === entry.sha256,
      )
    )
      fail();
    const packageFile = path.join(base, "package.json"),
      packageBytes = fs.readFileSync(packageFile),
      pkg: unknown = JSON.parse(packageBytes.toString("utf8"));
    const chain = readFoundryTaskRuntimeAdoptionChain(context);
    const expectedRuntime =
      chain?.runtimes.find((runtime) => runtime.root === base)?.identity ?? job.runtime_identity;
    if (
      !object(pkg) ||
      !object(pkg.foundryRuntime) ||
      pkg.name !== "@tiangong-lca/foundry" ||
      pkg.name !== expectedRuntime.package_name ||
      pkg.version !== expectedRuntime.package_version ||
      hash(packageBytes) !== expectedRuntime.manifest_sha256 ||
      pkg.foundryRuntime.asset_root !== "."
    )
      fail();
    const declared = [
      pkg.foundryRuntime.package_entry,
      pkg.foundryRuntime.emitted_entry,
      pkg.foundryRuntime.source_entry,
    ];
    const runtimeIdentity = expectedRuntime;
    if (
      !declared.some((candidate) => {
        if (typeof candidate !== "string") return false;
        const file = path.resolve(base, candidate);
        if (
          !file.startsWith(`${base}${path.sep}`) ||
          !fs.existsSync(file) ||
          fs.realpathSync(file) !== file ||
          !fs.statSync(file).isFile()
        )
          return false;
        return hash(fs.readFileSync(file)) === runtimeIdentity.entry_sha256;
      })
    )
      fail();
    const descriptorPath = path.join(base, "package-dist/assets/foundry-package-descriptor.json");
    if (fs.existsSync(descriptorPath) && !chain) {
      const currentDescriptorPath = path.join(
        context.runtimeRoot,
        "package-dist/assets/foundry-package-descriptor.json",
      );
      const descriptorBytes = fs.readFileSync(descriptorPath);
      if (
        !fs.existsSync(currentDescriptorPath) ||
        hash(descriptorBytes) !== hash(fs.readFileSync(currentDescriptorPath))
      )
        fail();
      const descriptor: unknown = JSON.parse(descriptorBytes.toString("utf8"));
      if (
        !object(descriptor) ||
        !Array.isArray(descriptor.files) ||
        descriptor.files.length > 5000 ||
        descriptor.files_sha256 !== sha256Json(descriptor.files)
      )
        fail();
      for (const item of descriptor.files) {
        if (
          !object(item) ||
          typeof item.path !== "string" ||
          typeof item.sha256 !== "string" ||
          !Number.isSafeInteger(item.bytes)
        )
          fail();
        const file = path.resolve(base, item.path);
        if (
          path.isAbsolute(item.path) ||
          !file.startsWith(base + path.sep) ||
          fs.realpathSync(file) !== file
        )
          fail();
        const content = fs.readFileSync(file);
        if (content.length !== item.bytes || hash(content) !== item.sha256) fail();
      }
    }
    // Original relative authoring locators must still name exact registered files in this task.
    if (!Array.isArray(value.sets)) fail();
    for (const raw of value.sets) {
      if (!object(raw) || typeof raw.authoring_manifest !== "string") fail();
      const file = resolveFoundryOutput(context, raw.authoring_manifest);
      const verify = (selected: string) => {
        const registered = entries.find(
          (item) => resolveFoundryOutput(context, item.path) === selected,
        );
        if (!registered) fail();
        const bytes = readTaskBytes(context, path.relative(context.taskRoot!, selected));
        if (bytes.length !== registered.bytes || hash(bytes) !== registered.sha256) fail();
        return bytes;
      };
      const manifest: unknown = JSON.parse(verify(file).toString("utf8"));
      if (!object(manifest) || !Array.isArray(manifest.tasks)) fail();
      for (const task of manifest.tasks) {
        if (!object(task) || !object(task.files) || typeof task.files.task_json !== "string")
          fail();
        const resolved = resolveFoundryOutput(context, path.resolve(base, task.files.task_json));
        verify(resolved);
      }
    }
    return base;
  } catch {
    return fail();
  }
}

/** A retained set keeps the locator base of the operation that actually produced its manifest. */
export function registeredAssessmentSetProducerBase(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  set: Record<string, unknown>,
): string {
  const manifestEntry = entries.find(
    (item) => resolveFoundryOutput(context, item.path) === set.authoring_manifest,
  );
  const producerEntry =
    manifestEntry &&
    entries.find(
      (item) =>
        item.operation_id === manifestEntry.operation_id &&
        item.command === "dataset-workflow-assessment" &&
        path.basename(item.path) === "foundry-assessment.json",
    );
  if (!producerEntry) fail();
  const bytes = readTaskBytes(context, producerEntry.path);
  if (bytes.length !== producerEntry.bytes || hash(bytes) !== producerEntry.sha256) fail();
  const producer: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    !object(producer) ||
    !Array.isArray(producer.sets) ||
    !producer.sets.some((item) => object(item) && sha256Json(item) === sha256Json(set))
  )
    fail();
  return verifyRegisteredAssessmentProducer(context, producerEntry, producer, entries);
}
