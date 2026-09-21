import assert from "node:assert/strict";
import test from "node:test";
import {
  redactableArtifactIds,
  secretFindingCodes,
} from "../../scripts/lib/final-delivery-redaction.ts";
import {
  type ArtifactDescriptor,
  parseArtifactRows,
} from "../../scripts/lib/final-delivery-rows.ts";
import { storedZip } from "../fixtures/final-delivery-fixtures.ts";

function descriptor(artifactId: string, kind: string): ArtifactDescriptor {
  return { artifact_id: artifactId, row_count: { kind }, schema: "s" };
}

test("redaction coverage cannot be disabled by a no-row row_count declaration", () => {
  assert.deepEqual(redactableArtifactIds([descriptor("notes", "none")]), ["notes"]);
  assert.deepEqual(
    redactableArtifactIds([
      descriptor("summary", "json-object"),
      descriptor("notes", "none"),
      descriptor("workbook", "xlsx"),
    ]),
    ["notes", "summary", "workbook"],
  );
});

test("a no-row textual artifact is scanned instead of carrying a null scan", () => {
  const buffer = Buffer.from("credential note\npassword='supersecret123'\n", "utf8");
  const parsed = parseArtifactRows(descriptor("notes", "none"), buffer);
  assert.equal(typeof parsed.scanText, "string", "a textual no-row artifact must expose scan text");
  assert.deepEqual(secretFindingCodes(parsed.scanText ?? "", []), ["SECRET_ASSIGNMENT"]);
});

test("a no-row artifact that is really an opaque binary fails closed", () => {
  for (const [label, buffer] of [
    ["zip container", storedZip({ "a.txt": "hello" })],
    ["nul bytes", Buffer.from([0x00, 0x01, 0x02, 0x03])],
  ] as const) {
    assert.throws(
      () => parseArtifactRows(descriptor("blob", "none"), buffer),
      /UTF-8|control byte/u,
      label,
    );
  }
});

test("a compressed workbook cannot be declared as a scanned no-row artifact", () => {
  const workbook = storedZip({ "xl/workbook.xml": "<workbook/>" });
  assert.throws(
    () => parseArtifactRows(descriptor("book", "none"), workbook),
    /UTF-8|control byte/u,
  );
});

test("a JSON-escaped secret is detected through the decoded values", () => {
  const raw = '{"schema_version":"s","note":"\\u0070assword=\\"supersecret123\\""}';
  assert.equal(raw.includes("password="), false, "the raw bytes must hide the literal");
  const parsed = parseArtifactRows(descriptor("esc", "json-object"), Buffer.from(raw, "utf8"));
  assert.equal((parsed.json as Record<string, unknown>).note, 'password="supersecret123"');
  assert.deepEqual(secretFindingCodes(parsed.scanText ?? "", []), ["SECRET_ASSIGNMENT"]);
});

test("a JSONL-escaped secret is detected through the decoded rows", () => {
  const raw = '{"schema_version":"s","note":"\\u0041KIAIOSFODNN7EXAMPLE"}\n';
  assert.equal(raw.includes("AKIAIOSFODNN7EXAMPLE"), false, "the raw bytes must hide the literal");
  const parsed = parseArtifactRows(descriptor("esc", "jsonl"), Buffer.from(raw, "utf8"));
  assert.deepEqual(secretFindingCodes(parsed.scanText ?? "", []), ["AWS_ACCESS_KEY"]);
});

test("secret scanning keeps its existing detection and forbidden-literal contract", () => {
  assert.deepEqual(secretFindingCodes("-----BEGIN RSA PRIVATE KEY-----", []), ["PRIVATE_KEY"]);
  assert.deepEqual(secretFindingCodes("postgres://user:pw@host/db", []), ["DATABASE_URL"]);
  assert.deepEqual(secretFindingCodes("/Users/someone/private/x", []), ["USER_ABSOLUTE_PATH"]);
  assert.deepEqual(secretFindingCodes("nothing here", ["nothing"]), ["FORBIDDEN_LITERAL_1"]);
  assert.deepEqual(secretFindingCodes("nothing here", []), []);
});

test("an escaped JSON key cannot hide a secret from the scan", () => {
  // The secret is carried in the key, and the key is escaped, so both a raw-byte scan and a
  // values-only scan miss it.
  const raw = '{"schema_version":"s","\\u0041KIAIOSFODNN7EXAMPLE":1}';
  assert.equal(raw.includes("AKIAIOSFODNN7EXAMPLE"), false, "the raw bytes must hide the key");
  const parsed = parseArtifactRows(descriptor("k", "json-object"), Buffer.from(raw, "utf8"));
  assert.deepEqual(
    Object.keys(parsed.json as Record<string, unknown>),
    ["schema_version", "AKIAIOSFODNN7EXAMPLE"],
    "the decoded key is the literal that must be scanned",
  );
  assert.deepEqual(secretFindingCodes(parsed.scanText ?? "", []), ["AWS_ACCESS_KEY"]);
});

test("an escaped JSONL key cannot hide a secret from the scan", () => {
  const raw = '{"schema_version":"s","\\u0041KIAIOSFODNN7EXAMPLE":1}\n';
  const parsed = parseArtifactRows(descriptor("k", "jsonl"), Buffer.from(raw, "utf8"));
  assert.deepEqual(secretFindingCodes(parsed.scanText ?? "", []), ["AWS_ACCESS_KEY"]);
});

test("quoted and escaped CSV cells are scanned after decoding", () => {
  const raw = 'id,note\n1,"password=""supersecret123"""\n';
  const parsed = parseArtifactRows(descriptor("c", "csv"), Buffer.from(raw, "utf8"));
  assert.equal(
    (parsed.csv ?? [])[1]?.[1],
    'password="supersecret123"',
    "the decoded cell is the literal that must be scanned",
  );
  assert.deepEqual(secretFindingCodes(parsed.scanText ?? "", []), ["SECRET_ASSIGNMENT"]);
});

test("a text artifact must decode as strict UTF-8 rather than being silently replaced", () => {
  const invalid = Buffer.from([0x69, 0x64, 0x0a, 0xff, 0xfe, 0x0a]);
  for (const kind of ["none", "csv"]) {
    assert.throws(() => parseArtifactRows(descriptor("t", kind), invalid), /UTF-8/u, kind);
  }
});

test("a text artifact rejects unsupported control bytes", () => {
  const withControl = Buffer.from([0x69, 0x64, 0x01, 0x02, 0x0a]);
  assert.throws(() => parseArtifactRows(descriptor("t", "none"), withControl), /control byte/u);
  // Tab, newline and carriage return remain supported.
  const tabbed = Buffer.from("id\tnote\r\n1\tready\n", "utf8");
  assert.equal(
    parseArtifactRows(descriptor("t", "none"), tabbed).scanText,
    "id\tnote\r\n1\tready\n",
  );
});

test("a no-row artifact holding JSON is scanned at least as strongly as JSON", () => {
  const raw = '{"schema_version":"s","\\u0041KIAIOSFODNN7EXAMPLE":1}';
  const asNone = parseArtifactRows(descriptor("n", "none"), Buffer.from(raw, "utf8"));
  const asObject = parseArtifactRows(descriptor("j", "json-object"), Buffer.from(raw, "utf8"));
  assert.deepEqual(
    secretFindingCodes(asNone.scanText ?? "", []),
    secretFindingCodes(asObject.scanText ?? "", []),
    "declaring no rows must not weaken the scan",
  );
  assert.deepEqual(secretFindingCodes(asNone.scanText ?? "", []), ["AWS_ACCESS_KEY"]);
});

test("a no-row artifact holding JSONL is scanned at least as strongly as JSONL", () => {
  const raw = '{"schema_version":"s","\\u0041KIAIOSFODNN7EXAMPLE":1}\n';
  const asNone = parseArtifactRows(descriptor("n", "none"), Buffer.from(raw, "utf8"));
  assert.deepEqual(secretFindingCodes(asNone.scanText ?? "", []), ["AWS_ACCESS_KEY"]);
});
