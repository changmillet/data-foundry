import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { migrationCredentialPath } from "./foundry-private-path.ts";
import fs from "node:fs";
import path from "node:path";
import { assertCliRuntimeMatches } from "@tiangong-lca/cli/runtime";
import {
  resolveFoundryOutput,
  type FoundryRuntimeContext,
  type FoundryInputFact,
} from "./foundry-runtime-context.ts";
import { bytes, digest, exact, fail, facts, object, readTaskBytes } from "./foundry-task-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { transferRead } from "./foundry-migration-transfer-io.ts";
import { createRequire } from "node:module";
import {
  transferFileContentFact,
  transferFileFact,
  transferPath,
} from "./foundry-migration-transfer-io.ts";
import type { TaskRuntimeIdentity } from "./foundry-task-types.ts";

export interface TrustedFoundryRuntimeAdoptionQualification {
  readonly sha256: string;
  readonly value: Readonly<Record<string, unknown>>;
}
const trustedQualifications = new WeakSet<object>();

/** The independent host supplies the expected digest; task input cannot grant compatibility. */
export function createFoundryRuntimeAdoptionQualification(input: {
  bytes: Uint8Array;
  expectedSha256: string;
}): TrustedFoundryRuntimeAdoptionQualification {
  const data = Buffer.from(input.bytes);
  if (
    data.length > 8 * 1024 * 1024 ||
    !/^[0-9a-f]{64}$/u.test(input.expectedSha256) ||
    digest(data) !== input.expectedSha256
  )
    fail(
      "runtime_adoption_qualification_untrusted",
      "Qualification must match the host's independently reviewed digest.",
    );
  const value = object(JSON.parse(data.toString("utf8")));
  qualificationShape(value);
  const result = Object.freeze({ sha256: sha256Json(value), value: deepFreeze(value) });
  trustedQualifications.add(result);
  return result;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
export function assertTrustedQualification(
  selection: unknown,
  trusted?: TrustedFoundryRuntimeAdoptionQualification,
) {
  if (
    !trusted ||
    !trustedQualifications.has(trusted) ||
    sha256Json(object(selection).qualification) !== trusted.sha256
  )
    fail(
      "runtime_adoption_qualification_untrusted",
      "Plan/apply require an independently selected host qualification; ordinary input is not authority.",
    );
}
export function verifyEvidence(value: unknown) {
  const selected = facts(value);
  if (!selected.length || selected.length > 64)
    fail("runtime_adoption_evidence_invalid", "Select bounded nonempty qualification evidence.");
  for (const fact of selected) {
    if (!path.isAbsolute(fact.path) || migrationCredentialPath(fact.path))
      fail("runtime_adoption_evidence_invalid", "Evidence must name absolute regular files.");
    const content = transferRead(fact.path, 512 * 1024 * 1024);
    if (content.length !== fact.bytes || digest(content) !== fact.sha256)
      fail("runtime_adoption_evidence_changed", "Adoption evidence or retained input changed.");
  }
  return selected;
}
function qualificationShape(value: Record<string, unknown>) {
  exact(value, [
    "schema",
    "original_runtime",
    "successor_runtime",
    "original_manifest_sha256",
    "successor_manifest_sha256",
    "original_cli",
    "successor_cli",
    "tidas",
    "reviewer",
    "evidence",
    "allowed_changes",
    "runtime_manifests",
    "original_descriptor_sha256",
    "successor_descriptor_sha256",
  ]);
  if (
    value.schema !== "tiangong-foundry.runtime-adoption-qualification.v1" ||
    typeof value.reviewer !== "string" ||
    !value.reviewer.trim() ||
    JSON.stringify(value.allowed_changes) !== '["foundry","cli"]' ||
    ![value.original_manifest_sha256, value.successor_manifest_sha256].every(
      (item) => typeof item === "string" && /^[0-9a-f]{64}$/u.test(item),
    )
  )
    fail(
      "runtime_adoption_qualification_invalid",
      "Require reviewed exact manifests and only the qualified Foundry/CLI change.",
    );
}
function validateAdoptionQualification(
  context: FoundryRuntimeContext,
  selection: Record<string, unknown>,
  originalEntry: string,
  successor: RetainedAdoptionRuntime,
  historical = false,
) {
  const value = object(selection.qualification);
  qualificationShape(value);
  if (
    sha256Json(value.original_runtime) !== sha256Json(selection.original_runtime) ||
    sha256Json(value.successor_runtime) !== sha256Json(successor.identity) ||
    (!historical && context.workspaceManifestSha256 !== value.successor_manifest_sha256)
  )
    fail(
      "runtime_adoption_qualification_mismatch",
      "Compatibility must bind the original identity and independently selected executing manifest.",
    );
  const originalDescriptor = facts([selection.original_descriptor])[0];
  if (
    (!historical &&
      context.runtime.entryRepoRelativePath !== "package-dist/scripts/package-entry.js") ||
    originalDescriptor.sha256 !== value.original_descriptor_sha256 ||
    successor.descriptor.sha256 !== value.successor_descriptor_sha256
  )
    fail(
      "runtime_adoption_qualification_mismatch",
      "Adoption requires the independently qualified complete old/new installed package inventories.",
    );
  verifyEvidence(value.evidence);
  const manifests = verifyEvidence(value.runtime_manifests);
  if (
    manifests.length !== 2 ||
    manifests[0].sha256 !== value.original_manifest_sha256 ||
    manifests[1].sha256 !== value.successor_manifest_sha256
  )
    fail(
      "runtime_adoption_qualification_mismatch",
      "Retained product manifests differ from the qualified pair.",
    );
  const oldCli = object(value.original_cli),
    newCli = object(value.successor_cli);
  exact(oldCli, ["expectation", "files"]);
  exact(newCli, ["expectation", "files"]);
  if (!historical) {
    const current = assertCliRuntimeMatches(newCli.expectation);
    if (sha256Json(current.files) !== sha256Json(newCli.files))
      fail(
        "runtime_adoption_dependency_changed",
        "Successor CLI inventory differs from the qualified exact combination.",
      );
  }
  const oldExpectation = object(oldCli.expectation),
    newExpectation = object(newCli.expectation);
  exact(oldExpectation, [
    "schema",
    "package_version",
    "platform",
    "content_sha256",
    "node_version",
    "node_sha256",
  ]);
  if (
    oldExpectation.schema !== "tiangong-lca.cli-runtime-expectation.v1" ||
    oldExpectation.node_version !== newExpectation.node_version ||
    oldExpectation.node_sha256 !== newExpectation.node_sha256 ||
    oldExpectation.platform !== newExpectation.platform
  )
    fail(
      "runtime_adoption_dependency_changed",
      "Node and platform must remain unchanged in this compatibility protocol.",
    );
  verifyRetainedCli(originalEntry, oldCli);
  verifyRetainedCli(successor.entry.path, newCli);
  const tidas = verifyEvidence(value.tidas);
  if (
    tidas.length !== 2 ||
    tidas[0].sha256 !== tidas[1].sha256 ||
    tidas[0].bytes !== tidas[1].bytes
  )
    fail(
      "runtime_adoption_dependency_changed",
      "Original and successor Toolkit must retain identical executable bytes.",
    );
}

function verifyRetainedCli(entry: string, claim: Record<string, unknown>) {
  const expectation = object(claim.expectation);
  exact(expectation, [
    "schema",
    "package_version",
    "platform",
    "content_sha256",
    "node_version",
    "node_sha256",
  ]);
  if (
    expectation.schema !== "tiangong-lca.cli-runtime-expectation.v1" ||
    typeof expectation.package_version !== "string" ||
    typeof expectation.platform !== "string" ||
    typeof expectation.node_version !== "string" ||
    ![expectation.node_sha256, expectation.content_sha256].every(
      (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value),
    )
  )
    fail("runtime_adoption_dependency_changed", "Retained CLI expectation is invalid.");
  const originalCliRoot = (createRequire(entry).resolve.paths("@tiangong-lca/cli") ?? [])
    .map((directory) => path.join(directory, "@tiangong-lca/cli"))
    .find((directory) => fs.existsSync(path.join(directory, "package.json")));
  if (!originalCliRoot)
    fail("runtime_adoption_dependency_changed", "Original CLI dependency is unavailable.");
  const oldRoot = fs.realpathSync(originalCliRoot);
  const oldFiles = facts(claim.files);
  if (
    !oldFiles.length ||
    oldFiles.length > 10000 ||
    digest(JSON.stringify(oldFiles)) !== expectation.content_sha256
  )
    fail(
      "runtime_adoption_dependency_changed",
      "Original CLI inventory does not match its independent expectation.",
    );
  for (const fact of oldFiles) {
    const previous = transferFileContentFact(transferPath(oldRoot, fact.path));
    if (previous.bytes !== fact.bytes || previous.sha256 !== fact.sha256)
      fail(
        "runtime_adoption_dependency_changed",
        "Original CLI bytes differ from the qualified combination.",
      );
  }
  const oldPackage = object(
    JSON.parse(transferRead(path.join(oldRoot, "package.json"), 1024 * 1024).toString("utf8")),
  );
  if (oldPackage.name !== "@tiangong-lca/cli" || oldPackage.version !== expectation.package_version)
    fail("runtime_adoption_dependency_changed", "Original CLI version differs from qualification.");
}

export interface RetainedAdoptionRuntime {
  readonly root: string;
  readonly identity: TaskRuntimeIdentity;
  readonly entry: FoundryInputFact;
  readonly descriptor: FoundryInputFact;
}

function retainedRuntime(
  entryValue: unknown,
  descriptorValue: unknown,
  expected: unknown,
): RetainedAdoptionRuntime {
  const entry = verifyEvidence([entryValue])[0],
    descriptor = verifyEvidence([descriptorValue])[0];
  const root = path.resolve(entry.path, "../../..");
  if (
    path.relative(root, entry.path).split(path.sep).join("/") !==
      "package-dist/scripts/package-entry.js" ||
    descriptor.path !== path.join(root, "package-dist/assets/foundry-package-descriptor.json")
  )
    fail(
      "runtime_adoption_original_invalid",
      "Retained runtime locators must name one complete installed package.",
    );
  const manifest = transferRead(path.join(root, "package.json"), 1024 * 1024);
  const pkg = object(JSON.parse(manifest.toString("utf8")));
  const identity = {
    package_name: pkg.name,
    package_version: pkg.version,
    manifest_sha256: digest(manifest),
    entry_sha256: entry.sha256,
  };
  if (sha256Json(identity) !== sha256Json(expected))
    fail(
      "runtime_adoption_original_invalid",
      "Retained package identity differs from its qualified transition.",
    );
  const inventory = object(
    JSON.parse(transferRead(descriptor.path, 8 * 1024 * 1024).toString("utf8")),
  );
  if (
    inventory.schema !== "tiangong-foundry.package-descriptor.v1" ||
    !Array.isArray(inventory.files) ||
    inventory.files.length > 5000 ||
    inventory.files_sha256 !== sha256Json(inventory.files)
  )
    fail("runtime_adoption_original_invalid", "Retained package inventory changed.");
  for (const fact of facts(inventory.files)) {
    const current = transferFileContentFact(transferPath(root, fact.path));
    if (current.bytes !== fact.bytes || current.sha256 !== fact.sha256)
      fail("runtime_adoption_original_invalid", "Retained package code or assets changed.");
  }
  return { root, identity: identity as TaskRuntimeIdentity, entry, descriptor };
}

export function currentAdoptionRuntimeFacts(
  context: FoundryRuntimeContext,
): RetainedAdoptionRuntime {
  return retainedRuntime(
    transferFileFact(transferPath(context.runtimeRoot, "package-dist/scripts/package-entry.js")),
    transferFileFact(
      transferPath(context.runtimeRoot, "package-dist/assets/foundry-package-descriptor.json"),
    ),
    currentAdoptionRuntime(context),
  );
}

/** Bind an adopted task's actual selected Toolkit to the independently reviewed executable. */
export function assertRuntimeAdoptionToolkit(
  selected: QualifiedFoundryRuntime | undefined,
  selection: unknown,
): void {
  const tidas = verifyEvidence(object(object(selection).qualification).tidas);
  if (
    !selected ||
    tidas.length !== 2 ||
    fs.realpathSync(selected.tidas.executable_path) !== fs.realpathSync(tidas[1].path) ||
    selected.tidas.expectation.executable.sha256 !== tidas[1].sha256 ||
    selected.tidas.expectation.executable.bytes !== tidas[1].bytes
  )
    fail(
      "runtime_adoption_dependency_changed",
      "Select the exact independently qualified successor Toolkit for this adopted task.",
    );
}

export const TASK_RUNTIME_ADOPTION_SCHEMA = "tiangong-foundry.task-runtime-adoption-plan.v2";
const legacyPlanSchema = "tiangong-foundry.task-runtime-adoption-plan.v1";
const maxAdoptions = 64;
export interface FoundryTaskRuntimeAdoptionInput {
  taskId: string;
  actorId: string;
  mode: "plan" | "apply" | "audit";
  selection?: unknown;
  plan?: unknown;
}
export function currentAdoptionRuntime(context: FoundryRuntimeContext): TaskRuntimeIdentity {
  return {
    package_name: context.runtime.packageName,
    package_version: context.runtime.packageVersion,
    manifest_sha256: context.runtime.packageManifestSha256,
    entry_sha256: context.runtime.entrySha256,
  };
}
export function anchorPath(context: FoundryRuntimeContext) {
  return resolveFoundryOutput(context, `task-runtime-adoptions/${context.taskId}.json`, "state");
}
export function registration(context: FoundryRuntimeContext) {
  const data = transferRead(
    resolveFoundryOutput(context, `task-registrations/${context.taskId}.json`, "state"),
    24 * 1024 * 1024,
  );
  const value = object(JSON.parse(data.toString("utf8")));
  const { registration_sha256, ...payload } = value;
  const job = object(value.job);
  if (
    value.schema !== "tiangong-foundry.task-registration.v1" ||
    registration_sha256 !== sha256Json(payload) ||
    job.workspace_id !== context.workspaceId ||
    job.task_id !== context.taskId ||
    job.actor_id !== context.actorId ||
    !bytes(job).equals(readTaskBytes(context, "foundry-job.json"))
  )
    fail(
      "runtime_adoption_registration_invalid",
      "Original immutable task registration or job changed.",
    );
  return { value, job, sha256: digest(data) };
}
/** Explicit operator-selected evidence does not grant business permission. It authorizes only these exact registrations. */
export function validateSelection(
  context: FoundryRuntimeContext,
  selection: unknown,
  options: { successor?: RetainedAdoptionRuntime; historical?: boolean } = {},
) {
  const value = object(selection);
  const successor = options.successor ?? currentAdoptionRuntimeFacts(context);
  exact(value, [
    "schema",
    "scope",
    "original_entry",
    "original_descriptor",
    "original_runtime",
    "successor_runtime",
    "qualification",
    "writer_handoff",
    "authorization",
  ]);
  if (
    value.schema !== "tiangong-foundry.task-runtime-compatibility-selection.v1" ||
    !Array.isArray(value.scope) ||
    !value.scope.length ||
    value.scope.length > 64 ||
    sha256Json(value.successor_runtime) !== sha256Json(successor.identity)
  )
    fail(
      "runtime_adoption_selection_invalid",
      "Select a bounded exact task roster and the executing compatible runtime.",
    );
  const scope = value.scope.map((item) => {
    const row = object(item);
    exact(row, ["task_id", "registration_sha256"]);
    if (
      typeof row.task_id !== "string" ||
      !/^task-[0-9a-f]{64}-r\d{4}$/u.test(row.task_id) ||
      typeof row.registration_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(row.registration_sha256)
    )
      fail("runtime_adoption_selection_invalid", "Selected registration identities are malformed.");
    return row;
  });
  if (new Set(scope.map((row) => row.task_id)).size !== scope.length)
    fail("runtime_adoption_selection_invalid", "Selected registrations must be unique.");
  const original = facts([value.original_entry])[0],
    authorization = facts([value.authorization])[0];
  for (const fact of [original, authorization]) {
    if (!path.isAbsolute(fact.path))
      fail("runtime_adoption_selection_invalid", "Select absolute regular evidence files.");
    const content = transferRead(fact.path, 16 * 1024 * 1024);
    if (content.length !== fact.bytes || digest(content) !== fact.sha256)
      fail(
        "runtime_adoption_evidence_changed",
        "Independent compatibility or authorization evidence changed.",
      );
  }
  const originalRoot = path.resolve(original.path, "../../..");
  if (
    path.relative(originalRoot, original.path).split(path.sep).join("/") !==
    "package-dist/scripts/package-entry.js"
  )
    fail(
      "runtime_adoption_original_invalid",
      "Select the retained original emitted package entry.",
    );
  const oldManifest = transferRead(path.join(originalRoot, "package.json"), 1024 * 1024);
  const oldJson = object(JSON.parse(oldManifest.toString("utf8")));
  const oldIdentity = {
    package_name: oldJson.name,
    package_version: oldJson.version,
    manifest_sha256: digest(oldManifest),
    entry_sha256: original.sha256,
  };
  const descriptorFact = facts([value.original_descriptor])[0];
  if (
    descriptorFact.path !==
    path.join(originalRoot, "package-dist/assets/foundry-package-descriptor.json")
  )
    fail(
      "runtime_adoption_original_invalid",
      "Select the original package descriptor alongside its entry.",
    );
  const descriptorBytes = transferRead(descriptorFact.path, 8 * 1024 * 1024);
  const descriptor = object(JSON.parse(descriptorBytes.toString("utf8")));
  if (
    descriptorBytes.length !== descriptorFact.bytes ||
    digest(descriptorBytes) !== descriptorFact.sha256 ||
    descriptor.schema !== "tiangong-foundry.package-descriptor.v1" ||
    !Array.isArray(descriptor.files) ||
    descriptor.files.length > 5000 ||
    descriptor.files_sha256 !== sha256Json(descriptor.files)
  )
    fail("runtime_adoption_original_invalid", "Retained original package inventory changed.");
  for (const fact of facts(descriptor.files)) {
    const current = transferFileContentFact(transferPath(originalRoot, fact.path));
    if (current.bytes !== fact.bytes || current.sha256 !== fact.sha256)
      fail("runtime_adoption_original_invalid", "Original package code or assets changed.");
  }
  if (
    sha256Json(oldIdentity) !== sha256Json(value.original_runtime) ||
    (sha256Json(oldIdentity) === sha256Json(successor.identity) &&
      descriptorFact.sha256 === successor.descriptor.sha256 &&
      sha256Json(object(value.qualification).original_cli) ===
        sha256Json(object(value.qualification).successor_cli))
  )
    fail(
      "runtime_adoption_original_invalid",
      "The retained original package must match the predecessor and the qualified complete combination must change.",
    );
  validateAdoptionQualification(context, value, original.path, successor, options.historical);
  const handoff = object(value.writer_handoff);
  exact(handoff, [
    "schema",
    "task_id",
    "actor_id",
    "registration_sha256",
    "writer_stopped",
    "evidence",
    ...(handoff.schema === "tiangong-foundry.runtime-adoption-handoff.v2"
      ? ["predecessor_plan_sha256"]
      : []),
  ]);
  if (
    ![
      "tiangong-foundry.runtime-adoption-handoff.v1",
      "tiangong-foundry.runtime-adoption-handoff.v2",
    ].includes(String(handoff.schema)) ||
    (handoff.schema === "tiangong-foundry.runtime-adoption-handoff.v2" &&
      (typeof handoff.predecessor_plan_sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(handoff.predecessor_plan_sha256))) ||
    handoff.task_id !== context.taskId ||
    handoff.actor_id !== context.actorId ||
    handoff.writer_stopped !== true ||
    !scope.some(
      (row) =>
        row.task_id === handoff.task_id && row.registration_sha256 === handoff.registration_sha256,
    )
  )
    fail(
      "runtime_adoption_writer_not_stopped",
      "Require the original writer's exact stopped-task handoff before adoption.",
    );
  verifyEvidence([handoff.evidence]);
  return { value, scope };
}
export function parsePlan(value: unknown) {
  const plan = object(value);
  exact(plan, [
    "schema",
    "workspace_id",
    "task_id",
    "actor_id",
    "registration_sha256",
    "job_sha256",
    "selection",
    "continuation",
    "prior_context_reports",
    "witness",
    "plan_sha256",
    ...(plan.schema === TASK_RUNTIME_ADOPTION_SCHEMA
      ? ["predecessor_plan_sha256", "successor_entry", "successor_descriptor"]
      : []),
  ]);
  const { plan_sha256, ...payload } = plan;
  if (
    ![TASK_RUNTIME_ADOPTION_SCHEMA, legacyPlanSchema].includes(String(plan.schema)) ||
    (plan.schema === TASK_RUNTIME_ADOPTION_SCHEMA &&
      plan.predecessor_plan_sha256 !== null &&
      (typeof plan.predecessor_plan_sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(plan.predecessor_plan_sha256))) ||
    !["preparation_only", "original_owner_recovery"].includes(String(plan.continuation)) ||
    plan_sha256 !== sha256Json(payload)
  )
    fail("runtime_adoption_plan_invalid", "Select a complete immutable adoption plan.");
  const reports = facts(plan.prior_context_reports);
  if (
    reports.length > 64 ||
    reports.some(
      (fact) =>
        path.isAbsolute(fact.path) ||
        path.basename(fact.path) !== "contract-report.json" ||
        fact.path.split(/[\\/]/u).includes(".."),
    )
  )
    fail(
      "runtime_adoption_plan_invalid",
      "Prior context report bindings must be bounded task-local facts.",
    );
  return plan;
}

export function adoptionSuccessorPath(context: FoundryRuntimeContext, predecessor: string) {
  if (!/^[0-9a-f]{64}$/u.test(predecessor))
    fail("runtime_adoption_plan_invalid", "Predecessor digest is invalid.");
  return resolveFoundryOutput(
    context,
    `task-runtime-adoptions/${context.taskId}/successors/${predecessor}.json`,
    "state",
  );
}

function readAdoptionPlans(context: FoundryRuntimeContext) {
  if (!context.taskId || !fs.existsSync(anchorPath(context))) return null;
  const anchor = object(JSON.parse(transferRead(anchorPath(context), 64 * 1024).toString("utf8")));
  exact(anchor, ["schema", "workspace_id", "task_id", "plan_sha256", "receipt_sha256"]);
  if (
    anchor.schema !== "tiangong-foundry.task-runtime-adoption-anchor.v1" ||
    anchor.workspace_id !== context.workspaceId ||
    anchor.task_id !== context.taskId ||
    typeof anchor.plan_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(anchor.plan_sha256)
  )
    fail(
      "runtime_adoption_anchor_invalid",
      "Runtime adoption anchor does not belong to this task.",
    );
  const plans: Record<string, unknown>[] = [];
  let pointer = anchor;
  let totalBytes = 0;
  for (;;) {
    if (
      plans.length >= maxAdoptions ||
      plans.some((plan) => plan.plan_sha256 === pointer.plan_sha256)
    )
      fail(
        "runtime_adoption_limit",
        "Runtime adoption chain exceeds its bound or repeats a receipt.",
      );
    const content = transferRead(
      resolveFoundryOutput(context, `runtime-adoptions/${pointer.plan_sha256}.json`),
      16 * 1024 * 1024,
    );
    totalBytes += content.length;
    if (totalBytes > 64 * 1024 * 1024)
      fail("runtime_adoption_limit", "Runtime adoption receipts exceed 64 MiB.");
    if (digest(content) !== pointer.receipt_sha256)
      fail("runtime_adoption_receipt_changed", "Runtime adoption receipt changed.");
    const plan = parsePlan(JSON.parse(content.toString("utf8")));
    const predecessor = plans.at(-1)?.plan_sha256 ?? null;
    if (
      plan.plan_sha256 !== pointer.plan_sha256 ||
      (plan.predecessor_plan_sha256 ?? null) !== predecessor
    )
      fail(
        "runtime_adoption_binding_changed",
        "Runtime adoption predecessor differs from its immutable link.",
      );
    plans.push(plan);
    const nextPath = adoptionSuccessorPath(context, String(plan.plan_sha256));
    if (!fs.existsSync(nextPath)) break;
    const nextBytes = transferRead(nextPath, 64 * 1024);
    const next = object(JSON.parse(nextBytes.toString("utf8")));
    exact(next, [
      "schema",
      "workspace_id",
      "task_id",
      "predecessor_plan_sha256",
      "plan_sha256",
      "receipt_sha256",
    ]);
    if (
      next.schema !== "tiangong-foundry.task-runtime-adoption-successor.v1" ||
      next.workspace_id !== context.workspaceId ||
      next.task_id !== context.taskId ||
      next.predecessor_plan_sha256 !== plan.plan_sha256 ||
      typeof next.plan_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(next.plan_sha256)
    )
      fail("runtime_adoption_anchor_invalid", "Runtime adoption successor link changed.");
    if (
      !nextBytes.equals(
        bytes({
          schema: next.schema,
          workspace_id: next.workspace_id,
          task_id: next.task_id,
          plan_sha256: next.plan_sha256,
          receipt_sha256: next.receipt_sha256,
          predecessor_plan_sha256: next.predecessor_plan_sha256,
        }),
      )
    )
      fail(
        "runtime_adoption_anchor_invalid",
        "Immutable successor link bytes differ from the native writer contract.",
      );
    pointer = next;
  }
  return plans;
}

export interface FoundryTaskRuntimeAdoptionChain {
  readonly plans: readonly Readonly<Record<string, unknown>>[];
  readonly tip: Readonly<Record<string, unknown>>;
  readonly runtimes: readonly RetainedAdoptionRuntime[];
  readonly retained_runtime_roots: readonly string[];
  readonly prior_context_reports: readonly FoundryInputFact[];
}

/** Inspect anchored historical proofs; a locator for a legacy tip cannot replace its stored pair claims. */
export function readFoundryTaskRuntimeAdoptionChain(
  context: FoundryRuntimeContext,
  legacyTipSelection?: unknown,
): FoundryTaskRuntimeAdoptionChain | null {
  const plans = readAdoptionPlans(context);
  if (!plans) return null;
  const registered = registration(context),
    runtimes: RetainedAdoptionRuntime[] = [];
  const reports = new Map<string, FoundryInputFact>();
  let previous: Record<string, unknown> | undefined;
  for (const [index, plan] of plans.entries()) {
    const value = object(plan.selection);
    const next = plans[index + 1] ? object(plans[index + 1].selection) : null;
    let successor: RetainedAdoptionRuntime;
    if (plan.schema === TASK_RUNTIME_ADOPTION_SCHEMA)
      successor = retainedRuntime(
        plan.successor_entry,
        plan.successor_descriptor,
        value.successor_runtime,
      );
    else if (next)
      successor = retainedRuntime(
        next.original_entry,
        next.original_descriptor,
        value.successor_runtime,
      );
    else if (legacyTipSelection) {
      const locator = object(legacyTipSelection);
      successor = retainedRuntime(
        locator.original_entry,
        locator.original_descriptor,
        value.successor_runtime,
      );
    } else if (
      sha256Json(value.successor_runtime) === sha256Json(currentAdoptionRuntime(context))
    ) {
      successor = currentAdoptionRuntimeFacts(context);
    } else
      fail(
        "runtime_adoption_legacy_locator_required",
        "Retain an exact installed successor locator for the legacy adoption tip.",
      );
    const selected = validateSelection(context, value, { successor, historical: true });
    const original = retainedRuntime(
      value.original_entry,
      value.original_descriptor,
      value.original_runtime,
    );
    const expectedOriginal = previous
      ? object(previous.selection).successor_runtime
      : registered.job.runtime_identity;
    if (
      !selected.scope.some(
        (row) => row.task_id === context.taskId && row.registration_sha256 === registered.sha256,
      ) ||
      sha256Json(value.original_runtime) !== sha256Json(expectedOriginal)
    )
      fail(
        "runtime_adoption_scope_mismatch",
        "Retained transition differs from its registered predecessor.",
      );
    if (
      plan.workspace_id !== context.workspaceId ||
      plan.task_id !== context.taskId ||
      plan.actor_id !== context.actorId ||
      plan.registration_sha256 !== registered.sha256 ||
      plan.job_sha256 !== digest(bytes(registered.job))
    )
      fail("runtime_adoption_binding_changed", "Runtime adoption registration changed.");
    if (previous) {
      const prior = object(object(previous.selection).qualification),
        current = object(value.qualification);
      const retained = runtimes.at(-1)!;
      const handoff = object(value.writer_handoff);
      const priorToolkit = facts(prior.tidas)[1],
        originalToolkit = facts(current.tidas)[0];
      if (
        sha256Json(original) !== sha256Json(retained) ||
        current.original_manifest_sha256 !== prior.successor_manifest_sha256 ||
        sha256Json(current.original_cli) !== sha256Json(prior.successor_cli) ||
        originalToolkit.sha256 !== priorToolkit.sha256 ||
        originalToolkit.bytes !== priorToolkit.bytes ||
        handoff.predecessor_plan_sha256 !== previous.plan_sha256 ||
        (previous.continuation === "original_owner_recovery" &&
          plan.continuation !== "original_owner_recovery")
      )
        fail(
          "runtime_adoption_binding_changed",
          "Successor transition cannot reinterpret or clear its historical predecessor proof.",
        );
    } else runtimes.push(original);
    for (const fact of facts(plan.prior_context_reports)) {
      const data = readTaskBytes(context, fact.path);
      const existing = reports.get(fact.path);
      if (
        data.length !== fact.bytes ||
        digest(data) !== fact.sha256 ||
        (existing && sha256Json(existing) !== sha256Json(fact))
      )
        fail("runtime_adoption_evidence_changed", "Retained context report changed.");
      reports.set(fact.path, fact);
    }
    if (
      previous &&
      facts(previous.prior_context_reports).some(
        (fact) =>
          !facts(plan.prior_context_reports).some(
            (current) => sha256Json(current) === sha256Json(fact),
          ),
      )
    )
      fail(
        "runtime_adoption_binding_changed",
        "Successor transition must retain preceding context facts.",
      );
    runtimes.push(successor);
    previous = plan;
  }
  return {
    plans,
    tip: plans.at(-1)!,
    runtimes,
    retained_runtime_roots: runtimes.map((runtime) => runtime.root),
    prior_context_reports: [...reports.values()],
  };
}

export function readFoundryTaskRuntimeAdoption(context: FoundryRuntimeContext) {
  const chain = readFoundryTaskRuntimeAdoptionChain(context);
  if (!chain) return null;
  const current = currentAdoptionRuntimeFacts(context);
  if (
    sha256Json(object(chain.tip.selection).successor_runtime) !== sha256Json(current.identity) ||
    current.descriptor.sha256 !== chain.runtimes.at(-1)!.descriptor.sha256
  )
    fail("task_runtime_changed", "Only the current adoption tip may continue this Task.");
  verifyRetainedCli(
    current.entry.path,
    object(object(object(chain.tip.selection).qualification).successor_cli),
  );
  return chain.tip;
}
export function assertAdoptedRuntimeToolkit(
  context: FoundryRuntimeContext,
  selected: QualifiedFoundryRuntime | undefined,
  allowTransition = false,
): void {
  if (!context.taskId || !fs.existsSync(anchorPath(context))) return;
  // Only the explicit plan/apply caller may inspect a future combination; its writer verifies
  // every stored transition and the independently selected complete old/new pair before recording it.
  if (allowTransition) return;
  const adopted = readFoundryTaskRuntimeAdoption(context);
  if (adopted) assertRuntimeAdoptionToolkit(selected, adopted.selection);
}

export function assertTaskRuntimeIdentity(context: FoundryRuntimeContext, original: unknown): void {
  if (
    !fs.existsSync(anchorPath(context)) &&
    sha256Json(original) === sha256Json(currentAdoptionRuntime(context))
  )
    return;
  const adoption = readFoundryTaskRuntimeAdoption(context);
  if (adoption?.continuation === "original_owner_recovery" && context.workspaceAccess === "write")
    fail(
      "runtime_adoption_original_recovery_required",
      "Retained finalization or attempt history requires the original runtime owner; adoption cannot renew a grant or replay a write.",
    );
  if (!adoption || sha256Json(registration(context).job.runtime_identity) !== sha256Json(original))
    fail(
      "task_runtime_changed",
      "Task runtime identity changed; use the pinned runtime or explicit same-task adoption.",
    );
}
