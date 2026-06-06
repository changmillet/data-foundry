import path from "node:path";

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
    const indexPath =
      identityPreflightCommands.identityPreflightRunIndexPath(options) ||
      identityReferenceRewriteIndexPath(options, rowsFile);
    if (!indexPath || !fileExists(indexPath)) {
      throw new Error(
        "--run-identity-preflight requires --identity-preflight-index, --index, or a sibling identity-preflight-requests/identity-preflight-requests.jsonl.",
      );
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
    };
  }

  return {
    identityReferenceRewritesFileForRowsFile,
    runFinalizeAutoCurationQueue,
    runFinalizeIdentityPreflightStage,
    sourceReferenceRewritesFileForRowsFile,
  };
}
