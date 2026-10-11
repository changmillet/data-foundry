import fs from "node:fs";
import path from "node:path";
import { testAuthIdentityReceipt } from "./auth-identity-receipt.ts";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Synthetic managed transport requires an object.");
  return value as ObjectValue;
};
const option = (args: readonly string[], name: string): string => args[args.indexOf(name) + 1];

/** Test-only subprocess transport. Never supplies a business runtime or real credential. */
export function runManagedAuthOwnerFixture(args: readonly string[]): boolean {
  const configuration = object(
    JSON.parse(
      fs.readFileSync(new URL("./managed-owner-configuration.json", import.meta.url), "utf8"),
    ),
  );
  const control = object(JSON.parse(fs.readFileSync(String(configuration.control), "utf8")));
  const append = (kind: string) =>
    fs.appendFileSync(
      String(configuration.calls),
      JSON.stringify({
        kind,
        auth_mode: process.env.TIANGONG_LCA_AUTH_MODE ?? null,
        token_present: Boolean(process.env.TIANGONG_LCA_ACCESS_TOKEN),
        cache_disabled: process.env.TIANGONG_LCA_DISABLE_SESSION_CACHE === "true",
        ambient_secret_present: Boolean(process.env.EXTRA_SECRET),
        node_options_present: Boolean(process.env.NODE_OPTIONS),
      }) + "\n",
    );
  if (args[0] === "auth" && args[1] === "identity-receipt") {
    append("auth");
    if (
      process.env.TIANGONG_LCA_AUTH_MODE !== "access_token" ||
      !process.env.TIANGONG_LCA_ACCESS_TOKEN ||
      process.env.TIANGONG_LCA_DISABLE_SESSION_CACHE !== "true" ||
      control.auth === "error"
    ) {
      process.stderr.write("Synthetic explicit headless admission rejected.\n");
      process.exitCode = 1;
      return true;
    }
    const userId = option(args, "--expected-user-id");
    process.stdout.write(
      JSON.stringify(
        testAuthIdentityReceipt({
          projectRef: option(args, "--expected-project-ref"),
          userId:
            control.auth === "wrong-account" ? "99999999-9999-4999-8999-999999999999" : userId,
          capturedAtUtc: new Date(
            Date.now() - (control.auth === "stale" ? 120_000 : 0),
          ).toISOString(),
          packageVersion: String(configuration.package_version),
          scopeOverrides: {
            session: {
              source: "access_token",
              cache_mode: "disabled",
              force_reauth: false,
              expires_at_utc: null,
            },
          },
        }),
      ) + "\n",
    );
    return true;
  }
  if (["flow", "process"].includes(args[0]) && args[1] === "identity-preflight") {
    append(args[0]);
    if (control.query === "interrupted") {
      process.stderr.write("Synthetic query transport interrupted.\n");
      process.exitCode = 2;
      return true;
    }
    const input = option(args, "--input"),
      outDir = option(args, "--out-dir");
    const request = object(JSON.parse(fs.readFileSync(input, "utf8")));
    const target = object(request.target);
    const payload = object(target.json ?? target);
    const key = args[0] === "flow" ? "flowDataSet" : "processDataSet";
    const dataset = key in payload ? object(payload[key]) : null;
    const information = dataset
      ? object(dataset[args[0] === "flow" ? "flowInformation" : "processInformation"])
      : null;
    const identity = information ? object(information.dataSetInformation) : null;
    const version = dataset
      ? object(object(dataset.administrativeInformation).publicationAndOwnership)[
          "common:dataSetVersion"
        ]
      : target.version;
    const reportFile = path.join(outDir, "outputs/identity-decision.json");
    const report = {
      schema_version: 1,
      generated_at_utc: new Date().toISOString(),
      kind: args[0],
      status: "needs_review",
      decision: "manual_review",
      target: { id: target.id ?? identity?.["common:UUID"], version: target.version ?? version },
      input_path: input,
      out_dir: outDir,
      files: { identity_decision: reportFile },
      candidates: [],
      candidate_sources: [],
      findings: [],
      blockers: [],
      next_action: "queue_manual_review",
      ok: true,
    };
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify(report) + "\n");
    const fresh = new Date(Date.now() + 1);
    fs.utimesSync(reportFile, fresh, fresh);
    process.stdout.write(JSON.stringify(report) + "\n");
    process.exitCode = 1;
    return true;
  }
  if (
    args.some((argument) =>
      ["insert", "save_draft", "commit", "publish", "delete"].includes(argument),
    )
  ) {
    append("forbidden-write");
    throw new Error("Synthetic managed transport forbids every business write.");
  }
  return false;
}
