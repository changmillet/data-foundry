import path from "node:path";
import { asText, contextFileDetails, datasetIdentity, ensureArray, fileExists, readJson, readJsonLinesIfExists, readText, repoRelativePath, resolveRepoPath } from "./part-00.mjs";
import { identityFreshnessIdentityKey } from "./part-01.mjs";
import { sha256Json } from "./part-05.mjs";
import { readRowsIfExists, sha256Text } from "./part-06.mjs";
import { collectCommonOtherTraceEntries, traceSummaryCount } from "./part-07.mjs";
import { deterministicRowsFileTransformEntries, patchApplyOutputChainsThroughIdentityRewrite, patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization, patchApplyOutputChainsThroughUnresolvedExchangeExternalization, rowsFileReachableThroughTransformChain } from "./part-09.mjs";

export function compactFoundryTraceEntry({
  datasetType,
  identity,
  rowIndex,
  traceKind,
  trace,
}) {
  const entry =
    trace?.entry &&
    typeof trace.entry === "object" &&
    !Array.isArray(trace.entry)
      ? trace.entry
      : { value: trace?.entry ?? null };
  return {
    dataset_type: datasetType,
    entity_id: identity.id,
    version: identity.version,
    row_index: rowIndex,
    trace_kind: traceKind,
    path: trace?.path ?? null,
    status:
      asText(entry.status ?? entry.decision_status ?? entry.decisionStatus) ||
      null,
    action_item_code:
      asText(entry.action_item_code ?? entry.actionItemCode ?? entry.code) ||
      null,
    reference_id:
      asText(
        entry.reference_id ??
          entry.referenceId ??
          entry.ref_object_id ??
          entry.refObjectId,
      ) || null,
    reference_version:
      asText(
        entry.reference_version ??
          entry.referenceVersion ??
          entry.ref_version ??
          entry.refVersion,
      ) || null,
    blocked_path:
      asText(
        entry.blocked_path ??
          entry.blockedPath ??
          entry.field_path ??
          entry.fieldPath ??
          entry.path,
      ) || null,
    reason:
      asText(entry.reason ?? entry.deferred_reason ?? entry.deferredReason) ||
      null,
    next_action:
      asText(
        entry.next_action ??
          entry.nextAction ??
          entry.follow_up ??
          entry.followUp,
      ) || null,
    evidence:
      entry.evidence ??
      entry.source_evidence ??
      entry.sourceEvidence ??
      entry.trace ??
      null,
    trace_sha256: sha256Text(JSON.stringify(entry)),
  };
}

export function foundryTraceSummary({ datasetType, identity, row, rowIndex }) {
  const unresolved = collectCommonOtherTraceEntries(
    row,
    "tiangongfoundry:unresolvedTrace",
  ).map((trace) =>
    compactFoundryTraceEntry({
      datasetType,
      identity,
      rowIndex,
      traceKind: "unresolved_trace",
      trace,
    }),
  );
  const sourceExchangeCompleteness = collectCommonOtherTraceEntries(
    row,
    "tiangongfoundry:sourceExchangeCompleteness",
  ).map((trace) =>
    compactFoundryTraceEntry({
      datasetType,
      identity,
      rowIndex,
      traceKind: "source_exchange_completeness",
      trace,
    }),
  );
  const unresolvedExchange = collectCommonOtherTraceEntries(
    row,
    "tiangongfoundry:unresolvedExchangeTrace",
  ).map((trace) =>
    compactFoundryTraceEntry({
      datasetType,
      identity,
      rowIndex,
      traceKind: "unresolved_exchange_trace",
      trace,
    }),
  );
  return {
    import_trace_summary_count: traceSummaryCount(row),
    unresolved_trace_count: unresolved.length,
    unresolved_exchange_trace_count: unresolvedExchange.length,
    source_exchange_completeness_count: sourceExchangeCompleteness.length,
    unresolved_traces: unresolved,
    unresolved_exchange_traces: unresolvedExchange,
    source_exchange_completeness: sourceExchangeCompleteness,
  };
}

export function hasImportOnlyTrace(value) {
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const other = node["common:other"];
    if (
      other &&
      typeof other === "object" &&
      !Array.isArray(other) &&
      (Object.hasOwn(other, "tidasimport:sourceTrace") ||
        Object.hasOwn(other, "@xmlns:tidasimport"))
    ) {
      found = true;
      return;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return found;
}

export function normalizedArtifactPath(repoRoot, value) {
  const text = asText(value);
  if (!text) return null;
  return path.resolve(resolveRepoPath(repoRoot, text));
}

export function sameArtifactPath(repoRoot, left, right) {
  const resolvedLeft = normalizedArtifactPath(repoRoot, left);
  const resolvedRight = normalizedArtifactPath(repoRoot, right);
  return Boolean(
    resolvedLeft && resolvedRight && resolvedLeft === resolvedRight,
  );
}

export function repoRelativeArtifactPath(repoRoot, value) {
  const resolved = normalizedArtifactPath(repoRoot, value);
  return resolved ? repoRelativePath(repoRoot, resolved) : null;
}

export function readUnresolvedExchangeExternalizationContext(repoRoot, artifact) {
  if (!artifact) return null;
  const report = artifact.value ?? {};
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    report.input_rows_file ??
      report.inputRowsFile ??
      report.files?.input_rows ??
      report.files?.inputRows,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    report.output_rows_file ??
      report.outputRowsFile ??
      report.files?.output_rows ??
      report.files?.outputRows,
  );
  const tracesFile = resolveRepoPath(
    repoRoot,
    report.traces_file ??
      report.tracesFile ??
      report.files?.traces ??
      report.files?.unresolved_exchanges,
  );
  const traces = readJsonLinesIfExists(tracesFile);
  const affectedKeys = new Set();
  const externalizedExchangeCountByIdentity = new Map();
  for (const trace of traces) {
    const id = asText(trace?.dataset_id ?? trace?.entity_id);
    const version = asText(trace?.dataset_version ?? trace?.version) || "00.00.001";
    if (!id) continue;
    const key = `process:${id}@@${version}`;
    affectedKeys.add(key);
    externalizedExchangeCountByIdentity.set(
      key,
      (externalizedExchangeCountByIdentity.get(key) ?? 0) + 1,
    );
  }
  const outputPayloadSha256ByIdentity = new Map();
  if (outputRowsFile && fileExists(outputRowsFile)) {
    readRowsIfExists(outputRowsFile).forEach((row, index) => {
      const identity = datasetIdentity(row, index, "process");
      const key = identityFreshnessIdentityKey({
        datasetType: "process",
        identity,
      });
      if (key) {
        outputPayloadSha256ByIdentity.set(key, sha256Json(identity.payload));
      }
    });
  }
  return {
    artifact,
    status: asText(report.status),
    inputRowsFile,
    outputRowsFile,
    tracesFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    tracesFileRelative: repoRelativeArtifactPath(repoRoot, tracesFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path),
    externalizedExchanges: Number(report.counts?.externalized_exchanges ?? 0) || 0,
    affectedRows: Number(report.counts?.affected_rows ?? 0) || 0,
    traces,
    affectedKeys,
    externalizedExchangeCountByIdentity,
    outputPayloadSha256ByIdentity,
  };
}

export function readCanonicalSupportRewriteContext(repoRoot, artifact) {
  if (!artifact) return null;
  const report = artifact.value ?? {};
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    report.rows_file ??
      report.rowsFile ??
      report.input_rows_file ??
      report.inputRowsFile ??
      report.files?.input_rows ??
      report.files?.inputRows,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    report.output_rows_file ??
      report.outputRowsFile ??
      report.files?.output_rows ??
      report.files?.outputRows,
  );
  const blockersFile = resolveRepoPath(
    repoRoot,
    report.files?.canonical_support_blockers ??
      report.files?.blockers ??
      report.blockers_file,
  );
  const deferredRowsFile = resolveRepoPath(
    repoRoot,
    report.files?.deferred_rows ??
      report.files?.deferredRows ??
      report.deferred_rows_file ??
      report.deferredRowsFile,
  );
  const rewritesFile = resolveRepoPath(
    repoRoot,
    report.files?.canonical_support_rewrites ??
      report.files?.rewrites ??
      report.rewrites_file,
  );
  const blockerRows = readJsonLinesIfExists(blockersFile);
  const hardBlockers = Array.isArray(report.blockers)
    ? report.blockers
    : String(report.status) === "blocked"
      ? blockerRows
      : [];
  const deferredBlockers = Array.isArray(report.deferred_blockers)
    ? report.deferred_blockers
    : String(report.status) === "completed_with_deferred_rows"
      ? blockerRows
      : [];
  return {
    artifact,
    status: asText(report.status),
    counts: report.counts && typeof report.counts === "object" ? report.counts : {},
    inputRowsFile,
    outputRowsFile,
    deferredRowsFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    deferredRowsFileRelative: repoRelativeArtifactPath(repoRoot, deferredRowsFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path),
    blockersFileRelative: repoRelativeArtifactPath(repoRoot, blockersFile),
    rewritesFileRelative: repoRelativeArtifactPath(repoRoot, rewritesFile),
    blockerRows,
    blockers: hardBlockers,
    deferredBlockers,
    rewrites: readJsonLinesIfExists(rewritesFile),
  };
}

export function unresolvedExchangeExternalizationRowsForIdentity(context, identity) {
  if (!context || !identity?.id) return [];
  const key = `process:${identity.id}@@${identity.version || "00.00.001"}`;
  return context.traces.filter((trace) => {
    const id = asText(trace?.dataset_id ?? trace?.entity_id);
    const version =
      asText(trace?.dataset_version ?? trace?.version) || "00.00.001";
    return key === `process:${id}@@${version}`;
  });
}

export function rowsFileChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  upstreamFile,
  finalFile,
  unresolvedExchangeExternalizationContext,
}) {
  return Boolean(
    upstreamFile &&
      finalFile &&
      unresolvedExchangeExternalizationContext?.status === "completed" &&
      unresolvedExchangeExternalizationContext.inputRowsFile &&
      unresolvedExchangeExternalizationContext.outputRowsFile &&
      sameArtifactPath(
        repoRoot,
        upstreamFile,
        unresolvedExchangeExternalizationContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        unresolvedExchangeExternalizationContext.outputRowsFile,
        finalFile,
      ),
  );
}

export function evidenceScopeBlocker({
  code,
  stage,
  message,
  expected,
  actual,
  artifact,
  repoRoot,
}) {
  return {
    code,
    stage,
    message,
    expected: repoRelativeArtifactPath(repoRoot, expected),
    actual: repoRelativeArtifactPath(repoRoot, actual),
    artifact: artifact ? repoRelativePath(repoRoot, artifact) : null,
  };
}

export function dryRunReportRowsFile(report) {
  return (
    report?.input_path ??
    report?.inputPath ??
    report?.input_file ??
    report?.inputFile ??
    report?.rows_file ??
    report?.rowsFile ??
    report?.source_rows_file ??
    report?.sourceRowsFile ??
    report?.source_path ??
    report?.sourcePath ??
    report?.files?.input ??
    report?.files?.input_rows ??
    report?.files?.source_rows ??
    report?.files?.selected_rows_input
  );
}

export function buildEvidenceScopeBlockers({
  repoRoot,
  rowsFile,
  schemaReportArtifact,
  curationGateArtifact,
  dryRunReportArtifact,
  cleanupArtifact,
  patchApplyArtifact,
  patchApplyContext,
  patchCollectArtifact,
  requirePatchCollectReport,
  requireCurationGate = true,
  remoteVerifyArtifact,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  const blockers = [];
  const finalRowsFile = path.resolve(rowsFile);
  const schemaInput = schemaReportArtifact?.value?.input_path;
  if (!schemaInput) {
    blockers.push(
      evidenceScopeBlocker({
        code: "schema_report_input_missing",
        stage: "schema",
        message:
          "Schema validation report must record input_path for exact rows-file scope verification.",
        expected: finalRowsFile,
        actual: null,
        artifact: schemaReportArtifact?.path,
        repoRoot,
      }),
    );
  } else if (!sameArtifactPath(repoRoot, schemaInput, finalRowsFile)) {
    blockers.push(
      evidenceScopeBlocker({
        code: "schema_report_rows_mismatch",
        stage: "schema",
        message:
          "Schema validation report input_path does not match the mutation manifest rows file.",
        expected: finalRowsFile,
        actual: schemaInput,
        artifact: schemaReportArtifact?.path,
        repoRoot,
      }),
    );
  }

  if (!curationGateArtifact && requireCurationGate) {
    blockers.push({
      code: "curation_gate_report_required",
      stage: "foundry_curation",
      message:
        "dataset-mutation-manifest requires a post-authoring dataset-curation-gate report for the exact write rows.",
    });
  } else if (curationGateArtifact) {
    const curationRowsFile = curationGateArtifact.value?.rows_file;
    if (!curationRowsFile) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_rows_missing",
          stage: "foundry_curation",
          message:
            "Curation gate report must record rows_file for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, curationRowsFile, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_rows_mismatch",
          stage: "foundry_curation",
          message:
            "Curation gate report rows_file does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: curationRowsFile,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    }
    if (
      !["ready", "ready_with_profile_waivers"].includes(
        curationGateArtifact.value?.status,
      )
    ) {
      blockers.push({
        code: "curation_gate_report_not_ready",
        stage: "foundry_curation",
        message: `Curation gate report status is ${curationGateArtifact.value?.status ?? "missing"}.`,
        artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
      });
    }
    if (!curationGateArtifact.value?.qa_report) {
      blockers.push({
        code: "curation_gate_qa_report_missing",
        stage: "foundry_curation",
        message:
          "Curation gate report must record the deterministic QA report used for final prewrite curation.",
        artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
      });
    } else {
      const qaReportPath = resolveRepoPath(
        repoRoot,
        curationGateArtifact.value.qa_report,
      );
      if (!fileExists(qaReportPath)) {
        blockers.push({
          code: "curation_gate_qa_report_not_readable",
          stage: "foundry_curation",
          message: "Curation gate qa_report file is not readable.",
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
          qa_report: repoRelativeArtifactPath(
            repoRoot,
            curationGateArtifact.value.qa_report,
          ),
        });
      } else {
        try {
          const qaReport = readJson(qaReportPath);
          const qaRowsFile =
            qaReport.rows_file ?? qaReport.input_path ?? qaReport.inputPath;
          if (!qaRowsFile) {
            blockers.push({
              code: "curation_gate_qa_rows_missing",
              stage: "foundry_curation",
              message:
                "Final deterministic QA report must record rows_file or input_path for exact rows-file scope verification.",
              artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
              qa_report: repoRelativePath(repoRoot, qaReportPath),
            });
          } else if (!sameArtifactPath(repoRoot, qaRowsFile, finalRowsFile)) {
            blockers.push(
              evidenceScopeBlocker({
                code: "curation_gate_qa_rows_mismatch",
                stage: "foundry_curation",
                message:
                  "Final deterministic QA report rows_file/input_path does not match the mutation manifest rows file.",
                expected: finalRowsFile,
                actual: qaRowsFile,
                artifact: qaReportPath,
                repoRoot,
              }),
            );
          }
        } catch (error) {
          blockers.push({
            code: "curation_gate_qa_report_invalid",
            stage: "foundry_curation",
            message: error instanceof Error ? error.message : String(error),
            artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
            qa_report: repoRelativePath(repoRoot, qaReportPath),
          });
        }
      }
    }
    if (
      curationGateArtifact.value?.schema_report &&
      schemaReportArtifact?.path &&
      !sameArtifactPath(
        repoRoot,
        curationGateArtifact.value.schema_report,
        schemaReportArtifact.path,
      )
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_schema_report_mismatch",
          stage: "foundry_curation",
          message:
            "Curation gate schema_report does not match the schema report passed to mutation manifest.",
          expected: schemaReportArtifact.path,
          actual: curationGateArtifact.value.schema_report,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (cleanupArtifact) {
    const cleanedRowsFile =
      cleanupArtifact.value?.cleaned_rows_file ??
      cleanupArtifact.value?.files?.cleaned_rows;
    if (!cleanedRowsFile) {
      blockers.push(
        evidenceScopeBlocker({
          code: "cleanup_cleaned_rows_missing",
          stage: "prewrite_cleanup",
          message:
            "Cleanup report must record cleaned_rows_file/files.cleaned_rows for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: cleanupArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, cleanedRowsFile, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "cleanup_cleaned_rows_mismatch",
          stage: "prewrite_cleanup",
          message:
            "Cleanup cleaned_rows_file does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: cleanedRowsFile,
          artifact: cleanupArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (patchApplyArtifact) {
    const patchOut =
      patchApplyArtifact.value?.out_path ??
      patchApplyArtifact.value?.files?.patched_rows;
    const cleanupInput = cleanupArtifact?.value?.rows_file;
    if (!patchOut) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_output_missing",
          stage: "ai_patch_apply",
          message:
            "Patch apply report must record out_path/files.patched_rows for exact scope verification.",
          expected: cleanupInput || finalRowsFile,
          actual: null,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    } else if (
      cleanupArtifact &&
      !sameArtifactPath(repoRoot, patchOut, cleanupInput) &&
      !patchApplyOutputChainsThroughIdentityRewrite({
        repoRoot,
        patchOut,
        cleanupInput,
        identityReferenceRewriteContext,
      }) &&
      !patchApplyOutputChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        patchOut,
        cleanupInput,
        unresolvedExchangeExternalizationContext,
      }) &&
      !patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization({
        repoRoot,
        patchOut,
        cleanupInput,
        identityReferenceRewriteContext,
        unresolvedExchangeExternalizationContext,
      }) &&
      !rowsFileReachableThroughTransformChain({
        repoRoot,
        startFiles: [patchOut],
        expectedRowsFile: cleanupInput,
        transforms: deterministicRowsFileTransformEntries({
          patchApplyContext: null,
          identityReferenceRewriteContext,
          unresolvedExchangeExternalizationContext,
          canonicalSupportRewriteContext,
        }),
      })
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_cleanup_input_mismatch",
          stage: "ai_patch_apply",
          message:
            "Patch apply output must match the cleanup input rows file, or feed a completed deterministic rewrite chain whose output is the cleanup input.",
          expected: cleanupInput,
          actual: patchOut,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    } else if (
      !cleanupArtifact &&
      !sameArtifactPath(repoRoot, patchOut, finalRowsFile)
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_rows_mismatch",
          stage: "ai_patch_apply",
          message:
            "Patch apply output does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: patchOut,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    }
    if ((patchApplyContext?.evidenceRows.length ?? 0) === 0) {
      blockers.push({
        code: "patch_evidence_required",
        stage: "ai_patch_apply",
        message:
          "AI-authored patch apply report was provided, but no patch evidence rows were found.",
        patch_apply_report: repoRelativePath(repoRoot, patchApplyArtifact.path),
      });
    }
  }

  if (requirePatchCollectReport && !patchCollectArtifact) {
    blockers.push({
      code: "patch_collect_report_required",
      stage: "ai_patch_collect",
      message:
        "Foundry AI authoring task patch apply requires --patch-collect-report from dataset-authoring-patch-collect.",
    });
  }

  if (patchCollectArtifact) {
    if (patchCollectArtifact.value?.status !== "ready_for_patch_apply") {
      blockers.push({
        code: "patch_collect_not_ready",
        stage: "ai_patch_collect",
        message: `dataset-authoring-patch-collect status is ${patchCollectArtifact.value?.status ?? "missing"}.`,
        artifact: repoRelativePath(repoRoot, patchCollectArtifact.path),
      });
    }
    const batchPatch = patchCollectArtifact.value?.files?.batch_patch;
    const appliedPatch = patchApplyArtifact?.value?.patch_path;
    if (
      patchApplyArtifact &&
      batchPatch &&
      appliedPatch &&
      !sameArtifactPath(repoRoot, batchPatch, appliedPatch)
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_collect_apply_patch_mismatch",
          stage: "ai_patch_collect",
          message:
            "Collected batch patch file does not match the patch file applied by dataset-patch-apply.",
          expected: batchPatch,
          actual: appliedPatch,
          artifact: patchCollectArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (!dryRunReportArtifact) {
    blockers.push({
      code: "dry_run_report_required",
      stage: "dry_run",
      message:
        "dataset-mutation-manifest requires a dry-run report before remote write planning. Upstream prewrite gates may intentionally skip dry-run and keep the manifest blocked.",
    });
  } else {
    const dryRunInput = dryRunReportRowsFile(dryRunReportArtifact.value);
    if (!dryRunInput) {
      blockers.push(
        evidenceScopeBlocker({
          code: "dry_run_report_input_missing",
          stage: "dry_run",
          message:
            "Dry-run report must record input_path/input_file/rows_file for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: dryRunReportArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, dryRunInput, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "dry_run_report_rows_mismatch",
          stage: "dry_run",
          message:
            "Dry-run report input path does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: dryRunInput,
          artifact: dryRunReportArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (remoteVerifyArtifact) {
    const remoteInput = remoteVerifyArtifact.value?.input_path;
    if (!remoteInput) {
      blockers.push(
        evidenceScopeBlocker({
          code: "remote_verify_input_missing",
          stage: "remote_verify",
          message:
            "Remote verification report must record input_path for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: remoteVerifyArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, remoteInput, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "remote_verify_rows_mismatch",
          stage: "remote_verify",
          message:
            "Remote verification report input_path does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: remoteInput,
          artifact: remoteVerifyArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  return blockers;
}

export function curationGateContextHasKind(curationGateArtifact, kind) {
  const details = ensureArray(
    curationGateArtifact?.value?.context?.contract_context_file_details,
  );
  if (details.some((file) => asText(file?.kind) === kind)) return true;
  const contextPaths = ensureArray(
    curationGateArtifact?.value?.context?.contract_context_files,
  );
  const expectedFileByKind = {
    schema: "schema.json",
    methodology_yaml: "methodology.yaml",
    ruleset: "runtime-ruleset.json",
  };
  const expected = expectedFileByKind[kind];
  return Boolean(
    expected &&
    contextPaths.some((filePath) =>
      String(filePath ?? "")
        .toLowerCase()
        .includes(expected),
    ),
  );
}

export function curationGateContextHasPattern(curationGateArtifact, pattern) {
  const details = ensureArray(
    curationGateArtifact?.value?.context?.contract_context_file_details,
  );
  if (
    details.some((file) =>
      String(file?.path ?? "")
        .toLowerCase()
        .includes(pattern.toLowerCase()),
    )
  ) {
    return true;
  }
  const contextPaths = ensureArray(
    curationGateArtifact?.value?.context?.contract_context_files,
  );
  return contextPaths.some((filePath) =>
    String(filePath ?? "")
      .toLowerCase()
      .includes(pattern.toLowerCase()),
  );
}

export function evidenceResolution(entry) {
  return entry?.resolution &&
    typeof entry.resolution === "object" &&
    !Array.isArray(entry.resolution)
    ? entry.resolution
    : null;
}

export function evidenceResolutionMode(entry) {
  return asText(evidenceResolution(entry)?.mode);
}

export function evidenceResolutionContextKinds(entry) {
  return ensureArray(
    evidenceResolution(entry)?.used_context_kinds ??
      evidenceResolution(entry)?.usedContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
}

export function contextFileHasNonEmptyText(file) {
  return Buffer.byteLength(String(file?.text ?? ""), "utf8") > 0;
}

export function contextFilesHaveKind(files, kind) {
  return ensureArray(files).some(
    (file) => asText(file?.kind) === kind && contextFileHasNonEmptyText(file),
  );
}

export function contextFilesHavePattern(files, pattern) {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some(
    (file) =>
      String(file?.path ?? "")
        .toLowerCase()
        .includes(needle) && contextFileHasNonEmptyText(file),
  );
}

export function readAuthoringPackageProof(
  repoRoot,
  packageRef,
  expectedSha256 = null,
  source = null,
) {
  const packagePath = resolveRepoPath(repoRoot, packageRef);
  const proof = {
    source,
    path: packageRef ? repoRelativeArtifactPath(repoRoot, packageRef) : null,
    exists: false,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    payload: null,
    contract_context_files: [],
    contract_context_file_details: [],
    blockers: [],
  };
  if (!packageRef || !packagePath || !fileExists(packagePath)) {
    proof.blockers.push({
      code: "full_context_authoring_package_missing",
      stage: "full_context_ai_completion",
      message:
        "Full-context AI completion evidence references an unreadable authoring package.",
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.exists = true;
  proof.path = repoRelativePath(repoRoot, packagePath);
  let rawText = "";
  try {
    rawText = readText(packagePath);
    proof.sha256 = sha256Text(rawText);
    proof.payload = JSON.parse(rawText);
  } catch (error) {
    proof.blockers.push({
      code: "full_context_authoring_package_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  if (
    !proof.payload ||
    typeof proof.payload !== "object" ||
    Array.isArray(proof.payload)
  ) {
    proof.blockers.push({
      code: "full_context_authoring_package_invalid",
      stage: "full_context_ai_completion",
      message: "Authoring package must be a JSON object.",
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.contract_context_files = ensureArray(
    proof.payload.contract_context_files,
  );
  proof.contract_context_file_details = contextFileDetails(
    proof.contract_context_files,
  );
  if (
    proof.expected_sha256 &&
    proof.sha256 &&
    proof.expected_sha256 !== proof.sha256
  ) {
    proof.blockers.push({
      code: "full_context_authoring_package_hash_mismatch",
      stage: "full_context_ai_completion",
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

export function authoringPackageProofsFromCurationGate(
  repoRoot,
  curationGateArtifact,
) {
  const entities = ensureArray(
    curationGateArtifact?.value?.entities ??
      curationGateArtifact?.value?.processes ??
      curationGateArtifact?.value?.flows ??
      curationGateArtifact?.value?.items,
  );
  return entities
    .map((entity) => {
      const packageRef = asText(
        entity?.authoring_package ?? entity?.authoringPackage,
      );
      if (!packageRef) return null;
      return readAuthoringPackageProof(
        repoRoot,
        packageRef,
        entity?.authoring_package_sha256,
        "curation_gate",
      );
    })
    .filter(Boolean);
}
