import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { FoundryContextError } from "../../scripts/lib/foundry-runtime-context.ts";
import { ownerExecutionScopeFiles } from "../../scripts/lib/foundry-owner-execution-store.ts";

const assetRoot = path.resolve(import.meta.dirname, "..", "..");
const authorization = (inputKind: string) => ({ input_kind: inputKind });
const handoff = (fields: Record<string, unknown>) => ({
  repair_scope: false,
  ...fields,
});

test("an ordinary sealed scope keeps its resolved finalization and mutation evidence", () => {
  const files = ownerExecutionScopeFiles(
    assetRoot,
    authorization("final_rows"),
    handoff({
      finalize_report: "task/finalize.json",
      mutation_manifest: "task/mutations.json",
    }),
  );
  assert.deepEqual(files, {
    finalize_file: path.resolve(assetRoot, "task/finalize.json"),
    mutation_file: path.resolve(assetRoot, "task/mutations.json"),
  });
});

test("an ordinary sealed scope that lost its write evidence is refused", () => {
  for (const [label, fields] of [
    ["finalization report", { mutation_manifest: "task/mutations.json" }],
    ["mutation manifest", { finalize_report: "task/finalize.json" }],
    ["both files", {}],
  ] as const) {
    assert.throws(
      () => ownerExecutionScopeFiles(assetRoot, authorization("final_rows"), handoff(fields)),
      (error: unknown) =>
        error instanceof FoundryContextError &&
        error.code === "execution_request_invalid" &&
        /finalization report|mutation manifest/u.test(error.message),
      label,
    );
  }
});

test("only the registered repair scope may omit both files", () => {
  const files = ownerExecutionScopeFiles(
    assetRoot,
    authorization("repair_rows"),
    handoff({ repair_scope: true }),
  );
  assert.deepEqual(files, { finalize_file: null, mutation_file: null });
});

test("a repair-shaped handoff without the registered repair kind stays ordinary", () => {
  assert.throws(
    () =>
      ownerExecutionScopeFiles(
        assetRoot,
        authorization("final_rows"),
        handoff({ repair_scope: true }),
      ),
    (error: unknown) =>
      error instanceof FoundryContextError && error.code === "execution_request_invalid",
  );
  assert.throws(
    () =>
      ownerExecutionScopeFiles(
        assetRoot,
        authorization("repair_rows"),
        handoff({ repair_scope: "true" }),
      ),
    (error: unknown) =>
      error instanceof FoundryContextError && error.code === "execution_request_invalid",
    "only an explicit boolean repair scope admits absent evidence",
  );
});
