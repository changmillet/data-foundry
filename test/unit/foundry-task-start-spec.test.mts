import assert from "node:assert/strict";
import test from "node:test";
import {
  migrationTaskTemplate,
  materializeMigrationTaskSpec,
} from "../../scripts/lib/foundry-migration-adoption-plan.ts";
import {
  FOUNDRY_TASK_START_SPEC_SCHEMA,
  parseFoundryTaskStartSpec,
  taskStartSpecFingerprint,
} from "../../scripts/lib/foundry-task-start-spec.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";

const base = {
  schema: FOUNDRY_TASK_START_SPEC_SCHEMA,
  request_id: "request-001",
  actor_id: "agent/session-001",
  lane: "external-dataset-curated-import",
  profile_id: "generic",
  target_entities: ["flow"],
  sources: [{ path: "inputs/flow.json" }],
  seed: null,
  account_intent: null,
  preparation: {
    operation: "dataset-curation-cleanup",
    type: "flow",
    input: "inputs/flow.json",
    source_input: null,
    output_directory: "outputs/cleanup",
  },
};

const brief = {
  original_request: "Please prepare this flow for internal review.",
  goal: "Prepare an evidence-backed Flow draft",
  intended_use: "Internal LCA comparison",
  scope: "The selected Flow and its source evidence",
  deliverables: ["A validated Flow draft", "An evidence summary"],
  user_constraints: ["Do not publish"],
  ai_assumptions: ["The selected source describes the intended period"],
};

test("optional brief is exact, frozen and changes only its selected request revision", () => {
  const facts = [{ path: "/project/inputs/flow.json", bytes: 42, sha256: "1".repeat(64) }];
  const legacy = parseFoundryTaskStartSpec(base);
  assert.equal(Object.hasOwn(legacy, "brief"), false);
  assert.equal(taskStartSpecFingerprint(legacy, facts), sha256Json({ spec: base, inputs: facts }));

  const parsed = parseFoundryTaskStartSpec({ ...base, brief });
  assert.deepEqual(parsed.brief, brief);
  assert.deepEqual(materializeMigrationTaskSpec(migrationTaskTemplate(parsed)), parsed);
  assert.equal(Object.isFrozen(parsed.brief), true);
  assert.equal(Object.isFrozen(parsed.brief?.deliverables), true);
  assert.equal(Object.isFrozen(parsed.brief?.user_constraints), true);
  assert.equal(Object.isFrozen(parsed.brief?.ai_assumptions), true);
  assert.notEqual(taskStartSpecFingerprint(parsed, facts), taskStartSpecFingerprint(legacy, facts));
  assert.notEqual(
    taskStartSpecFingerprint(parsed, facts),
    taskStartSpecFingerprint(
      parseFoundryTaskStartSpec({ ...base, brief: { ...brief, goal: "Revise the Flow draft" } }),
      facts,
    ),
  );
  assert.deepEqual(
    parseFoundryTaskStartSpec({
      ...base,
      brief: {
        ...brief,
        original_request: null,
        intended_use: null,
        scope: null,
        deliverables: [],
        user_constraints: [],
        ai_assumptions: [],
      },
    }).brief,
    {
      ...brief,
      original_request: null,
      intended_use: null,
      scope: null,
      deliverables: [],
      user_constraints: [],
      ai_assumptions: [],
    },
  );
});

test("brief rejects missing, extra, blank, oversized and mistyped content", () => {
  const invalid = [
    null,
    { ...brief, goal: " " },
    { ...brief, original_request: "\n" },
    { ...brief, intended_use: " \t " },
    { ...brief, scope: 5 },
    { ...brief, goal: "x".repeat(4_097) },
    { ...brief, original_request: "x".repeat(16_385) },
    { ...brief, deliverables: Array(33).fill("item") },
    { ...brief, user_constraints: ["x".repeat(2_049)] },
    { ...brief, ai_assumptions: [" "] },
    { ...brief, deliverables: [42] },
    { ...brief, unsupported: true },
    { goal: brief.goal },
  ];
  for (const value of invalid) {
    assert.throws(() => parseFoundryTaskStartSpec({ ...base, brief: value }));
  }
});

test("task-start spec strictly freezes lane, actor, sources, seed, account and preparation", () => {
  const parsed = parseFoundryTaskStartSpec(base);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.sources), true);
  assert.deepEqual(parsed, base);
  const fingerprint = taskStartSpecFingerprint(parsed, [
    { path: "/project/inputs/flow.json", bytes: 42, sha256: "1".repeat(64) },
  ]);
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(
    taskStartSpecFingerprint(parsed, [
      { path: "/moved/flow.json", bytes: 42, sha256: "1".repeat(64) },
    ]) === fingerprint,
    false,
  );
});

test("source-evidence specs require one selected JSON seed and every preparation input", () => {
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...base,
      lane: "source-evidence-dataset-development",
      seed: null,
    }),
  );
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...base,
      preparation: { ...base.preparation, input: "inputs/not-selected.json" },
    }),
  );
  const parsed = parseFoundryTaskStartSpec({
    ...base,
    lane: "source-evidence-dataset-development",
    seed: { path: "inputs/seed.json" },
    sources: [...base.sources, { path: "inputs/seed.json" }],
  });
  assert.deepEqual(parsed.seed, { path: "inputs/seed.json" });
});

test("task-start spec rejects duplicates, credentials, unknown fields and malformed intent", () => {
  assert.throws(() => parseFoundryTaskStartSpec({ ...base, extra: true }));
  assert.throws(() =>
    parseFoundryTaskStartSpec({ ...base, sources: [base.sources[0], base.sources[0]] }),
  );
  assert.throws(() => parseFoundryTaskStartSpec({ ...base, sources: [{ path: ".env" }] }));
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...base,
      account_intent: { project_ref: "short", user_id: "not-a-uuid", session_reference: null },
    }),
  );
});

test("explicit account verification mode binds task identity and survives migration templates", () => {
  const account = {
    project_ref: "aaaaaaaaaaaaaaaaaaaa",
    user_id: "11111111-1111-4111-8111-111111111111",
    session_reference: null,
  };
  const legacy = parseFoundryTaskStartSpec({ ...base, account_intent: account });
  assert.deepEqual(
    legacy.account_intent,
    account,
    "legacy bytes and fingerprints retain their existing shape",
  );
  const production = parseFoundryTaskStartSpec({
    ...base,
    account_intent: { ...account, account_mode: "production-test" },
  });
  const facts = [{ path: "/project/inputs/flow.json", bytes: 42, sha256: "1".repeat(64) }];
  assert.notEqual(
    taskStartSpecFingerprint(legacy, facts),
    taskStartSpecFingerprint(production, facts),
  );
  assert.deepEqual(materializeMigrationTaskSpec(migrationTaskTemplate(production)), production);
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...base,
      account_intent: { ...account, account_mode: "unrestricted" },
    }),
  );
});

const repairBase = {
  ...base,
  lane: "existing-owner-draft-repair",
  target_entities: ["process"],
  sources: [
    { path: "inputs/repair-contract.json" },
    { path: "inputs/before.jsonl" },
    { path: "inputs/candidate.jsonl" },
  ],
  seed: null,
  preparation: null,
  repair: {
    kind: "existing-owner-draft-metadata",
    contract: "inputs/repair-contract.json",
    before: "inputs/before.jsonl",
    candidate: "inputs/candidate.jsonl",
    predecessor: null,
  },
};

test("RED/GREEN: repair tasks keep v1 tasks unchanged and require three selected sources", () => {
  const parsed = parseFoundryTaskStartSpec(repairBase);
  assert.equal(parsed.repair?.kind, "existing-owner-draft-metadata");
  assert.equal(Object.isFrozen(parsed.repair), true);
  // v1 specs without the repair key stay byte-identical, so their fingerprint and task id cannot change.
  const legacy = parseFoundryTaskStartSpec(base);
  assert.equal(Object.hasOwn(legacy, "repair"), false);
  assert.deepEqual(legacy, base);
  // The repair key is rejected outside the repair lane, and the lane requires it.
  assert.throws(
    () => parseFoundryTaskStartSpec({ ...base, repair: repairBase.repair }),
    (error: unknown) => (error as { code?: string }).code === "task_spec_repair_lane_mismatch",
  );
  assert.throws(
    () => parseFoundryTaskStartSpec({ ...repairBase, repair: null }),
    (error: unknown) => (error as { code?: string }).code === "task_spec_repair_lane_mismatch",
  );
});

test("repair selections must be independently selected sources with exact identity rules", () => {
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...repairBase,
      repair: { ...repairBase.repair, before: "inputs/elsewhere.jsonl" },
    }),
  );
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...repairBase,
      target_entities: ["flow", "process"],
    }),
  );
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...repairBase,
      repair: {
        ...repairBase.repair,
        predecessor: { task_id: "task-1", receipt_sha256: "not-a-hash" },
      },
    }),
  );
  const bound = parseFoundryTaskStartSpec({
    ...repairBase,
    repair: {
      ...repairBase.repair,
      predecessor: { task_id: "task-1", receipt_sha256: "a".repeat(64) },
    },
  });
  assert.equal(bound.repair?.predecessor?.receipt_sha256, "a".repeat(64));
});

test("the repair lane registers through the same facade wiring without a temporary block", async () => {
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync("scripts/lib/foundry-task-registration.ts", "utf8"),
  );
  assert.equal(/repair_entry_enforcement_pending/u.test(source), false);
  assert.match(source, /readFoundryRepairScope/u);
  // task start stays credential-free: the fresh owner preflight belongs to task resume, never to
  // registration, so the registration path must not reference the owner-CLI runner at all.
  assert.equal(/runFoundryRepairPreflight/u.test(source), false);
});
