import assert from "node:assert/strict";
import test from "node:test";
import {
  proveRetainedRepairReferences,
  type FoundryRepairExpectedReference,
  type FoundryRepairExpectedRoot,
} from "../../scripts/lib/foundry-repair-reference-proof.ts";
import {
  RETAINED_REFERENCE_BINDINGS,
  RETAINED_REFERENCE_OWNER,
  RETAINED_REFERENCE_ROOTS,
  RETAINED_REFERENCE_STATE_CODE,
  RETAINED_REFERENCE_WIRE,
} from "../fixtures/foundry-repair-reference-wire.ts";

type MutableCheck = Record<string, unknown> & {
  role: string;
  table: string;
  id: string;
  version: string;
  path: string;
  status: string;
  exact_version: string | null;
  latest_version: string | null;
};
type MutableReport = Record<string, unknown> & {
  status: string;
  counts: Record<string, unknown> & { by_status: Record<string, number> };
  blockers: Record<string, unknown>[];
};

function wireCopy(): { report: MutableReport; checks: MutableCheck[] } {
  return JSON.parse(JSON.stringify(RETAINED_REFERENCE_WIRE)) as {
    report: MutableReport;
    checks: MutableCheck[];
  };
}

type ProveInput = {
  report: unknown;
  checks: readonly unknown[];
  roots: readonly FoundryRepairExpectedRoot[];
  references: readonly FoundryRepairExpectedReference[];
  target_user_id: string;
  expected_state_code: number;
};

function prove(overrides: Partial<ProveInput> = {}) {
  const w = wireCopy();
  return proveRetainedRepairReferences({
    report: w.report,
    checks: w.checks,
    roots: RETAINED_REFERENCE_ROOTS,
    references: RETAINED_REFERENCE_BINDINGS,
    target_user_id: RETAINED_REFERENCE_OWNER,
    expected_state_code: RETAINED_REFERENCE_STATE_CODE,
    ...overrides,
  });
}

const outdatedChecks = (checks: readonly unknown[]) =>
  (checks as MutableCheck[]).filter((check) => check.status === "version_outdated");
const referenceChecks = (checks: readonly unknown[]) =>
  (checks as MutableCheck[]).filter((check) => check.role === "reference");

test("the real wire derives an integrity proof with its two retained outdated references", () => {
  const proof = prove();
  assert.equal(proof.schema, "tiangong-foundry.repair-reference-proof.v1");
  assert.equal(proof.outdated.length, 2);
  assert.deepEqual(
    proof.outdated.map((item) => [item.table, item.version, item.latest_version]),
    [
      ["contacts", "01.01.000", "01.01.001"],
      ["contacts", "01.00.000", "01.00.001"],
    ],
  );
  assert.equal(proof.root_readbacks, 1);
  assert.equal(proof.references_verified, 22);
  assert.equal(proof.ok_checks, 22);
  assert.equal(proof.publication_ready, false);
});

test("the proof reports the CLI's own status and counts verbatim and never rewrites them", () => {
  const w = wireCopy();
  const before = JSON.stringify(w);
  const proof = proveRetainedRepairReferences({
    report: w.report,
    checks: w.checks,
    roots: RETAINED_REFERENCE_ROOTS,
    references: RETAINED_REFERENCE_BINDINGS,
    target_user_id: RETAINED_REFERENCE_OWNER,
    expected_state_code: RETAINED_REFERENCE_STATE_CODE,
  });
  assert.equal(JSON.stringify(w), before, "the module must not mutate the wire it was given");
  assert.equal(proof.raw_status, "blocked_remote_verification");
  assert.notEqual(proof.raw_status, "passed_remote_verification");
  assert.equal(proof.raw_blocker_count, 2);
  assert.deepEqual(proof.counts, w.report.counts);
  assert.equal(
    w.report.counts.by_status.version_outdated,
    2,
    "the outdated bucket stays on the record",
  );
});

test("a reference target appearing on several paths is covered path by path", () => {
  const w = wireCopy();
  const shared = referenceChecks(w.checks).filter(
    (check) => check.table === "sources" && check.id === referenceChecks(w.checks)[15]?.id,
  );
  const paths = shared.map((check) => check.path);
  assert.equal(shared.length, 3, "the fixture must retain the real multi-path target");
  assert.equal(new Set(paths).size, 3);
  const proof = prove();
  assert.equal(proof.references_verified, 22, "each path is verified as its own binding");
});

test("a reference whose exact version is not the requested version is refused", () => {
  const w = wireCopy();
  referenceChecks(w.checks)[0].exact_version = "99.99.999";
  assert.throws(() => prove({ report: w.report, checks: w.checks }), /exact requested version/u);
});

test("version_outdated is never allowed on a root record", () => {
  const w = wireCopy();
  const rootResolve = w.checks.find(
    (check) => check.role === "root" && check.status === "ok" && !check.path.endsWith("#readback"),
  )!;
  rootResolve.status = "version_outdated";
  rootResolve.latest_version = "99.99.999";
  assert.throws(() => prove({ report: w.report, checks: w.checks }), /root/iu);
});

test("an outdated finding must carry a strictly greater published version", () => {
  const equal = wireCopy();
  outdatedChecks(equal.checks)[0].latest_version = outdatedChecks(equal.checks)[0].version;
  assert.throws(() => prove({ report: equal.report, checks: equal.checks }), /outdated/u);

  const lower = wireCopy();
  outdatedChecks(lower.checks)[0].latest_version = "00.00.001";
  assert.throws(() => prove({ report: lower.report, checks: lower.checks }), /outdated/u);

  const unparseable = wireCopy();
  outdatedChecks(unparseable.checks)[0].latest_version = "not-a-version";
  assert.throws(
    () => prove({ report: unparseable.report, checks: unparseable.checks }),
    /version/u,
  );
});

test("the outdated findings and the CLI blockers must correspond exactly one to one", () => {
  const extra = wireCopy();
  extra.report.blockers.push({ ...extra.report.blockers[0] });
  assert.throws(() => prove({ report: extra.report, checks: extra.checks }), /blocker/u);

  const missing = wireCopy();
  missing.report.blockers.pop();
  assert.throws(() => prove({ report: missing.report, checks: missing.checks }), /blocker/u);

  const mismatched = wireCopy();
  mismatched.report.blockers[0].version = "09.09.009";
  assert.throws(() => prove({ report: mismatched.report, checks: mismatched.checks }), /blocker/u);
});

test("a non-outdated blocker is never retained", () => {
  const w = wireCopy();
  w.report.blockers[0].code = "payload_mismatch";
  assert.throws(() => prove({ report: w.report, checks: w.checks }), /blocker|outdated/u);
});

test("a blocked report with no actual outdated finding is refused", () => {
  // Status, counters and records all stay internally consistent -- the CLI says it blocked, but
  // every check is ok and no blocker is recorded. Only the freshness rule can catch this, and it
  // must: a proof that retains nothing is not evidence that something was retained.
  const w = wireCopy();
  for (const check of outdatedChecks(w.checks)) {
    check.status = "ok";
    check.latest_version = check.version;
  }
  w.report.counts.by_status.ok = 24;
  w.report.counts.by_status.version_outdated = 0;
  w.report.counts.blockers = 0;
  w.report.blockers = [];
  assert.throws(() => prove({ report: w.report, checks: w.checks }), /outdated/u);

  // The mirror case: the checks still carry an outdated finding but the blocker list was emptied.
  // The one-to-one blocker bijection must catch it.
  const emptied = wireCopy();
  emptied.report.counts.blockers = 0;
  emptied.report.blockers = [];
  assert.throws(() => prove({ report: emptied.report, checks: emptied.checks }), /blocker/u);
});

test("bad counters, duplicates, extras and missing root evidence all fail closed", () => {
  const badNumber = wireCopy();
  badNumber.report.counts.checked = "24";
  assert.throws(
    () => prove({ report: badNumber.report, checks: badNumber.checks }),
    /count|number/u,
  );

  const inconsistent = wireCopy();
  inconsistent.report.counts.checked = 23;
  assert.throws(
    () => prove({ report: inconsistent.report, checks: inconsistent.checks }),
    /count/u,
  );

  const unknownBucket = wireCopy();
  unknownBucket.report.counts.by_status.owner_mismatch = 1;
  assert.throws(
    () => prove({ report: unknownBucket.report, checks: unknownBucket.checks }),
    /status|bucket/u,
  );

  const duplicate = wireCopy();
  const first = referenceChecks(duplicate.checks)[0];
  duplicate.checks.push({ ...first });
  assert.throws(
    () => prove({ report: duplicate.report, checks: duplicate.checks }),
    /count|duplicate|extra/u,
  );

  const extra = wireCopy();
  extra.checks.push({ ...referenceChecks(extra.checks)[0], path: "/processDataSet/extra" });
  assert.throws(
    () => prove({ report: extra.report, checks: extra.checks }),
    /count|extra|unexpected/u,
  );

  // Root readback replaced by a *well-formed* second resolvability record, so every counter still
  // matches and every record still parses: only the root rule itself can catch the missing readback.
  const missingRoot = wireCopy();
  const readbackIndex = missingRoot.checks.findIndex((check) =>
    String(check.path).endsWith("#readback"),
  );
  const readback = missingRoot.checks[readbackIndex];
  missingRoot.checks[readbackIndex] = {
    row_index: 0,
    role: "root",
    table: readback.table,
    type: readback.type,
    id: readback.id,
    version: readback.version,
    path: "/processDataSet",
    short_description: "",
    status: "ok",
    exact_version: readback.version,
    latest_version: readback.version,
    exact_source_url: null,
    latest_source_url: null,
    message: "synthetic",
  };
  assert.throws(() => prove({ report: missingRoot.report, checks: missingRoot.checks }), /root/iu);

  const removedRoot = wireCopy();
  removedRoot.checks = removedRoot.checks.filter(
    (check) => !String(check.path).endsWith("#readback"),
  );
  assert.throws(() => prove({ report: removedRoot.report, checks: removedRoot.checks }), /count/iu);
});

test("root evidence keeps the strict exact-payload, owner and state rule", () => {
  const payload = wireCopy();
  const readback = payload.checks.find((check) => String(check.path).endsWith("#readback"))!;
  readback.remote_payload_sha256 = "0".repeat(64);
  assert.throws(() => prove({ report: payload.report, checks: payload.checks }), /root/iu);

  const owner = wireCopy();
  owner.checks.find((check) => String(check.path).endsWith("#readback"))!.remote_user_id =
    "00000000-0000-4000-8000-000000000000";
  assert.throws(() => prove({ report: owner.report, checks: owner.checks }), /root/iu);

  const state = wireCopy();
  state.checks.find((check) => String(check.path).endsWith("#readback"))!.remote_state_code = 100;
  assert.throws(() => prove({ report: state.report, checks: state.checks }), /root/iu);
});

test("only the blocked-with-retained-references status is admitted", () => {
  const passed = wireCopy();
  passed.report.status = "passed_remote_verification";
  assert.throws(() => prove({ report: passed.report, checks: passed.checks }), /status/u);

  const unknownStatus = wireCopy();
  unknownStatus.report.status = "something_else";
  assert.throws(
    () => prove({ report: unknownStatus.report, checks: unknownStatus.checks }),
    /status/u,
  );
});

test("a caller cannot widen the retained set by declaring fewer expected references", () => {
  assert.throws(
    () =>
      prove({
        references: (
          RETAINED_REFERENCE_BINDINGS as readonly FoundryRepairExpectedReference[]
        ).slice(1),
      }),
    /reference|count/u,
  );
  assert.throws(() => prove({ roots: [] }), /root|count/u);
});
