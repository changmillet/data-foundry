import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertSelectedFoundryQualityReviewInput,
  parseFoundryQualityReviewInput,
  selectFoundryQualityReviewInput,
} from "../../scripts/lib/foundry-quality-review-input.ts";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sample = () => ({
  schema: "tiangong-foundry.quality-review-input.v1",
  binding: {
    workspace_id: "workspace",
    task_id: `task-${"a".repeat(64)}-r0001`,
    actor_id: "actor",
    project_ref: "abcdefghijklmnopqrst",
    user_id: "12345678-1234-1234-1234-123456789abc",
    profile_id: "profile",
    profile_sha256: "b".repeat(64),
    input_scope_sha256: "c".repeat(64),
  },
  runtime_qualification_sha256: "d".repeat(64),
  rows_manifest_sha256: "e".repeat(64),
  assessment_sha256: "f".repeat(64),
  context_sha256: "0".repeat(64),
  reference_inputs_sha256: null as string | null,
  interaction_context_sha256: null as string | null,
  qa_report_sha256: "1".repeat(64),
  qa_findings_sha256: "2".repeat(64),
  expected_previous_sha256: null as string | null,
  issued_at_utc: "2026-10-10T00:00:00.000Z",
  expires_at_utc: "2026-10-11T00:00:00.000Z",
  reviews: [
    {
      row_index: 0,
      id: "12345678-1234-1234-1234-123456789abc",
      version: "01.00.000",
      payload_sha256: "3".repeat(64),
      finding_sha256: "4".repeat(64),
      code: "process_material_balance_deviation",
      evidence_ids: ["decision", "source"],
      rationale: "The explicit source model explains this measured deviation.",
    },
  ],
  evidence: [
    { id: "decision", kind: "user-decision", file: "decision.txt", sha256: hash("decision") },
    { id: "source", kind: "source-model", file: "source.txt", sha256: hash("source") },
  ],
});
const validateSchema = () => {
  const Ajv = Ajv2020 as unknown as new (options: { strict: boolean }) => {
    compile: (schema: unknown) => (value: unknown) => boolean;
  };
  return new Ajv({ strict: true }).compile(
    JSON.parse(
      fs.readFileSync(
        new URL("../../specs/schemas/foundry-quality-review-input.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  );
};

test("quality review descriptor schema and parser bind exact immutable review facts", () => {
  const original = sample(),
    parsed = parseFoundryQualityReviewInput(original);
  assert.equal(validateSchema()(original), true);
  for (const part of [
    parsed,
    parsed.binding,
    parsed.reviews,
    parsed.reviews[0],
    parsed.reviews[0].evidence_ids,
    parsed.evidence,
    ...parsed.evidence,
  ])
    assert.ok(Object.isFrozen(part));
  original.reviews[0].evidence_ids.push("later");
  assert.deepEqual(parsed.reviews[0].evidence_ids, ["decision", "source"]);
  const bounded = sample();
  bounded.reference_inputs_sha256 = "5".repeat(64);
  bounded.expected_previous_sha256 = "6".repeat(64);
  assert.equal(validateSchema()(bounded), true);
  assert.equal(parseFoundryQualityReviewInput(bounded).expected_previous_sha256, "6".repeat(64));
});

test("quality review schema and parser reject unsupported and malformed fields", () => {
  const validate = validateSchema();
  const bad: unknown[] = [
    { ...sample(), schema: "old" },
    { ...sample(), grant: {} },
    { ...sample(), reviews: [] },
    { ...sample(), evidence: [] },
    { ...sample(), reviews: Array.from({ length: 129 }, () => sample().reviews[0]) },
    { ...sample(), evidence: Array.from({ length: 101 }, () => sample().evidence[0]) },
  ];
  for (const key of [
    "runtime_qualification_sha256",
    "rows_manifest_sha256",
    "assessment_sha256",
    "context_sha256",
    "reference_inputs_sha256",
    "qa_report_sha256",
    "qa_findings_sha256",
    "expected_previous_sha256",
  ])
    bad.push({ ...sample(), [key]: "latest" });
  for (const change of [
    { row_index: -1 },
    { row_index: 0.5 },
    { id: "other" },
    { version: "1.0.0" },
    { payload_sha256: "latest" },
    { finding_sha256: "latest" },
    { code: "other" },
    { evidence_ids: [] },
    { evidence_ids: ["decision", "decision"] },
    { rationale: "" },
    { rationale: "x".repeat(8193) },
    { override: true },
  ])
    bad.push({ ...sample(), reviews: [{ ...sample().reviews[0], ...change }] });
  for (const change of [
    { id: "" },
    { kind: "other" },
    { file: "" },
    { file: "a\nb" },
    { file: "a\0b" },
    { file: "x".repeat(4097) },
    { sha256: "latest" },
    { override: true },
  ])
    bad.push({
      ...sample(),
      evidence: [{ ...sample().evidence[0], ...change }, sample().evidence[1]],
    });
  for (const change of [
    { task_id: "task" },
    { workspace_id: "" },
    { actor_id: "space actor" },
    { profile_sha256: "latest" },
    { input_scope_sha256: "latest" },
    { override: true },
  ])
    bad.push({ ...sample(), binding: { ...sample().binding, ...change } });
  for (const value of bad) {
    assert.equal(validate(value), false, JSON.stringify(value));
    assert.throws(() => parseFoundryQualityReviewInput(value));
  }
});

test("quality review parser resolves both evidence kinds and rejects duplicate or unused facts", () => {
  const variants: unknown[] = [];
  for (const evidence_ids of [["decision"], ["source"], ["decision", "missing"]])
    variants.push({ ...sample(), reviews: [{ ...sample().reviews[0], evidence_ids }] });
  variants.push({
    ...sample(),
    evidence: [...sample().evidence, { ...sample().evidence[0], id: "unused" }],
  });
  variants.push({
    ...sample(),
    evidence: [sample().evidence[0], { ...sample().evidence[1], id: "decision" }],
  });
  for (const change of [
    { id: "22345678-1234-1234-1234-123456789abc", finding_sha256: "5".repeat(64) },
    { row_index: 1, finding_sha256: "5".repeat(64) },
    { row_index: 1, id: "22345678-1234-1234-1234-123456789abc" },
  ])
    variants.push({
      ...sample(),
      reviews: [sample().reviews[0], { ...sample().reviews[0], ...change }],
    });
  for (const value of variants) assert.throws(() => parseFoundryQualityReviewInput(value));
});

test("quality review timestamps are strict UTC milliseconds and structurally limited to 24 hours", () => {
  for (const change of [
    { issued_at_utc: "2026-10-10T00:00:00Z" },
    { issued_at_utc: "2026-02-30T00:00:00.000Z" },
    { issued_at_utc: "2026-10-10T00:00:00.000+00:00" },
    { expires_at_utc: "2026-10-10T00:00:00.000Z" },
    { expires_at_utc: "2026-10-09T00:00:00.000Z" },
    { expires_at_utc: "2026-10-11T00:00:00.001Z" },
  ])
    assert.throws(() => parseFoundryQualityReviewInput({ ...sample(), ...change }));
  assert.equal(
    parseFoundryQualityReviewInput({
      ...sample(),
      issued_at_utc: "2020-01-01T00:00:00.000Z",
      expires_at_utc: "2020-01-02T00:00:00.000Z",
    }).issued_at_utc,
    "2020-01-01T00:00:00.000Z",
  );
});

test("quality review selection bounds the entire evidence batch independently of each file", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-quality-review-limit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    moduleUrl: new URL("../../scripts/foundry.ts", import.meta.url).href,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: sample().binding.task_id,
    actorId: "actor",
    accountIntent: { projectRef: sample().binding.project_ref, userId: sample().binding.user_id },
  });
  const value = sample(),
    content = Buffer.alloc(8 * 1024 * 1024, "x");
  value.binding.workspace_id = context.workspaceId!;
  value.evidence = Array.from({ length: 8 }, (_, index) => {
    const file = `evidence-${index}.txt`;
    fs.writeFileSync(path.join(context.workspaceRoot, file), content);
    return {
      id: `evidence-${index}`,
      kind: index ? "source-model" : "user-decision",
      file,
      sha256: hash(content),
    };
  });
  value.reviews[0].evidence_ids = value.evidence.map((item) => item.id);
  const descriptor = path.join(context.workspaceRoot, "review.json");
  fs.writeFileSync(descriptor, JSON.stringify(value));
  assert.throws(() => selectFoundryQualityReviewInput(context, descriptor), /64 MiB/u);
});

test("quality review selection binds local host, scope, UTF-8 and exact unchanged evidence bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-quality-review-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    moduleUrl: new URL("../../scripts/foundry.ts", import.meta.url).href,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: sample().binding.task_id,
    actorId: "actor",
    accountIntent: { projectRef: sample().binding.project_ref, userId: sample().binding.user_id },
  });
  const value = sample();
  value.binding.workspace_id = context.workspaceId!;
  fs.writeFileSync(path.join(context.workspaceRoot, "decision.txt"), "decision");
  fs.writeFileSync(path.join(context.workspaceRoot, "source.txt"), "source");
  const descriptor = path.join(context.workspaceRoot, "review.json");
  const write = (input: unknown) => fs.writeFileSync(descriptor, JSON.stringify(input));
  write(value);
  const selected = selectFoundryQualityReviewInput(context, descriptor);
  assertSelectedFoundryQualityReviewInput(selected);
  assert.ok(
    Object.isFrozen(selected) &&
      Object.isFrozen(selected.descriptor) &&
      Object.isFrozen(selected.evidence) &&
      selected.evidence.every(Object.isFrozen),
  );
  assert.throws(() => assertSelectedFoundryQualityReviewInput({ ...selected }));
  fs.writeFileSync(path.join(context.workspaceRoot, "source.txt"), "changed");
  assert.throws(() => assertSelectedFoundryQualityReviewInput(selected));
  assert.throws(() => selectFoundryQualityReviewInput(context, descriptor));
  fs.writeFileSync(path.join(context.workspaceRoot, "source.txt"), "source");
  for (const change of [
    { task_id: `task-${"9".repeat(64)}-r0001` },
    { actor_id: "other" },
    { workspace_id: "other" },
    { project_ref: "other" },
    { user_id: "other" },
  ]) {
    write({ ...value, binding: { ...value.binding, ...change } });
    assert.throws(() => selectFoundryQualityReviewInput(context, descriptor));
  }
  write(value);
  assert.throws(() =>
    selectFoundryQualityReviewInput({ ...context, accountIntent: null }, descriptor),
  );
  fs.writeFileSync(
    descriptor,
    Buffer.concat([Buffer.from(JSON.stringify(value)), Buffer.from([255])]),
  );
  assert.throws(() => selectFoundryQualityReviewInput(context, descriptor));
  fs.writeFileSync(path.join(context.workspaceRoot, "source.txt"), Buffer.from([255]));
  write({
    ...value,
    evidence: [value.evidence[0], { ...value.evidence[1], sha256: hash(Buffer.from([255])) }],
  });
  assert.throws(() => selectFoundryQualityReviewInput(context, descriptor));
  fs.writeFileSync(path.join(context.workspaceRoot, "source.txt"), "source");
  for (const empty of ["", " \n\t"]) {
    fs.writeFileSync(path.join(context.workspaceRoot, "source.txt"), empty);
    write({
      ...value,
      evidence: [value.evidence[0], { ...value.evidence[1], sha256: hash(empty) }],
    });
    assert.throws(() => selectFoundryQualityReviewInput(context, descriptor));
  }
  fs.writeFileSync(path.join(context.workspaceRoot, "source.txt"), "source");
  fs.symlinkSync("source.txt", path.join(context.workspaceRoot, "linked.txt"));
  for (const file of ["linked.txt", ".env", "source\n.txt"]) {
    write({ ...value, evidence: [value.evidence[0], { ...value.evidence[1], file }] });
    assert.throws(() => selectFoundryQualityReviewInput(context, descriptor));
  }
  const session = path.join(context.workspaceRoot, "source.txt");
  write(value);
  assert.throws(() =>
    selectFoundryQualityReviewInput(
      { ...context, accountIntent: { ...context.accountIntent!, sessionReference: session } },
      descriptor,
    ),
  );
  fs.writeFileSync(
    path.join(context.workspaceRoot, "source.txt"),
    Buffer.alloc(8 * 1024 * 1024 + 1),
  );
  assert.throws(() => selectFoundryQualityReviewInput(context, descriptor));
});
