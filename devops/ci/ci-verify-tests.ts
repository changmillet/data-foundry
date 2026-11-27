import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadFoundryTestPlan } from "./foundry-ci-plan.ts";
import { foundryCiPlatforms, verifyFoundryTestShards } from "./foundry-ci-results.ts";
import { readFoundryReleaseGit as git } from "../release/foundry-release-contract.ts";
import { readFoundryReleaseArtifact } from "../release/foundry-release-prepared.ts";

const root = path.resolve(import.meta.dirname, "../..");
function main(args: readonly string[]): void {
  const hasMode = args.length === 10 && args[8] === "--mode";
  if (
    (!hasMode && args.length !== 8) ||
    args[0] !== "--input" ||
    args[2] !== "--plan-sha256" ||
    args[4] !== "--source-sha" ||
    args[6] !== "--output"
  )
    throw new Error(
      "Usage: ci-verify-tests --input <directory> --plan-sha256 <sha256> --source-sha <commit> --output <new-file> [--mode <full|pr-fast>]",
    );
  const input = args[1],
    digest = args[3],
    source = args[5],
    output = args[7],
    mode = hasMode ? args[9] : "full";
  if (mode !== "full" && mode !== "pr-fast")
    throw new Error("Unsupported CI test verification mode.");
  if (
    mode === "pr-fast" &&
    (process.env.GITHUB_EVENT_NAME !== "pull_request" || Boolean(process.env.FOUNDRY_CI_SOURCE_SHA))
  )
    throw new Error("The pr-fast test verification mode is restricted to ordinary pull requests.");
  if (
    ![input, output].every((value) => path.isAbsolute(value)) ||
    !/^[0-9a-f]{64}$/u.test(digest) ||
    !/^[0-9a-f]{40}$/u.test(source)
  )
    throw new Error("CI verification requires absolute paths and exact digests.");
  if (
    git(root, ["rev-parse", "HEAD"]).trim() !== source ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("CI verification requires the exact clean source checkout.");
  const plan = loadFoundryTestPlan(root);
  if (plan.planSha256 !== digest)
    throw new Error("CI verification plan differs from the selected digest.");
  if (!fs.lstatSync(input).isDirectory() || fs.lstatSync(input).isSymbolicLink())
    throw new Error("CI test artifact root must be a real directory.");
  const records: unknown[] = [];
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error("CI test artifacts must be distinct real directories.");
    const receipt = path.join(input, entry.name, "test-shard.json");
    const value: unknown = JSON.parse(
      readFoundryReleaseArtifact(receipt, 1024 * 1024).toString("utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid CI test receipt.");
    const row = value as Record<string, unknown>;
    const events = readFoundryReleaseArtifact(
      path.join(input, entry.name, "test-events.jsonl"),
      32 * 1024 * 1024,
    );
    if (
      typeof row.test_events_sha256 !== "string" ||
      createHash("sha256").update(events).digest("hex") !== row.test_events_sha256
    )
      throw new Error("CI test events differ from their execution receipt.");
    records.push(row);
  }
  const selectedPlatforms = mode === "pr-fast" ? (["linux-x64"] as const) : foundryCiPlatforms;
  const summary = verifyFoundryTestShards(records, source, plan, selectedPlatforms);
  fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "CI verification failed."}\n`);
    process.exitCode = 1;
  }
}
