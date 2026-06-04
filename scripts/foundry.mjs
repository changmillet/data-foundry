#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  foundryTraceSummary,
  listImportProfiles,
  runDatasetAuthoringPatchCollect,
  runDatasetAuthoringTaskBuild,
  runDatasetCurationCleanup,
  runDatasetCurationGate,
  runDatasetMutationManifest,
} from "./lib/import-curation.mjs";
import {
  exitCodeForCommand,
  usage,
} from "./lib/foundry-command-registry.mjs";
import { parseArgs, parseScalar } from "./lib/foundry-args.mjs";
import { defaultCanonicalFlowPropertyMappings } from "./lib/canonical-support-mappings.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workflowPath = path.join(repoRoot, "WORKFLOW.md");
const capabilityRegistryPath = "specs/automated-lca-capability-registry.json";
const taskQueues = {
  inbox: "tasks/inbox",
  active: "tasks/active",
  done: "tasks/done",
};
const runtimeDirs = [
  ".foundry/logs",
  ".foundry/state",
  ".foundry/workspaces",
  ...Object.values(taskQueues),
];
const foundryTraceNamespace =
  "https://tiangong-lca.dev/foundry/import-curation/1";

const envExampleAllowedKeys = new Set([
  "TIANGONG_LCA_API_BASE_URL",
  "TIANGONG_LCA_API_KEY",
  "TIANGONG_LCA_REGION",
  "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY",
  "TIANGONG_LCA_SESSION_FILE",
  "TIANGONG_LCA_DISABLE_SESSION_CACHE",
  "TIANGONG_LCA_FORCE_REAUTH",
  "TIANGONG_AI_API_BASE_URL",
  "TIANGONG_AI_APIKEY",
  "TIANGONG_AI_CLI",
  "TIANGONG_AI_CLI_BIN",
  "TIANGONG_LCA_KB_SEARCH_API_BASE_URL",
  "TIANGONG_LCA_KB_SEARCH_API_KEY",
  "TIANGONG_LCA_KB_SEARCH_REGION",
  "TIANGONG_LCA_UNSTRUCTURED_API_BASE_URL",
  "TIANGONG_LCA_UNSTRUCTURED_API_KEY",
  "TIANGONG_LCA_UNSTRUCTURED_PROVIDER",
  "TIANGONG_LCA_UNSTRUCTURED_MODEL",
  "TIANGONG_LCA_UNSTRUCTURED_CHUNK_TYPE",
  "TIANGONG_LCA_UNSTRUCTURED_RETURN_TXT",
  "UNSTRUCTURED_API_BASE_URL",
  "UNSTRUCTURED_AUTH_TOKEN",
  "UNSTRUCTURED_PROVIDER",
  "UNSTRUCTURED_MODEL",
  "TIANGONG_LCA_REVIEW_LLM_BASE_URL",
  "TIANGONG_LCA_REVIEW_LLM_API_KEY",
  "TIANGONG_LCA_REVIEW_LLM_MODEL",
  "TIANGONG_LCA_CLI_BIN",
  "TIANGONG_LCA_CLI_DIR",
  "TIANGONG_LCA_SKILLS_ROOT",
]);
const envExampleAllowedPrefixes = ["FOUNDRY_"];
const envExampleForbiddenKeys = new Map([
  [
    "TIANGONG_LCA_COVERAGE",
    "CLI test-only toggle; keep it in tiangong-lca-cli.",
  ],
  [
    "TIANGONG_LCA_TIDAS_SDK_DIR",
    "CLI development override; Foundry should use CLI contract-pack outputs.",
  ],
  [
    "SUPABASE_URL",
    "Legacy generic Supabase env; use TIANGONG_LCA_API_* instead.",
  ],
  [
    "SUPABASE_KEY",
    "Legacy generic Supabase env; use TIANGONG_LCA_API_* instead.",
  ],
  [
    "GITHUB_TOKEN",
    "Tracker or GitHub credentials do not belong in the public env example.",
  ],
]);

loadRuntimeEnv();

function nowIso() {
  return new Date().toISOString();
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function executableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveTiangongLcaCliBin() {
  if (process.env.TIANGONG_LCA_CLI_BIN) {
    return process.env.TIANGONG_LCA_CLI_BIN;
  }
  const candidateDirs = [
    process.env.TIANGONG_LCA_CLI_DIR,
    path.resolve(repoRoot, "..", "tiangong-lca-cli"),
  ].filter(Boolean);
  for (const candidateDir of candidateDirs) {
    const candidate = path.join(candidateDir, "bin", "tiangong-lca.js");
    if (executableFile(candidate)) {
      return candidate;
    }
  }
  return "tiangong-lca";
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readJsonLines(filePath) {
  return readText(filePath)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSONL at ${repoRelativePath(filePath)}:${index + 1}: ${error}`,
        );
      }
    });
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileExists(filePath) {
  return Boolean(
    filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
  );
}

function directoryExists(filePath) {
  return Boolean(
    filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory(),
  );
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function repoRelativePath(filePath) {
  return path.relative(repoRoot, filePath);
}

function repoRelativeMaybe(filePath) {
  return filePath ? repoRelativePath(filePath) : null;
}

function sha256Text(value) {
  return createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

function sourceReferenceRewritesFileForRowsFile(rowsFile, options = {}) {
  const configured = resolveRepoPath(
    options.sourceReferenceRewrites ||
      options.sourceReferenceRewritesFile ||
      options.sourceReferenceRewriteFile ||
      options.referenceRewrites ||
      options.referenceRewritesFile,
  );
  if (configured && fileExists(configured)) return configured;
  if (!rowsFile) return null;
  const rowsDir = path.dirname(rowsFile);
  const candidates = [
    path.join(rowsDir, "source-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "source-reference-rewrites.jsonl"),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

function identityReferenceRewritesFileForRowsFile(rowsFile, options = {}) {
  const configured = resolveRepoPath(
    options.identityReferenceRewrites ||
      options.identityReferenceRewritesFile ||
      options.identityFlowReferenceRewrites ||
      options.identityFlowReferenceRewritesFile,
  );
  if (configured && fileExists(configured)) return configured;
  if (!rowsFile) return null;
  const rowsDir = path.dirname(rowsFile);
  const candidates = [
    path.join(rowsDir, "identity-reference-rewrites.jsonl"),
    path.join(rowsDir, "identity-flow-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-flow-reference-rewrites.jsonl"),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

function datasetRowsFileStem(datasetType) {
  return (
    {
      contact: "contacts",
      flow: "flows",
      flowproperty: "flowproperties",
      lifecyclemodel: "lifecyclemodels",
      process: "processes",
      source: "sources",
      support: "support",
      unitgroup: "unitgroups",
    }[asText(datasetType).toLowerCase()] || `${datasetType}s`
  );
}

function existingSiblingRowsFile(rowsFile, fileName) {
  if (!rowsFile) return null;
  const candidate = path.join(path.dirname(rowsFile), fileName);
  return fileExists(candidate) && countRowsFile(candidate) > 0 ? candidate : null;
}

function defaultFinalizeSupportRowsFiles(rowsFile) {
  const support = existingSiblingRowsFile(rowsFile, "support.jsonl");
  if (support) return [support];
  return [
    existingSiblingRowsFile(rowsFile, "contacts.jsonl"),
    existingSiblingRowsFile(rowsFile, "sources.jsonl"),
  ].filter(Boolean);
}

function identityRewriteExternalFlowRefRows(identityReferenceRewriteStage) {
  const seen = new Set();
  const rows = [];
  for (const rewrite of ensureArray(identityReferenceRewriteStage?.rewrite_rows)) {
    const canonical = rewrite?.canonical ?? {};
    const id = asText(
      canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id,
    );
    if (!id) continue;
    const version = asText(canonical.version) || "00.00.001";
    const key = `${id}@@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id,
      dataset_id: id,
      version,
      dataset_version: version,
      source: "identity_reference_rewrite",
      reason:
        "Existing database flow selected by CLI identity-preflight and used as an external flow reference for curation queue dependency closure.",
    });
  }
  return rows;
}

function writeIdentityRewriteExternalFlowRefs({
  outDir,
  identityReferenceRewriteStage,
}) {
  const rows = identityRewriteExternalFlowRefRows(identityReferenceRewriteStage);
  if (rows.length === 0) return null;
  const filePath = path.join(
    outDir,
    "identity-reference-rewrite-external-flow-refs.jsonl",
  );
  writeJsonLines(filePath, rows);
  return filePath;
}

function existingOptionFiles(value, label) {
  return normalizedList(value).map((input) => {
    const resolved = resolveRepoPath(input);
    if (!fileExists(resolved)) {
      throw new Error(`${label} must point to an existing file: ${input}`);
    }
    return resolved;
  });
}

function existingOptionFile(value, label) {
  const files = existingOptionFiles(value, label);
  if (files.length > 1) {
    throw new Error(`${label} accepts one file, received ${files.length}.`);
  }
  return files[0] ?? null;
}

function curationQueueManifestFile(queueDir) {
  if (!queueDir) return null;
  const manifest = path.join(
    queueDir,
    "outputs",
    "curation-queue-manifest.json",
  );
  return fileExists(manifest) ? manifest : null;
}

function writeProcessReferenceExternalFlowRefs({
  outDir,
  processRowsFile,
  flowRowsFile,
}) {
  if (!processRowsFile || !fileExists(processRowsFile)) return null;
  const localFlowKeys = new Set();
  for (const row of readRowsFile(flowRowsFile)) {
    const identity = datasetIdentity(row, "flow");
    if (!identity.id) continue;
    localFlowKeys.add(identity.id);
    localFlowKeys.add(`${identity.id}@@${identity.version || "00.00.001"}`);
  }

  const refs = new Map();
  for (const [rowIndex, row] of readRowsFile(processRowsFile).entries()) {
    const processIdentity = datasetIdentity(row, "process");
    const exchanges = ensureArray(row?.processDataSet?.exchanges?.exchange);
    for (const [exchangeIndex, exchange] of exchanges.entries()) {
      const reference = exchange?.referenceToFlowDataSet;
      if (!reference || typeof reference !== "object") continue;
      const id = asText(reference["@refObjectId"]);
      if (!id) continue;
      const version = asText(reference["@version"]) || "00.00.001";
      if (localFlowKeys.has(id) || localFlowKeys.has(`${id}@@${version}`)) {
        continue;
      }
      const key = `${id}@@${version}`;
      const existing =
        refs.get(key) ?? {
          id,
          dataset_id: id,
          version,
          dataset_version: version,
          table: "flows",
          source: "process_reference_remote_verify_required",
          short_description: referenceShortDescription(reference) || id,
          reason:
            "Process references this flow outside the current local flow write scope. Foundry declares it as an external flow reference for curation queue closure; mutation manifest and remote verification must prove it exists before commit.",
          references: [],
        };
      existing.references.push({
        process_id: processIdentity.id,
        process_version: processIdentity.version || "00.00.001",
        row_index: rowIndex,
        path: `processDataSet.exchanges.exchange.${exchangeIndex}.referenceToFlowDataSet`,
      });
      refs.set(key, existing);
    }
  }

  const rows = [...refs.values()];
  const outFile = path.join(outDir, "process-reference-external-flow-refs.jsonl");
  writeJsonLines(outFile, rows);
  return rows.length > 0 ? outFile : null;
}

function runFinalizeAutoCurationQueue({
  datasetType,
  rowsFile,
  cleanedRowsFile,
  outDir,
  options,
  fullContextRequirement,
  identityReferenceRewriteStage,
}) {
  const providedQueueDir = resolveRepoPath(
    options.queueDir || options.curationQueueDir,
  );
  if (providedQueueDir) {
    return {
      stage: "curation_queue",
      status: "provided",
      queue_dir: providedQueueDir,
      report_file: curationQueueManifestFile(providedQueueDir),
      report: null,
      files: {},
    };
  }
  if (!(Boolean(fullContextRequirement) && datasetType === "process")) {
    return {
      stage: "curation_queue",
      status: "not_required",
      queue_dir: null,
      report_file: null,
      report: null,
      files: {},
    };
  }

  const queueDir = path.join(outDir, "curation-queue");
  const queueInputsDir = path.join(outDir, "curation-queue-inputs");
  const flowsFile =
    existingOptionFile(
      options.flows || options.flowsFile || options.flowRows,
      "--flows",
    ) ?? existingSiblingRowsFile(rowsFile, "flows.jsonl");
  const explicitSupportFiles = existingOptionFiles(
    options.support || options.supportFile || options.supportRows,
    "--support",
  );
  const supportFiles =
    explicitSupportFiles.length > 0
      ? explicitSupportFiles
      : defaultFinalizeSupportRowsFiles(rowsFile);
  const explicitExternalFlowRefs = existingOptionFiles(
    options.externalFlowRef ||
      options.externalFlowRefs ||
      options.externalFlowRefFile ||
      options.externalFlowRefRows,
    "--external-flow-ref",
  );
  const identityExternalRefs = writeIdentityRewriteExternalFlowRefs({
    outDir: queueInputsDir,
    identityReferenceRewriteStage,
  });
  const processReferenceExternalRefs = writeProcessReferenceExternalFlowRefs({
    outDir: queueInputsDir,
    processRowsFile: cleanedRowsFile,
    flowRowsFile: flowsFile,
  });
  const externalFlowRefFiles = unique([
    ...explicitExternalFlowRefs,
    identityExternalRefs,
    processReferenceExternalRefs,
  ]).filter(Boolean);

  const report = runDatasetCurationQueueBuild({
    processes: cleanedRowsFile,
    flows: flowsFile,
    support: supportFiles,
    externalFlowRef: externalFlowRefFiles,
    outDir: queueDir,
  });
  return {
    stage: "curation_queue",
    status: report.status,
    queue_dir: queueDir,
    report_file: resolveRepoPath(report.files?.manifest),
    report,
    files: {
      manifest: report.files?.manifest ?? null,
      identity_external_flow_refs: repoRelativeMaybe(identityExternalRefs),
      process_reference_external_flow_refs: repoRelativeMaybe(
        processReferenceExternalRefs,
      ),
    },
  };
}

function runFinalizeIdentityPreflightStage({
  rowsFile,
  outDir,
  options,
}) {
  if (!booleanOption(options.runIdentityPreflight)) {
    return {
      stage: "identity_preflight_run",
      status: "not_requested",
      report: null,
      report_file: null,
    };
  }
  const indexPath =
    identityPreflightRunIndexPath(options) ||
    identityReferenceRewriteIndexPath(options, rowsFile);
  if (!indexPath || !fileExists(indexPath)) {
    throw new Error(
      "--run-identity-preflight requires --identity-preflight-index, --index, or a sibling identity-preflight-requests/identity-preflight-requests.jsonl.",
    );
  }
  const report = runDatasetIdentityPreflightRun({
    index: indexPath,
    outDir: path.join(outDir, "identity-preflight-run"),
    onlyPending:
      options.onlyPending === undefined ? true : booleanOption(options.onlyPending),
    timeoutMs:
      options.identityPreflightTimeoutMs ||
      options.identityPreflightTimeout ||
      options.timeoutMs ||
      options.timeout,
    dryRun:
      options.identityPreflightDryRun ||
      options.dryRunIdentityPreflight,
  });
  return {
    stage: "identity_preflight_run",
    status: report.status,
    report,
    report_file: resolveRepoPath(report.files?.report),
  };
}

function sameResolvedPath(left, right) {
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}

function reportInputPath(report) {
  return asText(
    report?.input_path ||
      report?.input_file ||
      report?.inputPath ||
      report?.inputFile,
  );
}

function countRowsFile(filePath) {
  if (!filePath || !fileExists(filePath)) return 0;
  const text = readText(filePath);
  if (!text.trim()) return 0;
  if (filePath.toLowerCase().endsWith(".jsonl")) {
    return text.split(/\r?\n/u).filter((line) => line.trim()).length;
  }
  const value = JSON.parse(text);
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.rows)) return value.rows.length;
  if (Array.isArray(value?.items)) return value.items.length;
  return 1;
}

function countJsonLinesFile(filePath) {
  if (!filePath || !fileExists(filePath)) return 0;
  return readText(filePath)
    .split(/\r?\n/u)
    .filter((line) => line.trim()).length;
}

function readRowsFile(filePath) {
  if (!filePath || !fileExists(filePath)) return [];
  if (filePath.toLowerCase().endsWith(".jsonl")) {
    return readJsonLines(filePath);
  }
  const value = readJson(filePath);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  return [value];
}

function findFilesByName(startDir, fileName, maxDepth = 8) {
  const root = resolveRepoPath(startDir);
  if (!root || !directoryExists(root)) return [];
  const found = [];
  const ignoredDirs = new Set([".git", "node_modules"]);
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) walk(entryPath, depth + 1);
      } else if (entry.isFile() && entry.name === fileName) {
        found.push(entryPath);
      }
    }
  }
  walk(root, 0);
  return found.sort();
}

function asText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

function splitFrontmatter(text) {
  if (!text.startsWith("---\n")) return { frontmatter: "", body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) throw new Error("Missing closing frontmatter marker.");
  return {
    frontmatter: text.slice(4, end),
    body: text.slice(end + 5),
  };
}

function replaceFrontmatterField(frontmatter, key, value) {
  const lines = frontmatter.split(/\r?\n/u);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.match(new RegExp(`^${key}:\\s*`, "u"))) {
      replaced = true;
      return `${key}: ${value}`;
    }
    return line;
  });
  if (!replaced) {
    nextLines.push(`${key}: ${value}`);
  }
  return nextLines.join("\n").replace(/\n+$/u, "");
}

function taskMetaFromFile(filePath) {
  const text = readText(filePath);
  const { frontmatter, body } = splitFrontmatter(text);
  const meta = {};
  for (const line of frontmatter.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/u);
    if (match) meta[match[1]] = parseScalar(match[2]);
  }
  return { text, frontmatter, body, meta };
}

function profileFullContextRequirement(profileId, datasetType) {
  const listing = listImportProfiles({ repoRoot });
  const requestedProfileId = asText(
    profileId || listing.default_profile || "generic",
  ).toLowerCase();
  const defaultProfileId = asText(
    listing.default_profile || "generic",
  ).toLowerCase();
  const profile =
    listing.profiles?.[requestedProfileId] ??
    listing.profiles?.[defaultProfileId] ??
    listing.profiles?.generic;
  const requirement = profile?.full_context_ai_completion;
  if (requirement?.required !== true) return null;

  const requiredDatasetTypes = normalizedList(
    requirement.dataset_types ?? requirement.datasetTypes,
  ).map((value) => value.toLowerCase());
  const normalizedDatasetType = asText(datasetType).toLowerCase();
  if (
    requiredDatasetTypes.length > 0 &&
    !requiredDatasetTypes.includes(normalizedDatasetType)
  ) {
    return null;
  }

  return {
    profile_id: profile?.id ?? requestedProfileId,
    dataset_type: normalizedDatasetType || null,
    required_context_kinds: normalizedList(
      requirement.required_context_kinds ?? requirement.requiredContextKinds,
    ),
    required_context_file_patterns: normalizedList(
      requirement.required_context_file_patterns ??
        requirement.requiredContextFilePatterns,
    ),
  };
}

function taskProfileId(task) {
  return asText(
    task?.meta?.profile ??
      task?.meta?.import_profile ??
      task?.meta?.importProfile ??
      task?.meta?.dataset_profile ??
      task?.meta?.datasetProfile,
  );
}

function taskDatasetType(task) {
  return asText(task?.meta?.dataset_type ?? task?.meta?.datasetType);
}

function fullContextCount(counts, key) {
  const value = Number(counts?.[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeProofRows(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(value?.decisions)) return value.decisions.filter(Boolean);
  if (Array.isArray(value?.rows)) return value.rows.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

function readJsonOrJsonlRowsArtifact(value) {
  const resolved = resolveRepoPath(value);
  if (!resolved || !fileExists(resolved)) {
    return { path: resolved, rows: [], error: "missing" };
  }
  try {
    if (resolved.endsWith(".jsonl")) {
      return { path: resolved, rows: readJsonLines(resolved), error: null };
    }
    return {
      path: resolved,
      rows: normalizeProofRows(readJson(resolved)),
      error: null,
    };
  } catch (error) {
    return {
      path: resolved,
      rows: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const fullContextPatchResolutionModes = new Set([
  "evidence_backed_completion",
  "source_language_normalization",
  "classification_decision",
  "location_decision",
  "source_trace_verified",
  "deferred_to_common_other",
]);

function patchEvidenceResolution(entry) {
  return entry?.resolution && typeof entry.resolution === "object"
    ? entry.resolution
    : {};
}

function patchEvidenceResolutionMode(entry) {
  return asText(patchEvidenceResolution(entry).mode);
}

function patchEvidenceResolutionContextKinds(entry) {
  return unique(
    normalizedList(
      patchEvidenceResolution(entry).used_context_kinds ??
        patchEvidenceResolution(entry).usedContextKinds,
    ),
  );
}

function readAuthoringPackageProofForFullContext({
  packageRef,
  expectedSha256 = null,
  source = null,
}) {
  const packagePath = resolveRepoPath(packageRef);
  const proof = {
    source,
    path: packageRef || null,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    contract_context_files: [],
    missing_context_files: [],
    blockers: [],
  };
  if (!packageRef || !packagePath || !fileExists(packagePath)) {
    proof.blockers.push({
      code: "authoring_package_missing",
      message:
        "Patch evidence references no readable full-context authoring package.",
      authoring_package: packageRef || null,
      source,
    });
    return proof;
  }
  proof.path = repoRelativePath(packagePath);
  let payload = null;
  try {
    const rawText = readText(packagePath);
    proof.sha256 = sha256Text(rawText);
    payload = JSON.parse(rawText);
  } catch (error) {
    proof.blockers.push({
      code: "authoring_package_invalid",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.contract_context_files = ensureArray(payload?.contract_context_files);
  proof.missing_context_files = ensureArray(payload?.missing_context_files);
  if (proof.expected_sha256 && proof.expected_sha256 !== proof.sha256) {
    proof.blockers.push({
      code: "authoring_package_hash_mismatch",
      message:
        "Recorded authoring_package_sha256 does not match the current authoring package content.",
      authoring_package: proof.path,
      expected_sha256: proof.expected_sha256,
      actual_sha256: proof.sha256,
      source,
    });
  }
  return proof;
}

function authoringPackageProofsFromPatchCollect(patchCollectArtifact) {
  const manifestRef = patchCollectArtifact?.value?.task_manifest;
  const manifestArtifact = readJsonArtifactOption(manifestRef);
  if (!manifestArtifact) return [];
  return ensureArray(manifestArtifact.value?.tasks)
    .map((task) => {
      const packageRef = asText(
        task?.files?.authoring_package ?? task?.files?.authoringPackage,
      );
      if (!packageRef) return null;
      return readAuthoringPackageProofForFullContext({
        packageRef,
        expectedSha256: task?.context?.authoring_package_sha256,
        source: "patch_collect_task_manifest",
      });
    })
    .filter(Boolean);
}

function authoringPackageProofsFromCurationGate(mutationManifest) {
  const curationGateArtifact = readJsonArtifactOption(
    mutationManifest?.evidence?.curation_gate_report,
  );
  if (!curationGateArtifact) return [];
  const entities = ensureArray(
    curationGateArtifact.value?.entities ??
      curationGateArtifact.value?.processes ??
      curationGateArtifact.value?.flows ??
      curationGateArtifact.value?.items,
  );
  return entities
    .map((entity) => {
      const packageRef = asText(
        entity?.authoring_package ?? entity?.authoringPackage,
      );
      if (!packageRef) return null;
      return readAuthoringPackageProofForFullContext({
        packageRef,
        expectedSha256: entity?.authoring_package_sha256,
        source: "curation_gate",
      });
    })
    .filter(Boolean);
}

function fullContextEvidenceArtifactBlocker({
  prefix,
  codePrefix,
  suffix,
  message,
  details = {},
}) {
  return {
    ...prefix,
    code: `${codePrefix}_full_context_${suffix}`,
    message,
    ...details,
  };
}

function decisionApplyTasksFromReport(report) {
  const tasks = ensureArray(report?.decision_tasks ?? report?.decisionTasks);
  if (tasks.length > 0) return tasks;
  return report?.decision_task || report?.decisionTask
    ? [report.decision_task ?? report.decisionTask]
    : [];
}

function decisionTaskReferencePath(task) {
  return asText(
    task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask,
  );
}

function readDecisionTaskArtifactForProof(task) {
  const taskRef = decisionTaskReferencePath(task);
  const artifact = readJsonArtifactOption(taskRef);
  if (!artifact) {
    return {
      task_ref: taskRef || null,
      artifact: null,
      sha256: null,
      context_bundle_sha256: null,
      status: null,
      task_kind: null,
      blockers: [
        {
          code: "decision_task_missing",
          message:
            "Decision apply report references an unreadable AI decision task.",
          decision_task: taskRef || null,
        },
      ],
    };
  }
  const rawText = readText(artifact.path);
  const sha256 = sha256Text(rawText);
  const contextBundle =
    artifact.value?.context_bundle ?? artifact.value?.authoring_context ?? {};
  const expectedSha256 = asText(task?.sha256);
  const expectedContextBundleSha256 = asText(
    task?.context_bundle_sha256 ?? task?.contextBundleSha256,
  );
  const contextBundleSha256 = asText(
    contextBundle?.sha256 ?? contextBundle?.context_bundle_sha256,
  );
  const blockers = [];
  if (expectedSha256 && expectedSha256 !== sha256) {
    blockers.push({
      code: "decision_task_hash_mismatch",
      message:
        "Decision apply report records a decision task sha256 that no longer matches the task file.",
      decision_task: repoRelativePath(artifact.path),
      expected_sha256: expectedSha256,
      actual_sha256: sha256,
    });
  }
  if (
    expectedContextBundleSha256 &&
    contextBundleSha256 &&
    expectedContextBundleSha256 !== contextBundleSha256
  ) {
    blockers.push({
      code: "decision_task_context_bundle_hash_mismatch",
      message:
        "Decision apply report records a context_bundle_sha256 that no longer matches the task file.",
      decision_task: repoRelativePath(artifact.path),
      expected_context_bundle_sha256: expectedContextBundleSha256,
      actual_context_bundle_sha256: contextBundleSha256,
    });
  }
  return {
    task_ref: taskRef || null,
    artifact,
    sha256,
    context_bundle_sha256: contextBundleSha256,
    status: asText(artifact.value?.status),
    task_kind: asText(artifact.value?.task_kind),
    blockers,
  };
}

function decisionApplyReportRefs(evidence, reportKey, kind) {
  const values =
    kind === "identity"
      ? [
          ...ensureArray(evidence.identity_decision_apply_reports),
          ...ensureArray(evidence[reportKey]),
        ]
      : ensureArray(evidence[reportKey]);
  return unique(values.map((value) => asText(value)));
}

function buildDecisionApplyProofBlockers({
  mutationArtifact,
  requirement,
  prefix,
  codePrefix,
  kind,
  expectedCount,
}) {
  if (expectedCount <= 0) return [];
  const blockers = [];
  const mutationManifest = mutationArtifact?.value ?? {};
  const evidence = mutationManifest.evidence ?? {};
  const reportKey =
    kind === "identity"
      ? "identity_decision_apply_report"
      : kind === "location"
        ? "location_decision_apply_report"
        : "classification_decision_apply_report";
  const reportStatusKey =
    kind === "identity"
      ? "identity_decision_apply_status"
      : kind === "location"
        ? "location_decision_apply_status"
        : "classification_decision_apply_status";
  const expectedTaskKind =
    kind === "location"
      ? "location_decision_authoring"
      : "classification_decision_authoring";
  const expectedTaskStatus =
    kind === "location"
      ? "ready_for_ai_location_decisions"
      : "ready_for_ai_classification_decisions";
  const reportRefs = decisionApplyReportRefs(evidence, reportKey, kind);
  const reportArtifacts = reportRefs
    .map((reportRef) => readJsonArtifactOption(reportRef))
    .filter(Boolean);
  const reportArtifact = reportArtifacts[0] ?? null;
  if (!reportArtifact) {
    return [
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: `${kind}_decision_apply_report_missing`,
        message:
          "Mutation manifest full-context decision evidence references no readable decision apply report.",
        details: {
          mutation_manifest: repoRelativePath(mutationArtifact.path),
          expected_decision_entries: expectedCount,
          report: evidence[reportKey] ?? null,
          reports: reportRefs,
        },
      }),
    ];
  }

  const report = reportArtifact.value ?? {};
  for (const candidateReportArtifact of reportArtifacts) {
    const candidateReportStatus = asText(candidateReportArtifact.value?.status);
    if (candidateReportStatus !== "completed") {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_apply_not_completed`,
          message: `Decision apply report status is ${candidateReportStatus || "missing"}.`,
          details: { report: repoRelativePath(candidateReportArtifact.path) },
        }),
      );
    }
    if (
      asText(evidence[reportStatusKey]) &&
      asText(evidence[reportStatusKey]) !== candidateReportStatus
    ) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_apply_status_mismatch`,
          message:
            "Mutation manifest recorded decision apply status does not match the current report.",
          details: {
            report: repoRelativePath(candidateReportArtifact.path),
            manifest_status: asText(evidence[reportStatusKey]),
            actual_status: candidateReportStatus || null,
          },
        }),
      );
    }
  }

  const decisionRows = [];
  const decisionFiles = [];
  for (const candidateReportArtifact of reportArtifacts) {
    const candidateReport = candidateReportArtifact.value ?? {};
    const decisionsRef = candidateReport.decisions_file ?? candidateReport.decisionsFile;
    const decisionsArtifact = readJsonOrJsonlRowsArtifact(decisionsRef);
    if (decisionsArtifact.error) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_file_unreadable`,
          message:
            "Decision apply report must reference readable AI decision rows for closeout proof.",
          details: {
            report: repoRelativePath(candidateReportArtifact.path),
            decisions_file: decisionsRef ?? null,
            error: decisionsArtifact.error,
          },
        }),
      );
    } else {
      decisionRows.push(...decisionsArtifact.rows);
      decisionFiles.push(repoRelativePath(decisionsArtifact.path));
    }
  }
  const decisionsArtifact = { rows: decisionRows };
  if (decisionsArtifact.rows.length < expectedCount) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: `${kind}_decision_count_incomplete`,
        message:
          "Decision rows referenced by the apply report are fewer than the mutation manifest semantic evidence count.",
        details: {
          report: repoRelativePath(reportArtifact.path),
          reports: reportArtifacts.map((artifact) => repoRelativePath(artifact.path)),
          decisions_files: decisionFiles,
          expected_decision_entries: expectedCount,
          actual_decision_entries: decisionsArtifact.rows.length,
        },
      }),
    );
  }

  const taskProofs =
    kind === "identity"
      ? []
      : decisionApplyTasksFromReport(report).map((task) =>
          readDecisionTaskArtifactForProof(task),
        );
  if (kind !== "identity" && taskProofs.length === 0) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: `${kind}_decision_task_missing`,
        message:
          "Decision apply report must bind full-context AI decisions to the decision task context bundle.",
        details: { report: repoRelativePath(reportArtifact.path) },
      }),
    );
  }
  for (const taskProof of taskProofs) {
    for (const blocker of taskProof.blockers) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_${blocker.code}`,
          message: blocker.message,
          details: {
            ...blocker,
            report: repoRelativePath(reportArtifact.path),
          },
        }),
      );
    }
    if (taskProof.artifact && taskProof.task_kind !== expectedTaskKind) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_task_kind_invalid`,
          message:
            "Decision apply report references a decision task with the wrong task kind.",
          details: {
            report: repoRelativePath(reportArtifact.path),
            decision_task: repoRelativePath(taskProof.artifact.path),
            expected_task_kind: expectedTaskKind,
            actual_task_kind: taskProof.task_kind || null,
          },
        }),
      );
    }
    if (taskProof.artifact && taskProof.status !== expectedTaskStatus) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_task_status_invalid`,
          message:
            "Decision apply report references a decision task that is no longer ready for AI decisions.",
          details: {
            report: repoRelativePath(reportArtifact.path),
            decision_task: repoRelativePath(taskProof.artifact.path),
            expected_status: expectedTaskStatus,
            actual_status: taskProof.status || null,
          },
        }),
      );
    }
    if (taskProof.artifact && !taskProof.context_bundle_sha256) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_task_context_bundle_missing`,
          message:
            "Decision task must still carry context_bundle.sha256 for closeout proof.",
          details: {
            report: repoRelativePath(reportArtifact.path),
            decision_task: repoRelativePath(taskProof.artifact.path),
          },
        }),
      );
    }
  }

  const contextBundleHashes = unique(
    taskProofs.map((proof) => proof.context_bundle_sha256),
  );
  const missingCompletedStatus = decisionsArtifact.rows.filter(
    (decision) => decisionCompletionStatus(decision) !== "completed",
  );
  if (missingCompletedStatus.length > 0) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: `${kind}_decision_status_not_completed`,
        message:
          "Every AI decision retained as full-context proof must still declare decision_status=completed.",
        details: {
          report: repoRelativePath(reportArtifact.path),
          count: missingCompletedStatus.length,
        },
      }),
    );
  }
  const missingEvidence = decisionsArtifact.rows.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: `${kind}_decision_evidence_missing`,
        message:
          "Every AI decision retained as full-context proof must still include structured evidence.",
        details: {
          report: repoRelativePath(reportArtifact.path),
          count: missingEvidence.length,
        },
      }),
    );
  }
  if (contextBundleHashes.length > 0) {
    const mismatchedContext = decisionsArtifact.rows.filter((decision) => {
      const hash = decisionContextBundleSha256(decision);
      return !hash || !contextBundleHashes.includes(hash);
    });
    if (mismatchedContext.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_context_bundle_mismatch`,
          message:
            "Every AI decision retained as full-context proof must still reference the bound decision task context bundle.",
          details: {
            report: repoRelativePath(reportArtifact.path),
            count: mismatchedContext.length,
            expected_context_bundle_sha256_any_of: contextBundleHashes,
          },
        }),
      );
    }
  }
  const missingContextKinds = [];
  for (const decision of decisionsArtifact.rows) {
    const usedKinds = new Set(classificationDecisionUsedContextKinds(decision));
    for (const requiredKind of requirement?.required_context_kinds ?? []) {
      if (!usedKinds.has(requiredKind)) {
        missingContextKinds.push({ decision, requiredKind });
      }
    }
  }
  if (missingContextKinds.length > 0) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: `${kind}_decision_context_missing`,
        message:
          "Every AI decision retained as full-context proof must still list all required used_context_kinds.",
        details: {
          report: repoRelativePath(reportArtifact.path),
          count: missingContextKinds.length,
          required_context_kinds: requirement?.required_context_kinds ?? [],
        },
      }),
    );
  }
  return blockers;
}

function buildPatchApplyProofBlockers({
  mutationArtifact,
  requirement,
  prefix,
  codePrefix,
  expectedCount,
}) {
  if (expectedCount <= 0) return [];
  const blockers = [];
  const mutationManifest = mutationArtifact?.value ?? {};
  const evidence = mutationManifest.evidence ?? {};
  const patchCollectArtifact = readJsonArtifactOption(evidence.patch_collect_report);
  if (!patchCollectArtifact) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: "patch_collect_report_missing",
        message:
          "Mutation manifest full-context patch evidence references no readable patch collect report.",
        details: {
          mutation_manifest: repoRelativePath(mutationArtifact.path),
          report: evidence.patch_collect_report ?? null,
        },
      }),
    );
  } else if (patchCollectArtifact.value?.status !== "ready_for_patch_apply") {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: "patch_collect_not_ready",
        message: `Patch collect report status is ${patchCollectArtifact.value?.status ?? "missing"}.`,
        details: { report: repoRelativePath(patchCollectArtifact.path) },
      }),
    );
  }
  const authoringPackageProofs = [
    ...authoringPackageProofsFromPatchCollect(patchCollectArtifact),
    ...authoringPackageProofsFromCurationGate(mutationManifest),
  ];
  for (const proof of authoringPackageProofs) {
    for (const blocker of proof.blockers) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `patch_${blocker.code}`,
          message: blocker.message,
          details: blocker,
        }),
      );
    }
  }

  const patchApplyArtifact = readJsonArtifactOption(evidence.patch_apply_report);
  if (!patchApplyArtifact) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: "patch_apply_report_missing",
        message:
          "Mutation manifest full-context patch evidence references no readable patch apply report.",
        details: {
          mutation_manifest: repoRelativePath(mutationArtifact.path),
          report: evidence.patch_apply_report ?? null,
        },
      }),
    );
    return blockers;
  }
  if (patchApplyArtifact.value?.status !== "completed") {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: "patch_apply_not_completed",
        message: `Patch apply report status is ${patchApplyArtifact.value?.status ?? "missing"}.`,
        details: { report: repoRelativePath(patchApplyArtifact.path) },
      }),
    );
  }
  const patchEvidenceFile =
    evidence.patch_evidence_file ?? patchApplyArtifact.value?.files?.patch_evidence;
  const patchEvidenceArtifact = readJsonOrJsonlRowsArtifact(patchEvidenceFile);
  if (patchEvidenceArtifact.error) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: "patch_evidence_file_unreadable",
        message:
          "Patch apply report must retain readable AI patch evidence rows for closeout proof.",
        details: {
          report: repoRelativePath(patchApplyArtifact.path),
          patch_evidence_file: patchEvidenceFile ?? null,
          error: patchEvidenceArtifact.error,
        },
      }),
    );
  } else if (patchEvidenceArtifact.rows.length < expectedCount) {
    blockers.push(
      fullContextEvidenceArtifactBlocker({
        prefix,
        codePrefix,
        suffix: "patch_evidence_count_incomplete",
        message:
          "Patch evidence rows are fewer than the mutation manifest AI patch evidence count.",
        details: {
          report: repoRelativePath(patchApplyArtifact.path),
          patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
          expected_patch_evidence_entries: expectedCount,
          actual_patch_evidence_entries: patchEvidenceArtifact.rows.length,
        },
      }),
    );
  }
  if (!patchEvidenceArtifact.error) {
    const patchEvidenceRows = patchEvidenceArtifact.rows;
    const missingPackageHash = patchEvidenceRows.filter(
      (entry) => !asText(entry?.authoring_package_sha256),
    );
    if (missingPackageHash.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_package_hash_missing",
          message:
            "Every retained AI patch evidence row must still include authoring_package_sha256.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
            count: missingPackageHash.length,
          },
        }),
      );
    }
    const knownPackageHashes = new Set(
      authoringPackageProofs.map((proof) => asText(proof.sha256)).filter(Boolean),
    );
    const unknownPackageHash = patchEvidenceRows.filter((entry) => {
      const hash = asText(entry?.authoring_package_sha256);
      return hash && !knownPackageHashes.has(hash);
    });
    if (unknownPackageHash.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_package_hash_unknown",
          message:
            "Every retained AI patch evidence authoring_package_sha256 must match a readable full-context authoring package from patch collect or curation gate evidence.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
            count: unknownPackageHash.length,
          },
        }),
      );
    }
    const missingClosures = patchEvidenceRows.filter(
      (entry) => ensureArray(entry?.closes_action_items).length === 0,
    );
    if (missingClosures.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_action_closure_missing",
          message:
            "Every retained AI patch evidence row must still close at least one authoring action item.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
            count: missingClosures.length,
          },
        }),
      );
    }
    const missingEvidence = patchEvidenceRows.filter(
      (entry) => !entry?.evidence || typeof entry.evidence !== "object",
    );
    if (missingEvidence.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_evidence_missing",
          message:
            "Every retained AI patch evidence row must still include structured evidence.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
            count: missingEvidence.length,
          },
        }),
      );
    }
    const missingResolution = patchEvidenceRows.filter(
      (entry) => !patchEvidenceResolutionMode(entry),
    );
    if (missingResolution.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_resolution_missing",
          message:
            "Every retained AI patch evidence row must still include resolution.mode.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
            count: missingResolution.length,
          },
        }),
      );
    }
    const invalidResolutionMode = patchEvidenceRows.filter((entry) => {
      const mode = patchEvidenceResolutionMode(entry);
      return mode && !fullContextPatchResolutionModes.has(mode);
    });
    if (invalidResolutionMode.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_resolution_mode_invalid",
          message:
            "Retained AI patch evidence contains unsupported resolution.mode values.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
            count: invalidResolutionMode.length,
          },
        }),
      );
    }
    const missingContextKinds = [];
    for (const entry of patchEvidenceRows) {
      const usedKinds = new Set(patchEvidenceResolutionContextKinds(entry));
      for (const requiredKind of requirement?.required_context_kinds ?? []) {
        if (!usedKinds.has(requiredKind)) {
          missingContextKinds.push({ entry, requiredKind });
        }
      }
    }
    if (missingContextKinds.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_resolution_context_missing",
          message:
            "Retained AI patch evidence resolution.used_context_kinds must still include every required full-context kind.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
            count: missingContextKinds.length,
            required_context_kinds: requirement?.required_context_kinds ?? [],
          },
        }),
      );
    }
  }
  return blockers;
}

function fullContextEvidenceArtifactBlockers({
  mutationArtifact,
  requirement,
  prefix,
  codePrefix,
}) {
  const mutationManifest = mutationArtifact?.value ?? null;
  if (!mutationManifest?.evidence?.full_context_ai_completion_required) {
    return [];
  }
  const counts = mutationManifest.counts ?? {};
  return [
    ...buildPatchApplyProofBlockers({
      mutationArtifact,
      requirement,
      prefix,
      codePrefix,
      expectedCount: fullContextCount(counts, "ai_patch_evidence_entries"),
    }),
    ...buildDecisionApplyProofBlockers({
      mutationArtifact,
      requirement,
      prefix,
      codePrefix,
      kind: "classification",
      expectedCount: fullContextCount(
        counts,
        "ai_classification_decision_entries",
      ),
    }),
	    ...buildDecisionApplyProofBlockers({
	      mutationArtifact,
	      requirement,
	      prefix,
	      codePrefix,
	      kind: "location",
	      expectedCount: fullContextCount(counts, "ai_location_decision_entries"),
	    }),
    ...buildDecisionApplyProofBlockers({
      mutationArtifact,
      requirement,
      prefix,
      codePrefix,
      kind: "identity",
      expectedCount: fullContextCount(counts, "ai_identity_decision_entries"),
    }),
	  ];
	}

function fullContextProofCheck({
  prefix = {},
  profileId,
  datasetType,
  closeoutCounts = null,
  mutationArtifact = null,
  codePrefix = "completion",
}) {
  const mutationManifest = mutationArtifact?.value ?? null;
  const profileRequirement = profileId
    ? profileFullContextRequirement(profileId, datasetType)
    : null;
  const mutationMarkedRequired =
    mutationManifest?.evidence?.full_context_ai_completion_required === true;
  if (!profileRequirement && !mutationMarkedRequired) {
    return { required: false, blockers: [] };
  }

  const blockerPrefix = {
    ...prefix,
    profile: profileRequirement?.profile_id ?? (asText(profileId) || null),
    dataset_type:
      profileRequirement?.dataset_type ??
      (asText(datasetType).toLowerCase() || null),
  };
  const semanticEvidenceCount = (counts) =>
    (Number(counts?.ai_patch_evidence_entries ?? 0) || 0) +
    (Number(counts?.ai_classification_decision_entries ?? 0) || 0) +
    (Number(counts?.ai_location_decision_entries ?? 0) || 0) +
    (Number(counts?.ai_identity_decision_entries ?? 0) || 0);
  const blockers = [];
  if (closeoutCounts) {
    if (closeoutCounts.full_context_ai_completion_required !== true) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_scope_missing`,
        message:
          "This committed scope belongs to a profile or manifest that requires full schema/YAML/context AI completion, but the closeout does not mark the scope as full-context completed.",
      });
    }
    if (semanticEvidenceCount(closeoutCounts) <= 0) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_semantic_evidence_missing`,
        message:
          "Full-context AI completion requires at least one AI patch evidence, AI identity decision, AI classification decision, or AI location decision entry.",
      });
    }
  }

  if (!mutationArtifact) {
    blockers.push({
      ...blockerPrefix,
      code: `${codePrefix}_full_context_mutation_manifest_missing`,
      message: "Full-context completion requires a readable mutation manifest.",
    });
    return { required: true, blockers };
  }
  if (
    mutationManifest?.evidence?.full_context_ai_completion_required !== true
  ) {
    blockers.push({
      ...blockerPrefix,
      code: `${codePrefix}_full_context_mutation_requirement_missing`,
      message:
        "Mutation manifest does not prove that full-context AI completion was required.",
      mutation_manifest: repoRelativePath(mutationArtifact.path),
    });
  }
  if (!mutationManifest?.evidence?.full_context_ai_completion_proof) {
    blockers.push({
      ...blockerPrefix,
      code: `${codePrefix}_full_context_mutation_proof_missing`,
      message:
        "Mutation manifest does not carry the full-context AI completion proof snapshot.",
      mutation_manifest: repoRelativePath(mutationArtifact.path),
    });
  }
  if (semanticEvidenceCount(mutationManifest?.counts ?? {}) <= 0) {
    blockers.push({
      ...blockerPrefix,
      code: `${codePrefix}_full_context_mutation_semantic_evidence_missing`,
      message:
        "Mutation manifest has no AI patch evidence, AI identity decision, AI classification decision, or AI location decision entries for the full-context scope.",
      mutation_manifest: repoRelativePath(mutationArtifact.path),
    });
  }
  blockers.push(
    ...fullContextEvidenceArtifactBlockers({
      mutationArtifact,
      requirement: profileRequirement,
      prefix: blockerPrefix,
      codePrefix,
    }),
  );

  return { required: true, blockers };
}

function completionFullContextBlockers({ task, completionReport }) {
  const blockers = [];
  const closeouts = ensureArray(completionReport?.closeouts).filter(
    (closeout) =>
      closeout && typeof closeout === "object" && !Array.isArray(closeout),
  );
  const taskProfile = taskProfileId(task);
  const taskType = taskDatasetType(task);
  const taskRequirement = taskProfile
    ? profileFullContextRequirement(taskProfile, taskType)
    : null;
  let requiredCloseoutCount = 0;

  if (taskRequirement && closeouts.length === 0) {
    blockers.push({
      code: "completion_full_context_closeout_missing",
      message:
        "Task profile requires full schema/YAML/context AI completion, but the completion report has no closeout scope.",
      profile: taskRequirement.profile_id,
      dataset_type: taskRequirement.dataset_type,
    });
  }

  closeouts.forEach((closeout, index) => {
    const profileId = asText(closeout.profile) || taskProfile;
    const datasetType = asText(closeout.dataset_type) || taskType;
    const mutationArtifact = readJsonArtifactOption(closeout.mutation_manifest);
    const fullContextCheck = fullContextProofCheck({
      prefix: {
        closeout_index: index,
        closeout_report: closeout.closeout_report ?? null,
      },
      profileId,
      datasetType,
      closeoutCounts: closeout.counts ?? {},
      mutationArtifact,
      codePrefix: "completion",
    });
    if (!fullContextCheck.required) return;
    requiredCloseoutCount += 1;
    blockers.push(
      ...fullContextCheck.blockers.map((blocker) => ({
        ...blocker,
        closeout_index: index,
        closeout_report: closeout.closeout_report ?? null,
      })),
    );
  });

  const reportFullContextScopes = Number(
    completionReport?.counts?.full_context_scopes ?? 0,
  );
  if (
    requiredCloseoutCount > 0 &&
    reportFullContextScopes < requiredCloseoutCount
  ) {
    blockers.push({
      code: "completion_full_context_scope_count_incomplete",
      message:
        "Completion report full_context_scopes does not cover every profile-required full-context closeout scope.",
      expected_minimum: requiredCloseoutCount,
      actual: Number.isFinite(reportFullContextScopes)
        ? reportFullContextScopes
        : 0,
    });
  }

  return blockers;
}

function isPlaceholderEnvValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized === "" || normalized === "REPLACE_ME";
}

function loadEnvFile(filePath, { override = false } = {}) {
  if (!filePath || !fs.existsSync(filePath))
    return { file: filePath, loaded: false, keys: [] };
  const keys = [];
  for (const rawLine of readText(filePath).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line
      .replace(/^export\s+/u, "")
      .match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    const key = match[1];
    const value = String(match[2] ?? "")
      .trim()
      .replace(/^["']|["']$/gu, "");
    if (
      override ||
      process.env[key] === undefined ||
      isPlaceholderEnvValue(process.env[key])
    ) {
      process.env[key] = value;
    }
    keys.push(key);
  }
  return { file: filePath, loaded: true, keys };
}

function loadRuntimeEnv() {
  const repoEnv = loadEnvFile(path.join(repoRoot, ".env"));
  return { repoEnv };
}

function hasUsableEnvValue(key) {
  return (
    process.env[key] !== undefined && !isPlaceholderEnvValue(process.env[key])
  );
}

function envExampleKeyAllowed(key) {
  return (
    envExampleAllowedKeys.has(key) ||
    envExampleAllowedPrefixes.some((prefix) => key.startsWith(prefix))
  );
}

function parseEnvAssignments(filePath) {
  if (!fileExists(filePath)) return [];
  return readText(filePath)
    .split(/\r?\n/u)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(({ raw }) => raw && !raw.startsWith("#"))
    .map(({ raw, line }) => ({
      line,
      match: raw
        .replace(/^export\s+/u, "")
        .match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u),
    }))
    .filter(({ match }) => match)
    .map(({ line, match }) => ({ line, key: match[1], value: match[2] ?? "" }));
}

function envExampleSurfaceCheck() {
  const envExamplePath = path.join(repoRoot, ".env.example");
  const errors = [];
  const warnings = [];
  const seen = new Map();
  if (!fileExists(envExamplePath)) {
    errors.push(".env.example is missing.");
  }
  for (const row of parseEnvAssignments(envExamplePath)) {
    if (seen.has(row.key)) {
      errors.push(
        `.env.example:${row.line}: duplicate variable ${row.key}; first declared on line ${seen.get(row.key)}.`,
      );
    }
    seen.set(row.key, row.line);
    if (envExampleForbiddenKeys.has(row.key)) {
      errors.push(
        `.env.example:${row.line}: ${row.key} is forbidden. ${envExampleForbiddenKeys.get(row.key)}`,
      );
    } else if (!envExampleKeyAllowed(row.key)) {
      errors.push(
        `.env.example:${row.line}: ${row.key} is not in the Foundry env surface allowlist.`,
      );
    }
    const secretLike = /(?:API_KEY|APIKEY|TOKEN|PASSWORD|SECRET|JWT)$/u.test(row.key);
    const allowedPublicKey =
      row.key === "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY";
    if (secretLike && !allowedPublicKey && !isPlaceholderEnvValue(row.value)) {
      errors.push(
        `.env.example:${row.line}: ${row.key} looks secret-bearing and must not contain an example value.`,
      );
    }
  }
  return {
    file: ".env.example",
    variable_count: parseEnvAssignments(envExamplePath).length,
    allowed_prefixes: envExampleAllowedPrefixes,
    forbidden_keys: [...envExampleForbiddenKeys.keys()],
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function initRuntime() {
  for (const dir of runtimeDirs)
    fs.mkdirSync(path.join(repoRoot, dir), { recursive: true });
  return { repo_root: repoRoot, created_or_verified: runtimeDirs };
}

function workflowCheck() {
  const text = readText(workflowPath);
  const { frontmatter, body } = splitFrontmatter(text);
  const missing = ["tracker:", "workspace:", "policy:"].filter(
    (fragment) => !frontmatter.includes(fragment),
  );
  return {
    workflow: "WORKFLOW.md",
    has_frontmatter: Boolean(frontmatter),
    has_prompt_body: body.trim().length > 0,
    missing_required_fragments: missing,
    ok: missing.length === 0 && body.trim().length > 0,
  };
}

function storageCheck() {
  const registryPath = path.join(repoRoot, "docs/file-location-registry.json");
  const allowedRootMarkdown = new Set([
    "AGENTS.md",
    "README.md",
    "WORKFLOW.md",
  ]);
  const errors = [];
  const warnings = [];
  const registry = fileExists(registryPath) ? readJson(registryPath) : null;
  if (!registry)
    errors.push("docs/file-location-registry.json is missing or invalid.");
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry?.id) {
      errors.push("file-location registry entry is missing id");
      continue;
    }
    if (ids.has(entry.id))
      errors.push(`duplicate file-location registry id: ${entry.id}`);
    ids.add(entry.id);
    if (
      entry.status !== "retired" &&
      !fileExists(resolveRepoPath(entry.current_path))
    ) {
      errors.push(
        `${entry.id}: current_path does not exist: ${entry.current_path}`,
      );
    }
    for (const ref of entry.referenced_by ?? []) {
      if (!fileExists(resolveRepoPath(ref)))
        warnings.push(`${entry.id}: referenced_by path does not exist: ${ref}`);
    }
  }
  for (const name of fs.readdirSync(repoRoot).sort()) {
    if (name.endsWith(".md") && !allowedRootMarkdown.has(name)) {
      errors.push(`root markdown file is not an allowed entrypoint: ${name}`);
    }
  }
  return {
    registry: "docs/file-location-registry.json",
    entry_count: entries.length,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function acceptanceCheck() {
  const workflow = workflowCheck();
  const storage = storageCheck();
  const envSurface = envExampleSurfaceCheck();
  const checks = [
    { name: "workflow", ok: workflow.ok, report: workflow },
    { name: "storage", ok: storage.ok, report: storage },
    { name: "env_example_surface", ok: envSurface.ok, report: envSurface },
  ];
  const result = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status: checks.every((check) => check.ok) ? "passed" : "failed",
    checks,
  };
  writeJson(
    path.join(repoRoot, ".foundry/state/acceptance/latest.json"),
    result,
  );
  return result;
}

function doctor() {
  return {
    repo_root: repoRoot,
    node: process.version,
    workflow_check: workflowCheck(),
    storage_check: storageCheck(),
    env_example_surface: envExampleSurfaceCheck(),
    runtime_dirs: Object.fromEntries(
      runtimeDirs.map((dir) => [dir, fs.existsSync(path.join(repoRoot, dir))]),
    ),
    import_profiles: listImportProfiles({ repoRoot }),
  };
}

function envCheck() {
  const requiredForRemoteWrites = [
    "TIANGONG_LCA_API_BASE_URL",
    "TIANGONG_LCA_API_KEY",
    "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY",
  ];
  return {
    generated_at_utc: nowIso(),
    repo_env_exists: fileExists(path.join(repoRoot, ".env")),
    env_example_surface: envExampleSurfaceCheck(),
    dry_run_allowed: true,
    remote_write_policy: {
      enabled: process.env.FOUNDRY_ENABLE_REMOTE_COMMIT === "true",
      single_record: process.env.FOUNDRY_SINGLE_RECORD_COMMIT === "true",
      limit: Number(process.env.FOUNDRY_REMOTE_COMMIT_LIMIT ?? 1),
    },
    required_remote_env: Object.fromEntries(
      requiredForRemoteWrites.map((key) => [key, hasUsableEnvValue(key)]),
    ),
  };
}

function workspaceRoot() {
  const configured = process.env.FOUNDRY_LCA_WORKSPACE_ROOT;
  if (configured) return configured;
  const parent = path.dirname(repoRoot);
  return fs.existsSync(path.join(parent, ".gitmodules")) ? parent : repoRoot;
}

function workspaceMap() {
  const root = workspaceRoot();
  const candidates = {
    cli: path.join(root, "tiangong-lca-cli"),
    skills: path.join(root, "tiangong-lca-skills"),
    "tidas-sdk": path.join(root, "tidas-sdk"),
    "tidas-tools": path.join(root, "tidas-tools"),
    foundry: repoRoot,
  };
  return {
    generated_at_utc: nowIso(),
    repo_root: repoRoot,
    workspace_root: root,
    projects: Object.fromEntries(
      Object.entries(candidates).map(([name, projectPath]) => [
        name,
        {
          path: projectPath,
          exists: fs.existsSync(projectPath),
        },
      ]),
    ),
    import_lanes: [
      "external-dataset-curated-import",
      "source-evidence-dataset-development",
    ],
  };
}

function readCapabilityRegistry() {
  return readJson(path.join(repoRoot, capabilityRegistryPath));
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizedList(value) {
  return ensureArray(value)
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function appendOption(args, flag, value) {
  if (value === undefined || value === null || value === false || value === "")
    return;
  args.push(flag, String(value));
}

function appendRepeatedOptions(args, flag, values) {
  for (const value of normalizedList(values)) {
    appendOption(args, flag, value);
  }
}

function booleanOption(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function integerOption(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function positiveIntegerOption(value, fallback = null) {
  const number = integerOption(value, fallback);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replace(/'/gu, `'\\''`)}'`;
}

function compactStageReport(stage) {
  return {
    stage: stage.stage,
    status: stage.report?.status ?? stage.status ?? null,
    exit_code: stage.exit_code,
    command: stage.command,
    args: stage.args,
    stderr: stage.stderr,
    report_file: stage.report_file ? repoRelativePath(stage.report_file) : null,
  };
}

function reportFileFromCliStage(stage, selectors, fallbackPath) {
  for (const selector of selectors) {
    const parts = selector.split(".");
    let value = stage.report;
    for (const part of parts) {
      value = value?.[part];
    }
    const resolved = resolveRepoPath(value);
    if (fileExists(resolved)) {
      return resolved;
    }
  }
  const fallback = resolveRepoPath(fallbackPath);
  return fileExists(fallback) ? fallback : null;
}

function blockersFromLocationAuditStage(stage) {
  const reportBlockers = ensureArray(stage?.report?.blockers);
  const blockers = reportBlockers.map((blocker) => ({
    ...blocker,
    code: blocker?.code || "location_audit_blocker",
    stage: "location_audit",
    message:
      blocker?.message ||
      "Location audit reported a blocker before remote write.",
  }));
  if (stage?.exit_code !== 0 && blockers.length === 0) {
    blockers.push({
      code: "location_audit_failed",
      stage: "location_audit",
      message:
        "Location audit stage failed before remote write; inspect the stage stderr/report.",
      stderr: stage?.stderr || "",
    });
  }
  return blockers;
}

function stageExitBlocker(stage, { code, message }) {
  return stage?.exit_code === 0
    ? null
    : {
        code,
        stage: stage?.stage ?? null,
        message,
        exit_code: stage?.exit_code ?? null,
        report_file: repoRelativeMaybe(stage?.report_file),
      };
}

function postAuthoringPrewriteGateBlockers({
  schemaStage,
  qaStage,
  locationAuditBlockers,
  curationGate,
  curationGateReportFile,
  requireDeterministicQa = true,
  requireCurationGate = true,
}) {
  return [
    stageExitBlocker(schemaStage, {
      code: "schema_validate_not_ready",
      message:
        "Schema validation must complete before post-authoring dry-run or remote write planning.",
    }),
    requireDeterministicQa
      ? stageExitBlocker(qaStage, {
          code: "deterministic_qa_not_ready",
          message:
            "Deterministic QA must complete before post-authoring dry-run or remote write planning.",
        })
      : null,
    ...locationAuditBlockers,
    !requireCurationGate ||
    ["ready", "ready_with_profile_waivers"].includes(curationGate?.status)
      ? null
      : {
          code: "post_authoring_curation_gate_not_ready",
          stage: "post_authoring_curation_gate",
          message:
            "Post-authoring curation gate must be ready before dry-run or remote write planning.",
          status: curationGate?.status ?? null,
          report_file: repoRelativeMaybe(curationGateReportFile),
        },
  ].filter(Boolean);
}

function skippedPrewriteStage(stage, reason) {
  return {
    stage,
    status: "skipped",
    exit_code: 1,
    command: "skipped",
    args: [],
    stderr: reason,
    report: {
      status: "skipped",
      reason,
    },
    report_file: null,
  };
}

function readJsonArtifactOption(value) {
  const resolved = resolveRepoPath(value);
  return resolved && fileExists(resolved)
    ? { path: resolved, value: readJson(resolved) }
    : null;
}

function runTiangongJsonStage(stage, args) {
  const cliBin = resolveTiangongLcaCliBin();
  const result = spawnSync(cliBin, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  const exitCode = typeof result.status === "number" ? result.status : 1;
  if (result.error) {
    throw result.error;
  }
  let report = null;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error(
      [
        `tiangong-lca stage ${stage} did not emit JSON.`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return {
    stage,
    command: cliBin,
    args,
    exit_code: exitCode,
    stderr: result.stderr || "",
    report,
    report_file: null,
  };
}

function runDatasetCurationQueueBuild(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-curation-queue-build",
      wraps: "tiangong-lca dataset curation-queue build",
      usage: [
        "tiangong-lca dataset curation-queue build --processes <processes.jsonl> --out-dir <queue-dir>",
        "node scripts/foundry.mjs dataset-curation-queue-build --processes ./rows/processes.jsonl --flows ./rows/flows.jsonl --support ./rows/sources.jsonl --out-dir ./curation-queue",
      ],
      foundry_wrapper: {
        exit_code: 0,
        owner: "tiangong-lca-cli",
      },
    };
  }
  const processes =
    options.processes || options.processesFile || options.processRows;
  const outDir = options.outDir || ".foundry/workspaces/dataset-curation-queue";
  const cliArgs = ["dataset", "curation-queue", "build", "--json"];
  appendOption(cliArgs, "--processes", processes);
  appendOption(
    cliArgs,
    "--flows",
    options.flows || options.flowsFile || options.flowRows,
  );
  appendRepeatedOptions(
    cliArgs,
    "--support",
    options.support || options.supportFile || options.supportRows,
  );
  appendRepeatedOptions(
    cliArgs,
    "--external-flow-ref",
    options.externalFlowRef || options.externalFlowRefs,
  );
  appendRepeatedOptions(
    cliArgs,
    "--exclude-process-id",
    options.excludeProcessId || options.excludeProcessIds,
  );
  appendOption(cliArgs, "--process-limit", options.processLimit);
  appendOption(cliArgs, "--out-dir", outDir);

  const cliBin = resolveTiangongLcaCliBin();
  const result = spawnSync(cliBin, cliArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  const exitCode = typeof result.status === "number" ? result.status : 1;
  let report;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error(
      [
        "tiangong-lca dataset curation-queue build did not emit JSON.",
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (result.error) {
    throw result.error;
  }
  return {
    ...report,
    foundry_wrapper: {
      command: cliBin,
      args: cliArgs,
      exit_code: exitCode,
      stderr: result.stderr || "",
      owner: "tiangong-lca-cli",
    },
  };
}

function runDatasetPatchApply(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-patch-apply",
      wraps: "tiangong-lca dataset patch apply",
      usage: [
        "node scripts/foundry.mjs dataset-patch-apply --input <rows.jsonl> --patch <ai-patches.json> --out <patched.jsonl> --out-dir <apply-dir>",
        "node scripts/foundry.mjs dataset-patch-apply --input ./rows/processes.jsonl --patch ./curation/patches.json --out ./rows/processes.patched.jsonl --out-dir ./patch-apply --authoring-package-dir ./curation-gate/ai-authoring-packages --require-action-item-closure",
      ],
      foundry_wrapper: {
        exit_code: 0,
        owner: "tiangong-lca-cli",
        stage: "post_ai_authoring_deterministic_apply",
      },
    };
  }

  const input = options.input || options.rowsFile || options.rows;
  const patch =
    options.patch ||
    options.patchFile ||
    options.patches ||
    options.suggestions;
  const outDir = options.outDir || ".foundry/workspaces/dataset-patch-apply";
  const out =
    options.out || options.outFile || path.join(outDir, "patched-rows.jsonl");
  const cliArgs = ["dataset", "patch", "apply", "--json"];
  appendOption(cliArgs, "--input", input);
  appendOption(cliArgs, "--patch", patch);
  appendOption(cliArgs, "--out", out);
  appendOption(cliArgs, "--out-dir", outDir);
  appendOption(
    cliArgs,
    "--authoring-package-dir",
    options.authoringPackageDir || options.authoringPackagesDir,
  );
  if (
    options.requireAuthoringPackage === true ||
    options.requireAuthoringPackage === "true"
  ) {
    cliArgs.push("--require-authoring-package");
  }
  if (
    options.requireActionItemClosure === true ||
    options.requireActionItemClosure === "true"
  ) {
    cliArgs.push("--require-action-item-closure");
  }

  const cliBin = resolveTiangongLcaCliBin();
  const result = spawnSync(cliBin, cliArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  const exitCode = typeof result.status === "number" ? result.status : 1;
  if (result.error) {
    throw result.error;
  }
  let report;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error(
      [
        "tiangong-lca dataset patch apply did not emit JSON.",
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return {
    ...report,
    foundry_wrapper: {
      command: cliBin,
      args: cliArgs,
      exit_code: exitCode,
      stderr: result.stderr || "",
      owner: "tiangong-lca-cli",
      stage: "post_ai_authoring_deterministic_apply",
      remote_write_mode: "read-only",
    },
  };
}

function readJsonOrJsonLines(filePath) {
  const resolved = resolveRepoPath(filePath);
  if (!resolved || !fileExists(resolved)) return [];
  if (resolved.toLowerCase().endsWith(".jsonl")) return readJsonLines(resolved);
  const value = readJson(resolved);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.decisions)) return value.decisions;
  if (Array.isArray(value?.rows)) return value.rows;
  return value && typeof value === "object" ? [value] : [];
}

function hasUnresolvedAiPlaceholder(value) {
  return /__AI_(?:FILL|SELECT)[A-Z0-9_]*__|requires_ai_completion/iu.test(
    JSON.stringify(value),
  );
}

function classificationQueueSchemaType(row) {
  return asText(
    row?.classification_workflow?.schema_type ??
      row?.schema_type ??
      row?.category_type ??
      row?.type,
  );
}

function classificationQueueRowType(row) {
  return asText(row?.classification_workflow?.row_type ?? row?.dataset_type);
}

function classificationQueueInputRows(row) {
  return asText(row?.classification_workflow?.commands?.input_rows);
}

function classificationQueueOutputRows(row) {
  return asText(row?.classification_workflow?.commands?.output_rows);
}

function queueRowSourceFile(row) {
  return asText(row?.source_file ?? row?.sourceFile);
}

function queueRowBundleId(row) {
  const match = queueRowSourceFile(row).match(
    /(?:^|\/)process-bundles\/([^/]+)\//u,
  );
  return match?.[1] ?? "";
}

function hasQueueSelectionOptions(options) {
  return Boolean(
    normalizedList(options.datasetId || options.datasetIds || options.id)
      .length ||
      normalizedList(options.datasetType || options.datasetTypes).length ||
      normalizedList(
        options.categoryType ||
          options.categoryTypes ||
          options.schemaType ||
          options.schemaTypes,
      ).length ||
      normalizedList(options.bundleId || options.bundleIds || options.processId)
        .length ||
      integerOption(options.offset, null) !== null ||
      positiveIntegerOption(options.limit || options.count, null) !== null,
  );
}

function queueSelectionSummary(options) {
  return {
    dataset_ids: normalizedList(
      options.datasetId || options.datasetIds || options.id,
    ),
    dataset_types: normalizedList(options.datasetType || options.datasetTypes),
    category_types: normalizedList(
      options.categoryType ||
        options.categoryTypes ||
        options.schemaType ||
        options.schemaTypes,
    ),
    bundle_ids: normalizedList(
      options.bundleId || options.bundleIds || options.processId,
    ),
    offset: Math.max(0, integerOption(options.offset, 0) ?? 0),
    limit: positiveIntegerOption(options.limit || options.count, null),
  };
}

function queueRowMatchesSelection(row, selection, schemaTypeForRow) {
  const datasetId = asText(row?.dataset_id);
  const datasetType = asText(row?.dataset_type);
  const categoryType = schemaTypeForRow(row);
  const bundleId = queueRowBundleId(row);
  if (
    selection.dataset_ids.length > 0 &&
    !selection.dataset_ids.includes(datasetId)
  ) {
    return false;
  }
  if (
    selection.dataset_types.length > 0 &&
    !selection.dataset_types.includes(datasetType)
  ) {
    return false;
  }
  if (
    selection.category_types.length > 0 &&
    !selection.category_types.includes(categoryType)
  ) {
    return false;
  }
  if (
    selection.bundle_ids.length > 0 &&
    !selection.bundle_ids.includes(bundleId)
  ) {
    return false;
  }
  return true;
}

function selectDecisionTaskQueueRows(queueRows, options, schemaTypeForRow) {
  const selection = queueSelectionSummary(options);
  const filtered = queueRows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .filter(({ row }) => queueRowMatchesSelection(row, selection, schemaTypeForRow));
  const start = selection.offset;
  const end = selection.limit ? start + selection.limit : undefined;
  const selected = filtered.slice(start, end);
  return {
    selection: {
      ...selection,
      source_queue_rows: queueRows.length,
      matched_queue_rows: filtered.length,
      selected_queue_rows: selected.length,
      source_queue_row_indices: selected.map((item) => item.sourceIndex),
    },
    selected,
  };
}

function safeFileToken(value, fallback) {
  const token = asText(value)
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return token || fallback;
}

function decisionTaskChunkLabel(options, selection, fallback) {
  if (options.chunkLabel || options.chunk || options.label) {
    return safeFileToken(options.chunkLabel || options.chunk || options.label, fallback);
  }
  if (selection.bundle_ids.length === 1) {
    return safeFileToken(`bundle-${selection.bundle_ids[0]}`, fallback);
  }
  if (selection.dataset_types.length === 1 && selection.category_types.length === 1) {
    return safeFileToken(
      `${selection.dataset_types[0]}-${selection.category_types[0]}`,
      fallback,
    );
  }
  if (selection.dataset_types.length === 1) {
    return safeFileToken(selection.dataset_types[0], fallback);
  }
  return safeFileToken(
    `offset-${selection.offset}-limit-${selection.limit ?? "all"}`,
    fallback,
  );
}

function rewriteDecisionTaskQueueRowsForChunk({
  selected,
  sourceQueuePath,
  outDir,
  chunkLabel,
  workflowKey,
  outputSuffix,
  inputRowsForRow,
  inputRowsOverride = null,
}) {
  const outputByInput = new Map();
  return selected.map(({ row, sourceIndex }) => {
    const next = cloneJson(row);
    const inputRows = inputRowsOverride || resolveRepoPath(inputRowsForRow(next));
    const inputBase = inputRows
      ? path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "")
      : `rows-${sourceIndex}`;
    if (!outputByInput.has(inputBase)) {
      outputByInput.set(
        inputBase,
        path.join(outDir, "rows", `${inputBase}.${chunkLabel}.${outputSuffix}.jsonl`),
      );
    }
    next.foundry_selection = {
      source_queue: repoRelativePath(sourceQueuePath),
      source_queue_row_index: sourceIndex,
      bundle_id: queueRowBundleId(row) || null,
    };
    next[workflowKey] ??= {};
    next[workflowKey].commands ??= {};
    if (inputRowsOverride) {
      next[workflowKey].commands.input_rows = repoRelativePath(inputRowsOverride);
    }
    next[workflowKey].commands.output_rows = repoRelativePath(
      outputByInput.get(inputBase),
    );
    return next;
  });
}

function decisionTaskInputRowsOverride(options) {
  const optionValue =
    options.rowsFile ||
    options.inputRows ||
    options.inputRowsFile ||
    options.currentRows ||
    options.currentRowsFile;
  if (!optionValue) return null;
  const resolved = resolveRepoPath(optionValue);
  if (!resolved || !fileExists(resolved)) {
    throw new Error(
      "--rows-file/--input-rows must point to a readable current rows JSON/JSONL file.",
    );
  }
  return resolved;
}

function classificationDecisionSchemaType(decision) {
  return asText(
    decision?.category_type ??
      decision?.categoryType ??
      decision?.classification_type ??
      decision?.classificationType ??
      decision?.type,
  );
}

function classificationDecisionTargetKey(decision, schemaType = "") {
  const datasetId = asText(
    decision?.dataset_id ?? decision?.datasetId ?? decision?.id ?? decision?.uuid,
  );
  const version = asText(
    decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version,
  );
  const type = classificationDecisionSchemaType(decision) || schemaType;
  return `${type}::${datasetId}::${version}`;
}

function classificationQueueTargetKey(row) {
  return `${classificationQueueSchemaType(row)}::${asText(
    row?.dataset_id,
  )}::${asText(row?.dataset_version)}`;
}

function classificationDecisionCode(decision) {
  return asText(
    decision?.code ??
      decision?.class_id ??
      decision?.classId ??
      decision?.cat_id ??
      decision?.catId ??
      decision?.leaf_code ??
      decision?.leafCode,
  );
}

function classificationDecisionUsedContextKinds(decision) {
  return unique([
    ...normalizedList(decision?.used_context_kinds ?? decision?.usedContextKinds),
    ...normalizedList(
      decision?.evidence?.used_context_kinds ??
        decision?.evidence?.usedContextKinds,
    ),
    ...normalizedList(
      decision?.resolution?.used_context_kinds ??
        decision?.resolution?.usedContextKinds,
    ),
  ]);
}

function classificationTaskQueueKey(row) {
  return [
    asText(row?.dataset_id),
    asText(row?.dataset_version),
    asText(row?.dataset_type),
    classificationQueueSchemaType(row),
  ].join("::");
}

function classificationTaskRowTypeForQueueRow(row) {
  const schemaType = classificationQueueSchemaType(row);
  if (schemaType === "flow-product" || schemaType === "flow-elementary") {
    return "flow";
  }
  return classificationQueueRowType(row) || asText(row?.dataset_type);
}

function classificationTaskInputRowIdentity(row, queueRow, index) {
  const rowType = classificationTaskRowTypeForQueueRow(queueRow);
  const identity = datasetIdentity(row, rowType);
  return {
    index,
    row_type: rowType,
    dataset_id: identity.id,
    dataset_version: identity.version,
  };
}

function buildClassificationTaskInputRowLookup(queueRows) {
  const byInput = new Map();
  for (const queueRow of queueRows) {
    const inputRows = classificationQueueInputRows(queueRow);
    if (!inputRows) continue;
    const resolved = resolveRepoPath(inputRows);
    if (!resolved || !fileExists(resolved)) continue;
    if (!byInput.has(resolved)) {
      byInput.set(resolved, readJsonOrJsonLines(resolved));
    }
  }
  const lookup = new Map();
  for (const [inputFile, rows] of byInput.entries()) {
    for (const queueRow of queueRows) {
      if (resolveRepoPath(classificationQueueInputRows(queueRow)) !== inputFile) {
        continue;
      }
      for (const [index, row] of rows.entries()) {
        const identity = classificationTaskInputRowIdentity(
          row,
          queueRow,
          index,
        );
        if (
          identity.dataset_id === asText(queueRow.dataset_id) &&
          identity.dataset_version === asText(queueRow.dataset_version)
        ) {
          lookup.set(classificationTaskQueueKey(queueRow), {
            ...identity,
            input_rows: repoRelativePath(inputFile),
            payload: row,
          });
          break;
        }
      }
    }
  }
  return lookup;
}

function readClassificationTaskJsonlContextRows(baseDir, fileName, maxRows = 2000) {
  const filePath = path.join(baseDir, fileName);
  if (!fileExists(filePath)) return { file: null, rows: [] };
  const rows = readJsonLines(filePath);
  return {
    file: repoRelativePath(filePath),
    rows: rows.slice(0, maxRows),
    truncated: rows.length > maxRows,
    total_rows: rows.length,
  };
}

function buildClassificationTaskProvenanceContext(queuePath) {
  const baseDir = path.dirname(queuePath);
  const sourceSemantics = readClassificationTaskJsonlContextRows(
    baseDir,
    "source-semantics.jsonl",
  );
  const processSourceReferences = readClassificationTaskJsonlContextRows(
    baseDir,
    "process-source-references.jsonl",
  );
  const sourceReferenceRewrites = readClassificationTaskJsonlContextRows(
    baseDir,
    "source-reference-rewrites.jsonl",
  );
  return {
    source_semantics: sourceSemantics,
    process_source_references: processSourceReferences,
    source_reference_rewrites: sourceReferenceRewrites,
  };
}

function classificationTaskEvidenceForQueueRow(row, index, rowLookup) {
  const inputRow = rowLookup.get(classificationTaskQueueKey(row)) ?? null;
  return {
    source: "classification-authoring-queue",
    queue_row_index: index,
    current_classification: row.current_classification ?? null,
    source_classification: row.source_classification ?? null,
    authoring_context: row.authoring_context ?? null,
    source_file: row.source_file ?? null,
    input_rows: classificationQueueInputRows(row) || null,
    output_rows: classificationQueueOutputRows(row) || null,
    input_row_index: inputRow?.index ?? null,
    input_row_identity: inputRow
      ? {
          dataset_id: inputRow.dataset_id,
          dataset_version: inputRow.dataset_version,
          row_type: inputRow.row_type,
        }
      : null,
    input_row_payload: inputRow?.payload ?? null,
  };
}

function decisionTaskContextFileDetails(contractContext) {
  return contractContext.files.map((file) => ({
    kind: file.kind,
    path: file.path,
    sha256: file.sha256,
    bytes: file.bytes,
  }));
}

function decisionTaskContextFileWithText(file) {
  const text = String(file?.text ?? "");
  return {
    kind: asText(file?.kind) || "context",
    path: asText(file?.path) || null,
    sha256: asText(file?.sha256) || sha256Text(text),
    bytes: Number(file?.bytes) || Buffer.byteLength(text, "utf8"),
    text,
  };
}

function decisionTaskContextFileSummary(file) {
  const withText = decisionTaskContextFileWithText(file);
  return {
    kind: withText.kind,
    path: withText.path,
    sha256: withText.sha256,
    bytes: withText.bytes,
  };
}

function dedupeDecisionTaskContextFiles(files) {
  const byKey = new Map();
  for (const file of ensureArray(files).map(decisionTaskContextFileWithText)) {
    const key = JSON.stringify([file.kind, file.path, file.sha256]);
    if (!byKey.has(key)) byKey.set(key, file);
  }
  return [...byKey.values()];
}

function writeDecisionTaskSharedContextBundle({
  outDir,
  taskKind,
  files,
  references = [],
  cacheDir = null,
}) {
  const uniqueFiles = dedupeDecisionTaskContextFiles(files);
  const uniqueBytes = uniqueFiles.reduce(
    (total, file) => total + (Number(file.bytes) || 0),
    0,
  );
  const referenceRows = ensureArray(references);
  const referencedBytes =
    referenceRows.length > 0
      ? referenceRows.reduce(
          (total, ref) => total + (Number(ref.bytes) || 0),
          0,
        )
      : uniqueBytes;
  const stablePayload = {
    schema_version: 1,
    kind: "tiangong_foundry_decision_shared_context_bundle",
    task_kind: taskKind,
    counts: {
      files: uniqueFiles.length,
      references: referenceRows.length,
      duplicate_references: Math.max(
        0,
        referenceRows.length - uniqueFiles.length,
      ),
      unique_context_bytes: uniqueBytes,
      referenced_context_bytes: referencedBytes,
      duplicate_context_bytes_avoided: Math.max(0, referencedBytes - uniqueBytes),
    },
    files: uniqueFiles,
    references: referenceRows,
  };
  const bundle = {
    ...stablePayload,
    generated_at_utc: nowIso(),
    hash_scope:
      "schema_version, kind, task_kind, counts, files, and references; generated_at_utc and output path are excluded so identical decision context keeps a stable hash.",
    sha256: sha256Text(JSON.stringify(stablePayload)),
  };
  const resolvedCacheDir = cacheDir ? resolveRepoPath(cacheDir) : null;
  const bundlePath = resolvedCacheDir
    ? path.join(resolvedCacheDir, `${taskKind}.${bundle.sha256}.json`)
    : path.join(outDir, "shared-context-bundle.json");
  let cacheReused = false;
  if (resolvedCacheDir && fileExists(bundlePath)) {
    try {
      cacheReused = readJson(bundlePath)?.sha256 === bundle.sha256;
    } catch {
      cacheReused = false;
    }
  }
  if (!cacheReused) {
    writeJson(bundlePath, bundle);
  }
  return {
    path: repoRelativePath(bundlePath),
    sha256: bundle.sha256,
    counts: bundle.counts,
    hash_scope: bundle.hash_scope,
    cache: resolvedCacheDir
      ? {
          enabled: true,
          dir: repoRelativePath(resolvedCacheDir),
          reused: cacheReused,
        }
      : {
          enabled: false,
          reused: false,
        },
    instruction:
      "Read this shared bundle once for full schema/YAML/ruleset/category/location text; the decision task carries queue rows, attached payloads, provenance, and the stable context bundle hash used by deterministic apply.",
  };
}

function stableDecisionTaskQueueRows(queueRows) {
  return ensureArray(queueRows).map((row) => {
    const next = cloneJson(row);
    if (next?.classification_workflow?.commands) {
      delete next.classification_workflow.commands.output_rows;
    }
    if (next?.location_workflow?.commands) {
      delete next.location_workflow.commands.output_rows;
    }
    return next;
  });
}

function decisionTaskQueueSha256(queueRows) {
  return sha256Text(JSON.stringify(stableDecisionTaskQueueRows(queueRows)));
}

function decisionTaskProvenanceFileDetails(provenanceContext) {
  return Object.fromEntries(
    Object.entries(provenanceContext).map(([key, value]) => [
      key,
      {
        file: value?.file ?? null,
        total_rows: value?.total_rows ?? 0,
        truncated: Boolean(value?.truncated),
      },
    ]),
  );
}

function buildDecisionTaskContextBundle({
  taskKind,
  taskPath,
  outDir,
  sharedContextCacheDir = null,
  queuePath,
  queueRows,
  contractContext,
  provenanceContext,
  attachedInputRows,
}) {
  const contextFiles = dedupeDecisionTaskContextFiles(contractContext.files);
  const contractFiles = contextFiles.map(decisionTaskContextFileSummary);
  const sharedContextBundle = writeDecisionTaskSharedContextBundle({
    outDir: outDir ?? path.dirname(taskPath),
    taskKind,
    files: contextFiles,
    references: contextFiles.map((file) => ({
      kind: file.kind,
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
    cacheDir: sharedContextCacheDir,
  });
  const stablePayload = {
    task_kind: taskKind,
    queue_sha256: decisionTaskQueueSha256(queueRows),
    queue_rows: queueRows.length,
    contract_context_files: contractFiles,
    missing_context_files: contractContext.missing,
    provenance_context: decisionTaskProvenanceFileDetails(provenanceContext),
    attached_input_rows: attachedInputRows.map((row) => ({
      input_rows: row.input_rows,
      input_row_index: row.index,
      row_type: row.row_type,
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
    })),
    shared_context_bundle_sha256: sharedContextBundle.sha256,
  };
  return {
    ...stablePayload,
    task: repoRelativePath(taskPath),
    queue: repoRelativePath(queuePath),
    shared_context_bundle: sharedContextBundle,
    hash_scope:
      "task_kind, normalized queue_sha256, queue_rows, contract_context_files, missing_context_files, provenance_context, attached_input_rows, and shared_context_bundle_sha256; task path, queue path, and generated output_rows paths are excluded.",
    sha256: sha256Text(JSON.stringify(stablePayload)),
  };
}

function decisionAuthoringContext(contextBundle) {
  return {
    task: contextBundle.task,
    context_bundle_sha256: contextBundle.sha256,
    required_context_kinds: unique(
      contextBundle.contract_context_files.map((file) => file.kind),
    ),
    context_files: contextBundle.contract_context_files.map((file) => ({
      kind: file.kind,
      path: file.path,
      sha256: file.sha256,
    })),
  };
}

function buildClassificationDecisionTemplateRows(
  queueRows,
  rowLookup = new Map(),
  contextBundle = null,
) {
  const authoringContext = contextBundle
    ? decisionAuthoringContext(contextBundle)
    : null;
  return queueRows.map((row, index) => ({
    dataset_id: row.dataset_id,
    dataset_version: row.dataset_version,
    category_type: classificationQueueSchemaType(row),
    decision_status: "completed",
    code: "__AI_SELECT_TIDAS_CLASSIFICATION_CODE__",
    basis: "__AI_FILL_CLASSIFICATION_DECISION_BASIS__",
    used_context_kinds: [
      "__AI_FILL_USED_CONTEXT_KINDS__",
    ],
    ...(authoringContext ? { authoring_context: authoringContext } : {}),
    evidence: classificationTaskEvidenceForQueueRow(row, index, rowLookup),
  }));
}

function classificationDecisionTaskContextKind(kind, filePath) {
  const baseName = path.basename(String(filePath || "")).toLowerCase();
  if (baseName === "schema.json") return "schema";
  if (baseName === "methodology.yaml" || baseName === "methodology.yml") {
    return "methodology_yaml";
  }
  if (baseName === "runtime-ruleset.json") return "ruleset";
  if (baseName === "tidas_locations_category.json") return "location_schema";
  if (/^tidas_.*_category\.json$/u.test(baseName)) {
    return "classification_schema";
  }
  return kind;
}

function buildClassificationDecisionTaskContextFiles(options) {
  const inputs = [
    ["schema", options.schemaFile],
    ["methodology_yaml", options.yamlFile],
    ["ruleset", options.rulesetFile],
    ["context", options.contextFile],
    ["classification_schema", options.classificationSchema],
    ["location_schema", options.locationSchema],
  ];
  const files = [];
  const missing = [];
  for (const [defaultKind, optionValue] of inputs) {
    for (const filePath of normalizedList(optionValue)) {
      const resolved = resolveRepoPath(filePath);
      const kind = classificationDecisionTaskContextKind(
        defaultKind,
        filePath,
      );
      if (!resolved || !fileExists(resolved)) {
        missing.push({ kind, path: filePath });
        continue;
      }
      const text = readText(resolved);
      files.push({
        kind,
        path: repoRelativePath(resolved),
        sha256: createHash("sha256").update(text).digest("hex"),
        bytes: Buffer.byteLength(text, "utf8"),
        text,
      });
    }
  }
  return { files, missing };
}

function decisionTaskContextBlockers({
  kind,
  queueRows,
  contractContext,
  requiredContextKinds,
  attachedInputRowCount,
}) {
  if (queueRows.length === 0) return [];
  const blockers = [];
  const availableKinds = new Set(
    contractContext.files
      .filter((file) => Number(file.bytes) > 0)
      .map((file) => file.kind),
  );
  for (const missingFile of contractContext.missing) {
    blockers.push({
      code: `${kind}_decision_task_context_file_missing`,
      message:
        "Decision task cannot be sent to AI while a referenced context file is missing.",
      kind: missingFile.kind,
      path: missingFile.path,
    });
  }
  for (const file of contractContext.files) {
    if (Number(file.bytes) === 0) {
      blockers.push({
        code: `${kind}_decision_task_context_file_empty`,
        message:
          "Decision task cannot be sent to AI with an empty context file.",
        kind: file.kind,
        path: file.path,
      });
    }
  }
  for (const requiredKind of requiredContextKinds) {
    if (!availableKinds.has(requiredKind)) {
      blockers.push({
        code: `${kind}_decision_task_required_context_missing`,
        message:
          "Decision task must include the full schema/YAML/ruleset/category context before AI authoring.",
        kind: requiredKind,
      });
    }
  }
  const missingInputRows = queueRows.length - attachedInputRowCount;
  if (missingInputRows > 0) {
    blockers.push({
      code: `${kind}_decision_task_input_row_payload_missing`,
      message:
        "Decision task must attach the converted TIDAS row payload for every queued item before AI authoring.",
      missing_input_row_payloads: missingInputRows,
      queue_rows: queueRows.length,
    });
  }
  return blockers;
}

function decisionTaskBuildStatus({ queueRows, blockers, readyStatus, emptyStatus }) {
  if (queueRows.length === 0) return emptyStatus;
  if (blockers.length > 0) return "blocked_missing_full_context";
  return readyStatus;
}

const identityDecisionActionCodes = new Set([
  "identity_preflight_manual_review",
  "elementary_flow_identity_manual_review",
]);

function curationGateEntities(report) {
  return ensureArray(
    report?.entities ?? report?.processes ?? report?.flows ?? report?.items,
  );
}

function readAuthoringPackageForIdentityTask(entity) {
  const packageRef = asText(entity?.authoring_package ?? entity?.authoringPackage);
  const packagePath = resolveRepoPath(packageRef);
  const proof = {
    entity,
    package_ref: packageRef || null,
    package_path: packagePath,
    package_sha256: null,
    expected_sha256: asText(entity?.authoring_package_sha256) || null,
    package: null,
    blockers: [],
  };
  if (!packageRef || !packagePath || !fileExists(packagePath)) {
    proof.blockers.push({
      code: "identity_decision_authoring_package_missing",
      message:
        "Identity decision task requires a readable full-context authoring package.",
      authoring_package: packageRef || null,
    });
    return proof;
  }
  const text = readText(packagePath);
  proof.package_sha256 = sha256Text(text);
  try {
    proof.package = JSON.parse(text);
  } catch (error) {
    proof.blockers.push({
      code: "identity_decision_authoring_package_invalid",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: packageRef,
    });
    return proof;
  }
  if (proof.expected_sha256 && proof.expected_sha256 !== proof.package_sha256) {
    proof.blockers.push({
      code: "identity_decision_authoring_package_hash_mismatch",
      message:
        "Authoring package sha256 in the curation gate report no longer matches the package content.",
      authoring_package: packageRef,
      expected_sha256: proof.expected_sha256,
      actual_sha256: proof.package_sha256,
    });
  }
  return proof;
}

function contractContextKindsForPackage(packagePayload) {
  return new Set(
    ensureArray(packagePayload?.contract_context_files)
      .filter((file) => asText(file?.kind) && asText(file?.text))
      .map((file) => asText(file.kind)),
  );
}

function requiredIdentityContextKinds(packagePayload) {
  const fullContext =
    packagePayload?.full_context_ai_completion ??
    packagePayload?.fullContextAiCompletion;
  const required = normalizedList(
    fullContext?.required_context_kinds ?? fullContext?.requiredContextKinds,
  );
  return required.length > 0
    ? required
    : ["schema", "methodology_yaml", "ruleset"];
}

function identityTaskPackageContextBlockers(proof) {
  const blockers = [...proof.blockers];
  const packagePayload = proof.package;
  if (!packagePayload) return blockers;
  const availableKinds = contractContextKindsForPackage(packagePayload);
  for (const missing of ensureArray(packagePayload.missing_context_files)) {
    blockers.push({
      code: "identity_decision_authoring_package_missing_context_file",
      message:
        "Authoring package records missing context files and cannot be sent as a full-context identity decision task.",
      authoring_package: proof.package_ref,
      missing_context_file: missing,
    });
  }
  for (const kind of requiredIdentityContextKinds(packagePayload)) {
    if (!availableKinds.has(kind)) {
      blockers.push({
        code: "identity_decision_required_context_missing",
        message:
          "Identity decision task must include the full schema/YAML/ruleset/category context from the authoring package before AI authoring.",
        kind,
        authoring_package: proof.package_ref,
      });
    }
  }
  return blockers;
}

function identityActionItemsFromPackage(proof) {
  const packagePayload = proof.package ?? {};
  return ensureArray(packagePayload.action_items)
    .map((item, actionIndex) => ({ item, actionIndex }))
    .filter(({ item }) => identityDecisionActionCodes.has(asText(item?.code)));
}

function identityDecisionTargetForAction(packagePayload, actionItem) {
  const dependencyType = asText(actionItem?.dependency_type);
  const dependencyId = asText(actionItem?.dependency_id);
  const dependencyVersion = asText(actionItem?.dependency_version);
  return {
    dataset_type:
      dependencyType ||
      asText(actionItem?.target_dataset_type) ||
      asText(actionItem?.dataset_type) ||
      asText(packagePayload?.dataset_type),
    dataset_id:
      dependencyId ||
      asText(actionItem?.target_dataset_id) ||
      asText(actionItem?.dataset_id) ||
      asText(packagePayload?.entity_id),
    dataset_version:
      dependencyVersion ||
      asText(actionItem?.target_dataset_version) ||
      asText(actionItem?.dataset_version) ||
      asText(packagePayload?.version) ||
      "00.00.001",
  };
}

function identityDecisionTaskRowsFromPackages(packageProofs) {
  const rows = [];
  for (const proof of packageProofs) {
    const packagePayload = proof.package;
    if (!packagePayload) continue;
    for (const { item, actionIndex } of identityActionItemsFromPackage(proof)) {
      const target = identityDecisionTargetForAction(packagePayload, item);
      rows.push({
        dataset_type: target.dataset_type,
        dataset_id: target.dataset_id,
        dataset_version: target.dataset_version,
        relation: asText(item?.relation) || "current",
        action_item_code: asText(item?.code),
        action_item_index: actionIndex,
        authoring_package: proof.package_ref,
        authoring_package_sha256: proof.package_sha256,
        authoring_entity: {
          dataset_type: asText(packagePayload.dataset_type),
          entity_id: asText(packagePayload.entity_id),
          version: asText(packagePayload.version),
        },
        action_item: item,
        package: packagePayload,
        package_proof: proof,
      });
    }
  }
  return rows;
}

function identityDecisionTaskRowKey(row) {
  return JSON.stringify([
    asText(row?.dataset_type).toLowerCase(),
    asText(row?.dataset_id),
    asText(row?.dataset_version) || "00.00.001",
  ]);
}

function identityDecisionTaskSourceItem(row) {
  return {
    dataset_type: row.dataset_type,
    dataset_id: row.dataset_id,
    dataset_version: row.dataset_version || "00.00.001",
    relation: row.relation,
    action_item_code: row.action_item_code,
    action_item_index: row.action_item_index,
    authoring_package: row.authoring_package,
    authoring_package_sha256: row.authoring_package_sha256,
    authoring_entity: row.authoring_entity,
    evidence: row.action_item?.evidence ?? null,
  };
}

function identityDecisionTaskPackageRefs(rows) {
  const byKey = new Map();
  for (const row of ensureArray(rows)) {
    const key = JSON.stringify([
      row.authoring_package,
      row.authoring_package_sha256,
    ]);
    if (!byKey.has(key)) {
      byKey.set(key, {
        authoring_package: row.authoring_package,
        authoring_package_sha256: row.authoring_package_sha256,
        authoring_entity: row.authoring_entity,
      });
    }
  }
  return [...byKey.values()];
}

function identityDecisionTaskRawRows(row) {
  return ensureArray(row?.source_task_rows).length > 0
    ? row.source_task_rows
    : ensureArray(row);
}

function identityDecisionTaskActionCodes(row) {
  const rawRows = identityDecisionTaskRawRows(row);
  return unique(
    [
      ...ensureArray(row?.action_item_codes),
      row?.action_item_code,
      ...rawRows.map((rawRow) => rawRow.action_item_code),
    ].map(asText),
  );
}

function primaryIdentityDecisionActionCode(codes) {
  return codes.includes("elementary_flow_identity_manual_review")
    ? "elementary_flow_identity_manual_review"
    : codes[0] || "identity_preflight_manual_review";
}

function mergeIdentityDecisionTaskRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = identityDecisionTaskRowKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...row,
        dataset_version: row.dataset_version || "00.00.001",
        source_task_rows: [],
        source_action_items: [],
        action_item_codes: [],
        related_authoring_packages: [],
      });
    }
    const merged = byKey.get(key);
    const previousPrimaryCode = merged.action_item_code;
    merged.source_task_rows.push(row);
    merged.source_action_items.push(identityDecisionTaskSourceItem(row));
    merged.action_item_codes = unique([
      ...merged.action_item_codes,
      row.action_item_code,
    ]);
    merged.related_authoring_packages = identityDecisionTaskPackageRefs(
      merged.source_task_rows,
    );
    merged.source_action_item_count = merged.source_action_items.length;
    merged.action_item_code = primaryIdentityDecisionActionCode(
      merged.action_item_codes,
    );
    if (
      previousPrimaryCode !== merged.action_item_code &&
      row.action_item_code === merged.action_item_code &&
      merged.action_item !== row.action_item
    ) {
      merged.action_item = row.action_item;
      merged.action_item_index = row.action_item_index;
      merged.authoring_package = row.authoring_package;
      merged.authoring_package_sha256 = row.authoring_package_sha256;
      merged.authoring_entity = row.authoring_entity;
      merged.package = row.package;
      merged.package_proof = row.package_proof;
    }
  }
  return [...byKey.values()];
}

function buildIdentityDecisionTemplateRows(taskRows, contextBundle = null) {
  const authoringContext = contextBundle
    ? decisionAuthoringContext(contextBundle)
    : null;
  return taskRows.map((row, index) => {
    const actionCodes = identityDecisionTaskActionCodes(row);
    const isElementaryDecision = actionCodes.includes(
      "elementary_flow_identity_manual_review",
    );
    return {
      dataset_type: row.dataset_type,
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version || "00.00.001",
      decision_status: "completed",
      identity_decision: isElementaryDecision
        ? "__AI_SELECT_REUSE_EXISTING_REFERENCE_OR_BLOCK_UNRESOLVED__"
        : "__AI_SELECT_REUSE_EXISTING_REFERENCE_CREATE_NEW_OR_BLOCK_UNRESOLVED__",
      canonical: {
        table: datasetRowsFileStem(row.dataset_type),
        ref_object_id: "__AI_FILL_CANONICAL_REF_OBJECT_ID_IF_REUSE__",
        version: "__AI_FILL_CANONICAL_VERSION_IF_REUSE__",
        short_description: "__AI_FILL_CANONICAL_SHORT_DESCRIPTION_IF_REUSE__",
      },
      basis: "__AI_FILL_IDENTITY_DECISION_BASIS__",
      used_context_kinds: ["__AI_FILL_USED_CONTEXT_KINDS__"],
      closes_action_items: actionCodes,
      authoring_package: row.authoring_package,
      authoring_package_sha256: row.authoring_package_sha256,
      ...(authoringContext ? { authoring_context: authoringContext } : {}),
      evidence: {
        source: "foundry_identity_decision_task",
        task_row_index: index,
        relation: row.relation,
        action_item_code: row.action_item_code,
        action_item_codes: actionCodes,
        source_action_item_count:
          Number(row.source_action_item_count) ||
          identityDecisionTaskRawRows(row).length,
        source_action_items: ensureArray(row.source_action_items),
        related_authoring_packages: ensureArray(row.related_authoring_packages),
        identity_preflight: row.action_item?.evidence ?? null,
        remote_search: row.action_item?.evidence?.remote_search ?? null,
        target: row.action_item?.evidence?.target ?? null,
        top_candidates: row.action_item?.evidence?.top_candidates ?? [],
        authoring_entity: row.authoring_entity,
      },
    };
  });
}

function runDatasetIdentityDecisionTaskBuild(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-identity-decision-task-build",
      usage: [
        "node scripts/foundry.mjs dataset-identity-decision-task-build --curation-gate-report <dataset-curation-gate-report.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
      ],
      purpose:
        "Build an AI-facing identity decision task from Foundry curation gate authoring packages. AI decides reuse_existing_reference/create_new/block_unresolved; deterministic apply is handled by dataset-identity-decisions-apply.",
    };
  }
  const curationGateReportPath = resolveRepoPath(
    options.curationGateReport || options.report || options.input,
  );
  if (!curationGateReportPath || !fileExists(curationGateReportPath)) {
    throw new Error(
      "--curation-gate-report is required and must point to dataset-curation-gate-report.json.",
    );
  }
  const outDir = resolveRepoPath(
    options.outDir || ".foundry/workspaces/identity-decision-task",
  );
  const sharedContextCacheDir = resolveRepoPath(
    options.sharedContextCacheDir || options.contextCacheDir,
  );
  fs.mkdirSync(outDir, { recursive: true });
  const curationGateReport = readJson(curationGateReportPath);
  const entities = curationGateEntities(curationGateReport);
  const packageProofs = entities
    .map(readAuthoringPackageForIdentityTask)
    .filter((proof) => {
      if (!proof.package) return proof.blockers.length > 0;
      return identityActionItemsFromPackage(proof).length > 0;
    });
  const sourceTaskRows = identityDecisionTaskRowsFromPackages(packageProofs);
  const uniqueTaskRows = mergeIdentityDecisionTaskRows(sourceTaskRows);
  const selected = selectDecisionTaskQueueRows(
    sourceTaskRows,
    options,
    (row) => row.action_item_code,
  );
  const selectedSourceRows = hasQueueSelectionOptions(options)
    ? selected.selected.map(({ row }) => row)
    : sourceTaskRows;
  const selectedRows = mergeIdentityDecisionTaskRows(selectedSourceRows);
  const selectedRawRows = selectedRows.flatMap(identityDecisionTaskRawRows);
  const selection = hasQueueSelectionOptions(options)
    ? selected.selection
    : {
        source_queue_rows: sourceTaskRows.length,
        matched_queue_rows: sourceTaskRows.length,
        selected_queue_rows: sourceTaskRows.length,
        source_queue_row_indices: sourceTaskRows.map((_, index) => index),
      };
  const taskPath = path.join(outDir, "identity-decision-task.json");
  const templatePath = path.join(outDir, "identity-decisions.template.jsonl");
  const decisionFile = path.join(outDir, "identity-decisions.jsonl");
  const reportPath = path.join(outDir, "identity-decision-task-report.json");
  const contractContext = {
    files: selectedRawRows.flatMap((row) =>
      ensureArray(row.package?.contract_context_files),
    ),
    missing: selectedRawRows.flatMap((row) =>
      ensureArray(row.package?.missing_context_files),
    ),
  };
  const identityContextFiles = dedupeDecisionTaskContextFiles(
    contractContext.files,
  );
  const identityContextReferences = selectedRows.flatMap((row) =>
    identityDecisionTaskRawRows(row).flatMap((rawRow) =>
      ensureArray(rawRow.package?.contract_context_files).map((file) => {
        const summary = decisionTaskContextFileSummary(file);
        return {
          ...summary,
          authoring_package: rawRow.authoring_package,
          authoring_package_sha256: rawRow.authoring_package_sha256,
          action_item_code: rawRow.action_item_code,
          dataset_type: rawRow.dataset_type,
          dataset_id: rawRow.dataset_id,
          dataset_version: rawRow.dataset_version,
        };
      }),
    ),
  );
  const sharedContextBundle = writeDecisionTaskSharedContextBundle({
    outDir,
    taskKind: "identity_decision_authoring",
    files: identityContextFiles,
    references: identityContextReferences,
    cacheDir: sharedContextCacheDir,
  });
  const contextBundleStablePayload = {
    task_kind: "identity_decision_authoring",
    source_curation_gate_report: repoRelativePath(curationGateReportPath),
    task_rows: selectedRows.length,
    source_identity_action_items: selectedSourceRows.length,
    contract_context_files: identityContextFiles.map(
      decisionTaskContextFileSummary,
    ),
    missing_context_files: contractContext.missing,
    authoring_packages: selectedRawRows.map((row) => ({
      authoring_package: row.authoring_package,
      authoring_package_sha256: row.authoring_package_sha256,
      action_item_code: row.action_item_code,
      dataset_type: row.dataset_type,
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
    })),
    shared_context_bundle_sha256: sharedContextBundle.sha256,
  };
  const contextBundle = {
    ...contextBundleStablePayload,
    task: repoRelativePath(taskPath),
    shared_context_bundle: sharedContextBundle,
    hash_scope:
      "task_kind, source_curation_gate_report, task_rows, source_identity_action_items, contract_context_files, missing_context_files, authoring_packages, and shared_context_bundle_sha256; task path and generated_at_utc are excluded.",
    sha256: sha256Text(JSON.stringify(contextBundleStablePayload)),
  };
  const templateRows = buildIdentityDecisionTemplateRows(
    selectedRows,
    contextBundle,
  );
  const blockers = [
    ...packageProofs.flatMap(identityTaskPackageContextBlockers),
    ...selectedRows
      .filter((row) => !row.dataset_type || !row.dataset_id)
      .map((row) => ({
        code: "identity_decision_target_missing",
        message:
          "Identity action item does not identify the flow/process target to decide.",
        authoring_package: row.authoring_package,
        action_item_code: row.action_item_code,
      })),
  ];
  const datasetTypes = unique(selectedRows.map((row) => row.dataset_type));
  const task = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: decisionTaskBuildStatus({
      queueRows: selectedRows,
      blockers,
      readyStatus: "ready_for_ai_identity_decisions",
      emptyStatus: "ready_no_identity_actions",
    }),
    task_kind: "identity_decision_authoring",
    source_curation_gate_report: repoRelativePath(curationGateReportPath),
    counts: {
      curation_entities: entities.length,
      identity_action_items: sourceTaskRows.length,
      unique_identity_targets: uniqueTaskRows.length,
      selected_identity_action_items: selectedSourceRows.length,
      selected_unique_identity_targets: selectedRows.length,
      deduplicated_identity_action_items:
        selectedSourceRows.length - selectedRows.length,
      template_decisions: templateRows.length,
      authoring_packages: unique(
        selectedRawRows.map((row) => row.authoring_package),
      ).length,
      dataset_types: datasetTypes.length,
      blockers: blockers.length,
    },
    blockers,
    dataset_types: datasetTypes,
    selection,
    identity_action_items: selectedRows.map((row) => ({
      dataset_type: row.dataset_type,
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      relation: row.relation,
      action_item_code: row.action_item_code,
      authoring_package: row.authoring_package,
      authoring_package_sha256: row.authoring_package_sha256,
      action_item_codes: identityDecisionTaskActionCodes(row),
      source_action_item_count:
        Number(row.source_action_item_count) ||
        identityDecisionTaskRawRows(row).length,
      source_action_items: ensureArray(row.source_action_items),
      related_authoring_packages: ensureArray(row.related_authoring_packages),
      evidence: row.action_item?.evidence ?? null,
    })),
    context_bundle: contextBundle,
    shared_context_bundle: sharedContextBundle,
    instructions: [
      "Read shared_context_bundle once for full schema/YAML/ruleset/category/location text, then read each full authoring package for source row, identity-preflight candidates, action items, and package-specific evidence.",
      "For product/process identity_preflight_manual_review, choose reuse_existing_reference, create_new, or block_unresolved with evidence.",
      "For elementary_flow_identity_manual_review, do not choose create_new. Choose reuse_existing_reference with canonical id/version, or block_unresolved with searched candidate evidence.",
      "Every decision must include dataset_type, dataset_id, dataset_version, decision_status=completed, identity_decision, basis, used_context_kinds, structured evidence, closes_action_items, authoring_package, and authoring_package_sha256.",
      "Do not write row JSON directly; run dataset-identity-decisions-apply after decisions are complete, then rerun validate/QA/curation/finalize on the applied rows.",
    ],
    files: {
      task: repoRelativePath(taskPath),
      template: repoRelativePath(templatePath),
      expected_decisions: repoRelativePath(decisionFile),
      report: repoRelativePath(reportPath),
      shared_context_bundle: sharedContextBundle.path,
    },
    commands: {
      apply_decisions: [
        process.execPath,
        path.join(repoRoot, "scripts", "foundry.mjs"),
        "dataset-identity-decisions-apply",
        "--type",
        datasetTypes.length === 1 ? datasetTypes[0] : "<flow-or-process>",
        "--rows-file",
        options.rowsFile || "<rows-file-containing-identity-targets>",
        "--decisions",
        decisionFile,
        "--out-dir",
        path.join(outDir, "apply"),
      ]
        .map(shellQuote)
        .join(" "),
    },
  };
  writeJsonLines(templatePath, templateRows);
  writeJson(taskPath, task);
  writeJson(reportPath, task);
  return task;
}

function runDatasetClassificationDecisionTaskBuild(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-classification-decision-task-build",
      usage: [
        "node scripts/foundry.mjs dataset-classification-decision-task-build --classification-queue <classification-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
      ],
      purpose:
        "Build an AI-facing classification decision task from Foundry classification queue rows. AI fills TIDAS category codes; deterministic apply is handled by dataset-classification-decisions-apply.",
    };
  }

  const queuePath = resolveRepoPath(
    options.classificationQueue || options.queue || options.input,
  );
  if (!queuePath || !fileExists(queuePath)) {
    throw new Error(
      "--classification-queue is required and must point to classification-authoring-queue.jsonl.",
    );
  }
  const outDir = resolveRepoPath(
    options.outDir || ".foundry/workspaces/classification-decision-task",
  );
  const sharedContextCacheDir = resolveRepoPath(
    options.sharedContextCacheDir || options.contextCacheDir,
  );
  fs.mkdirSync(outDir, { recursive: true });
  const sourceQueueRows = readJsonOrJsonLines(queuePath);
  const useSelection = hasQueueSelectionOptions(options);
  const inputRowsOverride = decisionTaskInputRowsOverride(options);
  const shouldDeriveQueue = useSelection || Boolean(inputRowsOverride);
  let queueRows = sourceQueueRows;
  let taskQueuePath = queuePath;
  let selection = {
    source_queue_rows: sourceQueueRows.length,
    matched_queue_rows: sourceQueueRows.length,
    selected_queue_rows: sourceQueueRows.length,
    source_queue_row_indices: sourceQueueRows.map((_, index) => index),
  };
  if (shouldDeriveQueue) {
    const selected = useSelection
      ? selectDecisionTaskQueueRows(
          sourceQueueRows,
          options,
          classificationQueueSchemaType,
        )
      : {
          selection,
          selected: sourceQueueRows.map((row, sourceIndex) => ({
            row,
            sourceIndex,
          })),
        };
    selection = {
      ...selected.selection,
      input_rows_override: inputRowsOverride
        ? repoRelativePath(inputRowsOverride)
        : null,
    };
    const chunkLabel = decisionTaskChunkLabel(
      options,
      selection,
      inputRowsOverride ? "classification-current-rows" : "classification-chunk",
    );
    queueRows = rewriteDecisionTaskQueueRowsForChunk({
      selected: selected.selected,
      sourceQueuePath: queuePath,
      outDir,
      chunkLabel,
      workflowKey: "classification_workflow",
      outputSuffix: "classified",
      inputRowsForRow: classificationQueueInputRows,
      inputRowsOverride,
    });
    selection.chunk_label = chunkLabel;
    taskQueuePath = path.join(
      outDir,
      `classification-authoring-queue.${chunkLabel}.jsonl`,
    );
    writeJsonLines(taskQueuePath, queueRows);
  }
  const rowLookup = buildClassificationTaskInputRowLookup(queueRows);
  const templatePath = path.join(
    outDir,
    "classification-decisions.template.jsonl",
  );
  const taskPath = path.join(outDir, "classification-decision-task.json");
  const reportPath = path.join(outDir, "classification-decision-task-report.json");
  const decisionFile = path.join(outDir, "classification-decisions.jsonl");
  const contractContext = buildClassificationDecisionTaskContextFiles(options);
  const provenanceContext = buildClassificationTaskProvenanceContext(queuePath);
  const attachedInputRows = [...rowLookup.values()];
  const contextBundle = buildDecisionTaskContextBundle({
    taskKind: "classification_decision_authoring",
    taskPath,
    outDir,
    sharedContextCacheDir,
    queuePath: taskQueuePath,
    queueRows,
    contractContext,
    provenanceContext,
    attachedInputRows,
  });
  const templateRows = buildClassificationDecisionTemplateRows(
    queueRows,
    rowLookup,
    contextBundle,
  );
  const queueRowsWithAttachedInput = templateRows.filter(
    (row) => row.evidence?.input_row_payload,
  ).length;
  const blockers = decisionTaskContextBlockers({
    kind: "classification",
    queueRows,
    contractContext,
    requiredContextKinds: [
      "schema",
      "methodology_yaml",
      "ruleset",
      "classification_schema",
      "location_schema",
    ],
    attachedInputRowCount: queueRowsWithAttachedInput,
  });
  const contextFiles = contractContext.files.map((file) => file.path);
  const schemaTypes = unique(queueRows.map(classificationQueueSchemaType));
  const rowTypes = unique(queueRows.map(classificationQueueRowType));
  const task = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: decisionTaskBuildStatus({
      queueRows,
      blockers,
      readyStatus: "ready_for_ai_classification_decisions",
      emptyStatus: "ready_no_classification_actions",
    }),
    task_kind: "classification_decision_authoring",
    classification_queue: repoRelativePath(taskQueuePath),
    counts: {
      queue_rows: queueRows.length,
      template_decisions: templateRows.length,
      schema_types: schemaTypes.length,
      row_types: rowTypes.length,
      contract_context_files: contractContext.files.length,
      missing_context_files: contractContext.missing.length,
      attached_input_rows: queueRowsWithAttachedInput,
      unique_attached_input_rows: attachedInputRows.length,
      missing_input_row_payloads: queueRows.length - queueRowsWithAttachedInput,
      provenance_context_files: [
        provenanceContext.source_semantics.file,
        provenanceContext.process_source_references.file,
        provenanceContext.source_reference_rewrites.file,
      ].filter(Boolean).length,
      blockers: blockers.length,
    },
    blockers,
    schema_types: schemaTypes,
    row_types: rowTypes,
    selection,
    source_classification_queue: shouldDeriveQueue
      ? repoRelativePath(queuePath)
      : null,
    classification_queue_rows: queueRows,
    attached_input_rows: attachedInputRows,
    provenance_context: provenanceContext,
    context_bundle: contextBundle,
    shared_context_bundle: contextBundle.shared_context_bundle,
    context_files: contextFiles,
    contract_context_files: contractContext.files.map(
      decisionTaskContextFileSummary,
    ),
    missing_context_files: contractContext.missing,
    instructions: [
      "Read shared_context_bundle once for full Foundry/SDK schema, methodology YAML, runtime ruleset, classification/location schema text, then use this task's queue rows, attached payloads, provenance, and source trace before choosing codes.",
      "Replace each template code with a valid TIDAS leaf code for category_type; keep source classification as evidence, not target classification.",
      "Every decision must include dataset_id, dataset_version, category_type, code, basis, used_context_kinds, and structured evidence.",
      "Do not write row JSON directly; run dataset-classification-decisions-apply after decisions are complete.",
    ],
    files: {
      task: repoRelativePath(taskPath),
      template: repoRelativePath(templatePath),
      expected_decisions: repoRelativePath(decisionFile),
      report: repoRelativePath(reportPath),
      shared_context_bundle: contextBundle.shared_context_bundle.path,
    },
    commands: {
      apply_decisions: [
        process.execPath,
        path.join(repoRoot, "scripts", "foundry.mjs"),
	        "dataset-classification-decisions-apply",
        "--classification-queue",
        taskQueuePath,
        "--decisions",
        decisionFile,
        "--decision-task",
        taskPath,
        "--out-dir",
        path.join(outDir, "apply"),
      ]
        .map(shellQuote)
        .join(" "),
    },
  };
  writeJsonLines(templatePath, templateRows);
  writeJson(taskPath, task);
	  writeJson(reportPath, task);
	  return task;
	}

function decisionTaskOptionPath(options, kind) {
  if (kind === "classification") {
    return (
      options.decisionTask ||
      options.classificationDecisionTask ||
      options.classificationTask ||
      options.taskReport ||
      options.task
    );
  }
  return (
    options.decisionTask ||
    options.locationDecisionTask ||
    options.locationTask ||
    options.taskReport ||
    options.task
  );
}

function decisionTaskOptionPaths(options, kind) {
  return normalizedList(decisionTaskOptionPath(options, kind));
}

function readDecisionTaskSharedContextBundleProof(task, proofPath) {
  const contextBundle = task?.context_bundle ?? task?.authoring_context ?? {};
  const sharedContext =
    task?.shared_context_bundle ?? contextBundle?.shared_context_bundle ?? {};
  const sharedPath = asText(
    sharedContext?.path ?? task?.files?.shared_context_bundle,
  );
  const expectedSha256 = asText(
    sharedContext?.sha256 ?? contextBundle?.shared_context_bundle_sha256,
  );
  const proof = {
    path: sharedPath || null,
    sha256: null,
    expected_sha256: expectedSha256 || null,
    counts: sharedContext?.counts ?? null,
    files: [],
    blockers: [],
  };
  if (!sharedPath) return proof;
  const resolved = resolveRepoPath(sharedPath);
  if (!resolved || !fileExists(resolved)) {
    proof.blockers.push({
      code: "decision_task_shared_context_bundle_missing",
      message:
        "Decision task references an unreadable shared full-context bundle.",
      decision_task: proofPath,
      shared_context_bundle: sharedPath,
    });
    return proof;
  }
  try {
    const bundle = readJson(resolved);
    proof.sha256 = asText(bundle?.sha256);
    proof.files = ensureArray(bundle?.files);
    proof.counts = bundle?.counts ?? proof.counts;
    if (expectedSha256 && proof.sha256 !== expectedSha256) {
      proof.blockers.push({
        code: "decision_task_shared_context_bundle_hash_mismatch",
        message:
          "Decision task shared context bundle sha256 no longer matches the task reference.",
        decision_task: proofPath,
        shared_context_bundle: sharedPath,
        expected_sha256: expectedSha256,
        actual_sha256: proof.sha256 || null,
      });
    }
  } catch (error) {
    proof.blockers.push({
      code: "decision_task_shared_context_bundle_invalid",
      message: error instanceof Error ? error.message : String(error),
      decision_task: proofPath,
      shared_context_bundle: sharedPath,
    });
  }
  return proof;
}

function readDecisionTaskProofFromPath(taskPathInput, kind, queuePath) {
  const taskPath = resolveRepoPath(taskPathInput);
  if (!taskPath) return null;
  const proof = {
    path: repoRelativePath(taskPath),
    sha256: null,
    status: null,
    task_kind: null,
    context_bundle_sha256: null,
    queue: null,
    source_queue: null,
    contract_context_files: [],
    missing_context_files: [],
    shared_context_bundle: null,
    blockers: [],
  };
  if (!fileExists(taskPath)) {
    proof.blockers.push({
      code: `${kind}_decision_task_missing`,
      message: "Decision apply was given an unreadable AI decision task file.",
      decision_task: proof.path,
    });
    return proof;
  }
  try {
    const rawText = readText(taskPath);
    proof.sha256 = sha256Text(rawText);
    const task = JSON.parse(rawText);
    const contextBundle = task.context_bundle ?? task.authoring_context;
    proof.status = asText(task.status);
    proof.task_kind = asText(task.task_kind);
    proof.context_bundle_sha256 = asText(
      contextBundle?.sha256 ?? contextBundle?.context_bundle_sha256,
    );
    proof.queue = asText(
      kind === "classification"
        ? task.classification_queue
        : task.location_queue,
    );
    proof.source_queue = asText(
      kind === "classification"
        ? task.source_classification_queue
        : task.source_location_queue,
    );
    proof.contract_context_files = ensureArray(task.contract_context_files);
    proof.missing_context_files = ensureArray(task.missing_context_files);
    proof.context_bundle = contextBundle ?? null;
    proof.shared_context_bundle = readDecisionTaskSharedContextBundleProof(
      task,
      proof.path,
    );
    proof.blockers.push(...proof.shared_context_bundle.blockers);
    if (
      kind === "classification" &&
      proof.task_kind !== "classification_decision_authoring"
    ) {
      proof.blockers.push({
        code: "classification_decision_task_kind_invalid",
        message: "Classification decisions must be bound to a classification decision task.",
        task_kind: proof.task_kind,
        decision_task: proof.path,
      });
    }
    if (kind === "location" && proof.task_kind !== "location_decision_authoring") {
      proof.blockers.push({
        code: "location_decision_task_kind_invalid",
        message: "Location decisions must be bound to a location decision task.",
        task_kind: proof.task_kind,
        decision_task: proof.path,
      });
    }
    const taskQueuePath = resolveRepoPath(proof.queue);
    const sourceQueuePath = resolveRepoPath(proof.source_queue);
    if (
      !sameResolvedPath(taskQueuePath, queuePath) &&
      !sameResolvedPath(sourceQueuePath, queuePath)
    ) {
      proof.blockers.push({
        code: `${kind}_decision_task_queue_mismatch`,
        message: "Decision task queue does not match the queue being applied.",
        decision_task: proof.path,
        task_queue: proof.queue,
        source_queue: proof.source_queue,
        apply_queue: repoRelativePath(queuePath),
      });
    }
    if (!proof.context_bundle_sha256) {
      proof.blockers.push({
        code: `${kind}_decision_task_context_bundle_missing`,
        message:
          "Decision task must include context_bundle.sha256 so AI output can be tied to the exact context bundle.",
        decision_task: proof.path,
      });
    }
    if (proof.missing_context_files.length > 0) {
      proof.blockers.push({
        code: `${kind}_decision_task_context_files_missing`,
        message:
          "Decision task records missing context files and cannot prove full-context AI completion.",
        decision_task: proof.path,
        missing_context_files: proof.missing_context_files,
      });
    }
  } catch (error) {
    proof.blockers.push({
      code: `${kind}_decision_task_invalid`,
      message: error instanceof Error ? error.message : String(error),
      decision_task: proof.path,
    });
  }
  return proof;
}

function readDecisionTaskProof(options, kind, queuePath) {
  const [taskPath] = decisionTaskOptionPaths(options, kind);
  return taskPath ? readDecisionTaskProofFromPath(taskPath, kind, queuePath) : null;
}

function readDecisionTaskProofs(options, kind, queuePath) {
  return decisionTaskOptionPaths(options, kind)
    .map((taskPath) => readDecisionTaskProofFromPath(taskPath, kind, queuePath))
    .filter(Boolean);
}

function decisionContextBundleSha256(decision) {
  return asText(
    decision?.authoring_context?.context_bundle_sha256 ??
      decision?.authoringContext?.contextBundleSha256 ??
      decision?.authoring_context_sha256 ??
      decision?.context_bundle_sha256 ??
      decision?.contextBundleSha256,
  );
}

function decisionCompletionStatus(decision) {
  return asText(
    decision?.decision_status ??
      decision?.decisionStatus ??
      decision?.status,
  );
}

function decisionTaskReportPayload(proof) {
  if (!proof) return null;
  return {
    path: proof.path,
    sha256: proof.sha256,
    status: proof.status,
    task_kind: proof.task_kind,
    queue: proof.queue,
    source_queue: proof.source_queue,
    context_bundle_sha256: proof.context_bundle_sha256,
    contract_context_files: proof.contract_context_files.map((file) => ({
      kind: file.kind,
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
    missing_context_files: proof.missing_context_files,
    shared_context_bundle: proof.shared_context_bundle
      ? {
          path: proof.shared_context_bundle.path,
          sha256: proof.shared_context_bundle.sha256,
          expected_sha256: proof.shared_context_bundle.expected_sha256,
          counts: proof.shared_context_bundle.counts,
        }
      : null,
  };
}

function decisionTaskProofList(proofOrProofs) {
  return ensureArray(proofOrProofs).filter(Boolean);
}

function decisionTaskContextBundleHashes(proofs) {
  return unique(
    decisionTaskProofList(proofs).map((proof) => proof.context_bundle_sha256),
  );
}

function validateClassificationDecisionsForQueue(
  queueRows,
  decisions,
  { decisionTaskProof = null, decisionKind = "classification" } = {},
) {
  const blockers = [];
  const decisionTaskProofs = decisionTaskProofList(decisionTaskProof);
  for (const proof of decisionTaskProofs) {
    blockers.push(...proof.blockers);
  }
  const contextBundleHashes =
    decisionTaskContextBundleHashes(decisionTaskProofs);
  const queueByKey = new Map(
    queueRows.map((row) => [classificationQueueTargetKey(row), row]),
  );
  const decisionsByKey = new Map();
  for (const [index, decision] of decisions.entries()) {
    const schemaType = classificationDecisionSchemaType(decision);
    const key = classificationDecisionTargetKey(decision);
    if (hasUnresolvedAiPlaceholder(decision)) {
      blockers.push({
        code: "classification_decision_template_incomplete",
        message: "Classification decision still contains an AI placeholder.",
        decision_index: index,
      });
      continue;
    }
    if (decisionCompletionStatus(decision) !== "completed") {
      blockers.push({
        code: `${decisionKind}_decision_status_not_completed`,
        message:
          "Classification decision must declare decision_status=completed before deterministic apply.",
        decision_index: index,
        decision_status: decisionCompletionStatus(decision) || null,
      });
    }
    if (!schemaType) {
      blockers.push({
        code: "classification_decision_schema_type_missing",
        message: "Classification decision must include category_type.",
        decision_index: index,
      });
      continue;
    }
    if (!classificationDecisionCode(decision)) {
      blockers.push({
        code: "classification_decision_code_missing",
        message: "Classification decision must include a TIDAS category code.",
        decision_index: index,
      });
    }
    if (!asText(decision.basis)) {
      blockers.push({
        code: "classification_decision_basis_missing",
        message: "Classification decision must include basis.",
        decision_index: index,
      });
    }
    if (!decision.evidence || typeof decision.evidence !== "object") {
      blockers.push({
        code: "classification_decision_evidence_missing",
        message: "Classification decision must include structured evidence.",
        decision_index: index,
      });
    }
	    if (classificationDecisionUsedContextKinds(decision).length === 0) {
	      blockers.push({
        code: "classification_decision_used_context_missing",
        message:
          "Classification decision must include used_context_kinds so full-context AI evidence is auditable.",
        decision_index: index,
	      });
	    }
    if (contextBundleHashes.length > 0) {
	      const decisionBundleHash = decisionContextBundleSha256(decision);
	      if (!decisionBundleHash) {
	        blockers.push({
	          code: `${decisionKind}_decision_context_bundle_missing`,
	          message:
	            "Decision must include authoring_context.context_bundle_sha256 from the AI decision task template.",
	          decision_index: index,
          decision_tasks: decisionTaskProofs.map((proof) => proof.path),
	        });
      } else if (!contextBundleHashes.includes(decisionBundleHash)) {
	        blockers.push({
	          code: `${decisionKind}_decision_context_bundle_mismatch`,
	          message:
	            "Decision authoring context hash does not match the AI decision task context bundle.",
	          decision_index: index,
          expected_context_bundle_sha256:
            contextBundleHashes.length === 1 ? contextBundleHashes[0] : null,
          expected_context_bundle_sha256_any_of: contextBundleHashes,
	          actual_context_bundle_sha256: decisionBundleHash,
          decision_tasks: decisionTaskProofs.map((proof) => proof.path),
	        });
	      }
	    }
	    if (!queueByKey.has(key)) {
      blockers.push({
        code: "classification_decision_not_in_queue",
        message:
          "Classification decision does not match a queued dataset_id/version/category_type.",
        decision_index: index,
        decision_key: key,
      });
      continue;
    }
    if (decisionsByKey.has(key)) {
      blockers.push({
        code: "classification_decision_duplicate",
        message: "More than one decision targets the same queue row.",
        decision_index: index,
        decision_key: key,
      });
      continue;
    }
    decisionsByKey.set(key, { ...decision, category_type: schemaType });
  }
  for (const row of queueRows) {
    const key = classificationQueueTargetKey(row);
    if (!decisionsByKey.has(key)) {
      blockers.push({
        code: "classification_queue_item_unclosed",
        message: "Every classification queue row must be closed by one decision.",
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        schema_type: classificationQueueSchemaType(row),
      });
    }
  }
  return { blockers, decisionsByKey };
}

function outputRowsForClassificationGroup(rows, outDir, inputRows, options) {
  if (options.out && rows.length > 0) return resolveRepoPath(options.out);
  const outputRows = unique(rows.map(classificationQueueOutputRows)).filter(
    Boolean,
  );
  if (outputRows.length === 1) return resolveRepoPath(outputRows[0]);
  const inputBase = path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "");
  return path.join(outDir, "rows", `${inputBase}.classified.jsonl`);
}

function runDatasetClassificationDecisionsApply(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
	      command: "dataset-classification-decisions-apply",
	      wraps: "tiangong-lca dataset classification apply",
	      usage: [
	        "node scripts/foundry.mjs dataset-classification-decisions-apply --classification-queue <classification-authoring-queue.jsonl> --decisions <classification-decisions.jsonl> --decision-task <classification-decision-task.json> --out-dir <apply-dir>",
	      ],
	      purpose:
	        "Validate AI-authored classification decisions against the Foundry queue and AI context task, then call the CLI classification apply command for each required schema type and row file.",
	    };
	  }

  const queuePath = resolveRepoPath(
    options.classificationQueue || options.queue,
  );
  const decisionsPath = resolveRepoPath(
    options.decisions || options.decisionFile || options.input,
  );
  if (!queuePath || !fileExists(queuePath)) {
    throw new Error(
      "--classification-queue is required and must point to classification-authoring-queue.jsonl.",
    );
  }
  if (!decisionsPath || !fileExists(decisionsPath)) {
    throw new Error(
      "--decisions is required and must point to JSON/JSONL decisions.",
    );
  }
  const outDir = resolveRepoPath(
    options.outDir || ".foundry/workspaces/classification-decisions-apply",
  );
	  const reportPath = path.join(outDir, "classification-decisions-apply-report.json");
	  const queueRows = readJsonOrJsonLines(queuePath);
	  const decisions = readJsonOrJsonLines(decisionsPath);
  const decisionTaskProofs = readDecisionTaskProofs(
    options,
    "classification",
    queuePath,
  );
  const decisionTaskProof =
    decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null;
  const { blockers, decisionsByKey } = validateClassificationDecisionsForQueue(
    queueRows,
    decisions,
    { decisionTaskProof: decisionTaskProofs, decisionKind: "classification" },
	  );
  const stages = [];
  const inputRowsFiles = [];
  const outputRows = [];

  if (blockers.length === 0 && queueRows.length > 0) {
    const queueRowsByInput = new Map();
    for (const row of queueRows) {
      const inputRows = resolveRepoPath(
        options.rowsFile ||
          options.inputRows ||
          classificationQueueInputRows(row),
      );
      if (!inputRows || !fileExists(inputRows)) {
        blockers.push({
          code: "classification_input_rows_missing",
          message: "Queued classification workflow input rows file is missing.",
          dataset_id: row.dataset_id,
          schema_type: classificationQueueSchemaType(row),
          input_rows: classificationQueueInputRows(row),
        });
        continue;
      }
      const key = repoRelativePath(inputRows);
      const group = queueRowsByInput.get(key) ?? {
        inputRows,
        rows: [],
      };
      group.rows.push(row);
      queueRowsByInput.set(key, group);
    }

    for (const group of queueRowsByInput.values()) {
      const finalOutputRows = outputRowsForClassificationGroup(
        group.rows,
        outDir,
        group.inputRows,
        options,
      );
      inputRowsFiles.push(repoRelativePath(group.inputRows));
      const schemaTypes = unique(group.rows.map(classificationQueueSchemaType));
      let currentInput = group.inputRows;
      for (const [index, schemaType] of schemaTypes.entries()) {
        const groupRowsForSchema = group.rows.filter(
          (row) => classificationQueueSchemaType(row) === schemaType,
        );
        const groupDecisions = groupRowsForSchema.map((row) =>
          decisionsByKey.get(classificationQueueTargetKey(row)),
        );
        const decisionFile = path.join(
          outDir,
          "decisions",
          `${schemaType}-classification-decisions.jsonl`,
        );
        const isLast = index === schemaTypes.length - 1;
        const stageOutputRows = isLast
          ? finalOutputRows
          : path.join(
              outDir,
              "intermediate",
              `${path.basename(group.inputRows).replace(/\.(jsonl|json)$/iu, "")}.${schemaType}.jsonl`,
            );
        fs.mkdirSync(path.dirname(decisionFile), { recursive: true });
        fs.mkdirSync(path.dirname(stageOutputRows), { recursive: true });
        writeJsonLines(decisionFile, groupDecisions);
        const stage = runTiangongJsonStage(
          `classification_apply_${schemaType}`,
          [
            "dataset",
            "classification",
            "apply",
            "--input",
            currentInput,
            "--decisions",
            decisionFile,
            "--out",
            stageOutputRows,
            "--type",
            schemaType,
            "--out-dir",
            path.join(outDir, "classification", schemaType),
            "--json",
          ],
        );
        stage.report_file = resolveRepoPath(stage.report?.files?.report);
        stages.push(stage);
        if (stage.exit_code !== 0) {
          blockers.push({
            code: "classification_apply_stage_failed",
            message: `CLI classification apply failed for ${schemaType}.`,
            schema_type: schemaType,
            exit_code: stage.exit_code,
            report_file: repoRelativeMaybe(stage.report_file),
          });
          break;
        }
        currentInput = stageOutputRows;
      }
      outputRows.push(repoRelativePath(finalOutputRows));
    }
  }

  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length > 0 ? "blocked" : "completed",
	    command: "dataset-classification-decisions-apply",
	    classification_queue: repoRelativePath(queuePath),
	    decisions_file: repoRelativePath(decisionsPath),
    decision_task: decisionTaskReportPayload(decisionTaskProof),
    decision_tasks: decisionTaskProofs.map(decisionTaskReportPayload),
	    counts: {
	      queue_rows: queueRows.length,
	      decisions: decisions.length,
      stages: stages.length,
      applied: stages.reduce(
        (total, stage) => total + Number(stage.report?.counts?.applied ?? 0),
        0,
      ),
      blockers: blockers.length,
    },
    blockers,
    stages: stages.map(compactStageReport),
    files: {
      report: repoRelativePath(reportPath),
      input_rows: unique(inputRowsFiles),
      output_rows: outputRows,
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(reportPath, report);
  return report;
}

function locationQueueInputRows(row) {
  return asText(row?.location_workflow?.commands?.input_rows);
}

function locationQueueOutputRows(row) {
  return asText(row?.location_workflow?.commands?.output_rows);
}

function locationQueueTargetKey(row) {
  return `location::${asText(row?.dataset_id)}::${asText(
    row?.dataset_version,
  )}::${asText(row?.path)}`;
}

function locationDecisionTargetPath(decision) {
  return asText(
    decision?.target_path ??
      decision?.targetPath ??
      decision?.location_path ??
      decision?.locationPath ??
      decision?.path,
  );
}

function locationDecisionTargetKey(decision) {
  return `location::${asText(
    decision?.dataset_id ?? decision?.datasetId ?? decision?.id,
  )}::${asText(
    decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version,
  )}::${locationDecisionTargetPath(decision)}`;
}

function buildLocationTaskInputRowLookup(queueRows) {
  const byInput = new Map();
  for (const queueRow of queueRows) {
    const inputRows = locationQueueInputRows(queueRow);
    if (!inputRows) continue;
    const resolved = resolveRepoPath(inputRows);
    if (!resolved || !fileExists(resolved)) continue;
    if (!byInput.has(resolved)) {
      byInput.set(resolved, readJsonOrJsonLines(resolved));
    }
  }
  const lookup = new Map();
  for (const [inputFile, rows] of byInput.entries()) {
    for (const queueRow of queueRows) {
      if (resolveRepoPath(locationQueueInputRows(queueRow)) !== inputFile) {
        continue;
      }
      const rowType = asText(queueRow.dataset_type);
      for (const [index, row] of rows.entries()) {
        const identity = datasetIdentity(row, rowType);
        if (
          identity.id === asText(queueRow.dataset_id) &&
          identity.version === asText(queueRow.dataset_version)
        ) {
          lookup.set(locationQueueTargetKey(queueRow), {
            index,
            row_type: rowType,
            dataset_id: identity.id,
            dataset_version: identity.version,
            input_rows: repoRelativePath(inputFile),
            payload: row,
          });
          break;
        }
      }
    }
  }
  return lookup;
}

function locationTaskEvidenceForQueueRow(row, index, rowLookup) {
  const inputRow = rowLookup.get(locationQueueTargetKey(row)) ?? null;
  return {
    source: "location-authoring-queue",
    queue_row_index: index,
    current_location: row.current_location ?? null,
    target_path: row.path ?? null,
    source_file: row.source_file ?? null,
    input_rows: locationQueueInputRows(row) || null,
    output_rows: locationQueueOutputRows(row) || null,
    input_row_index: inputRow?.index ?? null,
    input_row_identity: inputRow
      ? {
          dataset_id: inputRow.dataset_id,
          dataset_version: inputRow.dataset_version,
          row_type: inputRow.row_type,
        }
      : null,
    input_row_payload: inputRow?.payload ?? null,
  };
}

function buildLocationDecisionTemplateRows(
  queueRows,
  rowLookup = new Map(),
  contextBundle = null,
) {
  const authoringContext = contextBundle
    ? decisionAuthoringContext(contextBundle)
    : null;
  return queueRows.map((row, index) => ({
    dataset_id: row.dataset_id,
    dataset_version: row.dataset_version,
    category_type: "location",
    decision_status: "completed",
    code: "__AI_SELECT_TIDAS_LOCATION_CODE__",
    target_path: row.path,
    basis: "__AI_FILL_LOCATION_DECISION_BASIS__",
    used_context_kinds: ["__AI_FILL_USED_CONTEXT_KINDS__"],
    ...(authoringContext ? { authoring_context: authoringContext } : {}),
    evidence: locationTaskEvidenceForQueueRow(row, index, rowLookup),
  }));
}

function runDatasetLocationDecisionTaskBuild(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
	      command: "dataset-location-decision-task-build",
	      usage: [
	        "node scripts/foundry.mjs dataset-location-decision-task-build --location-queue <location-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
	      ],
      purpose:
        "Build an AI-facing location coding task from Foundry location queue rows. AI fills TIDAS location codes; deterministic apply is handled by dataset-location-decisions-apply.",
    };
  }

  const queuePath = resolveRepoPath(
    options.locationQueue || options.queue || options.input,
  );
  if (!queuePath || !fileExists(queuePath)) {
    throw new Error(
      "--location-queue is required and must point to location-authoring-queue.jsonl.",
    );
  }
  const outDir = resolveRepoPath(
    options.outDir || ".foundry/workspaces/location-decision-task",
  );
  const sharedContextCacheDir = resolveRepoPath(
    options.sharedContextCacheDir || options.contextCacheDir,
  );
  fs.mkdirSync(outDir, { recursive: true });
  const sourceQueueRows = readJsonOrJsonLines(queuePath);
  const useSelection = hasQueueSelectionOptions(options);
  const inputRowsOverride = decisionTaskInputRowsOverride(options);
  const shouldDeriveQueue = useSelection || Boolean(inputRowsOverride);
  let queueRows = sourceQueueRows;
  let taskQueuePath = queuePath;
  let selection = {
    source_queue_rows: sourceQueueRows.length,
    matched_queue_rows: sourceQueueRows.length,
    selected_queue_rows: sourceQueueRows.length,
    source_queue_row_indices: sourceQueueRows.map((_, index) => index),
  };
  if (shouldDeriveQueue) {
    const selected = useSelection
      ? selectDecisionTaskQueueRows(
          sourceQueueRows,
          options,
          () => "location",
        )
      : {
          selection,
          selected: sourceQueueRows.map((row, sourceIndex) => ({
            row,
            sourceIndex,
          })),
        };
    selection = {
      ...selected.selection,
      input_rows_override: inputRowsOverride
        ? repoRelativePath(inputRowsOverride)
        : null,
    };
    const chunkLabel = decisionTaskChunkLabel(
      options,
      selection,
      inputRowsOverride ? "location-current-rows" : "location-chunk",
    );
    queueRows = rewriteDecisionTaskQueueRowsForChunk({
      selected: selected.selected,
      sourceQueuePath: queuePath,
      outDir,
      chunkLabel,
      workflowKey: "location_workflow",
      outputSuffix: "located",
      inputRowsForRow: locationQueueInputRows,
      inputRowsOverride,
    });
    selection.chunk_label = chunkLabel;
    taskQueuePath = path.join(
      outDir,
      `location-authoring-queue.${chunkLabel}.jsonl`,
    );
    writeJsonLines(taskQueuePath, queueRows);
  }
  const rowLookup = buildLocationTaskInputRowLookup(queueRows);
  const templatePath = path.join(outDir, "location-decisions.template.jsonl");
  const taskPath = path.join(outDir, "location-decision-task.json");
  const reportPath = path.join(outDir, "location-decision-task-report.json");
  const decisionFile = path.join(outDir, "location-decisions.jsonl");
  const contractContext = buildClassificationDecisionTaskContextFiles(options);
  const provenanceContext = buildClassificationTaskProvenanceContext(queuePath);
  const attachedInputRows = [...rowLookup.values()];
  const contextBundle = buildDecisionTaskContextBundle({
    taskKind: "location_decision_authoring",
    taskPath,
    outDir,
    sharedContextCacheDir,
    queuePath: taskQueuePath,
    queueRows,
    contractContext,
    provenanceContext,
    attachedInputRows,
  });
  const templateRows = buildLocationDecisionTemplateRows(
    queueRows,
    rowLookup,
    contextBundle,
  );
  const queueRowsWithAttachedInput = templateRows.filter(
    (row) => row.evidence?.input_row_payload,
  ).length;
  const blockers = decisionTaskContextBlockers({
    kind: "location",
    queueRows,
    contractContext,
    requiredContextKinds: [
      "schema",
      "methodology_yaml",
      "ruleset",
      "location_schema",
    ],
    attachedInputRowCount: queueRowsWithAttachedInput,
  });
  const datasetTypes = unique(queueRows.map((row) => asText(row.dataset_type)));
  const task = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: decisionTaskBuildStatus({
      queueRows,
      blockers,
      readyStatus: "ready_for_ai_location_decisions",
      emptyStatus: "ready_no_location_actions",
    }),
    task_kind: "location_decision_authoring",
    location_queue: repoRelativePath(taskQueuePath),
    counts: {
      queue_rows: queueRows.length,
      template_decisions: templateRows.length,
      dataset_types: datasetTypes.length,
      contract_context_files: contractContext.files.length,
      missing_context_files: contractContext.missing.length,
      attached_input_rows: queueRowsWithAttachedInput,
      unique_attached_input_rows: attachedInputRows.length,
      missing_input_row_payloads: queueRows.length - queueRowsWithAttachedInput,
      provenance_context_files: [
        provenanceContext.source_semantics.file,
        provenanceContext.process_source_references.file,
        provenanceContext.source_reference_rewrites.file,
      ].filter(Boolean).length,
      blockers: blockers.length,
    },
    blockers,
    dataset_types: datasetTypes,
    selection,
    source_location_queue: shouldDeriveQueue ? repoRelativePath(queuePath) : null,
    location_queue_rows: queueRows,
    attached_input_rows: attachedInputRows,
    provenance_context: provenanceContext,
    context_bundle: contextBundle,
    shared_context_bundle: contextBundle.shared_context_bundle,
    context_files: contractContext.files.map((file) => file.path),
    contract_context_files: contractContext.files.map(
      decisionTaskContextFileSummary,
    ),
    missing_context_files: contractContext.missing,
    instructions: [
      "Read shared_context_bundle once for full Foundry/SDK schema, methodology YAML, runtime ruleset, tidas_locations_category.json text, then use this task's queue rows, attached payloads, provenance, and source trace before choosing location codes.",
      "Replace each template code with a valid TIDAS location code; keep source location text as evidence, not target code.",
      "Every decision must include dataset_id, dataset_version, category_type=location, code, target_path, basis, used_context_kinds, and structured evidence.",
      "Do not write row JSON directly; run dataset-location-decisions-apply after decisions are complete.",
    ],
    files: {
      task: repoRelativePath(taskPath),
      template: repoRelativePath(templatePath),
      expected_decisions: repoRelativePath(decisionFile),
      report: repoRelativePath(reportPath),
      shared_context_bundle: contextBundle.shared_context_bundle.path,
    },
    commands: {
      apply_decisions: [
        process.execPath,
        path.join(repoRoot, "scripts", "foundry.mjs"),
        "dataset-location-decisions-apply",
        "--location-queue",
        taskQueuePath,
        "--decisions",
        decisionFile,
        "--decision-task",
        taskPath,
        "--out-dir",
        path.join(outDir, "apply"),
      ]
        .map(shellQuote)
        .join(" "),
    },
  };
  writeJsonLines(templatePath, templateRows);
  writeJson(taskPath, task);
  writeJson(reportPath, task);
  return task;
}

function validateLocationDecisionsForQueue(
  queueRows,
  decisions,
  { decisionTaskProof = null } = {},
) {
  const blockers = [];
  const decisionTaskProofs = decisionTaskProofList(decisionTaskProof);
  for (const proof of decisionTaskProofs) {
    blockers.push(...proof.blockers);
  }
  const contextBundleHashes =
    decisionTaskContextBundleHashes(decisionTaskProofs);
  const queueByKey = new Map(queueRows.map((row) => [locationQueueTargetKey(row), row]));
  const decisionsByKey = new Map();
  for (const [index, decision] of decisions.entries()) {
    const key = locationDecisionTargetKey(decision);
    if (hasUnresolvedAiPlaceholder(decision)) {
      blockers.push({
        code: "location_decision_template_incomplete",
        message: "Location decision still contains an AI placeholder.",
        decision_index: index,
      });
      continue;
    }
    if (decisionCompletionStatus(decision) !== "completed") {
      blockers.push({
        code: "location_decision_status_not_completed",
        message:
          "Location decision must declare decision_status=completed before deterministic apply.",
        decision_index: index,
        decision_status: decisionCompletionStatus(decision) || null,
      });
    }
    if (classificationDecisionSchemaType(decision) !== "location") {
      blockers.push({
        code: "location_decision_schema_type_invalid",
        message: "Location decision must include category_type=location.",
        decision_index: index,
      });
    }
    if (!classificationDecisionCode(decision)) {
      blockers.push({
        code: "location_decision_code_missing",
        message: "Location decision must include a TIDAS location code.",
        decision_index: index,
      });
    }
    if (!locationDecisionTargetPath(decision)) {
      blockers.push({
        code: "location_decision_target_path_missing",
        message: "Location decision must include target_path.",
        decision_index: index,
      });
    }
    if (!asText(decision.basis)) {
      blockers.push({
        code: "location_decision_basis_missing",
        message: "Location decision must include basis.",
        decision_index: index,
      });
    }
    if (!decision.evidence || typeof decision.evidence !== "object") {
      blockers.push({
        code: "location_decision_evidence_missing",
        message: "Location decision must include structured evidence.",
        decision_index: index,
      });
    }
	    if (classificationDecisionUsedContextKinds(decision).length === 0) {
	      blockers.push({
        code: "location_decision_used_context_missing",
        message:
          "Location decision must include used_context_kinds so full-context AI evidence is auditable.",
        decision_index: index,
	      });
	    }
    if (contextBundleHashes.length > 0) {
	      const decisionBundleHash = decisionContextBundleSha256(decision);
	      if (!decisionBundleHash) {
	        blockers.push({
	          code: "location_decision_context_bundle_missing",
	          message:
	            "Location decision must include authoring_context.context_bundle_sha256 from the AI decision task template.",
	          decision_index: index,
          decision_tasks: decisionTaskProofs.map((proof) => proof.path),
	        });
      } else if (!contextBundleHashes.includes(decisionBundleHash)) {
	        blockers.push({
	          code: "location_decision_context_bundle_mismatch",
	          message:
	            "Location decision authoring context hash does not match the AI decision task context bundle.",
	          decision_index: index,
          expected_context_bundle_sha256:
            contextBundleHashes.length === 1 ? contextBundleHashes[0] : null,
          expected_context_bundle_sha256_any_of: contextBundleHashes,
	          actual_context_bundle_sha256: decisionBundleHash,
          decision_tasks: decisionTaskProofs.map((proof) => proof.path),
	        });
	      }
	    }
	    if (!queueByKey.has(key)) {
      blockers.push({
        code: "location_decision_not_in_queue",
        message:
          "Location decision does not match a queued dataset_id/version/target_path.",
        decision_index: index,
        decision_key: key,
      });
      continue;
    }
    if (decisionsByKey.has(key)) {
      blockers.push({
        code: "location_decision_duplicate",
        message: "More than one location decision targets the same queue row.",
        decision_index: index,
        decision_key: key,
      });
      continue;
    }
    decisionsByKey.set(key, { ...decision, category_type: "location" });
  }
  for (const row of queueRows) {
    const key = locationQueueTargetKey(row);
    if (!decisionsByKey.has(key)) {
      blockers.push({
        code: "location_queue_item_unclosed",
        message: "Every location queue row must be closed by one decision.",
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        path: row.path,
      });
    }
  }
  return { blockers, decisionsByKey };
}

function outputRowsForLocationGroup(rows, outDir, inputRows, options) {
  if (options.out && rows.length > 0) return resolveRepoPath(options.out);
  const outputRows = unique(rows.map(locationQueueOutputRows)).filter(Boolean);
  if (outputRows.length === 1) return resolveRepoPath(outputRows[0]);
  const inputBase = path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "");
  return path.join(outDir, "rows", `${inputBase}.located.jsonl`);
}

function runDatasetLocationDecisionsApply(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
	      command: "dataset-location-decisions-apply",
	      wraps: "tiangong-lca dataset classification apply --type location",
	      usage: [
	        "node scripts/foundry.mjs dataset-location-decisions-apply --location-queue <location-authoring-queue.jsonl> --decisions <location-decisions.jsonl> --decision-task <location-decision-task.json> --out-dir <apply-dir>",
	      ],
	      purpose:
	        "Validate AI-authored location decisions against the Foundry queue and AI context task, then call the CLI location classification apply command for each required row file.",
	    };
	  }

  const queuePath = resolveRepoPath(options.locationQueue || options.queue);
  const decisionsPath = resolveRepoPath(
    options.decisions || options.decisionFile || options.input,
  );
  if (!queuePath || !fileExists(queuePath)) {
    throw new Error(
      "--location-queue is required and must point to location-authoring-queue.jsonl.",
    );
  }
  if (!decisionsPath || !fileExists(decisionsPath)) {
    throw new Error(
      "--decisions is required and must point to JSON/JSONL location decisions.",
    );
  }
  const outDir = resolveRepoPath(
    options.outDir || ".foundry/workspaces/location-decisions-apply",
  );
	  const reportPath = path.join(outDir, "location-decisions-apply-report.json");
	  const queueRows = readJsonOrJsonLines(queuePath);
	  const decisions = readJsonOrJsonLines(decisionsPath);
  const decisionTaskProofs = readDecisionTaskProofs(options, "location", queuePath);
  const decisionTaskProof =
    decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null;
	  const { blockers, decisionsByKey } = validateLocationDecisionsForQueue(
	    queueRows,
	    decisions,
    { decisionTaskProof: decisionTaskProofs },
	  );
  const stages = [];
  const outputRows = [];

  if (blockers.length === 0 && queueRows.length > 0) {
    const queueRowsByInput = new Map();
    for (const row of queueRows) {
      const inputRows = resolveRepoPath(
        options.rowsFile || options.inputRows || locationQueueInputRows(row),
      );
      if (!inputRows || !fileExists(inputRows)) {
        blockers.push({
          code: "location_input_rows_missing",
          message: "Queued location workflow input rows file is missing.",
          dataset_id: row.dataset_id,
          input_rows: locationQueueInputRows(row),
        });
        continue;
      }
      const key = repoRelativePath(inputRows);
      const group = queueRowsByInput.get(key) ?? { inputRows, rows: [] };
      group.rows.push(row);
      queueRowsByInput.set(key, group);
    }

    for (const group of queueRowsByInput.values()) {
      const finalOutputRows = outputRowsForLocationGroup(
        group.rows,
        outDir,
        group.inputRows,
        options,
      );
      const groupDecisions = group.rows.map((row) =>
        decisionsByKey.get(locationQueueTargetKey(row)),
      );
      const decisionFile = path.join(
        outDir,
        "decisions",
        "location-decisions.jsonl",
      );
      fs.mkdirSync(path.dirname(decisionFile), { recursive: true });
      fs.mkdirSync(path.dirname(finalOutputRows), { recursive: true });
      writeJsonLines(decisionFile, groupDecisions);
      const stage = runTiangongJsonStage("location_apply", [
        "dataset",
        "classification",
        "apply",
        "--input",
        group.inputRows,
        "--decisions",
        decisionFile,
        "--out",
        finalOutputRows,
        "--type",
        "location",
        "--out-dir",
        path.join(outDir, "classification", "location"),
        "--json",
      ]);
      stage.report_file = resolveRepoPath(stage.report?.files?.report);
      stages.push(stage);
      if (stage.exit_code !== 0) {
        blockers.push({
          code: "location_apply_stage_failed",
          message: "CLI location apply failed.",
          exit_code: stage.exit_code,
          report_file: repoRelativeMaybe(stage.report_file),
        });
        break;
      }
      outputRows.push(repoRelativePath(finalOutputRows));
    }
  }

  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length > 0 ? "blocked" : "completed",
	    command: "dataset-location-decisions-apply",
	    location_queue: repoRelativePath(queuePath),
	    decisions_file: repoRelativePath(decisionsPath),
    decision_task: decisionTaskReportPayload(decisionTaskProof),
    decision_tasks: decisionTaskProofs.map(decisionTaskReportPayload),
	    counts: {
      queue_rows: queueRows.length,
      decisions: decisions.length,
      stages: stages.length,
      applied: stages.reduce(
        (total, stage) => total + Number(stage.report?.counts?.applied ?? 0),
        0,
      ),
      blockers: blockers.length,
    },
    blockers,
    stages: stages.map(compactStageReport),
    files: {
      report: repoRelativePath(reportPath),
      output_rows: outputRows,
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(reportPath, report);
  return report;
}

function foundryCommand(args) {
  return [process.execPath, path.join(repoRoot, "scripts", "foundry.mjs"), ...args]
    .map(shellQuote)
    .join(" ");
}

function authoringPlanWorkspaceDir(curationGateReportPath, options) {
  const explicit = resolveRepoPath(options.workspaceDir || options.workspace);
  if (explicit) return explicit;
  const curationDir = path.dirname(curationGateReportPath);
  return path.basename(curationDir) === "curation-gate"
    ? path.dirname(curationDir)
    : curationDir;
}

function existingArtifact(filePath) {
  const resolved = resolveRepoPath(filePath);
  if (!resolved || !fileExists(resolved)) return null;
  return { path: resolved, value: readJson(resolved) };
}

function artifactStatus(filePath) {
  const artifact = existingArtifact(filePath);
  if (!artifact) {
    return { exists: false, path: repoRelativeMaybe(resolveRepoPath(filePath)), status: "missing" };
  }
  return {
    exists: true,
    path: repoRelativePath(artifact.path),
    status: asText(artifact.value?.status) || "present",
    counts: artifact.value?.counts ?? null,
  };
}

function aiRowsFileStatus(filePath, { requireCompletedDecision = false } = {}) {
  const resolved = resolveRepoPath(filePath);
  if (!resolved || !fileExists(resolved)) {
    return {
      exists: false,
      path: resolved ? repoRelativePath(resolved) : null,
      status: "missing",
      rows: 0,
      placeholders: 0,
      incomplete_decisions: 0,
    };
  }
  const rows = readJsonOrJsonLines(resolved);
  const placeholders = rows.filter(hasUnresolvedAiPlaceholder).length;
  const incompleteDecisions = requireCompletedDecision
    ? rows.filter((row) => asText(row?.decision_status) !== "completed").length
    : 0;
  return {
    exists: true,
    path: repoRelativePath(resolved),
    status:
      rows.length === 0
        ? "empty"
        : placeholders > 0 || incompleteDecisions > 0
          ? "needs_ai_completion"
          : "ready_for_apply",
    rows: rows.length,
    placeholders,
    incomplete_decisions: incompleteDecisions,
  };
}

function authoringPlanContextPaths(curationGateReport) {
  const details = ensureArray(
    curationGateReport?.context?.contract_context_file_details,
  );
  const byKind = new Map();
  for (const detail of details) {
    const kind = asText(detail?.kind);
    const filePath = asText(detail?.path);
    if (!kind || !filePath) continue;
    const values = byKind.get(kind) ?? [];
    values.push(filePath);
    byKind.set(kind, values);
  }
  return {
    schema: byKind.get("schema")?.[0] ?? null,
    methodology_yaml: byKind.get("methodology_yaml")?.[0] ?? null,
    ruleset: byKind.get("ruleset")?.[0] ?? null,
    classification_schema: byKind.get("classification_schema") ?? [],
    location_schema: byKind.get("location_schema")?.[0] ?? null,
  };
}

function appendContextOptions(args, contextPaths) {
  appendOption(args, "--schema-file", contextPaths.schema);
  appendOption(args, "--yaml-file", contextPaths.methodology_yaml);
  appendOption(args, "--ruleset-file", contextPaths.ruleset);
  appendRepeatedOptions(args, "--classification-schema", contextPaths.classification_schema);
  appendOption(args, "--location-schema", contextPaths.location_schema);
}

function authoringPlanGateScope(curationGateReport) {
  const datasetType = asText(curationGateReport?.dataset_type);
  const entities = ensureArray(
    curationGateReport?.entities ??
      curationGateReport?.processes ??
      curationGateReport?.flows ??
      curationGateReport?.items,
  );
  return {
    dataset_type: datasetType,
    dataset_ids: unique(
      entities
        .map((entity) =>
          asText(
            entity?.entity_id ??
              entity?.dataset_id ??
              entity?.process_id ??
              entity?.flow_id,
          ),
        )
        .filter(Boolean),
    ),
  };
}

function appendAuthoringPlanGateScopeOptions(args, scope) {
  appendOption(args, "--dataset-type", scope?.dataset_type);
  appendRepeatedOptions(args, "--dataset-id", scope?.dataset_ids ?? []);
}

function authoringPlanScopedDecisionQueuePath({
  taskPath,
  taskQueueKey,
  originalQueue,
  scope,
  kind,
}) {
  const taskQueue = asText(existingArtifact(taskPath)?.value?.[taskQueueKey]);
  if (taskQueue) return taskQueue;
  if (scope?.dataset_type) {
    const selection = {
      dataset_types: [scope.dataset_type],
      category_types: [],
      bundle_ids: [],
    };
    const label = decisionTaskChunkLabel({}, selection, `${kind}-scope`);
    return repoRelativePath(
      path.join(
        path.dirname(resolveRepoPath(taskPath)),
        `${kind}-authoring-queue.${label}.jsonl`,
      ),
    );
  }
  return originalQueue;
}

function authoringPlanDefaultPaths(workspaceDir) {
  return {
    identityTask: path.join(workspaceDir, "identity-decision-task", "identity-decision-task.json"),
    identityDecisions: path.join(workspaceDir, "identity-decision-task", "identity-decisions.jsonl"),
    identityApplyReport: path.join(
      workspaceDir,
      "identity-decision-apply",
      "identity-decisions-apply-report.json",
    ),
    classificationTask: path.join(
      workspaceDir,
      "classification-decision-task",
      "classification-decision-task.json",
    ),
    classificationDecisions: path.join(
      workspaceDir,
      "classification-decision-task",
      "classification-decisions.jsonl",
    ),
    classificationApplyReport: path.join(
      workspaceDir,
      "classification-decision-apply",
      "classification-decisions-apply-report.json",
    ),
    locationTask: path.join(workspaceDir, "location-decision-task", "location-decision-task.json"),
    locationDecisions: path.join(workspaceDir, "location-decision-task", "location-decisions.jsonl"),
    locationApplyReport: path.join(
      workspaceDir,
      "location-decision-apply",
      "location-decisions-apply-report.json",
    ),
    authoringTaskManifest: path.join(workspaceDir, "authoring-tasks", "authoring-task-manifest.json"),
    patchCollectReport: path.join(
      workspaceDir,
      "authoring-tasks",
      "authoring-patch-collect-report.json",
    ),
    patchApplyReport: path.join(workspaceDir, "patch-apply", "dataset-patch-apply-report.json"),
  };
}

function authoringPlanApplyStatus(reportPath) {
  const artifact = artifactStatus(reportPath);
  return {
    ...artifact,
    completed: artifact.exists && artifact.status === "completed",
  };
}

function phaseStatusFromTaskDecision({
  required,
  taskPath,
  readyStatus,
  emptyStatus,
  decisionsPath,
  applyReportPath,
  applyReportPaths = null,
}) {
  if (!required) {
    return { status: "not_required", required: false };
  }
  const task = artifactStatus(taskPath);
  if (!task.exists) {
    return { status: "needs_task_build", required: true, task };
  }
  if (task.status === emptyStatus) {
    return { status: "completed_no_actions", required: true, task };
  }
  if (task.status !== readyStatus) {
    return { status: "blocked_task_not_ready", required: true, task };
  }
  const decisions = aiRowsFileStatus(decisionsPath, {
    requireCompletedDecision: true,
  });
  if (decisions.status !== "ready_for_apply") {
    return { status: "ready_for_ai_decisions", required: true, task, decisions };
  }
  const applyReports = (applyReportPaths ?? [applyReportPath]).map(
    authoringPlanApplyStatus,
  );
  if (!applyReports.every((report) => report.completed)) {
    return {
      status: "needs_deterministic_apply",
      required: true,
      task,
      decisions,
      apply_report: applyReports.length === 1 ? applyReports[0] : null,
      apply_reports: applyReports,
    };
  }
  return {
    status: "completed",
    required: true,
    task,
    decisions,
    apply_report: applyReports.length === 1 ? applyReports[0] : null,
    apply_reports: applyReports,
  };
}

function phaseStatusFromPatchAuthoring({
  required,
  manifestPath,
  patchCollectReportPath,
  patchApplyReportPath,
}) {
  if (!required) {
    return { status: "not_required", required: false };
  }
  const manifest = artifactStatus(manifestPath);
  if (!manifest.exists) {
    return { status: "needs_task_build", required: true, manifest };
  }
  if (manifest.status === "ready_no_action_items") {
    return { status: "completed_no_actions", required: true, manifest };
  }
  if (manifest.status !== "ready_for_ai_authoring_batch") {
    return { status: "blocked_task_not_ready", required: true, manifest };
  }
  const collect = artifactStatus(patchCollectReportPath);
  if (!collect.exists || collect.status === "blocked") {
    return {
      status: "ready_for_ai_patches",
      required: true,
      manifest,
      patch_collect_report: collect,
    };
  }
  if (collect.status !== "ready_for_patch_apply") {
    return {
      status: "blocked_patch_collect_not_ready",
      required: true,
      manifest,
      patch_collect_report: collect,
    };
  }
  const applyReport = authoringPlanApplyStatus(patchApplyReportPath);
  if (!applyReport.completed) {
    return {
      status: "needs_deterministic_apply",
      required: true,
      manifest,
      patch_collect_report: collect,
      patch_apply_report: applyReport,
    };
  }
  return {
    status: "completed",
    required: true,
    manifest,
    patch_collect_report: collect,
    patch_apply_report: applyReport,
  };
}

function authoringPlanOverallStatus(phases) {
  const required = phases.filter((phase) => phase.required);
  if (required.length === 0) return "ready_no_authoring_actions";
  if (required.some((phase) => phase.status === "blocked_task_not_ready")) {
    return "blocked_task_not_ready";
  }
  if (required.some((phase) => phase.status === "blocked_patch_collect_not_ready")) {
    return "blocked_patch_collect_not_ready";
  }
  if (required.some((phase) => phase.status === "needs_task_build")) {
    return "needs_task_build";
  }
  if (
    required.some((phase) =>
      ["ready_for_ai_decisions", "ready_for_ai_patches"].includes(phase.status),
    )
  ) {
    return "ready_for_ai_authoring";
  }
  if (required.some((phase) => phase.status === "needs_deterministic_apply")) {
    return "needs_deterministic_apply";
  }
  return "ready_for_post_authoring_finalize";
}

function authoringPlanChunkSize(options, kind) {
  return (
    positiveIntegerOption(options[`${kind}ChunkSize`], null) ??
    positiveIntegerOption(options.decisionChunkSize, null) ??
    25
  );
}

function authoringPlanDecisionRows(taskPath, key) {
  const task = existingArtifact(taskPath)?.value;
  return ensureArray(task?.[key]);
}

function groupedRowsByDatasetType(rows) {
  const groups = new Map();
  for (const row of rows) {
    const datasetType = asText(row?.dataset_type) || "all";
    const current = groups.get(datasetType) ?? [];
    current.push(row);
    groups.set(datasetType, current);
  }
  return [...groups.entries()].map(([datasetType, groupRows]) => ({
    dataset_type: datasetType,
    rows: groupRows,
  }));
}

function authoringPlanDecisionChunkPlan({
  kind,
  rows,
  chunkSize,
  buildArgsForChunk,
}) {
  if (rows.length === 0) {
    return {
      recommended: false,
      chunk_size: chunkSize,
      chunks: 0,
      commands: [],
    };
  }
  const commands = [];
  for (const group of groupedRowsByDatasetType(rows)) {
    for (let offset = 0; offset < group.rows.length; offset += chunkSize) {
      const selectedRows = group.rows.slice(offset, offset + chunkSize);
      const chunkLabel = safeFileToken(
        `${kind}-${group.dataset_type}-${offset}-${offset + selectedRows.length}`,
        `${kind}-chunk-${commands.length + 1}`,
      );
      commands.push({
        dataset_type: group.dataset_type,
        offset,
        limit: chunkSize,
        selected_rows: selectedRows.length,
        chunk_label: chunkLabel,
        command: foundryCommand(
          buildArgsForChunk({
            datasetType: group.dataset_type,
            offset,
            limit: chunkSize,
            chunkLabel,
          }),
        ),
      });
    }
  }
  return {
    recommended: rows.length > chunkSize,
    chunk_size: chunkSize,
    rows: rows.length,
    chunks: commands.length,
    commands,
  };
}

function authoringPlanIdentityDatasetTypes(taskPath, curationGateReport) {
  const task = existingArtifact(taskPath)?.value;
  const taskTypes = normalizedList(task?.dataset_types ?? task?.datasetTypes);
  if (taskTypes.length > 0) return taskTypes;
  const reportType = asText(curationGateReport?.dataset_type);
  return reportType ? [reportType] : ["<flow-or-process>"];
}

function authoringPlanRowsFileForDatasetType(datasetType, workspaceDir, curationGateReport) {
  const reportType = asText(curationGateReport?.dataset_type).toLowerCase();
  const normalizedType = asText(datasetType).toLowerCase();
  if (normalizedType && normalizedType === reportType && curationGateReport?.rows_file) {
    return curationGateReport.rows_file;
  }
  const queueManifest = existingArtifact(
    curationGateReport?.context?.curation_queue?.manifest_file,
  )?.value;
  const queueInput = asText(
    {
      process: queueManifest?.inputs?.processes,
      flow: queueManifest?.inputs?.flows,
      support: ensureArray(queueManifest?.inputs?.support)[0],
    }[normalizedType],
  );
  if (queueInput) {
    const resolved = resolveRepoPath(queueInput);
    return resolved ? repoRelativePath(resolved) : queueInput;
  }
  if (!normalizedType || normalizedType.startsWith("<")) {
    return "<rows-file-containing-identity-targets>";
  }
  return repoRelativePath(
    path.join(workspaceDir, "rows", `${datasetRowsFileStem(normalizedType)}.jsonl`),
  );
}

function authoringPlanAuthoringPackageDir(curationGateReport) {
  const packageDirs = unique(
    ensureArray(
      curationGateReport?.entities ??
        curationGateReport?.processes ??
        curationGateReport?.flows ??
        curationGateReport?.items,
    )
      .map((entity) => asText(entity?.authoring_package ?? entity?.authoringPackage))
      .filter(Boolean)
      .map((packageRef) => path.dirname(packageRef)),
  );
  return packageDirs.length === 1 ? packageDirs[0] : null;
}

function authoringPlanIdentityApplyReports(workspaceDir, datasetTypes, explicitReportPath) {
  if (explicitReportPath && datasetTypes.length <= 1) return [explicitReportPath];
  if (datasetTypes.length <= 1) {
    return [
      path.join(
        workspaceDir,
        "identity-decision-apply",
        "identity-decisions-apply-report.json",
      ),
    ];
  }
  return datasetTypes.map((datasetType) =>
    path.join(
      workspaceDir,
      "identity-decision-apply",
      datasetType,
      "identity-decisions-apply-report.json",
    ),
  );
}

function authoringPlanIdentityApplyCommands({
  workspaceDir,
  curationGateReport,
  datasetTypes,
  decisionsPath,
  applyReportPaths,
  authoringPackageDir,
}) {
  return datasetTypes.map((datasetType, index) => {
    const reportPath = applyReportPaths[index];
    const rowsFile = authoringPlanRowsFileForDatasetType(
      datasetType,
      workspaceDir,
      curationGateReport,
    );
    const args = [
      "dataset-identity-decisions-apply",
      "--type",
      datasetType,
      "--rows-file",
      rowsFile,
      "--decisions",
      decisionsPath,
      "--out-dir",
      path.dirname(reportPath),
    ];
    appendOption(args, "--authoring-package-dir", authoringPackageDir);
    return {
      dataset_type: datasetType,
      rows_file: rowsFile,
      authoring_package_dir: authoringPackageDir,
      command: foundryCommand(args),
    };
  });
}

function runDatasetAuthoringPlan(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-authoring-plan",
      usage: [
        "node scripts/foundry.mjs dataset-authoring-plan --curation-gate-report <dataset-curation-gate-report.json> --out-dir <plan-dir>",
      ],
      purpose:
        "Summarize the next required AI authoring, deterministic apply, and post-authoring validation steps from a Foundry curation gate report. This command never writes the database.",
    };
  }

  const curationGateReportPath = resolveRepoPath(
    options.curationGateReport || options.report || options.input,
  );
  if (!curationGateReportPath || !fileExists(curationGateReportPath)) {
    throw new Error(
      "--curation-gate-report is required and must point to dataset-curation-gate-report.json.",
    );
  }
  const curationGateReport = readJson(curationGateReportPath);
  const workspaceDir = authoringPlanWorkspaceDir(curationGateReportPath, options);
  const defaults = authoringPlanDefaultPaths(workspaceDir);
  const outDir = resolveRepoPath(options.outDir || path.join(workspaceDir, "authoring-plan"));
  const contextPaths = authoringPlanContextPaths(curationGateReport);
  const classificationQueue = asText(
    curationGateReport?.context?.classification_queue?.queue_file,
  );
  const locationQueue = asText(curationGateReport?.context?.location_queue?.queue_file);
  const counts = curationGateReport.counts ?? {};
  const gateScope = authoringPlanGateScope(curationGateReport);
  const classificationRows = Number(
    counts.classification_queue_action_items ??
      curationGateReport?.context?.classification_queue?.rows ??
      0,
  );
  const locationRows = Number(
    counts.location_queue_action_items ??
      curationGateReport?.context?.location_queue?.rows ??
      0,
  );
  const identityActionItems = Number(counts.identity_action_items ?? 0);
  const fieldActionItems = Math.max(
    0,
    Number(counts.action_items ?? 0) -
      identityActionItems -
      Number(counts.classification_queue_action_items ?? 0) -
      Number(counts.location_queue_action_items ?? 0),
  );

  const identityTaskPath = resolveRepoPath(
    options.identityDecisionTask || options.identityTask || defaults.identityTask,
  );
  const identityDecisionsPath = resolveRepoPath(
    options.identityDecisions || defaults.identityDecisions,
  );
  const explicitIdentityApplyReportPath = resolveRepoPath(
    options.identityDecisionApplyReport || options.identityApplyReport,
  );
  const classificationTaskPath = resolveRepoPath(
    options.classificationDecisionTask || options.classificationTask || defaults.classificationTask,
  );
  const classificationDecisionsPath = resolveRepoPath(
    options.classificationDecisions || defaults.classificationDecisions,
  );
  const classificationApplyReportPath = resolveRepoPath(
    options.classificationDecisionApplyReport ||
      options.classificationApplyReport ||
      defaults.classificationApplyReport,
  );
  const locationTaskPath = resolveRepoPath(
    options.locationDecisionTask || options.locationTask || defaults.locationTask,
  );
  const locationDecisionsPath = resolveRepoPath(
    options.locationDecisions || defaults.locationDecisions,
  );
  const locationApplyReportPath = resolveRepoPath(
    options.locationDecisionApplyReport || options.locationApplyReport || defaults.locationApplyReport,
  );
  const authoringTaskManifestPath = resolveRepoPath(
    options.authoringTaskManifest || options.taskManifest || defaults.authoringTaskManifest,
  );
  const patchCollectReportPath = resolveRepoPath(
    options.patchCollectReport || defaults.patchCollectReport,
  );
  const patchApplyReportPath = resolveRepoPath(
    options.patchApplyReport || defaults.patchApplyReport,
  );
  const identityDatasetTypes = authoringPlanIdentityDatasetTypes(
    identityTaskPath,
    curationGateReport,
  );
  const identityApplyReportPaths = authoringPlanIdentityApplyReports(
    workspaceDir,
    identityDatasetTypes,
    explicitIdentityApplyReportPath,
  );
  const authoringPackageDir = authoringPlanAuthoringPackageDir(
    curationGateReport,
  );
  const identityApplyCommands = authoringPlanIdentityApplyCommands({
    workspaceDir,
    curationGateReport,
    datasetTypes: identityDatasetTypes,
    decisionsPath: identityDecisionsPath,
    applyReportPaths: identityApplyReportPaths,
    authoringPackageDir,
  });
  const identityChunkSize = authoringPlanChunkSize(options, "identity");
  const classificationChunkSize = authoringPlanChunkSize(
    options,
    "classification",
  );
  const locationChunkSize = authoringPlanChunkSize(options, "location");
  const sharedContextCacheDir = resolveRepoPath(
    options.sharedContextCacheDir ||
      options.contextCacheDir ||
      path.join(workspaceDir, "shared-context-cache"),
  );
  const sharedContextCacheDirRef = repoRelativePath(sharedContextCacheDir);

  const identityBuildArgs = [
    "dataset-identity-decision-task-build",
    "--curation-gate-report",
    curationGateReportPath,
    "--shared-context-cache-dir",
    sharedContextCacheDirRef,
    "--out-dir",
    path.dirname(identityTaskPath),
  ];

  const classificationBuildArgs = [
    "dataset-classification-decision-task-build",
    "--classification-queue",
    classificationQueue || "<classification-authoring-queue.jsonl>",
  ];
  appendAuthoringPlanGateScopeOptions(classificationBuildArgs, gateScope);
  appendContextOptions(classificationBuildArgs, contextPaths);
  appendOption(
    classificationBuildArgs,
    "--shared-context-cache-dir",
    sharedContextCacheDirRef,
  );
  classificationBuildArgs.push("--out-dir", path.dirname(classificationTaskPath));

  const locationBuildArgs = [
    "dataset-location-decision-task-build",
    "--location-queue",
    locationQueue || "<location-authoring-queue.jsonl>",
  ];
  appendAuthoringPlanGateScopeOptions(locationBuildArgs, gateScope);
  appendContextOptions(locationBuildArgs, contextPaths);
  appendOption(
    locationBuildArgs,
    "--shared-context-cache-dir",
    sharedContextCacheDirRef,
  );
  locationBuildArgs.push("--out-dir", path.dirname(locationTaskPath));
  const classificationApplyQueue = authoringPlanScopedDecisionQueuePath({
    taskPath: classificationTaskPath,
    taskQueueKey: "classification_queue",
    originalQueue: classificationQueue || "<classification-authoring-queue.jsonl>",
    scope: gateScope,
    kind: "classification",
  });
  const locationApplyQueue = authoringPlanScopedDecisionQueuePath({
    taskPath: locationTaskPath,
    taskQueueKey: "location_queue",
    originalQueue: locationQueue || "<location-authoring-queue.jsonl>",
    scope: gateScope,
    kind: "location",
  });
  const scopedApplyRowsFile = gateScope.dataset_type
    ? authoringPlanRowsFileForDatasetType(
        gateScope.dataset_type,
        workspaceDir,
        curationGateReport,
      )
    : null;

  const identityPhase = {
    phase: "identity_decisions",
    action_items: identityActionItems,
    ...phaseStatusFromTaskDecision({
      required: identityActionItems > 0,
      taskPath: identityTaskPath,
      readyStatus: "ready_for_ai_identity_decisions",
      emptyStatus: "ready_no_identity_actions",
      decisionsPath: identityDecisionsPath,
      applyReportPaths: identityApplyReportPaths,
    }),
    dataset_types: identityDatasetTypes,
    chunk_plan: authoringPlanDecisionChunkPlan({
      kind: "identity",
      rows: authoringPlanDecisionRows(identityTaskPath, "identity_action_items"),
      chunkSize: identityChunkSize,
      buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => [
        "dataset-identity-decision-task-build",
        "--curation-gate-report",
        curationGateReportPath,
        "--dataset-type",
        datasetType,
        "--limit",
        limit,
        "--offset",
        offset,
        "--chunk-label",
        chunkLabel,
        "--shared-context-cache-dir",
        sharedContextCacheDirRef,
        "--out-dir",
        path.join(path.dirname(identityTaskPath), "chunks", chunkLabel),
      ],
    }),
    commands: {
      build_task: foundryCommand(identityBuildArgs),
      apply_decisions:
        identityApplyCommands.length === 1 ? identityApplyCommands[0].command : null,
      apply_decisions_by_type: identityApplyCommands,
    },
  };
  const classificationPhase = {
    phase: "classification_decisions",
    queue_rows: classificationRows,
    ...phaseStatusFromTaskDecision({
      required: classificationRows > 0,
      taskPath: classificationTaskPath,
      readyStatus: "ready_for_ai_classification_decisions",
      emptyStatus: "ready_no_classification_actions",
      decisionsPath: classificationDecisionsPath,
      applyReportPath: classificationApplyReportPath,
    }),
    chunk_plan: authoringPlanDecisionChunkPlan({
      kind: "classification",
      rows: authoringPlanDecisionRows(
        classificationTaskPath,
        "classification_queue_rows",
      ),
      chunkSize: classificationChunkSize,
      buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => {
        const args = [
          "dataset-classification-decision-task-build",
          "--classification-queue",
          classificationQueue || "<classification-authoring-queue.jsonl>",
          "--dataset-type",
          datasetType,
          "--limit",
          limit,
          "--offset",
          offset,
          "--chunk-label",
          chunkLabel,
        ];
        appendContextOptions(args, contextPaths);
        appendOption(args, "--shared-context-cache-dir", sharedContextCacheDirRef);
        args.push(
          "--out-dir",
          path.join(path.dirname(classificationTaskPath), "chunks", chunkLabel),
        );
        return args;
      },
    }),
    commands: {
      build_task: foundryCommand(classificationBuildArgs),
      apply_decisions: foundryCommand([
        "dataset-classification-decisions-apply",
        "--classification-queue",
        classificationApplyQueue,
        "--decisions",
        classificationDecisionsPath,
        "--decision-task",
        classificationTaskPath,
        ...(scopedApplyRowsFile ? ["--rows-file", scopedApplyRowsFile] : []),
        "--out-dir",
        path.dirname(classificationApplyReportPath),
      ]),
    },
  };
  const locationPhase = {
    phase: "location_decisions",
    queue_rows: locationRows,
    ...phaseStatusFromTaskDecision({
      required: locationRows > 0,
      taskPath: locationTaskPath,
      readyStatus: "ready_for_ai_location_decisions",
      emptyStatus: "ready_no_location_actions",
      decisionsPath: locationDecisionsPath,
      applyReportPath: locationApplyReportPath,
    }),
    chunk_plan: authoringPlanDecisionChunkPlan({
      kind: "location",
      rows: authoringPlanDecisionRows(locationTaskPath, "location_queue_rows"),
      chunkSize: locationChunkSize,
      buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => {
        const args = [
          "dataset-location-decision-task-build",
          "--location-queue",
          locationQueue || "<location-authoring-queue.jsonl>",
          "--dataset-type",
          datasetType,
          "--limit",
          limit,
          "--offset",
          offset,
          "--chunk-label",
          chunkLabel,
        ];
        appendContextOptions(args, contextPaths);
        appendOption(args, "--shared-context-cache-dir", sharedContextCacheDirRef);
        args.push(
          "--out-dir",
          path.join(path.dirname(locationTaskPath), "chunks", chunkLabel),
        );
        return args;
      },
    }),
    commands: {
      build_task: foundryCommand(locationBuildArgs),
      apply_decisions: foundryCommand([
        "dataset-location-decisions-apply",
        "--location-queue",
        locationApplyQueue,
        "--decisions",
        locationDecisionsPath,
        "--decision-task",
        locationTaskPath,
        ...(scopedApplyRowsFile ? ["--rows-file", scopedApplyRowsFile] : []),
        "--out-dir",
        path.dirname(locationApplyReportPath),
      ]),
    },
  };
  const patchPhase = {
    phase: "field_patches",
    action_items: fieldActionItems,
    ...phaseStatusFromPatchAuthoring({
      required: fieldActionItems > 0,
      manifestPath: authoringTaskManifestPath,
      patchCollectReportPath,
      patchApplyReportPath,
    }),
    commands: {
      build_task: foundryCommand([
        "dataset-authoring-task-build",
        "--curation-gate-report",
        curationGateReportPath,
        "--shared-context-cache-dir",
        sharedContextCacheDirRef,
        "--out-dir",
        path.dirname(authoringTaskManifestPath),
      ]),
      collect_patches: foundryCommand([
        "dataset-authoring-patch-collect",
        "--task-manifest",
        authoringTaskManifestPath,
      ]),
      apply_patches:
        existingArtifact(authoringTaskManifestPath)?.value?.commands?.apply_all_patches ?? null,
    },
  };
  const phases = [identityPhase, classificationPhase, locationPhase, patchPhase];
  const reportPath = path.join(outDir, "dataset-authoring-plan.json");
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: authoringPlanOverallStatus(phases),
    command: "dataset-authoring-plan",
    remote_write_mode: "read-only",
    curation_gate_report: repoRelativePath(curationGateReportPath),
    workspace_dir: repoRelativePath(workspaceDir),
    profile: curationGateReport.profile ?? null,
    dataset_type: curationGateReport.dataset_type ?? null,
    rows_file: curationGateReport.rows_file ?? null,
    counts: {
      action_items: Number(counts.action_items ?? 0),
      identity_action_items: identityActionItems,
      classification_queue_rows: classificationRows,
      location_queue_rows: locationRows,
      field_patch_action_items: fieldActionItems,
      deterministic_cleanup_items: Number(counts.deterministic_cleanup_items ?? 0),
    },
    context: {
      schema_file: contextPaths.schema,
      methodology_yaml: contextPaths.methodology_yaml,
      ruleset_file: contextPaths.ruleset,
      classification_schema_files: contextPaths.classification_schema,
      location_schema_file: contextPaths.location_schema,
      authoring_package_dir: authoringPackageDir,
      shared_context_cache_dir: sharedContextCacheDirRef,
    },
    phases,
    instructions: [
      "Run any needs_task_build command first; task status must be ready before AI authoring.",
      "AI/Codex/skills must read the task JSON and referenced authoring packages before writing decisions or patches.",
      "Run deterministic apply commands after decisions/patches are completed; do not edit row JSON directly.",
      "After all required phases are completed, rerun SDK validation, deterministic QA, curation gate, post-authoring finalize, mutation manifest, and only then remote write planning.",
    ],
    files: {
      report: repoRelativePath(reportPath),
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(reportPath, report);
  return report;
}

function commitCommandForDatasetType(
  datasetType,
  rowsFile,
  outDir,
  { targetUserId = null } = {},
) {
  if (["unitgroup", "flowproperty"].includes(datasetType)) {
    throw new Error(
      `${datasetType} rows are reference-only for Foundry imports and cannot be committed through dataset save-draft.`,
    );
  }
  if (datasetType === "support") {
    return [
      resolveTiangongLcaCliBin(),
      "dataset",
      "save-draft",
      "--type",
      "auto",
      "--input",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", "support-save-draft"),
      "--commit",
      "--json",
    ];
  }
  if (["contact", "source"].includes(datasetType)) {
    return [
      resolveTiangongLcaCliBin(),
      "dataset",
      "save-draft",
      "--type",
      datasetType,
      "--input",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", `${datasetType}-save-draft`),
      "--commit",
      "--json",
    ];
  }
  if (datasetType === "flow") {
    const args = [
      resolveTiangongLcaCliBin(),
      "flow",
      "publish-version",
      "--input-file",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", "flow-publish-version"),
      "--commit",
      "--json",
    ];
    appendOption(args, "--target-user-id", targetUserId);
    return args;
  }
  if (datasetType === "lifecyclemodel") {
    return [
      resolveTiangongLcaCliBin(),
      "lifecyclemodel",
      "save-draft",
      "--input",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", "lifecyclemodel-save-draft"),
      "--commit",
      "--json",
    ];
  }
  return [
    resolveTiangongLcaCliBin(),
    "process",
    "save-draft",
    "--input",
    rowsFile,
    "--out-dir",
    path.join(outDir, "commit", "process-save-draft"),
    "--commit",
    "--json",
  ];
}

function runDatasetCommitHandoffPlan(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-commit-handoff-plan",
      usage: [
        "node scripts/foundry.mjs dataset-commit-handoff-plan --finalize-report <dataset-post-authoring-finalize-report.json> --state-code <expected-state-code> --out-dir <handoff-dir>",
      ],
      purpose:
        "Build a read-only explicit commit handoff plan from a ready post-authoring finalize report. It never writes the database.",
      remote_write_mode: "read-only",
    };
  }

  const finalizeArtifact = readJsonArtifactOption(
    options.finalizeReport || options.report || options.input,
  );
  if (!finalizeArtifact) {
    throw new Error(
      "--finalize-report is required and must point to dataset-post-authoring-finalize-report.json.",
    );
  }
  const finalizeReport = finalizeArtifact.value;
  const datasetType = String(options.type || finalizeReport.dataset_type || "")
    .trim()
    .toLowerCase();
  if (
    ![
      "contact",
      "source",
      "support",
      "process",
      "flow",
      "lifecyclemodel",
    ].includes(datasetType)
  ) {
    throw new Error(
      `Unsupported dataset type for commit handoff: ${datasetType || "(missing)"}.`,
    );
  }

  const finalizeDir = path.dirname(finalizeArtifact.path);
  const outDir = resolveRepoPath(
    options.outDir || path.join(finalizeDir, "commit-handoff"),
  );
  const finalRowsFile = resolveRepoPath(
    options.rowsFile ||
      options.finalRowsFile ||
      finalizeReport.files?.final_rows ||
      finalizeReport.final_rows_file,
  );
  const mutationArtifact = readJsonArtifactOption(
    options.mutationManifest || finalizeReport.files?.mutation_manifest,
  );
  const targetUserId = asText(
    options.targetUserId ||
      mutationArtifact?.value?.target_user_id ||
      finalizeReport.target_user_id ||
      process.env.FOUNDRY_TARGET_USER_ID,
  );
  const stateCode = asText(options.stateCode ?? options.expectedStateCode);
  const blockers = [];

  if (finalizeReport.status !== "ready_for_remote_write") {
    blockers.push({
      code: "finalize_report_not_ready",
      message: `Finalize report status is ${finalizeReport.status ?? "missing"}.`,
      report: repoRelativePath(finalizeArtifact.path),
    });
  }
  const locationAuditBlockers = Number(
    finalizeReport.counts?.location_audit_blockers ?? 0,
  );
  if (!Number.isFinite(locationAuditBlockers) || locationAuditBlockers !== 0) {
    blockers.push({
      code: "location_audit_blockers_present",
      message: `Finalize report still records ${
        Number.isFinite(locationAuditBlockers)
          ? locationAuditBlockers
          : "unknown"
      } location audit blockers; all rows must satisfy tidas_locations_category.json before commit handoff.`,
      report: repoRelativePath(finalizeArtifact.path),
    });
  }
  if (!mutationArtifact) {
    blockers.push({
      code: "mutation_manifest_required",
      message:
        "Commit handoff requires the dataset-mutation-manifest referenced by finalize report.",
    });
  } else if (mutationArtifact.value?.status !== "ready_for_remote_write") {
    blockers.push({
      code: "mutation_manifest_not_ready",
      message: `Mutation manifest status is ${mutationArtifact.value?.status ?? "missing"}.`,
      report: repoRelativePath(mutationArtifact.path),
    });
  }
  if (!finalRowsFile || !fileExists(finalRowsFile)) {
    blockers.push({
      code: "final_rows_missing",
      message:
        "Commit handoff requires readable final rows from the finalize report.",
      rows_file:
        finalizeReport.files?.final_rows ??
        finalizeReport.final_rows_file ??
        null,
    });
  }
  if (!targetUserId) {
    blockers.push({
      code: "target_user_id_required",
      message:
        "Commit handoff requires explicit target_user_id evidence from mutation manifest or options.",
    });
  }
  if (!stateCode) {
    blockers.push({
      code: "state_code_required_for_post_write_verify",
      message:
        "Commit handoff requires --state-code so post-write verify can prove the exact committed scope.",
    });
  }
  const handoffFullContextCheck = fullContextProofCheck({
    profileId: finalizeReport.profile ?? mutationArtifact?.value?.profile,
    datasetType,
    mutationArtifact,
    codePrefix: "commit_handoff",
  });
  blockers.push(...handoffFullContextCheck.blockers);

  const commitArgs = finalRowsFile
    ? commitCommandForDatasetType(datasetType, finalRowsFile, outDir, {
        targetUserId,
      })
    : [];
  const verifyArgs = finalRowsFile
    ? [
        resolveTiangongLcaCliBin(),
        "dataset",
        "verify-remote",
        "--input",
        finalRowsFile,
        "--out-dir",
        path.join(outDir, "post-write-verify"),
        "--root-policy",
        String(options.rootPolicy || options.remoteRootPolicy || "candidate"),
        "--compare-root-payload",
        "--json",
      ]
    : [];
  if (targetUserId) {
    verifyArgs.push("--target-user-id", targetUserId);
  }
  if (stateCode) {
    verifyArgs.push("--state-code", stateCode);
  }

  const traceFiles = {
    unresolved_traces:
      finalizeReport.files?.unresolved_traces ??
      mutationArtifact?.value?.files?.unresolved_traces ??
      null,
    source_exchange_completeness_traces:
      finalizeReport.files?.source_exchange_completeness_traces ??
      mutationArtifact?.value?.files?.source_exchange_completeness_traces ??
      null,
    source_reference_rewrites:
      finalizeReport.files?.source_reference_rewrites ??
      mutationArtifact?.value?.files?.source_reference_rewrites ??
      null,
  };
  validateTraceQueuesForCommitHandoff({
    datasetType,
    finalRowsFile,
    traceFiles,
    counts: {
      unresolved_trace_entries:
        mutationArtifact?.value?.counts?.unresolved_trace_entries ??
        finalizeReport.counts?.unresolved_trace_entries ??
        0,
      source_exchange_completeness_entries:
        mutationArtifact?.value?.counts?.source_exchange_completeness_entries ??
        finalizeReport.counts?.source_exchange_completeness_entries ??
        0,
      source_reference_rewrites:
        mutationArtifact?.value?.counts?.source_reference_rewrites ??
        finalizeReport.counts?.source_reference_rewrites ??
        0,
    },
    blockers,
  });
  const readyForExplicitCommit = blockers.length === 0;
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length === 0 ? "ready_for_explicit_commit" : "blocked",
    dataset_type: datasetType,
    profile: finalizeReport.profile ?? mutationArtifact?.value?.profile ?? null,
    remote_write_mode: "read-only",
    finalize_report: repoRelativePath(finalizeArtifact.path),
    mutation_manifest: mutationArtifact
      ? repoRelativePath(mutationArtifact.path)
      : null,
    final_rows_file: finalRowsFile ? repoRelativePath(finalRowsFile) : null,
    target_user_id: targetUserId || null,
    expected_state_code: stateCode || null,
    policy: {
      commit_boundary:
        "This plan does not write the database. The user must explicitly run the commit command, then run the post_write_verify command.",
      post_write_verify_required: true,
      compare_root_payload_required: true,
      trace_queue_policy:
        "Foundry common:other trace queue files must be retained with commit/readback evidence for later database-side curation.",
    },
    counts: {
      blockers: blockers.length,
      write_candidates:
        mutationArtifact?.value?.counts?.write_candidates ??
        finalizeReport.counts?.write_candidates ??
        0,
      unresolved_trace_entries:
        mutationArtifact?.value?.counts?.unresolved_trace_entries ??
        finalizeReport.counts?.unresolved_trace_entries ??
        0,
      source_exchange_completeness_entries:
        mutationArtifact?.value?.counts?.source_exchange_completeness_entries ??
        finalizeReport.counts?.source_exchange_completeness_entries ??
        0,
      source_reference_rewrites:
        mutationArtifact?.value?.counts?.source_reference_rewrites ??
        finalizeReport.counts?.source_reference_rewrites ??
        0,
    },
    blockers,
    commands: {
      commit: readyForExplicitCommit
        ? commitArgs.map(shellQuote).join(" ")
        : null,
      post_write_verify: readyForExplicitCommit
        ? verifyArgs.map(shellQuote).join(" ")
        : null,
    },
    files: {
      trace_queues: traceFiles,
      expected_commit_report_dir: repoRelativePath(path.join(outDir, "commit")),
      expected_post_write_verify_dir: repoRelativePath(
        path.join(outDir, "post-write-verify"),
      ),
    },
  };
  const reportPath = path.join(outDir, "dataset-commit-handoff-plan.json");
  writeJson(reportPath, report);
  return {
    ...report,
    files: {
      ...report.files,
      report: repoRelativePath(reportPath),
    },
  };
}

function validateCommitReportForCloseout({
  commitReport,
  commitReportPath,
  datasetType,
  finalRowsFile,
  expectedRows,
  blockers,
}) {
  const inputPath = resolveRepoPath(reportInputPath(commitReport));
  const status = asText(commitReport.status);
  const mode = asText(commitReport.mode);
  const counts = commitReport.counts ?? {};
  const failedCount = Number(counts.failed ?? counts.failure_count ?? 0);
  const executedCount = Number(counts.executed ?? 0);
  const successCount = Number(counts.success_count ?? 0);
  const selectedCount = Number(counts.selected ?? counts.total_rows ?? 0);

  if (!inputPath || !sameResolvedPath(inputPath, finalRowsFile)) {
    blockers.push({
      code: "commit_report_input_mismatch",
      message: "Commit report input must match the handoff final rows file.",
      commit_report: repoRelativePath(commitReportPath),
      expected_input: repoRelativeMaybe(finalRowsFile),
      actual_input: inputPath ? repoRelativeMaybe(inputPath) : null,
    });
  }
  if (mode !== "commit") {
    blockers.push({
      code: "commit_report_not_commit_mode",
      message: `Commit report mode is ${mode || "missing"}; expected commit.`,
      commit_report: repoRelativePath(commitReportPath),
    });
  }
  if (Object.hasOwn(commitReport, "commit") && commitReport.commit !== true) {
    blockers.push({
      code: "commit_report_commit_flag_false",
      message:
        "Commit report has commit=false; dry-run reports cannot close an import.",
      commit_report: repoRelativePath(commitReportPath),
    });
  }
  if (!status || /with_failures|failure|failed|prepared/u.test(status)) {
    blockers.push({
      code: "commit_report_status_not_completed",
      message: `Commit report status is ${status || "missing"}; expected a completed commit without failures.`,
      commit_report: repoRelativePath(commitReportPath),
    });
  }
  if (!Number.isFinite(failedCount) || failedCount !== 0) {
    blockers.push({
      code: "commit_report_failures_present",
      message: `Commit report contains ${Number.isFinite(failedCount) ? failedCount : "unknown"} failed rows.`,
      commit_report: repoRelativePath(commitReportPath),
    });
  }

  const committedRows =
    datasetType === "flow" ? successCount : executedCount || successCount;
  if (
    !Number.isFinite(committedRows) ||
    committedRows < expectedRows ||
    expectedRows <= 0
  ) {
    blockers.push({
      code: "commit_report_row_count_incomplete",
      message: `Commit report proves ${Number.isFinite(committedRows) ? committedRows : "unknown"} committed rows; expected ${expectedRows}.`,
      commit_report: repoRelativePath(commitReportPath),
    });
  }
  if (selectedCount && selectedCount < expectedRows) {
    blockers.push({
      code: "commit_report_selected_count_incomplete",
      message: `Commit report selected ${selectedCount} rows; expected at least ${expectedRows}.`,
      commit_report: repoRelativePath(commitReportPath),
    });
  }
}

function validatePostWriteVerifyForCloseout({
  verifyReport,
  verifyReportPath,
  finalRowsFile,
  expectedRows,
  targetUserId,
  expectedStateCode,
  blockers,
}) {
  const inputPath = resolveRepoPath(reportInputPath(verifyReport));
  const counts = verifyReport.counts ?? {};
  const blockerCount = Number(
    counts.blockers ?? verifyReport.blockers?.length ?? 0,
  );
  const rootReadbackCount = Number(counts.root_readback_checks ?? 0);
  const rootPayloadMismatches = Number(counts.root_payload_mismatches ?? -1);

  if (!inputPath || !sameResolvedPath(inputPath, finalRowsFile)) {
    blockers.push({
      code: "post_write_verify_input_mismatch",
      message:
        "Post-write verification input must match the handoff final rows file.",
      post_write_verify_report: repoRelativePath(verifyReportPath),
      expected_input: repoRelativeMaybe(finalRowsFile),
      actual_input: inputPath ? repoRelativeMaybe(inputPath) : null,
    });
  }
  if (verifyReport.status !== "passed_remote_verification") {
    blockers.push({
      code: "post_write_verify_not_passed",
      message: `Post-write verification status is ${verifyReport.status ?? "missing"}.`,
      post_write_verify_report: repoRelativePath(verifyReportPath),
    });
  }
  if (
    !Number.isFinite(blockerCount) ||
    blockerCount !== 0 ||
    ensureArray(verifyReport.blockers).length > 0
  ) {
    blockers.push({
      code: "post_write_verify_blockers_present",
      message: `Post-write verification contains ${Number.isFinite(blockerCount) ? blockerCount : "unknown"} blockers.`,
      post_write_verify_report: repoRelativePath(verifyReportPath),
    });
  }
  if (
    !Number.isFinite(rootReadbackCount) ||
    rootReadbackCount < expectedRows ||
    expectedRows <= 0
  ) {
    blockers.push({
      code: "post_write_verify_root_readback_incomplete",
      message: `Post-write verification has ${Number.isFinite(rootReadbackCount) ? rootReadbackCount : "unknown"} root readback checks; expected ${expectedRows}.`,
      post_write_verify_report: repoRelativePath(verifyReportPath),
    });
  }
  if (!Number.isFinite(rootPayloadMismatches) || rootPayloadMismatches !== 0) {
    blockers.push({
      code: "post_write_verify_payload_mismatch",
      message: `Post-write verification root payload mismatches: ${Number.isFinite(rootPayloadMismatches) ? rootPayloadMismatches : "missing"}.`,
      post_write_verify_report: repoRelativePath(verifyReportPath),
    });
  }

  const checksFile = resolveRepoPath(verifyReport.files?.checks);
  if (!checksFile || !fileExists(checksFile)) {
    blockers.push({
      code: "post_write_verify_checks_missing",
      message:
        "Post-write closeout requires the remote-verification.jsonl checks file to prove --compare-root-payload hashes.",
      post_write_verify_report: repoRelativePath(verifyReportPath),
      checks_file: verifyReport.files?.checks ?? null,
    });
    return { checksFile: null, readbackChecks: [] };
  }

  const checks = readJsonLines(checksFile);
  const readbackChecks = checks.filter(
    (check) =>
      check?.role === "root" && String(check?.path ?? "").endsWith("#readback"),
  );
  if (readbackChecks.length < expectedRows) {
    blockers.push({
      code: "post_write_verify_readback_check_rows_missing",
      message: `Post-write check file contains ${readbackChecks.length} root readback checks; expected ${expectedRows}.`,
      checks_file: repoRelativePath(checksFile),
    });
  }

  for (const check of readbackChecks) {
    const localHash = asText(check.local_payload_sha256);
    const remoteHash = asText(check.remote_payload_sha256);
    if (check.status !== "ok") {
      blockers.push({
        code: "post_write_verify_readback_check_not_ok",
        message: `Readback check for ${check.table}:${check.id}@${check.version} is ${check.status ?? "missing"}.`,
        checks_file: repoRelativePath(checksFile),
        row_index: check.row_index ?? null,
      });
    }
    if (!localHash || !remoteHash || localHash !== remoteHash) {
      blockers.push({
        code: "post_write_verify_compare_root_payload_not_proven",
        message:
          "Readback check is missing equal local/remote payload hashes, so --compare-root-payload was not proven.",
        checks_file: repoRelativePath(checksFile),
        row_index: check.row_index ?? null,
        table: check.table ?? null,
        id: check.id ?? null,
      });
    }
    if (targetUserId && check.remote_user_id !== targetUserId) {
      blockers.push({
        code: "post_write_verify_owner_not_proven",
        message: `Readback owner ${check.remote_user_id ?? "missing"} does not match ${targetUserId}.`,
        checks_file: repoRelativePath(checksFile),
        row_index: check.row_index ?? null,
      });
    }
    if (
      expectedStateCode !== null &&
      Number(check.remote_state_code) !== expectedStateCode
    ) {
      blockers.push({
        code: "post_write_verify_state_code_not_proven",
        message: `Readback state_code ${check.remote_state_code ?? "missing"} does not match ${expectedStateCode}.`,
        checks_file: repoRelativePath(checksFile),
        row_index: check.row_index ?? null,
      });
    }
  }

  return { checksFile, readbackChecks };
}

function validateTraceQueuesForCommitHandoff({
  datasetType,
  finalRowsFile,
  traceFiles,
  counts,
  blockers,
}) {
  for (const [key, expectedCount] of [
    ["unresolved_traces", Number(counts.unresolved_trace_entries ?? 0) || 0],
    [
      "source_exchange_completeness_traces",
      Number(counts.source_exchange_completeness_entries ?? 0) || 0,
    ],
    ["source_reference_rewrites", Number(counts.source_reference_rewrites ?? 0) || 0],
  ]) {
    const queuePath = traceFiles?.[key];
    const resolved = resolveRepoPath(queuePath);
    if (!resolved) {
      if (expectedCount > 0) {
        blockers.push({
          code: "commit_handoff_trace_queue_missing",
          message: `${key} has ${expectedCount} entries but no queue file is recorded before commit handoff.`,
          trace_queue: key,
        });
      }
      continue;
    }
    if (!fileExists(resolved)) {
      blockers.push({
        code: "commit_handoff_trace_queue_file_missing",
        message: `${key} is recorded but the queue file is not readable before commit handoff.`,
        trace_queue: key,
        file: queuePath,
      });
      continue;
    }
    const actualCount = countJsonLinesFile(resolved);
    if (actualCount < expectedCount) {
      blockers.push({
        code: "commit_handoff_trace_queue_count_incomplete",
        message: `${key} has ${actualCount} JSONL rows; expected at least ${expectedCount} before commit handoff.`,
        trace_queue: key,
        file: repoRelativePath(resolved),
      });
    }
  }

  if (finalRowsFile && fileExists(finalRowsFile)) {
    validateTraceQueueCoverageForRows({
      datasetType,
      finalRowsFile,
      traceQueues: traceFiles,
      counts,
      blockers,
    });
  }
}

function closeoutTraceDatasetType(row, fallbackType) {
  const fallback = asText(fallbackType).toLowerCase();
  if (fallback && fallback !== "support") return fallback;
  if (row?.contactDataSet) return "contact";
  if (row?.sourceDataSet) return "source";
  if (row?.flowDataSet) return "flow";
  if (row?.processDataSet) return "process";
  if (row?.lifeCycleModelDataSet) return "lifecyclemodel";
  if (row?.unitGroupDataSet) return "unitgroup";
  if (row?.flowPropertyDataSet) return "flowproperty";
  return fallback || "support";
}

function closeoutTraceIdentity(row, datasetType, rowIndex) {
  const identity = datasetIdentity(row, datasetType);
  return {
    id:
      identity.id ||
      asText(row?.dataset_id ?? row?.entity_id ?? row?.id) ||
      `row-${rowIndex + 1}`,
    version:
      identity.version ||
      asText(row?.dataset_version ?? row?.version) ||
      "00.00.001",
  };
}

function traceQueueCoverageKey(trace) {
  return JSON.stringify([
    asText(trace?.dataset_type).toLowerCase(),
    asText(trace?.entity_id),
    asText(trace?.version),
    Number(trace?.row_index ?? -1),
    asText(trace?.trace_kind),
    asText(trace?.path),
    asText(trace?.status),
    asText(trace?.action_item_code),
    asText(trace?.blocked_path),
    asText(trace?.trace_sha256),
  ]);
}

function expectedTraceRowsFromFinalRows({ datasetType, finalRowsFile }) {
  const rows = readRowsFile(finalRowsFile);
  const unresolved = [];
  const sourceExchangeCompleteness = [];
  rows.forEach((row, rowIndex) => {
    const effectiveType = closeoutTraceDatasetType(row, datasetType);
    const identity = closeoutTraceIdentity(row, effectiveType, rowIndex);
    const summary = foundryTraceSummary({
      datasetType: effectiveType,
      identity,
      row,
      rowIndex,
    });
    unresolved.push(...summary.unresolved_traces);
    sourceExchangeCompleteness.push(...summary.source_exchange_completeness);
  });
  return {
    unresolved_traces: unresolved,
    source_exchange_completeness_traces: sourceExchangeCompleteness,
  };
}

function validateOneTraceQueueCoverage({
  traceQueue,
  traceKind,
  expectedRows,
  queuePath,
  blockers,
}) {
  const resolved = resolveRepoPath(queuePath);
  if (!resolved || !fileExists(resolved)) return;
  const actualRows = readJsonLines(resolved);
  if (actualRows.length !== expectedRows.length) {
    blockers.push({
      code: "trace_queue_final_rows_count_mismatch",
      message: `${traceQueue} contains ${actualRows.length} rows but final rows contain ${expectedRows.length} ${traceKind} entries.`,
      trace_queue: traceQueue,
      file: repoRelativePath(resolved),
      expected_count: expectedRows.length,
      actual_count: actualRows.length,
    });
  }

  const actualKeys = new Map();
  actualRows.forEach((row, index) => {
    const key = traceQueueCoverageKey(row);
    const entries = actualKeys.get(key) ?? [];
    entries.push(index);
    actualKeys.set(key, entries);
  });
  const expectedKeys = new Map();
  expectedRows.forEach((row, index) => {
    const key = traceQueueCoverageKey(row);
    const entries = expectedKeys.get(key) ?? [];
    entries.push(index);
    expectedKeys.set(key, entries);
    if (!actualKeys.has(key)) {
      blockers.push({
        code: "trace_queue_final_rows_entry_missing",
        message: `${traceQueue} is missing a trace entry that exists in the final rows.`,
        trace_queue: traceQueue,
        file: repoRelativePath(resolved),
        row_index: row.row_index ?? null,
        entity_id: row.entity_id ?? null,
        version: row.version ?? null,
        path: row.path ?? null,
        trace_sha256: row.trace_sha256 ?? null,
      });
    }
  });
  actualRows.forEach((row, index) => {
    const key = traceQueueCoverageKey(row);
    if (!expectedKeys.has(key)) {
      blockers.push({
        code: "trace_queue_stale_or_extra_entry",
        message: `${traceQueue} contains a trace entry that is not present in the final rows.`,
        trace_queue: traceQueue,
        file: repoRelativePath(resolved),
        queue_row_index: index,
        row_index: row.row_index ?? null,
        entity_id: row.entity_id ?? null,
        version: row.version ?? null,
        path: row.path ?? null,
        trace_sha256: row.trace_sha256 ?? null,
      });
    }
  });
}

function validateTraceQueueCoverageForRows({
  datasetType,
  finalRowsFile,
  traceQueues,
  counts,
  blockers,
}) {
  const expected = expectedTraceRowsFromFinalRows({
    datasetType,
    finalRowsFile,
  });
  if (
    expected.unresolved_traces.length !== counts.unresolved_trace_entries
  ) {
    blockers.push({
      code: "trace_queue_manifest_count_not_final_rows",
      message:
        "Mutation/handoff unresolved trace count does not match the exact final rows.",
      trace_queue: "unresolved_traces",
      expected_count: expected.unresolved_traces.length,
      recorded_count: counts.unresolved_trace_entries,
      final_rows_file: repoRelativePath(finalRowsFile),
    });
  }
  if (
    expected.source_exchange_completeness_traces.length !==
    counts.source_exchange_completeness_entries
  ) {
    blockers.push({
      code: "trace_queue_manifest_count_not_final_rows",
      message:
        "Mutation/handoff source exchange completeness trace count does not match the exact final rows.",
      trace_queue: "source_exchange_completeness_traces",
      expected_count: expected.source_exchange_completeness_traces.length,
      recorded_count: counts.source_exchange_completeness_entries,
      final_rows_file: repoRelativePath(finalRowsFile),
    });
  }
  validateOneTraceQueueCoverage({
    traceQueue: "unresolved_traces",
    traceKind: "unresolvedTrace",
    expectedRows: expected.unresolved_traces,
    queuePath: traceQueues.unresolved_traces,
    blockers,
  });
  validateOneTraceQueueCoverage({
    traceQueue: "source_exchange_completeness_traces",
    traceKind: "sourceExchangeCompleteness",
    expectedRows: expected.source_exchange_completeness_traces,
    queuePath: traceQueues.source_exchange_completeness_traces,
    blockers,
  });
}

function validateTraceQueuesForCloseout({
  handoffPlan,
  finalizeReport,
  mutationManifest,
  datasetType,
  finalRowsFile,
  blockers,
}) {
  const counts = {
    unresolved_trace_entries:
      Number(
        handoffPlan.counts?.unresolved_trace_entries ??
          mutationManifest?.counts?.unresolved_trace_entries ??
          finalizeReport?.counts?.unresolved_trace_entries ??
          0,
      ) || 0,
    source_exchange_completeness_entries:
      Number(
        handoffPlan.counts?.source_exchange_completeness_entries ??
          mutationManifest?.counts?.source_exchange_completeness_entries ??
          finalizeReport?.counts?.source_exchange_completeness_entries ??
          0,
      ) || 0,
    source_reference_rewrites:
      Number(
        handoffPlan.counts?.source_reference_rewrites ??
          mutationManifest?.counts?.source_reference_rewrites ??
          finalizeReport?.counts?.source_reference_rewrites ??
          0,
      ) || 0,
  };
  const traceQueues = {
    unresolved_traces:
      handoffPlan.files?.trace_queues?.unresolved_traces ??
      mutationManifest?.files?.unresolved_traces ??
      finalizeReport?.files?.unresolved_traces ??
      null,
    source_exchange_completeness_traces:
      handoffPlan.files?.trace_queues?.source_exchange_completeness_traces ??
      mutationManifest?.files?.source_exchange_completeness_traces ??
      finalizeReport?.files?.source_exchange_completeness_traces ??
      null,
    source_reference_rewrites:
      handoffPlan.files?.trace_queues?.source_reference_rewrites ??
      mutationManifest?.files?.source_reference_rewrites ??
      finalizeReport?.files?.source_reference_rewrites ??
      null,
  };

  for (const [key, queuePath] of Object.entries(traceQueues)) {
    const expectedCount =
      key === "unresolved_traces"
        ? counts.unresolved_trace_entries
        : key === "source_exchange_completeness_traces"
          ? counts.source_exchange_completeness_entries
          : counts.source_reference_rewrites;
    const resolved = resolveRepoPath(queuePath);
    if (!resolved) {
      if (expectedCount > 0) {
        blockers.push({
          code: "trace_queue_missing",
          message: `${key} has ${expectedCount} entries but no queue file is recorded.`,
          trace_queue: key,
        });
      }
      continue;
    }
    if (!fileExists(resolved)) {
      blockers.push({
        code: "trace_queue_file_missing",
        message: `${key} is recorded but the queue file is not readable.`,
        trace_queue: key,
        file: queuePath,
      });
      continue;
    }
    const actualCount = countJsonLinesFile(resolved);
    if (actualCount < expectedCount) {
      blockers.push({
        code: "trace_queue_count_incomplete",
        message: `${key} has ${actualCount} JSONL rows; expected at least ${expectedCount}.`,
        trace_queue: key,
        file: repoRelativePath(resolved),
      });
    }
  }

  if (finalRowsFile && fileExists(finalRowsFile)) {
    validateTraceQueueCoverageForRows({
      datasetType,
      finalRowsFile,
      traceQueues,
      counts,
      blockers,
    });
  }

  return {
    counts,
    files: {
      unresolved_traces: traceQueues.unresolved_traces,
      source_exchange_completeness_traces:
        traceQueues.source_exchange_completeness_traces,
      source_reference_rewrites: traceQueues.source_reference_rewrites,
    },
  };
}

function runDatasetPostWriteCloseout(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-post-write-closeout",
      usage: [
        "node scripts/foundry.mjs dataset-post-write-closeout --handoff-plan <dataset-commit-handoff-plan.json> --commit-report <summary-or-sync-report.json> --post-write-verify-report <remote-verification-report.json> --out-dir <closeout-dir>",
      ],
      purpose:
        "Close an explicit remote write only after Foundry handoff, CLI commit report, and post-write verify-root-payload evidence prove the exact same final rows were written and read back.",
      remote_write_mode: "read-only",
    };
  }

  const handoffArtifact = readJsonArtifactOption(
    options.handoffPlan || options.plan || options.input,
  );
  const commitArtifact = readJsonArtifactOption(
    options.commitReport || options.commit || options.writeReport,
  );
  const verifyArtifact = readJsonArtifactOption(
    options.postWriteVerifyReport ||
      options.verifyReport ||
      options.remoteVerifyReport,
  );
  if (!handoffArtifact) {
    throw new Error(
      "--handoff-plan is required and must point to dataset-commit-handoff-plan.json.",
    );
  }
  if (!commitArtifact) {
    throw new Error(
      "--commit-report is required and must point to the CLI commit report JSON.",
    );
  }
  if (!verifyArtifact) {
    throw new Error(
      "--post-write-verify-report is required and must point to remote-verification-report.json.",
    );
  }

  const handoffPlan = handoffArtifact.value;
  const datasetType = String(options.type || handoffPlan.dataset_type || "")
    .trim()
    .toLowerCase();
  if (
    ![
      "support",
      "contact",
      "source",
      "process",
      "flow",
      "lifecyclemodel",
    ].includes(datasetType)
  ) {
    throw new Error(
      `Unsupported dataset type for post-write closeout: ${datasetType || "(missing)"}.`,
    );
  }
  const outDir = resolveRepoPath(
    options.outDir ||
      path.join(path.dirname(handoffArtifact.path), "post-write-closeout"),
  );
  const finalRowsFile = resolveRepoPath(
    options.rowsFile || handoffPlan.final_rows_file,
  );
  const finalizeArtifact = readJsonArtifactOption(
    options.finalizeReport || handoffPlan.finalize_report,
  );
  const mutationArtifact = readJsonArtifactOption(
    options.mutationManifest || handoffPlan.mutation_manifest,
  );
  const finalizeReport = finalizeArtifact?.value ?? null;
  const mutationManifest = mutationArtifact?.value ?? null;
  const targetUserId = asText(
    options.targetUserId || handoffPlan.target_user_id,
  );
  const expectedStateCodeText = asText(
    options.stateCode ?? handoffPlan.expected_state_code,
  );
  const expectedStateCode =
    expectedStateCodeText === "" || Number.isNaN(Number(expectedStateCodeText))
      ? null
      : Number(expectedStateCodeText);
  const blockers = [];

  if (handoffPlan.status !== "ready_for_explicit_commit") {
    blockers.push({
      code: "handoff_plan_not_ready",
      message: `Handoff plan status is ${handoffPlan.status ?? "missing"}.`,
      handoff_plan: repoRelativePath(handoffArtifact.path),
    });
  }
  if (!finalRowsFile || !fileExists(finalRowsFile)) {
    blockers.push({
      code: "final_rows_missing",
      message:
        "Post-write closeout requires the exact final rows file from handoff.",
      final_rows_file: handoffPlan.final_rows_file ?? null,
    });
  }
  if (!targetUserId) {
    blockers.push({
      code: "target_user_id_missing",
      message:
        "Post-write closeout requires target_user_id from handoff or options.",
    });
  }
  if (expectedStateCodeText === "" || expectedStateCode === null) {
    blockers.push({
      code: "state_code_missing",
      message:
        "Post-write closeout requires expected_state_code from handoff or options.",
    });
  }
  if (!finalizeArtifact) {
    blockers.push({
      code: "finalize_report_missing",
      message:
        "Post-write closeout requires the finalize report referenced by the handoff so AI/context prewrite gates remain attached to the committed import.",
      finalize_report: handoffPlan.finalize_report ?? null,
    });
  }
  if (!mutationArtifact) {
    blockers.push({
      code: "mutation_manifest_missing",
      message:
        "Post-write closeout requires the mutation manifest referenced by the handoff so exact-scope AI/context evidence remains attached to the committed import.",
      mutation_manifest: handoffPlan.mutation_manifest ?? null,
    });
  }
  if (finalizeReport && finalizeReport.status !== "ready_for_remote_write") {
    blockers.push({
      code: "finalize_report_not_ready",
      message: `Finalize report status is ${finalizeReport.status ?? "missing"}.`,
      finalize_report: repoRelativeMaybe(finalizeArtifact?.path),
    });
  }
  if (
    mutationManifest &&
    mutationManifest.status !== "ready_for_remote_write"
  ) {
    blockers.push({
      code: "mutation_manifest_not_ready",
      message: `Mutation manifest status is ${mutationManifest.status ?? "missing"}.`,
      mutation_manifest: repoRelativeMaybe(mutationArtifact?.path),
    });
  }
  if (finalizeReport && finalRowsFile) {
    const finalizeRowsFile = resolveRepoPath(
      finalizeReport.files?.final_rows ||
        finalizeReport.final_rows_file ||
        finalizeReport.rows_file,
    );
    if (
      !finalizeRowsFile ||
      !sameResolvedPath(finalizeRowsFile, finalRowsFile)
    ) {
      blockers.push({
        code: "finalize_report_rows_mismatch",
        message:
          "Finalize report final rows must match the handoff final rows file.",
        finalize_report: repoRelativeMaybe(finalizeArtifact?.path),
        expected_rows: repoRelativeMaybe(finalRowsFile),
        actual_rows: finalizeRowsFile
          ? repoRelativeMaybe(finalizeRowsFile)
          : null,
      });
    }
  }
  if (mutationManifest && finalRowsFile) {
    const mutationRowsFile = resolveRepoPath(
      mutationManifest.rows_file ||
        mutationManifest.files?.final_rows ||
        mutationManifest.files?.rows_file,
    );
    if (
      !mutationRowsFile ||
      !sameResolvedPath(mutationRowsFile, finalRowsFile)
    ) {
      blockers.push({
        code: "mutation_manifest_rows_mismatch",
        message:
          "Mutation manifest rows_file must match the handoff final rows file.",
        mutation_manifest: repoRelativeMaybe(mutationArtifact?.path),
        expected_rows: repoRelativeMaybe(finalRowsFile),
        actual_rows: mutationRowsFile
          ? repoRelativeMaybe(mutationRowsFile)
          : null,
      });
    }
  }
  const closeoutProfile = asText(
    handoffPlan.profile ?? finalizeReport?.profile ?? mutationManifest?.profile,
  );
  const postWriteFullContextCheck = fullContextProofCheck({
    profileId: closeoutProfile,
    datasetType,
    mutationArtifact,
    codePrefix: "post_write_closeout",
  });
  blockers.push(...postWriteFullContextCheck.blockers);

  const expectedRows =
    finalRowsFile && fileExists(finalRowsFile)
      ? countRowsFile(finalRowsFile)
      : 0;
  if (expectedRows <= 0) {
    blockers.push({
      code: "final_rows_empty",
      message: "Post-write closeout requires at least one final row.",
      final_rows_file: repoRelativeMaybe(finalRowsFile),
    });
  }

  if (finalRowsFile && fileExists(finalRowsFile)) {
    validateCommitReportForCloseout({
      commitReport: commitArtifact.value,
      commitReportPath: commitArtifact.path,
      datasetType,
      finalRowsFile,
      expectedRows,
      blockers,
    });
    validatePostWriteVerifyForCloseout({
      verifyReport: verifyArtifact.value,
      verifyReportPath: verifyArtifact.path,
      finalRowsFile,
      expectedRows,
      targetUserId,
      expectedStateCode,
      blockers,
    });
  }

  const traceQueues = validateTraceQueuesForCloseout({
    handoffPlan,
    finalizeReport,
    mutationManifest,
    datasetType,
    finalRowsFile,
    blockers,
  });

  const reportPath = path.join(
    outDir,
    "dataset-post-write-closeout-report.json",
  );
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length === 0 ? "completed" : "blocked",
    dataset_type: datasetType,
    profile:
      handoffPlan.profile ??
      finalizeReport?.profile ??
      mutationManifest?.profile ??
      null,
    remote_write_mode: "read-only",
    handoff_plan: repoRelativePath(handoffArtifact.path),
    finalize_report: finalizeArtifact
      ? repoRelativePath(finalizeArtifact.path)
      : null,
    mutation_manifest: mutationArtifact
      ? repoRelativePath(mutationArtifact.path)
      : null,
    commit_report: repoRelativePath(commitArtifact.path),
    post_write_verify_report: repoRelativePath(verifyArtifact.path),
    final_rows_file: repoRelativeMaybe(finalRowsFile),
    target_user_id: targetUserId || null,
    expected_state_code: expectedStateCode,
    policy: {
      ai_full_context_semantic_completion_required_before_entry: true,
      commit_boundary:
        "This closeout is read-only. It accepts only an already executed explicit CLI commit plus post-write root payload readback evidence.",
      compare_root_payload_required: true,
      closeout_completion:
        "completed means Foundry handoff was ready, CLI commit completed without row failures, post-write verify proved owner, state_code, and local/remote payload hash equality for the same final rows, and profile-required full schema/YAML/context AI proof remained attached.",
    },
    counts: {
      blockers: blockers.length,
      final_rows: expectedRows,
      commit_rows:
        Number(
          commitArtifact.value.counts?.executed ??
            commitArtifact.value.counts?.success_count ??
            0,
        ) || 0,
      post_write_verify_blockers:
        Number(
          verifyArtifact.value.counts?.blockers ??
            verifyArtifact.value.blockers?.length ??
            0,
        ) || 0,
      root_readback_checks:
        Number(verifyArtifact.value.counts?.root_readback_checks ?? 0) || 0,
      root_payload_mismatches: Number(
        verifyArtifact.value.counts?.root_payload_mismatches ?? -1,
      ),
      unresolved_trace_entries: traceQueues.counts.unresolved_trace_entries,
      source_exchange_completeness_entries:
        traceQueues.counts.source_exchange_completeness_entries,
      source_reference_rewrites: traceQueues.counts.source_reference_rewrites,
      ai_patch_evidence_entries:
        Number(mutationManifest?.counts?.ai_patch_evidence_entries ?? 0) || 0,
      ai_classification_decision_entries:
        Number(
          mutationManifest?.counts?.ai_classification_decision_entries ?? 0,
        ) || 0,
	      ai_location_decision_entries:
	        Number(mutationManifest?.counts?.ai_location_decision_entries ?? 0) ||
	        0,
      ai_identity_decision_entries:
        Number(mutationManifest?.counts?.ai_identity_decision_entries ?? 0) || 0,
	      ai_semantic_evidence_entries:
	        (Number(mutationManifest?.counts?.ai_patch_evidence_entries ?? 0) ||
	          0) +
	        (Number(
	          mutationManifest?.counts?.ai_classification_decision_entries ?? 0,
	        ) || 0) +
        (Number(mutationManifest?.counts?.ai_location_decision_entries ?? 0) ||
          0) +
        (Number(mutationManifest?.counts?.ai_identity_decision_entries ?? 0) ||
          0),
      full_context_ai_completion_required: postWriteFullContextCheck.required,
    },
    blockers,
    files: {
      report: repoRelativePath(reportPath),
      trace_queues: traceQueues.files,
      remote_verification_checks: verifyArtifact.value.files?.checks
        ? repoRelativeMaybe(resolveRepoPath(verifyArtifact.value.files.checks))
        : null,
    },
  };
  writeJson(reportPath, report);
  return report;
}

function closeoutCompletionSummary({ artifact, blockers }) {
  const closeout = artifact.value;
  const closeoutPath = artifact.path;
  const datasetType = asText(closeout.dataset_type).toLowerCase();
  const finalRowsFile = resolveRepoPath(closeout.final_rows_file);
  const finalizeArtifact = readJsonArtifactOption(closeout.finalize_report);
  const mutationArtifact = readJsonArtifactOption(closeout.mutation_manifest);
  const finalRowsCount =
    finalRowsFile && fileExists(finalRowsFile)
      ? countRowsFile(finalRowsFile)
      : 0;
  const prefix = {
    closeout_report: repoRelativePath(closeoutPath),
    dataset_type: datasetType || null,
  };

  if (closeout.status !== "completed") {
    blockers.push({
      ...prefix,
      code: "closeout_not_completed",
      message: `Closeout status is ${closeout.status ?? "missing"}.`,
    });
  }
  if (!["process", "flow", "lifecyclemodel", "support"].includes(datasetType)) {
    blockers.push({
      ...prefix,
      code: "closeout_dataset_type_invalid",
      message: `Closeout dataset_type is ${datasetType || "missing"}.`,
    });
  }
  if (!finalRowsFile || !fileExists(finalRowsFile) || finalRowsCount <= 0) {
    blockers.push({
      ...prefix,
      code: "closeout_final_rows_missing",
      message: "Closeout final_rows_file must be readable and non-empty.",
      final_rows_file: closeout.final_rows_file ?? null,
    });
  }
  if (!finalizeArtifact) {
    blockers.push({
      ...prefix,
      code: "closeout_finalize_report_missing",
      message:
        "Task completion requires the finalize report referenced by each closeout.",
      finalize_report: closeout.finalize_report ?? null,
    });
  } else if (finalizeArtifact.value?.status !== "ready_for_remote_write") {
    blockers.push({
      ...prefix,
      code: "closeout_finalize_report_not_ready",
      message: `Finalize report status is ${finalizeArtifact.value?.status ?? "missing"}.`,
      finalize_report: repoRelativePath(finalizeArtifact.path),
    });
  }
  if (!mutationArtifact) {
    blockers.push({
      ...prefix,
      code: "closeout_mutation_manifest_missing",
      message:
        "Task completion requires the mutation manifest referenced by each closeout.",
      mutation_manifest: closeout.mutation_manifest ?? null,
    });
  } else if (mutationArtifact.value?.status !== "ready_for_remote_write") {
    blockers.push({
      ...prefix,
      code: "closeout_mutation_manifest_not_ready",
      message: `Mutation manifest status is ${mutationArtifact.value?.status ?? "missing"}.`,
      mutation_manifest: repoRelativePath(mutationArtifact.path),
    });
  }

  const finalizeRowsFile = resolveRepoPath(
    finalizeArtifact?.value?.files?.final_rows ||
      finalizeArtifact?.value?.final_rows_file ||
      finalizeArtifact?.value?.rows_file,
  );
  if (
    finalizeArtifact &&
    finalRowsFile &&
    (!finalizeRowsFile || !sameResolvedPath(finalizeRowsFile, finalRowsFile))
  ) {
    blockers.push({
      ...prefix,
      code: "closeout_finalize_rows_mismatch",
      message: "Finalize report final rows must match closeout final rows.",
      expected_rows: repoRelativeMaybe(finalRowsFile),
      actual_rows: repoRelativeMaybe(finalizeRowsFile),
    });
  }
  const mutationRowsFile = resolveRepoPath(
    mutationArtifact?.value?.rows_file ||
      mutationArtifact?.value?.files?.final_rows ||
      mutationArtifact?.value?.files?.rows_file,
  );
  if (
    mutationArtifact &&
    finalRowsFile &&
    (!mutationRowsFile || !sameResolvedPath(mutationRowsFile, finalRowsFile))
  ) {
    blockers.push({
      ...prefix,
      code: "closeout_mutation_rows_mismatch",
      message: "Mutation manifest rows_file must match closeout final rows.",
      expected_rows: repoRelativeMaybe(finalRowsFile),
      actual_rows: repoRelativeMaybe(mutationRowsFile),
    });
  }

  const closeoutBlockers = Number(closeout.counts?.blockers ?? 0);
  const rootPayloadMismatches = Number(
    closeout.counts?.root_payload_mismatches ?? -1,
  );
  const rootReadbackChecks = Number(closeout.counts?.root_readback_checks ?? 0);
  const mutationCounts = mutationArtifact?.value?.counts ?? {};
  if (!Number.isFinite(closeoutBlockers) || closeoutBlockers !== 0) {
    blockers.push({
      ...prefix,
      code: "closeout_blockers_present",
      message: `Closeout still records ${Number.isFinite(closeoutBlockers) ? closeoutBlockers : "unknown"} blockers.`,
    });
  }
  if (!Number.isFinite(rootPayloadMismatches) || rootPayloadMismatches !== 0) {
    blockers.push({
      ...prefix,
      code: "closeout_payload_mismatches_present",
      message: `Closeout root payload mismatches: ${Number.isFinite(rootPayloadMismatches) ? rootPayloadMismatches : "missing"}.`,
    });
  }
  if (
    !Number.isFinite(rootReadbackChecks) ||
    rootReadbackChecks < finalRowsCount ||
    finalRowsCount <= 0
  ) {
    blockers.push({
      ...prefix,
      code: "closeout_readback_incomplete",
      message: `Closeout readback checks ${Number.isFinite(rootReadbackChecks) ? rootReadbackChecks : "missing"} do not cover ${finalRowsCount} final rows.`,
    });
  }

  const unresolvedTraceCount =
    Number(
      closeout.counts?.unresolved_trace_entries ??
        mutationCounts.unresolved_trace_entries ??
        0,
    ) || 0;
  const sourceExchangeCompletenessCount =
    Number(
      closeout.counts?.source_exchange_completeness_entries ??
        mutationCounts.source_exchange_completeness_entries ??
        0,
    ) || 0;
  const traceQueues = closeout.files?.trace_queues ?? {};
  for (const [traceKind, expectedTraceCount] of [
    ["unresolved_traces", unresolvedTraceCount],
    ["source_exchange_completeness_traces", sourceExchangeCompletenessCount],
  ]) {
    const traceFile = resolveRepoPath(traceQueues?.[traceKind]);
    if (expectedTraceCount > 0 && (!traceFile || !fileExists(traceFile))) {
      blockers.push({
        ...prefix,
        code: "closeout_trace_queue_missing",
        message: `${traceKind} has ${expectedTraceCount} entries but its queue file is not readable.`,
        trace_queue: traceKind,
        file: traceQueues?.[traceKind] ?? null,
      });
      continue;
    }
    if (expectedTraceCount > 0) {
      const actualTraceCount = countJsonLinesFile(traceFile);
      if (actualTraceCount < expectedTraceCount) {
        blockers.push({
          ...prefix,
          code: "closeout_trace_queue_count_incomplete",
          message: `${traceKind} has ${actualTraceCount} JSONL rows; expected at least ${expectedTraceCount}.`,
          trace_queue: traceKind,
          file: repoRelativePath(traceFile),
        });
      }
    }
  }

  const fullContextCheck = fullContextProofCheck({
    prefix,
    profileId: closeout.profile ?? mutationArtifact?.value?.profile,
    datasetType,
    closeoutCounts: closeout.counts ?? {},
    mutationArtifact,
    codePrefix: "closeout",
  });
  blockers.push(...fullContextCheck.blockers);

  return {
    closeout_report: repoRelativePath(closeoutPath),
    dataset_type: datasetType || null,
    profile: closeout.profile ?? mutationArtifact?.value?.profile ?? null,
    status: closeout.status ?? null,
    final_rows_file: repoRelativeMaybe(finalRowsFile),
    final_rows: finalRowsCount,
    target_user_id:
      closeout.target_user_id ??
      mutationArtifact?.value?.target_user_id ??
      null,
    expected_state_code: closeout.expected_state_code ?? null,
    finalize_report: finalizeArtifact
      ? repoRelativePath(finalizeArtifact.path)
      : null,
    mutation_manifest: mutationArtifact
      ? repoRelativePath(mutationArtifact.path)
      : null,
    commit_report: closeout.commit_report ?? null,
    post_write_verify_report: closeout.post_write_verify_report ?? null,
    counts: {
      blockers: closeoutBlockers,
      root_readback_checks: Number.isFinite(rootReadbackChecks)
        ? rootReadbackChecks
        : 0,
      root_payload_mismatches: Number.isFinite(rootPayloadMismatches)
        ? rootPayloadMismatches
        : -1,
      unresolved_trace_entries: unresolvedTraceCount,
      source_exchange_completeness_entries: sourceExchangeCompletenessCount,
      source_reference_rewrites:
        Number(mutationCounts.source_reference_rewrites ?? 0) || 0,
      ai_patch_evidence_entries:
        Number(mutationCounts.ai_patch_evidence_entries ?? 0) || 0,
      ai_classification_decision_entries:
        Number(mutationCounts.ai_classification_decision_entries ?? 0) || 0,
	      ai_location_decision_entries:
	        Number(mutationCounts.ai_location_decision_entries ?? 0) || 0,
      ai_identity_decision_entries:
        Number(mutationCounts.ai_identity_decision_entries ?? 0) || 0,
	      ai_semantic_evidence_entries:
	        (Number(mutationCounts.ai_patch_evidence_entries ?? 0) || 0) +
	        (Number(mutationCounts.ai_classification_decision_entries ?? 0) || 0) +
        (Number(mutationCounts.ai_location_decision_entries ?? 0) || 0) +
        (Number(mutationCounts.ai_identity_decision_entries ?? 0) || 0),
      full_context_ai_completion_required: fullContextCheck.required,
    },
    trace_queues: closeout.files?.trace_queues ?? null,
  };
}

function runDatasetImportCompletionReport(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-import-completion-report",
      usage: [
        "node scripts/foundry.mjs dataset-import-completion-report --task-dir .foundry/workspaces/<task-id> --out-dir .foundry/workspaces/<task-id>/import-completion",
        "node scripts/foundry.mjs dataset-import-completion-report --closeout-report <dataset-post-write-closeout-report.json> [--closeout-report <...>] --require-type process --out-dir <completion-dir>",
      ],
      purpose:
        "Build a read-only task-level completion report from one or more completed dataset-post-write-closeout reports. It never writes the database.",
      remote_write_mode: "read-only",
    };
  }

  const explicitCloseouts = unique([
    ...normalizedList(options.closeoutReport),
    ...normalizedList(options.closeoutReports),
    ...normalizedList(options.report),
  ]).map(resolveRepoPath);
  const taskDir = resolveRepoPath(options.taskDir || options.workspaceDir);
  const discoveredCloseouts = taskDir
    ? findFilesByName(taskDir, "dataset-post-write-closeout-report.json")
    : [];
  const closeoutPaths = unique(
    [...explicitCloseouts, ...discoveredCloseouts].filter(Boolean),
  );
  const requiredTypes = unique(
    [
      ...normalizedList(options.requireType),
      ...normalizedList(options.requiredType),
      ...normalizedList(options.requiredTypes),
    ].map((type) => type.toLowerCase()),
  );
  const expectedCloseoutCountText = asText(
    options.expectedCloseouts || options.expectedCloseoutCount,
  );
  const expectedCloseoutCount = expectedCloseoutCountText
    ? Number(expectedCloseoutCountText)
    : null;
  const outDir = resolveRepoPath(
    options.outDir ||
      (taskDir
        ? path.join(taskDir, "import-completion")
        : ".foundry/workspaces/import-completion"),
  );
  const blockers = [];

  if (!taskDir && explicitCloseouts.length === 0) {
    blockers.push({
      code: "completion_input_missing",
      message: "Provide --task-dir or at least one --closeout-report.",
    });
  }
  if (closeoutPaths.length === 0) {
    blockers.push({
      code: "completion_closeout_reports_missing",
      message:
        "Task completion requires at least one dataset-post-write-closeout-report.json.",
    });
  }
  if (
    expectedCloseoutCount !== null &&
    closeoutPaths.length !== expectedCloseoutCount
  ) {
    blockers.push({
      code: "completion_closeout_count_mismatch",
      message: `Expected ${expectedCloseoutCount} closeout reports but found ${closeoutPaths.length}.`,
    });
  }

  const closeoutArtifacts = [];
  for (const closeoutPath of closeoutPaths) {
    if (!fileExists(closeoutPath)) {
      blockers.push({
        code: "completion_closeout_report_unreadable",
        message: "Closeout report is not readable.",
        closeout_report: closeoutPath ? repoRelativeMaybe(closeoutPath) : null,
      });
      continue;
    }
    closeoutArtifacts.push({
      path: closeoutPath,
      value: readJson(closeoutPath),
    });
  }

  const closeouts = closeoutArtifacts.map((artifact) =>
    closeoutCompletionSummary({ artifact, blockers }),
  );
  const datasetTypes = unique(
    closeouts.map((closeout) => closeout.dataset_type),
  );
  const closeoutsByScope = new Map();
  for (const closeout of closeouts) {
    const scopeKey = `${closeout.dataset_type || "unknown"}::${closeout.final_rows_file || "missing"}`;
    if (!closeoutsByScope.has(scopeKey)) {
      closeoutsByScope.set(scopeKey, []);
    }
    closeoutsByScope.get(scopeKey).push(closeout);
  }
  for (const [scopeKey, scopeCloseouts] of closeoutsByScope.entries()) {
    if (scopeCloseouts.length > 1) {
      blockers.push({
        code: "completion_duplicate_closeout_scope",
        message:
          "Multiple closeout reports point to the same dataset type and final rows file; task completion requires one closeout per committed write scope.",
        scope_key: scopeKey,
        closeout_reports: scopeCloseouts.map(
          (closeout) => closeout.closeout_report,
        ),
      });
    }
  }
  for (const requiredType of requiredTypes) {
    if (!datasetTypes.includes(requiredType)) {
      blockers.push({
        code: "completion_required_type_missing",
        message: `Required dataset type ${requiredType} has no completed closeout report.`,
        dataset_type: requiredType,
      });
    }
  }

  const reportPath = path.join(outDir, "dataset-import-completion-report.json");
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length === 0 ? "completed" : "blocked",
    task_id:
      asText(options.taskId || options.id) ||
      (taskDir ? path.basename(taskDir) : null),
    task_dir: repoRelativeMaybe(taskDir),
    remote_write_mode: "read-only",
    policy: {
      completion_boundary:
        "Task completion is read-only and requires every committed write scope to have a completed post-write closeout with attached finalize, mutation, readback, trace, and profile-required full schema/YAML/context AI evidence.",
      no_closeout_means_not_complete: true,
      source_language_only_before_import: true,
      unresolved_trace_policy:
        "Unresolved values that could not be safely inferred may enter only through structured common:other trace queues preserved by mutation manifests and closeouts.",
    },
    counts: {
      closeout_reports: closeouts.length,
      blockers: blockers.length,
      final_rows: closeouts.reduce(
        (total, closeout) => total + closeout.final_rows,
        0,
      ),
      dataset_types: datasetTypes.length,
      unique_write_scopes: closeoutsByScope.size,
      unresolved_trace_entries: closeouts.reduce(
        (total, closeout) => total + closeout.counts.unresolved_trace_entries,
        0,
      ),
      source_exchange_completeness_entries: closeouts.reduce(
        (total, closeout) =>
          total + closeout.counts.source_exchange_completeness_entries,
        0,
      ),
      source_reference_rewrites: closeouts.reduce(
        (total, closeout) =>
          total + (Number(closeout.counts.source_reference_rewrites ?? 0) || 0),
        0,
      ),
      ai_patch_evidence_entries: closeouts.reduce(
        (total, closeout) =>
          total + (Number(closeout.counts.ai_patch_evidence_entries ?? 0) || 0),
        0,
      ),
      ai_classification_decision_entries: closeouts.reduce(
        (total, closeout) =>
          total +
          (Number(closeout.counts.ai_classification_decision_entries ?? 0) ||
            0),
        0,
      ),
	      ai_location_decision_entries: closeouts.reduce(
	        (total, closeout) =>
	          total +
	          (Number(closeout.counts.ai_location_decision_entries ?? 0) || 0),
	        0,
	      ),
      ai_identity_decision_entries: closeouts.reduce(
        (total, closeout) =>
          total +
          (Number(closeout.counts.ai_identity_decision_entries ?? 0) || 0),
        0,
      ),
      ai_semantic_evidence_entries: closeouts.reduce(
        (total, closeout) =>
          total +
          (Number(closeout.counts.ai_semantic_evidence_entries ?? 0) || 0),
        0,
      ),
      full_context_scopes: closeouts.filter(
        (closeout) => closeout.counts.full_context_ai_completion_required,
      ).length,
    },
    dataset_types: datasetTypes,
    required_types: requiredTypes,
    closeouts,
    blockers,
    files: {
      report: repoRelativePath(reportPath),
    },
  };
  writeJson(reportPath, report);
  return report;
}

function runDatasetPostAuthoringFinalize(options) {
  const datasetType = String(options.type || options.datasetType || "process")
    .trim()
    .toLowerCase();
  const supportTypes = ["contact", "source"];
  const mixedSupportTypes = ["support"];
  const authoredTypes = ["process", "flow", "lifecyclemodel"];
  const supportedTypes = [...supportTypes, ...mixedSupportTypes, ...authoredTypes];
  const requiresDeterministicQa = authoredTypes.includes(datasetType);
  const requiresCurationGate = authoredTypes.includes(datasetType);
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-post-authoring-finalize",
      usage: [
        "node scripts/foundry.mjs dataset-post-authoring-finalize --type <support|contact|source|process|flow|lifecyclemodel> --rows-file <patched-or-classified-rows.jsonl> --out-dir <finalize-dir> --profile <profile> --queue-dir <queue-dir> --classification-queue <classification-authoring-queue.jsonl> --location-queue <location-authoring-queue.jsonl> --identity-preflight-index <identity-preflight-requests.jsonl> --run-identity-preflight --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <ruleset.json> --classification-decision-apply-report <classification-decisions-apply-report.json> --location-decision-apply-report <location-decisions-apply-report.json> --patch-collect-report <authoring-patch-collect-report.json> --patch-apply-report <dataset-patch-apply-report.json> --require-patch-collect-report --target-user-id <uuid> --verify-remote",
      ],
      purpose:
        "Run the post-AI authoring prewrite chain for support, process, flow, or lifecyclemodel rows: cleanup, SDK validate, location audit, dry-run publish/save, optional remote reference verification, and mutation manifest. Process/flow/lifecyclemodel rows additionally run deterministic QA and post-authoring curation gate. This command never commits rows.",
      remote_write_mode: "read-only",
      supported_types: supportedTypes,
    };
  }
  if (!supportedTypes.includes(datasetType)) {
    throw new Error(
      `dataset-post-authoring-finalize supports support, contact, source, process, flow, and lifecyclemodel rows. Unsupported type: ${datasetType}.`,
    );
  }

  const rowsFile = resolveRepoPath(
    options.rowsFile || options.input || options.rows,
  );
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error(
      "--rows-file is required and must point to patched or authored TIDAS rows.",
    );
  }

  const outDir = resolveRepoPath(
    options.outDir ||
      `.foundry/workspaces/${datasetType}-post-authoring-finalize`,
  );
  fs.mkdirSync(outDir, { recursive: true });
  const fullContextRequirement = profileFullContextRequirement(
    options.profile,
    datasetType,
  );
  const identityPreflightRequired =
    ["flow", "process"].includes(datasetType) &&
    (booleanOption(options.requireIdentityPreflight) ||
      Boolean(fullContextRequirement));
  const identityPreflightRunStage = runFinalizeIdentityPreflightStage({
    rowsFile,
    outDir,
    options,
  });

  const identityReferenceRewriteStage = applyIdentityReferenceRewrites({
    datasetType,
    rowsFile,
    outFile: path.join(
      outDir,
      "identity-reference-rewrites",
      `${datasetRowsFileStem(datasetType)}.identity-rewritten.jsonl`,
    ),
    outDir: path.join(outDir, "identity-reference-rewrites"),
    options,
    allowMissingIndex: true,
  });
  const identityReferenceRewriteFile = resolveRepoPath(
    identityReferenceRewriteStage.rewrite_file,
  );
  const identityRewrittenRowsFile =
    Number(identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0) > 0
      ? resolveRepoPath(identityReferenceRewriteStage.output_rows_file)
      : rowsFile;
  const unresolvedExchangeExternalizeStage =
    externalizeUnresolvedProcessFlowExchanges({
      datasetType,
      rowsFile: identityRewrittenRowsFile,
      outFile: path.join(
        outDir,
        "unresolved-exchange-externalization",
        `${datasetRowsFileStem(datasetType)}.unresolved-exchanges-externalized.jsonl`,
      ),
      outDir: path.join(outDir, "unresolved-exchange-externalization"),
      options,
    });
  const preCleanupRowsFile =
    Number(
      unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0,
    ) > 0
      ? resolveRepoPath(unresolvedExchangeExternalizeStage.output_rows_file)
      : identityRewrittenRowsFile;

  const canonicalSupportRewriteStage = applyCanonicalSupportRewrites({
    datasetType,
    rowsFile: preCleanupRowsFile,
    outFile: path.join(
      outDir,
      "canonical-support-rewrites",
      `${datasetRowsFileStem(datasetType)}.canonical-support-rewritten.jsonl`,
    ),
    outDir: path.join(outDir, "canonical-support-rewrites"),
    options,
  });
  const canonicalSupportRowsFile = resolveRepoPath(
    canonicalSupportRewriteStage.files?.output_rows ||
      canonicalSupportRewriteStage.output_rows_file,
  );
  const canonicalSupportReportFile = resolveRepoPath(
    canonicalSupportRewriteStage.files?.report,
  );
  const canonicalSupportPrewriteBlockers = ensureArray(
    canonicalSupportRewriteStage.blockers,
  ).map((blocker) => ({
    ...blocker,
    stage: "canonical_support_rewrites",
    source: "canonical_support_rewrites",
    severity: blocker.severity || "error",
  }));

  const cleanup = runDatasetCurationCleanup({
    repoRoot,
    options: {
      ...options,
      type: datasetType,
      rowsFile: canonicalSupportRowsFile || preCleanupRowsFile,
      outDir: path.join(outDir, "cleanup"),
      outFile:
        options.cleanedRowsFile || options.cleanedRows || options.outFile,
    },
  });
  const cleanedRowsFile = resolveRepoPath(
    cleanup.files?.cleaned_rows || cleanup.cleaned_rows_file,
  );
  const cleanupReportFile = resolveRepoPath(cleanup.files?.report);
  const curationQueueStage = runFinalizeAutoCurationQueue({
    datasetType,
    rowsFile,
    cleanedRowsFile,
    outDir,
    options,
    fullContextRequirement,
    identityReferenceRewriteStage,
  });
  const curationQueueDir =
    curationQueueStage.queue_dir ||
    resolveRepoPath(options.queueDir || options.curationQueueDir);

  const schemaOutDir = path.join(outDir, "schema", datasetType);
  const schemaStage = runTiangongJsonStage("schema_validate", [
      "dataset",
      "validate",
      "--type",
      datasetType === "support" ? "auto" : datasetType,
    "--input",
    cleanedRowsFile,
    "--out-dir",
    schemaOutDir,
    "--json",
  ]);
  schemaStage.report_file = reportFileFromCliStage(
    schemaStage,
    ["files.report"],
    path.join(schemaOutDir, "outputs", "validation-report.json"),
  );

  const qaOutDir = path.join(outDir, "qa", datasetType);
  const qaStage = requiresDeterministicQa
    ? runTiangongJsonStage(`${datasetType}_qa`, [
        "qa",
        datasetType,
        "--rows-file",
        cleanedRowsFile,
        "--out-dir",
        qaOutDir,
        "--json",
      ])
    : {
        stage: `${datasetType}_qa`,
        status: "not_required_for_support_rows",
        exit_code: 0,
        command: "skipped",
        args: [],
        stderr: "Support rows do not have a deterministic qa <type> gate.",
        report: { status: "not_required_for_support_rows" },
        report_file: null,
      };
  if (requiresDeterministicQa) {
    qaStage.report_file = reportFileFromCliStage(
      qaStage,
      ["files.report"],
      path.join(
        qaOutDir,
        datasetType === "flow"
          ? "flow_qa_report.json"
          : datasetType === "lifecyclemodel"
            ? "lifecyclemodel_qa_report.json"
            : "process-qa-report.json",
      ),
    );
  }

  const locationAuditOutDir = path.join(outDir, "location-audit", datasetType);
  const locationAuditStage = runTiangongJsonStage("location_audit", [
    "dataset",
    "classification",
    "audit",
    "--type",
    "location",
    "--input",
    cleanedRowsFile,
    "--out-dir",
    locationAuditOutDir,
    "--json",
  ]);
  locationAuditStage.report_file = reportFileFromCliStage(
    locationAuditStage,
    ["files.report"],
    path.join(locationAuditOutDir, "outputs", "location-audit-report.json"),
  );
  const locationAuditBlockers =
    blockersFromLocationAuditStage(locationAuditStage);

  const curationGate = requiresCurationGate
    ? runDatasetCurationGate({
        repoRoot,
        options: {
          ...options,
          type: datasetType,
          rowsFile: cleanedRowsFile,
          schemaReport: schemaStage.report_file,
          qaReport: qaStage.report_file,
	          outDir: path.join(outDir, "curation-gate"),
		          requireIdentityPreflight: identityPreflightRequired,
          identityReferenceRewrites: identityReferenceRewriteFile,
          classificationDecisionApplyReport:
            options.classificationDecisionApplyReport ||
            options.classificationDecisionsApplyReport,
          unresolvedExchangeExternalizationReport:
            unresolvedExchangeExternalizeStage.files?.report,
	          identityDecisionApplyReport:
            options.identityDecisionApplyReport ||
            options.identityDecisionsApplyReport,
	          queueDir: curationQueueDir,
          requireQueueContext:
            booleanOption(
              options.requireQueueContext ||
                options.requireCurationQueueContext,
            ) ||
            (Boolean(fullContextRequirement) && datasetType === "process"),
        },
      })
    : {
        status: "not_required_for_support_rows",
        files: {},
      };
  const curationGateReportFile = requiresCurationGate
    ? resolveRepoPath(curationGate.files?.report)
    : null;
  const prewriteGateBlockers = postAuthoringPrewriteGateBlockers({
    schemaStage,
    qaStage,
    locationAuditBlockers,
    curationGate,
    curationGateReportFile,
    requireDeterministicQa: requiresDeterministicQa,
    requireCurationGate: requiresCurationGate,
  }).concat(canonicalSupportPrewriteBlockers);
  const prewriteGateReady = prewriteGateBlockers.length === 0;

  const dryRunOutDir = path.join(
    outDir,
    "dry-run",
    datasetType === "support" || supportTypes.includes(datasetType)
      ? `${datasetType}-save-draft`
      : datasetType === "flow"
      ? "flow-publish-version"
      : datasetType === "lifecyclemodel"
        ? "lifecyclemodel-save-draft"
        : "process-save-draft",
  );
  const dryRunArgs = (() => {
    if (datasetType === "support" || supportTypes.includes(datasetType)) {
      return [
        "dataset",
        "save-draft",
        "--type",
        datasetType === "support" ? "auto" : datasetType,
        "--input",
        cleanedRowsFile,
        "--out-dir",
        dryRunOutDir,
        "--dry-run",
        "--json",
      ];
    }
    if (datasetType === "flow") {
      return [
        "flow",
        "publish-version",
        "--input-file",
        cleanedRowsFile,
        "--out-dir",
        dryRunOutDir,
        "--dry-run",
        "--json",
      ];
    }
    if (datasetType === "lifecyclemodel") {
      return [
        "lifecyclemodel",
        "save-draft",
        "--input",
        cleanedRowsFile,
        "--out-dir",
        dryRunOutDir,
        "--dry-run",
        "--json",
      ];
    }
    return [
      "process",
      "save-draft",
      "--input",
      cleanedRowsFile,
      "--out-dir",
      dryRunOutDir,
      "--dry-run",
      "--json",
    ];
  })();
  if (datasetType === "flow") {
    appendOption(
      dryRunArgs,
      "--target-user-id",
      options.remoteTargetUserId || options.targetUserId,
    );
  }
  const dryRunStage = prewriteGateReady
    ? runTiangongJsonStage(
        datasetType === "support" || supportTypes.includes(datasetType)
          ? `${datasetType}_save_draft_dry_run`
          : datasetType === "flow"
          ? "flow_publish_version_dry_run"
          : datasetType === "lifecyclemodel"
            ? "lifecyclemodel_save_draft_dry_run"
            : "process_save_draft_dry_run",
        dryRunArgs,
      )
    : skippedPrewriteStage(
        datasetType === "support" || supportTypes.includes(datasetType)
          ? `${datasetType}_save_draft_dry_run`
          : datasetType === "flow"
          ? "flow_publish_version_dry_run"
          : datasetType === "lifecyclemodel"
            ? "lifecyclemodel_save_draft_dry_run"
            : "process_save_draft_dry_run",
        "Skipped because schema, QA, canonical support, location audit, or post-authoring curation gate is not ready.",
      );
  if (prewriteGateReady) {
    dryRunStage.report_file = reportFileFromCliStage(
      dryRunStage,
      datasetType === "flow" ? ["files.report"] : ["files.summary_json"],
      datasetType === "support" || supportTypes.includes(datasetType)
        ? path.join(
            dryRunOutDir,
            "outputs",
            "dataset-save-draft",
            "summary.json",
          )
        : datasetType === "flow"
        ? path.join(
            dryRunOutDir,
            "flows_tidas_sdk_plus_classification_mcp_sync_report.json",
          )
        : datasetType === "lifecyclemodel"
          ? path.join(
              dryRunOutDir,
              "outputs",
              "save-draft-bundle",
              "summary.json",
            )
          : path.join(
              dryRunOutDir,
              "outputs",
              "save-draft-rpc",
              "summary.json",
            ),
    );
  }

  let remoteVerifyStage = null;
  let remoteVerifyReportFile = null;
  if (booleanOption(options.verifyRemote || options.precommitVerifyRemote)) {
    const remoteOutDir = path.join(outDir, "precommit-verify-remote");
    const remoteArgs = [
      "dataset",
      "verify-remote",
      "--input",
      cleanedRowsFile,
      "--out-dir",
      remoteOutDir,
      "--root-policy",
      String(options.remoteRootPolicy || options.rootPolicy || "candidate"),
      "--json",
    ];
    if (
      booleanOption(
        options.compareRootPayload || options.remoteCompareRootPayload,
      )
    ) {
      remoteArgs.push("--compare-root-payload");
    }
    appendOption(
      remoteArgs,
      "--target-user-id",
      options.remoteTargetUserId || options.targetUserId,
    );
    appendOption(
      remoteArgs,
      "--state-code",
      options.remoteStateCode || options.stateCode,
    );
    remoteVerifyStage = prewriteGateReady
      ? runTiangongJsonStage("remote_verify_precommit", remoteArgs)
      : skippedPrewriteStage(
          "remote_verify_precommit",
          "Skipped because schema, QA, canonical support, location audit, or post-authoring curation gate is not ready.",
        );
    if (prewriteGateReady) {
      remoteVerifyStage.report_file = reportFileFromCliStage(
        remoteVerifyStage,
        ["files.report"],
        path.join(remoteOutDir, "outputs", "remote-verification-report.json"),
      );
      remoteVerifyReportFile = remoteVerifyStage.report_file;
    }
  }

  const identityDecisionApplyReportOptions = unique([
    ...normalizedList(options.identityDecisionApplyReport),
    ...normalizedList(options.identityDecisionsApplyReport),
    ...normalizedList(options.identityDecisionApplyReports),
    ...normalizedList(options.identityDecisionsApplyReports),
  ]);
  const identityDecisionApplyReportFiles = identityDecisionApplyReportOptions
    .map(resolveRepoPath)
    .filter(fileExists);

  const mutationManifest = runDatasetMutationManifest({
    repoRoot,
    options: {
      ...options,
      type: datasetType,
      rowsFile: cleanedRowsFile,
      referenceRowsFile:
        identityReferenceRewriteStage.reference_rows_file ||
        options.referenceRowsFile ||
        options.referenceRows ||
        options.reuseRowsFile,
      schemaReport: schemaStage.report_file,
      qaReport: requiresDeterministicQa ? qaStage.report_file : null,
      curationGateReport: requiresCurationGate
        ? curationGateReportFile
        : null,
      cleanupReport: cleanupReportFile,
      canonicalSupportRewriteReport: canonicalSupportReportFile,
      dryRunReport: prewriteGateReady ? dryRunStage.report_file : null,
      remoteVerifyReport: remoteVerifyReportFile,
      unresolvedExchangeExternalizationReport:
        unresolvedExchangeExternalizeStage.files?.report,
      classificationDecisionApplyReport:
        options.classificationDecisionApplyReport ||
        options.classificationDecisionsApplyReport,
	      locationDecisionApplyReport:
	        options.locationDecisionApplyReport ||
	        options.locationDecisionsApplyReport,
      identityDecisionApplyReport:
        options.identityDecisionApplyReport ||
        options.identityDecisionsApplyReport,
      identityDecisionApplyReports: identityDecisionApplyReportOptions,
      identityReferenceRewriteStatus: identityReferenceRewriteStage.status,
      identityReferenceRewriteInputRows: rowsFile,
      identityReferenceRewriteOutputRows:
        identityReferenceRewriteStage.output_rows_file,
	      sourceReferenceRewrites: sourceReferenceRewritesFileForRowsFile(
        rowsFile,
        options,
      ),
      identityReferenceRewrites: identityReferenceRewriteFile,
      outDir: path.join(outDir, "mutation-manifest"),
      requireCurationGate: requiresCurationGate,
    },
  });
  const patchApplyReportFile = resolveRepoPath(options.patchApplyReport);
  const patchCollectReportFile = resolveRepoPath(
    options.patchCollectReport || options.authoringPatchCollectReport,
  );
  const classificationDecisionApplyReportFile = resolveRepoPath(
    options.classificationDecisionApplyReport ||
      options.classificationDecisionsApplyReport,
  );
	  const locationDecisionApplyReportFile = resolveRepoPath(
	    options.locationDecisionApplyReport || options.locationDecisionsApplyReport,
	  );
  const stageReports = [
    {
      stage: "identity_preflight_run",
      status: identityPreflightRunStage.status,
      exit_code:
        [
          "not_requested",
          "planned",
          "completed",
          "completed_with_identity_findings",
        ].includes(identityPreflightRunStage.status)
          ? 0
          : 1,
      command:
        identityPreflightRunStage.status === "not_requested"
          ? "skipped"
          : "foundry.dataset-identity-preflight-run",
      args: [],
      stderr: "",
      report_file: identityPreflightRunStage.report_file,
    },
    {
      stage: "identity_reference_rewrites",
      status: identityReferenceRewriteStage.status,
      exit_code: identityReferenceRewriteStage.blockers.length > 0 ? 1 : 0,
      command: "foundry.dataset-identity-reference-rewrites-apply",
      args: [],
      stderr: "",
      report_file: null,
    },
    {
      stage: "unresolved_exchange_externalization",
      status: unresolvedExchangeExternalizeStage.status,
      exit_code: 0,
      command: "foundry.externalize-unresolved-process-flow-exchanges",
      args: [],
      stderr: "",
      report_file: resolveRepoPath(unresolvedExchangeExternalizeStage.files?.report),
    },
    {
      stage: "canonical_support_rewrites",
      status: canonicalSupportRewriteStage.status,
      exit_code:
        canonicalSupportRewriteStage.counts?.blockers > 0 ? 1 : 0,
      command: "foundry.dataset-canonical-support-rewrites-apply",
      args: [],
      stderr: "",
      report_file: canonicalSupportReportFile,
    },
    {
      stage: "curation_cleanup",
      status: cleanup.status,
      exit_code: 0,
      command: "foundry.dataset-curation-cleanup",
      args: [],
      stderr: "",
      report_file: cleanupReportFile,
    },
    {
      stage: "curation_queue",
      status: curationQueueStage.status,
      exit_code:
        curationQueueStage.status === "not_required" ||
        curationQueueStage.status === "provided" ||
        curationQueueStage.status === "ready"
          ? 0
          : 1,
      command:
        curationQueueStage.status === "not_required" ||
        curationQueueStage.status === "provided"
          ? "skipped"
          : "foundry.dataset-curation-queue-build",
      args: [],
      stderr:
        curationQueueStage.report?.foundry_wrapper?.stderr ||
        "",
      report_file: curationQueueStage.report_file,
    },
    schemaStage,
    qaStage,
    locationAuditStage,
    {
      stage: "post_authoring_curation_gate",
      status: curationGate.status,
      exit_code:
        !requiresCurationGate ||
        ["ready", "ready_with_profile_waivers"].includes(curationGate.status)
          ? 0
          : 1,
      command: "foundry.dataset-curation-gate",
      args: [],
      stderr: "",
      report_file: curationGateReportFile,
    },
    dryRunStage,
    ...(remoteVerifyStage ? [remoteVerifyStage] : []),
    {
      stage: "mutation_manifest",
      status: mutationManifest.status,
      exit_code: ["ready_for_remote_write", "ready_reference_only"].includes(
        mutationManifest.status,
      )
        ? 0
        : 1,
      command: "foundry.dataset-mutation-manifest",
      args: [],
      stderr: "",
      report_file: resolveRepoPath(mutationManifest.files?.report),
    },
  ];
  const mutationBlockerCount = Number(mutationManifest.counts?.blockers ?? 0);
  const mutationManifestBlockers = [];
  const seenMutationBlockers = new Set();
  const addMutationBlocker = (blocker, extra = {}) => {
    if (!blocker || typeof blocker !== "object") return;
    const normalized = {
      ...blocker,
      stage: blocker.stage || "mutation_manifest",
      source: "mutation_manifest",
      ...extra,
    };
    const key = JSON.stringify([
      normalized.code,
      normalized.stage,
      normalized.row_index,
      normalized.table,
      normalized.reference_id,
      normalized.reference_version,
      normalized.path,
    ]);
    if (seenMutationBlockers.has(key)) return;
    seenMutationBlockers.add(key);
    mutationManifestBlockers.push(normalized);
  };
  for (const blocker of ensureArray(mutationManifest.evidence?.scope_blockers)) {
    addMutationBlocker(blocker);
  }
  for (const item of ensureArray(mutationManifest.items)) {
    for (const blocker of ensureArray(item?.blockers)) {
      addMutationBlocker(blocker, {
        dataset_type: item?.dataset_type ?? null,
        entity_id: item?.entity_id ?? null,
        version: item?.version ?? null,
      });
    }
  }
  const blockerCount = mutationBlockerCount + prewriteGateBlockers.length;
  const status =
    prewriteGateBlockers.length > 0
      ? "blocked"
      : mutationManifest.status === "ready_for_remote_write"
        ? "ready_for_remote_write"
        : mutationBlockerCount > 0
          ? "blocked"
          : mutationManifest.status;
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status,
    dataset_type: datasetType,
    profile: mutationManifest.profile || String(options.profile || "generic"),
    rows_file: repoRelativePath(rowsFile),
    pre_cleanup_rows_file: repoRelativeMaybe(preCleanupRowsFile),
    canonical_support_rows_file: repoRelativeMaybe(canonicalSupportRowsFile),
    final_rows_file: repoRelativeMaybe(cleanedRowsFile),
    remote_write_mode: "read-only",
    policy: {
      purpose:
        "Finalize AI-authored or support TIDAS rows into exact-scope prewrite evidence without committing to the database.",
      commit_boundary:
        "A later explicit CLI commit command is required after this report and mutation manifest are ready.",
      source_language_only_before_import: true,
      full_context_ai_patch_evidence:
        "When the active profile requires full-context AI completion, mutation manifest must prove deterministic AI semantic evidence: classification/location decision apply evidence for queued decisions, or patch collect/apply evidence with authoring package hash, closed action items, resolution.mode, and resolution.used_context_kinds for field patches.",
      identity_preflight_gate:
        identityPreflightRequired
          ? "Process/flow full-context profiles require completed CLI identity-preflight evidence from flow_hybrid_search/process_hybrid_search before post-authoring dry-run or remote write planning."
          : "Not required for this dataset type/profile unless --require-identity-preflight is provided.",
      location_code_audit:
        "Final rows must pass tiangong-lca dataset classification audit --type location against tidas_locations_category.json before remote write.",
    },
    counts: {
      blockers: blockerCount,
      mutation_manifest_blockers: mutationBlockerCount,
      prewrite_gate_blockers: prewriteGateBlockers.length,
      canonical_support_blockers:
        canonicalSupportRewriteStage.counts?.blockers ?? 0,
      canonical_support_input_rows:
        canonicalSupportRewriteStage.counts?.input_rows ?? null,
      canonical_support_output_rows:
        canonicalSupportRewriteStage.counts?.output_rows ?? null,
      canonical_support_deferred_rows:
        canonicalSupportRewriteStage.counts?.deferred_rows ?? 0,
      canonical_support_deferred_blockers:
        canonicalSupportRewriteStage.counts?.deferred_blockers ?? 0,
      canonical_flow_property_reference_rewrites:
        canonicalSupportRewriteStage.counts
          ?.canonical_flow_property_reference_rewrites ?? 0,
      canonical_unit_group_reference_proofs:
        canonicalSupportRewriteStage.counts
          ?.canonical_unit_group_reference_proofs ?? 0,
      full_context_ai_completion_required: Boolean(fullContextRequirement),
      identity_preflight_required: identityPreflightRequired,
      identity_preflight_run_selected:
        identityPreflightRunStage.report?.counts?.selected_rows ?? 0,
      identity_preflight_run_completed:
        identityPreflightRunStage.report?.counts?.completed ?? 0,
      identity_preflight_run_skipped_existing:
        identityPreflightRunStage.report?.counts?.skipped_existing_report ?? 0,
      identity_preflight_run_failed:
        identityPreflightRunStage.report?.counts?.failed ?? 0,
      location_audit_blockers: locationAuditBlockers.length,
      location_code_targets:
        locationAuditStage.report?.counts?.location_targets ?? 0,
      location_code_invalid: locationAuditStage.report?.counts?.invalid ?? 0,
      write_candidates: mutationManifest.counts?.write_candidates ?? 0,
      ai_patch_evidence_entries:
        mutationManifest.counts?.ai_patch_evidence_entries ?? 0,
      ai_classification_decision_entries:
        mutationManifest.counts?.ai_classification_decision_entries ?? 0,
	      ai_location_decision_entries:
	        mutationManifest.counts?.ai_location_decision_entries ?? 0,
      ai_identity_decision_entries:
        mutationManifest.counts?.ai_identity_decision_entries ?? 0,
	      ai_semantic_evidence_entries:
	        (Number(mutationManifest.counts?.ai_patch_evidence_entries ?? 0) ||
	          0) +
	        (Number(
	          mutationManifest.counts?.ai_classification_decision_entries ?? 0,
	        ) || 0) +
        (Number(mutationManifest.counts?.ai_location_decision_entries ?? 0) ||
          0) +
        (Number(mutationManifest.counts?.ai_identity_decision_entries ?? 0) ||
          0),
      unresolved_trace_entries:
        mutationManifest.counts?.unresolved_trace_entries ?? 0,
      unresolved_exchange_externalized:
        unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0,
      blocked_flow_dependency_externalized:
        unresolvedExchangeExternalizeStage.counts
          ?.blocked_flow_dependency_externalized ?? 0,
      source_exchange_completeness_entries:
        mutationManifest.counts?.source_exchange_completeness_entries ?? 0,
      source_reference_rewrites:
        mutationManifest.counts?.source_reference_rewrites ?? 0,
      identity_reference_rewrites:
        mutationManifest.counts?.identity_reference_rewrites ?? 0,
      identity_flow_reference_rewrites:
        identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0,
      identity_reference_reuse_rows:
        identityReferenceRewriteStage.counts?.reference_rows ?? 0,
      curation_queue_status:
        curationQueueStage.status === "not_required"
          ? "not_required"
          : curationQueueStage.status,
      curation_queue_blockers:
        curationQueueStage.report?.counts?.blockers ?? 0,
      curation_queue_tasks:
        curationQueueStage.report?.counts?.tasks ?? 0,
      curation_queue_process_rows:
        curationQueueStage.report?.counts?.process_rows ?? 0,
      curation_queue_flow_rows:
        curationQueueStage.report?.counts?.flow_rows ?? 0,
      curation_queue_external_flow_refs:
        curationQueueStage.report?.counts?.external_flow_refs ?? 0,
      full_context_scope_blockers:
        mutationManifest.evidence?.scope_blockers?.filter((blocker) =>
          String(blocker?.stage ?? "").includes("full_context_ai_completion"),
        ).length ?? 0,
    },
    blockers: [...prewriteGateBlockers, ...mutationManifestBlockers],
    stages: stageReports.map(compactStageReport),
    files: {
      cleanup_report: repoRelativeMaybe(cleanupReportFile),
      canonical_support_rewrite_report:
        repoRelativeMaybe(canonicalSupportReportFile),
      canonical_support_rewritten_rows:
        repoRelativeMaybe(canonicalSupportRowsFile),
      canonical_support_deferred_rows:
        canonicalSupportRewriteStage.files?.deferred_rows ?? null,
      canonical_support_rewrites:
        canonicalSupportRewriteStage.files?.canonical_support_rewrites ?? null,
      canonical_support_blockers:
        canonicalSupportRewriteStage.files?.canonical_support_blockers ?? null,
      identity_reference_rewrites:
        identityReferenceRewriteStage.rewrite_file ?? null,
      identity_preflight_run_report:
        repoRelativeMaybe(identityPreflightRunStage.report_file),
      identity_rewritten_rows:
        Number(identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0) > 0
          ? identityReferenceRewriteStage.output_rows_file
          : null,
      unresolved_exchange_externalization_report:
        unresolvedExchangeExternalizeStage.files?.report ?? null,
      unresolved_exchange_externalized_rows:
        Number(
          unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0,
        ) > 0
          ? unresolvedExchangeExternalizeStage.files?.output_rows
          : null,
      unresolved_exchange_traces:
        unresolvedExchangeExternalizeStage.files?.traces ?? null,
      identity_reference_reuse_rows:
        identityReferenceRewriteStage.reference_rows_file ?? null,
      curation_queue_dir: repoRelativeMaybe(curationQueueDir),
      curation_queue_report: repoRelativeMaybe(curationQueueStage.report_file),
      curation_queue_identity_external_flow_refs:
        curationQueueStage.files?.identity_external_flow_refs ?? null,
      curation_queue_process_reference_external_flow_refs:
        curationQueueStage.files?.process_reference_external_flow_refs ?? null,
      final_rows: repoRelativeMaybe(cleanedRowsFile),
      schema_report: repoRelativeMaybe(schemaStage.report_file),
      qa_report: repoRelativeMaybe(qaStage.report_file),
      location_audit_report: repoRelativeMaybe(locationAuditStage.report_file),
      curation_gate_report: repoRelativeMaybe(curationGateReportFile),
      patch_collect_report: repoRelativeMaybe(patchCollectReportFile),
      patch_apply_report: repoRelativeMaybe(patchApplyReportFile),
      classification_decision_apply_report: repoRelativeMaybe(
        classificationDecisionApplyReportFile,
      ),
	      location_decision_apply_report: repoRelativeMaybe(
	        locationDecisionApplyReportFile,
	      ),
      identity_decision_apply_reports: identityDecisionApplyReportFiles.map((file) =>
        repoRelativePath(file),
      ),
	      patch_evidence: mutationManifest.evidence?.patch_evidence_file ?? null,
      dry_run_report: repoRelativeMaybe(dryRunStage.report_file),
      remote_verify_report: repoRelativeMaybe(remoteVerifyReportFile),
      mutation_manifest: mutationManifest.files?.report ?? null,
      unresolved_traces: mutationManifest.files?.unresolved_traces ?? null,
      source_exchange_completeness_traces:
        mutationManifest.files?.source_exchange_completeness_traces ?? null,
      source_reference_rewrites:
        mutationManifest.files?.source_reference_rewrites ?? null,
      mutation_identity_reference_rewrites:
        mutationManifest.files?.identity_reference_rewrites ?? null,
    },
  };
  const reportPath = path.join(
    outDir,
    "dataset-post-authoring-finalize-report.json",
  );
  writeJson(reportPath, report);
  const commitHandoffPlan = runDatasetCommitHandoffPlan({
    finalizeReport: reportPath,
    outDir: path.join(outDir, "commit-handoff"),
    stateCode:
      options.commitStateCode ??
      options.postWriteStateCode ??
      options.stateCode,
    targetUserId: options.targetUserId,
    rootPolicy:
      options.postWriteRootPolicy ||
      options.rootPolicy ||
      options.remoteRootPolicy,
  });
  const finalReport = {
    ...report,
    counts: {
      ...report.counts,
      commit_handoff_blockers: commitHandoffPlan.counts?.blockers ?? 0,
    },
    commit_handoff: {
      status: commitHandoffPlan.status,
      command: commitHandoffPlan.commands?.commit ?? null,
      post_write_verify_command:
        commitHandoffPlan.commands?.post_write_verify ?? null,
      blockers: commitHandoffPlan.blockers ?? [],
    },
    files: {
      ...report.files,
      commit_handoff_plan: commitHandoffPlan.files?.report ?? null,
    },
  };
  writeJson(reportPath, finalReport);
  return {
    ...finalReport,
    files: {
      ...finalReport.files,
      report: repoRelativePath(reportPath),
    },
  };
}

const bundleRowTypes = {
  contact: {
    plural: "contacts",
    rootKey: "contactDataSet",
    informationKey: "contactInformation",
  },
  source: {
    plural: "sources",
    rootKey: "sourceDataSet",
    informationKey: "sourceInformation",
  },
  unitgroup: {
    plural: "unitgroups",
    rootKey: "unitGroupDataSet",
    informationKey: "unitGroupInformation",
  },
  flowproperty: {
    plural: "flowproperties",
    rootKey: "flowPropertyDataSet",
    informationKey: "flowPropertiesInformation",
  },
  flow: {
    plural: "flows",
    rootKey: "flowDataSet",
    informationKey: "flowInformation",
  },
  process: {
    plural: "processes",
    rootKey: "processDataSet",
    informationKey: "processInformation",
  },
  lifecyclemodel: {
    plural: "lifecyclemodels",
    rootKey: "lifeCycleModelDataSet",
    informationKey: "lifeCycleModelInformation",
  },
};

const bundleRowTypeOrder = [
  "contact",
  "source",
  "unitgroup",
  "flowproperty",
  "flow",
  "process",
  "lifecyclemodel",
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicUuid(input) {
  const bytes = Buffer.from(
    createHash("sha1").update(String(input)).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function multiLang(text, language = "en") {
  return {
    "@xml:lang": language,
    "#text": String(text ?? "").trim(),
  };
}

function containsCjk(text) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(text ?? ""));
}

function languageForText(text, fallback = "en") {
  const value = String(text ?? "").trim();
  if (!value) return fallback;
  return containsCjk(value) ? "zh" : "en";
}

function preferredSourceLanguageText(values) {
  const texts = ensureArray(values).map(asText).filter(Boolean);
  return texts.find((text) => !containsCjk(text)) || texts[0] || "";
}

function contactGlobalReference({
  id,
  version,
  shortDescription,
  language = "en",
}) {
  return {
    "@type": "contact data set",
    "@refObjectId": id,
    "@version": version,
    "@uri": `../contacts/${id}.json`,
    "common:shortDescription": multiLang(shortDescription, language),
  };
}

const defaultCanonicalSupportCacheFile =
  "specs/canonical-support/flow-properties-unit-groups.json";

function supportText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number")
    return String(value).trim();
  if (Array.isArray(value)) {
    return value.map(supportText).filter(Boolean).join(" | ");
  }
  if (typeof value === "object") {
    if (typeof value["#text"] === "string") return value["#text"].trim();
    return Object.values(value).map(supportText).filter(Boolean).join(" | ");
  }
  return "";
}

function normalizeSupportKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u00b2/gu, "2")
    .replace(/\u00b3/gu, "3")
    .replace(/\u00b5/gu, "u")
    .replace(/[\u00b7\u2219]/gu, "*")
    .replace(/\s+/gu, "")
    .replace(/\./gu, "");
}

function canonicalSupportCachePath(options = {}) {
  return resolveRepoPath(
    options.canonicalSupportCache ||
      options.supportCache ||
      options.cacheFile ||
      defaultCanonicalSupportCacheFile,
  );
}

function flowPropertyReferenceText(reference) {
  return supportText(
    reference?.["common:shortDescription"] ??
      reference?.shortDescription ??
      reference?.name,
  );
}

function unitFromFlowPropertyReference(reference) {
  const text = flowPropertyReferenceText(reference);
  const match = text.match(/^amount\s+in\s+(.+)$/iu);
  return match ? match[1].trim() : text;
}

function buildCanonicalSupportIndex(cache) {
  const flowPropertyById = new Map();
  for (const row of ensureArray(cache?.flow_properties)) {
    const id = asText(row?.id);
    if (id) flowPropertyById.set(id, row);
  }
  const unitGroupById = new Map();
  for (const row of ensureArray(cache?.unit_groups)) {
    const id = asText(row?.id);
    if (id) unitGroupById.set(id, row);
  }
  const flowPropertyMappingByUnit = new Map();
  for (const mapping of ensureArray(cache?.flow_property_mappings)) {
    const canonicalId = asText(mapping?.canonical_flow_property_id);
    for (const unit of ensureArray(mapping?.source_units)) {
      const key = normalizeSupportKey(unit);
      if (key) flowPropertyMappingByUnit.set(key, { ...mapping, canonicalId });
    }
  }
  return { flowPropertyById, flowPropertyMappingByUnit, unitGroupById };
}

function loadCanonicalSupportCache(options = {}) {
  const cachePath = canonicalSupportCachePath(options);
  if (!cachePath || !fileExists(cachePath)) {
    return { cache: null, cachePath, index: buildCanonicalSupportIndex(null) };
  }
  const cache = readJson(cachePath);
  return { cache, cachePath, index: buildCanonicalSupportIndex(cache) };
}

function canonicalFlowPropertyReference(entry, language = "en") {
  const id = asText(entry?.id);
  const version = asText(entry?.version);
  const rawShortDescription =
    supportText(entry?.reference_short_description) ||
    supportText(entry?.short_description) ||
    supportText(entry?.name) ||
    id;
  const shortDescription = rawShortDescription.split("|")[0].trim() || id;
  return {
    "@type": "flow property data set",
    "@refObjectId": id,
    "@version": version,
    "@uri": `../flowproperties/${id}.json`,
    "common:shortDescription": multiLang(shortDescription, language),
  };
}

function canonicalFlowPropertyUnitGroupProof(entry, cacheContext) {
  const referenceUnitGroup = entry?.reference_unit_group ?? {};
  const unitGroupId = asText(
    referenceUnitGroup.id ??
      referenceUnitGroup.ref_object_id ??
      referenceUnitGroup["@refObjectId"],
  );
  const unitGroup = unitGroupId
    ? cacheContext.index.unitGroupById.get(unitGroupId)
    : null;
  const unitGroupVersion =
    asText(referenceUnitGroup.version ?? referenceUnitGroup["@version"]) ||
    asText(unitGroup?.version) ||
    null;
  const shortDescription =
    supportText(referenceUnitGroup.short_description) ||
    supportText(referenceUnitGroup["common:shortDescription"]) ||
    supportText(unitGroup?.short_description) ||
    supportText(unitGroup?.name) ||
    null;
  return {
    proven: Boolean(unitGroupId && unitGroup),
    ref_object_id: unitGroupId || null,
    version: unitGroupVersion,
    short_description: shortDescription,
  };
}

function rewriteCanonicalFlowPropertyReferences(
  value,
  {
    cacheContext,
    datasetType,
    sourceFile,
    stats,
    rewriteRows,
    blockers,
    datasetIdentityCache,
    rowIndex = null,
    language = "en",
    pathSegments = [],
  },
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
        rewriteCanonicalFlowPropertyReferences(item, {
          cacheContext,
          datasetType,
          sourceFile,
          stats,
          rewriteRows,
          blockers,
          datasetIdentityCache,
          rowIndex,
          language,
          pathSegments: [...pathSegments, index],
        }),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathSegments, key];
    if (
      key === "referenceToFlowPropertyDataSet" &&
      child &&
      typeof child === "object" &&
      !Array.isArray(child)
    ) {
      const originalId = asText(child["@refObjectId"]);
      const originalVersion = asText(child["@version"]);
      const unit = unitFromFlowPropertyReference(child);
      const normalizedUnit = normalizeSupportKey(unit);
      const alreadyCanonical =
        originalId && cacheContext.index.flowPropertyById.has(originalId);
      const mapping = cacheContext.index.flowPropertyMappingByUnit.get(
        normalizedUnit,
      );
      const canonical = mapping
        ? cacheContext.index.flowPropertyById.get(mapping.canonicalId)
        : null;
      const provenCanonical = alreadyCanonical
        ? cacheContext.index.flowPropertyById.get(originalId)
        : canonical;
      const unitGroupProof = provenCanonical
        ? canonicalFlowPropertyUnitGroupProof(provenCanonical, cacheContext)
        : null;
      if (provenCanonical && !unitGroupProof?.proven) {
        blockers.push({
          code: "canonical_flow_property_unit_group_unproven",
          message:
            "The selected canonical Flow Property must prove its Reference Unit Group through the local canonical support cache. Foundry must not create account-local Unit Group support rows.",
          dataset_type: datasetType,
          dataset_id: datasetIdentityCache?.id ?? null,
          dataset_version: datasetIdentityCache?.version ?? null,
          row_index: rowIndex,
          source_file: repoRelativeMaybe(sourceFile),
          path: pathExpression(childPath),
          source_unit: unit || null,
          original_ref_object_id: originalId || null,
          canonical_flow_property_id: asText(provenCanonical.id) || null,
          canonical_reference_unit_group_id:
            unitGroupProof?.ref_object_id ?? null,
          required_resolution:
            "Refresh specs/canonical-support/flow-properties-unit-groups.json from the database or select a canonical Flow Property whose Reference Unit Group is present in that cache.",
        });
        continue;
      }
      if (!alreadyCanonical && canonical) {
        const next = canonicalFlowPropertyReference(canonical, language);
        value[key] = next;
        stats.canonical_flow_property_reference_rewrites += 1;
        stats.canonical_unit_group_reference_proofs += 1;
        rewriteRows.push({
          relation: "flow_property_reference_to_canonical_support",
          dataset_type: datasetType,
          dataset_id: datasetIdentityCache?.id ?? null,
          dataset_version: datasetIdentityCache?.version ?? null,
          row_index: rowIndex,
          source_file: repoRelativeMaybe(sourceFile),
          path: pathExpression(childPath),
          source_unit: unit,
          original: {
            ref_object_id: originalId || null,
            version: originalVersion || null,
            short_description: flowPropertyReferenceText(child) || null,
          },
          canonical: {
            ref_object_id: next["@refObjectId"],
            version: next["@version"],
            short_description: next["common:shortDescription"]["#text"],
          },
          canonical_reference_unit_group: unitGroupProof,
          mapping_reason: mapping.reason ?? null,
          legacy_support_note: mapping.legacy_support_note ?? null,
        });
      } else if (!alreadyCanonical) {
        blockers.push({
          code: "canonical_flow_property_reference_unresolved",
          message:
            "Flow property references must point to an existing canonical database row; Foundry must not write account-local flowproperty/unitgroup support rows.",
          dataset_type: datasetType,
          dataset_id: datasetIdentityCache?.id ?? null,
          dataset_version: datasetIdentityCache?.version ?? null,
          row_index: rowIndex,
          source_file: repoRelativeMaybe(sourceFile),
          path: pathExpression(childPath),
          source_unit: unit || null,
          original_ref_object_id: originalId || null,
          original_version: originalVersion || null,
          required_resolution:
            "Add or select a public canonical flow property mapping in the support cache, or block the import until the platform has the required canonical support row.",
        });
      }
      continue;
    }
    rewriteCanonicalFlowPropertyReferences(child, {
      cacheContext,
      datasetType,
      sourceFile,
      stats,
      rewriteRows,
      blockers,
      datasetIdentityCache,
      rowIndex,
      language,
      pathSegments: childPath,
    });
  }
}

function applyCanonicalSupportRewrites({
  datasetType,
  rowsFile,
  outFile,
  outDir,
  options = {},
}) {
  const resolvedOutDir =
    outDir || path.join(path.dirname(rowsFile), "canonical-support-rewrites");
  const resolvedOutFile =
    outFile ||
    path.join(
      resolvedOutDir,
      `${datasetRowsFileStem(datasetType)}.canonical-support-rewritten.jsonl`,
    );
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const cacheContext = loadCanonicalSupportCache(options);
  const rows = readRowsFile(rowsFile);
  const stats = {
    canonical_flow_property_reference_rewrites: 0,
    canonical_unit_group_reference_proofs: 0,
  };
  const rewriteRows = [];
  const blockers = [];
  const outputRows = rows.map((row, rowIndex) => {
    const next = cloneJson(row);
    rewriteCanonicalFlowPropertyReferences(next, {
      cacheContext,
      datasetType,
      sourceFile: rowsFile,
      stats,
      rewriteRows,
      blockers,
      datasetIdentityCache: datasetIdentity(next, datasetType),
      rowIndex,
      language: asText(options.language || options.lang || "en") || "en",
    });
    return next;
  });
  const deferBlockedRows =
    datasetType === "flow" &&
    blockers.length > 0 &&
    booleanOption(
      options.deferBlockedCanonicalSupportRows ||
        options.deferCanonicalSupportBlockedRows ||
        options.deferBlockedSupportRows,
    );
  const blockedRowIndexes = new Set(
    blockers
      .map((blocker) => Number(blocker.row_index))
      .filter((rowIndex) => Number.isInteger(rowIndex) && rowIndex >= 0),
  );
  const writeOutputRows = deferBlockedRows
    ? outputRows.filter((_, rowIndex) => !blockedRowIndexes.has(rowIndex))
    : outputRows;
  const deferredRows = deferBlockedRows
    ? outputRows.filter((_, rowIndex) => blockedRowIndexes.has(rowIndex))
    : [];

  const rewritesFile = path.join(
    resolvedOutDir,
    "canonical-support-rewrites.jsonl",
  );
  const blockersFile = path.join(
    resolvedOutDir,
    "canonical-support-blockers.jsonl",
  );
  const reportFile = path.join(
    resolvedOutDir,
    "canonical-support-rewrite-report.json",
  );
  const deferredRowsFile = path.join(
    resolvedOutDir,
    `${datasetRowsFileStem(datasetType)}.canonical-support-deferred.jsonl`,
  );
  writeJsonLines(resolvedOutFile, writeOutputRows);
  writeJsonLines(deferredRowsFile, deferredRows);
  writeJsonLines(rewritesFile, rewriteRows);
  writeJsonLines(blockersFile, blockers);
  const hardBlockers = deferBlockedRows ? [] : blockers;
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    command: "dataset-canonical-support-rewrites-apply",
    stage: "canonical_support_rewrites",
    status:
      deferBlockedRows
        ? "completed_with_deferred_rows"
        : blockers.length > 0
        ? "blocked"
        : rewriteRows.length > 0
          ? "completed"
          : "completed_no_rewrites",
    dataset_type: datasetType,
    remote_write_mode: "read-only",
    rows_file: repoRelativePath(rowsFile),
    output_rows_file: repoRelativePath(resolvedOutFile),
    policy: {
      reference_only_support:
        "Flow Properties and Unit Groups are reference-only support data for Foundry imports. Finalize must rewrite converted package-local flow property references to existing canonical database rows, or block before dry-run/remote write planning.",
      no_account_local_support_rows:
        "Foundry must not create account-local My Data rows for flowproperties or unitgroups.",
    },
    counts: {
      input_rows: rows.length,
      output_rows: writeOutputRows.length,
      deferred_rows: deferredRows.length,
      canonical_flow_property_reference_rewrites:
        stats.canonical_flow_property_reference_rewrites,
      canonical_unit_group_reference_proofs:
        stats.canonical_unit_group_reference_proofs,
      blockers: hardBlockers.length,
      deferred_blockers: deferBlockedRows ? blockers.length : 0,
    },
    files: {
      report: repoRelativePath(reportFile),
      output_rows: repoRelativePath(resolvedOutFile),
      deferred_rows:
        deferredRows.length > 0 ? repoRelativePath(deferredRowsFile) : null,
      canonical_support_rewrites: repoRelativePath(rewritesFile),
      canonical_support_blockers: repoRelativePath(blockersFile),
      canonical_support_cache: repoRelativeMaybe(cacheContext.cachePath),
    },
    blockers: hardBlockers,
    deferred_blockers: deferBlockedRows ? blockers : [],
  };
  writeJson(reportFile, report);
  return report;
}

function datasetIdentity(payload, type) {
  const config = bundleRowTypes[type];
  if (
    !config ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return { id: null, version: null };
  }
  const root =
    payload[config.rootKey] && typeof payload[config.rootKey] === "object"
      ? payload[config.rootKey]
      : {};
  const information =
    root[config.informationKey] &&
    typeof root[config.informationKey] === "object"
      ? root[config.informationKey]
      : {};
  const dataSetInformation =
    information.dataSetInformation &&
    typeof information.dataSetInformation === "object"
      ? information.dataSetInformation
      : {};
  const administrativeInformation =
    root.administrativeInformation &&
    typeof root.administrativeInformation === "object"
      ? root.administrativeInformation
      : {};
  const publicationAndOwnership =
    administrativeInformation.publicationAndOwnership &&
    typeof administrativeInformation.publicationAndOwnership === "object"
      ? administrativeInformation.publicationAndOwnership
      : {};
  return {
    id: asText(dataSetInformation["common:UUID"]) || null,
    version: asText(publicationAndOwnership["common:dataSetVersion"]) || null,
  };
}

function contactDescriptionText(reference) {
  const description = reference?.["common:shortDescription"];
  if (typeof description === "string") return description;
  if (
    description &&
    typeof description === "object" &&
    !Array.isArray(description)
  ) {
    return asText(description["#text"]) || asText(description.value);
  }
  return "";
}

function rewriteContactReferences(value, contactRef, stats) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rewriteContactReferences(item, contactRef, stats);
    return;
  }

  const refType = asText(value["@type"]).toLowerCase();
  const refObjectId = asText(value["@refObjectId"]);
  if (refObjectId && refType.includes("contact")) {
    stats.rewritten += 1;
    stats.previous_ids.add(refObjectId);
    const previousDescription = contactDescriptionText(value);
    if (previousDescription)
      stats.previous_descriptions.add(previousDescription);
    value["@type"] = contactRef["@type"];
    value["@refObjectId"] = contactRef["@refObjectId"];
    value["@version"] = contactRef["@version"];
    value["@uri"] = contactRef["@uri"];
    value["common:shortDescription"] = cloneJson(
      contactRef["common:shortDescription"],
    );
  }

  for (const child of Object.values(value)) {
    rewriteContactReferences(child, contactRef, stats);
  }
}

function isObjectEmpty(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function pathExpression(pathSegments) {
  return pathSegments.map(String).join(".");
}

function cleanEcoSpoldNameText(text) {
  return String(text ?? "")
    .replace(/^\s*x+\s+/iu, "")
    .replace(/\s*\{[A-Za-z][A-Za-z0-9_-]*\}/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function sanitizePlaceholderText(text, pathSegments, stats) {
  const original = String(text ?? "");
  let next = original;
  if (/^\s*0\s+Not declared in source package\s*$/iu.test(next)) {
    next = "Not specified";
  }
  if (
    next.trim().toLowerCase().includes("not declared in source package") ||
    next
      .trim()
      .toLowerCase()
      .includes("source package metadata not declared") ||
    next.trim() === "<null>" ||
    next.trim() === "Not specified by the BAFU ecoSpold1 source."
  ) {
    next = "Not specified";
  }
  if (
    pathSegments.includes("baseName") ||
    pathSegments.includes("common:shortDescription")
  ) {
    next = cleanEcoSpoldNameText(next);
  }
  if (next !== original) {
    stats.placeholder_text_replacements += 1;
  }
  return next;
}

function bundleClassificationEntries(payload, type) {
  const config = bundleRowTypes[type];
  const root = payload?.[config?.rootKey];
  const information = root?.[config?.informationKey];
  const dataSetInformation = information?.dataSetInformation;
  const classes =
    dataSetInformation?.classificationInformation?.["common:classification"]?.[
      "common:class"
    ];
  return ensureArray(classes)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      level: asText(item["@level"]),
      class_id: asText(item["@classId"]),
      text: asText(item["#text"]),
    }))
    .filter((item) => item.text);
}

function bundleClassificationPath(payload, type) {
  return bundleClassificationEntries(payload, type)
    .map((entry) => entry.text)
    .join(" > ");
}

function isConvertedDefaultClassification(classificationPath) {
  return /Other service activities\s*>\s*Activities of membership organizations\s*>\s*Activities of other membership organizations\s*>\s*Activities of other membership organizations n\.e\.c\.|Community,\s*social and personal services\s*>\s*Sewage and waste collection,\s*treatment and disposal and other environmental protection services\s*>\s*Other environmental protection services n\.e\.c\./iu.test(
    classificationPath,
  );
}

function flowTypeOfDataSet(payload) {
  return asText(
    payload?.flowDataSet?.modellingAndValidation?.LCIMethod?.typeOfDataSet ??
      payload?.flowDataSet?.flowInformation?.dataSetInformation?.typeOfDataSet,
  );
}

function flowClassificationSchemaType(payload) {
  return /^elementary flow$/iu.test(flowTypeOfDataSet(payload))
    ? "flow-elementary"
    : "flow-product";
}

function processSourceClassificationSummary(sourceTraces) {
  for (const trace of sourceTraces) {
    const sourceClassification = trace?.sourceClassification;
    if (sourceClassification && typeof sourceClassification === "object") {
      return {
        category: asText(sourceClassification.category),
        subCategory: asText(sourceClassification.subCategory),
        localCategory: asText(sourceClassification.localCategory),
        localSubCategory: asText(sourceClassification.localSubCategory),
      };
    }
  }
  return {
    category: sourceTraceAttribute(sourceTraces, "category"),
    subCategory: sourceTraceAttribute(sourceTraces, "subCategory"),
    localCategory: sourceTraceAttribute(sourceTraces, "localCategory"),
    localSubCategory: sourceTraceAttribute(sourceTraces, "localSubCategory"),
  };
}

function processAuthoringContextFromTrace(sourceTraces) {
  return {
    source_name: sourceTraceAttribute(sourceTraces, "name"),
    source_local_name: sourceTraceAttribute(sourceTraces, "localName"),
    source_location: sourceTraceLocationCode(sourceTraces),
    source_unit: sourceTraceAttribute(sourceTraces, "unit"),
    general_comment: sourceTraceAttribute(sourceTraces, "generalComment"),
    included_processes: sourceTraceAttribute(sourceTraces, "includedProcesses"),
    technology: sourceTraceAttribute(sourceTraces, "text"),
  };
}

function textValue(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asText(value["#text"]) || asText(value.value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textValue(item);
      if (text) return text;
    }
  }
  return "";
}

function normalizedLookupKey(key) {
  return String(key ?? "")
    .split(":")
    .pop()
    .replace(/[^A-Za-z0-9]+/gu, "")
    .toLowerCase();
}

function collectValuesByNormalizedKey(value, wantedKeys, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectValuesByNormalizedKey(item, wantedKeys, output);
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    if (wantedKeys.has(normalizedLookupKey(key))) output.push(child);
    collectValuesByNormalizedKey(child, wantedKeys, output);
  }
  return output;
}

function collectTextsFromValue(value, output = []) {
  const direct = textValue(value);
  if (direct) {
    output.push(direct);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextsFromValue(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("@")) continue;
      collectTextsFromValue(child, output);
    }
  }
  return output;
}

function isSearchNoiseText(value) {
  const text = asText(value)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return true;
  if (
    /^(?:<null>|not specified|not declared|not known|unspecified|n\/a|none|null)$/iu.test(
      text,
    )
  ) {
    return true;
  }
  if (/^not specified by the .* source\.?$/iu.test(text)) return true;
  if (/^dataValidForEntirePeriod\s*=\s*true$/iu.test(text)) return true;
  if (/^ilcd format$/iu.test(text)) return true;
  if (/^ilcd data network\s*-\s*entry-level$/iu.test(text)) return true;
  return false;
}

function sanitizeSearchText(value) {
  return cleanEcoSpoldNameText(value)
    .replace(/\bGeography:\s*(?:Unspecified|Not specified|Not known)\b\.?/giu, "")
    .replace(/<null>/giu, "")
    .replace(/\bnot known\b/giu, "")
    .replace(/\s*\/\s*;?\s*$/u, "")
    .replace(/\s*;\s*$/u, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function normalizeSearchText(value) {
  return asText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function uniqueSearchTexts(values, limit = 6) {
  const byKey = new Map();
  for (const value of values.flat()) {
    for (const text of collectTextsFromValue(value)) {
      const cleaned = sanitizeSearchText(text);
      if (isSearchNoiseText(cleaned)) continue;
      const normalized = normalizeSearchText(cleaned);
      if (normalized && !byKey.has(normalized)) byKey.set(normalized, cleaned);
    }
  }
  return [...byKey.values()].slice(0, limit);
}

function truncateSearchText(value, maxChars = 240) {
  const text = asText(value).replace(/\s+/gu, " ").trim();
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function appendSearchBriefLine(lines, label, values, limit = 6, maxChars = 240) {
  const texts = uniqueSearchTexts(ensureArray(values), limit).map((text) =>
    truncateSearchText(text, maxChars),
  );
  if (texts.length > 0) lines.push(`${label}: ${texts.join("; ")}`);
}

function bundleClassificationPathForSearch(payload, type) {
  const classificationPath = bundleClassificationPath(payload, type);
  return isConvertedDefaultClassification(classificationPath)
    ? ""
    : classificationPath;
}

function sourceClassificationTextsForSearch(sourceClassification) {
  return [
    sourceClassification.category,
    sourceClassification.subCategory,
    sourceClassification.localCategory,
    sourceClassification.localSubCategory,
  ];
}

function processNameParts(payload) {
  const name =
    payload?.processDataSet?.processInformation?.dataSetInformation?.name ?? {};
  return {
    base_name: asText(name.baseName?.["#text"] ?? name.baseName),
    treatment_standards_routes: asText(
      name.treatmentStandardsRoutes?.["#text"] ??
        name.treatmentStandardsRoutes,
    ),
    mix_and_location_types: asText(
      name.mixAndLocationTypes?.["#text"] ?? name.mixAndLocationTypes,
    ),
    functional_unit_flow_properties: asText(
      name.functionalUnitFlowProperties?.["#text"] ??
        name.functionalUnitFlowProperties,
    ),
  };
}

function valuesByKeys(payload, keys, limit = 6) {
  const wanted = new Set(keys.map(normalizedLookupKey));
  return uniqueSearchTexts(collectValuesByNormalizedKey(payload, wanted), limit);
}

function isLikelyLocationCodeText(value) {
  const text = asText(value).trim();
  if (!text || /\s/u.test(text) || text.length > 24) return false;
  return /^[A-Za-z]{2,5}(?:-[A-Za-z0-9]{1,8})*$/u.test(text);
}

function locationCodeSearchTexts(values, limit = 4) {
  return uniqueSearchTexts(values, limit).filter(isLikelyLocationCodeText);
}

function processGeographySearchTexts(payload, sourceTraces = []) {
  const location =
    payload?.processDataSet?.processInformation?.geography
      ?.locationOfOperationSupplyOrProduction;
  return locationCodeSearchTexts([
    location?.["@location"],
    location?.location,
    sourceTraceLocationCode(sourceTraces),
  ]);
}

function elementaryFlowCategoryPath(payload) {
  const categories =
    payload?.flowDataSet?.flowInformation?.dataSetInformation
      ?.classificationInformation?.["common:elementaryFlowCategorization"]?.[
      "common:category"
    ];
  return ensureArray(categories)
    .map((entry) => textValue(entry))
    .filter(Boolean)
    .join(" > ");
}

function elementaryFlowCategoryPathForSearch(payload, sourceClassification) {
  const categoryPath = elementaryFlowCategoryPath(payload);
  if (!categoryPath) return "";
  const sourceText = sourceClassificationTextsForSearch(sourceClassification)
    .join(" ")
    .toLowerCase();
  if (
    sourceText &&
    /(?:resources?|land)/iu.test(sourceText) &&
    /emissions?\s*>\s*emissions?\s+to\s+air/iu.test(categoryPath)
  ) {
    return "";
  }
  return categoryPath;
}

function elementaryFlowCompartmentAliasesForSearch(payload, sourceClassification) {
  const categoryText = uniqueSearchTexts(
    [
      elementaryFlowCategoryPath(payload),
      ...sourceClassificationTextsForSearch(sourceClassification),
    ],
    12,
  )
    .join(" ")
    .toLowerCase();
  if (!categoryText) return [];
  const aliases = [];
  const isAir = /emissions?\s+to\s+air|air emissions?/iu.test(categoryText);
  if (
    isAir &&
    (/\blow\.?\s*pop\.?\b/iu.test(categoryText) ||
      /low\s+population/iu.test(categoryText) ||
      /non[-\s]?urban/iu.test(categoryText) ||
      /high\s+stacks?/iu.test(categoryText))
  ) {
    aliases.push(
      "Emissions to non-urban air or from high stacks",
      "non-urban air or from high stacks",
      "low population air emissions",
    );
  }
  if (
    isAir &&
    (/\bhigh\.?\s*pop\.?\b/iu.test(categoryText) ||
      /high\s+population/iu.test(categoryText) ||
      /urban\s+air\s+close\s+to\s+ground/iu.test(categoryText))
  ) {
    aliases.push(
      "Emissions to urban air close to ground",
      "urban air close to ground",
      "high population air emissions",
    );
  }
  if (isAir && /unspecified/iu.test(categoryText)) {
    aliases.push("Emissions to air, unspecified");
  }
  if (/fresh\s+water/iu.test(categoryText)) {
    aliases.push("Emissions to fresh water");
  }
  if (/sea\s+water|ocean/iu.test(categoryText)) {
    aliases.push("Emissions to sea water");
  }
  if (/water/iu.test(categoryText) && /unspecified/iu.test(categoryText)) {
    aliases.push("Emissions to water, unspecified");
  }
  if (/non[-\s]?agricultural\s+soil/iu.test(categoryText)) {
    aliases.push("Emissions to non-agricultural soil");
  } else if (/agricultural\s+soil/iu.test(categoryText)) {
    aliases.push("Emissions to agricultural soil");
  } else if (/soil/iu.test(categoryText) && /unspecified/iu.test(categoryText)) {
    aliases.push("Emissions to soil, unspecified");
  }
  return uniqueSearchTexts(aliases, 8);
}

function flowReferencePropertyTexts(payload) {
  const flowProperties = ensureArray(
    payload?.flowDataSet?.flowProperties?.flowProperty,
  );
  return uniqueSearchTexts(
    flowProperties.map((property) =>
      property?.referenceToFlowPropertyDataSet?.["common:shortDescription"] ??
      property?.referenceToFlowPropertyDataSet,
    ),
    4,
  );
}

function referenceDescriptionTexts(
  payload,
  keyNames,
  limit = 8,
  { includeIds = true } = {},
) {
  const wanted = new Set(keyNames.map(normalizedLookupKey));
  return uniqueSearchTexts(
    collectValuesByNormalizedKey(payload, wanted).map((reference) => {
      if (reference && typeof reference === "object" && !Array.isArray(reference)) {
        const descriptions = [
          reference["common:shortDescription"],
          reference.shortDescription,
        ];
        const descriptionTexts = uniqueSearchTexts(descriptions, 4);
        if (descriptionTexts.length > 0 || !includeIds) {
          return descriptionTexts;
        }
        return reference["@refObjectId"];
      }
      return reference;
    }),
    limit,
  );
}

function processReferenceFlowSearchTexts(payload, limit = 4) {
  const processDataSet = payload?.processDataSet ?? {};
  const referenceInternalIds = uniqueSearchTexts(
    ensureArray(
      processDataSet?.processInformation?.quantitativeReference
        ?.referenceToReferenceFlow,
    ),
    4,
  );
  const internalIdSet = new Set(referenceInternalIds.map((id) => normalizeSearchText(id)));
  const exchanges = ensureArray(processDataSet?.exchanges?.exchange).filter(
    (exchange) => exchange && typeof exchange === "object",
  );
  const referenceExchanges =
    internalIdSet.size > 0
      ? exchanges.filter((exchange) =>
          internalIdSet.has(normalizeSearchText(exchange?.["@dataSetInternalID"])),
        )
      : [];
  const selected = referenceExchanges.length > 0 ? referenceExchanges : exchanges.slice(0, 1);
  return uniqueSearchTexts(
    selected.flatMap((exchange) => {
      const reference = exchange?.referenceToFlowDataSet ?? {};
      const descriptions = [
        reference?.["common:shortDescription"],
        reference?.shortDescription,
      ];
      const descriptionTexts = uniqueSearchTexts(descriptions, limit);
      return descriptionTexts.length > 0
        ? descriptionTexts
        : [reference?.["@refObjectId"]];
    }),
    limit,
  );
}

function processExchangeSearchSignature(payload, limit = 12) {
  const exchanges = ensureArray(payload?.processDataSet?.exchanges?.exchange);
  return uniqueSearchTexts(
    exchanges.map((exchange) => {
      const reference = exchange?.referenceToFlowDataSet ?? {};
      const referenceText =
        textValue(reference?.["common:shortDescription"]) ||
        textValue(reference?.shortDescription) ||
        textValue(reference?.["@refObjectId"]) ||
        textValue(reference);
      const direction = textValue(
        exchange?.exchangeDirection ?? exchange?.inputGroup ?? exchange?.outputGroup,
      );
      const amount = textValue(
        exchange?.meanAmount ??
          exchange?.resultingAmount ??
          exchange?.amount ??
          exchange?.meanValue,
      );
      return [direction, referenceText, amount].filter(Boolean).join(" ");
    }),
    limit,
  );
}

function compactSearchBrief(lines) {
  return lines
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800)
    .trim();
}

function identityPreflightHybridSearchOptions() {
  return {
    match_threshold: 0.15,
    full_text_weight: 0.45,
    extracted_text_weight: 0.35,
    semantic_weight: 0.2,
    rrf_k: 30,
  };
}

function flowHybridSearchBrief(payload, sourceTraces = []) {
  const authoringContext = processAuthoringContextFromTrace(sourceTraces);
  const sourceClassification = processSourceClassificationSummary(sourceTraces);
  const nameParts = flowNameParts(payload);
  const lines = [];
  appendSearchBriefLine(
    lines,
    "flow name",
    [
      nameParts.base_name,
      nameParts.treatment_standards_routes,
      nameParts.mix_and_location_types,
      nameParts.functional_unit_flow_properties,
    ],
    4,
    180,
  );
  appendSearchBriefLine(lines, "flow type", flowTypeOfDataSet(payload), 1);
  appendSearchBriefLine(lines, "CAS", valuesByKeys(payload, ["CASNumber", "cas"]));
  appendSearchBriefLine(lines, "reference property", flowReferencePropertyTexts(payload));
  appendSearchBriefLine(lines, "reference unit", authoringContext.source_unit, 1);
  appendSearchBriefLine(lines, "category or compartment", [
    bundleClassificationPathForSearch(payload, "flow"),
    elementaryFlowCategoryPathForSearch(payload, sourceClassification),
    ...sourceClassificationTextsForSearch(sourceClassification),
  ]);
  appendSearchBriefLine(
    lines,
    "compartment aliases",
    elementaryFlowCompartmentAliasesForSearch(payload, sourceClassification),
  );
  appendSearchBriefLine(
    lines,
    "target classification candidate",
    bundleClassificationPathForSearch(payload, "flow"),
  );
  appendSearchBriefLine(
    lines,
    "source classification or compartment",
    sourceClassificationTextsForSearch(sourceClassification),
  );
  appendSearchBriefLine(lines, "geography or market", [
    ...valuesByKeys(payload, ["geography", "location", "market", "mixAndLocationTypes"]),
    authoringContext.source_location,
  ]);
  appendSearchBriefLine(lines, "source location", authoringContext.source_location);
  return compactSearchBrief(lines);
}

function processHybridSearchBrief(payload, sourceTraces = []) {
  const authoringContext = processAuthoringContextFromTrace(sourceTraces);
  const nameParts = processNameParts(payload);
  const lines = [];
  appendSearchBriefLine(
    lines,
    "process name",
    [
      nameParts.base_name,
      nameParts.treatment_standards_routes,
      nameParts.mix_and_location_types,
      nameParts.functional_unit_flow_properties,
      authoringContext.source_name,
      authoringContext.source_local_name,
    ],
    4,
    220,
  );
  appendSearchBriefLine(
    lines,
    "reference flow",
    processReferenceFlowSearchTexts(payload, 4),
  );
  appendSearchBriefLine(lines, "quantitative reference", valuesByKeys(payload, [
    "functionalUnitOrOther",
  ]));
  appendSearchBriefLine(lines, "geography", processGeographySearchTexts(payload, sourceTraces));
  appendSearchBriefLine(lines, "time", valuesByKeys(payload, [
    "time",
    "referenceYear",
    "timePeriod",
  ]));
  appendSearchBriefLine(lines, "classification or sector", [
    bundleClassificationPathForSearch(payload, "process"),
    ...sourceClassificationTextsForSearch(
      processSourceClassificationSummary(sourceTraces),
    ),
  ]);
  appendSearchBriefLine(
    lines,
    "target classification candidate",
    bundleClassificationPathForSearch(payload, "process"),
  );
  appendSearchBriefLine(
    lines,
    "source classification or sector",
    sourceClassificationTextsForSearch(processSourceClassificationSummary(sourceTraces)),
  );
  appendSearchBriefLine(lines, "technology route", [
    ...valuesByKeys(payload, [
      "technologyDescriptionAndIncludedProcesses",
      "treatmentStandardsRoutes",
    ]),
    authoringContext.technology,
  ], 2, 320);
  appendSearchBriefLine(lines, "system boundary", [
    authoringContext.included_processes,
  ], 2, 220);
  appendSearchBriefLine(
    lines,
    "exchange flow refs",
    referenceDescriptionTexts(payload, ["referenceToFlowDataSet"], 6, {
      includeIds: false,
    }),
    6,
    160,
  );
  appendSearchBriefLine(
    lines,
    "exchange signature",
    processExchangeSearchSignature(payload, 6),
    6,
    160,
  );
  return compactSearchBrief(lines);
}

function identityPreflightRemoteSearchRequest(type, payload, sourceTraces = []) {
  const query =
    type === "process"
      ? processHybridSearchBrief(payload, sourceTraces)
      : flowHybridSearchBrief(payload, sourceTraces);
  const isElementaryFlow =
    type === "flow" && /^elementary flow$/iu.test(flowTypeOfDataSet(payload));
  const filter =
    type === "flow" && flowTypeOfDataSet(payload)
      ? { flowType: flowTypeOfDataSet(payload) }
      : null;
  const profileHints = identityPreflightProfileHints(type, payload, sourceTraces);
  return {
    enabled: true,
    query,
    ...(Object.keys(profileHints).length > 0
      ? { profile_hints: profileHints }
      : {}),
    data_source: "tg",
    limit: isElementaryFlow ? 80 : 20,
    ...identityPreflightHybridSearchOptions(),
    ...(filter ? { filter } : {}),
  };
}

function edgeSearchRequestPreview(type, remoteSearch) {
  return {
    endpoint: type === "process" ? "process_hybrid_search" : "flow_hybrid_search",
    body: {
      query: remoteSearch.query,
      ...(remoteSearch.filter ? { filter: remoteSearch.filter } : {}),
      match_count: remoteSearch.limit,
      page_size: remoteSearch.limit,
      data_source: remoteSearch.data_source,
      ...identityPreflightHybridSearchOptions(),
    },
  };
}

function identityPreflightProfileHints(type, payload, sourceTraces = []) {
  const authoringContext = processAuthoringContextFromTrace(sourceTraces);
  const sourceClassification = processSourceClassificationSummary(sourceTraces);
  if (type === "flow") {
    const sourceCategories = uniqueSearchTexts(
      sourceClassificationTextsForSearch(sourceClassification),
      8,
    );
    const hints = {
      type_of_dataset: flowTypeOfDataSet(payload),
      flow_property: flowReferencePropertyTexts(payload),
      reference_unit: authoringContext.source_unit,
      categories: sourceCategories,
      geography: authoringContext.source_location,
    };
    return Object.fromEntries(
      Object.entries(hints).filter(([, value]) =>
        Array.isArray(value) ? value.length > 0 : Boolean(asText(value)),
      ),
    );
  }

  const hints = {
    reference_flow_names: processReferenceFlowSearchTexts(payload, 4),
    quantitative_reference: valuesByKeys(payload, ["functionalUnitOrOther"], 2),
    geography: authoringContext.source_location,
    technology_route: authoringContext.technology,
    system_boundary: authoringContext.included_processes,
    categories: uniqueSearchTexts(
      sourceClassificationTextsForSearch(sourceClassification),
      8,
    ),
  };
  return Object.fromEntries(
    Object.entries(hints).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : Boolean(asText(value)),
    ),
  );
}

function sourceDataSetInformation(payload) {
  return payload?.sourceDataSet?.sourceInformation?.dataSetInformation &&
    typeof payload.sourceDataSet.sourceInformation.dataSetInformation ===
      "object"
    ? payload.sourceDataSet.sourceInformation.dataSetInformation
    : {};
}

function sourceShortName(payload) {
  const dataSetInformation = sourceDataSetInformation(payload);
  return (
    textValue(dataSetInformation["common:shortName"]) ||
    textValue(dataSetInformation.shortName) ||
    textValue(dataSetInformation.name)
  );
}

function sourceCitationText(payload) {
  const dataSetInformation = sourceDataSetInformation(payload);
  return textValue(dataSetInformation.sourceCitation);
}

function sourceDescriptionText(payload) {
  const dataSetInformation = sourceDataSetInformation(payload);
  return textValue(dataSetInformation.sourceDescriptionOrComment);
}

function isBareSourceDescriptionText(value) {
  const text = asText(value).trim();
  return text === "" || /^(Report|Publication|Source)$/iu.test(text);
}

function isGenericEcoSpoldCompatibilitySourceText(value) {
  return /^Created for EcoSpold 1 compatibility$/iu.test(asText(value));
}

function isPlaceholderSourceIdentityText(value) {
  return /^(Not specified|Not declared|Unspecified)$/iu.test(asText(value));
}

function sourceMetadataFromDescription(description) {
  const text = asText(description).replace(/\\n/gu, "\n");
  if (!text) return null;
  const originalTitle = text.match(/^Original title:\s*(.+)$/imu)?.[1]?.trim();
  const year =
    text.match(/^Year:\s*(\d{4})$/imu)?.[1] ??
    text.match(/\((\d{4})\)/u)?.[1] ??
    null;
  const firstAuthor =
    text.match(/^First author:\s*(.+)$/imu)?.[1]?.trim() ??
    text.match(/^([^(\n]+?)\s*\(\d{4}\)/u)?.[1]?.trim() ??
    null;
  const title =
    originalTitle ??
    text.match(/\(\d{4}\)\s*([^.\n]+(?:\.[^.\n]+)*)/u)?.[1]?.trim() ??
    null;
  if (!title || !year) return null;
  const firstAuthorLastName =
    firstAuthor?.split(",")[0]?.trim() || firstAuthor?.split(/\s+/u)[0] || null;
  const shortName = [
    year,
    title,
    firstAuthorLastName,
  ]
    .filter(Boolean)
    .join(" - ");
  const firstLine = text.split(/\r?\n/u)[0]?.trim();
  return {
    shortName,
    citation:
      firstLine && !isGenericEcoSpoldCompatibilitySourceText(firstLine)
        ? firstLine
        : shortName,
  };
}

function repairTrueSourceIdentity(payload, { sourceFile, stats, repairRows }) {
  if (sourceSemanticKind(payload) !== "true_source") return;
  const dataSetInformation = sourceDataSetInformation(payload);
  if (!dataSetInformation || typeof dataSetInformation !== "object") return;
  const originalShortName = sourceShortName(payload);
  const originalCitation = sourceCitationText(payload);
  if (
    !isGenericEcoSpoldCompatibilitySourceText(originalShortName) &&
    !isGenericEcoSpoldCompatibilitySourceText(originalCitation)
  ) {
    return;
  }
  const repaired = sourceMetadataFromDescription(sourceDescriptionText(payload));
  if (!repaired?.shortName) return;
  dataSetInformation["common:shortName"] = multiLang(repaired.shortName, "en");
  dataSetInformation.sourceCitation = repaired.citation;
  const identity = datasetIdentity(payload, "source");
  stats.true_source_identity_repairs += 1;
  repairRows.push({
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    relation: "true_source_identity_from_description",
    original_short_name: originalShortName || null,
    original_source_citation: originalCitation || null,
    repaired_short_name: repaired.shortName,
    repaired_source_citation: repaired.citation,
    basis:
      "Converted EcoSpold compatibility source name was generic; sourceDescriptionOrComment contains report metadata with title, year, and author.",
  });
}

function repairTrueSourceDescription(payload, { sourceFile, stats, repairRows }) {
  if (sourceSemanticKind(payload) !== "true_source") return;
  const dataSetInformation = sourceDataSetInformation(payload);
  if (!dataSetInformation || typeof dataSetInformation !== "object") return;
  const originalDescription = sourceDescriptionText(payload);
  if (!isBareSourceDescriptionText(originalDescription)) return;
  const citation = sourceCitationText(payload);
  const shortName = sourceShortName(payload);
  const evidence = citation || shortName;
  if (!evidence) return;
  const repairedDescription = `Report/publication: ${evidence}.`;
  dataSetInformation.sourceDescriptionOrComment = multiLang(
    repairedDescription,
    "en",
  );
  const identity = datasetIdentity(payload, "source");
  stats.true_source_description_repairs += 1;
  repairRows.push({
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    relation: "true_source_description_from_citation",
    original_description: originalDescription || null,
    repaired_description: repairedDescription,
    basis:
      "Converted sourceDescriptionOrComment was empty or only a generic type word; citation/shortName identifies the report or publication source.",
  });
}

function sourceSemanticKind(payload) {
  const classificationPath = bundleClassificationPath(payload, "source");
  const classification = classificationPath.toLowerCase();
  const citation = sourceCitationText(payload);
  const shortNameText = sourceShortName(payload);
  const shortName = shortNameText.toLowerCase();
  if (classification.includes("data set formats"))
    return "format_support_source";
  if (classification.includes("compliance systems"))
    return "compliance_support_source";
  if (
    isPlaceholderSourceIdentityText(shortNameText) ||
    isPlaceholderSourceIdentityText(citation)
  ) {
    return "placeholder_or_unspecified_source";
  }
  if (
    isGenericEcoSpoldCompatibilitySourceText(shortNameText) ||
    isGenericEcoSpoldCompatibilitySourceText(citation)
  ) {
    const repaired = sourceMetadataFromDescription(sourceDescriptionText(payload));
    return repaired?.shortName ? "true_source" : "unresolved_source_semantics";
  }
  if (citation) return "true_source";
  if (
    shortName.includes("not specified") ||
    shortName.includes("not declared") ||
    shortName === "unspecified"
  ) {
    return "placeholder_or_unspecified_source";
  }
  return "unresolved_source_semantics";
}

function repairTrueSourceClassification(payload, { sourceFile, stats, repairRows }) {
  if (sourceSemanticKind(payload) !== "true_source") return;
  const currentClassification = bundleClassificationPath(payload, "source");
  if (
    currentClassification &&
    !/^Other source types$/iu.test(currentClassification)
  ) {
    return;
  }
  const dataSetInformation = sourceDataSetInformation(payload);
  if (!dataSetInformation || typeof dataSetInformation !== "object") return;
  dataSetInformation.classificationInformation ??= {};
  dataSetInformation.classificationInformation["common:classification"] ??= {};
  dataSetInformation.classificationInformation["common:classification"][
    "common:class"
  ] = {
    "@level": "0",
    "@classId": "5",
    "#text": "Publications and communications",
  };
  const identity = datasetIdentity(payload, "source");
  const alreadyReported = repairRows.some(
    (row) =>
      row.dataset_id === identity.id &&
      row.dataset_version === identity.version &&
      row.relation === "true_source_publication_classification",
  );
  if (alreadyReported) return;
  stats.true_source_classification_repairs += 1;
  repairRows.push({
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    relation: "true_source_publication_classification",
    original_classification: currentClassification || null,
    repaired_classification: "Publications and communications",
    basis:
      "sourceCitation is present and the converted source category was generic Other source types.",
  });
}

function sourceSemanticSummary(payload, sourceFile) {
  const identity = datasetIdentity(payload, "source");
  const kind = sourceSemanticKind(payload);
  return {
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    kind,
    materialized_as_source_row: kind === "true_source",
    short_name: sourceShortName(payload),
    source_citation: sourceCitationText(payload) || null,
    source_description: sourceDescriptionText(payload) || null,
    classification_path: bundleClassificationPath(payload, "source") || null,
  };
}

function sourceReferenceKind(pathSegments) {
  const pathText = pathSegments.join(".");
  if (pathText.includes("referenceToDataSource")) return "process_data_source";
  if (pathText.includes("referenceToDataSetFormat"))
    return "dataset_format_source";
  if (pathText.includes("referenceToComplianceSystem"))
    return "compliance_system_source";
  return "other_source_reference";
}

const canonicalSourceReferences = {
  dataset_format_source: {
    "@type": "source data set",
    "@refObjectId": "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    "@version": "03.00.003",
    "@uri":
      "../sources/a97a0155-0234-4b87-b4ce-a45da52f2a40_03.00.003.xml",
    "common:shortDescription": multiLang("ILCD format", "en"),
  },
  compliance_system_source: {
    "@type": "source data set",
    "@refObjectId": "d92a1a12-2545-49e2-a585-55c259997756",
    "@version": "20.20.002",
    "@uri":
      "../sources/d92a1a12-2545-49e2-a585-55c259997756_20.20.002.xml",
    "common:shortDescription": multiLang(
      "ILCD Data Network - Entry-level",
      "en",
    ),
  },
};

function canonicalSourceReferenceForRelation(relation) {
  const reference = canonicalSourceReferences[relation];
  return reference ? cloneJson(reference) : null;
}

function sourceReferenceSnapshot(reference) {
  return {
    ref_object_id: asText(reference?.["@refObjectId"]) || null,
    version: asText(reference?.["@version"]) || null,
    uri: asText(reference?.["@uri"]) || null,
    short_description: textValue(reference?.["common:shortDescription"]) || null,
  };
}

function rewriteCanonicalSourceReferences(
  value,
  {
    datasetType,
    sourceFile,
    stats,
    rewriteRows,
    pathSegments = [],
    datasetIdentityCache = null,
  },
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rewriteCanonicalSourceReferences(item, {
        datasetType,
        sourceFile,
        stats,
        rewriteRows,
        pathSegments: [...pathSegments, index],
        datasetIdentityCache,
      }),
    );
    return;
  }

  const relation = sourceReferenceKind(pathSegments);
  const canonical = canonicalSourceReferenceForRelation(relation);
  const refType = asText(value["@type"]).toLowerCase();
  const refObjectId = asText(value["@refObjectId"]);
  if (canonical && refObjectId && refType.includes("source")) {
    const before = sourceReferenceSnapshot(value);
    const after = sourceReferenceSnapshot(canonical);
    if (
      before.ref_object_id !== after.ref_object_id ||
      before.version !== after.version ||
      before.short_description !== after.short_description
    ) {
      const identity =
        datasetIdentityCache && datasetIdentityCache.id
          ? datasetIdentityCache
          : datasetIdentity(value, datasetType);
      stats.source_reference_rewrites += 1;
      rewriteRows.push({
        dataset_type: datasetType,
        dataset_id: identity.id,
        dataset_version: identity.version,
        source_file: repoRelativeMaybe(sourceFile),
        path: pathExpression(pathSegments),
        relation,
        original: before,
        canonical: after,
        reason:
          relation === "dataset_format_source"
            ? "Data set format uses the public canonical ILCD format source instead of a converted package-local support source."
            : "Compliance declaration uses the public canonical ILCD Data Network Entry-level source instead of a converted placeholder support source.",
      });
    }
    Object.keys(value).forEach((key) => {
      delete value[key];
    });
    Object.assign(value, cloneJson(canonical));
  }

  for (const [key, child] of Object.entries(value)) {
    rewriteCanonicalSourceReferences(child, {
      datasetType,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments: [...pathSegments, key],
      datasetIdentityCache,
    });
  }
}

function rewriteTrueSourceReferenceDescriptions(
  value,
  {
    sourceLookup,
    sourceFile,
    stats,
    rewriteRows,
    pathSegments = [],
    datasetIdentityCache = null,
  },
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rewriteTrueSourceReferenceDescriptions(item, {
        sourceLookup,
        sourceFile,
        stats,
        rewriteRows,
        pathSegments: [...pathSegments, index],
        datasetIdentityCache,
      }),
    );
    return;
  }

  const relation = sourceReferenceKind(pathSegments);
  const refType = asText(value["@type"]).toLowerCase();
  const refObjectId = asText(value["@refObjectId"]);
  if (
    relation === "process_data_source" &&
    refObjectId &&
    refType.includes("source")
  ) {
    const source = sourceLookup.get(refObjectId);
    const canonicalShortName = asText(source?.short_name);
    const currentShortName = textValue(value["common:shortDescription"]);
    if (
      source?.kind === "true_source" &&
      canonicalShortName &&
      currentShortName !== canonicalShortName
    ) {
      const before = sourceReferenceSnapshot(value);
      value["common:shortDescription"] = multiLang(
        canonicalShortName,
        languageForText(canonicalShortName),
      );
      const after = sourceReferenceSnapshot(value);
      stats.true_source_reference_description_repairs += 1;
      const identity = datasetIdentityCache && datasetIdentityCache.id
        ? datasetIdentityCache
        : { id: null, version: null };
      rewriteRows.push({
        dataset_type: "process",
        dataset_id: identity.id,
        dataset_version: identity.version,
        source_file: repoRelativeMaybe(sourceFile),
        path: pathExpression(pathSegments),
        relation: "process_data_source_short_description",
        original: before,
        canonical: after,
        reason:
          "Process data source reference shortDescription is synchronized to the curated true source row name.",
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    rewriteTrueSourceReferenceDescriptions(child, {
      sourceLookup,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments: [...pathSegments, key],
      datasetIdentityCache,
    });
  }
}

function collectSourceReferences(value, pathSegments = [], refs = []) {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectSourceReferences(item, [...pathSegments, index], refs),
    );
    return refs;
  }
  const refType = asText(value["@type"]).toLowerCase();
  const refObjectId = asText(value["@refObjectId"]);
  if (refObjectId && refType.includes("source")) {
    refs.push({
      path: pathExpression(pathSegments),
      relation: sourceReferenceKind(pathSegments),
      ref_object_id: refObjectId,
      version: asText(value["@version"]) || null,
      short_description: textValue(value["common:shortDescription"]) || null,
    });
  }
  for (const [key, child] of Object.entries(value)) {
    collectSourceReferences(child, [...pathSegments, key], refs);
  }
  return refs;
}

function processSourceReferenceRows(payload, sourceLookup, sourceFile) {
  if (!payload?.processDataSet) return [];
  const identity = datasetIdentity(payload, "process");
  return collectSourceReferences(payload.processDataSet).map((ref) => ({
    dataset_type: "process",
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    ...ref,
    referenced_source_kind: sourceLookup.get(ref.ref_object_id)?.kind ?? null,
    referenced_source_classification:
      sourceLookup.get(ref.ref_object_id)?.classification_path ?? null,
    referenced_source_citation:
      sourceLookup.get(ref.ref_object_id)?.source_citation ?? null,
  }));
}

function sourceReferenceSemanticBlockers(processSourceReferenceRows) {
  return processSourceReferenceRows
    .filter(
      (row) =>
        row.relation === "process_data_source" &&
        row.referenced_source_kind &&
        row.referenced_source_kind !== "true_source",
    )
    .map((row) => ({
      code: "process_data_source_not_true_source",
      message:
        "Process referenceToDataSource must point to a true report/publication/source row, not a format or compliance support source.",
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      ref_object_id: row.ref_object_id,
      referenced_source_kind: row.referenced_source_kind,
      referenced_source_classification: row.referenced_source_classification,
      source_file: row.source_file,
      path: row.path,
    }));
}

function classificationAuthoringCommands({
  cliBin,
  outDir,
  rowsDir,
  type,
  rowType = type,
}) {
  const decisionsFile = path.join(
    outDir,
    `${type}-classification-decisions.jsonl`,
  );
  const inputFile = path.join(
    rowsDir,
    `${bundleRowTypes[rowType].plural}.jsonl`,
  );
  const outputFile = path.join(
    rowsDir,
    `${bundleRowTypes[rowType].plural}.classified.jsonl`,
  );
  return {
    children_root: [
      cliBin,
      "dataset",
      "classification",
      "children",
      "--type",
      type,
      "--out-dir",
      path.join(outDir, "classification", type),
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
    children_next_template: `${[
      cliBin,
      "dataset",
      "classification",
      "children",
      "--type",
      type,
      "--parent",
    ]
      .map(shellQuote)
      .join(
        " ",
      )} <parent-code> ${["--out-dir", path.join(outDir, "classification", type), "--json"].map(shellQuote).join(" ")}`,
    path_template: `${[
      cliBin,
      "dataset",
      "classification",
      "path",
      "--type",
      type,
      "--code",
    ]
      .map(shellQuote)
      .join(
        " ",
      )} <selected-code> ${["--out-dir", path.join(outDir, "classification", type), "--json"].map(shellQuote).join(" ")}`,
    apply: [
      cliBin,
      "dataset",
      "classification",
      "apply",
      "--input",
      inputFile,
      "--decisions",
      decisionsFile,
      "--out",
      outputFile,
      "--type",
      type,
      "--out-dir",
      path.join(outDir, "classification", type),
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
    decision_file: repoRelativePath(decisionsFile),
    input_rows: repoRelativePath(inputFile),
    output_rows: repoRelativePath(outputFile),
  };
}

function locationAuthoringCommands({ cliBin, outDir, rowsDir, type }) {
  const decisionsFile = path.join(outDir, `${type}-location-decisions.jsonl`);
  const inputFile = path.join(rowsDir, `${bundleRowTypes[type].plural}.jsonl`);
  const outputFile = path.join(
    rowsDir,
    `${bundleRowTypes[type].plural}.located.jsonl`,
  );
  return {
    audit: [
      cliBin,
      "dataset",
      "classification",
      "audit",
      "--type",
      "location",
      "--input",
      inputFile,
      "--out-dir",
      path.join(outDir, "classification", "location", type),
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
    children_root: [
      cliBin,
      "dataset",
      "classification",
      "children",
      "--type",
      "location",
      "--out-dir",
      path.join(outDir, "classification", "location", type),
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
    path_template: `${[
      cliBin,
      "dataset",
      "classification",
      "path",
      "--type",
      "location",
      "--code",
    ]
      .map(shellQuote)
      .join(
        " ",
      )} <selected-location-code> ${["--out-dir", path.join(outDir, "classification", "location", type), "--json"].map(shellQuote).join(" ")}`,
    apply: [
      cliBin,
      "dataset",
      "classification",
      "apply",
      "--input",
      inputFile,
      "--decisions",
      decisionsFile,
      "--out",
      outputFile,
      "--type",
      "location",
      "--out-dir",
      path.join(outDir, "classification", "location", type),
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
    decision_file: repoRelativePath(decisionsFile),
    input_rows: repoRelativePath(inputFile),
    output_rows: repoRelativePath(outputFile),
  };
}

function loadTidasLocationCodeMap() {
  const candidates = [
    path.resolve(
      repoRoot,
      "..",
      "tiangong-lca-cli",
      "assets",
      "tidas-schemas",
      "tidas_locations_category.json",
    ),
    path.resolve(
      repoRoot,
      "..",
      "tidas-tools",
      "src",
      "tidas_tools",
      "tidas",
      "schemas",
      "tidas_locations_category.json",
    ),
  ];
  const schemaPath = candidates.find(fileExists);
  if (!schemaPath) return new Map();
  const schema = readJson(schemaPath);
  return new Map(
    ensureArray(schema.oneOf)
      .map((entry) => [asText(entry?.const), asText(entry?.description)])
      .filter(([code]) => code),
  );
}

const fallbackLocationTargetKeys = new Set([
  "@location",
  "@subLocation",
  "impactLocation",
  "impactSubLocation",
  "interventionLocation",
  "interventionSubLocation",
  "intervensionSubLocation",
  "location",
  "locationOfSupply",
  "subLocation",
]);
let cachedLocationTargetKeys = null;

function tidasSchemaDirs() {
  return [
    path.resolve(repoRoot, "..", "tiangong-lca-cli", "assets", "tidas-schemas"),
    path.resolve(
      repoRoot,
      "..",
      "tidas-tools",
      "src",
      "tidas_tools",
      "tidas",
      "schemas",
    ),
  ].filter(directoryExists);
}

function lastSchemaPropertyName(schemaPathSegments) {
  let propertyName = null;
  for (let index = 0; index < schemaPathSegments.length - 1; index += 1) {
    if (schemaPathSegments[index] === "properties") {
      propertyName = schemaPathSegments[index + 1] ?? propertyName;
    }
  }
  return propertyName;
}

function collectLocationRefKeysFromSchema(value, schemaPathSegments, keys) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectLocationRefKeysFromSchema(
        item,
        [...schemaPathSegments, String(index)],
        keys,
      ),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.$ref === "tidas_locations_category.json") {
    const propertyName = lastSchemaPropertyName(schemaPathSegments);
    if (propertyName) keys.add(propertyName);
  }
  for (const [key, child] of Object.entries(value)) {
    collectLocationRefKeysFromSchema(child, [...schemaPathSegments, key], keys);
  }
}

function loadTidasLocationTargetKeys() {
  if (cachedLocationTargetKeys) return cachedLocationTargetKeys;
  const keys = new Set(fallbackLocationTargetKeys);
  for (const schemaDir of tidasSchemaDirs()) {
    for (const fileName of fs.readdirSync(schemaDir)) {
      if (!fileName.endsWith(".json")) continue;
      collectLocationRefKeysFromSchema(
        readJson(path.join(schemaDir, fileName)),
        [],
        keys,
      );
    }
  }
  cachedLocationTargetKeys = keys;
  return cachedLocationTargetKeys;
}

function isLocationTargetKey(key) {
  return loadTidasLocationTargetKeys().has(key);
}

function locationTargetStringValue(value) {
  if (typeof value === "string") {
    return {
      parent: null,
      key: null,
      path_suffix: [],
      value: value.trim(),
    };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const text = value["#text"];
    if (typeof text === "string") {
      return {
        parent: value,
        key: "#text",
        path_suffix: ["#text"],
        value: text.trim(),
      };
    }
  }
  return null;
}

function collectLocationTargets(value, pathSegments = [], targets = []) {
  if (!value || typeof value !== "object") return targets;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectLocationTargets(item, [...pathSegments, index], targets),
    );
    return targets;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathSegments, key];
    if (isLocationTargetKey(key)) {
      const targetValue = locationTargetStringValue(child);
      if (targetValue) {
        const pathSuffix = targetValue.path_suffix ?? [];
        const leafPath = [...childPath, ...pathSuffix];
        const parentPath = pathSuffix.length > 0 ? childPath : pathSegments;
        targets.push({
          path: pathExpression(leafPath),
          parent_path: pathExpression(parentPath),
          value: targetValue.value,
        });
      }
    }
    collectLocationTargets(child, childPath, targets);
  }
  return targets;
}

function collectLocationQualityFindings({
  payload,
  type,
  sourceFile,
  blockers,
  stats,
  locationQueueRows,
  locationCodeMap,
  locationCommands,
}) {
  const identity = datasetIdentity(payload, type);
  for (const target of collectLocationTargets(payload)) {
    stats.location_code_targets += 1;
    if (locationCodeMap.has(target.value)) {
      stats.location_code_valid += 1;
      continue;
    }
    stats.location_code_blockers += 1;
    const queueRow = {
      dataset_type: type,
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      code: "location_code_requires_authoring",
      path: target.path,
      current_location: target.value,
      location_workflow: {
        schema_type: "location",
        commands: locationCommands,
        decision_contract: {
          required_selector: "row_index or dataset_id",
          required_location: "code from tidas_locations_category.json",
          required_target_path:
            "target_path is required when a row contains more than one location field",
          optional_fields: ["basis", "evidence"],
        },
      },
      required_resolution:
        "Choose a valid TIDAS location code from tidas_locations_category.json, write a location decision, apply it through the CLI, then rerun validation before remote write.",
    };
    locationQueueRows.push(queueRow);
    blockers.push({
      code: "location_code_requires_authoring",
      message:
        "Location value is not present in tidas_locations_category.json and must be resolved before commit.",
      dataset_type: type,
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      path: target.path,
      current_location: target.value,
      queue: "location-authoring-queue.jsonl",
    });
  }
}

function collectBundleQualityFindings({
  payload,
  type,
  sourceFile,
  sourceTraces,
  blockers,
  stats,
  classificationQueueRows,
  classificationCommandsByType,
}) {
  if (type !== "process" && type !== "flow") return;
  if (type === "flow" && flowClassificationSchemaType(payload) !== "flow-product")
    return;
  const identity = datasetIdentity(payload, type);
  const currentClassification = bundleClassificationPath(payload, type);
  if (!isConvertedDefaultClassification(currentClassification)) return;

  if (type === "process") {
    stats.default_process_classification_blockers += 1;
  } else {
    stats.default_flow_classification_blockers += 1;
  }
  const schemaType =
    type === "flow" ? flowClassificationSchemaType(payload) : "process";
  const code = `${type}_classification_requires_authoring`;
  const sourceClassification = processSourceClassificationSummary(sourceTraces);
  const authoringContext = processAuthoringContextFromTrace(sourceTraces);
  const queueRow = {
    dataset_type: type,
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    code,
    current_classification: currentClassification,
    source_classification: sourceClassification,
    authoring_context: authoringContext,
    classification_workflow: {
      schema_type: schemaType,
      row_type: type,
      commands: classificationCommandsByType[schemaType],
      decision_contract: {
        required_selector: "row_index or dataset_id",
        required_classification:
          "code, leaf_code, class_id, cat_id, or classes[]",
        optional_fields: ["basis", "evidence"],
      },
    },
    required_resolution:
      "Use the Foundry AI authoring/classification gate with full TIDAS schema/YAML/context to replace the converted default classification before remote write.",
  };
  classificationQueueRows.push(queueRow);
  blockers.push({
    code,
    message: `${type} classification is the tidas-tools converted default path and must be resolved by AI/classification authoring before commit.`,
    dataset_type: type,
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    current_classification: currentClassification,
    source_classification: sourceClassification,
    schema_type: schemaType,
    queue: "classification-authoring-queue.jsonl",
  });
}

function flowNameParts(payload) {
  const name =
    payload?.flowDataSet?.flowInformation?.dataSetInformation?.name ?? {};
  return {
    base_name: asText(name.baseName?.["#text"] ?? name.baseName),
    treatment_standards_routes: asText(
      name.treatmentStandardsRoutes?.["#text"] ??
        name.treatmentStandardsRoutes,
    ),
    mix_and_location_types: asText(
      name.mixAndLocationTypes?.["#text"] ?? name.mixAndLocationTypes,
    ),
    functional_unit_flow_properties: asText(
      name.functionalUnitFlowProperties?.["#text"] ??
        name.functionalUnitFlowProperties,
    ),
  };
}

function collectElementaryFlowReuseFindings({
  payload,
  type,
  sourceFile,
  sourceTraces,
  blockers,
  stats,
  elementaryFlowReuseRows,
}) {
  if (type !== "flow") return;
  if (flowClassificationSchemaType(payload) !== "flow-elementary") return;
  const identity = datasetIdentity(payload, type);
  const sourceClassification = processSourceClassificationSummary(sourceTraces);
  const authoringContext = processAuthoringContextFromTrace(sourceTraces);
  stats.elementary_flow_reuse_blockers += 1;
  elementaryFlowReuseRows.push({
    dataset_type: "flow",
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    code: "elementary_flow_requires_existing_database_match",
    flow_type: flowTypeOfDataSet(payload),
    source_name_fields: flowNameParts(payload),
    source_classification: sourceClassification,
    authoring_context: authoringContext,
    required_resolution:
      "Search the existing TianGong elementary flow library by UUID/version, CAS/name/category/synonyms, and structured semantic candidates. Rewrite process exchanges to the selected existing flow. If no defensible match exists, keep this as an unresolved mapping blocker; do not write a BAFU-owned elementary flow.",
  });
  blockers.push({
    code: "elementary_flow_requires_existing_database_match",
    message:
      "Elementary flow must be selected from existing TianGong database flows before commit; Foundry must not publish BAFU-owned elementary flows.",
    dataset_type: type,
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    flow_type: flowTypeOfDataSet(payload),
    source_name_fields: flowNameParts(payload),
    source_classification: sourceClassification,
    queue: "elementary-flow-reuse-queue.jsonl",
  });
}

function normalizeTimestampText(text, pathSegments, stats) {
  if (pathSegments.at(-1) !== "common:timeStamp") return text;
  const value = String(text ?? "").trim();
  if (!value) return text;
  let normalized = value;
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/u.test(
      value,
    )
  ) {
    normalized = new Date(value).toISOString();
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)) {
    normalized = `${value}Z`;
  }
  if (normalized !== value) {
    stats.timestamp_normalizations += 1;
  }
  return normalized;
}

function collectSourceTracePayloads(value, traces = []) {
  if (!value || typeof value !== "object") return traces;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceTracePayloads(item, traces);
    return traces;
  }
  const sourceTrace = value["tidasimport:sourceTrace"];
  if (sourceTrace && typeof sourceTrace === "object") {
    traces.push(sourceTrace.payload ?? sourceTrace);
  }
  for (const child of Object.values(value))
    collectSourceTracePayloads(child, traces);
  return traces;
}

function walkSourceTraceNode(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkSourceTraceNode(item, visitor);
    return;
  }
  visitor(node);
  for (const child of Object.values(node)) {
    walkSourceTraceNode(child, visitor);
  }
}

function sourceTraceAttribute(sourceTraces, attributeName) {
  for (const trace of sourceTraces) {
    let found = null;
    walkSourceTraceNode(trace, (node) => {
      if (found) return;
      const attributes = Array.isArray(node.attributes) ? node.attributes : [];
      const attribute = attributes.find((item) => item?.name === attributeName);
      if (attribute?.value !== undefined && attribute?.value !== null) {
        found = String(attribute.value).trim();
      }
    });
    if (found) return found;
  }
  return null;
}

function sourceTraceLocationCode(sourceTraces) {
  const location = sourceTraceAttribute(sourceTraces, "location");
  return isLikelyLocationCodeText(location) ? location : null;
}

function sourceTraceChildText(sourceTraces, childName) {
  for (const trace of sourceTraces) {
    let found = null;
    walkSourceTraceNode(trace, (node) => {
      if (found || node?.name !== childName) return;
      if (node.text !== undefined && node.text !== null) {
        found = String(node.text).trim();
      }
    });
    if (found) return found;
  }
  return null;
}

function textItem(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return typeof value["#text"] === "string" ? value : null;
  }
  if (Array.isArray(value)) {
    return (
      value.find(
        (item) =>
          item && typeof item === "object" && typeof item["#text"] === "string",
      ) ?? null
    );
  }
  return null;
}

function productionVolumeToAnnualText(value) {
  const text = asText(value);
  if (!text) return null;
  let match = text.match(
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)\s+(.+?)\s+per\s+year\b/iu,
  );
  if (!match) {
    match = text.match(
      /([+-]?(?:\d[\d'.,]*(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)\s+([^\s,.;()]+)\s*\/\s*(?:year|yr|a)\b/iu,
    );
  }
  if (!match) return null;
  const amount = match[1].replace(/[',]/gu, "");
  const unit = match[2].replace(/[.。]\s*$/u, "").trim();
  return `${amount} ${unit}/year`;
}

function sourceTraceYear(sourceTraces) {
  for (const candidate of [
    sourceTraceChildText(sourceTraces, "endYear"),
    sourceTraceChildText(sourceTraces, "startYear"),
    sourceTraceAttribute(sourceTraces, "version"),
    sourceTraceAttribute(sourceTraces, "timestamp"),
  ]) {
    const match = asText(candidate).match(/\b(19|20)\d{2}\b/u);
    if (match) return Number(match[0]);
  }
  return null;
}

function repairProcessFieldsFromSourceTrace(payload, sourceTraces, stats) {
  const root = payload?.processDataSet;
  if (!root || typeof root !== "object") return;
  const processInformation =
    root.processInformation && typeof root.processInformation === "object"
      ? root.processInformation
      : {};
  const time =
    processInformation.time && typeof processInformation.time === "object"
      ? processInformation.time
      : null;
  if (time && time["common:referenceYear"] === 9999) {
    const year = sourceTraceYear(sourceTraces);
    if (Number.isInteger(year) && year > 0 && year < 9999) {
      time["common:referenceYear"] = year;
      stats.reference_year_repairs += 1;
    }
  }

  const modelling =
    root.modellingAndValidation &&
    typeof root.modellingAndValidation === "object"
      ? root.modellingAndValidation
      : {};
  const dataSources =
    modelling.dataSourcesTreatmentAndRepresentativeness &&
    typeof modelling.dataSourcesTreatmentAndRepresentativeness === "object"
      ? modelling.dataSourcesTreatmentAndRepresentativeness
      : null;
  if (!dataSources) return;

  const annualText = textItem(dataSources.annualSupplyOrProductionVolume);
  if (!annualText) return;
  const current = asText(annualText["#text"]);
  if (
    !current ||
    current.toLowerCase().includes("not declared in source package") ||
    !/(?:\/\s*(?:year|yr|a)\b|\bper\s+(?:year|annum)\b|\/\s*年|每年|年度|年供应|年产)/iu.test(
      current,
    )
  ) {
    const repaired = productionVolumeToAnnualText(
      sourceTraceAttribute(sourceTraces, "productionVolume"),
    );
    if (repaired) {
      annualText["#text"] = repaired;
      stats.annual_supply_repairs += 1;
    }
  }
}

function sanitizeImportContent(
  value,
  stats,
  traceRows,
  context,
  pathSegments = [],
) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const child = value[index];
      if (typeof child === "string") {
        value[index] = normalizeTimestampText(
          sanitizePlaceholderText(child, [...pathSegments, index], stats),
          [...pathSegments, index],
          stats,
        );
      } else if (
        sanitizeImportContent(child, stats, traceRows, context, [
          ...pathSegments,
          index,
        ])
      ) {
        value.splice(index, 1);
      }
    }
    return false;
  }

  if (value["tidasimport:sourceTrace"]) {
    traceRows.push({
      dataset_type: context.type,
      dataset_id: context.identity.id,
      dataset_version: context.identity.version,
      source_file: repoRelativeMaybe(context.sourceFile),
      path: pathExpression([...pathSegments, "tidasimport:sourceTrace"]),
      trace: cloneJson(value["tidasimport:sourceTrace"]),
    });
    delete value["tidasimport:sourceTrace"];
    stats.removed_import_traces += 1;
  }
  if (value["@xmlns:tidasimport"]) {
    delete value["@xmlns:tidasimport"];
    stats.removed_import_trace_namespaces += 1;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathSegments, key];
    if (typeof child === "string") {
      value[key] = normalizeTimestampText(
        sanitizePlaceholderText(child, childPath, stats),
        childPath,
        stats,
      );
      continue;
    }
    if (
      typeof child === "number" &&
      key === "common:referenceYear" &&
      child === 9999
    ) {
      continue;
    }
    if (sanitizeImportContent(child, stats, traceRows, context, childPath)) {
      delete value[key];
    }
  }

  return pathSegments.at(-1) === "common:other" && isObjectEmpty(value);
}

function sanitizeBundlePayload(
  payload,
  type,
  sourceFile,
  stats,
  traceRows,
  sourceTraces = null,
) {
  sourceTraces ??= collectSourceTracePayloads(payload);
  if (type === "process") {
    repairProcessFieldsFromSourceTrace(payload, sourceTraces, stats);
  }
  const identity = datasetIdentity(payload, type);
  sanitizeImportContent(payload, stats, traceRows, {
    type,
    identity,
    sourceFile,
  });
  return payload;
}

function findFirstBundleContactTemplate(bundleDirs) {
  for (const bundleDir of bundleDirs) {
    const contactsDir = path.join(bundleDir, "tidas", "contacts");
    if (!directoryExists(contactsDir)) continue;
    for (const name of fs.readdirSync(contactsDir).sort()) {
      if (name.endsWith(".json")) {
        return readJson(path.join(contactsDir, name));
      }
    }
  }
  return null;
}

function buildLibraryContactPayload(
  options,
  templateContact = null,
  rewriteContext = {},
) {
  const language = asText(options.language || options.lang || "en") || "en";
  const libraryName = asText(
    options.libraryName ||
      options.name ||
      "Federal Office for the Environment FOEN",
  );
  const shortName = asText(options.shortName || "FOEN");
  const website = asText(
    options.website ||
      options.url ||
      "https://www.bafu.admin.ch/bafu/en/home.html",
  );
  const email = asText(options.email || "info@bafu.admin.ch");
  const telephone = asText(
    options.telephone || options.phone || "+41 58 462 93 11",
  );
  const contactAddress = asText(
    options.contactAddress ||
      options.address ||
      "Mühlestrasse 2, 3063 Ittigen, Switzerland",
  );
  const centralContactPoint = asText(
    options.centralContactPoint ||
      "Federal Office for the Environment FOEN, Mühlestrasse 2, 3063 Ittigen, Switzerland; info@bafu.admin.ch; +41 58 462 93 11",
  );
  const description = asText(
    options.description ||
      "Library-level contact for the BAFU 2025 Version 2 LCA data package.",
  );
  const profile = asText(options.profile || "bafu");
  const version = asText(
    options.contactVersion || options.version || "00.00.001",
  );
  const id =
    asText(options.contactId || options.id) ||
    deterministicUuid(
      `tiangong-lca-foundry:library-contact:${profile}:${libraryName}:${website}`,
    );
  const now = nowIso();
  const templateRoot = templateContact?.contactDataSet;
  const templateDataEntryBy =
    templateRoot?.administrativeInformation?.dataEntryBy ?? {};
  const originalReferenceToDataSetFormat = cloneJson(
    templateDataEntryBy["common:referenceToDataSetFormat"] ?? {
      "@type": "source data set",
      "@refObjectId": "16938856-0a35-5654-8aff-56c17e61da4d",
      "@version": "00.00.001",
      "@uri": "../sources/16938856-0a35-5654-8aff-56c17e61da4d.json",
      "common:shortDescription": multiLang("ILCD format", language),
    },
  );
  const referenceToDataSetFormat =
    canonicalSourceReferenceForRelation("dataset_format_source") ??
    originalReferenceToDataSetFormat;
  const originalFormatSnapshot = sourceReferenceSnapshot(
    originalReferenceToDataSetFormat,
  );
  const canonicalFormatSnapshot = sourceReferenceSnapshot(
    referenceToDataSetFormat,
  );
  if (
    rewriteContext?.rewriteRows &&
    (originalFormatSnapshot.ref_object_id !==
      canonicalFormatSnapshot.ref_object_id ||
      originalFormatSnapshot.version !== canonicalFormatSnapshot.version ||
      originalFormatSnapshot.short_description !==
        canonicalFormatSnapshot.short_description)
  ) {
    rewriteContext.rewriteRows.push({
      dataset_type: "contact",
      dataset_id: id,
      dataset_version: version,
      source_file: "foundry:library-contact",
      path: "contactDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
      relation: "dataset_format_source",
      original: originalFormatSnapshot,
      canonical: canonicalFormatSnapshot,
      reason:
        "Library contact data set format uses the public canonical ILCD format source instead of a converted package-local support source.",
    });
    if (rewriteContext.stats) {
      rewriteContext.stats.source_reference_rewrites =
        Number(rewriteContext.stats.source_reference_rewrites ?? 0) + 1;
    }
  }
  const selfRef = contactGlobalReference({
    id,
    version,
    shortDescription: libraryName,
    language,
  });

  const dataSetInformation = {
    "common:UUID": id,
    "common:shortName": multiLang(shortName, language),
    "common:name": multiLang(libraryName, language),
    classificationInformation: {
      "common:classification": {
        "common:class": {
          "@level": "0",
          "@classId": "5",
          "#text": "Other",
        },
      },
    },
    WWWAddress: website,
    email,
    telephone,
    contactAddress: multiLang(contactAddress, language),
    centralContactPoint: multiLang(centralContactPoint, language),
    contactDescriptionOrComment: multiLang(description, language),
    "common:other": {
      "@xmlns:foundry": "https://tiangong.earth/tidas/foundry/1.0",
      "foundry:libraryContactPolicy": {
        "@marker": "FOUNDRY_LIBRARY_CONTACT_POLICY_V1",
        profile,
        libraryName,
        sourceLanguage: language,
        policy:
          "One shared library contact is used for every dataset row imported from this source library.",
        evidence: {
          source:
            "Foundry BAFU import profile/library-level source attribution",
          website,
          email,
          telephone,
          contactAddress,
        },
      },
    },
  };

  return {
    contactDataSet: {
      "@version": templateRoot?.["@version"] ?? "1.1",
      "@xmlns": templateRoot?.["@xmlns"] ?? "http://lca.jrc.it/ILCD/Contact",
      "@xmlns:common":
        templateRoot?.["@xmlns:common"] ?? "http://lca.jrc.it/ILCD/Common",
      "@xmlns:xsi":
        templateRoot?.["@xmlns:xsi"] ??
        "http://www.w3.org/2001/XMLSchema-instance",
      "@xsi:schemaLocation":
        templateRoot?.["@xsi:schemaLocation"] ??
        "http://lca.jrc.it/ILCD/Contact ../../schemas/ILCD_ContactDataSet.xsd",
      contactInformation: {
        dataSetInformation,
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:timeStamp": now,
          "common:referenceToDataSetFormat": referenceToDataSetFormat,
        },
        publicationAndOwnership: {
          "common:dataSetVersion": version,
          "common:permanentDataSetURI": `https://lcdn.tiangong.earth/datasetdetail/contact.xhtml?uuid=${id}&version=${version}`,
          "common:referenceToOwnershipOfDataSet": selfRef,
        },
      },
    },
  };
}

function deriveSupabaseProjectBaseUrl(apiBaseUrl) {
  const normalized = asText(apiBaseUrl).replace(/\/+$/u, "");
  if (normalized.endsWith("/functions/v1"))
    return normalized.replace(/\/functions\/v1$/u, "");
  if (normalized.endsWith("/rest/v1"))
    return normalized.replace(/\/rest\/v1$/u, "");
  if (/^https?:\/\/[^/]+$/u.test(normalized)) return normalized;
  throw new Error(
    "Cannot derive Supabase project URL from TIANGONG_LCA_API_BASE_URL.",
  );
}

function decodeUserApiKey(userApiKey) {
  try {
    const decoded = JSON.parse(
      Buffer.from(asText(userApiKey), "base64").toString("utf8"),
    );
    const email = asText(decoded.email);
    const password = asText(decoded.password);
    if (!email || !password) throw new Error("missing email/password");
    return { email, password };
  } catch (error) {
    throw new Error(`Invalid TIANGONG_LCA_API_KEY user credentials: ${error}`);
  }
}

async function supabaseJsonRequest(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Supabase request returned non-JSON ${response.status} ${response.statusText}: ${text.slice(
          0,
          300,
        )}`,
      );
    }
  }
  if (!response.ok) {
    throw new Error(
      `Supabase request failed ${response.status} ${response.statusText}: ${text}`,
    );
  }
  return { response, payload };
}

async function signInSupabaseUser({ projectUrl, publishableKey, credentials }) {
  const { payload } = await supabaseJsonRequest(
    `${projectUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    },
  );
  const accessToken = asText(payload?.access_token);
  const userId = asText(payload?.user?.id);
  if (!accessToken || !userId) {
    throw new Error("Supabase auth did not return access_token and user.id.");
  }
  return { accessToken, userId, email: credentials.email };
}

function supabaseRestHeaders({ publishableKey, accessToken, prefer = null }) {
  return {
    apikey: publishableKey,
    authorization: `Bearer ${accessToken}`,
    ...(prefer ? { prefer } : {}),
  };
}

async function fetchSupportCacheRows({
  projectUrl,
  publishableKey,
  accessToken,
  table,
  stateCode,
}) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${projectUrl}/rest/v1/${table}`);
    url.searchParams.set("select", "id,version,state_code,json");
    url.searchParams.set("state_code", `eq.${stateCode}`);
    url.searchParams.set("order", "id.asc,version.asc");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    const { payload } = await supabaseJsonRequest(url, {
      headers: supabaseRestHeaders({ publishableKey, accessToken }),
    });
    if (!Array.isArray(payload)) {
      throw new Error(
        `List rows failed for ${table}: response is not an array.`,
      );
    }
    rows.push(...payload);
    if (payload.length < pageSize) break;
  }
  return rows;
}

function summarizeFlowPropertySupportRow(row) {
  const root = row?.json?.flowPropertyDataSet ?? {};
  const info = root.flowPropertiesInformation ?? {};
  const data = info.dataSetInformation ?? {};
  const referenceUnitGroup =
    info.quantitativeReference?.referenceToReferenceUnitGroup ?? {};
  return {
    id: asText(row?.id),
    version: asText(row?.version),
    state_code:
      typeof row?.state_code === "number" ? row.state_code : null,
    name: supportText(data["common:name"] ?? data["common:shortName"]),
    short_description: supportText(data["common:shortName"] ?? data["common:name"]),
    classification: supportText(
      data.classificationInformation?.["common:classification"]?.[
        "common:class"
      ],
    ),
    reference_unit_group: {
      id: asText(referenceUnitGroup["@refObjectId"]),
      version: asText(referenceUnitGroup["@version"]),
      short_description: supportText(
        referenceUnitGroup["common:shortDescription"],
      ),
    },
  };
}

function summarizeUnitGroupSupportRow(row) {
  const root = row?.json?.unitGroupDataSet ?? {};
  const info = root.unitGroupInformation ?? {};
  const data = info.dataSetInformation ?? {};
  const units = ensureArray(root.units?.unit).map((unit) => ({
    internal_id: asText(unit?.["@dataSetInternalID"]),
    name: supportText(unit?.name ?? unit?.["common:name"]),
    mean_value: asText(unit?.meanValue),
  }));
  return {
    id: asText(row?.id),
    version: asText(row?.version),
    state_code:
      typeof row?.state_code === "number" ? row.state_code : null,
    name: supportText(data["common:name"] ?? data["common:shortName"]),
    short_description: supportText(data["common:shortName"] ?? data["common:name"]),
    classification: supportText(
      data.classificationInformation?.["common:classification"]?.[
        "common:class"
      ],
    ),
    reference_unit:
      info.quantitativeReference?.referenceToReferenceUnit ?? null,
    units,
  };
}

async function runDatasetSupportCacheRefresh(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-support-cache-refresh",
      usage: [
        "node scripts/foundry.mjs dataset-support-cache-refresh --out specs/canonical-support/flow-properties-unit-groups.json",
      ],
      purpose:
        "Refresh the small canonical Flow Properties and Unit Groups cache used to select existing database support rows instead of creating account-local support rows.",
      remote_write_mode: "read-only",
    };
  }

  const projectUrl = deriveSupabaseProjectBaseUrl(
    process.env.TIANGONG_LCA_API_BASE_URL,
  );
  const publishableKey = asText(
    process.env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
  );
  const credentials = decodeUserApiKey(process.env.TIANGONG_LCA_API_KEY);
  if (!publishableKey) {
    throw new Error("TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY is required.");
  }
  const session = await signInSupabaseUser({
    projectUrl,
    publishableKey,
    credentials,
  });
  const stateCode = Number(options.stateCode ?? 100);
  const outPath = resolveRepoPath(
    options.out || options.output || options.cacheFile || defaultCanonicalSupportCacheFile,
  );
  const existing = fileExists(outPath) ? readJson(outPath) : {};
  const [flowPropertyRows, unitGroupRows] = await Promise.all([
    fetchSupportCacheRows({
      projectUrl,
      publishableKey,
      accessToken: session.accessToken,
      table: "flowproperties",
      stateCode,
    }),
    fetchSupportCacheRows({
      projectUrl,
      publishableKey,
      accessToken: session.accessToken,
      table: "unitgroups",
      stateCode,
    }),
  ]);
  const cache = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    source: {
      table_state_code: stateCode,
      policy:
        "Flow Properties and Unit Groups are read-only support choices for Foundry imports; import rows must reference existing canonical DB rows instead of creating My Data support rows.",
    },
    flow_properties: flowPropertyRows.map(summarizeFlowPropertySupportRow),
    unit_groups: unitGroupRows.map(summarizeUnitGroupSupportRow),
    flow_property_mappings:
      ensureArray(existing.flow_property_mappings).length > 0
        ? existing.flow_property_mappings
        : defaultCanonicalFlowPropertyMappings(),
  };
  writeJson(outPath, cache);
  return {
    schema_version: 1,
    generated_at_utc: cache.generated_at_utc,
    status: "completed",
    command: "dataset-support-cache-refresh",
    remote_write_mode: "read-only",
    files: {
      cache: repoRelativePath(outPath),
    },
    counts: {
      flow_properties: cache.flow_properties.length,
      unit_groups: cache.unit_groups.length,
      flow_property_mappings: cache.flow_property_mappings.length,
    },
  };
}

function listProcessBundleDirs(bundlesDir) {
  const root = resolveRepoPath(bundlesDir);
  if (!root || !directoryExists(root)) {
    throw new Error(
      "--bundles-dir is required and must point to a process-bundles directory.",
    );
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter(
      (dir) =>
        fileExists(path.join(dir, "manifest.json")) &&
        directoryExists(path.join(dir, "tidas")),
    )
    .sort();
}

function selectProcessBundleDirs(allBundleDirs, options) {
  const requestedProcessIds = normalizedList(
    options.processId || options.processIds,
  );
  if (requestedProcessIds.length > 0) {
    const byName = new Map(
      allBundleDirs.map((dir) => [path.basename(dir), dir]),
    );
    const selected = requestedProcessIds
      .map((id) => byName.get(id))
      .filter(Boolean);
    return {
      seed: null,
      selected,
      missing_process_ids: requestedProcessIds.filter((id) => !byName.has(id)),
    };
  }

  const seed = asText(options.seed) || `sample-${Date.now()}`;
  const sampleSizeText = asText(
    options.sampleSize || options.limit || options.count || 3,
  );
  const sampleSize =
    sampleSizeText.toLowerCase() === "all"
      ? allBundleDirs.length
      : Math.max(1, Number(sampleSizeText));
  if (!Number.isFinite(sampleSize)) {
    throw new Error("--sample-size must be a positive number or all.");
  }
  const selected = [...allBundleDirs]
    .sort((left, right) =>
      createHash("sha256")
        .update(`${seed}:${path.basename(left)}`)
        .digest("hex")
        .localeCompare(
          createHash("sha256")
            .update(`${seed}:${path.basename(right)}`)
            .digest("hex"),
        ),
    )
    .slice(0, Math.min(sampleSize, allBundleDirs.length));
  return { seed, selected, missing_process_ids: [] };
}

function addDedupedBundleRow({
  rowsByType,
  sourceByType,
  blockers,
  type,
  payload,
  sourceFile,
}) {
  const identity = datasetIdentity(payload, type);
  const key = `${identity.id || path.basename(sourceFile)}::${identity.version || ""}`;
  if (!identity.id || !identity.version) {
    blockers.push({
      code: "bundle_row_identity_missing",
      message: `${type} row is missing common:UUID or common:dataSetVersion.`,
      source_file: repoRelativeMaybe(sourceFile),
      id: identity.id,
      version: identity.version,
    });
    return false;
  }
  if (!rowsByType[type].has(key)) {
    rowsByType[type].set(key, payload);
    sourceByType[type].set(key, sourceFile);
    return true;
  }
  const existing = rowsByType[type].get(key);
  if (jsonSha256(existing) !== jsonSha256(payload)) {
    blockers.push({
      code: "bundle_row_duplicate_payload_conflict",
      message: `${type} ${identity.id}@${identity.version} appears with different payloads in sampled bundles.`,
      kept_source_file: repoRelativeMaybe(sourceByType[type].get(key)),
      conflicting_source_file: repoRelativeMaybe(sourceFile),
    });
  }
  return false;
}

function writeJsonLines(filePath, rows) {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length ? "\n" : ""),
  );
}

function readSourceTracesFromFile(sourceFile) {
  if (!sourceFile || !fileExists(sourceFile)) return [];
  return collectSourceTracePayloads(readJson(sourceFile));
}

function buildIdentityPreflightArtifacts({
  rowsByType,
  sourceByType,
  outDir,
  cliBin,
}) {
  const requestsRoot = path.join(outDir, "identity-preflight-requests");
  const indexRows = [];
  const byIdentity = new Map();
  for (const type of ["flow", "process"]) {
    const plural = type === "flow" ? "flows" : "processes";
    const requestDir = path.join(requestsRoot, plural);
    for (const [key, payload] of rowsByType[type].entries()) {
      const identity = datasetIdentity(payload, type);
      if (!identity.id || !identity.version) continue;
      const sourceFile = sourceByType[type].get(key);
      const sourceTraces = readSourceTracesFromFile(sourceFile);
      const remoteSearch = identityPreflightRemoteSearchRequest(
        type,
        payload,
        sourceTraces,
      );
      const request = {
        schema_version: 1,
        target: payload,
        remote_candidate_search: remoteSearch,
      };
      const requestPath = path.join(
        requestDir,
        `${safeFileToken(identity.id, "missing")}.json`,
      );
      writeJson(requestPath, request);
      const outputDir = path.join(
        outDir,
        "identity-preflight",
        plural,
        safeFileToken(identity.id, "missing"),
      );
      const expectedReportFile = path.join(
        outputDir,
        "outputs",
        "identity-decision.json",
      );
      const expectedCandidatesFile = path.join(
        outputDir,
        "outputs",
        "identity-candidates.jsonl",
      );
      const expectedCandidateSourcesFile = path.join(
        outputDir,
        "outputs",
        "identity-candidate-sources.json",
      );
      const command = [
        cliBin,
        type,
        "identity-preflight",
        "--input",
        requestPath,
        "--out-dir",
        outputDir,
        "--json",
      ]
        .map(shellQuote)
        .join(" ");
      const indexRow = {
        dataset_type: type,
        dataset_id: identity.id,
        dataset_version: identity.version,
        target_sha256: jsonSha256(payload),
        source_file: repoRelativeMaybe(sourceFile),
        request_file: repoRelativePath(requestPath),
        output_dir: repoRelativePath(outputDir),
        expected_report_file: repoRelativePath(expectedReportFile),
        expected_candidates_file: repoRelativePath(expectedCandidatesFile),
        expected_candidate_sources_file: repoRelativePath(
          expectedCandidateSourcesFile,
        ),
        command,
        remote_search: {
          data_source: remoteSearch.data_source,
          limit: remoteSearch.limit,
          filter: remoteSearch.filter ?? null,
          query: remoteSearch.query,
          edge_request: edgeSearchRequestPreview(type, remoteSearch),
        },
      };
      indexRows.push(indexRow);
      byIdentity.set(`${type}:${identity.id}:${identity.version}`, indexRow);
    }
  }
  const indexPath = path.join(requestsRoot, "identity-preflight-requests.jsonl");
  writeJsonLines(indexPath, indexRows);
  return {
    root: requestsRoot,
    indexPath,
    rows: indexRows,
    byIdentity,
  };
}

function identityPreflightSourceIndexPaths(options) {
  return normalizedList(
    options.sourceIndex ||
      options.sourceIndexes ||
      options.sourceContextIndex ||
      options.sourceContextIndexes,
  ).map(resolveRepoPath);
}

function identityPreflightSourceIndexKey(row) {
  return [
    asText(row?.dataset_type || row?.type),
    asText(row?.dataset_id || row?.entity_id || row?.id),
    asText(row?.dataset_version || row?.version) || "00.00.001",
  ].join(":");
}

function loadIdentityPreflightSourceFileMap(indexPaths) {
  const sourceFilesByIdentity = new Map();
  const blockers = [];
  let rowCount = 0;
  for (const indexPath of indexPaths) {
    if (!indexPath || !fileExists(indexPath)) {
      blockers.push({
        code: "identity_preflight_source_index_missing",
        message: "--source-index must point to a readable identity-preflight index.",
        source_index: repoRelativeMaybe(indexPath),
      });
      continue;
    }
    for (const row of readJsonLines(indexPath)) {
      rowCount += 1;
      const key = identityPreflightSourceIndexKey(row);
      if (!key.startsWith("flow:") && !key.startsWith("process:")) continue;
      const sourceFile = asText(row.source_file || row.sourceFile);
      if (!sourceFile) continue;
      const resolvedSourceFile = resolveRepoPath(sourceFile);
      if (!fileExists(resolvedSourceFile)) {
        blockers.push({
          code: "identity_preflight_source_context_file_missing",
          message:
            "A matching source-index row points to a source_file that no longer exists.",
          source_index: repoRelativePath(indexPath),
          source_file: repoRelativeMaybe(resolvedSourceFile),
          dataset_key: key,
        });
        continue;
      }
      if (!sourceFilesByIdentity.has(key)) {
        sourceFilesByIdentity.set(key, resolvedSourceFile);
      }
    }
  }
  return {
    sourceFilesByIdentity,
    rowCount,
    blockers,
  };
}

function attachIdentityPreflightRows(queueRows, identityArtifacts) {
  for (const row of queueRows) {
    const match = identityArtifacts.byIdentity.get(
      `${row.dataset_type}:${row.dataset_id}:${row.dataset_version}`,
    );
    if (!match) continue;
    row.identity_preflight_request_file = match.request_file;
    row.identity_preflight_command = match.command;
    row.remote_search = match.remote_search;
  }
}

function identityPreflightRunIndexPath(options) {
  return resolveRepoPath(
    options.index ||
      options.input ||
      options.identityPreflightIndex ||
      options.identityPreflightRequests,
  );
}

function identityPreflightSpawnTimeoutMs(timeoutMs) {
  const graceMs = Math.min(5_000, Math.max(250, Math.ceil(timeoutMs * 0.1)));
  return timeoutMs + graceMs;
}

function identityPreflightRunReportFile(row) {
  const explicit =
    row.expected_report_file ||
    row.identity_decision_file ||
    row.identityDecisionFile ||
    row.report_file ||
    row.reportFile;
  if (explicit) return resolveRepoPath(explicit);
  const outputDir = row.output_dir || row.outputDir;
  return outputDir
    ? path.join(resolveRepoPath(outputDir), "outputs", "identity-decision.json")
    : null;
}

function identityPreflightRunOutputDir(row) {
  const outputDir = row.output_dir || row.outputDir;
  if (outputDir) return resolveRepoPath(outputDir);
  const reportFile = identityPreflightRunReportFile(row);
  return reportFile ? path.dirname(path.dirname(reportFile)) : null;
}

function identityPreflightRunRequestFile(row) {
  return resolveRepoPath(row.request_file || row.requestFile || row.input);
}

function identityPreflightRunRowKey(row, index) {
  return [
    row.dataset_type || row.type || "dataset",
    row.dataset_id || row.entity_id || row.id || `row-${index}`,
    row.dataset_version || row.version || "00.00.001",
  ].join(":");
}

function selectIdentityPreflightRunRows(rows, options) {
  const datasetTypes = new Set(
    normalizedList(options.datasetType || options.datasetTypes || options.type),
  );
  const ids = new Set(normalizedList(options.id || options.ids || options.datasetId));
  const offset = Math.max(0, integerOption(options.offset, 0) ?? 0);
  const limit = positiveIntegerOption(options.limit || options.count, null);
  const filtered = rows.filter((row) => {
    const datasetType = asText(row.dataset_type || row.type);
    const id = asText(row.dataset_id || row.entity_id || row.id);
    if (datasetTypes.size > 0 && !datasetTypes.has(datasetType)) return false;
    if (ids.size > 0 && !ids.has(id)) return false;
    return true;
  });
  return filtered.slice(offset, limit ? offset + limit : undefined);
}

function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function runDatasetIdentityPreflightRun(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-identity-preflight-run",
      purpose:
        "Execute Foundry-generated process/flow identity-preflight request indexes through the CLI without writing the database.",
      usage: [
        "node scripts/foundry.mjs dataset-identity-preflight-run --index <identity-preflight-requests.jsonl> --out-dir <run-dir> --timeout-ms 60000",
        "node scripts/foundry.mjs dataset-identity-preflight-run --index ./identity-preflight-requests/identity-preflight-requests.jsonl --only-pending --timeout-ms 60000",
      ],
      remote_write_mode: "read-only",
    };
  }
  const indexPath = identityPreflightRunIndexPath(options);
  if (!indexPath || !fileExists(indexPath)) {
    throw new Error(
      "--index is required and must point to identity-preflight-requests.jsonl.",
    );
  }
  const outDir = resolveRepoPath(
    options.outDir ||
      path.join(path.dirname(path.dirname(indexPath)), "identity-preflight-run"),
  );
  const rows = readJsonLines(indexPath);
  const selectedRows = selectIdentityPreflightRunRows(rows, options);
  const onlyPending = booleanOption(options.onlyPending);
  const dryRun = booleanOption(options.dryRun);
  const timeoutMs = positiveIntegerOption(
    options.timeoutMs || options.timeout || options.identityPreflightTimeoutMs,
    60_000,
  );
  const spawnTimeoutMs = identityPreflightSpawnTimeoutMs(timeoutMs);
  const cliBin = resolveTiangongLcaCliBin();
  const logDir = path.join(outDir, "logs");
  const resultRows = [];

  selectedRows.forEach((row, selectedIndex) => {
    const datasetType = asText(row.dataset_type || row.type);
    const datasetId = asText(row.dataset_id || row.entity_id || row.id);
    const datasetVersion =
      asText(row.dataset_version || row.version) || "00.00.001";
    const requestFile = identityPreflightRunRequestFile(row);
    const outputDir = identityPreflightRunOutputDir(row);
    const reportFile = identityPreflightRunReportFile(row);
    const key = identityPreflightRunRowKey(row, selectedIndex);
    const logToken = safeFileToken(key, `row-${selectedIndex}`);
    const stdoutLog = path.join(logDir, `${logToken}.stdout.json`);
    const stderrLog = path.join(logDir, `${logToken}.stderr.log`);

    if (onlyPending && reportFile && fileExists(reportFile)) {
      const existingReport = readJson(reportFile);
      resultRows.push({
        selected_index: selectedIndex,
        dataset_type: datasetType,
        dataset_id: datasetId,
        dataset_version: datasetVersion,
        status: "skipped_existing_report",
        cli_exit_code: null,
        report_status: existingReport.status ?? null,
        decision: existingReport.decision ?? null,
        request_file: repoRelativeMaybe(requestFile),
        output_dir: repoRelativeMaybe(outputDir),
        report_file: repoRelativeMaybe(reportFile),
      });
      return;
    }

    const cliArgs = [
      datasetType,
      "identity-preflight",
      "--input",
      requestFile,
      "--out-dir",
      outputDir,
      "--json",
      "--timeout-ms",
      String(timeoutMs),
    ];
    const baseRow = {
      selected_index: selectedIndex,
      dataset_type: datasetType,
      dataset_id: datasetId,
      dataset_version: datasetVersion,
      request_file: repoRelativeMaybe(requestFile),
      output_dir: repoRelativeMaybe(outputDir),
      report_file: repoRelativeMaybe(reportFile),
      command: [cliBin, ...cliArgs].map(shellQuote).join(" "),
      stdout_log: repoRelativePath(stdoutLog),
      stderr_log: repoRelativePath(stderrLog),
    };

    if (!datasetType || !["flow", "process"].includes(datasetType)) {
      resultRows.push({
        ...baseRow,
        status: "failed",
        failure_code: "identity_preflight_dataset_type_invalid",
        cli_exit_code: null,
        report_status: null,
        decision: null,
      });
      return;
    }
    if (!requestFile || !fileExists(requestFile)) {
      resultRows.push({
        ...baseRow,
        status: "failed",
        failure_code: "identity_preflight_request_missing",
        cli_exit_code: null,
        report_status: null,
        decision: null,
      });
      return;
    }
    if (!outputDir) {
      resultRows.push({
        ...baseRow,
        status: "failed",
        failure_code: "identity_preflight_output_dir_missing",
        cli_exit_code: null,
        report_status: null,
        decision: null,
      });
      return;
    }
    if (dryRun) {
      resultRows.push({
        ...baseRow,
        status: "planned",
        cli_exit_code: null,
        report_status: null,
        decision: null,
      });
      return;
    }

    const result = spawnSync(cliBin, cliArgs, {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      timeout: spawnTimeoutMs,
      killSignal: "SIGTERM",
    });
    writeText(stdoutLog, result.stdout || "");
    writeText(stderrLog, result.stderr || "");
    const timedOut =
      result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
    if (result.error && !timedOut) throw result.error;
    const cliExitCode = typeof result.status === "number" ? result.status : 1;
    const stdoutReport = parseJsonMaybe(result.stdout);
    const diskReport = reportFile && fileExists(reportFile) ? readJson(reportFile) : null;
    const report = stdoutReport || diskReport;
    if (timedOut) {
      resultRows.push({
        ...baseRow,
        status: "failed",
        failure_code: "identity_preflight_timeout",
        cli_exit_code: null,
        report_status: report?.status ?? null,
        decision: report?.decision ?? null,
        confidence: report?.confidence ?? null,
        next_action: report?.next_action ?? null,
        blocker_count: ensureArray(report?.blockers).length,
        candidate_count: ensureArray(report?.candidates).length,
        candidate_source_count: ensureArray(report?.candidate_sources).length,
        signal: result.signal ?? null,
        timeout_ms: timeoutMs,
        spawn_timeout_ms: spawnTimeoutMs,
      });
      return;
    }
    resultRows.push({
      ...baseRow,
      status: report ? "completed" : "failed",
      failure_code: report ? null : "identity_preflight_report_missing_or_non_json",
      cli_exit_code: cliExitCode,
      report_status: report?.status ?? null,
      decision: report?.decision ?? null,
      confidence: report?.confidence ?? null,
      next_action: report?.next_action ?? null,
      blocker_count: ensureArray(report?.blockers).length,
      candidate_count: ensureArray(report?.candidates).length,
      candidate_source_count: ensureArray(report?.candidate_sources).length,
    });
  });

  const failedRows = resultRows.filter((row) => row.status === "failed");
  const identityFindingRows = resultRows.filter((row) =>
    ["blocked", "needs_review"].includes(row.report_status),
  );
  const status = dryRun
    ? "planned"
    : failedRows.length > 0
      ? "failed"
      : identityFindingRows.length > 0
        ? "completed_with_identity_findings"
        : "completed";
  const resultsPath = path.join(outDir, "identity-preflight-run-results.jsonl");
  const reportPath = path.join(outDir, "dataset-identity-preflight-run-report.json");
  writeJsonLines(resultsPath, resultRows);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status,
    command: "dataset-identity-preflight-run",
    index_file: repoRelativePath(indexPath),
    remote_write_mode: "read-only",
    runtime_options: {
      timeout_ms: timeoutMs,
      spawn_timeout_ms: spawnTimeoutMs,
    },
    counts: {
      index_rows: rows.length,
      selected_rows: selectedRows.length,
      planned: resultRows.filter((row) => row.status === "planned").length,
      completed: resultRows.filter((row) => row.status === "completed").length,
      skipped_existing_report: resultRows.filter(
        (row) => row.status === "skipped_existing_report",
      ).length,
      failed: failedRows.length,
      identity_blocked: resultRows.filter((row) => row.report_status === "blocked")
        .length,
      identity_needs_review: resultRows.filter(
        (row) => row.report_status === "needs_review",
      ).length,
      cli_exit_nonzero: resultRows.filter(
        (row) => Number.isInteger(row.cli_exit_code) && row.cli_exit_code !== 0,
      ).length,
    },
    policy: {
      valid_identity_findings_are_not_tool_failures:
        "CLI identity-preflight status blocked/needs_review is retained as evidence for Foundry AI authoring and does not fail this batch runner.",
      curation_gate_usage:
        "Pass this same index to dataset-curation-gate with --identity-preflight-index so authoring packages include current and dependency identity-preflight context.",
    },
    files: {
      report: repoRelativePath(reportPath),
      results: repoRelativePath(resultsPath),
    },
    results: resultRows,
  };
  writeJson(reportPath, report);
  return report;
}

function identityPreflightIndexMergeKey(row) {
  const datasetType = asText(row?.dataset_type || row?.type);
  const datasetId = asText(row?.dataset_id || row?.entity_id || row?.id);
  const datasetVersion =
    asText(row?.dataset_version || row?.version) || "00.00.001";
  if (!datasetType || !datasetId || !datasetVersion) return null;
  return `${datasetType}::${datasetId}::${datasetVersion}`;
}

function runDatasetIdentityPreflightIndexMerge(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-identity-preflight-index-merge",
      purpose:
        "Merge refreshed current-scope identity-preflight request rows into an existing index while preserving dependency preflight evidence. This command is local-only and never writes the database.",
      usage: [
        "node scripts/foundry.mjs dataset-identity-preflight-index-merge --base-index <old identity-preflight-requests.jsonl> --update-index <fresh current identity-preflight-requests.jsonl> --out-dir <merge-dir>",
        "node scripts/foundry.mjs dataset-identity-preflight-index-merge --base-index ./identity-preflight-requests.jsonl --update-index ./fresh/identity-preflight-requests.jsonl",
      ],
      remote_write_mode: "read-only",
    };
  }
  const baseIndex = resolveRepoPath(
    options.baseIndex || options.base || options.index,
  );
  if (!baseIndex || !fileExists(baseIndex)) {
    throw new Error(
      "--base-index is required and must point to identity-preflight-requests.jsonl.",
    );
  }
  const updateIndexes = normalizedList(
    options.updateIndex ||
      options.updateIndexes ||
      options.refreshIndex ||
      options.refreshIndexes,
  ).map(resolveRepoPath);
  if (updateIndexes.length === 0 || updateIndexes.some((file) => !fileExists(file))) {
    throw new Error(
      "--update-index is required and every update index must be readable.",
    );
  }
  const outDir = resolveRepoPath(
    options.outDir || path.join(path.dirname(path.dirname(baseIndex)), "identity-preflight-index-merge"),
  );
  const outPath = resolveRepoPath(
    options.out ||
      options.output ||
      path.join(outDir, "identity-preflight-requests.jsonl"),
  );
  const reportPath = path.join(outDir, "dataset-identity-preflight-index-merge-report.json");
  const blockers = [];
  const mergedRows = [];
  const rowIndexByKey = new Map();
  const stats = {
    base_rows: 0,
    update_indexes: updateIndexes.length,
    update_rows: 0,
    replaced_rows: 0,
    added_rows: 0,
    duplicate_update_rows: 0,
  };

  const addRow = (row, sourceFile, sourceIndex, mode) => {
    const key = identityPreflightIndexMergeKey(row);
    if (!key) {
      blockers.push({
        code: "identity_preflight_index_row_key_missing",
        message:
          "Identity preflight index rows must include dataset_type, dataset_id, and dataset_version.",
        source_file: repoRelativeMaybe(sourceFile),
        source_index: sourceIndex,
        mode,
      });
      return;
    }
    const nextRow = {
      ...row,
      merge_source: mode,
      merge_source_file: repoRelativeMaybe(sourceFile),
    };
    if (!rowIndexByKey.has(key)) {
      rowIndexByKey.set(key, mergedRows.length);
      mergedRows.push(nextRow);
      if (mode === "update") stats.added_rows += 1;
      return;
    }
    const existingIndex = rowIndexByKey.get(key);
    if (mode === "base") {
      blockers.push({
        code: "identity_preflight_index_base_duplicate_key",
        message:
          "Base identity preflight index contains duplicate dataset identity rows.",
        key,
        source_file: repoRelativeMaybe(sourceFile),
        source_index: sourceIndex,
      });
      return;
    }
    if (mergedRows[existingIndex]?.merge_source === "update") {
      stats.duplicate_update_rows += 1;
    } else {
      stats.replaced_rows += 1;
    }
    mergedRows[existingIndex] = nextRow;
  };

  const baseRows = readJsonLines(baseIndex);
  stats.base_rows = baseRows.length;
  baseRows.forEach((row, index) => addRow(row, baseIndex, index, "base"));
  for (const updateIndex of updateIndexes) {
    const updateRows = readJsonLines(updateIndex);
    stats.update_rows += updateRows.length;
    updateRows.forEach((row, index) => addRow(row, updateIndex, index, "update"));
  }

  if (blockers.length === 0) writeJsonLines(outPath, mergedRows);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length === 0 ? "ready" : "blocked",
    command: "dataset-identity-preflight-index-merge",
    remote_write_mode: "read-only",
    policy: {
      exact_rows_scope:
        "Updated rows replace base rows by dataset_type + dataset_id + dataset_version, preserving dependency preflight rows that were not refreshed.",
      post_patch_usage:
        "Use this after field patch apply plus current-scope identity-preflight refresh, then pass the merged index to dataset-curation-gate.",
    },
    inputs: {
      base_index: repoRelativePath(baseIndex),
      update_indexes: updateIndexes.map(repoRelativePath),
    },
    counts: {
      ...stats,
      output_rows: blockers.length === 0 ? mergedRows.length : 0,
      blockers: blockers.length,
    },
    files: {
      report: repoRelativePath(reportPath),
      merged_index: blockers.length === 0 ? repoRelativePath(outPath) : null,
    },
    blockers,
  };
  writeJson(reportPath, report);
  return report;
}

function identityReferenceRewriteIndexPath(options, rowsFile) {
  const explicit =
    options.identityPreflightIndex ||
    options.identityPreflightRequests ||
    options.identityPreflightRequestsIndex ||
    options.identityPreflightFile;
  if (explicit) return resolveRepoPath(explicit);
  if (!rowsFile) return null;
  const defaultPath = path.join(
    path.dirname(path.dirname(rowsFile)),
    "identity-preflight-requests",
    "identity-preflight-requests.jsonl",
  );
  return fileExists(defaultPath) ? defaultPath : null;
}

function firstCandidateName(candidate) {
  return (
    preferredSourceLanguageText(candidate?.names) ||
    asText(candidate?.name_en) ||
    asText(candidate?.name)
  );
}

function flowGlobalReference({ id, version, shortDescription }) {
  const description = shortDescription || id;
  return {
    "@type": "flow data set",
    "@refObjectId": id,
    "@version": version || "00.00.001",
    "@uri": `../flows/${id}.json`,
    "common:shortDescription": multiLang(description, languageForText(description)),
  };
}

function referenceShortDescription(reference) {
  const description =
    reference?.["common:shortDescription"] ?? reference?.shortDescription;
  if (typeof description === "string") return description.trim();
  if (description && typeof description === "object" && !Array.isArray(description)) {
    return asText(description["#text"] ?? description.value);
  }
  return "";
}

function duplicateFlowCandidateFromReport(report) {
  if (
    asText(report?.kind) !== "flow" ||
    asText(report?.decision) !== "block_duplicate" ||
    asText(report?.confidence) !== "high"
  ) {
    return null;
  }
  return (
    ensureArray(report?.candidates).find((candidate) => {
      const reasons = ensureArray(candidate?.match_reasons).map(asText);
      return (
        asText(candidate?.decision_hint) === "block_duplicate" ||
        reasons.includes("equivalent_flow_core_fields") ||
        reasons.includes("same_identity_key")
      );
    }) ?? null
  );
}

function loadIdentityDuplicateFlowMappings(indexPath) {
  const mappings = new Map();
  const rows = indexPath && fileExists(indexPath) ? readJsonLines(indexPath) : [];
  for (const row of rows) {
    const datasetType = asText(row.dataset_type || row.type);
    if (datasetType !== "flow") continue;
    const sourceId = asText(row.dataset_id || row.entity_id || row.id);
    const sourceVersion =
      asText(row.dataset_version || row.version) || "00.00.001";
    if (!sourceId) continue;
    const reportFile = identityPreflightRunReportFile(row);
    const report = reportFile && fileExists(reportFile) ? readJson(reportFile) : null;
    const candidate = duplicateFlowCandidateFromReport(report);
    const canonicalId = asText(candidate?.id);
    if (!canonicalId) continue;
    const mapping = {
      source: {
        ref_object_id: sourceId,
        version: sourceVersion,
      },
      canonical: {
        table: "flows",
        ref_object_id: canonicalId,
        version: asText(candidate?.version) || "00.00.001",
        short_description: firstCandidateName(candidate) || canonicalId,
      },
      identity_preflight: {
        index_file: repoRelativePath(indexPath),
        report_file: repoRelativeMaybe(reportFile),
        decision: report.decision,
        status: report.status,
        confidence: report.confidence ?? null,
        candidate_index: candidate.index ?? null,
        candidate_match_score: candidate.match_score ?? null,
        candidate_match_reasons: ensureArray(candidate.match_reasons),
      },
    };
    mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
    if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
  }
  return { rows, mappings };
}

function identityReferenceRewriteInputFile(options = {}) {
  return identityReferenceRewriteInputFiles(options)[0] ?? null;
}

function jsonLineFileHasRows(filePath) {
  return Boolean(filePath && fileExists(filePath) && readJsonLines(filePath).length > 0);
}

function identityReferenceRewriteInputFiles(options = {}) {
  const files = [];
  const directOptions = [
    options.identityReferenceRewrites,
    options.identityReferenceRewritesFile,
    options.identityFlowReferenceRewrites,
    options.identityFlowReferenceRewritesFile,
  ];
  for (const directOption of directOptions) {
    for (const item of normalizedList(directOption)) {
      const filePath = resolveRepoPath(item);
      if (jsonLineFileHasRows(filePath)) files.push(filePath);
    }
  }
  const reportOptions = unique([
    ...normalizedList(options.identityDecisionApplyReport),
    ...normalizedList(options.identityDecisionsApplyReport),
    ...normalizedList(options.identityDecisionApplyReports),
    ...normalizedList(options.identityDecisionsApplyReports),
  ]);
  for (const reportOption of reportOptions) {
    const reportFile = resolveRepoPath(reportOption);
    if (!reportFile || !fileExists(reportFile)) continue;
    const report = readJson(reportFile);
    const rewriteFile = resolveRepoPath(report.files?.identity_reference_rewrites);
    if (jsonLineFileHasRows(rewriteFile)) files.push(rewriteFile);
  }
  return unique(files);
}

function identityUnresolvedReferenceInputFiles(options = {}) {
  const files = [];
  const directOptions = [
    options.identityUnresolvedReferences,
    options.identityUnresolvedReferencesFile,
    options.identityUnresolvedReferenceFile,
  ];
  for (const directOption of directOptions) {
    for (const item of normalizedList(directOption)) {
      const filePath = resolveRepoPath(item);
      if (filePath && fileExists(filePath)) files.push(filePath);
    }
  }
  const reportOptions = unique([
    ...normalizedList(options.identityDecisionApplyReport),
    ...normalizedList(options.identityDecisionsApplyReport),
    ...normalizedList(options.identityDecisionApplyReports),
    ...normalizedList(options.identityDecisionsApplyReports),
  ]);
  for (const reportOption of reportOptions) {
    const reportFile = resolveRepoPath(reportOption);
    if (!reportFile || !fileExists(reportFile)) continue;
    const report = readJson(reportFile);
    const unresolvedFile = resolveRepoPath(
      report.files?.identity_unresolved_references,
    );
    if (unresolvedFile && fileExists(unresolvedFile)) files.push(unresolvedFile);
  }
  return unique(files);
}

function loadIdentityReferenceRewriteMappings(rewriteFiles) {
  const mappings = new Map();
  const rows = [];
  for (const rewriteFile of ensureArray(rewriteFiles)) {
    if (!rewriteFile || !fileExists(rewriteFile)) continue;
    for (const row of readJsonLines(rewriteFile)) {
      rows.push(row);
    const original = row?.original ?? {};
    const canonical = row?.canonical ?? {};
    const sourceId = asText(
      original.ref_object_id ??
        original.refObjectId ??
        original.id ??
        row?.dataset_id,
    );
    const sourceVersion =
      asText(
        original.version ??
          original.ref_version ??
          original["@version"] ??
          row?.dataset_version,
      ) || "00.00.001";
    const canonicalId = asText(
      canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id,
    );
    if (!sourceId || !canonicalId) continue;
    const mapping = {
      source: {
        ref_object_id: sourceId,
        version: sourceVersion,
      },
      canonical: {
        table: asText(canonical.table) || "flows",
        ref_object_id: canonicalId,
        version:
          asText(
            canonical.version ?? canonical.ref_version ?? canonical["@version"],
          ) || "00.00.001",
        short_description:
          asText(canonical.short_description ?? canonical.shortDescription) ||
          canonicalId,
      },
      identity_preflight: row.identity_preflight ?? null,
      identity_decision: row.identity_decision ?? null,
      rewrite_source: {
        file: repoRelativePath(rewriteFile),
        relation: row.relation ?? null,
        action: row.action ?? null,
        reason: row.reason ?? null,
      },
    };
    mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
    if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
    }
  }
  return { rows, mappings };
}

function loadIdentityUnresolvedReferenceMappings(files) {
  const mappings = new Map();
  const rows = [];
  for (const filePath of ensureArray(files)) {
    if (!filePath || !fileExists(filePath)) continue;
    for (const row of readJsonLines(filePath)) {
      rows.push(row);
      const original = row?.original ?? {};
      const sourceId = asText(
        original.ref_object_id ??
          original.refObjectId ??
          original.id ??
          row?.dataset_id,
      );
      const sourceVersion =
        asText(
          original.version ??
            original.ref_version ??
            original["@version"] ??
            row?.dataset_version,
        ) || "00.00.001";
      if (!sourceId) continue;
      const mapping = {
        source: {
          ref_object_id: sourceId,
          version: sourceVersion,
          short_description:
            asText(original.short_description ?? original.shortDescription) ||
            sourceId,
        },
        identity_decision: row.identity_decision ?? null,
        identity_evidence: row.evidence ?? null,
        unresolved_source: {
          file: repoRelativePath(filePath),
          relation: row.relation ?? null,
          action: row.action ?? null,
          reason: row.reason ?? null,
        },
      };
      mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
      if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
    }
  }
  return { rows, mappings };
}

function processDataSetInformation(row) {
  return row?.processDataSet?.processInformation?.dataSetInformation ?? null;
}

function ensureCommonOther(dataSetInformation) {
  if (!dataSetInformation || typeof dataSetInformation !== "object") return null;
  const current = dataSetInformation["common:other"];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current;
  }
  dataSetInformation["common:other"] = {};
  return dataSetInformation["common:other"];
}

function appendUnresolvedFlowReferenceTrace(row, traceEntry) {
  const commonOther = ensureCommonOther(processDataSetInformation(row));
  if (!commonOther) return false;
  commonOther["@xmlns:tiangongfoundry"] =
    commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
  const key = "tiangongfoundry:unresolvedTrace";
  const current = commonOther[key];
  if (current === undefined) {
    commonOther[key] = [traceEntry];
  } else if (Array.isArray(current)) {
    current.push(traceEntry);
  } else {
    commonOther[key] = [current, traceEntry];
  }
  return true;
}

function unresolvedFlowTraceReferenceId(trace) {
  return asText(
    trace?.reference_id ??
      trace?.referenceId ??
      trace?.evidence?.target?.id ??
      trace?.evidence?.target?.["@refObjectId"] ??
      trace?.evidence?.identity_decision?.evidence?.target?.id ??
      trace?.evidence?.identity_decision?.evidence?.target?.["@refObjectId"],
  );
}

function blockedFlowReferenceBlockerFiles(options = {}) {
  return normalizedList(
    options.blockedFlowReferenceBlockers ||
      options.blockedFlowReferenceBlockersFile ||
      options.upstreamFlowBlockers ||
      options.upstreamFlowBlockersFile ||
      options.canonicalSupportBlockers ||
      options.canonicalSupportBlockersFile,
  )
    .map(resolveRepoPath)
    .filter(fileExists);
}

function blockedFlowReferenceBlockersById(options = {}) {
  const byId = new Map();
  for (const filePath of blockedFlowReferenceBlockerFiles(options)) {
    for (const blocker of readJsonLines(filePath)) {
      const datasetType = asText(
        blocker.dataset_type ?? blocker.datasetType ?? blocker.type,
      );
      const code = asText(blocker.code ?? blocker.blocker_code ?? blocker.blockerCode);
      if (datasetType && datasetType !== "flow") continue;
      if (code && code !== "canonical_flow_property_reference_unresolved") {
        continue;
      }
      const id = asText(
        blocker.dataset_id ??
          blocker.datasetId ??
          blocker.entity_id ??
          blocker.id,
      );
      if (!id) continue;
      const existing = byId.get(id) ?? [];
      existing.push({
        ...blocker,
        blocker_file: repoRelativePath(filePath),
      });
      byId.set(id, existing);
    }
  }
  return byId;
}

function externalizeUnresolvedProcessFlowExchanges({
  datasetType,
  rowsFile,
  outFile,
  outDir,
  options = {},
}) {
  const reportFile = path.join(outDir, "unresolved-exchange-externalization-report.json");
  const tracesFile = path.join(outDir, "unresolved-exchanges.jsonl");
  if (datasetType !== "process") {
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      stage: "unresolved_exchange_externalization",
      status: "not_required",
      input_rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(rowsFile),
      counts: {
        rows: countRowsFile(rowsFile),
        affected_rows: 0,
        externalized_exchanges: 0,
      },
      files: {
        report: repoRelativePath(reportFile),
        output_rows: repoRelativePath(rowsFile),
        traces: null,
      },
    };
    writeJson(reportFile, report);
    return report;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const rows = readRowsFile(rowsFile);
  const externalized = [];
  const blockedFlowReferencesById = blockedFlowReferenceBlockersById(options);
  let affectedRows = 0;
  let elementaryFlowExternalized = 0;
  let blockedDependencyExternalized = 0;

  rows.forEach((row, rowIndex) => {
    const processDataSet = row?.processDataSet ?? row?.json_ordered?.processDataSet;
    const dataSetInformation =
      processDataSet?.processInformation?.dataSetInformation ?? null;
    const commonOther = ensureCommonOther(dataSetInformation);
    const unresolvedTraces = ensureArray(
      commonOther?.["tiangongfoundry:unresolvedTrace"],
    );
    const unresolvedById = new Map();
    for (const trace of unresolvedTraces) {
      if (trace?.action_item_code !== "elementary_flow_identity_manual_review") {
        continue;
      }
      const referenceId = unresolvedFlowTraceReferenceId(trace);
      if (referenceId) {
        unresolvedById.set(referenceId, trace);
      }
    }
    if (unresolvedById.size === 0 && blockedFlowReferencesById.size === 0) {
      return;
    }

    const exchanges = ensureArray(processDataSet?.exchanges?.exchange);
    if (exchanges.length === 0) return;
    const kept = [];
    let rowExternalized = 0;
    for (const [exchangeIndex, exchange] of exchanges.entries()) {
      const reference = exchange?.referenceToFlowDataSet;
      const referenceId = asText(reference?.["@refObjectId"] ?? reference?.refObjectId);
      const unresolvedTrace = referenceId ? unresolvedById.get(referenceId) : null;
      const blockedFlowReferenceBlockers = referenceId
        ? (blockedFlowReferencesById.get(referenceId) ?? [])
        : [];
      if (
        !referenceId ||
        (!unresolvedTrace && blockedFlowReferenceBlockers.length === 0)
      ) {
        kept.push(exchange);
        continue;
      }

      commonOther["@xmlns:tiangongfoundry"] =
        commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
      const actionItemCode = unresolvedTrace
        ? "elementary_flow_exchange_externalized"
        : "blocked_flow_dependency_exchange_externalized";
      const externalizedTrace = {
        status: "externalized_before_remote_write",
        action_item_code: actionItemCode,
        blocked_path: `processDataSet.exchanges.exchange.${exchangeIndex}.referenceToFlowDataSet`,
        reference_id: referenceId,
        reference_version: asText(reference?.["@version"] ?? reference?.version) || null,
        reason: unresolvedTrace
          ? "Formal exchange references an unresolved elementary flow identity. Foundry moved the full exchange into common:other trace before remote write planning so the process can remain schema-valid while preserving source evidence for later repair."
          : "Formal exchange references a flow row that cannot be written because its required Flow Property or Unit Group is not backed by a canonical public database support row. Foundry moved the full exchange into common:other trace before remote write planning to avoid a dangling flow reference.",
        unresolved_trace: unresolvedTrace ? cloneJson(unresolvedTrace) : null,
        upstream_flow_blockers:
          blockedFlowReferenceBlockers.length > 0
            ? cloneJson(blockedFlowReferenceBlockers)
            : [],
        original_exchange: cloneJson(exchange),
        next_action: unresolvedTrace
          ? "Resolve this elementary flow against an approved public TianGong flow, then restore a formal process exchange in a later curated repair."
          : "Add the missing public canonical Flow Property or Unit Group support row, rerun flow finalization, then restore this process exchange in a later curated repair.",
      };
      const traceKey = "tiangongfoundry:unresolvedExchangeTrace";
      const current = commonOther[traceKey];
      if (current === undefined) {
        commonOther[traceKey] = [externalizedTrace];
      } else if (Array.isArray(current)) {
        current.push(externalizedTrace);
      } else {
        commonOther[traceKey] = [current, externalizedTrace];
      }
      externalized.push({
        relation: unresolvedTrace
          ? "process_exchange_to_unresolved_elementary_flow_trace"
          : "process_exchange_to_blocked_flow_dependency_trace",
        action: "externalize_exchange_before_remote_write",
        dataset_type: "process",
        dataset_id: datasetIdentity(row, "process").id || null,
        dataset_version: datasetIdentity(row, "process").version || null,
        row_index: rowIndex,
        exchange_index: exchangeIndex,
        path: externalizedTrace.blocked_path,
        original: {
          table: "flows",
          ref_object_id: referenceId,
          version: externalizedTrace.reference_version,
          short_description: referenceShortDescription(reference) || null,
        },
        trace: externalizedTrace,
      });
      if (unresolvedTrace) {
        elementaryFlowExternalized += 1;
      } else {
        blockedDependencyExternalized += 1;
      }
      rowExternalized += 1;
    }
    if (rowExternalized > 0) {
      affectedRows += 1;
      processDataSet.exchanges = processDataSet.exchanges ?? {};
      processDataSet.exchanges.exchange = kept;
    }
  });

  writeJsonLines(outFile, rows);
  writeJsonLines(tracesFile, externalized);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    stage: "unresolved_exchange_externalization",
    status: "completed",
    input_rows_file: repoRelativePath(rowsFile),
    output_rows_file: repoRelativePath(outFile),
    counts: {
      rows: rows.length,
      affected_rows: affectedRows,
      externalized_exchanges: externalized.length,
      elementary_flow_externalized: elementaryFlowExternalized,
      blocked_flow_dependency_externalized: blockedDependencyExternalized,
      upstream_blocked_flow_references: blockedFlowReferencesById.size,
    },
    files: {
      report: repoRelativePath(reportFile),
      output_rows: repoRelativePath(outFile),
      traces: repoRelativePath(tracesFile),
      blocked_flow_reference_blockers: blockedFlowReferenceBlockerFiles(options).map(
        repoRelativePath,
      ),
    },
  };
  writeJson(reportFile, report);
  return report;
}

function rewriteIdentityDuplicateFlowReferences(
  value,
  {
    mappings,
    unresolvedMappings,
    datasetIdentityCache,
    rowRoot,
    rowIndex,
    rewriteRows,
    unresolvedRows,
    stats,
    pathSegments = [],
  },
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rewriteIdentityDuplicateFlowReferences(item, {
        mappings,
        unresolvedMappings,
        datasetIdentityCache,
        rowRoot,
        rowIndex,
        rewriteRows,
        unresolvedRows,
        stats,
        pathSegments: [...pathSegments, index],
      }),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathSegments, key];
    if (
      key === "referenceToFlowDataSet" &&
      child &&
      typeof child === "object" &&
      !Array.isArray(child)
    ) {
      const originalId = asText(child["@refObjectId"] ?? child.refObjectId);
      const originalVersion =
        asText(child["@version"] ?? child.version) || "00.00.001";
      const mapping =
        mappings.get(`${originalId}@@${originalVersion}`) ??
        mappings.get(originalId);
      if (mapping) {
        const next = flowGlobalReference({
          id: mapping.canonical.ref_object_id,
          version: mapping.canonical.version,
          shortDescription: mapping.canonical.short_description,
        });
        value[key] = next;
        stats.rewrites += 1;
	        rewriteRows.push({
	          relation:
              mapping.rewrite_source?.relation ??
              "flow_reference_to_identity_preflight_duplicate",
	          action:
              mapping.rewrite_source?.action ??
              "rewrite_to_identity_preflight_duplicate_reference",
	          dataset_type: "process",
          dataset_id: datasetIdentityCache?.id ?? null,
          dataset_version: datasetIdentityCache?.version ?? null,
          row_index: rowIndex,
          path: pathExpression(childPath),
          original: {
            table: "flows",
            ref_object_id: originalId || null,
            version: originalVersion || null,
            short_description: referenceShortDescription(child) || null,
          },
          canonical: {
            table: "flows",
            ref_object_id: next["@refObjectId"],
            version: next["@version"],
            short_description:
              next["common:shortDescription"]?.["#text"] ?? null,
          },
	          identity_preflight: mapping.identity_preflight,
          identity_decision: mapping.identity_decision ?? null,
          rewrite_source: mapping.rewrite_source ?? null,
	          reason:
            mapping.rewrite_source?.reason ||
	            "CLI identity-preflight selected an existing TianGong elementary flow duplicate; Foundry rewrote the process exchange reference before validation and write planning.",
	        });
        continue;
      }
      const unresolvedMapping =
        unresolvedMappings?.get(`${originalId}@@${originalVersion}`) ??
        unresolvedMappings?.get(originalId);
      if (unresolvedMapping && rowRoot) {
        const blockedPath = pathExpression(childPath);
        const traceEntry = {
          status: "unresolved_deferred",
          action_item_code: "elementary_flow_identity_manual_review",
          blocked_path: blockedPath,
          reference_id: originalId || null,
          reference_version: originalVersion || null,
          reason:
            unresolvedMapping.unresolved_source?.reason ||
            "AI identity authoring could not select a sufficient existing TianGong elementary flow reference; Foundry preserved the original process reference with a structured unresolved trace.",
          evidence: {
            source: "dataset-identity-decisions-apply",
            identity_decision: unresolvedMapping.identity_decision,
            unresolved_reference_file: unresolvedMapping.unresolved_source?.file,
            quote_or_trace:
              unresolvedMapping.source?.short_description || originalId || null,
            remote_search:
              unresolvedMapping.identity_evidence?.remote_search ?? null,
            target: unresolvedMapping.identity_evidence?.target ?? null,
            top_candidates:
              unresolvedMapping.identity_evidence?.top_candidates ?? null,
          },
          next_action:
            "Resolve this elementary flow against an approved public TianGong flow before publishing an upgraded row; do not create a BAFU-owned elementary flow.",
        };
        if (appendUnresolvedFlowReferenceTrace(rowRoot, traceEntry)) {
          stats.unresolved_traces += 1;
          unresolvedRows.push({
            relation: "flow_reference_to_unresolved_elementary_identity",
            action: "preserve_reference_with_unresolved_trace",
            dataset_type: "process",
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            path: blockedPath,
            original: {
              table: "flows",
              ref_object_id: originalId || null,
              version: originalVersion || null,
              short_description: referenceShortDescription(child) || null,
            },
            identity_decision: unresolvedMapping.identity_decision,
            unresolved_source: unresolvedMapping.unresolved_source,
            trace: traceEntry,
            reason: traceEntry.reason,
          });
        }
        continue;
      }
    }
    rewriteIdentityDuplicateFlowReferences(child, {
      mappings,
      unresolvedMappings,
      datasetIdentityCache,
      rowRoot,
      rowIndex,
      rewriteRows,
      unresolvedRows,
      stats,
      pathSegments: childPath,
    });
  }
}

function applyIdentityReferenceRewrites({
  datasetType,
  rowsFile,
  outFile,
  outDir,
  options = {},
  allowMissingIndex = false,
}) {
  const indexPath = identityReferenceRewriteIndexPath(options, rowsFile);
  const explicitRewriteFiles = identityReferenceRewriteInputFiles(options);
  const unresolvedReferenceFiles = identityUnresolvedReferenceInputFiles(options);
  const explicitRewriteMappings =
    loadIdentityReferenceRewriteMappings(explicitRewriteFiles);
  const unresolvedReferenceMappings =
    loadIdentityUnresolvedReferenceMappings(unresolvedReferenceFiles);
  const blockers = [];
  if (
    (!indexPath || !fileExists(indexPath)) &&
    explicitRewriteMappings.mappings.size === 0 &&
    unresolvedReferenceMappings.mappings.size === 0
  ) {
    if (!allowMissingIndex) {
      blockers.push({
        code: "identity_preflight_index_required",
        message:
          "Identity reference rewrites require a completed identity-preflight index or an identity decision rewrite file.",
      });
    }
    return {
      status: blockers.length > 0 ? "blocked" : "completed_no_index",
      rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(rowsFile),
      identity_preflight_index: indexPath ? repoRelativePath(indexPath) : null,
      identity_reference_rewrites_input: explicitRewriteFiles.map((file) =>
        repoRelativePath(file),
      ),
      identity_unresolved_references_input: unresolvedReferenceFiles.map((file) =>
        repoRelativePath(file),
      ),
      rewrite_rows: [],
      unresolved_reference_rows: [],
      rewrite_file: null,
      unresolved_references_file: null,
      counts: {
        input_rows: countRowsFile(rowsFile),
        output_rows: countRowsFile(rowsFile),
        identity_preflight_rows: 0,
        identity_unresolved_reference_rows: 0,
        duplicate_flow_mappings: 0,
        flow_reference_rewrites: 0,
        flow_reference_unresolved_traces: 0,
      },
      blockers,
    };
  }
  const rows = readRowsFile(rowsFile);
  const { rows: indexRows, mappings } = loadIdentityDuplicateFlowMappings(indexPath);
  for (const [key, mapping] of explicitRewriteMappings.mappings) {
    mappings.set(key, mapping);
  }
  const rewriteRows = [];
  const unresolvedRows = [];
  const referenceRows = [];
  const stats = { rewrites: 0, unresolved_traces: 0, root_unresolved: 0 };
  const rewrittenRows = [];
  rows.forEach((row, rowIndex) => {
    const next = cloneJson(row);
    if (datasetType === "flow") {
      const identity = datasetIdentity(next, "flow");
      const unresolvedMapping =
        unresolvedReferenceMappings.mappings.get(
          `${identity.id}@@${identity.version || "00.00.001"}`,
        ) ?? unresolvedReferenceMappings.mappings.get(identity.id);
      if (unresolvedMapping) {
        stats.unresolved_traces += 1;
        stats.root_unresolved += 1;
        unresolvedRows.push({
          relation: "root_flow_identity_unresolved",
          action: "defer_flow_row_before_remote_write",
          dataset_type: "flow",
          dataset_id: identity.id ?? null,
          dataset_version: identity.version || "00.00.001",
          row_index: rowIndex,
          path: "/flowDataSet",
          original: {
            table: "flows",
            ref_object_id: identity.id ?? null,
            version: identity.version || "00.00.001",
            short_description:
              asText(
                next?.flowDataSet?.flowInformation?.dataSetInformation?.name
                  ?.baseName?.["#text"],
              ) ||
              supportText(
                next?.flowDataSet?.flowInformation?.dataSetInformation?.name,
              ) ||
              identity.id ||
              null,
          },
          identity_decision: unresolvedMapping.identity_decision ?? null,
          unresolved_source: unresolvedMapping.unresolved_source ?? null,
          evidence: unresolvedMapping.identity_evidence ?? null,
          reason:
            unresolvedMapping.unresolved_source?.reason ||
            "AI identity authoring could not select a sufficient existing TianGong elementary flow reference; Foundry deferred this root flow row before remote write planning.",
          next_action:
            "Resolve this elementary flow against an approved public TianGong flow before publishing an upgraded row; do not create an account-local elementary flow.",
        });
        return;
      }
      const mapping =
        mappings.get(`${identity.id}@@${identity.version || "00.00.001"}`) ??
        mappings.get(identity.id);
      if (mapping) {
        referenceRows.push(next);
        stats.rewrites += 1;
        rewriteRows.push({
          relation: "flow_identity_preflight_duplicate_reference",
          action: "reuse_identity_preflight_duplicate_reference",
          dataset_type: "flow",
          dataset_id: identity.id ?? null,
          dataset_version: identity.version || "00.00.001",
          row_index: rowIndex,
          path: "/flowDataSet",
          original: {
            table: "flows",
            ref_object_id: identity.id ?? null,
            version: identity.version || "00.00.001",
            short_description:
              referenceShortDescription(
                next?.flowDataSet?.flowInformation?.dataSetInformation?.name,
              ) || null,
          },
          canonical: mapping.canonical,
          identity_preflight: mapping.identity_preflight,
          reason:
            "CLI identity-preflight selected an existing TianGong flow duplicate; Foundry moved this row to reference reuse instead of planning a BAFU-owned flow write.",
        });
        return;
      }
    }
    if (datasetType === "process") {
      rewriteIdentityDuplicateFlowReferences(next, {
        mappings,
        unresolvedMappings: unresolvedReferenceMappings.mappings,
        datasetIdentityCache: datasetIdentity(next, "process"),
        rowRoot: next,
        rowIndex,
        rewriteRows,
        unresolvedRows,
        stats,
      });
    }
    rewrittenRows.push(next);
  });
  const resolvedOutDir =
    outDir || path.join(path.dirname(rowsFile), "identity-reference-rewrites");
  const resolvedOutFile =
    outFile ||
    path.join(
      resolvedOutDir,
      `${datasetRowsFileStem(datasetType)}.identity-rewritten.jsonl`,
    );
  const rewriteFile = path.join(resolvedOutDir, "identity-reference-rewrites.jsonl");
  const unresolvedReferencesFile = path.join(
    resolvedOutDir,
    "identity-unresolved-references.jsonl",
  );
  const referenceRowsFile = path.join(
    resolvedOutDir,
    `${datasetRowsFileStem(datasetType)}.reference-reuse.jsonl`,
  );
  writeJsonLines(resolvedOutFile, rewrittenRows);
  writeJsonLines(rewriteFile, rewriteRows);
  writeJsonLines(unresolvedReferencesFile, unresolvedRows);
  writeJsonLines(referenceRowsFile, referenceRows);
  return {
    status:
      blockers.length > 0
        ? "blocked"
        : rewriteRows.length > 0 || unresolvedRows.length > 0
          ? "completed"
          : "completed_no_rewrites",
    rows_file: repoRelativePath(rowsFile),
    output_rows_file: repoRelativePath(resolvedOutFile),
    reference_rows_file:
      referenceRows.length > 0 ? repoRelativePath(referenceRowsFile) : null,
	    identity_preflight_index: indexPath ? repoRelativePath(indexPath) : null,
    identity_reference_rewrites_input: explicitRewriteFiles[0]
      ? repoRelativePath(explicitRewriteFiles[0])
      : null,
    identity_reference_rewrites_inputs: explicitRewriteFiles.map((file) =>
      repoRelativePath(file),
    ),
    identity_unresolved_references_input: unresolvedReferenceFiles.map((file) =>
      repoRelativePath(file),
    ),
	    rewrite_rows: rewriteRows,
    unresolved_reference_rows: unresolvedRows,
    rewrite_file: repoRelativePath(rewriteFile),
    unresolved_references_file: repoRelativePath(unresolvedReferencesFile),
    counts: {
      input_rows: rows.length,
      output_rows: rewrittenRows.length,
      reference_rows: referenceRows.length,
	      identity_preflight_rows: indexRows.length,
      identity_reference_rewrite_rows: explicitRewriteMappings.rows.length,
      identity_unresolved_reference_rows: unresolvedReferenceMappings.rows.length,
      duplicate_flow_mappings: new Set(
        [...mappings.values()].map((mapping) => mapping.source.ref_object_id),
      ).size,
      flow_reference_rewrites: rewriteRows.length,
      flow_reference_unresolved_traces: unresolvedRows.length,
      root_flow_unresolved_rows: stats.root_unresolved,
    },
    blockers,
  };
}

function runDatasetIdentityReferenceRewritesApply(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-identity-reference-rewrites-apply",
      usage: [
        "node scripts/foundry.mjs dataset-identity-reference-rewrites-apply --type process --rows-file <processes.jsonl> --identity-preflight-index <identity-preflight-requests.jsonl> --out <rewritten-processes.jsonl>",
      ],
      purpose:
        "Apply completed identity-preflight block_duplicate flow decisions to local process exchange references before validation and write planning.",
    };
  }
  const datasetType = asText(
    options.type || options.datasetType || "process",
  ).toLowerCase();
  const rowsFile = resolveRepoPath(options.rowsFile || options.input || options.rows);
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to process rows.");
  }
  const outDir = resolveRepoPath(
    options.outDir ||
      path.join(path.dirname(rowsFile), "identity-reference-rewrites"),
  );
  const outFile = resolveRepoPath(
    options.out ||
      options.output ||
      options.outputRows ||
      path.join(outDir, `${datasetRowsFileStem(datasetType)}.identity-rewritten.jsonl`),
  );
  const result = applyIdentityReferenceRewrites({
    datasetType,
    rowsFile,
    outFile,
    outDir,
    options,
    allowMissingIndex: false,
  });
  const reportPath = path.join(
    outDir,
    "identity-reference-rewrites-apply-report.json",
  );
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    command: "dataset-identity-reference-rewrites-apply",
    dataset_type: datasetType,
    remote_write_mode: "read-only",
    ...result,
    files: {
      report: repoRelativePath(reportPath),
      output_rows: result.output_rows_file,
      reference_rows: result.reference_rows_file,
      identity_reference_rewrites: result.rewrite_file,
      identity_unresolved_references: result.unresolved_references_file,
    },
  };
  writeJson(reportPath, report);
  return report;
}

function readDecisionRowsFile(filePath) {
  if (!filePath || !fileExists(filePath)) return [];
  if (filePath.toLowerCase().endsWith(".jsonl")) {
    return readJsonLines(filePath);
  }
  const value = readJson(filePath);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.decisions)) return value.decisions;
  if (Array.isArray(value?.rows)) return value.rows;
  return [value];
}

function identityDecisionDatasetId(decision) {
  return asText(
    decision?.dataset_id ??
      decision?.datasetId ??
      decision?.entity_id ??
      decision?.entityId ??
      decision?.flow_id ??
      decision?.flowId,
  );
}

function identityDecisionDatasetVersion(decision) {
  return (
    asText(decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version) ||
    "00.00.001"
  );
}

function normalizeIdentityDecisionValue(decision) {
  const raw = asText(
    decision?.identity_decision ??
      decision?.identityDecision ??
      decision?.decision ??
      decision?.resolution?.identity_decision ??
      decision?.resolution?.decision,
  );
  if (["reuse", "reuse_existing", "reference_reuse"].includes(raw)) {
    return "reuse_existing_reference";
  }
  if (["new", "insert", "write_new"].includes(raw)) return "create_new";
  if (["block", "blocked", "unresolved"].includes(raw)) return "block_unresolved";
  return raw;
}

function identityDecisionCompletionStatus(decision) {
  return asText(
    decision?.decision_status ?? decision?.decisionStatus ?? decision?.status,
  );
}

function identityDecisionUsedContextKinds(decision) {
  return unique([
    ...normalizedList(decision?.used_context_kinds ?? decision?.usedContextKinds),
    ...normalizedList(decision?.resolution?.used_context_kinds),
    ...normalizedList(decision?.evidence?.used_context_kinds),
  ]);
}

function identityDecisionCanonical(decision) {
  const canonical =
    decision?.canonical ??
    decision?.selected_reference ??
    decision?.selectedReference ??
    decision?.resolution?.canonical ??
    decision?.resolution?.selected_reference ??
    null;
  if (!canonical || typeof canonical !== "object") return null;
  const id = asText(
    canonical.ref_object_id ??
      canonical.refObjectId ??
      canonical.id ??
      canonical["@refObjectId"],
  );
  if (!id) return null;
  return {
    table: asText(canonical.table) || "flows",
    ref_object_id: id,
    version:
      asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) ||
      "00.00.001",
    short_description:
      asText(
        canonical.short_description ??
          canonical.shortDescription ??
          canonical["common:shortDescription"]?.["#text"],
      ) || id,
  };
}

function identityDecisionPackageReference(decision) {
  return asText(
    decision?.authoring_package ??
      decision?.authoringPackage ??
      decision?.authoring_context?.authoring_package ??
      decision?.authoringContext?.authoringPackage,
  );
}

function identityDecisionPackageSha(decision) {
  return asText(
    decision?.authoring_package_sha256 ??
      decision?.authoringPackageSha256 ??
      decision?.authoring_context?.authoring_package_sha256 ??
      decision?.authoringContext?.authoringPackageSha256,
  );
}

function identityDecisionPackagePath(decision, packageDir) {
  const explicit = identityDecisionPackageReference(decision);
  if (explicit) {
    const resolved = resolveRepoPath(explicit);
    if (fileExists(resolved)) return resolved;
  }
  if (!packageDir) return null;
  const id = identityDecisionDatasetId(decision);
  if (!id) return null;
  const candidates = [
    path.join(packageDir, `flow-${id}.authoring-package.json`),
    path.join(packageDir, `process-${id}.authoring-package.json`),
    path.join(packageDir, `${id}.authoring-package.json`),
  ];
  return candidates.find(fileExists) ?? null;
}

function identityDecisionClosesAction(decision, code) {
  return normalizedList(
    decision?.closes_action_items ??
      decision?.closesActionItems ??
      decision?.resolution?.closes_action_items,
  ).includes(code);
}

function identityDecisionReferenceTable(datasetType) {
  return datasetRowsFileStem(datasetType);
}

function isElementaryFlowIdentityRow(row) {
  return /^elementary flow$/iu.test(flowTypeOfDataSet(row));
}

function validateIdentityDecision({
  decision,
  datasetType,
  packageDir,
}) {
  const blockers = [];
  const id = identityDecisionDatasetId(decision);
  const value = normalizeIdentityDecisionValue(decision);
  if (hasUnresolvedAiPlaceholder(decision)) {
    blockers.push({
      code: "identity_decision_template_incomplete",
      dataset_id: id || null,
      message: "Identity decision still contains an AI placeholder.",
    });
  }
  if (!id) {
    blockers.push({
      code: "identity_decision_dataset_id_missing",
      message: "Identity decision must include dataset_id/entity_id.",
    });
  }
  if (identityDecisionCompletionStatus(decision) !== "completed") {
    blockers.push({
      code: "identity_decision_status_not_completed",
      dataset_id: id || null,
      message:
        "Identity decision must declare decision_status/status = completed.",
    });
  }
  if (
    ![
      "reuse_existing_reference",
      "create_new",
      "block_unresolved",
    ].includes(value)
  ) {
    blockers.push({
      code: "identity_decision_value_invalid",
      dataset_id: id || null,
      value,
      message:
        "Identity decision must be reuse_existing_reference, create_new, or block_unresolved.",
    });
  }
  if (value === "reuse_existing_reference" && !identityDecisionCanonical(decision)) {
    blockers.push({
      code: "identity_decision_canonical_missing",
      dataset_id: id || null,
      message:
        "reuse_existing_reference decisions must include canonical ref_object_id/version.",
    });
  }
  if (!asText(decision?.basis ?? decision?.reason ?? decision?.resolution?.basis)) {
    blockers.push({
      code: "identity_decision_basis_missing",
      dataset_id: id || null,
      message: "Identity decision must include basis/reason.",
    });
  }
  if (!decision?.evidence || typeof decision.evidence !== "object") {
    blockers.push({
      code: "identity_decision_evidence_missing",
      dataset_id: id || null,
      message: "Identity decision must include structured evidence.",
    });
  }
  const usedContextKinds = identityDecisionUsedContextKinds(decision);
  for (const kind of ["schema", "methodology_yaml", "ruleset"]) {
    if (!usedContextKinds.includes(kind)) {
      blockers.push({
        code: "identity_decision_context_kind_missing",
        dataset_id: id || null,
        required_kind: kind,
        message:
          "Identity decision used_context_kinds must include schema, methodology_yaml, and ruleset.",
      });
    }
  }
  if (datasetType === "flow") {
    const closesManual =
      identityDecisionClosesAction(decision, "identity_preflight_manual_review") ||
      identityDecisionClosesAction(
        decision,
        "elementary_flow_identity_manual_review",
      );
    if (!closesManual) {
      blockers.push({
        code: "identity_decision_action_item_closure_missing",
        dataset_id: id || null,
        message:
          "Flow identity decisions must close identity_preflight_manual_review or elementary_flow_identity_manual_review.",
      });
    }
  }
  const packagePath = identityDecisionPackagePath(decision, packageDir);
  const expectedSha = identityDecisionPackageSha(decision);
  if (packageDir && !packagePath) {
    blockers.push({
      code: "identity_decision_authoring_package_missing",
      dataset_id: id || null,
      message:
        "Identity decision must reference a readable authoring package when --authoring-package-dir is provided.",
    });
  } else if (packagePath && expectedSha) {
    const actualSha = sha256Text(readText(packagePath));
    if (actualSha !== expectedSha) {
      blockers.push({
        code: "identity_decision_authoring_package_sha_mismatch",
        dataset_id: id || null,
        expected_sha256: expectedSha,
        actual_sha256: actualSha,
        authoring_package: repoRelativePath(packagePath),
        message:
          "Identity decision authoring_package_sha256 does not match the referenced package.",
      });
    }
  }
  return {
    dataset_id: id,
    dataset_version: identityDecisionDatasetVersion(decision),
    decision: value,
    canonical: identityDecisionCanonical(decision),
    package_path: packagePath,
    blockers,
  };
}

function runDatasetIdentityDecisionsApply(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-identity-decisions-apply",
      usage: [
        "node scripts/foundry.mjs dataset-identity-decisions-apply --type flow --rows-file <flows.jsonl> --decisions <identity-decisions.jsonl> --out-dir <apply-dir> --authoring-package-dir <ai-authoring-packages>",
      ],
      purpose:
        "Validate AI-authored identity decisions and deterministically split rows into write candidates and reference-reuse rows before post-authoring finalize.",
    };
  }
  const datasetType = asText(
    options.type || options.datasetType || "flow",
  ).toLowerCase();
  const rowsFile = resolveRepoPath(options.rowsFile || options.input || options.rows);
  const decisionsFile = resolveRepoPath(
    options.decisions || options.identityDecisions || options.decisionFile,
  );
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required.");
  }
  if (!decisionsFile || !fileExists(decisionsFile)) {
    throw new Error("--decisions is required.");
  }
  const outDir = resolveRepoPath(
    options.outDir || path.join(path.dirname(rowsFile), "identity-decisions"),
  );
  const packageDir = resolveRepoPath(
    options.authoringPackageDir || options.authoringPackagesDir,
  );
  const rows = readRowsFile(rowsFile);
  const inputDecisions = readDecisionRowsFile(decisionsFile);
  const decisions = inputDecisions.filter((decision) => {
    const decisionType = asText(
      decision?.dataset_type ?? decision?.datasetType ?? decision?.type,
    ).toLowerCase();
    return !decisionType || decisionType === datasetType;
  });
  const decisionMap = new Map();
  const blockers = [];
  const decisionEvidenceRows = [];
  for (const decision of decisions) {
    const validation = validateIdentityDecision({
      decision,
      datasetType,
      packageDir,
    });
    blockers.push(...validation.blockers);
    if (!validation.dataset_id) continue;
    const key = `${validation.dataset_id}@@${validation.dataset_version}`;
    if (decisionMap.has(key)) {
      blockers.push({
        code: "identity_decision_duplicate",
        dataset_id: validation.dataset_id,
        dataset_version: validation.dataset_version,
        message: "Only one identity decision is allowed per dataset id/version.",
      });
      continue;
    }
    decisionMap.set(key, { raw: decision, ...validation });
  }

  const outputRows = [];
  const referenceRows = [];
  const unresolvedRows = [];
  const rewriteRows = [];
  const unresolvedReferenceRows = [];
  rows.forEach((row, rowIndex) => {
    const identity = datasetIdentity(row, datasetType);
    const key = `${identity.id}@@${identity.version || "00.00.001"}`;
    const decision = decisionMap.get(key);
    if (!decision) {
      outputRows.push(row);
      return;
    }
    if (
      datasetType === "flow" &&
      decision.decision === "create_new" &&
      isElementaryFlowIdentityRow(row)
    ) {
      blockers.push({
        code: "elementary_flow_identity_create_new_blocked",
        dataset_id: identity.id,
        dataset_version: identity.version || "00.00.001",
        message:
          "Elementary flow identity decisions cannot create new account-local flows. Select a canonical existing flow reference or block unresolved with search evidence.",
      });
    }
    decisionEvidenceRows.push({
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version || "00.00.001",
      decision_status: identityDecisionCompletionStatus(decision.raw),
      identity_decision: decision.decision,
      canonical: decision.canonical,
      basis:
        asText(decision.raw?.basis ?? decision.raw?.reason) ||
        asText(decision.raw?.resolution?.basis),
      evidence: decision.raw?.evidence ?? null,
      used_context_kinds: identityDecisionUsedContextKinds(decision.raw),
      closes_action_items: normalizedList(
        decision.raw?.closes_action_items ??
          decision.raw?.closesActionItems ??
          decision.raw?.resolution?.closes_action_items,
      ),
      authoring_package: decision.package_path
        ? repoRelativePath(decision.package_path)
        : null,
      authoring_package_sha256: decision.package_path
        ? sha256Text(readText(decision.package_path))
        : null,
    });
    if (decision.decision === "reuse_existing_reference") {
      referenceRows.push(row);
      rewriteRows.push({
        relation: "flow_identity_ai_decision_reference",
        action: "reuse_ai_selected_existing_reference",
        dataset_type: datasetType,
        dataset_id: identity.id,
        dataset_version: identity.version || "00.00.001",
        row_index: rowIndex,
        path: datasetType === "flow" ? "/flowDataSet" : "/",
        original: {
          table: identityDecisionReferenceTable(datasetType),
          ref_object_id: identity.id,
          version: identity.version || "00.00.001",
        },
        canonical: decision.canonical,
        identity_decision: {
          source: "dataset-identity-decisions-apply",
          decision: decision.decision,
          basis:
            asText(decision.raw?.basis ?? decision.raw?.reason) ||
            asText(decision.raw?.resolution?.basis),
          evidence: decision.raw?.evidence ?? null,
        },
        reason:
          "AI identity authoring selected an existing database reference; Foundry moved this row to reference reuse instead of planning a new write.",
      });
    } else if (
      datasetType === "flow" &&
      decision.decision === "block_unresolved" &&
      isElementaryFlowIdentityRow(row)
    ) {
      unresolvedRows.push(row);
      unresolvedReferenceRows.push({
        relation: "elementary_flow_identity_ai_decision_unresolved",
        action: "preserve_dependent_process_reference_with_trace",
        dataset_type: datasetType,
        dataset_id: identity.id,
        dataset_version: identity.version || "00.00.001",
        row_index: rowIndex,
        path: "/flowDataSet",
        original: {
          table: identityDecisionReferenceTable(datasetType),
          ref_object_id: identity.id,
          version: identity.version || "00.00.001",
          short_description:
            referenceShortDescription(
              row?.flowDataSet?.flowInformation?.dataSetInformation?.name,
            ) || identity.id,
        },
        identity_decision: {
          source: "dataset-identity-decisions-apply",
          decision: decision.decision,
          basis:
            asText(decision.raw?.basis ?? decision.raw?.reason) ||
            asText(decision.raw?.resolution?.basis),
          evidence: decision.raw?.evidence ?? null,
        },
        evidence: decision.raw?.evidence ?? null,
        reason:
          "AI identity authoring could not select a sufficient existing elementary flow; Foundry will not write a BAFU-owned elementary flow and dependent process rows must carry a structured unresolved trace.",
      });
    } else {
      outputRows.push(row);
      if (decision.decision === "block_unresolved") {
        blockers.push({
          code: "identity_decision_unresolved",
          dataset_id: identity.id,
          dataset_version: identity.version || "00.00.001",
          message:
            "AI identity authoring left this row unresolved, so write planning remains blocked.",
        });
      }
    }
  });

  const outRowsFile = path.join(
    outDir,
    `${datasetRowsFileStem(datasetType)}.identity-decisions-applied.jsonl`,
  );
  const referenceRowsFile = path.join(
    outDir,
    `${datasetRowsFileStem(datasetType)}.reference-reuse.jsonl`,
  );
  const unresolvedRowsFile = path.join(
    outDir,
    `${datasetRowsFileStem(datasetType)}.unresolved-reference.jsonl`,
  );
  const rewritesFile = path.join(outDir, "identity-reference-rewrites.jsonl");
  const unresolvedReferencesFile = path.join(
    outDir,
    "identity-unresolved-references.jsonl",
  );
  const evidenceFile = path.join(outDir, "identity-decision-evidence.jsonl");
  const reportFile = path.join(outDir, "identity-decisions-apply-report.json");
  writeJsonLines(outRowsFile, outputRows);
  writeJsonLines(referenceRowsFile, referenceRows);
  writeJsonLines(unresolvedRowsFile, unresolvedRows);
  writeJsonLines(rewritesFile, rewriteRows);
  writeJsonLines(unresolvedReferencesFile, unresolvedReferenceRows);
  writeJsonLines(evidenceFile, decisionEvidenceRows);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length > 0 ? "blocked" : "completed",
    command: "dataset-identity-decisions-apply",
    dataset_type: datasetType,
    rows_file: repoRelativePath(rowsFile),
    decisions_file: repoRelativePath(decisionsFile),
    remote_write_mode: "read-only",
    counts: {
      input_rows: rows.length,
      input_decisions: inputDecisions.length,
      decisions: decisions.length,
      output_rows: outputRows.length,
      reference_rows: referenceRows.length,
      unresolved_reference_rows: unresolvedRows.length,
      identity_reference_rewrites: rewriteRows.length,
      identity_unresolved_references: unresolvedReferenceRows.length,
      evidence_rows: decisionEvidenceRows.length,
      blockers: blockers.length,
    },
    blockers,
    decisions: decisionEvidenceRows,
    files: {
      report: repoRelativePath(reportFile),
      output_rows: repoRelativePath(outRowsFile),
      reference_rows: repoRelativePath(referenceRowsFile),
      unresolved_reference_rows: repoRelativePath(unresolvedRowsFile),
      identity_reference_rewrites: repoRelativePath(rewritesFile),
      identity_unresolved_references: repoRelativePath(
        unresolvedReferencesFile,
      ),
      evidence: repoRelativePath(evidenceFile),
    },
  };
  writeJson(reportFile, report);
  return report;
}

function runDatasetBundleSampleRows(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-bundle-sample-rows",
      usage: [
        "node scripts/foundry.mjs dataset-bundle-sample-rows --bundles-dir tmp/bafu-2025-v2-tidas/process-bundles --sample-size 3 --out-dir .foundry/workspaces/bafu-sample-rows",
      ],
      purpose:
        "Sample process bundles, materialize support/process JSONL rows, replace all converted tool contacts with one library-level contact, and write commit-ready row files.",
      remote_write_mode: "read-only",
    };
  }

  const bundlesDir =
    options.bundlesDir ||
    options.input ||
    "tmp/bafu-2025-v2-tidas/process-bundles";
  const allBundleDirs = listProcessBundleDirs(bundlesDir);
  const selection = selectProcessBundleDirs(allBundleDirs, options);
  const outDir = resolveRepoPath(
    options.outDir ||
      `.foundry/workspaces/bafu-bundle-sample-rows/${Date.now()}`,
  );
  const rowsDir = path.join(outDir, "rows");
  const cliBin = resolveTiangongLcaCliBin();
  const canonicalSupportCache = loadCanonicalSupportCache(options);
  const classificationCommandsByType = {
    process: classificationAuthoringCommands({
      cliBin,
      outDir,
      rowsDir,
      type: "process",
    }),
    "flow-product": classificationAuthoringCommands({
      cliBin,
      outDir,
      rowsDir,
      type: "flow-product",
      rowType: "flow",
    }),
    "flow-elementary": classificationAuthoringCommands({
      cliBin,
      outDir,
      rowsDir,
      type: "flow-elementary",
      rowType: "flow",
    }),
  };
  const locationCommandsByType = Object.fromEntries(
    bundleRowTypeOrder.map((type) => [
      type,
      locationAuthoringCommands({ cliBin, outDir, rowsDir, type }),
    ]),
  );
  const locationCodeMap = loadTidasLocationCodeMap();
  fs.mkdirSync(rowsDir, { recursive: true });

  const blockers = [];
  for (const missingId of selection.missing_process_ids) {
    blockers.push({
      code: "requested_process_bundle_missing",
      message: `Requested process bundle ${missingId} was not found.`,
      process_id: missingId,
    });
  }

  const sanitizeStats = {
    removed_import_traces: 0,
    removed_import_trace_namespaces: 0,
    placeholder_text_replacements: 0,
    timestamp_normalizations: 0,
    reference_year_repairs: 0,
    annual_supply_repairs: 0,
    true_source_classification_repairs: 0,
    default_process_classification_blockers: 0,
    default_flow_classification_blockers: 0,
    location_code_targets: 0,
    location_code_valid: 0,
    location_code_blockers: 0,
    source_reference_rewrites: 0,
    true_source_identity_repairs: 0,
    true_source_description_repairs: 0,
    true_source_reference_description_repairs: 0,
    canonical_flow_property_reference_rewrites: 0,
    canonical_unit_group_reference_proofs: 0,
    elementary_flow_reuse_blockers: 0,
  };
  const sourceReferenceRewriteRows = [];
  const canonicalSupportRewriteRows = [];
  const sourceClassificationRepairRows = [];
  const templateContact = findFirstBundleContactTemplate(selection.selected);
  const libraryContact = buildLibraryContactPayload(options, templateContact, {
    rewriteRows: sourceReferenceRewriteRows,
    stats: sanitizeStats,
  });
  const libraryContactIdentity = datasetIdentity(libraryContact, "contact");
  const libraryContactName = asText(
    libraryContact.contactDataSet.contactInformation.dataSetInformation[
      "common:name"
    ]?.["#text"],
  );
  const libraryContactRef = contactGlobalReference({
    id: libraryContactIdentity.id,
    version: libraryContactIdentity.version,
    shortDescription: libraryContactName,
    language: asText(options.language || options.lang || "en") || "en",
  });

  const rowsByType = Object.fromEntries(
    bundleRowTypeOrder.map((type) => [type, new Map()]),
  );
  const sourceByType = Object.fromEntries(
    bundleRowTypeOrder.map((type) => [type, new Map()]),
  );
  rowsByType.contact.set(
    `${libraryContactIdentity.id}::${libraryContactIdentity.version}`,
    libraryContact,
  );
  sourceByType.contact.set(
    `${libraryContactIdentity.id}::${libraryContactIdentity.version}`,
    "foundry:library-contact",
  );

  const rewriteStats = {
    rewritten: 0,
    previous_ids: new Set(),
    previous_descriptions: new Set(),
  };
  const traceRows = [];
  const classificationQueueRows = [];
  const locationQueueRows = [];
  const elementaryFlowReuseRows = [];
  const selectedBundles = [];
  for (const bundleDir of selection.selected) {
    const manifestPath = path.join(bundleDir, "manifest.json");
    const manifest = readJson(manifestPath);
    selectedBundles.push({
      process_id: manifest.process_id || path.basename(bundleDir),
      bundle_dir: repoRelativeMaybe(bundleDir),
      manifest: repoRelativeMaybe(manifestPath),
    });
    for (const type of bundleRowTypeOrder.filter(
      (rowType) => rowType !== "contact",
    )) {
      const plural = bundleRowTypes[type].plural;
      for (const relativeFile of ensureArray(manifest.files?.[plural])) {
        const sourceFile = path.join(bundleDir, relativeFile);
        if (!fileExists(sourceFile)) {
          blockers.push({
            code: "bundle_manifest_file_missing",
            message: `${type} file listed in bundle manifest is not readable.`,
            bundle: repoRelativeMaybe(bundleDir),
            file: relativeFile,
          });
          continue;
        }
        const payload = cloneJson(readJson(sourceFile));
        const sourceTraces = collectSourceTracePayloads(payload);
        rewriteContactReferences(payload, libraryContactRef, rewriteStats);
        sanitizeBundlePayload(
          payload,
          type,
          sourceFile,
          sanitizeStats,
          traceRows,
          sourceTraces,
        );
        if (type === "source") {
          repairTrueSourceIdentity(payload, {
            sourceFile,
            stats: sanitizeStats,
            repairRows: sourceClassificationRepairRows,
          });
          repairTrueSourceDescription(payload, {
            sourceFile,
            stats: sanitizeStats,
            repairRows: sourceClassificationRepairRows,
          });
          repairTrueSourceClassification(payload, {
            sourceFile,
            stats: sanitizeStats,
            repairRows: sourceClassificationRepairRows,
          });
        }
        rewriteCanonicalSourceReferences(payload, {
          datasetType: type,
          sourceFile,
          stats: sanitizeStats,
          rewriteRows: sourceReferenceRewriteRows,
          datasetIdentityCache: datasetIdentity(payload, type),
        });
        rewriteCanonicalFlowPropertyReferences(payload, {
          cacheContext: canonicalSupportCache,
          datasetType: type,
          sourceFile,
          stats: sanitizeStats,
          rewriteRows: canonicalSupportRewriteRows,
          blockers,
          datasetIdentityCache: datasetIdentity(payload, type),
          language: asText(options.language || options.lang || "en") || "en",
        });
        collectBundleQualityFindings({
          payload,
          type,
          sourceFile,
          sourceTraces,
          blockers,
          stats: sanitizeStats,
          classificationQueueRows,
          classificationCommandsByType,
        });
        collectElementaryFlowReuseFindings({
          payload,
          type,
          sourceFile,
          sourceTraces,
          blockers,
          stats: sanitizeStats,
          elementaryFlowReuseRows,
        });
        collectLocationQualityFindings({
          payload,
          type,
          sourceFile,
          blockers,
          stats: sanitizeStats,
          locationQueueRows,
          locationCodeMap,
          locationCommands: locationCommandsByType[type],
        });
        addDedupedBundleRow({
          rowsByType,
          sourceByType,
          blockers,
          type,
          payload,
          sourceFile,
        });
      }
    }
  }

  const sourceSemanticsRows = [...rowsByType.source.entries()].map(
    ([key, payload]) =>
      sourceSemanticSummary(payload, sourceByType.source.get(key)),
  );
  const sourceLookup = new Map(
    sourceSemanticsRows
      .filter((row) => row.dataset_id)
      .map((row) => [row.dataset_id, row]),
  );
  for (const [key, payload] of rowsByType.process.entries()) {
    rewriteTrueSourceReferenceDescriptions(payload.processDataSet, {
      sourceLookup,
      sourceFile: sourceByType.process.get(key),
      stats: sanitizeStats,
      rewriteRows: sourceReferenceRewriteRows,
      datasetIdentityCache: datasetIdentity(payload, "process"),
    });
  }
  const allProcessSourceReferenceRows = [];
  for (const [key, payload] of rowsByType.process.entries()) {
    allProcessSourceReferenceRows.push(
      ...processSourceReferenceRows(
        payload,
        sourceLookup,
        sourceByType.process.get(key),
      ),
    );
  }
  const processSourceReferenceQueueRows = allProcessSourceReferenceRows.filter(
    (row) => row.relation === "process_data_source",
  );
  blockers.push(...sourceReferenceSemanticBlockers(allProcessSourceReferenceRows));
  const omittedSourceSemanticsRows = sourceSemanticsRows.filter(
    (row) => row.kind !== "true_source",
  );
  for (const row of omittedSourceSemanticsRows) {
    if (!row.dataset_id) continue;
    rowsByType.source.delete(
      `${row.dataset_id}::${row.dataset_version || ""}`,
    );
    sourceByType.source.delete(
      `${row.dataset_id}::${row.dataset_version || ""}`,
    );
  }

  const identityPreflightArtifacts = buildIdentityPreflightArtifacts({
    rowsByType,
    sourceByType,
    outDir,
    cliBin,
  });
  attachIdentityPreflightRows(
    elementaryFlowReuseRows,
    identityPreflightArtifacts,
  );

  const traceQueuePath = path.join(outDir, "import-traces.jsonl");
  writeJsonLines(traceQueuePath, traceRows);
  const classificationQueuePath = path.join(
    outDir,
    "classification-authoring-queue.jsonl",
  );
  writeJsonLines(classificationQueuePath, classificationQueueRows);
  const locationQueuePath = path.join(outDir, "location-authoring-queue.jsonl");
  writeJsonLines(locationQueuePath, locationQueueRows);
  const elementaryFlowReuseQueuePath = path.join(
    outDir,
    "elementary-flow-reuse-queue.jsonl",
  );
  writeJsonLines(elementaryFlowReuseQueuePath, elementaryFlowReuseRows);
  const sourceSemanticsPath = path.join(outDir, "source-semantics.jsonl");
  writeJsonLines(sourceSemanticsPath, sourceSemanticsRows);
  const sourceClassificationRepairsPath = path.join(
    outDir,
    "source-classification-repairs.jsonl",
  );
  writeJsonLines(sourceClassificationRepairsPath, sourceClassificationRepairRows);
  const processSourceReferencesPath = path.join(
    outDir,
    "process-source-references.jsonl",
  );
  writeJsonLines(processSourceReferencesPath, processSourceReferenceQueueRows);
  const sourceReferenceRewritesPath = path.join(
    outDir,
    "source-reference-rewrites.jsonl",
  );
  writeJsonLines(sourceReferenceRewritesPath, sourceReferenceRewriteRows);
  const canonicalSupportRewritesPath = path.join(
    outDir,
    "canonical-support-rewrites.jsonl",
  );
  writeJsonLines(canonicalSupportRewritesPath, canonicalSupportRewriteRows);

  const rowFiles = {};
  const countsByType = {};
  for (const type of bundleRowTypeOrder) {
    const rows = [...rowsByType[type].values()];
    countsByType[type] = rows.length;
    const filePath = path.join(rowsDir, `${bundleRowTypes[type].plural}.jsonl`);
    writeJsonLines(filePath, rows);
    rowFiles[type] = repoRelativePath(filePath);
  }
  const supportRows = ["contact", "source"].flatMap(
    (type) => [...rowsByType[type].values()],
  );
  countsByType.support = supportRows.length;
  const supportRowsPath = path.join(rowsDir, "support.jsonl");
  writeJsonLines(supportRowsPath, supportRows);
  rowFiles.support = repoRelativePath(supportRowsPath);

  if (countsByType.contact !== 1) {
    blockers.push({
      code: "library_contact_count_invalid",
      message: `Expected exactly one shared contact row, got ${countsByType.contact}.`,
      actual: countsByType.contact,
    });
  }
  if (!libraryContactIdentity.id || !libraryContactIdentity.version) {
    blockers.push({
      code: "library_contact_identity_missing",
      message:
        "Generated library contact is missing common:UUID or common:dataSetVersion.",
      id: libraryContactIdentity.id,
      version: libraryContactIdentity.version,
    });
  }
  if (selection.selected.length === 0) {
    blockers.push({
      code: "process_bundle_selection_empty",
      message: "No process bundles were selected.",
    });
  }
  if (countsByType.process < selection.selected.length) {
    blockers.push({
      code: "process_rows_missing",
      message: `Selected ${selection.selected.length} bundles but materialized ${countsByType.process} process rows.`,
      selected_bundles: selection.selected.length,
      process_rows: countsByType.process,
    });
  }

  const rowTypeCommand = (type, mode) => {
    const modeFlag = mode === "commit" ? "--commit" : "--dry-run";
    if (type === "lifecyclemodel") {
      return [
        cliBin,
        "lifecyclemodel",
        "save-draft",
        "--input",
        resolveRepoPath(rowFiles[type]),
        "--out-dir",
        path.join(outDir, mode === "commit" ? "commit" : "dry-run", type),
        modeFlag,
        "--json",
      ]
        .map(shellQuote)
        .join(" ");
    }
    return [
      cliBin,
      "dataset",
      "save-draft",
      "--input",
      resolveRepoPath(rowFiles[type]),
      "--type",
      type,
      "--out-dir",
      path.join(outDir, mode === "commit" ? "commit" : "dry-run", type),
      modeFlag,
      "--json",
    ]
      .map(shellQuote)
      .join(" ");
  };
  const commands = Object.fromEntries(
    bundleRowTypeOrder
      .filter((type) => !["unitgroup", "flowproperty"].includes(type))
      .map((type) => [
        type,
        {
          validate: rowTypeCommand(type, "validate"),
          commit: rowTypeCommand(type, "commit"),
        },
      ]),
  );
  commands.unitgroup = {
    validate: null,
    commit: null,
    policy: "reference_only_existing_database_rows",
  };
  commands.flowproperty = {
    validate: null,
    commit: null,
    policy: "reference_only_existing_database_rows",
  };
  commands.support = {
    validate: [
      cliBin,
      "dataset",
      "save-draft",
      "--input",
      resolveRepoPath(rowFiles.support),
      "--type",
      "auto",
      "--out-dir",
      path.join(outDir, "dry-run", "support"),
      "--dry-run",
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
    commit: [
      cliBin,
      "dataset",
      "save-draft",
      "--input",
      resolveRepoPath(rowFiles.support),
      "--type",
      "auto",
      "--out-dir",
      path.join(outDir, "commit", "support"),
      "--commit",
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
  };

  const reportPath = path.join(
    outDir,
    "dataset-bundle-sample-rows-report.json",
  );
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length === 0 ? "ready" : "blocked",
    command: "dataset-bundle-sample-rows",
    profile: asText(options.profile || "bafu"),
    source_bundles_dir: repoRelativeMaybe(resolveRepoPath(bundlesDir)),
    sample: {
      seed: selection.seed,
      requested_count:
        selection.selected.length + selection.missing_process_ids.length,
      selected_count: selection.selected.length,
      selected_bundles: selectedBundles,
      missing_process_ids: selection.missing_process_ids,
    },
    library_contact: {
      id: libraryContactIdentity.id,
      version: libraryContactIdentity.version,
      name: libraryContactName,
      website:
        libraryContact.contactDataSet.contactInformation.dataSetInformation
          .WWWAddress ?? null,
      policy: "one_shared_contact_per_source_library",
      replaced_contact_ids: [...rewriteStats.previous_ids].sort(),
      replaced_contact_descriptions: [
        ...rewriteStats.previous_descriptions,
      ].sort(),
    },
    policy: {
      source_language_only: true,
      tidas_tools_conversion_boundary:
        "tidas-tools may emit a generic conversion contact; Foundry replaces it during library import materialization.",
      support_rows_before_process_rows: true,
      source_rows_only_true_sources: true,
      unitgroup_rows_reference_only: true,
      flowproperty_rows_reference_only: true,
      canonical_support_cache: repoRelativeMaybe(canonicalSupportCache.cachePath),
      source_rows_exclude:
        "Converted data-format, compliance-system, placeholder, and Not specified support sources are omitted from source/support rows; they remain only in source-semantics provenance.",
      unitgroup_flowproperty_write_policy:
        "Unit Groups and Flow Properties are selected from existing canonical database rows. Converted rows may be kept for audit, but support.jsonl and generated commit commands never write them to My Data.",
      elementary_flow_write_policy:
        "Elementary flows are selected from existing TianGong database rows and are never written as BAFU-owned flow rows. Unresolved elementary matches remain in elementary-flow-reuse-queue.jsonl and block referencing process writes.",
      identity_preflight_search_policy:
        "Process and flow matching uses CLI identity-preflight with complete fielded search briefs. The CLI sends query, filter, match_count, page_size, and data_source to process_hybrid_search or flow_hybrid_search, then applies deterministic local identity decisions to returned candidates.",
      canonical_flow_property_reference_rewrite:
        "Flow referenceToFlowPropertyDataSet values are rewritten from converted package-local Amount-in-unit rows to canonical Flow Property rows listed in the local support cache.",
      true_source_classification_repair:
        "Report/publication sources with sourceCitation and converted Other source types classification are repaired to TIDAS Publications and communications before dry-run/write planning.",
      true_source_identity_repair:
        "Report/publication sources with generic EcoSpold compatibility names are repaired from sourceDescriptionOrComment metadata before dry-run/write planning.",
      true_source_description_repair:
        "Report/publication sources with empty or generic sourceDescriptionOrComment values are repaired from sourceCitation/shortName evidence before dry-run/write planning.",
      true_source_reference_description_repair:
        "Process data source reference shortDescription values are synchronized to curated true source row names before dry-run/write planning.",
      canonical_source_reference_rewrite:
        "referenceToDataSetFormat and referenceToComplianceSystem are rewritten to public canonical source references before dry-run/write planning.",
      sdk_validation_before_remote_write:
        "Use the generated dataset save-draft dry-run/commit commands; each command validates with @tiangong-lca/tidas-sdk before writing.",
    },
    counts: {
      blockers: blockers.length,
      total_available_bundles: allBundleDirs.length,
      selected_bundles: selection.selected.length,
      rewritten_contact_refs: rewriteStats.rewritten,
      import_trace_queue_rows: traceRows.length,
      classification_authoring_queue_rows: classificationQueueRows.length,
      location_authoring_queue_rows: locationQueueRows.length,
      elementary_flow_reuse_queue_rows: elementaryFlowReuseRows.length,
      identity_preflight_request_rows: identityPreflightArtifacts.rows.length,
      source_semantics_rows: sourceSemanticsRows.length,
      source_classification_repair_rows: sourceClassificationRepairRows.length,
      true_source_rows: sourceSemanticsRows.filter(
        (row) => row.kind === "true_source",
      ).length,
      format_support_source_rows: sourceSemanticsRows.filter(
        (row) => row.kind === "format_support_source",
      ).length,
      compliance_support_source_rows: sourceSemanticsRows.filter(
        (row) => row.kind === "compliance_support_source",
      ).length,
      placeholder_or_unspecified_source_rows: sourceSemanticsRows.filter(
        (row) => row.kind === "placeholder_or_unspecified_source",
      ).length,
      omitted_non_true_source_rows: omittedSourceSemanticsRows.length,
      process_source_reference_rows: processSourceReferenceQueueRows.length,
      source_reference_rewrite_rows: sourceReferenceRewriteRows.length,
      canonical_support_rewrite_rows: canonicalSupportRewriteRows.length,
      reference_only_unitgroup_rows: countsByType.unitgroup,
      reference_only_flowproperty_rows: countsByType.flowproperty,
      true_source_identity_repairs:
        sanitizeStats.true_source_identity_repairs,
      true_source_description_repairs:
        sanitizeStats.true_source_description_repairs,
      true_source_reference_description_repairs:
        sanitizeStats.true_source_reference_description_repairs,
      ...sanitizeStats,
      ...Object.fromEntries(
        Object.entries(countsByType).map(([type, count]) => [
          `${type}_rows`,
          count,
        ]),
      ),
    },
    files: {
      report: repoRelativePath(reportPath),
      rows: rowFiles,
      import_traces: repoRelativePath(traceQueuePath),
      classification_authoring_queue: repoRelativePath(classificationQueuePath),
      location_authoring_queue: repoRelativePath(locationQueuePath),
      elementary_flow_reuse_queue: repoRelativePath(
        elementaryFlowReuseQueuePath,
      ),
      identity_preflight_requests: repoRelativePath(
        identityPreflightArtifacts.indexPath,
      ),
      source_semantics: repoRelativePath(sourceSemanticsPath),
      source_classification_repairs: repoRelativePath(
        sourceClassificationRepairsPath,
      ),
      process_source_references: repoRelativePath(processSourceReferencesPath),
      source_reference_rewrites: repoRelativePath(sourceReferenceRewritesPath),
      canonical_support_rewrites: repoRelativePath(canonicalSupportRewritesPath),
    },
    commands,
    blockers,
  };
  writeJson(reportPath, report);
  return report;
}

function runDatasetIdentityPreflightRequestsBuild(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-identity-preflight-requests-build",
      usage: [
        "node scripts/foundry.mjs dataset-identity-preflight-requests-build --type process --rows-file ./rows/processes.jsonl --out-dir ./.foundry/workspaces/task/identity-preflight-refresh",
        "node scripts/foundry.mjs dataset-identity-preflight-requests-build --type flow --rows-file ./rows/flows.jsonl --out-dir ./.foundry/workspaces/task/identity-preflight-refresh",
        "node scripts/foundry.mjs dataset-identity-preflight-requests-build --type process --rows-file ./rows/patched-processes.jsonl --source-index ./identity-preflight-requests/identity-preflight-requests.jsonl --out-dir ./identity-preflight-refresh",
      ],
      purpose:
        "Build a fresh CLI identity-preflight request index from the exact current process or flow rows file.",
      remote_write_mode: "read-only",
    };
  }

  const datasetType = asText(options.type || options.datasetType).toLowerCase();
  if (!["flow", "process"].includes(datasetType)) {
    throw new Error("--type must be flow or process.");
  }
  const rowsFile = resolveRepoPath(
    options.rowsFile || options.input || options.inputRows,
  );
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file must point to a readable process/flow rows file.");
  }
  const outDir = resolveRepoPath(
    options.outDir ||
      path.join(path.dirname(path.dirname(rowsFile)), "identity-preflight-refresh"),
  );
  const cliBin = resolveTiangongLcaCliBin();
  const rows = readRowsFile(rowsFile);
  const sourceIndexPaths = identityPreflightSourceIndexPaths(options);
  const sourceContext = loadIdentityPreflightSourceFileMap(sourceIndexPaths);
  const rowsByType = {
    flow: new Map(),
    process: new Map(),
  };
  const sourceByType = {
    flow: new Map(),
    process: new Map(),
  };
  const blockers = [];
  blockers.push(...sourceContext.blockers);
  let sourceContextMatches = 0;
  let sourceContextMissingMatches = 0;
  rows.forEach((row, index) => {
    const identity = datasetIdentity(row, datasetType);
    if (!identity.id || !identity.version) {
      blockers.push({
        code: "identity_preflight_request_identity_missing",
        row_index: index,
        dataset_type: datasetType,
        message:
          "Rows used to build identity-preflight requests must include common:UUID and common:dataSetVersion.",
      });
      return;
    }
    const key = `${identity.id}::${identity.version}`;
    const sourceIndexKey = `${datasetType}:${identity.id}:${identity.version}`;
    const inheritedSourceFile =
      sourceContext.sourceFilesByIdentity.get(sourceIndexKey) ?? null;
    if (sourceIndexPaths.length > 0) {
      if (inheritedSourceFile) {
        sourceByType[datasetType].set(key, inheritedSourceFile);
        sourceContextMatches += 1;
      } else {
        sourceContextMissingMatches += 1;
        blockers.push({
          code: "identity_preflight_source_context_match_missing",
          row_index: index,
          dataset_type: datasetType,
          dataset_id: identity.id,
          dataset_version: identity.version,
          message:
            "The supplied --source-index does not contain source_file context for this current row.",
        });
      }
    }
    const existing = rowsByType[datasetType].get(key);
    if (existing && jsonSha256(existing) !== jsonSha256(row)) {
      blockers.push({
        code: "identity_preflight_request_duplicate_payload_conflict",
        row_index: index,
        dataset_type: datasetType,
        dataset_id: identity.id,
        dataset_version: identity.version,
        message:
          "The rows file contains duplicate identity keys with different payloads.",
      });
      return;
    }
    rowsByType[datasetType].set(key, row);
  });

  const artifacts = buildIdentityPreflightArtifacts({
    rowsByType,
    sourceByType,
    outDir,
    cliBin,
  });
  const reportPath = path.join(outDir, "dataset-identity-preflight-requests-build-report.json");
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length > 0 ? "blocked" : "ready",
    command: "dataset-identity-preflight-requests-build",
    dataset_type: datasetType,
    rows_file: repoRelativePath(rowsFile),
    remote_write_mode: "read-only",
    policy: {
      exact_rows_scope:
        "Each request target is the exact row payload from rows_file, and each index row records target_sha256 so curation can reject stale preflight evidence.",
      edge_search_payload:
        "The generated request carries a compact fielded query plus supported filter/data_source/match parameters for flow_hybrid_search or process_hybrid_search.",
      source_context_refresh:
        "When --source-index is supplied, refreshed requests inherit the original source_file trace context for the same dataset identity so post-patch search queries do not lose source-package evidence.",
    },
    counts: {
      input_rows: rows.length,
      request_rows: artifacts.rows.length,
      source_index_files: sourceIndexPaths.length,
      source_index_rows: sourceContext.rowCount,
      source_context_matches: sourceContextMatches,
      source_context_missing_matches: sourceContextMissingMatches,
      blockers: blockers.length,
    },
    files: {
      report: repoRelativePath(reportPath),
      identity_preflight_requests: repoRelativePath(artifacts.indexPath),
      requests_root: repoRelativePath(artifacts.root),
      source_indexes: sourceIndexPaths.map(repoRelativePath),
    },
    blockers,
  };
  writeJson(reportPath, report);
  return report;
}

const identityPreflightQueryNoisePatterns = [
  {
    code: "not_specified_source_phrase",
    pattern: /\bNot specified by the .* source\.?\b/iu,
  },
  {
    code: "ilcd_format_noise",
    pattern: /\bILCD format\b/iu,
  },
  {
    code: "generic_not_specified",
    pattern: /(?:^|[:;\n]\s*)Not specified(?:[.;\n]|$)/iu,
  },
  {
    code: "ecospold_location_in_name",
    pattern: /\{[A-Z][A-Z0-9_-]{1,12}\}/u,
  },
  {
    code: "leading_xx_name_placeholder",
    pattern: /(?:^|\n)(?:process|flow) name:\s*x{2,}\b/iu,
  },
];

function identityPreflightQueryForAudit(row) {
  return (
    asText(row?.remote_search?.edge_request?.body?.query) ||
    asText(row?.remote_search?.query) ||
    asText(row?.remote_candidate_search?.query) ||
    asText(row?.request?.remote_candidate_search?.query)
  );
}

function identityPreflightEdgeBodyForAudit(row) {
  const body = row?.remote_search?.edge_request?.body;
  if (body && typeof body === "object" && !Array.isArray(body)) return body;
  const request = row?.remote_candidate_search ?? row?.request?.remote_candidate_search;
  if (request && typeof request === "object" && !Array.isArray(request)) {
    return {
      query: request.query,
      ...(request.filter ? { filter: request.filter } : {}),
      ...(request.limit ? { match_count: request.limit, page_size: request.limit } : {}),
      ...(request.data_source ? { data_source: request.data_source } : {}),
      ...(request.match_threshold ? { match_threshold: request.match_threshold } : {}),
      ...(request.full_text_weight ? { full_text_weight: request.full_text_weight } : {}),
      ...(request.extracted_text_weight
        ? { extracted_text_weight: request.extracted_text_weight }
        : {}),
      ...(request.semantic_weight ? { semantic_weight: request.semantic_weight } : {}),
      ...(request.rrf_k ? { rrf_k: request.rrf_k } : {}),
    };
  }
  return {};
}

function identityPreflightRequestForAudit(indexPath, row) {
  const requestFile = resolveRepoPath(row?.request_file);
  if (!requestFile || !fileExists(requestFile)) return null;
  try {
    return readJson(requestFile);
  } catch (error) {
    throw new Error(
      `Could not read identity-preflight request file from ${repoRelativePath(indexPath)}: ${repoRelativePath(requestFile)}: ${error}`,
    );
  }
}

function hasQueryLabel(query, label) {
  return new RegExp(`(?:^|\\n)${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:`, "iu").test(
    query,
  );
}

function flowTypeFromQuery(query) {
  const match = query.match(/(?:^|\n)flow type:\s*([^\n;]+)/iu);
  return asText(match?.[1]);
}

function identityPreflightRequiredQueryLabels(row, query) {
  const datasetType = asText(row?.dataset_type ?? row?.datasetType).toLowerCase();
  if (datasetType === "process") {
    return [
      "process name",
      "reference flow",
      "geography",
      "classification or sector",
      "exchange flow refs",
    ];
  }
  if (datasetType === "flow") {
    const labels = ["flow name", "flow type", "reference property", "category or compartment"];
    if (/^elementary flow$/iu.test(flowTypeFromQuery(query))) {
      labels.push("compartment aliases");
      if (row?.source_file) labels.push("source classification or compartment");
    } else {
      labels.push("geography or market");
    }
    return labels;
  }
  return ["query"];
}

function identityPreflightSearchEndpointForType(datasetType) {
  if (datasetType === "process") return "process_hybrid_search";
  if (datasetType === "flow") return "flow_hybrid_search";
  return null;
}

function auditIdentityPreflightQueryRow({ row, index, indexPath }) {
  const blockers = [];
  const warnings = [];
  const datasetType = asText(row?.dataset_type ?? row?.datasetType).toLowerCase();
  const datasetId = asText(row?.dataset_id ?? row?.datasetId ?? row?.id);
  const datasetVersion = asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version);
  const request = identityPreflightRequestForAudit(indexPath, row);
  const mergedRow = request
    ? {
        ...row,
        request,
        remote_candidate_search:
          row?.remote_candidate_search ?? request.remote_candidate_search,
      }
    : row;
  const query = identityPreflightQueryForAudit(mergedRow);
  const edgeBody = identityPreflightEdgeBodyForAudit(mergedRow);
  const expectedEndpoint = identityPreflightSearchEndpointForType(datasetType);
  const actualEndpoint = asText(row?.remote_search?.edge_request?.endpoint);

  const base = {
    row_index: index,
    dataset_type: datasetType || null,
    dataset_id: datasetId || null,
    dataset_version: datasetVersion || null,
    request_file: row?.request_file ?? null,
  };
  if (!["flow", "process"].includes(datasetType)) {
    blockers.push({
      ...base,
      code: "identity_preflight_query_dataset_type_invalid",
      message: "Identity-preflight query audit only supports process and flow rows.",
    });
  }
  if (!query) {
    blockers.push({
      ...base,
      code: "identity_preflight_query_missing",
      message: "Identity-preflight row must send a non-empty query to hybrid search.",
    });
  }
  if (query.length > 1800) {
    blockers.push({
      ...base,
      code: "identity_preflight_query_too_long",
      query_length: query.length,
      message: "Hybrid search query must stay within the Foundry compact query limit.",
    });
  }
  if (expectedEndpoint && actualEndpoint && actualEndpoint !== expectedEndpoint) {
    blockers.push({
      ...base,
      code: "identity_preflight_query_endpoint_mismatch",
      expected_endpoint: expectedEndpoint,
      actual_endpoint: actualEndpoint,
      message: "Identity-preflight edge request endpoint does not match the dataset type.",
    });
  }
  for (const label of identityPreflightRequiredQueryLabels(row, query)) {
    if (label === "query") continue;
    if (!hasQueryLabel(query, label)) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_required_label_missing",
        label,
        message: `Hybrid search query is missing required fielded label: ${label}.`,
      });
    }
  }
  for (const { code, pattern } of identityPreflightQueryNoisePatterns) {
    const match = query.match(pattern);
    if (match) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_noise",
        noise_code: code,
        matched_text: match[0],
        message:
          "Hybrid search query contains placeholder or converted-format noise that should be repaired before remote candidate search.",
      });
    }
  }
  const edgeQuery = asText(edgeBody.query);
  if (query && edgeQuery && edgeQuery !== query) {
    blockers.push({
      ...base,
      code: "identity_preflight_query_edge_body_mismatch",
      message:
        "Index remote_search.query and edge_request.body.query differ; audit cannot prove what Edge receives.",
    });
  }
  if (datasetType === "flow") {
    const flowType = flowTypeFromQuery(query);
    const filterFlowType = asText(edgeBody?.filter?.flowType);
    if (flowType && !filterFlowType) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_flow_type_filter_missing",
        flow_type: flowType,
        message:
          "Flow hybrid search should include a flowType filter matching the query flow type.",
      });
    } else if (flowType && filterFlowType && filterFlowType !== flowType) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_flow_type_filter_mismatch",
        flow_type: flowType,
        filter_flow_type: filterFlowType,
        message:
          "Flow hybrid search flowType filter does not match the query flow type.",
      });
    }
  }
  if (!edgeBody.data_source) {
    warnings.push({
      ...base,
      code: "identity_preflight_query_data_source_missing",
      message: "Hybrid search data_source is not explicit; Edge will use its default.",
    });
  }
  if (!edgeBody.match_count || !edgeBody.page_size) {
    warnings.push({
      ...base,
      code: "identity_preflight_query_result_limit_missing",
      message:
        "Hybrid search match_count/page_size is not explicit; Edge will use its default.",
    });
  }
  return {
    ...base,
    status: blockers.length > 0 ? "blocked" : "passed",
    query_sha256: query ? sha256Text(query) : null,
    query_length: query.length,
    labels: query
      .split(/\n/u)
      .map((line) => line.match(/^([^:]+):/u)?.[1])
      .filter(Boolean),
    edge_request: {
      endpoint: actualEndpoint || expectedEndpoint,
      data_source: edgeBody.data_source ?? null,
      match_count: edgeBody.match_count ?? null,
      page_size: edgeBody.page_size ?? null,
      filter: edgeBody.filter ?? null,
    },
    blockers,
    warnings,
  };
}

function runDatasetIdentityPreflightQueryAudit(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-identity-preflight-query-audit",
      usage: [
        "node scripts/foundry.mjs dataset-identity-preflight-query-audit --index ./identity-preflight-requests/identity-preflight-requests.jsonl --out-dir ./identity-preflight-query-audit",
      ],
      purpose:
        "Audit generated process/flow identity-preflight hybrid-search queries before remote candidate search.",
      remote_write_mode: "read-only",
    };
  }
  const indexPath = resolveRepoPath(
    options.index ||
      options.identityPreflightIndex ||
      options.identityPreflightRequests ||
      options.identityPreflightRequestsIndex,
  );
  if (!indexPath || !fileExists(indexPath)) {
    throw new Error("--index must point to a readable identity-preflight index.");
  }
  const outDir = resolveRepoPath(
    options.outDir || path.join(path.dirname(path.dirname(indexPath)), "identity-preflight-query-audit"),
  );
  const rows = readJsonLines(indexPath);
  const auditedRows = rows.map((row, index) =>
    auditIdentityPreflightQueryRow({ row, index, indexPath }),
  );
  const blockers = auditedRows.flatMap((row) => row.blockers);
  const warnings = auditedRows.flatMap((row) => row.warnings);
  const reportPath = path.join(outDir, "dataset-identity-preflight-query-audit-report.json");
  const rowsPath = path.join(outDir, "identity-preflight-query-audit.jsonl");
  writeJsonLines(rowsPath, auditedRows);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length > 0 ? "blocked" : "passed",
    command: "dataset-identity-preflight-query-audit",
    index_file: repoRelativePath(indexPath),
    remote_write_mode: "read-only",
    policy: {
      edge_body_contract:
        "flow_hybrid_search/process_hybrid_search only parse query, filter/filter_condition, match options, and data_source; complete identity and source evidence must be present in query.",
      profile_hints_contract:
        "remote_candidate_search.profile_hints are retained for local CLI/AI identity decisions but are not sent in the Edge request body.",
      noise_policy:
        "Queries must not carry converted placeholder/source-format strings such as ILCD format, Not specified by the source, EcoSpold-style {GLO} name suffixes, or leading xx placeholders.",
    },
    counts: {
      rows: rows.length,
      passed_rows: auditedRows.filter((row) => row.status === "passed").length,
      blocked_rows: auditedRows.filter((row) => row.status === "blocked").length,
      process_rows: rows.filter(
        (row) => asText(row?.dataset_type ?? row?.datasetType).toLowerCase() === "process",
      ).length,
      flow_rows: rows.filter(
        (row) => asText(row?.dataset_type ?? row?.datasetType).toLowerCase() === "flow",
      ).length,
      blockers: blockers.length,
      warnings: warnings.length,
    },
    files: {
      report: repoRelativePath(reportPath),
      rows: repoRelativePath(rowsPath),
    },
    blockers,
    warnings,
  };
  writeJson(reportPath, report);
  return report;
}

const taskKindRoutes = {
  "external-dataset-curated-import": [
    "import-orchestration",
    "tidas-contract-context",
    "external-lca-package-conversion",
    "schema-gate",
    "qa",
    "dataset-curation",
    "reference-closure",
    "publish-prep",
    "remote-verification",
  ],
  "source-evidence-dataset-development": [
    "import-orchestration",
    "tidas-contract-context",
    "source-document-authoring",
    "source-evidence-review",
    "schema-gate",
    "qa",
    "dataset-curation",
    "reference-closure",
    "publish-prep",
  ],
};

const gateRoutes = {
  orchestration: ["import-orchestration"],
  context: ["tidas-contract-context"],
  contract: ["tidas-contract-context"],
  conversion: ["external-lca-package-conversion"],
  import: ["external-lca-package-conversion"],
  source: ["source-document-authoring", "source-evidence-review"],
  schema: ["schema-gate"],
  qa: ["qa"],
  curation: ["dataset-curation"],
  reference: ["reference-closure"],
  "reference-closure": ["reference-closure"],
  publish: ["publish-prep"],
  remote: ["remote-verification"],
  verification: ["remote-verification"],
};

function qaClassForType(datasetType) {
  if (datasetType === "process") return "process-qa";
  if (datasetType === "flow") return "flow-qa";
  if (datasetType === "lifecyclemodel") return "lifecyclemodel-qa";
  return "qa";
}

function expandRouteClass(className, datasetType) {
  return className === "qa" ? [qaClassForType(datasetType)] : [className];
}

function capabilityMatchesDatasetType(capability, datasetType) {
  if (!datasetType || datasetType === "all") return true;
  const id = String(capability.id ?? "");
  if (datasetType === "process")
    return !id.startsWith("cli.flow.") && !id.startsWith("cli.lifecyclemodel.");
  if (datasetType === "flow")
    return (
      !id.startsWith("cli.process.") && !id.startsWith("cli.lifecyclemodel.")
    );
  if (datasetType === "lifecyclemodel")
    return !id.startsWith("cli.process.") && !id.startsWith("cli.flow.");
  return true;
}

function buildRoutePlan(options = {}) {
  const registry = readCapabilityRegistry();
  const kind = String(
    options.kind || options.taskKind || "external-dataset-curated-import",
  );
  const datasetType = String(options.datasetType || options.type || "all")
    .trim()
    .toLowerCase();
  const requiredGateClasses = normalizedList(options.requiredGates)
    .flatMap((gate) => gateRoutes[gate] ?? [gate])
    .flatMap((className) => expandRouteClass(className, datasetType));
  const defaultClasses = (taskKindRoutes[kind] ?? []).flatMap((className) =>
    expandRouteClass(className, datasetType),
  );
  const requestedClasses = normalizedList(
    options.classes || options.capabilityClasses,
  ).flatMap((className) => expandRouteClass(className, datasetType));
  const requiredClasses = unique([
    ...defaultClasses,
    ...requiredGateClasses,
    ...requestedClasses,
  ]);
  const capabilities = ensureArray(registry.capabilities)
    .filter((capability) => requiredClasses.includes(capability.class))
    .filter((capability) =>
      capabilityMatchesDatasetType(capability, datasetType),
    );
  const byClass = new Map();
  for (const capability of capabilities) {
    if (!byClass.has(capability.class)) byClass.set(capability.class, []);
    byClass.get(capability.class).push(capability);
  }
  const routes = requiredClasses.map((className) => ({
    class: className,
    status:
      (byClass.get(className) ?? []).length > 0
        ? "routed"
        : "missing_capability",
    capability_ids: (byClass.get(className) ?? []).map(
      (capability) => capability.id,
    ),
    owner_projects: unique(
      (byClass.get(className) ?? []).map(
        (capability) => capability.owner_project,
      ),
    ),
  }));
  const missing = routes.filter(
    (route) => route.status === "missing_capability",
  );
  return {
    schema_version: 2,
    generated_at_utc: nowIso(),
    task: {
      id: String(options.taskId || options.id || `route-${kind}`),
      kind,
      dataset_type: datasetType,
      required_gates: normalizedList(options.requiredGates),
    },
    status: missing.length > 0 ? "missing_capabilities" : "routed",
    capability_registry: capabilityRegistryPath,
    required_classes: requiredClasses,
    routes,
    selected_capabilities: capabilities,
    missing_capabilities: missing,
    next_action:
      missing.length > 0
        ? "Create or route missing reusable capabilities in the owning project."
        : "Run the selected adapters and store their outputs in the task workspace.",
  };
}

function writeRoutePlan(plan, outDir) {
  if (!outDir) return plan;
  const resolvedOutDir = resolveRepoPath(outDir);
  writeJson(path.join(resolvedOutDir, "capability-route-plan.json"), plan);
  return {
    ...plan,
    files: {
      capability_route_plan: repoRelativePath(
        path.join(resolvedOutDir, "capability-route-plan.json"),
      ),
    },
  };
}

function capabilitiesList(options = {}) {
  const registry = readCapabilityRegistry();
  const classFilter = options.class ? String(options.class) : null;
  const ownerFilter = options.owner ? String(options.owner) : null;
  const capabilities = ensureArray(registry.capabilities)
    .filter((capability) => !classFilter || capability.class === classFilter)
    .filter(
      (capability) => !ownerFilter || capability.owner_project === ownerFilter,
    );
  return {
    schema_version: registry.schema_version ?? 1,
    generated_at_utc: nowIso(),
    registry: capabilityRegistryPath,
    capability_count: capabilities.length,
    capabilities,
  };
}

function listTaskFiles(queue = null) {
  const queueEntries = queue
    ? [[queue, taskQueues[queue]]]
    : Object.entries(taskQueues);
  const files = [];
  for (const [queueName, dir] of queueEntries) {
    const absDir = path.join(repoRoot, dir);
    if (!directoryExists(absDir)) continue;
    for (const name of fs.readdirSync(absDir).sort()) {
      if (name.endsWith(".md"))
        files.push({ queue: queueName, path: path.join(absDir, name) });
    }
  }
  return files;
}

function taskSummary(file) {
  const { body, meta } = taskMetaFromFile(file.path);
  return {
    queue: file.queue,
    path: repoRelativePath(file.path),
    meta,
    body_preview: body.trim().split(/\r?\n/u).slice(0, 4).join("\n"),
  };
}

function findActiveTask(value) {
  const token = asText(value);
  if (!token) return null;
  const directPath = resolveRepoPath(token);
  const activeRoot = resolveRepoPath(taskQueues.active);
  if (directPath && fileExists(directPath)) {
    const relativeToActive = path.relative(activeRoot, directPath);
    if (
      !relativeToActive.startsWith("..") &&
      !path.isAbsolute(relativeToActive)
    ) {
      return directPath;
    }
  }
  const candidates = listTaskFiles("active")
    .map((file) => {
      const parsed = taskMetaFromFile(file.path);
      return {
        path: file.path,
        id: asText(parsed.meta.id),
        name: path.basename(file.path, ".md"),
      };
    })
    .filter((task) => task.id === token || task.name === token);
  if (candidates.length !== 1) {
    return { ambiguous_or_missing: true, candidates };
  }
  return candidates[0].path;
}

function runTaskComplete(options) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "task-complete",
      usage: [
        "node scripts/foundry.mjs task-complete --task <task-id|tasks/active/file.md> --completion-report <dataset-import-completion-report.json>",
      ],
      purpose:
        "Move one filesystem task from tasks/active to tasks/done only when the task-level import completion report is completed.",
      remote_write_mode: "read-only",
    };
  }

  const taskSelector =
    options.task || options.taskId || options.id || options.taskFile;
  const completionArtifact = readJsonArtifactOption(
    options.completionReport ||
      options.importCompletionReport ||
      options.report,
  );
  const blockers = [];
  const taskMatch = findActiveTask(taskSelector);
  let taskPath = typeof taskMatch === "string" ? taskMatch : null;
  let task = null;

  if (!taskSelector) {
    blockers.push({
      code: "task_selector_required",
      message: "task-complete requires --task with an active task id or file.",
    });
  } else if (!taskPath) {
    blockers.push({
      code: "active_task_not_found",
      message:
        "task-complete requires exactly one matching task under tasks/active; inbox/done/template tasks cannot be completed.",
      task: asText(taskSelector),
      candidates:
        taskMatch?.candidates?.map((candidate) => ({
          id: candidate.id,
          path: repoRelativePath(candidate.path),
        })) ?? [],
    });
  } else {
    task = taskMetaFromFile(taskPath);
  }

  if (!completionArtifact) {
    blockers.push({
      code: "completion_report_required",
      message:
        "task-complete requires --completion-report pointing to dataset-import-completion-report.json.",
    });
  } else if (completionArtifact.value?.status !== "completed") {
    blockers.push({
      code: "completion_report_not_completed",
      message: `Completion report status is ${completionArtifact.value?.status ?? "missing"}.`,
      completion_report: repoRelativePath(completionArtifact.path),
    });
  }

  if (completionArtifact?.value?.status === "completed") {
    const completionCloseouts = ensureArray(completionArtifact.value.closeouts);
    if (completionCloseouts.length === 0) {
      blockers.push({
        code: "completion_report_closeouts_missing",
        message:
          "Completed import task reports must contain at least one post-write closeout scope.",
        completion_report: repoRelativePath(completionArtifact.path),
      });
    }
    const completionBlockers = ensureArray(completionArtifact.value.blockers);
    if (completionBlockers.length > 0) {
      blockers.push({
        code: "completion_report_blockers_present",
        message:
          "Completion report status is completed but still carries blockers.",
        completion_report: repoRelativePath(completionArtifact.path),
        blocker_count: completionBlockers.length,
      });
    }
  }

  const taskId = asText(task?.meta?.id);
  const reportTaskId = asText(completionArtifact?.value?.task_id);
  if (task && !taskId) {
    blockers.push({
      code: "task_id_missing",
      message: "Active task frontmatter must contain id before completion.",
      task_file: repoRelativePath(taskPath),
    });
  }
  if (
    task &&
    completionArtifact &&
    (!reportTaskId || reportTaskId !== taskId)
  ) {
    blockers.push({
      code: "completion_report_task_id_mismatch",
      message: "Completion report task_id must match the active task id.",
      task_id: taskId || null,
      completion_report_task_id: reportTaskId || null,
      completion_report: repoRelativePath(completionArtifact.path),
    });
  }
  if (task && completionArtifact?.value?.status === "completed") {
    blockers.push(
      ...completionFullContextBlockers({
        task,
        completionReport: completionArtifact.value,
      }).map((blocker) => ({
        ...blocker,
        completion_report: repoRelativePath(completionArtifact.path),
      })),
    );
  }

  const destinationPath = taskPath
    ? path.join(resolveRepoPath(taskQueues.done), path.basename(taskPath))
    : null;
  if (destinationPath && fileExists(destinationPath)) {
    blockers.push({
      code: "done_task_already_exists",
      message: "A done task with the same filename already exists.",
      done_task: repoRelativePath(destinationPath),
    });
  }

  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status:
      blockers.length === 0
        ? booleanOption(options.dryRun)
          ? "ready"
          : "completed"
        : "blocked",
    remote_write_mode: "read-only",
    task_id: taskId || null,
    task_file: taskPath ? repoRelativePath(taskPath) : null,
    destination_file: destinationPath
      ? repoRelativePath(destinationPath)
      : null,
    completion_report: completionArtifact
      ? repoRelativePath(completionArtifact.path)
      : null,
    dry_run: booleanOption(options.dryRun),
    policy: {
      completion_gate:
        "tasks/active may move to tasks/done only after dataset-import-completion-report.status is completed for the same task_id, with full schema/YAML/context AI completion proof when the task or closeout profile requires it.",
      no_database_write: true,
      full_context_ai_completion_before_entry: true,
    },
    blockers,
  };
  if (blockers.length > 0 || booleanOption(options.dryRun)) {
    return report;
  }

  const frontmatter = replaceFrontmatterField(
    replaceFrontmatterField(
      replaceFrontmatterField(task.frontmatter, "state", "Done"),
      "completion_report",
      repoRelativePath(completionArtifact.path),
    ),
    "completed_at",
    report.generated_at_utc,
  );
  const updatedText = `---\n${frontmatter}\n---\n${task.body}`;
  writeText(destinationPath, updatedText);
  fs.unlinkSync(taskPath);
  return report;
}

function tasksList() {
  return listTaskFiles().map(taskSummary);
}

function tasksCheck() {
  const errors = [];
  const ids = new Set();
  for (const task of tasksList()) {
    for (const key of ["id", "title", "state", "kind"]) {
      if (!task.meta[key]) errors.push(`${task.path}: missing ${key}`);
    }
    if (task.meta.id) {
      if (ids.has(task.meta.id))
        errors.push(`${task.path}: duplicate id ${task.meta.id}`);
      ids.add(task.meta.id);
    }
  }
  return { task_count: tasksList().length, errors, ok: errors.length === 0 };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  let result;
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      result = usage();
      break;
    case "init":
      result = initRuntime();
      break;
    case "doctor":
      result = doctor();
      break;
    case "env-check":
      result = envCheck();
      break;
    case "workflow-check":
      result = workflowCheck();
      break;
    case "storage-check":
      result = storageCheck();
      break;
    case "acceptance-check":
      result = acceptanceCheck();
      break;
    case "workspace-map":
      result = workspaceMap();
      break;
    case "capabilities-list":
      result = capabilitiesList(options);
      break;
    case "profiles-list":
      result = listImportProfiles({ repoRoot, options });
      break;
    case "route-task":
      result = writeRoutePlan(buildRoutePlan(options), options.outDir);
      break;
    case "tasks-list":
      result = tasksList();
      break;
    case "tasks-check":
      result = tasksCheck();
      break;
    case "task-complete":
      result = runTaskComplete(options);
      break;
    case "dataset-curation-queue-build":
      result = runDatasetCurationQueueBuild(options);
      break;
    case "dataset-curation-gate":
      result = runDatasetCurationGate({ repoRoot, options });
      break;
    case "dataset-authoring-plan":
      result = runDatasetAuthoringPlan(options);
      break;
    case "dataset-authoring-task-build":
      result = runDatasetAuthoringTaskBuild({ repoRoot, options });
      break;
    case "dataset-authoring-patch-collect":
      result = runDatasetAuthoringPatchCollect({ repoRoot, options });
      break;
    case "dataset-identity-decision-task-build":
      result = runDatasetIdentityDecisionTaskBuild(options);
      break;
    case "dataset-classification-decision-task-build":
      result = runDatasetClassificationDecisionTaskBuild(options);
      break;
    case "dataset-classification-decisions-apply":
      result = runDatasetClassificationDecisionsApply(options);
      break;
    case "dataset-location-decision-task-build":
      result = runDatasetLocationDecisionTaskBuild(options);
      break;
    case "dataset-location-decisions-apply":
      result = runDatasetLocationDecisionsApply(options);
      break;
    case "dataset-curation-cleanup":
      result = runDatasetCurationCleanup({ repoRoot, options });
      break;
    case "dataset-patch-apply":
      result = runDatasetPatchApply(options);
      break;
    case "dataset-support-cache-refresh":
      result = await runDatasetSupportCacheRefresh(options);
      break;
    case "dataset-bundle-sample-rows":
      result = runDatasetBundleSampleRows(options);
      break;
    case "dataset-identity-preflight-requests-build":
      result = runDatasetIdentityPreflightRequestsBuild(options);
      break;
    case "dataset-identity-preflight-query-audit":
      result = runDatasetIdentityPreflightQueryAudit(options);
      break;
    case "dataset-identity-preflight-run":
      result = runDatasetIdentityPreflightRun(options);
      break;
    case "dataset-identity-preflight-index-merge":
      result = runDatasetIdentityPreflightIndexMerge(options);
      break;
    case "dataset-identity-reference-rewrites-apply":
      result = runDatasetIdentityReferenceRewritesApply(options);
      break;
    case "dataset-identity-decisions-apply":
      result = runDatasetIdentityDecisionsApply(options);
      break;
    case "dataset-post-authoring-finalize":
      result = runDatasetPostAuthoringFinalize(options);
      break;
    case "dataset-commit-handoff-plan":
      result = runDatasetCommitHandoffPlan(options);
      break;
    case "dataset-post-write-closeout":
      result = runDatasetPostWriteCloseout(options);
      break;
    case "dataset-import-completion-report":
      result = runDatasetImportCompletionReport(options);
      break;
    case "dataset-mutation-manifest":
      result = runDatasetMutationManifest({ repoRoot, options });
      break;
    default:
      console.error(`Unknown Foundry command: ${command}`);
      console.error(`Known commands: ${usage().commands.join(", ")}`);
      process.exit(2);
  }
  const exitCode = exitCodeForCommand(command, result);
  printJson(result);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exit(1);
});
