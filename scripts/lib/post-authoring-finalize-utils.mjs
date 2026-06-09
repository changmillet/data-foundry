import fs from "node:fs";
import path from "node:path";
import { sha256Json } from "./import-curation/internal/hash-utils.mjs";

export function createPostAuthoringFinalizeUtils({
  asText,
  booleanOption,
  cliWrapperCommands,
  countRowsFile,
  datasetIdentity,
  ensureArray,
  fileExists,
  identityPreflightCommands,
  identityReferenceRewriteIndexPath,
  normalizedList,
  readRowsFile,
  referenceShortDescription,
  repoRelativeMaybe,
  resolveRepoPath,
  unique,
  writeJsonLines,
}) {
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
      const id = asText(canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id);
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

  function writeIdentityRewriteExternalFlowRefs({ outDir, identityReferenceRewriteStage }) {
    const rows = identityRewriteExternalFlowRefRows(identityReferenceRewriteStage);
    if (rows.length === 0) return null;
    const filePath = path.join(outDir, "identity-reference-rewrite-external-flow-refs.jsonl");
    writeJsonLines(filePath, rows);
    return filePath;
  }

  function existingOptionFile(value, label) {
    const files = existingOptionFiles(value, label);
    if (files.length > 1) {
      throw new Error(`${label} accepts one file, received ${files.length}.`);
    }
    return files[0] ?? null;
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

  function curationQueueManifestFile(queueDir) {
    if (!queueDir) return null;
    const manifest = path.join(queueDir, "outputs", "curation-queue-manifest.json");
    return fileExists(manifest) ? manifest : null;
  }

  function writeProcessReferenceExternalFlowRefs({ outDir, processRowsFile, flowRowsFile }) {
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
        const existing = refs.get(key) ?? {
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

  function readJsonIfExists(filePath) {
    if (!filePath || !fileExists(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function resolveIndexArtifact(indexPath, artifactPath) {
    const text = asText(artifactPath);
    if (!text) return null;
    if (path.isAbsolute(text)) return text;
    const repoPath = resolveRepoPath(text);
    if (fileExists(repoPath)) return repoPath;
    return path.resolve(path.dirname(indexPath), text);
  }

  function identityPreflightIndexTargetSha(indexPath, row) {
    const direct = asText(row?.target_sha256 ?? row?.targetSha256);
    if (direct) return direct;
    const requestPath = resolveIndexArtifact(indexPath, row?.request_file ?? row?.requestFile);
    const request = readJsonIfExists(requestPath);
    return request?.target ? sha256Json(request.target) : null;
  }

  function currentScopeIdentityPreflightRefreshPlan({ datasetType, rowsFile, indexPath }) {
    const normalizedType = String(datasetType || "").toLowerCase();
    if (!["flow", "process"].includes(normalizedType)) {
      return {
        required: false,
        reason: "dataset_type_not_identity_preflight_refreshable",
        current_rows: 0,
        index_rows: 0,
        stale_rows: 0,
        missing_rows: 0,
        missing_target_hash_rows: 0,
      };
    }
    const currentRows = readRowsFile(rowsFile);
    const indexRows = readRowsFile(indexPath);
    const indexByKey = new Map();
    for (const row of indexRows) {
      const type = String(row?.dataset_type ?? row?.type ?? "").toLowerCase();
      const id = asText(row?.dataset_id ?? row?.entity_id ?? row?.id);
      const version = asText(row?.dataset_version ?? row?.version) || "00.00.001";
      if (!type || !id) continue;
      indexByKey.set(`${type}:${id}@@${version}`, row);
      if (!indexByKey.has(`${type}:${id}`)) {
        indexByKey.set(`${type}:${id}`, row);
      }
    }

    const staleRows = [];
    const missingRows = [];
    const missingTargetHashRows = [];
    for (const payload of currentRows) {
      const identity = datasetIdentity(payload, normalizedType);
      if (!identity.id) continue;
      const version = identity.version || "00.00.001";
      const row =
        indexByKey.get(`${normalizedType}:${identity.id}@@${version}`) ??
        indexByKey.get(`${normalizedType}:${identity.id}`);
      if (!row) {
        missingRows.push({ id: identity.id, version });
        continue;
      }
      const targetSha = identityPreflightIndexTargetSha(indexPath, row);
      if (!targetSha) {
        missingTargetHashRows.push({ id: identity.id, version });
        continue;
      }
      const currentSha = sha256Json(payload);
      if (targetSha !== currentSha) {
        staleRows.push({
          id: identity.id,
          version,
          request_target_sha256: targetSha,
          current_payload_sha256: currentSha,
        });
      }
    }
    const required =
      missingRows.length > 0 || missingTargetHashRows.length > 0 || staleRows.length > 0;
    return {
      required,
      reason: required ? "current_scope_index_not_exact" : "current_scope_index_exact",
      current_rows: currentRows.length,
      index_rows: indexRows.length,
      stale_rows: staleRows.length,
      missing_rows: missingRows.length,
      missing_target_hash_rows: missingTargetHashRows.length,
      examples: [...missingRows, ...missingTargetHashRows, ...staleRows].slice(0, 5),
    };
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
    const providedQueueDir = resolveRepoPath(options.queueDir || options.curationQueueDir);
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
      existingOptionFile(options.flows || options.flowsFile || options.flowRows, "--flows") ??
      existingSiblingRowsFile(rowsFile, "flows.jsonl");
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

    const report = cliWrapperCommands.runDatasetCurationQueueBuild({
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
        process_reference_external_flow_refs: repoRelativeMaybe(processReferenceExternalRefs),
      },
    };
  }

  function runFinalizeIdentityPreflightStage({ rowsFile, outDir, options }) {
    if (!booleanOption(options.runIdentityPreflight)) {
      return {
        stage: "identity_preflight_run",
        status: "not_requested",
        report: null,
        report_file: null,
      };
    }
    const baseIndexPath =
      identityPreflightCommands.identityPreflightRunIndexPath(options) ||
      identityReferenceRewriteIndexPath(options, rowsFile);
    if (!baseIndexPath || !fileExists(baseIndexPath)) {
      throw new Error(
        "--run-identity-preflight requires --identity-preflight-index, --index, or a sibling identity-preflight-requests/identity-preflight-requests.jsonl.",
      );
    }
    const refreshRequested =
      options.refreshIdentityPreflight === undefined
        ? false
        : booleanOption(options.refreshIdentityPreflight);
    const allowStaleIdentityPreflight = booleanOption(
      options.allowStaleIdentityPreflight || options.allowStaleIdentityPreflightIndex,
    );
    const refreshPlan = currentScopeIdentityPreflightRefreshPlan({
      datasetType: options.type,
      rowsFile,
      indexPath: baseIndexPath,
    });
    let indexPath = baseIndexPath;
    let refreshReport = null;
    let mergeReport = null;
    const refreshForcedButExact = Boolean(
      !allowStaleIdentityPreflight && refreshRequested && !refreshPlan.required,
    );
    if (
      !allowStaleIdentityPreflight &&
      refreshPlan.required &&
      ["flow", "process"].includes(String(options.type || "").toLowerCase())
    ) {
      const baseIndexHasSourceContext = readRowsFile(baseIndexPath).some((row) =>
        asText(row?.source_file ?? row?.sourceFile),
      );
      refreshReport = identityPreflightCommands.runDatasetIdentityPreflightRequestsBuild({
        type: options.type,
        rowsFile,
        ...(baseIndexHasSourceContext ? { sourceIndex: baseIndexPath } : {}),
        outDir: path.join(outDir, "identity-preflight-current-scope", "requests"),
      });
      const refreshIndex = resolveRepoPath(refreshReport.files?.identity_preflight_requests);
      if (refreshReport.status === "ready" && refreshIndex && fileExists(refreshIndex)) {
        mergeReport = identityPreflightCommands.runDatasetIdentityPreflightIndexMerge({
          baseIndex: baseIndexPath,
          updateIndex: refreshIndex,
          outDir: path.join(outDir, "identity-preflight-current-scope", "merge"),
        });
        const mergedIndex = resolveRepoPath(mergeReport.files?.merged_index);
        if (mergeReport.status === "ready" && mergedIndex && fileExists(mergedIndex)) {
          indexPath = mergedIndex;
        }
      }
    }
    if (refreshReport && refreshReport.status !== "ready") {
      return {
        stage: "identity_preflight_run",
        status: "blocked_current_scope_refresh",
        report: refreshReport,
        report_file: resolveRepoPath(refreshReport.files?.report),
        index_file: repoRelativeMaybe(indexPath),
        refresh_report_file: repoRelativeMaybe(resolveRepoPath(refreshReport.files?.report)),
        merge_report_file: null,
      };
    }
    if (mergeReport && mergeReport.status !== "ready") {
      return {
        stage: "identity_preflight_run",
        status: "blocked_current_scope_merge",
        report: mergeReport,
        report_file: resolveRepoPath(mergeReport.files?.report),
        index_file: repoRelativeMaybe(indexPath),
        refresh_report_file: repoRelativeMaybe(resolveRepoPath(refreshReport?.files?.report)),
        merge_report_file: repoRelativeMaybe(resolveRepoPath(mergeReport.files?.report)),
      };
    }
    const report = identityPreflightCommands.runDatasetIdentityPreflightRun({
      index: indexPath,
      outDir: path.join(outDir, "identity-preflight-run"),
      onlyPending: options.onlyPending === undefined ? true : booleanOption(options.onlyPending),
      timeoutMs:
        options.identityPreflightTimeoutMs ||
        options.identityPreflightTimeout ||
        options.timeoutMs ||
        options.timeout,
      dryRun: options.identityPreflightDryRun || options.dryRunIdentityPreflight,
    });
    return {
      stage: "identity_preflight_run",
      status: report.status,
      report,
      report_file: resolveRepoPath(report.files?.report),
      index_file: repoRelativeMaybe(indexPath),
      base_index_file: repoRelativeMaybe(baseIndexPath),
      refresh_required: Boolean(!allowStaleIdentityPreflight && refreshPlan.required),
      refresh_forced: Boolean(
        !allowStaleIdentityPreflight && refreshRequested && refreshPlan.required,
      ),
      refresh_force_skipped_exact: refreshForcedButExact,
      refresh_plan: refreshPlan,
      refresh_report_file: repoRelativeMaybe(resolveRepoPath(refreshReport?.files?.report)),
      merge_report_file: repoRelativeMaybe(resolveRepoPath(mergeReport?.files?.report)),
      refresh_report: refreshReport,
      merge_report: mergeReport,
    };
  }

  return {
    identityReferenceRewritesFileForRowsFile,
    runFinalizeAutoCurationQueue,
    runFinalizeIdentityPreflightStage,
    sourceReferenceRewritesFileForRowsFile,
  };
}
