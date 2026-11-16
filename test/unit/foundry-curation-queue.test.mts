import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFoundryCurationQueue } from "../../scripts/lib/foundry-curation-queue.ts";
import { flowRow, processRowWithFlowRef } from "../fixtures/row-builders.ts";

const flowId = "77777777-7777-4777-8777-777777777777";
const processId = "44444444-4444-4444-8444-444444444444";

test("the Foundry queue binds local and external Flow evidence by exact version", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-typed-queue-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const processes = path.join(root, "processes.json");
  const flows = path.join(root, "flows.json");
  const external = path.join(root, "external.json");
  const process = processRowWithFlowRef(processId, flowId);
  const request = process.processDataSet.exchanges.exchange[0].referenceToFlowDataSet;
  request["@version"] = "00.00.002";
  fs.writeFileSync(processes, JSON.stringify([process]));
  fs.writeFileSync(flows, JSON.stringify([flowRow(flowId)]));
  fs.writeFileSync(external, JSON.stringify([{ id: flowId, version: "00.00.002" }]));

  const blocked = buildFoundryCurationQueue({
    processes,
    flows,
    outDir: path.join(root, "blocked"),
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockers[0].details.missing_flow_refs[0].version, "00.00.002");
  assert.deepEqual(blocked.tasks.at(-1)?.depends_on, []);
  const ready = buildFoundryCurationQueue({
    processes,
    flows,
    external: [external],
    outDir: path.join(root, "ready"),
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.tasks.length, 2);
  const closure = JSON.parse(fs.readFileSync(ready.tasks[1].closure_file, "utf8"));
  assert.deepEqual(
    closure.dependencies.external_refs.map((ref: { version: string }) => ref.version),
    ["00.00.002"],
  );
  assert.deepEqual(closure.dependencies.local_tasks, []);
});
