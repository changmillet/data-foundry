import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  verifyEdgeSupportPlan,
  type EdgeSupportPlan,
  type EdgeSupportTarget,
} from "./foundry-edge-support-plan.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { readNativeDraftHandoff } from "./finalize-owners/native-draft-handoff.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { readEdgeReferenceIntent } from "./foundry-edge-reference-intent.ts";

export function verifySelectedEdgeDraftPlan(
  context: FoundryRuntimeContext,
  plan: EdgeSupportPlan,
  approved: FoundryInputFact,
  target: EdgeSupportTarget,
) {
  const read = (file: string) => readFoundryInput(context, file).toString("utf8");
  const evidenceFile = plan.reference_evidence?.path;
  const report: unknown = evidenceFile ? JSON.parse(read(evidenceFile)) : null;
  const evidence = evidenceFile ? { fact: captureFoundryInput(evidenceFile), report } : undefined;
  const rows = readRows(approved.path, read);
  const recordedIntent = evidence && workflowObject(evidence.report).reference_intent;
  if (recordedIntent || plan.reference_intent) {
    const intent = plan.reference_intent?.[0];
    if (!recordedIntent || !intent)
      throw new FoundryContextError(
        "execution_reference_evidence_unbound",
        "The sealed Edge plan must carry the original explicit reference intent.",
      );
    const current = readEdgeReferenceIntent(context, intent.path, plan.dataset_type, target, rows);
    if (sha256Json(current.binding) !== sha256Json(recordedIntent))
      throw new FoundryContextError(
        "execution_reference_evidence_unbound",
        "The reference intent, reviews or consumers differ from the sealed precommit evidence.",
      );
  }
  const update = plan.update;
  const insert = plan.insert_contract;
  if (insert) {
    read(insert.path);
    const native = readNativeDraftHandoff({
      contractFile: insert.path,
      rowsFile: approved.path,
      datasetType: plan.dataset_type,
      verifiedProjectRef: target.project_ref,
      targetUserId: target.user_id,
      stateCode: "0",
      relativePath: (file) => file,
    });
    if (
      native.metadata.operation !== "insert" ||
      sha256Json(captureFoundryInput(insert.path)) !== sha256Json(insert)
    )
      throw new FoundryContextError(
        "edge_draft_contract_mismatch",
        "Explicit Edge insertion requires the original exact insert-only contract.",
      );
  }
  if (update) {
    const invalid = (detail: string) =>
      new FoundryContextError("repair_edge_scope_changed", detail);
    for (const fact of [update.before, update.contract, update.preparation]) {
      read(fact.path);
      const current = captureFoundryInput(fact.path);
      if (
        current.path !== fact.path ||
        current.bytes !== fact.bytes ||
        current.sha256 !== fact.sha256
      )
        throw invalid("A selected update input changed after the plan was sealed.");
    }
    const preparation = workflowObject(JSON.parse(read(update.preparation.path)));
    const inputs = workflowObject(preparation.inputs);
    const preparedContract = workflowObject(inputs.contract);
    const evidence = workflowObject(preparation.evidence);
    const preflight = Array.isArray(evidence.detail)
      ? evidence.detail.map(workflowObject).find((item) => item.role === "edge_preflight")
      : undefined;
    const rules = workflowObject(preflight?.report ?? {}).rule_verification;
    const native = readNativeDraftHandoff({
      contractFile: update.contract.path,
      rowsFile: approved.path,
      datasetType: "process",
      verifiedProjectRef: target.project_ref,
      targetUserId: target.user_id,
      stateCode: "0",
      relativePath: (file) => file,
    });
    const validPreparation = {
      schema: preparation.schema === "tiangong-foundry.repair-preparation.v1",
      readiness:
        preparation.status === "prepared" &&
        preparation.remote_writes === 0 &&
        preparation.publication_ready === false,
      before: sha256Json(inputs.before) === sha256Json(update.before),
      candidate: sha256Json(inputs.candidate) === sha256Json(captureFoundryInput(approved.path)),
      contract:
        preparedContract.sha256 === update.contract.sha256 &&
        preparedContract.bytes === update.contract.bytes,
      scope: workflowObject(preparation.scope).contract_sha256 === native.canonical_sha256,
      validation: Boolean(rules) && sha256Json(rules) === sha256Json(update.rule_verification),
    };
    const missing = Object.entries(validPreparation).filter(([, valid]) => !valid);
    if (missing.length)
      throw invalid(
        `Invalid guarded update preparation fields: ${missing.map(([key]) => key).join(", ")}.`,
      );
    if (
      native.contract.actions.length !== plan.roots.length ||
      native.contract.actions.some((action) => {
        const root = plan.roots.find(
          (item) => item.id === action.id && item.version === action.version,
        );
        return (
          action.expected_operation !== "save_draft" ||
          !root ||
          action.table !== root.table ||
          action.before_sha256 !== root.before_sha256 ||
          action.desired_sha256 !== root.payload_sha256
        );
      })
    )
      throw invalid("The native update actions differ from the sealed exact draft writes.");
  }
  return verifyEdgeSupportPlan(
    plan,
    captureFoundryInput(approved.path),
    target,
    rows,
    evidence,
    update && { binding: update, rows: readRows(update.before.path, read) },
    insert,
  );
}
