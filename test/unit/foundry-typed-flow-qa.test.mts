import assert from "node:assert/strict";
import test from "node:test";
import { projectFlowValidation } from "../../scripts/lib/foundry-typed-flow-qa.ts";
import { canonicalPayloadSha256 } from "../../scripts/lib/post-write-root-proof.ts";

const flow = {
  id: "77777777-7777-4777-8777-777777777777",
  version: "00.00.001",
  payload: { flowDataSet: {} },
};
const output = "/flow-validation.json";

function observed() {
  const issues = Array.from({ length: 8 }, (_, index) => ({
    code: `test_rule_${index}`,
    path: `flowDataSet.field${index}`,
    message: `Test issue ${index}`,
  }));
  const complete = {
    type: "flow",
    id: flow.id,
    version: flow.version,
    index: 0,
    checks: ["schema", "business"],
    status: "failed",
    issue_count: issues.length,
    issues,
    payload_sha256: canonicalPayloadSha256(flow.payload),
  };
  const bytes = Buffer.from(JSON.stringify(complete));
  const report = {
    schemaVersion: 1,
    operation: "dataset flow validate",
    status: "completed",
    outcome: "validation_failed",
    error: null,
    artifacts: [{ path: output, purpose: "complete_result", bytes: bytes.length }],
    data: { validation: { ...complete, issues: issues.slice(0, 5) } },
  };
  return { report, bytes, complete };
}

test("Flow QA retains all findings from a typed CLI report with an abbreviated stdout envelope", () => {
  const { report, bytes, complete } = observed();
  const findings = projectFlowValidation(flow, output, 1, report, bytes);
  assert.equal(findings.length, 8);
  assert.deepEqual(findings[7], {
    entity_id: flow.id,
    version: flow.version,
    severity: "error",
    ...complete.issues[7],
  });
});

test("Flow QA rejects a wrong exit, incorrect result path, or validation of another payload", () => {
  const { report, bytes } = observed();
  assert.throws(
    () => projectFlowValidation(flow, output, 0, report, bytes),
    /typed dataset validation/,
  );
  assert.throws(
    () => projectFlowValidation(flow, "/another.json", 1, report, bytes),
    /typed dataset validation/,
  );
  assert.throws(
    () =>
      projectFlowValidation(
        { ...flow, payload: { flowDataSet: { changed: true } } },
        output,
        1,
        report,
        bytes,
      ),
    /typed dataset validation/,
  );
});
