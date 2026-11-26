export {
  modelExecutionAttemptDisposition,
  type ExecutionAttemptState,
  type ExecutionAttemptDisposition,
} from "../lib/foundry-execution-attempt.ts";
import fs from "node:fs";
import path from "node:path";
import {
  LEDGER_SCHEMA,
  REPORT_SCHEMA,
  SEAL_SCHEMA,
  compareText,
  pathIsInside,
  sha256,
  stableJson,
  validateExecutionCapsuleStage,
  type JsonRecord,
  type StageManifest,
  type ValidationResult,
} from "../lib/execution-capsule-validation.ts";

export type ExecutionCapsuleOptions = Record<string, unknown> & {
  help?: unknown;
  stageManifest?: unknown;
  manifest?: unknown;
  outDir?: unknown;
  predecessorStageManifest?: unknown;
};

function writeExclusive(filePath: string, content: string | Buffer): void {
  fs.writeFileSync(filePath, content, { flag: "wx" });
}

function writeJsonExclusive(filePath: string, value: unknown): void {
  writeExclusive(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function relativeToRepo(repoRoot: string, filePath: string): string {
  const relative = path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
  return pathIsInside(repoRoot, filePath) ? relative : filePath;
}

export function createExecutionCapsuleCommands({ repoRoot }: { repoRoot: string }) {
  function runExecutionCapsuleAdmit(options: ExecutionCapsuleOptions): JsonRecord {
    if (options.help) {
      return {
        status: "help",
        command: "execution-capsule-admit",
        usage:
          "node src/dev-cli.ts execution-capsule-admit --stage-manifest <revision.json> [--predecessor-stage-manifest <previous-revision.json>] --out-dir <fresh-dir>",
        effects: "local evidence files only; zero network, database, CLI dispatch, and mutation",
      };
    }

    const manifestOption = options.stageManifest || options.manifest;
    const outDirOption = options.outDir;
    if (!manifestOption || !outDirOption) {
      throw new Error("--stage-manifest and --out-dir are required.");
    }
    const manifestPath = path.resolve(repoRoot, manifestOption as string);
    const outDir = path.resolve(repoRoot, outDirOption as string);
    if (!pathIsInside(repoRoot, outDir)) {
      throw new Error("--out-dir must stay inside the repository root.");
    }
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
      throw new Error(`Stage manifest is not a file: ${manifestOption}`);
    }
    if (fs.existsSync(outDir)) {
      throw new Error(
        `Admission output directory already exists and is immutable: ${outDirOption}`,
      );
    }
    const repoReal = fs.realpathSync(repoRoot);
    let existingParent = path.dirname(outDir);
    while (!fs.existsSync(existingParent)) {
      const next = path.dirname(existingParent);
      if (next === existingParent) break;
      existingParent = next;
    }
    if (
      !fs.existsSync(existingParent) ||
      !fs.statSync(existingParent).isDirectory() ||
      !pathIsInside(repoReal, fs.realpathSync(existingParent))
    ) {
      throw new Error("--out-dir resolves through a parent outside the repository root.");
    }
    fs.mkdirSync(outDir, { recursive: true });

    const manifestRaw = fs.readFileSync(manifestPath);
    const snapshotPath = path.join(outDir, "execution-capsule-stage-revision.json");
    writeExclusive(snapshotPath, manifestRaw);

    let manifest: StageManifest | undefined;
    let validation: ValidationResult | undefined;
    try {
      manifest = JSON.parse(manifestRaw.toString("utf8")) as StageManifest;
    } catch (error) {
      validation = {
        rows: [
          {
            schema_version: LEDGER_SCHEMA,
            check_id: "stage_parse",
            status: "FAIL",
            severity: "P0",
            detail: `Stage manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            evidence: null,
          },
        ],
        materializedLeaves: [],
        stageRoot: null,
        manifestSha256: sha256(manifestRaw),
      };
    }
    if (!validation) {
      try {
        validation = validateExecutionCapsuleStage({
          manifest: manifest!,
          manifestPath,
          manifestRaw,
          predecessorOption: options.predecessorStageManifest,
          repoRoot,
        });
      } catch (error) {
        validation = {
          rows: [
            {
              schema_version: LEDGER_SCHEMA,
              check_id: "admission_validator_error",
              status: "FAIL",
              severity: "P0",
              detail: `Admission validator failed closed: ${error instanceof Error ? error.message : String(error)}`,
              evidence: null,
            },
          ],
          materializedLeaves: [],
          stageRoot: null,
          manifestSha256: sha256(manifestRaw),
        };
      }
    }

    const failed = validation.rows.filter((row) => row.status === "FAIL");
    const p0 = failed.filter((row) => row.severity === "P0").length;
    const p1 = failed.filter((row) => row.severity === "P1").length;
    const ledgerText = validation.rows.map((row) => stableJson(row)).join("\n") + "\n";
    const ledgerPath = path.join(outDir, "execution-capsule-admission-ledger.jsonl");
    writeExclusive(ledgerPath, ledgerText);

    const snapshotBytes = fs.readFileSync(snapshotPath);
    const report = {
      schema_version: REPORT_SCHEMA,
      status: failed.length === 0 ? "sealed" : "rejected",
      admission_mode: "OFFLINE_ONLY",
      production_authority: false,
      stage: {
        stage_id: manifest?.stage_id ?? null,
        revision: manifest?.revision ?? null,
        source_manifest: relativeToRepo(repoRoot, manifestPath),
        snapshot: relativeToRepo(repoRoot, snapshotPath),
        manifest_sha256: validation.manifestSha256,
        scope_binding_sha256: manifest?.scope_binding_sha256 ?? null,
      },
      counts: {
        checks: validation.rows.length,
        passed: validation.rows.length - failed.length,
        failed: failed.length,
        p0,
        p1,
        leaves: validation.materializedLeaves.length,
        primary_attempts: 0,
        network_dispatches: 0,
        database_dispatches: 0,
        mutations: 0,
      },
      artifacts: {
        stage_snapshot_sha256: sha256(snapshotBytes),
        ledger: relativeToRepo(repoRoot, ledgerPath),
        ledger_sha256: sha256(ledgerText),
      },
      leaves: validation.materializedLeaves,
      failed_checks: failed.map((row) => row.check_id),
    };
    const reportPath = path.join(outDir, "execution-capsule-admission-report.json");
    writeJsonExclusive(reportPath, report);

    let seal: JsonRecord | null = null;
    let sealPath: string | null = null;
    if (failed.length === 0) {
      const reportBytes = fs.readFileSync(reportPath);
      const sealPayload = {
        schema_version: SEAL_SCHEMA,
        stage_id: manifest!.stage_id,
        revision: manifest!.revision,
        predecessor_stage_manifest_sha256: manifest!.predecessor_stage_manifest_sha256,
        stage_manifest_sha256: validation.manifestSha256,
        scope_binding_sha256: manifest!.scope_binding_sha256,
        leaf_set_sha256: sha256(
          stableJson(
            validation.materializedLeaves
              .map((leaf) => ({
                leaf_id: leaf.leaf_id,
                raw_sha256: leaf.raw_sha256,
                semantic_sha256: leaf.semantic_sha256,
              }))
              .sort((left, right) => compareText(left.leaf_id ?? "", right.leaf_id ?? "")),
          ),
        ),
        evidence: {
          stage_snapshot_sha256: sha256(snapshotBytes),
          admission_ledger_sha256: sha256(ledgerText),
          admission_report_sha256: sha256(reportBytes),
        },
        attempt_state: {
          status: "UNATTEMPTED",
          attempt_count: 0,
          primary_attempt_count: 0,
          dispatch_state: "NOT_DISPATCHED",
          mutation_state: "NONE",
        },
        production_authority: false,
      };
      seal = {
        ...sealPayload,
        seal_payload_sha256: sha256(stableJson(sealPayload)),
      };
      sealPath = path.join(outDir, "execution-capsule-seal.json");
      writeJsonExclusive(sealPath, seal);
    }

    return {
      status: report.status,
      report: relativeToRepo(repoRoot, reportPath),
      ledger: relativeToRepo(repoRoot, ledgerPath),
      seal: sealPath ? relativeToRepo(repoRoot, sealPath) : null,
      seal_payload_sha256: seal?.seal_payload_sha256 ?? null,
      counts: report.counts,
    };
  }

  return { runExecutionCapsuleAdmit };
}
