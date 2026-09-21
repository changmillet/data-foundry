import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import { RETAINED_REFERENCE_WIRE } from "./foundry-repair-reference-wire.ts";

type Json = Record<string, unknown>;
/** Emit the qualified CLI's real wire shape while retaining one exact historical Contact version. */
export function retainContactReference(
  t: TestContext,
  options: { missingExact?: boolean; reportInputPath?: string } = {},
) {
  const delegated = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const result = delegated(...args),
      argv = Array.isArray(args[1]) ? args[1] : [];
    if (argv[1] !== "dataset" || argv[2] !== "verify-remote") return result;
    const report = JSON.parse(String(result.stdout)) as Json;
    const files = report.files as Record<string, string>;
    const original = fs
      .readFileSync(files.checks, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Json);
    const checks = original.map((check) => {
      const full: Json = {
        row_index: Math.max(0, Number(check.row_index)),
        role: check.role,
        table: check.table,
        type: String(check.type ?? check.table),
        id: check.id,
        version: check.version,
        path: check.path,
        short_description: null,
        status: check.status,
        exact_version: check.version,
        latest_version: check.version,
        exact_source_url: "https://example.invalid/exact",
        latest_source_url: "https://example.invalid/latest",
        message: "Exact fixture reference",
      };
      if (String(check.path).endsWith("#readback"))
        Object.assign(full, {
          local_payload_sha256: check.local_payload_sha256,
          remote_payload_sha256: check.remote_payload_sha256,
          remote_user_id: check.remote_user_id,
          remote_state_code: check.remote_state_code,
          remote_modified_at: null,
        });
      return full;
    });
    const old = checks.find((check) => check.role === "reference" && check.table === "contacts");
    if (!old) throw new Error("Contact fixture required");
    old.status = "version_outdated";
    old.latest_version = "99.99.999";
    if (options.missingExact) old.exact_version = null;
    const blockers = [
      {
        code: "version_outdated",
        severity: "error",
        message: "Newer fixture version exists",
        row_index: old.row_index,
        role: old.role,
        table: old.table,
        id: old.id,
        version: old.version,
        latest_version: old.latest_version,
        path: old.path,
      },
    ];
    const counts = report.counts as Json;
    counts.blockers = 1;
    counts.by_status = {
      ...Object.fromEntries(
        Object.keys(RETAINED_REFERENCE_WIRE.report.counts.by_status).map((key) => [key, 0]),
      ),
      ok: checks.length - 1,
      version_outdated: 1,
    };
    counts.by_table = Object.fromEntries(
      [...new Set(checks.map((c) => String(c.table)))].map((table) => [
        table,
        checks.filter((c) => c.table === table).length,
      ]),
    );
    report.status = "blocked_remote_verification";
    if (options.reportInputPath) report.input_path = options.reportInputPath;
    report.blockers = blockers;
    fs.writeFileSync(files.checks, checks.map((check) => JSON.stringify(check)).join("\n") + "\n");
    fs.writeFileSync(
      files.blockers,
      blockers.map((blocker) => JSON.stringify(blocker)).join("\n") + "\n",
    );
    const stdout = JSON.stringify(report);
    fs.writeFileSync(files.report, stdout + "\n");
    const rewritten: childProcess.SpawnSyncReturns<string> = {
      status: 1,
      signal: null,
      pid: result.pid,
      stdout,
      stderr: "",
      output: [null, stdout, ""],
    };
    return rewritten;
  });
  syncBuiltinESMExports();
  t.after(() => syncBuiltinESMExports());
}
