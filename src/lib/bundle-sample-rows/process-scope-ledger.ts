import path from "node:path";
import type { BundleSampleDependencies, LooseRecord, SelectedBundle } from "./types.ts";

/** Builds process-scope ledger rows and status summary from selected bundles and blockers. */
export function buildProcessScopeLedger({
  deps,
  selectedBundles,
  blockers,
  bundlesDir,
  outDir,
  profile,
}: {
  deps: Pick<
    BundleSampleDependencies,
    "asText" | "repoRelativeMaybe" | "repoRelativePath" | "resolveRepoPath" | "shellQuote"
  >;
  selectedBundles: SelectedBundle[];
  blockers: LooseRecord[];
  bundlesDir: unknown;
  outDir: string;
  profile: string;
}): {
  ledger: LooseRecord[];
  summary: {
    ready: number;
    needs_ai_authoring: number;
    blocked_deferred: number;
    selected_scopes: number;
    global_blockers: number;
    recommended_next_process_ids: string[];
  };
} {
  const { asText, repoRelativeMaybe, repoRelativePath, resolveRepoPath, shellQuote } = deps;

  function processIdFromBundleRef(value: unknown): string {
    const text = asText(value).replaceAll("\\", "/");
    if (!text) return "";
    const match = text.match(/(?:^|\/)process-bundles\/([^/]+)/u);
    return match?.[1] ?? "";
  }

  function blockerProcessId(blocker: LooseRecord): string {
    return (
      asText(blocker?.process_id) ||
      processIdFromBundleRef(blocker?.source_file) ||
      processIdFromBundleRef(blocker?.bundle) ||
      processIdFromBundleRef(blocker?.file) ||
      processIdFromBundleRef(blocker?.manifest)
    );
  }

  function blockerCountsByCode(blockersForScope: LooseRecord[]) {
    const counts = new Map<string, number>();
    for (const blocker of blockersForScope) {
      const code = asText(blocker?.code) || "unknown_blocker";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  function isHumanDependencyBlocker(blocker: LooseRecord): boolean {
    const code = asText(blocker?.code);
    return [
      "canonical_flow_property_reference_unresolved",
      "canonical_unit_group_reference_unresolved",
      "flow_property_reference_unresolved",
      "unit_group_reference_unresolved",
      "library_contact_count_invalid",
      "library_contact_identity_missing",
      "source_reference_semantics_unresolved",
      "process_data_source_reference_unresolved",
      "bundle_manifest_file_missing",
      "process_rows_missing",
    ].includes(code);
  }

  function scopeRerunCommand(processId: string): string {
    return [
      "node",
      "src/dev-cli.ts",
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      repoRelativeMaybe(resolveRepoPath(bundlesDir)) || bundlesDir,
      "--process-id",
      processId,
      "--out-dir",
      repoRelativePath(path.join(outDir, "scopes", processId)),
      "--profile",
      profile,
    ]
      .map(shellQuote)
      .join(" ");
  }

  const blockersByProcess = new Map<string, LooseRecord[]>();
  const globalBlockers: LooseRecord[] = [];
  for (const blocker of blockers) {
    const processId = blockerProcessId(blocker);
    if (!processId) {
      globalBlockers.push(blocker);
      continue;
    }
    const rows = blockersByProcess.get(processId) ?? [];
    rows.push(blocker);
    blockersByProcess.set(processId, rows);
  }
  const ledger = selectedBundles.map((bundle) => {
    const processBlockers = blockersByProcess.get(bundle.process_id) ?? [];
    const humanDependencyBlockers = processBlockers.filter(isHumanDependencyBlocker);
    const scopedGlobalBlockers =
      globalBlockers.length > 0
        ? globalBlockers.map((blocker) => ({
            code: blocker.code,
            message: blocker.message,
          }))
        : [];
    const status =
      processBlockers.length === 0 && globalBlockers.length === 0
        ? "ready"
        : humanDependencyBlockers.length > 0 || globalBlockers.length > 0
          ? "blocked_deferred"
          : "needs_ai_authoring";
    return {
      process_id: bundle.process_id,
      bundle_dir: bundle.bundle_dir,
      manifest: bundle.manifest,
      status,
      blocker_count: processBlockers.length + globalBlockers.length,
      ai_authoring_blockers: processBlockers.length - humanDependencyBlockers.length,
      human_dependency_blockers: humanDependencyBlockers.length + globalBlockers.length,
      blocker_counts_by_code: blockerCountsByCode([...processBlockers, ...globalBlockers]),
      blocker_examples: processBlockers.slice(0, 5).map((blocker) => ({
        code: blocker.code,
        dataset_type: blocker.dataset_type ?? null,
        dataset_id: blocker.dataset_id ?? null,
        message: blocker.message,
      })),
      global_blockers: scopedGlobalBlockers,
      next_step:
        status === "ready"
          ? "run raw-row validation, QA, curation gate, post-authoring cleanup, final validation, then write planning"
          : status === "needs_ai_authoring"
            ? "run classification/location/identity authoring, deterministic apply, then rerun this process scope"
            : "defer this scope until human/canonical dependency blockers are resolved",
      rerun_command: scopeRerunCommand(bundle.process_id),
    };
  });
  const summaryCounts = ledger.reduce<Record<string, number>>(
    (counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    },
    { ready: 0, needs_ai_authoring: 0, blocked_deferred: 0 },
  );
  return {
    ledger,
    summary: {
      ready: summaryCounts.ready ?? 0,
      needs_ai_authoring: summaryCounts.needs_ai_authoring ?? 0,
      blocked_deferred: summaryCounts.blocked_deferred ?? 0,
      selected_scopes: ledger.length,
      global_blockers: globalBlockers.length,
      recommended_next_process_ids: [...ledger]
        .filter((row) => row.status !== "blocked_deferred")
        .sort((left, right) => {
          const statusRank: Record<string, number> = {
            ready: 0,
            needs_ai_authoring: 1,
            blocked_deferred: 2,
          };
          return (
            (statusRank[left.status] ?? 99) - (statusRank[right.status] ?? 99) ||
            left.blocker_count - right.blocker_count ||
            left.process_id.localeCompare(right.process_id)
          );
        })
        .map((row) => row.process_id),
    },
  };
}
