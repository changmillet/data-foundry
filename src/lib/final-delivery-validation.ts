import fs from "node:fs";
import path from "node:path";
import { evaluateAssertion, type AlgebraAssertion } from "./final-delivery-algebra.ts";
import {
  type JsonRecord,
  MANIFEST_SCHEMA,
  artifactErrorCode,
  checkCollector,
  scanTextWithDecodedStrings,
  compareText,
  isPlainObject,
  isSha256,
  pathIsInside,
  safeRelativePath,
  sha256,
  stableJson,
} from "./final-delivery-manifest.ts";
import {
  MAX_FORBIDDEN_LITERALS,
  redactableArtifactIds,
  safeLabel,
  redactionContractValid,
  redactionForbiddenLiterals,
  redactionScanIds,
  secretFindingCodes,
} from "./final-delivery-redaction.ts";
import {
  reviewerContentBindingValid,
  reviewerCoverageValid,
  reviewerDeclarations,
  reviewerIdentityValid,
  reviewerPassValid,
} from "./final-delivery-review.ts";
import {
  type ArtifactDescriptor,
  type ArtifactRuntime,
  parseArtifactRows,
} from "./final-delivery-rows.ts";
import { cellParts, columnNumber } from "./final-delivery-workbook.ts";
import { MANIFEST_SCHEMA_URL, validateManifestSchema } from "./final-delivery-schema.ts";

type WorkbookPolicy = JsonRecord & {
  artifact_id?: string;
  exact_sheet_names?: unknown;
  sheets?: unknown;
};

type SheetPolicy = JsonRecord & {
  name?: string;
  header_row?: number;
  required_columns?: unknown;
  required_cells?: unknown;
};

export type PromotionValidation = {
  rows: ReturnType<typeof checkCollector>["rows"];
  manifestSha256: string;
  deliveryRoot: string | null;
  artifacts: JsonRecord[];
  schemaValid: boolean;
  forbiddenLiterals: string[];
};

export type ManifestValidateArgs = {
  manifest: JsonRecord | null;
  manifestPath: string;
  manifestRaw: Buffer;
  repoRoot: string;
};

function firstMismatchOrdinal(
  expected: readonly string[],
  actual: readonly string[] | null,
): number | null {
  if (!actual) return null;
  for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
    if (expected[index] !== actual[index]) return index + 1;
  }
  return null;
}

// The offline delivery gate. It reads declared local artifacts, re-derives every binding from
// exact bytes, and records one PASS/FAIL ledger row per check. It issues no dispatch of any kind
// and the resulting seal is validation evidence, never execution or publication authority.
export function validateFinalDeliveryManifest({
  manifest,
  manifestPath,
  manifestRaw,
  repoRoot,
}: ManifestValidateArgs): PromotionValidation {
  const { add, rows } = checkCollector();
  add(
    "manifest_schema",
    manifest?.schema_version === MANIFEST_SCHEMA,
    "P1",
    `Manifest schema must be ${MANIFEST_SCHEMA}.`,
  );
  // The declared schema_version string is only a claim. This is the check that the manifest
  // actually satisfies its published schema, and it runs before any per-field check so a
  // structurally invalid manifest is never partially trusted.
  const schemaOutcome = validateManifestSchema(repoRoot, manifest);
  add(
    "manifest_schema_valid",
    schemaOutcome.valid,
    "P1",
    `Manifest must satisfy ${MANIFEST_SCHEMA} schema ${MANIFEST_SCHEMA_URL}.`,
    {
      error_count: schemaOutcome.errorCount,
      findings: schemaOutcome.findings,
      truncated: schemaOutcome.errorCount > schemaOutcome.findings.length,
    },
  );
  add(
    "delivery_id",
    typeof manifest?.delivery_id === "string" && manifest.delivery_id.length > 0,
    "P1",
    "delivery_id is required.",
  );
  add(
    "producer_id",
    typeof manifest?.producer_id === "string" && manifest.producer_id.length > 0,
    "P1",
    "producer_id is required.",
  );
  add(
    "offline_only",
    manifest?.promotion_mode === "OFFLINE_ONLY" && manifest?.production_authority === false,
    "P0",
    "Promotion must be offline-only and must not grant production authority.",
  );
  add(
    "declared_findings_zero",
    isPlainObject(manifest?.findings) && manifest.findings.p0 === 0 && manifest.findings.p1 === 0,
    "P1",
    "Manifest-declared P0 and P1 findings must both be zero.",
  );

  const manifestDir = path.dirname(manifestPath);
  const deliveryRoot = path.resolve(manifestDir, String(manifest?.delivery_root ?? "."));
  const rootExists = fs.existsSync(deliveryRoot) && fs.statSync(deliveryRoot).isDirectory();
  const rootReal = rootExists ? fs.realpathSync(deliveryRoot) : deliveryRoot;
  const rootSafe = Boolean(
    safeRelativePath(manifest?.delivery_root) &&
    rootExists &&
    !fs.lstatSync(deliveryRoot).isSymbolicLink() &&
    pathIsInside(fs.realpathSync(repoRoot), rootReal),
  );
  add(
    "delivery_root",
    rootSafe,
    "P0",
    "delivery_root must be a safe, existing, non-symlink directory inside the repository.",
  );

  // Available up front so every emitted label can be checked against the manifest's own redaction
  // contract before it reaches the ledger or the report.
  const forbiddenLiterals = redactionForbiddenLiterals(manifest?.redaction);
  const artifacts: ArtifactDescriptor[] = Array.isArray(manifest?.artifacts)
    ? manifest.artifacts.filter(isPlainObject)
    : [];
  add("artifacts_present", artifacts.length > 0, "P1", "At least one artifact is required.");
  const artifactsById = new Map<string, ArtifactRuntime>();
  const paths = new Set<string>();
  for (const [artifactIndex, descriptor] of artifacts.entries()) {
    const artifactId = descriptor?.artifact_id;
    const artifactLabel = safeLabel(artifactId, artifactIndex + 1, forbiddenLiterals);
    const identityOk = Boolean(artifactId) && !artifactsById.has(artifactId as string);
    add(`artifact_identity:${artifactLabel}`, identityOk, "P1", "Artifact IDs must be unique.");
    const pathOk = safeRelativePath(descriptor?.path) && !paths.has(String(descriptor.path));
    add(`artifact_path:${artifactLabel}`, pathOk, "P0", "Artifact paths must be safe and unique.");
    if (descriptor?.path) paths.add(descriptor.path);
    const descriptorOk = Boolean(
      isSha256(descriptor?.sha256) &&
      Number.isInteger(descriptor?.bytes) &&
      (descriptor.bytes as number) >= 0 &&
      Number.isInteger(descriptor?.rows) &&
      (descriptor.rows as number) >= 0 &&
      typeof descriptor?.schema === "string" &&
      descriptor.schema.length > 0 &&
      isPlainObject(descriptor?.row_count),
    );
    add(
      `artifact_descriptor:${artifactLabel}`,
      descriptorOk,
      "P1",
      "Artifact descriptor requires SHA-256, bytes, rows, schema, and row_count.",
    );

    const candidate = pathOk ? path.resolve(deliveryRoot, String(descriptor.path)) : null;
    let buffer: Buffer | null = null;
    let fileSafe = false;
    if (
      candidate &&
      rootSafe &&
      pathIsInside(deliveryRoot, candidate) &&
      fs.existsSync(candidate)
    ) {
      const stat = fs.lstatSync(candidate);
      fileSafe = stat.isFile() && !stat.isSymbolicLink();
      if (fileSafe) fileSafe = pathIsInside(rootReal, fs.realpathSync(candidate));
      if (fileSafe) buffer = fs.readFileSync(candidate);
    }
    add(
      `artifact_file_safe:${artifactLabel}`,
      fileSafe,
      "P0",
      "Artifact must be a regular non-symlink file under delivery_root.",
    );
    if (buffer) {
      add(
        `artifact_hash:${artifactLabel}`,
        sha256(buffer) === descriptor.sha256,
        "P0",
        "Artifact SHA-256 must match exact bytes.",
      );
      add(
        `artifact_bytes:${artifactLabel}`,
        buffer.byteLength === descriptor.bytes,
        "P0",
        "Artifact byte count must match exact bytes.",
      );
    }
    let parsed: ArtifactRuntime["parsed"] = null;
    if (buffer) {
      try {
        parsed = parseArtifactRows(descriptor, buffer);
        add(
          `artifact_parse:${artifactLabel}`,
          true,
          "P1",
          "Artifact parsed using its row contract.",
        );
      } catch (error) {
        add(
          `artifact_parse:${artifactLabel}`,
          false,
          "P1",
          "Artifact does not satisfy its declared row contract.",
          { category: artifactErrorCode(error) },
        );
      }
    }
    const runtime: ArtifactRuntime = {
      descriptor,
      buffer,
      parsed,
      actualRows: parsed?.rows ?? null,
      path: candidate,
    };
    if (artifactId && !artifactsById.has(artifactId)) artifactsById.set(artifactId, runtime);
    if (parsed && descriptor?.row_count?.kind !== "xlsx") {
      add(
        `artifact_rows:${artifactLabel}`,
        parsed.rows === descriptor.rows,
        "P1",
        "Artifact row count must match the manifest.",
        { declared: descriptor.rows, actual: parsed.rows },
      );
    }
  }

  const workbookPolicies: WorkbookPolicy[] = Array.isArray(manifest?.workbooks)
    ? manifest.workbooks.filter(isPlainObject)
    : [];
  const xlsxArtifacts = artifacts.filter((artifact) => artifact?.row_count?.kind === "xlsx");
  add(
    "workbook_policy_coverage",
    workbookPolicies.length === xlsxArtifacts.length && workbookPolicies.length > 0,
    "P1",
    "Every XLSX artifact requires exactly one workbook policy.",
  );
  const workbookArtifactIds = new Set<string>();
  for (const [policyIndex, policy] of workbookPolicies.entries()) {
    const artifactId = policy?.artifact_id;
    // Nothing free-text from the manifest or the workbook reaches the ledger. Sheet, column and
    // control-cell values are summarised as counts, ordinals and digests so a failure report can
    // be navigated without becoming a second copy of a secret.
    const policyLabel = safeLabel(artifactId, policyIndex + 1, forbiddenLiterals);
    const runtime = artifactId ? artifactsById.get(artifactId) : undefined;
    const unique =
      typeof artifactId === "string" &&
      artifactId.length > 0 &&
      !workbookArtifactIds.has(artifactId);
    if (artifactId) workbookArtifactIds.add(artifactId);
    add(`workbook_identity:${policyLabel}`, unique, "P1", "Workbook policy IDs must be unique.");
    const workbook = runtime?.parsed?.workbook;
    add(
      `workbook_artifact_kind:${policyLabel}`,
      runtime?.descriptor?.row_count?.kind === "xlsx",
      "P1",
      "Workbook policy must reference an XLSX artifact.",
    );
    const expectedNames = Array.isArray(policy?.exact_sheet_names)
      ? (policy.exact_sheet_names as unknown[]).map(String)
      : [];
    const actualNames = workbook?.names ?? null;
    add(
      `workbook_sheet_names:${policyLabel}`,
      Boolean(workbook && stableJson(workbook.names) === stableJson(expectedNames)),
      "P1",
      "Workbook sheet names and order must match exactly.",
      {
        expected_count: expectedNames.length,
        actual_count: actualNames?.length ?? null,
        expected_sha256: sha256(stableJson(expectedNames)),
        actual_sha256: actualNames ? sha256(stableJson(actualNames)) : null,
        first_mismatch_ordinal: firstMismatchOrdinal(expectedNames, actualNames),
      },
    );
    const sheetPolicies: SheetPolicy[] = Array.isArray(policy?.sheets)
      ? policy.sheets.filter(isPlainObject)
      : [];
    const policyNames = sheetPolicies.map((sheet) => sheet.name);
    add(
      `workbook_sheet_policy_coverage:${policyLabel}`,
      expectedNames.length > 0 &&
        sheetPolicies.length === expectedNames.length &&
        stableJson(policyNames) === stableJson(expectedNames),
      "P1",
      "Every exact workbook sheet requires one ordered policy.",
      {
        expected_count: expectedNames.length,
        policy_count: sheetPolicies.length,
        ordered_names_match: stableJson(policyNames) === stableJson(expectedNames),
      },
    );
    let workbookRows = 0;
    for (const [sheetIndex, sheetPolicy] of sheetPolicies.entries()) {
      const sheetOrdinal = sheetIndex + 1;
      const sheet = workbook?.sheets.get(String(sheetPolicy.name));
      const headerRow = sheetPolicy?.header_row;
      const headers = sheet
        ? [...sheet.cells.entries()]
            .map(([reference, value]) => {
              const parts = cellParts(reference);
              return parts ? { ...parts, value } : null;
            })
            .filter((cell): cell is { column: string; row: number; value: string } => cell !== null)
            .filter((cell) => cell.row === headerRow)
            .sort((left, right) => columnNumber(left.column) - columnNumber(right.column))
            .map((cell) => cell.value)
        : [];
      const requiredColumns = Array.isArray(sheetPolicy?.required_columns)
        ? (sheetPolicy.required_columns as unknown[]).map(String)
        : [];
      add(
        `workbook_required_columns:${policyLabel}:${sheetOrdinal}`,
        Boolean(
          sheet &&
          Number.isInteger(headerRow) &&
          (headerRow as number) >= 1 &&
          requiredColumns.length > 0 &&
          requiredColumns.every((column) => headers.includes(column)),
        ),
        "P1",
        "Workbook sheet must contain every required column on the declared header row.",
        {
          sheet_ordinal: sheetOrdinal,
          header_row: Number.isInteger(headerRow) ? headerRow : null,
          required_count: requiredColumns.length,
          matched_count: requiredColumns.filter((column) => headers.includes(column)).length,
          actual_header_count: headers.length,
          required_sha256: sha256(stableJson(requiredColumns)),
          actual_headers_sha256: sha256(stableJson(headers)),
        },
      );
      const requiredCells = Array.isArray(sheetPolicy?.required_cells)
        ? (sheetPolicy.required_cells as unknown[]).filter(isPlainObject)
        : [];
      for (const [cellIndex, cell] of requiredCells.entries()) {
        // The control locator is only echoed when it matches the schema-constrained A1 form;
        // anything else is addressed by its ordinal.
        const requested = String(cell.cell);
        const reference = /^[A-Z]+[1-9]\d*$/u.test(requested) ? requested : `#${cellIndex + 1}`;
        const actual = sheet?.cells.get(requested);
        const match = actual !== undefined && String(actual) === String(cell.equals);
        add(
          `workbook_required_cell:${policyLabel}:${sheetOrdinal}:${reference}`,
          match,
          "P1",
          "Workbook control cell must match its exact declared value.",
          {
            sheet_ordinal: sheetOrdinal,
            cell: reference,
            match,
            expected_sha256: sha256(String(cell.equals)),
            actual_sha256: actual === undefined ? null : sha256(String(actual)),
          },
        );
      }
      if (sheet && Number.isInteger(headerRow)) {
        workbookRows += [...sheet.populatedRows].filter(
          (row) => row > (headerRow as number),
        ).length;
      }
    }
    if (runtime) runtime.actualRows = workbookRows;
    add(
      `artifact_rows:${policyLabel}`,
      Boolean(runtime && workbook && workbookRows === runtime.descriptor.rows),
      "P1",
      "Workbook data-row count must match the manifest.",
      { declared: runtime?.descriptor?.rows ?? null, actual: workbook ? workbookRows : null },
    );
  }

  const algebra: AlgebraAssertion[] = Array.isArray(manifest?.algebra)
    ? manifest.algebra.filter(isPlainObject)
    : [];
  add("algebra_present", algebra.length > 0, "P1", "At least one algebra assertion is required.");
  const algebraIds = new Set<string>();
  for (const assertion of algebra) {
    const checkId = assertion?.check_id;
    const unique = Boolean(checkId) && !algebraIds.has(checkId as string);
    if (checkId) algebraIds.add(checkId);
    add(`algebra_identity:${checkId}`, unique, "P1", "Algebra check IDs must be unique.");
    try {
      const outcome = evaluateAssertion(assertion, artifactsById);
      add(`algebra:${checkId}`, outcome.passed, "P1", "Algebra assertion must evaluate true.", {
        operator: outcome.operator,
        left: outcome.left,
        right: outcome.right,
      });
    } catch (error) {
      add(
        `algebra:${checkId}`,
        false,
        "P1",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const redaction = manifest?.redaction;
  const scanIds = redactionScanIds(redaction);
  add(
    "redaction_contract",
    redactionContractValid(redaction),
    "P1",
    `Redaction contract requires unique artifact IDs and at most ${MAX_FORBIDDEN_LITERALS} bounded non-empty forbidden literals.`,
  );
  const redactableIds = redactableArtifactIds(artifacts);
  add(
    "redaction_coverage",
    stableJson([...scanIds].sort(compareText)) === stableJson(redactableIds),
    "P1",
    "Redaction scanning must cover every textual or workbook artifact exactly once.",
    {
      required_count: redactableIds.length,
      scan_count: scanIds.length,
      required_sha256: sha256(stableJson(redactableIds)),
      scan_sha256: sha256(stableJson([...scanIds].sort(compareText))),
    },
  );
  // The manifest is scanned through its decoded content, so an escaped key or value cannot hide a
  // literal from the check. `redaction.forbidden_literals` is excluded because it is the scanning
  // contract itself: declaring a forbidden literal must not make the manifest report its own
  // configuration as a leak.
  const policy = isPlainObject(manifest?.redaction) ? manifest.redaction : {};
  const manifestScanText = scanTextWithDecodedStrings("", {
    ...manifest,
    redaction: { ...policy, forbidden_literals: [] },
  });
  // The declared forbidden literals are applied here. They are excluded from the scan target above
  // so declaring one cannot self-report, but reusing one anywhere else in the manifest is a leak.
  const manifestSecretCodes = secretFindingCodes(manifestScanText, forbiddenLiterals);
  add(
    "redaction:manifest",
    manifestSecretCodes.length === 0,
    "P0",
    "Manifest must not contain credential-shaped or user-absolute-path content.",
    { finding_codes: manifestSecretCodes },
  );
  for (const [scanIndex, artifactId] of scanIds.entries()) {
    const scanLabel = safeLabel(artifactId, scanIndex + 1, forbiddenLiterals);
    const runtime = artifactsById.get(artifactId);
    const scanText = runtime?.parsed?.scanText;
    const codes =
      typeof scanText === "string" ? secretFindingCodes(scanText, forbiddenLiterals) : [];
    add(
      `redaction:${scanLabel}`,
      Boolean(runtime && typeof scanText === "string" && codes.length === 0),
      "P0",
      "Scanned artifact must be textual and free of secret-like, forbidden, or user-absolute-path content.",
      { finding_codes: codes },
    );
  }

  const reviewers = reviewerDeclarations(manifest ?? {});
  add("reviewers_present", reviewers.length > 0, "P1", "At least one reviewer is required.");
  const reviewerIds = new Set<string>();
  const reviewerArtifacts = new Set<string>();
  // The exact bytes the manifest currently binds, used to prove a reviewer report describes the
  // content under promotion rather than a superseded revision of it.
  const currentBindings = new Map<string, { sha256: string; bytes: number }>();
  for (const [artifactId, runtime] of artifactsById) {
    if (runtime.buffer) {
      currentBindings.set(artifactId, {
        sha256: sha256(runtime.buffer),
        bytes: runtime.buffer.byteLength,
      });
    }
  }
  for (const [reviewerIndex, reviewer] of reviewers.entries()) {
    const reviewerId = reviewer?.reviewer_id;
    const reviewerLabel = safeLabel(reviewerId, reviewerIndex + 1, forbiddenLiterals);
    const artifactId = reviewer?.artifact_id;
    const identityOk = reviewerIdentityValid(
      reviewer,
      manifest?.producer_id,
      reviewerIds,
      reviewerArtifacts,
    );
    if (reviewerId) reviewerIds.add(reviewerId);
    if (artifactId) reviewerArtifacts.add(artifactId);
    add(
      `reviewer_identity:${reviewerLabel}`,
      identityOk,
      "P1",
      "Reviewer identities must be independent and unique.",
    );
    const report = artifactId ? artifactsById.get(artifactId)?.parsed?.json : undefined;
    const required = Array.isArray(reviewer?.required_artifact_ids)
      ? (reviewer.required_artifact_ids as unknown[])
      : [];
    add(
      `reviewer_pass:${reviewerLabel}`,
      reviewerPassValid(report, reviewerId),
      "P1",
      "Reviewer report must be content-bound PASS with P0=0 and P1=0.",
    );
    add(
      `reviewer_coverage:${reviewerLabel}`,
      reviewerCoverageValid(report, required, currentBindings, artifactId),
      "P1",
      "Reviewer report must bind every manifest-required artifact exactly once, excluding its own report and any unknown identity.",
    );
    add(
      `reviewer_content_binding:${reviewerLabel}`,
      reviewerContentBindingValid(report, required, currentBindings),
      "P1",
      "Reviewer artifact bindings must match the exact SHA-256 and byte count the manifest currently binds.",
    );
  }

  return {
    rows,
    schemaValid: schemaOutcome.valid,
    forbiddenLiterals,
    manifestSha256: sha256(manifestRaw),
    deliveryRoot,
    artifacts: [...artifactsById.entries()].map(([artifactId, runtime], index) => ({
      artifact_id: safeLabel(artifactId, index + 1, forbiddenLiterals),
      path: runtime.descriptor.path
        ? safeLabel(runtime.descriptor.path, index + 1, forbiddenLiterals)
        : null,
      sha256: runtime.buffer ? sha256(runtime.buffer) : null,
      bytes: runtime.buffer?.byteLength ?? null,
      rows: runtime.actualRows,
      schema: runtime.descriptor.schema
        ? safeLabel(runtime.descriptor.schema, index + 1, forbiddenLiterals)
        : null,
    })),
  };
}
