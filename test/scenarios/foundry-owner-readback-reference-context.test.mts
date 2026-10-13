import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { collectDatasetReferences } from "../../scripts/lib/import-curation/internal/workflow-reference-closure.ts";
import {
  repairDataCalls,
  repairTarget,
  repairWorkflowFixture,
} from "../fixtures/foundry-repair-workflow.ts";

type Json = Record<string, unknown>;

function contextualRow(payload: Json): Json {
  const reference = (type: string, suffix: string) => ({
    "@type": type,
    "@refObjectId": `aaaaaaaa-bbbb-4ccc-8ddd-0000000000${suffix}`,
    "@version": "00.00.001",
  });
  return {
    id: repairTarget.id,
    version: repairTarget.version,
    json: payload,
    semantic_context: {
      flow_documents: [
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
          version: "00.00.001",
          json: {
            flowDataSet: {
              flowProperties: {
                flowProperty: {
                  referenceToFlowPropertyDataSet: reference("flow property data set", "02"),
                },
              },
              quantitativeReference: {
                referenceToUnitGroupDataSet: reference("unit group data set", "03"),
              },
              administrativeInformation: {
                dataEntryBy: {
                  "common:referenceToDataSetFormat": reference("source data set", "04"),
                },
                publicationAndOwnership: {
                  "common:referenceToOwnershipOfDataSet": reference("contact data set", "05"),
                },
              },
            },
          },
        },
      ],
    },
  };
}

for (const scenario of [
  "exact-business-references",
  "missing-business-reference",
  "wrong-business-version",
] as const)
  test(`owner readback ignores supplemental Flow context and enforces ${scenario}`, async (t) => {
    const f = repairWorkflowFixture(t);
    const wrapped = contextualRow(f.candidatePayload);
    const businessReferences = collectDatasetReferences(f.candidatePayload);
    const contextReferences = collectDatasetReferences(wrapped.semantic_context);
    assert.equal(contextReferences.length, 4);
    assert.ok(businessReferences.length > 0);
    assert.equal(
      contextReferences.some((context) => businessReferences.some((ref) => ref.id === context.id)),
      false,
      "context must contain distinct, unproven support identities",
    );
    fs.writeFileSync(f.beforeFile, `${JSON.stringify(contextualRow(f.beforePayload))}\n`);
    fs.writeFileSync(f.candidateFile, `${JSON.stringify(wrapped)}\n`);
    const candidateBytes = fs.readFileSync(f.candidateFile);
    const delegated = childProcess.spawnSync;
    let commits = 0;
    let ownerChecks: Json[] = [];
    t.mock.method(
      childProcess,
      "spawnSync",
      (...args: Parameters<typeof childProcess.spawnSync>) => {
        const argv = Array.isArray(args[1]) ? args[1] : [];
        const option = (name: string) => String(argv[argv.indexOf(name) + 1]);
        if (argv.includes("--commit")) {
          assert.equal(argv[1], "dataset");
          assert.equal(argv[2], "save-draft");
          commits++;
          const contractFile = option("--execution-contract");
          const contract = JSON.parse(fs.readFileSync(contractFile, "utf8")) as Json;
          const action = (contract.actions as Json[])[0];
          assert.equal(action.desired_sha256, sha256Json(f.candidatePayload));
          const output = path.join(
            option("--out-dir"),
            "outputs",
            "dataset-save-draft",
            "summary.json",
          );
          const report = {
            schema_version: 2,
            status: "completed",
            mode: "commit",
            commit: true,
            requested_type: "process",
            input_path: option("--input"),
            counts: {
              selected: 1,
              prepared: 0,
              executed: 1,
              failed: 0,
              blocked: 0,
              unknown: 0,
              attempts_consumed: 1,
            },
            execution_contract: {
              path: contractFile,
              sha256: sha256Json(contract),
              execution_id: contract.execution_id,
              target_mode: "owner_draft",
            },
            files: { summary_json: output },
            rows: [
              {
                index: 0,
                type: "process",
                table: action.table,
                id: action.id,
                version: action.version,
                action_id: action.action_id,
                desired_sha256: action.desired_sha256,
                status: "executed",
                operation: "save_draft",
                attempt_consumed: true,
                replayed: false,
                readback: "desired_exact",
              },
            ],
          };
          fs.mkdirSync(path.dirname(output), { recursive: true });
          fs.writeFileSync(output, `${JSON.stringify(report)}\n`);
          const stdout = JSON.stringify(report);
          return {
            status: 0,
            signal: null,
            stdout,
            stderr: "",
            pid: 1,
            output: [null, stdout, ""],
          };
        }
        const result = delegated(...args);
        if (
          argv[1] !== "dataset" ||
          argv[2] !== "verify-remote" ||
          !option("--out-dir").includes(`${path.sep}owner-readback${path.sep}`)
        )
          return result;
        const report = JSON.parse(String(result.stdout)) as Json;
        const files = report.files as Record<string, string>;
        ownerChecks = fs
          .readFileSync(files.checks, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Json);
        const actual = ownerChecks.filter((check) => check.role === "reference");
        assert.equal(actual.length, businessReferences.length);
        assert.equal(
          actual.some((check) => contextReferences.some((ref) => ref.id === check.id)),
          false,
        );
        const business = actual[0];
        assert.ok(business);
        if (scenario === "exact-business-references") return result;
        if (scenario === "missing-business-reference")
          ownerChecks = ownerChecks.filter((check) => check !== business);
        else business.version = "99.99.999";
        fs.writeFileSync(
          files.checks,
          `${ownerChecks.map((check) => JSON.stringify(check)).join("\n")}\n`,
        );
        // Keep a plausible passed summary: per-reference proof must reject incomplete/exact-version drift.
        return result;
      },
    );
    syncBuiltinESMExports();
    t.after(() => syncBuiltinESMExports());
    const started = await f.facade.start({ specFile: f.specFile });
    const invocation = { taskId: String(started.task_id), actorId: "identity-actor" };
    await f.facade.resume(invocation);
    const approved = await f.facade.resume({
      ...invocation,
      authorizationInputFile: f.approval(invocation.taskId).file,
    });
    assert.equal(
      (approved.permissions as Json).state,
      "granted",
      JSON.stringify(approved.blockers),
    );
    await f.facade.resume(invocation);
    const completed = await f.facade.resume(invocation);
    assert.equal(commits, 1, JSON.stringify(completed.blockers));
    assert.ok(
      ownerChecks.length > 0,
      "the public workflow must execute the actual owner-readback consumer",
    );
    const readbacks = (completed.artifacts as { path: string }[])
      .filter((artifact) => artifact.path.endsWith("owner-readback.json"))
      .map((artifact) => JSON.parse(fs.readFileSync(artifact.path, "utf8")) as Json);
    assert.equal(readbacks.length, 1);
    const proof = readbacks[0];
    assert.deepEqual(
      fs.readFileSync(f.candidateFile),
      candidateBytes,
      "row-bound context must retain exact input bytes",
    );
    if (scenario === "exact-business-references") {
      assert.equal(completed.status, "completed", JSON.stringify(completed.blockers));
      assert.equal(proof.status, "verified");
      assert.deepEqual(proof.blockers, []);
    } else {
      assert.equal(completed.status, "needs_input");
      assert.equal(proof.status, "unresolved");
      assert.ok(
        (proof.blockers as Json[]).some(
          (blocker) => blocker.code === "repair_reference_integrity_unproven",
        ),
      );
    }
    const calls = repairDataCalls(f).length;
    const repeated = await f.facade.resume(invocation);
    assert.equal(
      repeated.status,
      scenario === "exact-business-references" ? "completed" : "needs_input",
    );
    assert.equal(commits, 1, "readback cannot replay the consumed mutation");
    if (scenario === "exact-business-references") assert.equal(repairDataCalls(f).length, calls);
  });
