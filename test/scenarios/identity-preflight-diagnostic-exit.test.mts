import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import {
  createIdentityPreflightBinding,
  sha256Text,
  validateIdentityPreflightExecution,
  validateIdentityPreflightEvidence,
} from "../../scripts/lib/identity-preflight-proof.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

for (const datasetType of ["flow", "process"] as const)
  test(`actual pinned CLI ${datasetType} offline manual-review diagnostic remains consumable`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-diagnostic-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cli = resolveInstalledTiangongLcaCliPackage();
    const target =
      datasetType === "process"
        ? {
            id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            version: "00.00.001",
            name_en: "shared process name",
            geography: "CN",
          }
        : {
            id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            version: "00.00.001",
            name: "Process gas",
            type_of_dataset: "Product flow",
            flow_property: "Mass",
            reference_unit: "kg",
          };
    const requestFile = path.join(root, "request.json"),
      outputDir = path.join(root, "output");
    const requestText = JSON.stringify({
      schema_version: 1,
      target,
      candidates: [
        {
          ...target,
          id: "11111111-2222-4333-8444-555555555555",
          geography: "US",
          flow_property: "Volume",
          reference_unit: "m3",
        },
      ],
    });
    fs.writeFileSync(requestFile, requestText);
    const startedAtMs = Date.now();
    const child = spawnSync(
      process.execPath,
      [
        cli.binPath,
        datasetType,
        "identity-preflight",
        "--input",
        requestFile,
        "--out-dir",
        outputDir,
        "--json",
        "--timeout-ms",
        "60000",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH }, shell: false },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
    assert.equal(child.stderr, "");
    const reportFile = path.join(outputDir, "outputs", "identity-decision.json");
    const report = JSON.parse(child.stdout);
    assert.equal(report.status, "needs_review");
    assert.equal(report.decision, "manual_review");
    assert.deepEqual(report.blockers, []);
    const binding = createIdentityPreflightBinding({
      datasetType,
      datasetId: target.id,
      datasetVersion: target.version,
      targetSha256: sha256Text(JSON.stringify(target)),
      requestText,
      semanticArgv: [datasetType, "identity-preflight", "--json", "--timeout-ms", "60000"],
      cli: {
        packageName: "@tiangong-lca/cli",
        packageVersion: cli.packageVersion,
        packageIntegrity: `sha256-${sha256Text(fs.readFileSync(cli.binPath, "utf8"))}`,
      },
      authReceipt: testAuthIdentityReceipt({ capturedAtUtc: new Date(startedAtMs).toISOString() }),
      relevantInputHashes: {},
    });
    const checked = validateIdentityPreflightExecution({
      binding,
      exitCode: child.status,
      stdoutText: child.stdout,
      diskReportText: fs.readFileSync(reportFile, "utf8"),
      startedAtMs,
      diskReportMtimeMs: fs.statSync(reportFile).mtimeMs,
      completedAtUtc: new Date().toISOString(),
      requestFile,
      outputDir,
      reportFile,
      stderrText: child.stderr,
      signal: child.signal,
    });
    assert.equal(checked.ok, true);
    assert.equal(checked.manifest.report.status, "needs_review");
    assert.equal(
      validateIdentityPreflightEvidence(checked.manifest, {
        requestText,
        reportText: fs.readFileSync(reportFile, "utf8"),
        datasetType,
        datasetId: target.id,
        datasetVersion: target.version,
        targetSha256: sha256Text(JSON.stringify(target)),
      }).ok,
      true,
    );
  });
