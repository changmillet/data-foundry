import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { constants as osConstants } from "node:os";
import path from "node:path";
import process from "node:process";
import { stableJson } from "../lib/identity-preflight-proof.ts";
import {
  MAX_CHILD_OUTPUT_BYTES,
  fail,
  isRecord,
  readRegularFile,
  token,
  type ArtifactFact,
  type JsonRecord,
} from "./production-contact-draft-runtime.ts";

export function contactPayload(id: string, now: Date): JsonRecord {
  const name = `TianGong LCA production TDD contact ${id.slice(0, 8)}`;
  const localized = { "@xml:lang": "en", "#text": name };
  const dataSetFormatReference = {
    "@type": "source data set",
    "@refObjectId": "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    "@version": "03.00.003",
    "@uri": "../sources/a97a0155-0234-4b87-b4ce-a45da52f2a40_03.00.003.xml",
    "common:shortDescription": { "@xml:lang": "en", "#text": "ILCD format" },
  };
  const ownershipReference = {
    "@type": "contact data set",
    "@refObjectId": id,
    "@version": "00.00.001",
    "@uri": `../contacts/${id}_00.00.001.xml`,
    "common:shortDescription": localized,
  };
  return {
    contactDataSet: {
      "@version": "1.1",
      "@xmlns": "http://lca.jrc.it/ILCD/Contact",
      "@xmlns:common": "http://lca.jrc.it/ILCD/Common",
      "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "@xsi:schemaLocation": "http://lca.jrc.it/ILCD/Contact ../../schemas/ILCD_ContactDataSet.xsd",
      contactInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:shortName": localized,
          "common:name": localized,
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "2", "#text": "Organisations" },
                { "@level": "1", "@classId": "2.4", "#text": "Other organisations" },
              ],
            },
          },
          centralContactPoint: localized,
          contactDescriptionOrComment: {
            "@xml:lang": "en",
            "#text":
              "Isolated, unreviewed and unpublished production-account draft created by the Foundry TDD case.",
          },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:timeStamp": now.toISOString(),
          "common:referenceToDataSetFormat": dataSetFormatReference,
        },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:permanentDataSetURI": `https://lcdn.tiangong.earth/datasetdetail/contact.xhtml?uuid=${id}&version=00.00.001`,
          "common:referenceToOwnershipOfDataSet": ownershipReference,
        },
      },
    },
  };
}

export function contactRootProbe(id: string): JsonRecord {
  return {
    contactDataSet: {
      contactInformation: { dataSetInformation: { "common:UUID": id } },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

export function parseSingleJsonLine(stdout: string, stage: string): JsonRecord {
  if (Buffer.byteLength(stdout, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
    return fail(`CLI output exceeded the limit at ${stage}.`, "CASE_CHILD_OUTPUT_TOO_LARGE");
  }
  const lines = stdout.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 1 || !lines[0]) {
    return fail(`CLI did not emit one JSON line at ${stage}.`, "CASE_CHILD_STDOUT_INVALID");
  }
  try {
    const value = JSON.parse(lines[0]);
    if (!isRecord(value)) throw new Error("not an object");
    return value;
  } catch {
    return fail(`CLI emitted invalid JSON at ${stage}.`, "CASE_CHILD_STDOUT_INVALID");
  }
}

export function safeChildCode(stderr: string): string {
  if (Buffer.byteLength(stderr, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
    return "CASE_CHILD_OUTPUT_TOO_LARGE";
  }
  try {
    const value = JSON.parse(stderr);
    const code = isRecord(value) && isRecord(value.error) ? token(value.error.code) : null;
    return code && /^[A-Z0-9_]+$/u.test(code) ? code : "CASE_CHILD_FAILED";
  } catch {
    return "CASE_CHILD_FAILED";
  }
}

export function signalExitCode(signal: NodeJS.Signals): number {
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

export function containsSecretMaterial(value: string, secrets: string[]): boolean {
  return redactCredentialText(value, secrets) !== value;
}

export function redactCredentialText(value: string, references: string[]): string {
  let text = value;
  for (const reference of references.filter(Boolean))
    text = text.replaceAll(reference, "[REDACTED]");
  // The CLI owns session contents. Detect structured credentials without reading that store.
  return text
    .replace(
      /("(?:access_token|refresh_token|password|authorization|cookie|set-cookie)"\s*:\s*)"(?:[^"\\]|\\.)*"/giu,
      '$1"[REDACTED]"',
    )
    .replace(/\bBearer [A-Za-z0-9._~+/-]+=*/gu, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED]");
}

export function fileFact(filePath: string, relativeTo: string): ArtifactFact {
  const bytes = readRegularFile(filePath);
  return {
    path: path.relative(relativeTo, filePath).replaceAll("\\", "/"),
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function requireDiskReport(
  reportPath: string,
  stdoutReport: JsonRecord,
  stage: string,
): ArtifactFact {
  if (!existsSync(reportPath)) {
    return fail(`CLI disk report is missing at ${stage}.`, "CASE_DISK_REPORT_MISSING");
  }
  let diskReport: unknown;
  try {
    diskReport = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return fail(`CLI disk report is invalid at ${stage}.`, "CASE_DISK_REPORT_INVALID");
  }
  if (stableJson(diskReport) !== stableJson(stdoutReport)) {
    return fail(`CLI stdout and disk report differ at ${stage}.`, "CASE_DISK_REPORT_MISMATCH");
  }
  return fileFact(reportPath, path.dirname(path.dirname(reportPath)));
}

function exactInput(report: JsonRecord, inputPath: string, stage: string): void {
  if (path.resolve(token(report.input_path) ?? "") !== inputPath) {
    return fail(`CLI report input drifted at ${stage}.`, "CASE_INPUT_MISMATCH");
  }
}

function numberAt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(`Expected numeric ${label}.`, "CASE_REPORT_INVALID");
  }
  return value;
}

function recordAt(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) return fail(`Expected object ${label}.`, "CASE_REPORT_INVALID");
  return value;
}

function arrayAt(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return fail(`Expected array ${label}.`, "CASE_REPORT_INVALID");
  return value;
}

export function validateValidationReport(report: JsonRecord, inputPath: string): void {
  exactInput(report, inputPath, "offline-validate");
  const counts = recordAt(report.counts, "validation counts");
  if (
    report.status !== "completed" ||
    report.requested_type !== "contact" ||
    numberAt(counts.total, "validation total") !== 1 ||
    numberAt(counts.valid, "validation valid") !== 1 ||
    numberAt(counts.invalid, "validation invalid") !== 0 ||
    numberAt(recordAt(counts.by_type, "validation by_type").contact, "contact count") !== 1
  ) {
    return fail(
      "Offline contact validation did not pass exactly one row.",
      "CASE_OFFLINE_VALIDATE_FAILED",
    );
  }
}

export function validateDryRun(report: JsonRecord, inputPath: string): void {
  exactInput(report, inputPath, "offline-save-draft-dry-run");
  const counts = recordAt(report.counts, "dry-run counts");
  if (
    report.status !== "completed" ||
    report.mode !== "dry_run" ||
    report.commit !== false ||
    report.requested_type !== "contact" ||
    numberAt(counts.selected, "dry-run selected") !== 1 ||
    numberAt(counts.prepared, "dry-run prepared") !== 1 ||
    numberAt(counts.executed, "dry-run executed") !== 0 ||
    numberAt(counts.failed, "dry-run failed") !== 0
  ) {
    return fail(
      "Contact save-draft dry-run did not prepare exactly one row.",
      "CASE_DRY_RUN_FAILED",
    );
  }
}

export function validatePublicFlowRead(report: JsonRecord): void {
  const filters = recordAt(report.filters, "flow list filters");
  const rows = arrayAt(report.rows, "flow list rows");
  if (
    report.status !== "listed_remote_flows" ||
    stableJson(filters.requested_state_codes) !== "[100]" ||
    numberAt(filters.limit, "flow list limit") !== 1 ||
    numberAt(report.count, "flow list count") !== rows.length ||
    rows.length !== 1 ||
    rows.some((row) => !isRecord(row) || row.state_code !== 100)
  ) {
    return fail(
      "Public flow read was not the exact bounded state-100 case.",
      "CASE_PUBLIC_READ_FAILED",
    );
  }
}

export function validateSelfDraftRead(report: JsonRecord, userId: string): void {
  const filters = recordAt(report.filters, "process list filters");
  const rows = arrayAt(report.rows, "process list rows");
  if (
    report.status !== "listed_remote_processes" ||
    filters.requested_user_id !== userId ||
    stableJson(filters.requested_state_codes) !== "[0]" ||
    numberAt(filters.limit, "process list limit") !== 1 ||
    numberAt(report.count, "process list count") !== rows.length ||
    rows.length > 1 ||
    rows.some((row) => !isRecord(row) || row.user_id !== userId || row.state_code !== 0)
  ) {
    return fail(
      "Self-draft read escaped the exact owner/state scope.",
      "CASE_SELF_DRAFT_READ_FAILED",
    );
  }
}

export function readChecks(filePath: string): JsonRecord[] {
  if (!existsSync(filePath)) {
    return fail("Remote verification checks are missing.", "CASE_CHECKS_MISSING");
  }
  const text = readFileSync(filePath, "utf8").trim();
  try {
    return text
      ? text.split(/\r?\n/u).map((line) => {
          const value = JSON.parse(line);
          if (!isRecord(value)) throw new Error("not object");
          return value;
        })
      : [];
  } catch {
    return fail("Remote verification checks are invalid.", "CASE_CHECKS_INVALID");
  }
}

export function validatePrewriteVerify(
  report: JsonRecord,
  checks: JsonRecord[],
  inputPath: string,
  contactId: string,
): void {
  exactInput(report, inputPath, "prewrite-verify");
  const counts = recordAt(report.counts, "prewrite counts");
  const blockers = arrayAt(report.blockers, "prewrite blockers");
  const roots = checks.filter(
    (check) => check.role === "root" && !String(check.path ?? "").endsWith("#readback"),
  );
  const root = roots[0];
  if (
    report.status !== "passed_remote_verification" ||
    report.root_policy !== "candidate" ||
    numberAt(counts.blockers, "prewrite blockers") !== 0 ||
    blockers.length !== 0 ||
    roots.length !== 1 ||
    root?.row_index !== 0 ||
    root.table !== "contacts" ||
    root.id !== contactId ||
    root.version !== "00.00.001" ||
    root.status !== "ok" ||
    root.exact_version !== null ||
    root.latest_version !== null ||
    checks.some((check) => check.status !== "ok")
  ) {
    return fail(
      "Prewrite verification did not prove a unique absent contact candidate.",
      "CASE_PREWRITE_COLLISION",
    );
  }
}

export function validateCommit(report: JsonRecord, inputPath: string, contactId: string): void {
  exactInput(report, inputPath, "commit");
  const counts = recordAt(report.counts, "commit counts");
  const rows = arrayAt(report.rows, "commit rows");
  const row = rows[0];
  if (
    report.status !== "completed" ||
    report.mode !== "commit" ||
    report.commit !== true ||
    report.requested_type !== "contact" ||
    numberAt(counts.selected, "commit selected") !== 1 ||
    numberAt(counts.executed, "commit executed") !== 1 ||
    numberAt(counts.failed, "commit failed") !== 0 ||
    rows.length !== 1 ||
    !isRecord(row) ||
    row.id !== contactId ||
    row.version !== "00.00.001" ||
    row.type !== "contact" ||
    row.table !== "contacts" ||
    row.status !== "executed" ||
    !["insert", "save_draft", "recovered_exact_readback"].includes(String(row.operation))
  ) {
    return fail("Contact commit did not prove exactly one successful row.", "CASE_COMMIT_FAILED");
  }
}

export function validatePostwriteVerify(
  report: JsonRecord,
  checks: JsonRecord[],
  inputPath: string,
  contactId: string,
  userId: string,
  payloadSha256: string,
): void {
  exactInput(report, inputPath, "postwrite-verify");
  const counts = recordAt(report.counts, "postwrite counts");
  const blockers = arrayAt(report.blockers, "postwrite blockers");
  const readbacks = checks.filter(
    (check) => check.role === "root" && String(check.path ?? "").endsWith("#readback"),
  );
  const readback = readbacks[0];
  if (
    report.status !== "passed_remote_verification" ||
    report.root_policy !== "candidate" ||
    numberAt(counts.blockers, "postwrite blockers") !== 0 ||
    numberAt(counts.root_readback_checks, "root readbacks") !== 1 ||
    numberAt(counts.root_payload_mismatches, "payload mismatches") !== 0 ||
    blockers.length !== 0 ||
    checks.some((check) => check.status !== "ok") ||
    readbacks.length !== 1 ||
    readback?.row_index !== 0 ||
    readback.table !== "contacts" ||
    readback.id !== contactId ||
    readback.version !== "00.00.001" ||
    readback.status !== "ok" ||
    readback.remote_user_id !== userId ||
    readback.remote_state_code !== 0 ||
    readback.local_payload_sha256 !== payloadSha256 ||
    readback.remote_payload_sha256 !== payloadSha256
  ) {
    return fail(
      checks.some((check) => check.status !== "ok")
        ? "Postwrite verification contains a non-ok verification check."
        : "Postwrite verification did not prove the unique owner draft.",
      "CASE_READBACK_FAILED",
    );
  }
}

export function hardenTree(root: string): void {
  if (process.platform === "win32" || !existsSync(root)) return;
  const visit = (directory: string): void => {
    chmodSync(directory, 0o700);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) chmodSync(entryPath, 0o600);
    }
  };
  visit(root);
}
