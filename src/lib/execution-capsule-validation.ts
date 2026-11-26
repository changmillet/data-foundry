import fs from "node:fs";
import path from "node:path";
import {
  LEDGER_SCHEMA,
  REPORT_SCHEMA,
  SEAL_SCHEMA,
  STAGE_SCHEMA,
  boundaryChecks,
  canonicalSemanticBytes,
  checkCollector,
  compareText,
  dependencyCycle,
  dependencyIds,
  freshnessChecks,
  isSha256,
  pathIsInside,
  semanticSha256,
  sha256,
  stableJson,
  type BoundaryContract,
  type JsonRecord,
  type MaterializedLeaf,
  type ReviewerReport,
  type StageLeaf,
  type StageManifest,
  type ValidationResult,
} from "./execution-capsule-checks.ts";

export {
  LEDGER_SCHEMA,
  REPORT_SCHEMA,
  SEAL_SCHEMA,
  compareText,
  pathIsInside,
  sha256,
  stableJson,
  type JsonRecord,
  type StageManifest,
  type ValidationResult,
};

export function validateExecutionCapsuleStage({
  manifest,
  manifestPath,
  manifestRaw,
  predecessorOption,
  repoRoot,
}: {
  manifest: StageManifest;
  manifestPath: string;
  manifestRaw: Buffer;
  predecessorOption: unknown;
  repoRoot: string;
}): ValidationResult {
  const { add, rows } = checkCollector();
  add(
    "stage_schema",
    manifest?.schema_version === STAGE_SCHEMA,
    manifest?.schema_version === STAGE_SCHEMA
      ? "Stage schema is supported."
      : `Expected ${STAGE_SCHEMA}.`,
  );
  add("stage_id", Boolean(manifest?.stage_id), "A non-empty stage_id is required.");
  add("stage_producer_id", Boolean(manifest?.producer_id), "A non-empty producer_id is required.");
  add(
    "stage_revision",
    Number.isInteger(manifest.revision) && Number(manifest.revision) >= 1,
    "Revision must be a positive integer.",
  );
  const predecessorHash = manifest?.predecessor_stage_manifest_sha256;
  if (manifest?.revision === 1) {
    add(
      "stage_predecessor_absent",
      predecessorHash === null && !predecessorOption,
      "Revision 1 has no predecessor manifest or predecessor CLI input.",
    );
  } else {
    add(
      "stage_predecessor_descriptor",
      isSha256(predecessorHash),
      "Later revisions require a predecessor SHA-256 descriptor.",
    );
    const predecessorPath = predecessorOption
      ? path.resolve(repoRoot, predecessorOption as string)
      : null;
    const repoReal = fs.realpathSync(repoRoot);
    let predecessorSafe = false;
    let predecessorRaw: Buffer | null = null;
    if (
      predecessorPath &&
      pathIsInside(repoRoot, predecessorPath) &&
      fs.existsSync(predecessorPath)
    ) {
      const predecessorStat = fs.lstatSync(predecessorPath);
      predecessorSafe = predecessorStat.isFile() && !predecessorStat.isSymbolicLink();
      if (predecessorSafe) {
        predecessorSafe = pathIsInside(repoReal, fs.realpathSync(predecessorPath));
      }
      if (predecessorSafe) predecessorRaw = fs.readFileSync(predecessorPath);
    }
    add(
      "stage_predecessor_file_safe",
      predecessorSafe,
      "Later revisions require a regular, non-symlink predecessor manifest inside the repository.",
      { path: predecessorOption ?? null },
    );
    add(
      "stage_predecessor_hash_exact",
      Boolean(predecessorRaw && sha256(predecessorRaw) === predecessorHash),
      "The predecessor manifest bytes must match the declared predecessor SHA-256.",
    );
    let predecessorManifest: StageManifest | null = null;
    if (predecessorRaw) {
      try {
        predecessorManifest = JSON.parse(predecessorRaw.toString("utf8")) as StageManifest;
      } catch {
        predecessorManifest = null;
      }
    }
    add(
      "stage_predecessor_lineage",
      Boolean(
        predecessorManifest?.schema_version === STAGE_SCHEMA &&
        predecessorManifest?.stage_id === manifest?.stage_id &&
        predecessorManifest?.producer_id === manifest?.producer_id &&
        predecessorManifest?.revision === Number(manifest.revision) - 1,
      ),
      "The predecessor must be the immediately prior revision for the same stage and producer.",
    );
  }
  add(
    "stage_offline_only",
    manifest?.admission_mode === "OFFLINE_ONLY" && manifest?.production_authority === false,
    "MVP admission accepts offline-only, non-production-authority stages.",
  );
  add(
    "stage_findings_zero",
    manifest?.findings?.p0 === 0 && manifest?.findings?.p1 === 0,
    "Stage-declared P0 and P1 findings must both be zero.",
  );
  add(
    "scope_binding_sha256",
    isSha256(manifest?.scope_binding_sha256),
    "Stage scope binding must be a SHA-256 value.",
  );

  const attempt = manifest?.attempt_state;
  add(
    "attempt_unconsumed",
    Boolean(
      attempt?.status === "UNATTEMPTED" &&
      attempt?.attempt_count === 0 &&
      attempt?.primary_attempt_count === 0,
    ),
    "Pre-seal admission requires an unattempted stage with zero attempt counts.",
  );
  add(
    "attempt_zero_dispatch",
    Boolean(
      attempt?.dispatch_state === "NOT_DISPATCHED" &&
      attempt?.mutation_state === "NONE" &&
      attempt?.readback_state === "NOT_STARTED",
    ),
    "Pre-seal admission requires zero dispatch, zero mutation, and no readback.",
  );

  const manifestDir = path.dirname(manifestPath);
  const stageRoot = path.resolve(manifestDir, manifest?.stage_root || ".");
  const rootExists = fs.existsSync(stageRoot) && fs.statSync(stageRoot).isDirectory();
  add("stage_root", rootExists, "Stage root must resolve to an existing directory.", {
    stage_root: stageRoot,
  });
  const rootReal = rootExists ? fs.realpathSync(stageRoot) : stageRoot;

  const leaves = Array.isArray(manifest.leaves) ? manifest.leaves : [];
  add("stage_leaves", leaves.length > 0, "At least one CAS leaf is required.", {
    leaf_count: leaves.length,
  });
  const leavesById = new Map<string, StageLeaf>();
  const leafBuffers = new Map<string, Buffer>();
  const leafPaths = new Set<string>();
  const materializedLeaves: MaterializedLeaf[] = [];
  for (const leaf of leaves) {
    const leafId = leaf?.leaf_id;
    const identityOk = Boolean(leafId) && !leavesById.has(leafId ?? "");
    add(
      `leaf_identity:${leafId ?? "missing"}`,
      identityOk,
      "Leaf IDs must be non-empty and unique.",
    );
    if (leafId && !leavesById.has(leafId)) leavesById.set(leafId, leaf);

    const relativePath = leaf?.path;
    add(`leaf_role:${leafId}`, Boolean(leaf?.role), "Every leaf requires a non-empty role.");
    add(
      `leaf_executable_flag:${leafId}`,
      typeof leaf?.executable_input === "boolean",
      "Every leaf requires an explicit executable_input boolean.",
    );
    const candidate =
      typeof relativePath === "string" ? path.resolve(stageRoot, relativePath) : null;
    const confined = Boolean(candidate && rootExists && pathIsInside(stageRoot, candidate));
    add(`leaf_path_confined:${leafId}`, confined, "Leaf path must stay inside the stage root.", {
      path: relativePath ?? null,
    });
    const pathUnique = Boolean(relativePath) && !leafPaths.has(relativePath ?? "");
    add(`leaf_path_unique:${leafId}`, pathUnique, "Leaf paths must be non-empty and unique.");
    if (relativePath) leafPaths.add(relativePath);

    let buffer: Buffer | null = null;
    let pathSafe = false;
    if (confined && candidate && fs.existsSync(candidate)) {
      const stat = fs.lstatSync(candidate);
      pathSafe = stat.isFile() && !stat.isSymbolicLink();
      if (pathSafe) {
        const real = fs.realpathSync(candidate);
        pathSafe = pathIsInside(rootReal, real);
      }
      if (pathSafe) buffer = fs.readFileSync(candidate);
    }
    add(
      `leaf_file_safe:${leafId}`,
      pathSafe,
      "Leaf must be a regular non-symlink file in stage root.",
    );
    if (leafId && buffer) leafBuffers.set(leafId, buffer);

    const rawDescriptorOk = Boolean(
      leaf?.raw_hash?.algorithm === "sha256" &&
      isSha256(leaf?.raw_hash?.sha256) &&
      Number.isInteger(leaf?.raw_hash?.bytes) &&
      Number(leaf.raw_hash?.bytes) >= 0,
    );
    add(
      `leaf_raw_descriptor:${leafId}`,
      rawDescriptorOk,
      "Raw hash descriptor is typed and complete.",
    );
    if (buffer) {
      add(
        `leaf_raw_hash:${leafId}`,
        sha256(buffer) === leaf?.raw_hash?.sha256,
        "Leaf raw SHA-256 must match exact file bytes.",
      );
      add(
        `leaf_raw_bytes:${leafId}`,
        buffer.byteLength === leaf?.raw_hash?.bytes,
        "Leaf byte count must match exact file bytes.",
      );
    }

    const semanticDescriptorOk = Boolean(
      leaf?.semantic_hash?.algorithm === "sha256" &&
      leaf?.semantic_hash?.domain &&
      leaf?.semantic_hash?.canonicalizer_id &&
      isSha256(leaf?.semantic_hash?.sha256),
    );
    add(
      `leaf_semantic_descriptor:${leafId}`,
      semanticDescriptorOk,
      "Semantic hash descriptor requires domain, canonicalizer, and SHA-256.",
    );
    const semanticHash = leaf.semantic_hash;
    if (buffer && semanticDescriptorOk && semanticHash?.canonicalizer_id && semanticHash.domain) {
      try {
        const canonical = canonicalSemanticBytes(buffer, semanticHash.canonicalizer_id);
        add(
          `leaf_semantic_hash:${leafId}`,
          semanticSha256(semanticHash.domain, canonical) === semanticHash.sha256,
          "Leaf semantic SHA-256 must match its declared canonicalizer.",
        );
      } catch (error) {
        add(
          `leaf_semantic_hash:${leafId}`,
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    add(
      `scope_leaf_binding:${leafId}`,
      isSha256(leaf?.scope_binding_sha256) &&
        leaf.scope_binding_sha256 === manifest?.scope_binding_sha256,
      "Every leaf must bind the exact stage scope SHA-256.",
    );
    add(
      `leaf_dependencies_shape:${leafId}`,
      Array.isArray(leaf?.dependency_leaf_ids),
      "Every leaf requires an explicit dependency_leaf_ids array.",
    );
    freshnessChecks(leaf, add);
    materializedLeaves.push({
      leaf_id: leafId ?? null,
      path: relativePath ?? null,
      role: leaf?.role ?? null,
      executable_input: leaf?.executable_input === true,
      raw_sha256: buffer ? sha256(buffer) : null,
      semantic_sha256: leaf?.semantic_hash?.sha256 ?? null,
      freshness_class: leaf?.freshness_class ?? null,
    });
  }

  for (const leaf of leaves) {
    add(
      `dependency_unique:${leaf?.leaf_id}`,
      new Set(dependencyIds(leaf)).size === dependencyIds(leaf).length,
      "Dependency leaf IDs must not repeat within a leaf.",
    );
    for (const dependencyId of dependencyIds(leaf)) {
      add(
        `dependency_exists:${leaf?.leaf_id}:${dependencyId}`,
        leavesById.has(dependencyId),
        "Every dependency must reference a leaf in the same stage.",
      );
    }
  }
  const cycle = dependencyCycle(leavesById);
  add("dependency_acyclic", !cycle, "Leaf dependency graph must be acyclic.", { cycle });
  const executableLeafIds = leaves
    .filter((leaf) => leaf?.executable_input === true)
    .map((leaf) => leaf.leaf_id);
  add(
    "executable_inputs_present",
    executableLeafIds.length > 0,
    "At least one leaf must be declared as an executable consumer input.",
  );

  const reviewerIds = Array.isArray(manifest?.reviewer_report_leaf_ids)
    ? manifest.reviewer_report_leaf_ids
    : [];
  add(
    "reviewer_reports_present",
    reviewerIds.length > 0,
    "At least one independent reviewer report leaf is required.",
  );
  add(
    "reviewer_reports_unique",
    new Set(reviewerIds).size === reviewerIds.length,
    "Reviewer report leaf IDs must be unique.",
  );
  for (const reviewerId of reviewerIds) {
    const reviewerLeaf = leavesById.get(reviewerId);
    add(
      `reviewer_report_role:${reviewerId}`,
      reviewerLeaf?.role === "reviewer_report",
      "Reviewer report references must resolve to reviewer_report leaves.",
    );
    try {
      const reviewerReport = JSON.parse(
        leafBuffers.get(reviewerId)?.toString("utf8") ?? "",
      ) as ReviewerReport;
      add(
        `reviewer_report_coverage_shape:${reviewerId}`,
        Array.isArray(reviewerReport?.reviewed_leaf_ids) &&
          new Set(reviewerReport.reviewed_leaf_ids).size ===
            reviewerReport.reviewed_leaf_ids.length,
        "Reviewer coverage must be an explicit array of unique leaf IDs.",
      );
      add(
        `reviewer_report_pass:${reviewerId}`,
        Boolean(
          reviewerReport?.status === "PASS" &&
          reviewerReport?.findings?.p0 === 0 &&
          reviewerReport?.findings?.p1 === 0,
        ),
        "Reviewer report must independently declare PASS with P0=0 and P1=0.",
      );
      add(
        `reviewer_report_identity:${reviewerId}`,
        Boolean(
          reviewerReport?.reviewer_id && reviewerReport.reviewer_id !== manifest?.producer_id,
        ),
        "Reviewer identity must be present and differ from the stage producer.",
      );
      add(
        `reviewer_report_scope:${reviewerId}`,
        reviewerReport?.scope_binding_sha256 === manifest?.scope_binding_sha256,
        "Reviewer report must bind the exact stage scope.",
      );
      add(
        `reviewer_report_coverage:${reviewerId}`,
        executableLeafIds.every((leafId) =>
          reviewerReport?.reviewed_leaf_ids?.includes(leafId as string),
        ),
        "Reviewer report must cover every executable input leaf.",
      );
    } catch (error) {
      add(
        `reviewer_report_parse:${reviewerId}`,
        false,
        `Reviewer report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const boundaryLeaf = leavesById.get(manifest.boundary_contract_leaf_id ?? "");
  add(
    "boundary_leaf_role",
    boundaryLeaf?.role === "consumer_boundary_contract",
    "boundary_contract_leaf_id must resolve to a consumer_boundary_contract leaf.",
  );
  if (boundaryLeaf && rootExists) {
    try {
      boundaryChecks(
        JSON.parse(
          leafBuffers.get(boundaryLeaf.leaf_id ?? "")?.toString("utf8") ?? "",
        ) as BoundaryContract,
        leafPaths,
        add,
      );
    } catch (error) {
      add(
        "boundary_parse",
        false,
        `Boundary contract is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    rows,
    materializedLeaves,
    stageRoot,
    manifestSha256: sha256(manifestRaw),
  };
}
