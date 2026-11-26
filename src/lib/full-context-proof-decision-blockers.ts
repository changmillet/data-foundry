export type FullContextProofJsonRecord = Record<string, unknown>;

export interface FullContextProofJsonArtifact {
  path: string;
  value: unknown;
}

export interface FullContextRequirement extends FullContextProofJsonRecord {
  profile_id: unknown;
  dataset_type: string | null;
  required_context_kinds: string[];
  required_context_file_patterns: string[];
}

export interface FullContextProofBlocker extends FullContextProofJsonRecord {
  code: string;
  message: string;
}

export interface AuthoringPackageProof extends FullContextProofJsonRecord {
  source: unknown;
  path: unknown;
  sha256: string | null;
  expected_sha256: string | null;
  contract_context_files: unknown[];
  missing_context_files: unknown[];
  blockers: FullContextProofBlocker[];
}

export interface FullContextProofDependencies {
  asText: (value: unknown) => string;
  classificationDecisionUsedContextKinds: (row: unknown) => string[];
  decisionCompletionStatus: (row: unknown) => string;
  decisionContextBundleSha256: (row: unknown) => string;
  ensureArray: (value: unknown) => unknown[];
  fileExists: (filePath: string) => boolean;
  listImportProfiles: (options: { repoRoot: string }) => unknown;
  normalizedList: (value: unknown) => string[];
  readJson: (filePath: string) => unknown;
  readJsonArtifactOption: (value: unknown) => FullContextProofJsonArtifact | null;
  readJsonLines: (filePath: string) => unknown[];
  readText: (filePath: string) => string;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (value: unknown) => string | null;
  repoRoot: string;
  sha256Text: (value: unknown) => string;
  unique: <T>(values: T[]) => T[];
}

export function isJsonRecord(value: unknown): value is FullContextProofJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asJsonRecord(value: unknown): FullContextProofJsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function nestedValue(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isJsonRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function fullContextEvidenceArtifactBlocker({
  prefix,
  codePrefix,
  suffix,
  message,
  details = {},
}: {
  prefix: FullContextProofJsonRecord;
  codePrefix: string;
  suffix: string;
  message: string;
  details?: FullContextProofJsonRecord;
}): FullContextProofJsonRecord {
  return {
    ...prefix,
    code: `${codePrefix}_full_context_${suffix}`,
    message,
    ...details,
  };
}

export function normalizeProofRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  const record = asJsonRecord(value);
  if (Array.isArray(record.decisions)) return record.decisions.filter(Boolean);
  if (Array.isArray(record.rows)) return record.rows.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

export function createJsonOrJsonlRowsArtifactReader({
  fileExists,
  readJson,
  readJsonLines,
  resolveRepoPath,
}: Pick<
  FullContextProofDependencies,
  "fileExists" | "readJson" | "readJsonLines" | "resolveRepoPath"
>) {
  return function readJsonOrJsonlRowsArtifact(value: unknown): {
    path: string | null;
    rows: unknown[];
    error: string | null;
  } {
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
  };
}

export function createDecisionApplyProofBlockerBuilder(deps: FullContextProofDependencies) {
  const {
    asText,
    classificationDecisionUsedContextKinds,
    decisionCompletionStatus,
    decisionContextBundleSha256,
    ensureArray,
    readJsonArtifactOption,
    readText,
    repoRelativePath,
    sha256Text,
    unique,
  } = deps;
  const readJsonOrJsonlRowsArtifact = createJsonOrJsonlRowsArtifactReader(deps);

  function decisionApplyTasksFromReport(reportValue: unknown): unknown[] {
    const report = asJsonRecord(reportValue);
    const tasks = ensureArray(report.decision_tasks ?? report.decisionTasks);
    if (tasks.length > 0) return tasks;
    return report?.decision_task || report?.decisionTask
      ? [report.decision_task ?? report.decisionTask]
      : [];
  }

  function decisionTaskReferencePath(taskValue: unknown): string {
    const task = asJsonRecord(taskValue);
    return asText(task.path ?? task.task ?? task.decision_task ?? task.decisionTask);
  }

  function readDecisionTaskArtifactForProof(taskValue: unknown) {
    const task = asJsonRecord(taskValue);
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
            message: "Decision apply report references an unreadable AI decision task.",
            decision_task: taskRef || null,
          },
        ],
      };
    }
    const rawText = readText(artifact.path);
    const sha256 = sha256Text(rawText);
    const artifactValue = asJsonRecord(artifact.value);
    const contextBundle = asJsonRecord(
      artifactValue.context_bundle ?? artifactValue.authoring_context,
    );
    const expectedSha256 = asText(task?.sha256);
    const expectedContextBundleSha256 = asText(
      task?.context_bundle_sha256 ?? task?.contextBundleSha256,
    );
    const contextBundleSha256 = asText(contextBundle.sha256 ?? contextBundle.context_bundle_sha256);
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
      status: asText(artifactValue.status),
      task_kind: asText(artifactValue.task_kind),
      blockers,
    };
  }

  function decisionApplyReportRefs(
    evidence: FullContextProofJsonRecord,
    reportKey: string,
    kind: string,
  ): string[] {
    const values =
      kind === "identity"
        ? [
            ...ensureArray(evidence.identity_decision_apply_reports),
            ...ensureArray(evidence[reportKey]),
          ]
        : ensureArray(evidence[reportKey]);
    return unique(values.map((value) => asText(value)));
  }

  return function buildDecisionApplyProofBlockers({
    mutationArtifact,
    requirement,
    prefix,
    codePrefix,
    kind,
    expectedCount,
  }: {
    mutationArtifact: FullContextProofJsonArtifact;
    requirement: FullContextRequirement | null;
    prefix: FullContextProofJsonRecord;
    codePrefix: string;
    kind: "classification" | "location" | "identity";
    expectedCount: number;
  }): FullContextProofJsonRecord[] {
    if (expectedCount <= 0) return [];
    const blockers: FullContextProofJsonRecord[] = [];
    const mutationManifest = asJsonRecord(mutationArtifact.value);
    const evidence = asJsonRecord(mutationManifest.evidence);
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
      kind === "location" ? "location_decision_authoring" : "classification_decision_authoring";
    const expectedTaskStatus =
      kind === "location"
        ? "ready_for_ai_location_decisions"
        : "ready_for_ai_classification_decisions";
    const reportRefs = decisionApplyReportRefs(evidence, reportKey, kind);
    const reportArtifacts = reportRefs
      .map((reportRef) => readJsonArtifactOption(reportRef))
      .filter((artifact): artifact is FullContextProofJsonArtifact => artifact !== null);
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

    const report = asJsonRecord(reportArtifact.value);
    for (const candidateReportArtifact of reportArtifacts) {
      const candidateReportStatus = asText(asJsonRecord(candidateReportArtifact.value).status);
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

    const decisionRows: unknown[] = [];
    const decisionFiles: string[] = [];
    for (const candidateReportArtifact of reportArtifacts) {
      const candidateReport = asJsonRecord(candidateReportArtifact.value);
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
        decisionFiles.push(repoRelativePath(decisionsArtifact.path!));
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
            message: "Decision apply report references a decision task with the wrong task kind.",
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
            message: "Decision task must still carry context_bundle.sha256 for closeout proof.",
            details: {
              report: repoRelativePath(reportArtifact.path),
              decision_task: repoRelativePath(taskProof.artifact.path),
            },
          }),
        );
      }
    }

    const contextBundleHashes = unique(taskProofs.map((proof) => proof.context_bundle_sha256));
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
    const missingEvidence = decisionsArtifact.rows.filter((decision) => {
      const evidenceValue = asJsonRecord(decision).evidence;
      return !evidenceValue || typeof evidenceValue !== "object";
    });
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
  };
}
