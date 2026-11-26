import fs from "node:fs";
import path from "node:path";
import {
  type JsonRecord,
  LEDGER_SCHEMA,
  REPORT_SCHEMA,
  SEAL_SCHEMA,
  PromotionArtifactError,
  decodeArtifactText,
  compareText,
  isPlainObject,
  pathIsInside,
  relativeToRepo,
  sha256,
  stableJson,
  writeExclusive,
  writeJsonExclusive,
} from "../lib/final-delivery-manifest.ts";
import { safeLabel } from "../lib/final-delivery-redaction.ts";
import {
  validateFinalDeliveryManifest,
  type PromotionValidation,
} from "../lib/final-delivery-validation.ts";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

const stagePipeline = readOnlyStageContract([
  {
    stage: "prepare",
    purpose: "Snapshot one immutable final-delivery manifest into a fresh promotion directory.",
    inputs: ["foundry-final-delivery-manifest.v1"],
    outputs: ["final-delivery-manifest-snapshot.json"],
    blockers: ["unsafe path", "existing output directory", "unparseable manifest"],
    side_effects: ["local immutable evidence files only"],
  },
  {
    stage: "gate_validate",
    purpose:
      "Validate content bindings, row counts, algebra, workbook contract, redaction, and independent review.",
    inputs: ["manifest-bound local artifacts"],
    outputs: ["final-delivery-promotion-ledger.jsonl"],
    blockers: ["any P0 or P1 finding"],
    side_effects: ["none outside the fresh output directory"],
  },
  {
    stage: "report",
    purpose:
      "Write the reader-facing report and emit a detached seal only after every check passes.",
    inputs: ["snapshot", "ledger"],
    outputs: ["final-delivery-promotion-report.json", "final-delivery-promotion-seal.json"],
    blockers: ["rejected validation"],
    side_effects: ["local immutable evidence files only"],
  },
]);

export type FinalDeliveryPromoteOptions = {
  help?: boolean;
  manifest?: string | null;
  outDir?: string | null;
};

export function createFinalDeliveryPromotionCommands({ repoRoot }: { repoRoot: string }) {
  function runFinalDeliveryPromote(options: FinalDeliveryPromoteOptions): JsonRecord {
    if (options.help) {
      return {
        status: "help",
        command: "final-delivery-promote",
        usage:
          "node src/dev-cli.ts final-delivery-promote --manifest <final-delivery-manifest.json> --out-dir <fresh-dir>",
        effects:
          "local immutable evidence files only; zero network, database, CLI dispatch, and mutation",
        ...stagePipeline,
      };
    }

    if (!options.manifest || !options.outDir) {
      throw new Error("--manifest and --out-dir are required.");
    }
    const manifestPath = path.resolve(repoRoot, options.manifest);
    const outDir = path.resolve(repoRoot, options.outDir);
    if (!pathIsInside(repoRoot, manifestPath) || !pathIsInside(repoRoot, outDir)) {
      throw new Error("--manifest and --out-dir must stay inside the repository root.");
    }
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest does not exist: ${options.manifest}`);
    }
    const manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new Error("--manifest must be a regular non-symlink file.");
    }
    const repoReal = fs.realpathSync(repoRoot);
    if (!pathIsInside(repoReal, fs.realpathSync(manifestPath))) {
      throw new Error("--manifest resolves outside the repository root.");
    }
    // Promotion output is immutable: an existing directory is never reused or overwritten.
    if (fs.existsSync(outDir)) {
      throw new Error(
        `Promotion output directory already exists and is immutable: ${options.outDir}`,
      );
    }
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
    const snapshotPath = path.join(outDir, "final-delivery-manifest-snapshot.json");
    writeExclusive(snapshotPath, manifestRaw);

    let manifest: JsonRecord | null = null;
    let validation: PromotionValidation;
    try {
      // The manifest is held to the same strict text contract as any other artifact.
      const parsedManifest: unknown = JSON.parse(decodeArtifactText(manifestRaw));
      manifest = isPlainObject(parsedManifest) ? parsedManifest : null;
      if (!manifest) {
        throw new PromotionArtifactError("manifest_not_object", "Manifest is not an object.");
      }
      validation = validateFinalDeliveryManifest({ manifest, manifestPath, manifestRaw, repoRoot });
    } catch {
      // Any validator failure is itself a fail-closed P0 row, so a rejected run still leaves a
      // complete ledger instead of a partial seal.
      validation = {
        rows: [
          {
            schema_version: LEDGER_SCHEMA,
            check_id: "promotion_validator_error",
            status: "FAIL",
            severity: "P0",
            // A parser message can carry a fragment of the manifest, so only a stable category is
            // recorded.
            detail: "Promotion validator failed closed.",
            evidence: {
              category: manifest ? "manifest_validation_failed" : "manifest_unparseable",
            },
          },
        ],
        manifestSha256: sha256(manifestRaw),
        deliveryRoot: null,
        artifacts: [],
        schemaValid: false,
        forbiddenLiterals: [],
      };
    }

    const failed = validation.rows.filter((row) => row.status === "FAIL");
    const p0 = failed.filter((row) => row.severity === "P0").length;
    const p1 = failed.filter((row) => row.severity === "P1").length;
    const snapshotSha256 = sha256(fs.readFileSync(snapshotPath));
    const ledgerText = `${validation.rows.map((row) => stableJson(row)).join("\n")}\n`;
    const ledgerSha256 = sha256(ledgerText);
    const ledgerPath = path.join(outDir, "final-delivery-promotion-ledger.jsonl");
    writeExclusive(ledgerPath, ledgerText);

    const report: JsonRecord = {
      schema_version: REPORT_SCHEMA,
      status: failed.length === 0 ? "promoted" : "rejected",
      promotion_mode: "OFFLINE_ONLY",
      production_authority: false,
      delivery: {
        // Identity is projected only from a schema-valid manifest. A schema-invalid manifest is
        // untrusted content, so nothing from it is echoed into the reader-facing report.
        delivery_id: validation.schemaValid
          ? safeLabel(manifest?.delivery_id, 1, validation.forbiddenLiterals)
          : null,
        producer_id: validation.schemaValid
          ? safeLabel(manifest?.producer_id, 2, validation.forbiddenLiterals)
          : null,
        source_manifest: relativeToRepo(repoRoot, manifestPath),
        manifest_snapshot: relativeToRepo(repoRoot, snapshotPath),
        manifest_sha256: validation.manifestSha256,
        delivery_root: validation.deliveryRoot
          ? relativeToRepo(repoRoot, validation.deliveryRoot)
          : null,
      },
      counts: {
        checks: validation.rows.length,
        passed: validation.rows.length - failed.length,
        failed: failed.length,
        p0,
        p1,
        artifacts: validation.artifacts.length,
        network_dispatches: 0,
        database_dispatches: 0,
        cli_write_dispatches: 0,
        mutations: 0,
      },
      artifacts: validation.artifacts,
      evidence: {
        manifest_snapshot_sha256: snapshotSha256,
        ledger: relativeToRepo(repoRoot, ledgerPath),
        ledger_sha256: ledgerSha256,
      },
      failed_checks: failed.map((row) => row.check_id),
      ...stagePipeline,
    };
    const reportPath = path.join(outDir, "final-delivery-promotion-report.json");
    writeJsonExclusive(reportPath, report);

    let sealPayloadSha256: string | null = null;
    let sealPath: string | null = null;
    if (failed.length === 0 && manifest) {
      const artifactSet = validation.artifacts
        .map((artifact) => ({
          artifact_id: artifact.artifact_id,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
          rows: artifact.rows,
          schema: artifact.schema,
        }))
        .sort((left, right) => compareText(String(left.artifact_id), String(right.artifact_id)));
      const sealPayload = {
        schema_version: SEAL_SCHEMA,
        delivery_id: manifest.delivery_id,
        producer_id: manifest.producer_id,
        final_delivery_manifest_sha256: validation.manifestSha256,
        artifact_set_sha256: sha256(stableJson(artifactSet)),
        evidence: {
          manifest_snapshot_sha256: snapshotSha256,
          promotion_ledger_sha256: ledgerSha256,
          promotion_report_sha256: sha256(fs.readFileSync(reportPath)),
        },
        findings: { p0: 0, p1: 0 },
        effects: {
          network_dispatches: 0,
          database_dispatches: 0,
          cli_write_dispatches: 0,
          mutations: 0,
        },
        production_authority: false,
      };
      sealPayloadSha256 = sha256(stableJson(sealPayload));
      sealPath = path.join(outDir, "final-delivery-promotion-seal.json");
      writeJsonExclusive(sealPath, { ...sealPayload, seal_payload_sha256: sealPayloadSha256 });
    }

    return {
      status: report.status,
      report: relativeToRepo(repoRoot, reportPath),
      ledger: relativeToRepo(repoRoot, ledgerPath),
      seal: sealPath ? relativeToRepo(repoRoot, sealPath) : null,
      seal_payload_sha256: sealPayloadSha256,
      counts: report.counts,
    };
  }

  return { runFinalDeliveryPromote };
}
