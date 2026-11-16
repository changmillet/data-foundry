import fs from "node:fs";
import path from "node:path";
import { readFoundryInput, type FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { datasetIdentity, detectDatasetType } from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import {
  operationHasEvidence,
  patchPayloadPatchSets,
  patchSetAuthoringPackage,
  patchSetDatasetId,
  patchSetOperations,
} from "./import-curation/internal/workflow-authoring-tasks.ts";
import {
  operationClosureKeys,
  taskActionItemKeys,
} from "./import-curation/internal/workflow-patch-evidence.ts";
import { assertWorkflowReportArtifact, runWorkflowLocalCliResult } from "./foundry-workflow-io.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { sha256Text } from "./identity-preflight-proof.ts";

type RecordValue = Record<string, unknown>;

type PatchDestinations = {
  input: string;
  patch: string;
  output: string;
  directory: string;
  writeJson: (file: string, value: unknown) => void;
  writeText: (file: string, value: string) => void;
};

type PatchExecution = {
  readInput: (file: string) => Buffer;
  readResult: (file: string) => Buffer;
  workspace: string;
  run: (argv: string[]) => {
    exit: number;
    report: RecordValue;
    validate: <T>(check: () => T) => T;
  };
};

export function applyFoundryTypedAuthoringPatch(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  options: PatchDestinations & { type: string; packageDirectory: string },
) {
  return applyTypedAuthoringPatch(
    { ...options, requirePackage: true, requireClosure: true },
    {
      readInput: (file) => readFoundryInput(context, file),
      readResult: (file) =>
        fs.readFileSync(assertWorkflowReportArtifact(context, file, options.directory)),
      workspace: options.directory,
      run: (argv) => runWorkflowLocalCliResult(context, qualified, temporary, argv),
    },
  );
}

export function applyTypedAuthoringPatch(
  options: PatchDestinations & {
    type?: string;
    packageDirectory?: string;
    requirePackage: boolean;
    requireClosure: boolean;
  },
  execution: PatchExecution,
) {
  const rows = readRows(options.input, (file) => execution.readInput(file).toString("utf8"));
  const patches = patchPayloadPatchSets(JSON.parse(fs.readFileSync(options.patch, "utf8")));
  const candidates = [...rows];
  const blockers: RecordValue[] = [];
  const evidence: RecordValue[] = [];
  let operationCount = 0;
  if (!patches.length)
    blockers.push({
      code: "patch_payload_invalid",
      message: "At least one dataset patch set is required.",
    });
  for (const [patchIndex, raw] of patches.entries()) {
    const patch = workflowObject(raw);
    const packageName = patchSetAuthoringPackage(patch);
    const declaredId = patchSetDatasetId(patch);
    const declaredVersion = patch.dataset_version ?? patch.version;
    const declaredIndex = patch.row_index ?? patch.rowIndex;
    if (
      (!packageName || !options.packageDirectory) &&
      (options.requirePackage || options.requireClosure)
    ) {
      blockers.push({ code: "authoring_package_required", patch_index: patchIndex });
      continue;
    }
    const packageBytes =
      packageName && options.packageDirectory
        ? execution.readInput(path.join(options.packageDirectory, path.basename(packageName)))
        : null;
    const authoring = packageBytes
      ? workflowObject(JSON.parse(packageBytes.toString("utf8")))
      : null;
    const packageId = authoring?.entity_id ?? authoring?.process_id;
    const packageVersion = authoring?.version;
    const matches = rows.flatMap((row, index) => {
      const type = options.type ?? detectDatasetType(row);
      if (!type) return [];
      const identity = datasetIdentity(row, index, type);
      const expectedIndex =
        authoring ||
        declaredIndex === undefined ||
        (/^\d+$/u.test(String(declaredIndex)) && Number(declaredIndex) === index);
      const expectedId = !declaredId || identity.id === declaredId;
      const expectedVersion = declaredVersion === undefined || identity.version === declaredVersion;
      const expectedPackage =
        !authoring || (identity.id === packageId && identity.version === packageVersion);
      return expectedIndex && expectedId && expectedVersion && expectedPackage
        ? [{ index, identity, type }]
        : [];
    });
    const selected = matches[0];
    const reject = (code: string, message: string) =>
      blockers.push({
        code,
        message,
        patch_index: patchIndex,
        row_index: selected?.index,
        dataset_id: selected?.identity.id ?? declaredId,
        dataset_version: selected?.identity.version ?? declaredVersion,
      });
    const contradictoryIndex =
      authoring &&
      declaredIndex !== undefined &&
      (!/^\d+$/u.test(String(declaredIndex)) || Number(declaredIndex) !== selected?.index);
    if (
      matches.length !== 1 ||
      contradictoryIndex ||
      (!authoring && !declaredId && declaredIndex === undefined)
    ) {
      reject(
        "authoring_patch_scope_mismatch",
        "Select one exact dataset row and its required authoring package.",
      );
      continue;
    }
    const {
      index: rowIndex,
      identity: { id, version },
      type,
    } = selected;
    const operationName = `dataset ${type === "lifecyclemodel" ? "model" : type} patch`;
    const rawOperations = patchSetOperations(patch);
    if (!rawOperations?.length) {
      reject("patch_operations_missing", "Authoring patch must contain an operation.");
      continue;
    }
    operationCount += rawOperations.length;
    const required = taskActionItemKeys({
      ...authoring,
      action_items: Array.isArray(authoring?.action_items)
        ? authoring.action_items.filter((value) => {
            const item = workflowObject(value);
            return (
              item.ai_required !== false &&
              ![
                "identity_decision_authoring",
                "classification_decision_authoring",
                "location_decision_authoring",
              ].includes(String(item.action_kind ?? item.actionKind))
            );
          })
        : [],
    });
    const closed = rawOperations.flatMap((item) =>
      item.op === "test" ? [] : operationClosureKeys(item),
    );
    const matchesClosure = (left: string, right: string) => {
      const [leftCode, leftPath] = left.split("\u0000");
      const [rightCode, rightPath] = right.split("\u0000");
      return leftCode === rightCode && (!leftPath || !rightPath || leftPath === rightPath);
    };
    if (
      options.requireClosure &&
      (closed.some((closure) => !required.some((item) => matchesClosure(closure, item))) ||
        required.some((item) => !closed.some((closure) => matchesClosure(closure, item))))
    ) {
      reject(
        "authoring_action_item_closure_invalid",
        "Patch closure must match the selected authoring package.",
      );
      continue;
    }
    if (rawOperations.some((item) => item.op !== "test" && !operationHasEvidence(item))) {
      reject("patch_evidence_required", "Each mutation needs its source evidence or basis.");
      continue;
    }
    const row = workflowObject(candidates[rowIndex]);
    const original = datasetIdentity(row, rowIndex, type);
    const wrapper =
      original.payload === row
        ? null
        : Object.keys(row).find((name) => row[name] === original.payload);
    const prefix = wrapper ? `/${wrapper}` : "";
    const operations = rawOperations.map((item) => {
      const operation = workflowObject(item);
      const location = typeof operation.path === "string" ? operation.path : "";
      return {
        op: operation.op,
        path: location.startsWith(prefix + "/") ? location.slice(prefix.length) : null,
        ...(Object.hasOwn(operation, "value") ? { value: operation.value } : {}),
        ...(operation.op === "test"
          ? {}
          : {
              basis:
                typeof operation.basis === "string" && operation.basis.trim()
                  ? operation.basis
                  : "Source evidence retained in the selected Foundry authoring patch.",
            }),
      };
    });
    if (operations.some((operation) => operation.path === null)) {
      reject(
        "patch_path_invalid",
        "Authoring patch pointer must select a field inside the dataset payload.",
      );
      continue;
    }
    const input = path.join(execution.workspace, `request-${patchIndex + 1}.json`);
    const output = path.join(execution.workspace, `result-${patchIndex + 1}.json`);
    options.writeJson(input, {
      content: original.payload,
      expectedDigest: sha256Text(JSON.stringify(original.payload)),
      operations,
    });
    const result = execution.run([
      ...operationName.split(" "),
      "--input",
      input,
      "--output",
      output,
      "--json",
    ]);
    if (result.exit !== 0) {
      const error = workflowObject(result.report.error);
      reject(String(error.code), String(error.message));
      continue;
    }
    const content = result.validate(() => {
      const bytes = execution.readResult(output);
      const payload = workflowObject(JSON.parse(bytes.toString("utf8")));
      const identity = datasetIdentity(payload, rowIndex, type);
      const artifact = Array.isArray(result.report.artifacts)
        ? workflowObject(result.report.artifacts[0])
        : {};
      if (
        result.report.schemaVersion !== 1 ||
        result.report.operation !== operationName ||
        result.report.status !== "completed" ||
        result.report.outcome !== "content_processed" ||
        result.report.error !== null ||
        artifact.path !== output ||
        artifact.purpose !== "complete_result" ||
        artifact.bytes !== bytes.length ||
        workflowObject(result.report.data).contentDigest !== sha256Text(JSON.stringify(payload)) ||
        identity.id !== id ||
        identity.version !== version
      )
        throw new Error("Typed patch receipt does not bind the exact output and selected row.");
      return payload;
    });
    candidates[rowIndex] = wrapper ? { ...row, [wrapper]: content } : content;
    rawOperations.forEach((item, operationIndex) => {
      if (item.op === "test") return;
      evidence.push({
        row_index: rowIndex,
        dataset_id: id,
        dataset_version: version,
        patch_index: patchIndex,
        operation_index: operationIndex,
        op: item.op,
        path: item.path,
        basis: item.basis ?? null,
        evidence: item.evidence ?? null,
        resolution: item.resolution ?? null,
        authoring_package: packageName || null,
        authoring_package_sha256: packageBytes ? sha256Text(packageBytes.toString("utf8")) : null,
        closes_action_items: operationClosureKeys(item).map((key) => {
          const [code, itemPath] = key.split("\u0000");
          return { code, path: itemPath || null };
        }),
      });
    });
  }
  const accepted = !blockers.length;
  const reportFile = path.join(options.directory, "outputs", "dataset-patch-apply-report.json");
  const evidenceFile = path.join(options.directory, "outputs", "patch-evidence.jsonl");
  options.writeText(
    options.output,
    (accepted ? candidates : rows).map((row) => JSON.stringify(row) + "\n").join(""),
  );
  options.writeText(
    evidenceFile,
    accepted ? evidence.map((row) => JSON.stringify(row) + "\n").join("") : "",
  );
  const report = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    status: accepted ? "completed" : "blocked",
    input_path: options.input,
    patch_path: options.patch,
    out_path: options.output,
    row_count: rows.length,
    patch_count: patches.length,
    operation_count: operationCount,
    applied_operation_count: accepted ? evidence.length : 0,
    evidence_count: accepted ? evidence.length : 0,
    closed_action_item_count: accepted
      ? evidence.reduce((sum, row) => sum + (row.closes_action_items as unknown[]).length, 0)
      : 0,
    blockers,
    files: { report: reportFile, patched_rows: options.output, patch_evidence: evidenceFile },
  };
  options.writeJson(reportFile, report);
  return { report, exit: accepted ? 0 : 1 };
}
