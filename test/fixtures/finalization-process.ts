import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import type { createFoundryFacade, FoundryOperationArtifact } from "../../scripts/public-api.ts";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { readRows } from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import { testAuthIdentityReceipt } from "./auth-identity-receipt.ts";
import fs from "node:fs";
import { supportFlowPropertyRow, supportUnitGroupRow } from "./support-row-builders.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;

/** Synthetic, fixed scientific body; complete Flow evidence is selected separately. */
export function finalizationProcessFixture() {
  const original = JSON.parse(
    fs.readFileSync(new URL("./managed-allocation-input.json", import.meta.url), "utf8"),
  ) as { payload: Json; context: { flow_documents: Json[] } };
  const process = original.payload;
  const root = object(process.processDataSet);
  const information = object(root.processInformation);
  object(information.quantitativeReference).functionalUnitOrOther = {
    "@xml:lang": "en",
    "#text": "1 kg of synthetic product",
  };
  const exchanges = object(root.exchanges).exchange as Json[];
  object(exchanges[0].allocations).allocation = {
    "@internalReferenceToCoProduct": "1",
    "@allocatedFraction": "100",
  };
  const flow = original.context.flow_documents[0];
  const property = supportFlowPropertyRow(
    "93a60a56-a3c8-11da-a746-0800200b9a66",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  const group = supportUnitGroupRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  group.unitGroupDataSet.units.unit[0].name = "kg";
  return { process, flow, property, group };
}

export type FinalizationProcessFixture = ReturnType<typeof finalizationProcessFixture>;
export type FinalizationProcessFileArtifact = Extract<FoundryOperationArtifact, { kind: "file" }>;
export const finalizationProcessAccount = {
  project_ref: "qgzvkongdjqiiamzbbts",
  user_id: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
  session_reference: null,
} as const;

/** Create this source before Task registration; the public driver never rewrites a registered seed. */
export function finalizationProcessSeed(fixture: FinalizationProcessFixture) {
  return { rows: [{ json: fixture.process }] };
}

export interface PublicFinalizationProcessDriverOptions {
  root: string;
  facade: Pick<ReturnType<typeof createFoundryFacade>, "status" | "resume">;
  invocation: { taskId: string; actorId: string };
  seed: string;
  fixture: FinalizationProcessFixture;
  account?: { project_ref: string; user_id: string };
}

/**
 * Drive the actual public pipeline and published CLI subprocesses. Only auth/search/remote-read
 * transports are mocked. The mock lasts through TestContext cleanup so successor resume can reuse
 * it. No native producer, control state, authorization or mutation is manufactured by this helper.
 */
export async function runPublicFinalizationProcessWorkflow(
  t: TestContext,
  input: PublicFinalizationProcessDriverOptions,
) {
  const { root, facade, invocation, seed, fixture } = input;
  const account = input.account ?? finalizationProcessAccount;
  const originalSource = fs.readFileSync(seed);
  const read = (file: string) => object(JSON.parse(fs.readFileSync(file, "utf8")));
  const digestFile = (file: string) =>
    createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const originalSpawn = childProcess.spawnSync;
  const saveReports: Json[] = [];
  const counters = { auth: 0, preflights: 0, remoteVerifications: 0 };
  const transportMock = t.mock.method(
    childProcess,
    "spawnSync",
    (...args: Parameters<typeof childProcess.spawnSync>) => {
      const argv = args[1];
      if (!Array.isArray(argv)) return Reflect.apply(originalSpawn, childProcess, args);
      assert.ok(!argv.includes("--commit"), "this regression must never dispatch writes");
      let report: unknown;
      if (argv.includes("identity-receipt")) {
        counters.auth++;
        report = testAuthIdentityReceipt({
          projectRef: account.project_ref,
          userId: account.user_id,
        });
      } else if (argv.includes("identity-preflight")) {
        counters.preflights++;
        const input = argv[argv.indexOf("--input") + 1];
        const out = argv[argv.indexOf("--out-dir") + 1];
        const identity = datasetIdentity(read(input).target, 0, "process");
        const file = path.join(out, "outputs/identity-decision.json");
        report = {
          schema_version: 1,
          generated_at_utc: new Date().toISOString(),
          kind: "process",
          status: "needs_review",
          decision: "manual_review",
          target: { id: identity.id, version: identity.version },
          input_path: input,
          out_dir: out,
          files: { identity_decision: file },
          candidates: [],
          candidate_sources: [],
          findings: [],
          blockers: [],
          next_action: "queue_manual_review",
          ok: true,
        };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(report) + "\n");
        const tick = new Date(Date.now() + 1);
        fs.utimesSync(file, tick, tick);
      } else if (argv.includes("verify-remote")) {
        counters.remoteVerifications++;
        const input = argv[argv.indexOf("--input") + 1];
        const out = argv[argv.indexOf("--out-dir") + 1];
        const file = path.join(out, "controlled-read-report.json");
        fs.mkdirSync(out, { recursive: true });
        report = {
          status: "blocked_remote_verification",
          input_path: input,
          blockers: [{ code: "missing_dataset" }],
          counts: { blockers: 1 },
          files: { report: file },
        };
        fs.writeFileSync(file, JSON.stringify(report));
      } else {
        const result = Reflect.apply(originalSpawn, childProcess, args);
        if (argv.includes("save-draft"))
          saveReports.push(object(JSON.parse(String(result.stdout))));
        return result;
      }
      return {
        status: argv.includes("identity-preflight") || argv.includes("verify-remote") ? 1 : 0,
        signal: null,
        stdout: JSON.stringify(report),
        stderr: "",
        pid: 1,
        output: [],
      };
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    transportMock.mock.restore();
    syncBuiltinESMExports();
  });
  let status = await facade.status(invocation);
  let manifest = status.artifacts.findLast((artifact) => artifact.role === "foundry-rows.json");
  for (let step = 0; step < 4 && !manifest; step++) {
    status = await facade.resume(invocation);
    manifest = status.artifacts.findLast((artifact) => artifact.role === "foundry-rows.json");
  }
  assert.ok(manifest?.kind === "file", JSON.stringify(status));
  const references = path.join(root, "readonly-references.json");
  fs.writeFileSync(references, JSON.stringify([fixture.flow, fixture.property, fixture.group]));
  const originalReferences = fs.readFileSync(references);
  const referenceInput = path.join(root, "reference-input.json");
  const select = (manifestSha: string) => {
    fs.writeFileSync(
      referenceInput,
      JSON.stringify({
        schema: "tiangong-foundry.reference-input.v1",
        task_id: invocation.taskId,
        actor_id: invocation.actorId,
        rows_manifest_sha256: manifestSha,
        dataset_type: "process",
        qa_reference_rows: [{ file: references, sha256: digestFile(references) }],
        intent: null,
        review_files: [],
      }),
    );
    return facade.resume({ ...invocation, referenceInputFile: referenceInput });
  };
  await select(manifest.sha256);
  let lastManifest = manifest;
  let initialAssessment: FinalizationProcessFileArtifact | null = null;
  let identitySemanticResult: FinalizationProcessFileArtifact | null = null;
  let appliedIdentity = false;
  let result = await facade.resume(invocation);
  for (let i = 0; i < 5; i++) {
    const assessment = result.artifacts.findLast(
      (artifact) => artifact.role === "foundry-assessment.json",
    );
    if (assessment?.kind === "file") {
      const current = read(assessment.path);
      const set = (current.sets as Json[]).find((value) => value.type === "process")!;
      const work = (set.decisions as Json[]).find((value) => value.kind === "identity");
      if (work) {
        initialAssessment = assessment;
        const validation = object((read(String(set.cli_validation_report)).rows as Json[])[0]);
        assert.equal(object(validation.allocation_semantics).status, "passed");
        const qa = read(String(set.qa_report));
        const balance = (qa.mass_balance as Json[])[0];
        assert.equal(balance.status, "applicable");
        assert.equal(balance.delta, 0);
        const template = String(object(read(String(work.task)).files).template);
        const decisions = readRows(path.resolve(String(current.owner_base), template)) as Json[];
        for (const decision of decisions) {
          decision.identity_decision = "create_new";
          decision.canonical = null;
          decision.basis =
            "Synthetic scientific fixture has an independently reviewed new identity.";
          decision.used_context_kinds = [
            "schema",
            "methodology_yaml",
            "ruleset",
            "classification_schema",
            "location_schema",
          ];
          decision.evidence = {
            ...object(decision.evidence),
            quote_or_trace: "Fixed synthetic Process source and exact read-only Flow evidence.",
          };
        }
        const file = path.join(root, "identity-decisions.jsonl");
        const semantic = path.join(root, "semantic-input.json");
        fs.writeFileSync(file, decisions.map((value) => JSON.stringify(value)).join("\n") + "\n");
        fs.writeFileSync(
          semantic,
          JSON.stringify({
            schema: "tiangong-foundry.semantic-input.v1",
            task_id: invocation.taskId,
            actor_id: invocation.actorId,
            assessment_sha256: assessment.sha256,
            submissions: [
              {
                kind: "identity",
                authoring_task_sha256: digestFile(String(work.task)),
                file,
                sha256: digestFile(file),
              },
            ],
          }),
        );
        result = await facade.resume({ ...invocation, semanticInputFile: semantic });
        assert.equal(result.status, "ready", JSON.stringify(result));
        const nextManifest = result.artifacts.findLast(
          (artifact) => artifact.role === "foundry-rows.json",
        );
        assert.ok(nextManifest?.kind === "file", JSON.stringify(result));
        lastManifest = nextManifest;
        const semanticResult = result.artifacts.findLast(
          (artifact) => artifact.role === "semantic-result.json",
        );
        assert.ok(semanticResult?.kind === "file", JSON.stringify(result));
        identitySemanticResult = semanticResult;
        appliedIdentity = true;
        await select(nextManifest.sha256);
        break;
      }
    }
    result = await facade.resume(invocation);
  }
  const identityStage = result.artifacts.findLast(
    (artifact) => artifact.role === "foundry-identity.json",
  );
  const identityBlockers =
    identityStage?.kind === "file" ? read(identityStage.path).blockers : null;
  assert.ok(
    appliedIdentity,
    `the driver must apply a real public identity semantic submission: ${JSON.stringify({ status: result.status, blockers: result.blockers, counters, identityBlockers })}`,
  );
  for (let i = 0; i < 7 && !saveReports.length; i++) result = await facade.resume(invocation);
  assert.ok(saveReports.length, "public finalization must reach the genuine CLI dry-run");
  const snapshots = result.artifacts.filter(
    (artifact): artifact is FinalizationProcessFileArtifact =>
      artifact.kind === "file" && artifact.role === "qa-0.json",
  );
  assert.ok(snapshots.length, "the reference selection must retain registered snapshots");
  assert.deepEqual(fs.readFileSync(seed), originalSource);
  assert.deepEqual(fs.readFileSync(references), originalReferences);

  return {
    result,
    saveReports,
    counters,
    references,
    referenceInput,
    snapshots,
    lastManifest,
    initialAssessment,
    identitySemanticResult,
    originalSource,
    originalReferences,
    originalSpawn,
  };
}
