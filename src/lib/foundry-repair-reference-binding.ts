import { FoundryContextError } from "./foundry-runtime-context.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { collectDatasetReferences } from "./import-curation/internal/workflow-reference-closure.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  assertFoundryRepairRootProof,
  parseFoundryRepairRemoteReport,
  type FoundryRepairExpectation,
} from "./foundry-repair-preflight.ts";
import {
  proveRetainedRepairReferences,
  type FoundryRepairExpectedReference,
} from "./foundry-repair-reference-proof.ts";

type JsonRecord = Record<string, unknown>;

/** Derive every expectation from the unchanged selected payloads, never from the CLI's claim. */
export function proveFoundryRepairRemoteIntegrity(input: {
  report: JsonRecord;
  checks: readonly unknown[];
  expectation: FoundryRepairExpectation;
  beforeRows: readonly unknown[];
  candidateRows: readonly unknown[];
  content: "before" | "candidate";
}) {
  const fail = (): never => {
    throw new FoundryContextError(
      "repair_reference_scope_changed",
      "Repair reference proof requires the exact before/candidate payloads and unchanged reference occurrences.",
    );
  };
  const describe = (rows: readonly unknown[], role: "before" | "candidate") => {
    if (rows.length !== input.expectation.actions.length) return fail();
    const seen = new Set<string>();
    return rows.map((row, rowIndex) => {
      const identity = datasetIdentity(row, rowIndex, "process");
      const key = `${identity.id}@${identity.version}`;
      const action = input.expectation.actions.find(
        (item) => item.id === identity.id && item.version === identity.version,
      );
      if (!action || seen.has(key)) return fail();
      seen.add(key);
      const expectedHash = role === "before" ? action.before_sha256 : action.desired_sha256;
      if (sha256Json(identity.payload) !== expectedHash) return fail();
      const references: FoundryRepairExpectedReference[] = collectDatasetReferences(
        identity.payload,
      ).map((reference) => {
        if (!reference.table || !reference.id || !reference.version) return fail();
        return {
          row_index: rowIndex,
          path: reference.path,
          table: reference.table,
          id: reference.id,
          version: reference.version,
        };
      });
      return {
        key,
        action,
        references,
        root: {
          row_index: rowIndex,
          path: "/processDataSet",
          table: action.table,
          id: action.id,
          version: action.version,
          payload_sha256: expectedHash,
        },
      };
    });
  };
  const before = describe(input.beforeRows, "before"),
    candidate = describe(input.candidateRows, "candidate");
  for (const old of before) {
    const next = candidate.find((row) => row.key === old.key);
    if (!next) return fail();
    const references = (items: readonly FoundryRepairExpectedReference[]) =>
      items.map(({ row_index: _rowIndex, ...ref }) => JSON.stringify(ref)).sort();
    if (JSON.stringify(references(old.references)) !== JSON.stringify(references(next.references)))
      return fail();
  }
  const selected = input.content === "before" ? before : candidate;
  const expectation = { ...input.expectation, actions: selected.map((row) => row.action) };
  if (input.report.status === "passed_remote_verification") {
    const key = (value: FoundryRepairExpectedReference) =>
      JSON.stringify([value.row_index, value.path, value.table, value.id, value.version]);
    const wanted = selected
      .flatMap((row) => row.references)
      .map(key)
      .sort();
    const actual = input.checks
      .filter(
        (value) => value && typeof value === "object" && (value as JsonRecord).role === "reference",
      )
      .map((value) => {
        const item = value as JsonRecord;
        if (
          item.status !== "ok" ||
          (item.exact_version !== undefined && item.exact_version !== item.version)
        )
          return fail();
        return key(item as unknown as FoundryRepairExpectedReference);
      })
      .sort();
    const roots = input.checks.filter(
      (value) =>
        value &&
        typeof value === "object" &&
        (value as JsonRecord).role === "root" &&
        !String((value as JsonRecord).path).endsWith("#readback"),
    );
    if (
      JSON.stringify(actual) !== JSON.stringify(wanted) ||
      roots.length !== selected.length ||
      Number((input.report.counts as JsonRecord).references) !== wanted.length + selected.length
    )
      return fail();
    const rootKeys = roots
      .map((value) => {
        const item = value as JsonRecord;
        return JSON.stringify([item.table, item.id, item.version, item.path]);
      })
      .sort();
    const expectedKeys = selected
      .map(({ root }) => JSON.stringify([root.table, root.id, root.version, root.path]))
      .sort();
    if (JSON.stringify(rootKeys) !== JSON.stringify(expectedKeys)) return fail();
    assertFoundryRepairRootProof(input.report, input.checks, expectation, input.content);
    return {
      counts: parseFoundryRepairRemoteReport(input.report, expectation),
      retained_references: null,
    };
  }
  const proof = proveRetainedRepairReferences({
    report: input.report,
    checks: input.checks,
    roots: selected.map((row) => row.root),
    references: selected.flatMap((row) => row.references),
    target_user_id: expectation.owner_user_id,
    expected_state_code: 0,
  });
  return {
    counts: {
      rows: selected.length,
      references: Number(proof.counts.references),
      checks: Number(proof.counts.checked),
    },
    retained_references: proof,
  };
}
