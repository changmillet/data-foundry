import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PROOF_A as proofA,
  PROOF_B as proofB,
  workbookBuffer,
} from "../fixtures/final-delivery-fixtures.ts";
import {
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  testTmpRoot,
  writeJson,
} from "../fixtures/foundry-core.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

type Fixture = {
  root: string;
  deliveryRoot: string;
  outDir: string;
  manifestPath: string;
  manifest: JsonRecord;
  paths: Record<string, string>;
};

function createFixture(name: string): Fixture {
  const root = testTmpRoot(`final-delivery-promotion-${name}`);
  const deliveryRoot = path.join(root, "delivery");
  const outDir = path.join(root, "promotion");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(deliveryRoot, { recursive: true });

  const paths = {
    summary: path.join(deliveryRoot, "summary.json"),
    evidence: path.join(deliveryRoot, "evidence.csv"),
    workbook: path.join(deliveryRoot, "review.xlsx"),
    reviewer: path.join(deliveryRoot, "reviewer.json"),
  };
  writeJson(paths.summary, {
    schema_version: "generic-summary.v1",
    declared_count: 2,
    rows: [
      { id: "item-1", status: "ready" },
      { id: "item-2", status: "ready" },
    ],
  });
  fs.writeFileSync(
    paths.evidence,
    `id,status,proof_sha\nitem-1,ready,${proofA}\nitem-2,ready,${proofB}\n`,
  );
  fs.writeFileSync(paths.workbook, workbookBuffer());
  const binding = (artifactId: string, filePath: string) => {
    const buffer = fs.readFileSync(filePath);
    return { artifact_id: artifactId, sha256: hashBuffer(buffer), bytes: buffer.byteLength };
  };
  // The report is bound to the exact reviewed bytes, so a later content change invalidates it.
  writeJson(paths.reviewer, {
    schema_version: "generic-independent-review.v1",
    status: "PASS",
    reviewer_id: "independent-reviewer",
    findings: { p0: 0, p1: 0 },
    reviewed_artifacts: [
      binding("summary", paths.summary),
      binding("evidence", paths.evidence),
      binding("workbook", paths.workbook),
    ],
  });

  function descriptor(
    artifactId: string,
    filePath: string,
    schema: string,
    rows: number,
    rowCount: JsonRecord,
  ): JsonRecord {
    const buffer = fs.readFileSync(filePath);
    return {
      artifact_id: artifactId,
      path: path.basename(filePath),
      sha256: hashBuffer(buffer),
      bytes: buffer.byteLength,
      rows,
      schema,
      row_count: rowCount,
    };
  }

  const manifest: JsonRecord = {
    schema_version: "foundry-final-delivery-manifest.v1",
    delivery_id: `generic-${name}`,
    producer_id: "generic-producer",
    delivery_root: ".",
    promotion_mode: "OFFLINE_ONLY",
    production_authority: false,
    findings: { p0: 0, p1: 0 },
    artifacts: [
      descriptor("summary", paths.summary, "generic-summary.v1", 2, { kind: "json-object-rows" }),
      descriptor("evidence", paths.evidence, "csv.generic-evidence.v1", 2, {
        kind: "csv",
        required_columns: ["id", "status", "proof_sha"],
      }),
      descriptor("workbook", paths.workbook, "xlsx.generic-review.v1", 2, { kind: "xlsx" }),
      descriptor("reviewer", paths.reviewer, "generic-independent-review.v1", 1, {
        kind: "json-object",
      }),
    ],
    algebra: [
      {
        check_id: "summary_rows_match",
        left: { artifact_rows: "summary" },
        operator: "eq",
        right: { literal: 2 },
      },
      {
        check_id: "evidence_rows_match",
        left: { artifact_rows: "evidence" },
        operator: "eq",
        right: { literal: 2 },
      },
      {
        check_id: "declared_count_closes",
        left: {
          artifact_json: { artifact_id: "summary", pointer: "/declared_count" },
        },
        operator: "eq",
        right: { artifact_rows: "summary" },
      },
    ],
    workbooks: [
      {
        artifact_id: "workbook",
        exact_sheet_names: ["Summary", "Evidence"],
        sheets: [
          {
            name: "Summary",
            header_row: 1,
            required_columns: ["id", "status", "proof_sha"],
            required_cells: [],
          },
          {
            name: "Evidence",
            header_row: 1,
            required_columns: ["id", "status", "proof_sha"],
            required_cells: [{ cell: "B2", equals: "ready" }],
          },
        ],
      },
    ],
    redaction: {
      artifact_ids: ["summary", "evidence", "workbook", "reviewer"],
      forbidden_literals: ["DO-NOT-SHIP"],
    },
    reviewers: [
      {
        reviewer_id: "independent-reviewer",
        artifact_id: "reviewer",
        required_artifact_ids: ["summary", "evidence", "workbook"],
      },
    ],
  };

  const manifestPath = path.join(deliveryRoot, "final-delivery-manifest.json");
  writeJson(manifestPath, manifest);
  return { root, deliveryRoot, outDir, manifestPath, manifest, paths };
}

function promote(fixture: Fixture) {
  return runFoundry([
    "final-delivery-promote",
    "--manifest",
    rel(fixture.manifestPath),
    "--out-dir",
    rel(fixture.outDir),
  ]);
}

function manifestRecords(fixture: Fixture): JsonRecord[] {
  return records(fixture.manifest.artifacts);
}

function descriptorOf(fixture: Fixture, artifactId: string): JsonRecord {
  const found = manifestRecords(fixture).find((item) => item.artifact_id === artifactId);
  assert.ok(found, artifactId);
  return found;
}

// Re-binds the reviewer report to freshly mutated artifact bytes, so a rejection vector that
// rewrites content still isolates the check it is aimed at.
function rebindReviewer(fixture: Fixture, artifactId: string): void {
  const reportPath = fixture.paths.reviewer;
  assert.ok(reportPath);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as JsonRecord;
  const target = fixture.paths[artifactId];
  assert.ok(target, artifactId);
  const buffer = fs.readFileSync(target);
  report.reviewed_artifacts = records(report.reviewed_artifacts).map((entry) =>
    entry.artifact_id === artifactId
      ? { ...entry, sha256: hashBuffer(buffer), bytes: buffer.byteLength }
      : entry,
  );
  writeJson(reportPath, report);
  const descriptor = descriptorOf(fixture, "reviewer");
  const reportBuffer = fs.readFileSync(reportPath);
  descriptor.sha256 = hashBuffer(reportBuffer);
  descriptor.bytes = reportBuffer.byteLength;
}

function sealPath(fixture: Fixture): string {
  return path.join(fixture.outDir, "final-delivery-promotion-seal.json");
}

test("final delivery promotion command has no dispatch or execution-authority surface", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts", "commands", "final-delivery-promotion.ts"),
    "utf8",
  );
  for (const forbidden of [
    "node:child_process",
    "node:http",
    "node:https",
    "node:net",
    "fetch(",
    "spawn(",
    "exec(",
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected dispatch surface: ${forbidden}`);
  }
  // A final-delivery seal is offline validation evidence, not an execution-authorization capsule.
  for (const capsule of ["foundry-execution-attempt", "execution-capsule", "executable_input"]) {
    assert.equal(source.includes(capsule), false, `must not reuse capsule authority: ${capsule}`);
  }
});

test("final delivery promotion emits a detached immutable seal for exact evidence", () => {
  const fixture = createFixture("pass");
  const result = promote(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "promoted");
  assert.equal(result.json.counts.p0, 0);
  assert.equal(result.json.counts.p1, 0);
  assert.equal(result.json.counts.network_dispatches, 0);
  assert.equal(result.json.counts.database_dispatches, 0);
  assert.equal(result.json.counts.cli_write_dispatches, 0);
  assert.equal(result.json.counts.mutations, 0);

  const report = record(
    readJson(path.join(fixture.outDir, "final-delivery-promotion-report.json")),
  );
  const seal = record(readJson(sealPath(fixture)));
  const ledger = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  );
  assert.equal(report.status, "promoted");
  assert.equal(report.remote_write_mode, "read-only");
  assert.equal(report.production_authority, false);
  assert.ok(ledger.length > 0);
  assert.equal(ledger.filter((row) => row.status === "FAIL").length, 0);
  assert.equal(seal.findings ? record(seal.findings).p0 : null, 0);
  assert.equal(record(seal.effects).network_dispatches, 0);
  assert.equal(seal.production_authority, false);
  assert.equal(typeof seal.seal_payload_sha256, "string");
  assert.match(String(seal.final_delivery_manifest_sha256), /^[a-f0-9]{64}$/u);

  // The seal binds the exact artifact set, and the manifest snapshot is byte-identical.
  const snapshot = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-manifest-snapshot.json"),
  );
  assert.equal(
    hashBuffer(snapshot),
    hashBuffer(fs.readFileSync(fixture.manifestPath)),
    "snapshot must be the exact manifest bytes",
  );
  assert.equal(seal.final_delivery_manifest_sha256, hashBuffer(snapshot));

  // The seal must carry real 64-hex hashes, not a stringified object placeholder.
  const sealEvidence = record(seal.evidence);
  for (const key of [
    "manifest_snapshot_sha256",
    "promotion_ledger_sha256",
    "promotion_report_sha256",
  ]) {
    assert.equal(typeof sealEvidence[key], "string", key);
    assert.match(String(sealEvidence[key]), /^[a-f0-9]{64}$/u, key);
  }
  assert.equal(sealEvidence.manifest_snapshot_sha256, hashBuffer(snapshot));
  assert.match(String(seal.seal_payload_sha256), /^[a-f0-9]{64}$/u);
});

const rejectionVectors: Array<{ name: string; mutate: (fixture: Fixture) => void }> = [
  {
    name: "delivery-root-traversal",
    mutate: (fixture) => {
      fixture.manifest.delivery_root = "../escaped";
    },
  },
  {
    name: "artifact-hash-drift",
    mutate: (fixture) => {
      descriptorOf(fixture, "summary").sha256 = "0".repeat(64);
    },
  },
  {
    name: "artifact-byte-count-drift",
    mutate: (fixture) => {
      const descriptor = descriptorOf(fixture, "evidence");
      descriptor.bytes = Number(descriptor.bytes) + 1;
    },
  },
  {
    name: "artifact-path-not-normalized",
    mutate: (fixture) => {
      descriptorOf(fixture, "summary").path = "./summary.json";
    },
  },
  {
    name: "artifact-symlink",
    mutate: (fixture) => {
      const link = path.join(fixture.deliveryRoot, "linked.csv");
      fs.symlinkSync(fixture.paths.evidence, link);
      descriptorOf(fixture, "evidence").path = "linked.csv";
    },
  },
  {
    name: "row-count-mismatch",
    mutate: (fixture) => {
      descriptorOf(fixture, "evidence").rows = 3;
    },
  },
  {
    name: "algebra-mismatch",
    mutate: (fixture) => {
      const algebra = records(fixture.manifest.algebra);
      const target = algebra.find((item) => item.check_id === "declared_count_closes");
      assert.ok(target);
      target.right = { literal: 7 };
    },
  },
  {
    name: "missing-workbook-sheet",
    mutate: (fixture) => {
      const workbook = records(fixture.manifest.workbooks)[0];
      assert.ok(workbook);
      workbook.exact_sheet_names = ["Summary"];
    },
  },
  {
    name: "extra-workbook-sheet",
    mutate: (fixture) => {
      const workbook = records(fixture.manifest.workbooks)[0];
      assert.ok(workbook);
      workbook.exact_sheet_names = ["Summary", "Evidence", "Extra"];
    },
  },
  {
    name: "missing-proof-column",
    mutate: (fixture) => {
      const workbook = records(fixture.manifest.workbooks)[0];
      assert.ok(workbook);
      const sheets = records(workbook.sheets);
      const sheet = sheets.find((item) => item.name === "Evidence");
      assert.ok(sheet);
      sheet.required_columns = ["id", "status", "absent_column"];
    },
  },
  {
    name: "secret-like-content",
    mutate: (fixture) => {
      fs.writeFileSync(
        fixture.paths.evidence,
        `id,status,proof_sha\nitem-1,ready,${proofA}\nsecret,AKIAIOSFODNN7EXAMPLE,x\n`,
      );
      const descriptor = descriptorOf(fixture, "evidence");
      const buffer = fs.readFileSync(fixture.paths.evidence);
      descriptor.sha256 = hashBuffer(buffer);
      descriptor.bytes = buffer.byteLength;
      rebindReviewer(fixture, "evidence");
    },
  },
  {
    name: "secret-like-workbook-cell",
    mutate: (fixture) => {
      fs.writeFileSync(fixture.paths.workbook, workbookBuffer("AKIAIOSFODNN7EXAMPLE"));
      const descriptor = descriptorOf(fixture, "workbook");
      const buffer = fs.readFileSync(fixture.paths.workbook);
      descriptor.sha256 = hashBuffer(buffer);
      descriptor.bytes = buffer.byteLength;
      rebindReviewer(fixture, "workbook");
    },
  },
  {
    name: "redaction-coverage-omission",
    mutate: (fixture) => {
      const redaction = record(fixture.manifest.redaction);
      redaction.artifact_ids = ["summary", "evidence"];
    },
  },
  {
    name: "reviewer-coverage-unknown-artifact",
    mutate: (fixture) => {
      const reviewer = records(fixture.manifest.reviewers)[0];
      assert.ok(reviewer);
      reviewer.required_artifact_ids = ["summary", "ghost-artifact"];
    },
  },
  {
    name: "reviewer-failure",
    mutate: (fixture) => {
      const report = JSON.parse(fs.readFileSync(fixture.paths.reviewer, "utf8")) as JsonRecord;
      report.status = "FAIL";
      report.findings = { p0: 1, p1: 0 };
      writeJson(fixture.paths.reviewer, report);
      const descriptor = descriptorOf(fixture, "reviewer");
      const buffer = fs.readFileSync(fixture.paths.reviewer);
      descriptor.sha256 = hashBuffer(buffer);
      descriptor.bytes = buffer.byteLength;
    },
  },
  {
    name: "workbook-crc-drift",
    mutate: (fixture) => {
      const buffer = fs.readFileSync(fixture.paths.workbook);
      const mutated = Buffer.from(buffer);
      const first = mutated.indexOf(Buffer.from("ready"));
      mutated[first] = "r".charCodeAt(0) === 114 ? 115 : 114;
      fs.writeFileSync(fixture.paths.workbook, mutated);
      const descriptor = descriptorOf(fixture, "workbook");
      descriptor.sha256 = hashBuffer(mutated);
      descriptor.bytes = mutated.byteLength;
      rebindReviewer(fixture, "workbook");
    },
  },
  {
    name: "invalid-workbook",
    mutate: (fixture) => {
      const buffer = Buffer.from("not a workbook at all", "utf8");
      fs.writeFileSync(fixture.paths.workbook, buffer);
      const descriptor = descriptorOf(fixture, "workbook");
      descriptor.sha256 = hashBuffer(buffer);
      descriptor.bytes = buffer.byteLength;
      rebindReviewer(fixture, "workbook");
    },
  },
];

for (const vector of rejectionVectors) {
  test(`final delivery promotion rejects ${vector.name}`, () => {
    const fixture = createFixture(vector.name);
    vector.mutate(fixture);
    writeJson(fixture.manifestPath, fixture.manifest);
    const result = promote(fixture);
    assert.equal(result.json.status, "rejected", vector.name);
    assert.ok(Number(result.json.counts.failed) > 0, `${vector.name} must record failed checks`);
    assert.equal(fs.existsSync(sealPath(fixture)), false, `${vector.name} must not seal`);
    assert.equal(result.json.seal, null);
  });
}

test("final delivery promotion refuses to overwrite immutable output", () => {
  const fixture = createFixture("immutable");
  const first = promote(fixture);
  assert.equal(first.json.status, "promoted");
  const sealBytes = fs.readFileSync(sealPath(fixture));
  const second = spawnSync(
    process.execPath,
    [
      "scripts/foundry.ts",
      "final-delivery-promote",
      "--manifest",
      rel(fixture.manifestPath),
      "--out-dir",
      rel(fixture.outDir),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already exists and is immutable/u);
  assert.equal(fs.existsSync(sealPath(fixture)), true, "prior evidence must be preserved");
  assert.deepEqual(fs.readFileSync(sealPath(fixture)), sealBytes);
});

test("a promotion is rejected when a reviewer binding no longer matches the promoted bytes", () => {
  const fixture = createFixture("stale-review");
  // The reviewed evidence changes and the manifest hash is updated, but the PASS report is reused.
  fs.writeFileSync(
    fixture.paths.evidence,
    `id,status,proof_sha\ni1,ready,${proofA}\ni2,ready,${proofB}\nTAMPERED,ready,x\n`,
  );
  const buffer = fs.readFileSync(fixture.paths.evidence);
  const descriptor = descriptorOf(fixture, "evidence");
  descriptor.sha256 = hashBuffer(buffer);
  descriptor.bytes = buffer.byteLength;
  descriptor.rows = 3;
  writeJson(fixture.manifestPath, fixture.manifest);

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected", "a stale PASS report cannot promote new bytes");
  assert.equal(fs.existsSync(sealPath(fixture)), false);
  const ledger = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  );
  assert.equal(
    ledger.find((row) => row.check_id === "reviewer_content_binding:independent-reviewer")?.status,
    "FAIL",
  );
});

test("a reviewer report must bind an explicit content set, not just artifact ids", () => {
  const variants: Array<[string, (report: JsonRecord) => void]> = [
    [
      "no content binding at all",
      (report) => {
        delete report.reviewed_artifacts;
      },
    ],
    [
      "unknown artifact identity",
      (report) => {
        const scope = records(report.reviewed_artifacts);
        scope[0] = { artifact_id: "ghost-artifact", sha256: "0".repeat(64), bytes: 1 };
        report.reviewed_artifacts = scope;
      },
    ],
    [
      "duplicate artifact identity",
      (report) => {
        const scope = records(report.reviewed_artifacts);
        scope[1] = { ...scope[1], artifact_id: "summary" };
        report.reviewed_artifacts = scope;
      },
    ],
    [
      "reviewer binds its own report",
      (report) => {
        const scope = records(report.reviewed_artifacts);
        scope.push({ artifact_id: "reviewer", sha256: "0".repeat(64), bytes: 1 });
        report.reviewed_artifacts = scope;
      },
    ],
    [
      "required artifact left uncovered",
      (report) => {
        report.reviewed_artifacts = records(report.reviewed_artifacts).filter(
          (entry) => entry.artifact_id !== "workbook",
        );
      },
    ],
    [
      "malformed binding entry",
      (report) => {
        const scope = records(report.reviewed_artifacts);
        scope[0] = { artifact_id: "summary", sha256: "not-a-hash", bytes: -1 };
        report.reviewed_artifacts = scope;
      },
    ],
  ];
  for (const [label, mutate] of variants) {
    const fixture = createFixture(`review-binding-${label.replaceAll(" ", "-")}`);
    const report = JSON.parse(fs.readFileSync(fixture.paths.reviewer, "utf8")) as JsonRecord;
    mutate(report);
    writeJson(fixture.paths.reviewer, report);
    const descriptor = descriptorOf(fixture, "reviewer");
    const buffer = fs.readFileSync(fixture.paths.reviewer);
    descriptor.sha256 = hashBuffer(buffer);
    descriptor.bytes = buffer.byteLength;
    writeJson(fixture.manifestPath, fixture.manifest);
    const result = promote(fixture);
    assert.equal(result.json.status, "rejected", label);
    assert.equal(fs.existsSync(sealPath(fixture)), false, label);
  }
});

test("a manifest that violates its own schema is rejected without reflecting its content", () => {
  const fixture = createFixture("schema-violation");
  const secretLike = "AKIAIOSFODNN7EXAMPLE";
  // A type violation that the per-field checks would never look at.
  fixture.manifest.delivery_id = { unexpected: secretLike };
  writeJson(fixture.manifestPath, fixture.manifest);

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected");
  assert.equal(fs.existsSync(sealPath(fixture)), false);

  const ledgerText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl"),
    "utf8",
  );
  const reportText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-report.json"),
    "utf8",
  );
  assert.equal(ledgerText.includes(secretLike), false, "the ledger must not echo manifest content");
  assert.equal(reportText.includes(secretLike), false, "the report must not echo manifest content");

  const row = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  ).find((entry) => entry.check_id === "manifest_schema_valid");
  assert.equal(row?.status, "FAIL");
  const evidence = record(row?.evidence);
  assert.ok(Number(evidence.error_count) > 0);
  const findings = records(evidence.findings);
  assert.ok(findings.length > 0);
  for (const finding of findings) {
    assert.equal(typeof finding.category, "string");
    assert.equal(typeof finding.locator, "string");
    // Only a keyword and an instance location are carried, never a value or a message.
    assert.deepEqual(Object.keys(finding).sort(), ["category", "locator"]);
  }
});

test("a valid manifest still satisfies the published schema", () => {
  const fixture = createFixture("schema-valid");
  const result = promote(fixture);
  assert.equal(result.json.status, "promoted");
  const row = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  ).find((entry) => entry.check_id === "manifest_schema_valid");
  assert.equal(row?.status, "PASS");
});

test("a parse failure records a stable category without echoing artifact text", () => {
  const fixture = createFixture("parse-leak");
  const secretLike = "AKIAIOSFODNN7EXAMPLE";
  // Invalid JSON that also contains credential-shaped text, so a raw parser message would leak.
  const bytes = Buffer.from(`{ "note": "password='${secretLike}'", `, "utf8");
  fs.writeFileSync(fixture.paths.summary, bytes);
  const descriptor = descriptorOf(fixture, "summary");
  descriptor.sha256 = hashBuffer(bytes);
  descriptor.bytes = bytes.byteLength;
  writeJson(fixture.manifestPath, fixture.manifest);

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected");

  const ledgerText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl"),
    "utf8",
  );
  const reportText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-report.json"),
    "utf8",
  );
  assert.equal(ledgerText.includes(secretLike), false, "the ledger must not echo artifact text");
  assert.equal(reportText.includes(secretLike), false, "the report must not echo artifact text");

  const row = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  ).find((entry) => String(entry.check_id).startsWith("artifact_parse:summary"));
  assert.equal(row?.status, "FAIL");
  assert.equal(typeof record(row?.evidence).category, "string");
  assert.match(String(record(row?.evidence).category), /^artifact_/u);
});

test("secret-shaped workbook labels are never echoed into the ledger or report", () => {
  const fixture = createFixture("secret-workbook-labels");
  const secretLike = "AKIAIOSFODNN7EXAMPLE";
  // A sheet name, a required column and a control-cell value that all fail their checks and all
  // carry credential-shaped text.
  const workbook = records(fixture.manifest.workbooks)[0];
  assert.ok(workbook);
  workbook.exact_sheet_names = [secretLike, "Evidence"];
  const sheets = records(workbook.sheets);
  const summarySheet = sheets.find((sheet) => sheet.name === "Summary");
  assert.ok(summarySheet);
  summarySheet.required_columns = [secretLike, "status", "proof_sha"];
  const evidenceSheet = sheets.find((sheet) => sheet.name === "Evidence");
  assert.ok(evidenceSheet);
  evidenceSheet.required_cells = [{ cell: "B2", equals: secretLike }];
  writeJson(fixture.manifestPath, fixture.manifest);

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected");

  const ledgerText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl"),
    "utf8",
  );
  const reportText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-report.json"),
    "utf8",
  );
  assert.equal(ledgerText.includes(secretLike), false, "the ledger must not echo the label");
  assert.equal(reportText.includes(secretLike), false, "the report must not echo the label");
  assert.equal(
    fs
      .readFileSync(path.join(fixture.outDir, "final-delivery-manifest-snapshot.json"), "utf8")
      .includes(secretLike),
    true,
    "the snapshot is the exact manifest bytes and is expected to contain it",
  );

  // The failure is still navigable: ordinals, counts and digests remain.
  const rows = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  );
  const sheetNames = rows.find((row) => String(row.check_id).startsWith("workbook_sheet_names:"));
  assert.equal(sheetNames?.status, "FAIL");
  const sheetEvidence = record(sheetNames?.evidence);
  assert.equal(sheetEvidence.expected_count, 2);
  assert.equal(sheetEvidence.first_mismatch_ordinal, 1);
  assert.match(String(sheetEvidence.expected_sha256), /^[a-f0-9]{64}$/u);
  const columns = rows.find((row) => String(row.check_id).startsWith("workbook_required_columns:"));
  assert.equal(columns?.status, "FAIL");
  assert.equal(record(columns?.evidence).matched_count, 2);
  const controlCell = rows.find((row) =>
    String(row.check_id).startsWith("workbook_required_cell:"),
  );
  assert.equal(controlCell?.status, "FAIL");
  assert.equal(record(controlCell?.evidence).cell, "B2");
  assert.match(String(record(controlCell?.evidence).expected_sha256), /^[a-f0-9]{64}$/u);
});

test("a secret-shaped manifest identity is not echoed even when the manifest is schema-valid", () => {
  const fixture = createFixture("secret-identity");
  const secretLike = "AKIAIOSFODNN7EXAMPLE";
  fixture.manifest.delivery_id = `delivery-${secretLike}`;
  fixture.manifest.producer_id = `producer-${secretLike}`;
  writeJson(fixture.manifestPath, fixture.manifest);

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected", "the manifest redaction check must fail");
  const reportText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-report.json"),
    "utf8",
  );
  const ledgerText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl"),
    "utf8",
  );
  assert.equal(reportText.includes(secretLike), false, "the report must not echo the identity");
  assert.equal(ledgerText.includes(secretLike), false, "the ledger must not echo the identity");
  const report = record(
    readJson(path.join(fixture.outDir, "final-delivery-promotion-report.json")),
  );
  assert.match(String(record(report.delivery).delivery_id), /^#1:[a-f0-9]{12}$/u);
  assert.match(String(record(report.delivery).producer_id), /^#2:[a-f0-9]{12}$/u);
});

test("a stale extra reviewer binding is rejected even when every required artifact matches", () => {
  const fixture = createFixture("extra-binding");
  const report = JSON.parse(fs.readFileSync(fixture.paths.reviewer, "utf8")) as JsonRecord;
  // Every required artifact stays correctly bound and covered; one voluntarily-included binding
  // carries a wrong digest.
  const scope = records(report.reviewed_artifacts);
  scope[0] = { ...scope[0], sha256: "0".repeat(64), bytes: 1 };
  report.reviewed_artifacts = scope;
  writeJson(fixture.paths.reviewer, report);
  const descriptor = descriptorOf(fixture, "reviewer");
  const buffer = fs.readFileSync(fixture.paths.reviewer);
  descriptor.sha256 = hashBuffer(buffer);
  descriptor.bytes = buffer.byteLength;
  writeJson(fixture.manifestPath, fixture.manifest);

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected");
  const rows = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  );
  const binding = rows.find((row) => String(row.check_id).startsWith("reviewer_content_binding:"));
  assert.equal(
    binding?.status,
    "FAIL",
    "every declared binding must match, not only the required ones",
  );
  assert.equal(
    rows.find((row) => String(row.check_id).startsWith("reviewer_coverage:"))?.status,
    "PASS",
    "coverage of the required set is still satisfied, so only the binding check may fail",
  );
});

test("an unparseable manifest records a stable code without echoing its text", () => {
  const fixture = createFixture("manifest-parse-leak");
  const secretLike = "AKIAIOSFODNN7EXAMPLE";
  // A bare token is not valid JSON, and the parser message echoes the offending text.
  fs.writeFileSync(fixture.manifestPath, secretLike);

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected");
  const ledgerText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl"),
    "utf8",
  );
  const reportText = fs.readFileSync(
    path.join(fixture.outDir, "final-delivery-promotion-report.json"),
    "utf8",
  );
  assert.equal(ledgerText.includes(secretLike), false, "the ledger must not echo manifest text");
  assert.equal(reportText.includes(secretLike), false, "the report must not echo manifest text");

  const row = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  ).find((entry) => entry.check_id === "promotion_validator_error");
  assert.equal(row?.status, "FAIL");
  assert.equal(record(row?.evidence).category, "manifest_unparseable");
});

test("an escaped secret in the manifest cannot bypass the manifest redaction scan", () => {
  const fixture = createFixture("manifest-escaped-secret");
  const secretLike = "AKIAIOSFODNN7EXAMPLE";
  // Rewrite only the identity value, encoding it so the raw bytes never contain the literal.
  const raw = fs.readFileSync(fixture.manifestPath, "utf8");
  const escaped = [...`delivery-${secretLike}`]
    .map((character, index) =>
      index >= 9 && index < 13
        ? `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
        : character,
    )
    .join("");
  fs.writeFileSync(
    fixture.manifestPath,
    raw.replace(/("delivery_id":\s*")[^"]*(")/u, `$1${escaped}$2`),
  );
  const rewritten = fs.readFileSync(fixture.manifestPath, "utf8");
  assert.equal(rewritten.includes(secretLike), false, "the raw bytes must hide the literal");
  assert.equal(
    String((JSON.parse(rewritten) as JsonRecord).delivery_id).includes(secretLike),
    true,
    "the decoded identity is the literal that must be caught",
  );

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected");
  const row = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  ).find((entry) => entry.check_id === "redaction:manifest");
  assert.equal(row?.status, "FAIL", "the decoded manifest must be scanned");
  assert.deepEqual(record(row?.evidence).finding_codes, ["AWS_ACCESS_KEY"]);
});

test("declaring a literal as forbidden does not make the manifest self-report", () => {
  const fixture = createFixture("manifest-forbidden-self");
  const redaction = record(fixture.manifest.redaction);
  redaction.forbidden_literals = ["AKIAIOSFODNN7EXAMPLE"];
  writeJson(fixture.manifestPath, fixture.manifest);

  const result = promote(fixture);
  assert.equal(result.json.status, "promoted", "a declared forbidden literal is the contract");
  const row = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  ).find((entry) => entry.check_id === "redaction:manifest");
  assert.equal(row?.status, "PASS");
});

test("a declared forbidden literal used elsewhere in the manifest is rejected", () => {
  const fixture = createFixture("manifest-custom-literal");
  const custom = "CUSTOM-SECRET-9f2a";
  // Declaring the literal is the contract; reusing it as identity content is a real leak.
  fixture.manifest.delivery_id = `delivery-${custom}`;
  const redaction = record(fixture.manifest.redaction);
  redaction.forbidden_literals = [custom];
  writeJson(fixture.manifestPath, fixture.manifest);

  const result = promote(fixture);
  assert.equal(result.json.status, "rejected");
  const row = records(
    readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl")),
  ).find((entry) => entry.check_id === "redaction:manifest");
  assert.equal(row?.status, "FAIL");
  assert.deepEqual(record(row?.evidence).finding_codes, ["FORBIDDEN_LITERAL_1"]);
});
