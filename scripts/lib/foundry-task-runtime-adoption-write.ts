import fs from "node:fs";
import path from "node:path";
import { withBatchRunLock } from "@tiangong-lca/cli/batch";
import {
  assertFoundryWorkspaceWrite,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { bytes, digest, fail, facts, object, readTaskBytes, reference } from "./foundry-task-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { transferWriteOnce } from "./foundry-migration-transfer-io.ts";
import {
  readFoundryTaskArtifactIndex,
  verifyFoundryTaskArtifactLineage,
} from "./foundry-task-store.ts";
import { readOwnerExecutionRequests } from "./foundry-owner-execution-store.ts";
import type { FoundryFacadeTaskRecord } from "./foundry-facade-store.ts";
import type { FoundryTaskJob } from "./foundry-task-types.ts";
import {
  TASK_RUNTIME_ADOPTION_SCHEMA,
  assertTrustedQualification,
  verifyEvidence,
  registration,
  validateSelection,
  parsePlan,
  readFoundryTaskRuntimeAdoption,
  readFoundryTaskRuntimeAdoptionChain,
  currentAdoptionRuntimeFacts,
  adoptionSuccessorPath,
  type TrustedFoundryRuntimeAdoptionQualification,
} from "./foundry-task-runtime-adoption.ts";

function validateTask(
  context: FoundryRuntimeContext,
  record: FoundryFacadeTaskRecord,
  selection: unknown,
  reapplyingPlanSha256?: unknown,
) {
  const selected = validateSelection(context, selection),
    registered = registration(context);
  const chain = readFoundryTaskRuntimeAdoptionChain(context, selection);
  const reapplying = chain?.tip.plan_sha256 === reapplyingPlanSha256;
  const predecessor = reapplying ? chain?.plans.at(-2) : chain?.tip;
  const expectedOriginal = predecessor
    ? object(predecessor.selection).successor_runtime
    : registered.job.runtime_identity;
  if (
    record.spec.lane !== "source-evidence-dataset-development" ||
    record.spec.preparation ||
    record.spec.repair ||
    !record.spec.seed ||
    !selected.scope.some(
      (row) => row.task_id === context.taskId && row.registration_sha256 === registered.sha256,
    ) ||
    sha256Json(expectedOriginal) !== sha256Json(selected.value.original_runtime)
  )
    fail(
      "runtime_adoption_scope_mismatch",
      "Adoption is limited to selected unchanged source-evidence registrations.",
    );
  if (predecessor) {
    const priorQualification = object(object(predecessor.selection).qualification);
    const currentQualification = object(selected.value.qualification);
    const retained =
      chain!.runtimes[reapplying ? chain!.runtimes.length - 2 : chain!.runtimes.length - 1];
    const priorToolkit = facts(priorQualification.tidas)[1],
      originalToolkit = facts(currentQualification.tidas)[0];
    if (
      sha256Json(selected.value.original_entry) !== sha256Json(retained.entry) ||
      sha256Json(selected.value.original_descriptor) !== sha256Json(retained.descriptor) ||
      currentQualification.original_manifest_sha256 !==
        priorQualification.successor_manifest_sha256 ||
      sha256Json(currentQualification.original_cli) !==
        sha256Json(priorQualification.successor_cli) ||
      originalToolkit.sha256 !== priorToolkit.sha256 ||
      originalToolkit.bytes !== priorToolkit.bytes ||
      object(selected.value.writer_handoff).predecessor_plan_sha256 !== predecessor.plan_sha256
    )
      fail(
        "runtime_adoption_predecessor_mismatch",
        "Select the exact immediately preceding runtime and its stopped-writer handoff.",
      );
  }
  for (const fact of record.inputs) verifyEvidence([fact]);
  return { registered, chain };
}
function witness(context: FoundryRuntimeContext) {
  const paths = new Set<string>();
  const add = (relative: string) => {
    if (paths.size >= 8192 && !paths.has(relative))
      fail("runtime_adoption_limit", "Task witness exceeds its bound.");
    paths.add(relative);
  };
  const visit = (relative: string, depth: number) => {
    if (depth > 20) fail("runtime_adoption_limit", "Task witness exceeds its bound.");
    const target = resolveFoundryOutput(context, relative);
    if (!fs.existsSync(target)) return;
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of fs.readdirSync(target).sort()) visit(`${relative}/${name}`, depth + 1);
    } else add(relative);
  };
  for (const name of [
    "foundry-job.json",
    "source-manifest.json",
    "profile-lock.json",
    "seed-manifest.json",
    "artifact-index.jsonl",
    "account-intent.json",
    "authorization.json",
    "attempts",
    "outputs/execution-requests",
  ])
    visit(name, 0);
  const registered = registration(context);
  for (const name of ["source_manifest", "profile_lock", "seed_manifest"] as const) {
    const retained = registered.value[name];
    if (retained === null) continue;
    const ref = reference(registered.job[name]);
    const content = readTaskBytes(context, ref.path);
    if (!content.equals(bytes(retained)) || digest(content) !== ref.sha256)
      fail("runtime_adoption_evidence_changed", "Original registered task snapshot changed.");
  }
  const index = readFoundryTaskArtifactIndex(context);
  if (index.length > 8192)
    fail("runtime_adoption_limit", "Task artifact witness exceeds its bound.");
  // Check registered hashes before accepting a current-byte witness: drift cannot become a fresh preimage.
  let total = 0;
  const observed = new Map<string, { path: string; bytes: number; sha256: string }>();
  const observe = (relative: string, expected?: { bytes?: number; sha256: string }) => {
    if (observed.has(relative)) {
      const prior = observed.get(relative)!;
      if (
        expected &&
        (prior.sha256 !== expected.sha256 ||
          (expected.bytes !== undefined && prior.bytes !== expected.bytes))
      )
        fail("runtime_adoption_evidence_changed", "Registered task artifact facts conflict.");
      return;
    }
    const content = readTaskBytes(context, relative);
    const fact = { path: relative, bytes: content.length, sha256: digest(content) };
    if (
      expected &&
      (fact.sha256 !== expected.sha256 ||
        (expected.bytes !== undefined && fact.bytes !== expected.bytes))
    )
      fail("runtime_adoption_evidence_changed", "Registered task artifact or producer changed.");
    total += content.length;
    if (total > 64 * 1024 * 1024) fail("runtime_adoption_limit", "Task witness exceeds 64 MiB.");
    add(relative);
    observed.set(relative, fact);
  };
  for (const entry of index) {
    observe(entry.path, entry);
    observe(entry.receipt.path, entry.receipt);
    const receipt = object(JSON.parse(readTaskBytes(context, entry.receipt.path).toString("utf8")));
    for (const name of ["plan", "result"]) {
      const ref = reference(receipt[name]);
      observe(ref.path, ref);
    }
  }
  verifyFoundryTaskArtifactLineage(
    context,
    {
      job: registered.job as unknown as FoundryTaskJob,
      jobSha256: digest(bytes(registered.job)),
      sources: facts(object(registered.value.source_manifest).source_paths),
    },
    index,
  );
  for (const relative of paths) observe(relative);
  return [...observed.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function adoptionContinuation(
  context: FoundryRuntimeContext,
): "preparation_only" | "original_owner_recovery" {
  const attempts = resolveFoundryOutput(context, "attempts");
  const sensitive = new Set([
    "dataset-workflow-finalize",
    "dataset-workflow-authorization",
    "dataset-workflow-native-contract",
    "dataset-workflow-execution-prepare",
    "dataset-workflow-execution-result",
    "dataset-workflow-execution-consume",
    "dataset-workflow-execution-observation",
  ]);
  if (
    (fs.existsSync(attempts) && fs.readdirSync(attempts).length > 0) ||
    fs.existsSync(resolveFoundryOutput(context, "authorization.json")) ||
    readFoundryTaskArtifactIndex(context).some((entry) => sensitive.has(entry.command))
  )
    return "original_owner_recovery";
  return "preparation_only";
}
export function planFoundryTaskRuntimeAdoption(
  context: FoundryRuntimeContext,
  record: FoundryFacadeTaskRecord,
  selection: unknown,
  trusted?: TrustedFoundryRuntimeAdoptionQualification,
) {
  assertTrustedQualification(selection, trusted);
  const { registered, chain } = validateTask(context, record, selection);
  if (chain && chain.plans.length >= 64)
    fail("runtime_adoption_limit", "Runtime adoption chain reached its bound.");
  const successor = currentAdoptionRuntimeFacts(context);
  const payload = {
    schema: TASK_RUNTIME_ADOPTION_SCHEMA,
    workspace_id: context.workspaceId,
    task_id: context.taskId,
    actor_id: context.actorId,
    registration_sha256: registered.sha256,
    job_sha256: digest(bytes(registered.job)),
    selection,
    predecessor_plan_sha256: chain?.tip.plan_sha256 ?? null,
    successor_entry: successor.entry,
    successor_descriptor: successor.descriptor,
    continuation: chain?.plans.some((plan) => plan.continuation === "original_owner_recovery")
      ? "original_owner_recovery"
      : adoptionContinuation(context),
    prior_context_reports: readFoundryTaskArtifactIndex(context)
      .filter(
        (entry) =>
          entry.command === "dataset-context-pack" &&
          path.basename(entry.path) === "contract-report.json",
      )
      .map(({ path: file, bytes: size, sha256 }) => ({ path: file, bytes: size, sha256 })),
    witness: witness(context),
  };
  return { ...payload, plan_sha256: sha256Json(payload) };
}
export async function applyFoundryTaskRuntimeAdoption(
  context: FoundryRuntimeContext,
  record: FoundryFacadeTaskRecord,
  value: unknown,
  trusted?: TrustedFoundryRuntimeAdoptionQualification,
) {
  assertFoundryWorkspaceWrite(context);
  const plan = parsePlan(value);
  assertTrustedQualification(plan.selection, trusted);
  const plannedChain = readFoundryTaskRuntimeAdoptionChain(context, plan.selection);
  if (
    plannedChain?.tip.plan_sha256 !== plan.plan_sha256 &&
    (plannedChain?.tip.plan_sha256 ?? null) !== (plan.predecessor_plan_sha256 ?? null)
  )
    fail(
      "runtime_adoption_plan_stale",
      "The immediately preceding adoption changed after planning.",
    );
  const { registered } = validateTask(context, record, plan.selection, plan.plan_sha256);
  const actualScopes = () =>
    [
      ...new Set(
        readOwnerExecutionRequests(context, readFoundryTaskArtifactIndex(context)).map(
          (item) => item.request.scope_id,
        ),
      ),
    ].sort();
  const originalScopes = actualScopes();
  const scopes = [
    ...new Set([
      ...originalScopes,
      ...(registered.job.target_entities as string[]).map((type) =>
        sha256Json({ task: context.taskId, type }),
      ),
    ]),
  ].sort();
  const locked = (index: number): Promise<unknown> => {
    if (index < scopes.length)
      return withBatchRunLock(
        {
          runPath: resolveFoundryOutput(
            context,
            `owner-locks/${context.taskId}-${scopes[index]}.json`,
            "state",
          ),
          identity: { task: context.taskId, scope: scopes[index] },
          timeoutMs: 0,
          reason: "Foundry adoption excludes owner execution",
        },
        () => locked(index + 1),
      );
    return withBatchRunLock(
      {
        runPath: resolveFoundryOutput(context, `task-locks/${context.taskId}.json`, "state"),
        identity: {
          schema: "foundry-task-store-lock.v1",
          workspace_id: context.workspaceId,
          task_id: context.taskId,
        },
        timeoutMs: 0,
        reason: "Foundry explicit same-task runtime adoption",
      },
      () => {
        if (sha256Json(actualScopes()) !== sha256Json(originalScopes))
          fail("runtime_adoption_plan_stale", "Owner scope changed before adoption lock.");
        const existing = readFoundryTaskRuntimeAdoptionChain(context, plan.selection);
        if (existing?.tip.plan_sha256 === plan.plan_sha256) {
          return { status: "adopted", already_applied: true, plan_sha256: plan.plan_sha256 };
        }
        if ((existing?.tip.plan_sha256 ?? null) !== (plan.predecessor_plan_sha256 ?? null))
          fail(
            "runtime_adoption_plan_stale",
            "The immediately preceding adoption changed after planning.",
          );
        const current = planFoundryTaskRuntimeAdoption(context, record, plan.selection, trusted);
        if (current.plan_sha256 !== plan.plan_sha256)
          fail("runtime_adoption_plan_stale", "Task facts changed after adoption planning.");
        const content = bytes(plan);
        transferWriteOnce(context.taskRoot!, `runtime-adoptions/${plan.plan_sha256}.json`, content);
        const anchor = {
          schema: existing
            ? "tiangong-foundry.task-runtime-adoption-successor.v1"
            : "tiangong-foundry.task-runtime-adoption-anchor.v1",
          workspace_id: context.workspaceId,
          task_id: context.taskId,
          plan_sha256: plan.plan_sha256,
          receipt_sha256: digest(content),
          ...(existing ? { predecessor_plan_sha256: existing.tip.plan_sha256 } : {}),
        };
        transferWriteOnce(
          context.stateRoot,
          existing
            ? path
                .relative(
                  context.stateRoot,
                  adoptionSuccessorPath(context, String(existing.tip.plan_sha256)),
                )
                .split(path.sep)
                .join("/")
            : `task-runtime-adoptions/${context.taskId}.json`,
          bytes(anchor),
        );
        readFoundryTaskRuntimeAdoption(context);
        return { status: "adopted", already_applied: false, plan_sha256: plan.plan_sha256 };
      },
    );
  };
  return locked(0);
}
