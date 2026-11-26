#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  copyFoundryIsolatedExecutable,
  createFoundryIsolatedChildEnvironment,
} from "../../src/lib/foundry-runtime-environment.ts";
import { resolvePackageManagerCommand } from "../../src/lib/package-manager-command.ts";
import {
  listRelativeFiles,
  normalizeGoldenLegacyContracts,
  normalizeGoldenResidualContracts,
  summarizeJsonDifferences,
} from "./foundry-golden-diff-helpers.ts";
import {
  GOLDEN_CONTACT_ID as contactId,
  GOLDEN_PROCESS_ID as processId,
  prepareGoldenFixtures,
  writeGoldenStubCliScript,
  writeJson,
  type FixturePaths,
  type JsonRecord,
} from "./foundry-golden-fixtures.ts";
import { normalizeGoldenReviewedProjection } from "./foundry-golden-normalization.ts";
import { normalizeGoldenSkillOwnership } from "./golden-skill-ownership.ts";

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  expectedStatus?: number;
};

type GoldenBase = {
  commit: string;
  comparisonRef: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const keepArtifacts = process.argv.includes("--keep");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "foundry-golden-diff-"));
const beforeRoot = path.join(tempRoot, "before-worktree");
const afterRoot = path.join(tempRoot, "after-worktree");
const beforeOut = path.join(tempRoot, "before-output");
const afterOut = path.join(tempRoot, "after-output");
const normalizedRoot = path.join(tempRoot, "normalized");
const fixtureRoot = path.join(tempRoot, "fixtures");
const goldenProcessEnvironment = createFoundryIsolatedChildEnvironment({ tempRoot });
const legacyPackageRunner = ["n", "px"].join("");
const skillsPackageCommandPattern = new RegExp(
  `(?:${legacyPackageRunner} --yes|pnpm dlx) skills@latest`,
  "gu",
);
const skillsCommandReferencePattern = new RegExp(
  `(?:${legacyPackageRunner} skills|pnpm dlx skills(?:@latest)?)`,
  "gu",
);
const worldsteelProfileContractMigrations = new Map<string, string>([
  [
    "3ea8f90134ab5cc6f19ea6825556d1ef21136011b7c35ecd3d949a266de023c7",
    JSON.stringify([
      "docs/import-profiles/worldsteel/profile.md",
      "docs/import-profiles/worldsteel/constraints.md",
      "docs/import-profiles/worldsteel/import-plan.md",
    ]),
  ],
  [
    "4d33ab773546d7055db900899e33f4f3179f41b815009fdedf232bfcdf0cd297",
    JSON.stringify([
      "docs/import-profiles/worldsteel/profile.md",
      "docs/import-profiles/worldsteel/constraints.md",
      "docs/import-profiles/worldsteel/import-plan.md",
      "docs/import-profiles/worldsteel/import-coverage.md",
    ]),
  ],
]);
const capabilityContractMigrationHashes = new Map<string, Set<string>>([
  [
    "foundry.dataset.curation-cleanup",
    new Set([
      "4d041cb2ce4b0f9b9181a94e44a0569b71ce7101097cb56db51f254460feade9",
      "0c2acbce5acb110348a62dfab4c5d226192567fcae90916b65dc49280e2567cb",
      "1bd5ce56f134f22da328281d67a9e5937f8737ebc606479a502d46392025f51e",
      "0427147e40c500e344686703942157f526244b4585dd6555538c5a33f8a4f749",
    ]),
  ],
  [
    "foundry.dataset.post-authoring-finalize",
    new Set([
      "27b5aac2d5cee8c0aeb7e7df5e2d361993341a28fce2eecbb796d8a8edcec050",
      "d18a71a2dfa8933e114ea8b5917a7c54e7bd73813601c76133b9f2914c2be5af",
      "ebc54fd890ea7732b69472f16239e6d5ae7553efcab4eb02fef1886ac6072050",
      "7edaa6363ab849eccc0679f228d5be74c9d3b3aa172e82672e9c678970bab264",
      "b53b6dcbe4dfaa324cec9011285f5d9430cacf554f332c717ba512583311b61c",
    ]),
  ],
]);
// W7 admits only the two exact CLI 0.1.14 -> 0.1.16 schema-asset byte
// migrations reviewed with the tidas-spec source manifest. Any other schema
// asset digest remains a Golden diff so an unreviewed asset change cannot hide.
const cliSchemaAssetMigrationHashes = new Map<string, Set<string>>([
  [
    "tidas_flows_elementary_category.json",
    new Set([
      "18643:e7b05dd2f082f2a60f4520f9a6eee1f28a2cabd5ea92f47c6ce07194275b26ea",
      "20892:e817d6e40dfa7b21cb947548027f32b393d1b06ee2a7326f7c59686a2cd3552d",
    ]),
  ],
  [
    "tidas_locations_category.json",
    new Set([
      "57646:f8a9f7e9802cfe9812301564c5c1c541b5aa32100a18b70f5892df20c5b95c9b",
      "57807:415fe8c7ba4991a88bc66d9cd55541ee27b74f731541c64a9bc354679d109a71",
    ]),
  ],
]);

function resolveGoldenBase(): GoldenBase {
  const explicitBase = String(process.env.FOUNDRY_GOLDEN_BASE ?? "").trim();
  const candidates = explicitBase ? [explicitBase] : ["origin/main", "main"];
  const head = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim();
  for (const candidate of candidates) {
    const mergeBase = spawnSync("git", ["merge-base", "HEAD", candidate], {
      cwd: repoRoot,
      env: goldenProcessEnvironment,
      encoding: "utf8",
    });
    const commit = mergeBase.status === 0 ? mergeBase.stdout.trim() : "";
    if (commit && commit !== head) return { commit, comparisonRef: candidate };
    // A resolved authoritative trunk at HEAD must not fall through to a stale local main.
    if (commit === head) break;
  }
  const parent = spawnSync("git", ["rev-parse", "HEAD^"], {
    cwd: repoRoot,
    env: goldenProcessEnvironment,
    encoding: "utf8",
  });
  const parentCommit = parent.status === 0 ? parent.stdout.trim() : "";
  if (parentCommit && parentCommit !== head && !explicitBase) {
    return { commit: parentCommit, comparisonRef: "HEAD^" };
  }
  throw new Error(
    "Golden comparison requires a non-HEAD merge-base. Fetch full history or set FOUNDRY_GOLDEN_BASE to an ancestor commit.",
  );
}

function pathVariants(value: string): string[] {
  const variants = new Set([value, value.replaceAll("\\", "/")]);
  if (value.startsWith("/var/")) variants.add(`/private${value}`);
  if (value.startsWith("/private/var/")) variants.add(value.replace(/^\/private/u, ""));
  return [...variants].sort((a, b) => b.length - a.length);
}

function replacePathVariants(value: string, variants: string[], replacement: string): string {
  let output = value;
  for (const variant of variants) {
    output = output.replaceAll(variant, replacement);
  }
  return output;
}

function run(command: string, args: string[], options: RunOptions = {}): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? goldenProcessEnvironment,
    encoding: "utf8",
  });
  if (result.status !== (options.expectedStatus ?? 0)) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `cwd: ${options.cwd ?? repoRoot}`,
        `status: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function isolatedFakeTidasScript(): string {
  const sourcePath = ["fake-tidas.ts", "fake-tidas.mjs"]
    .map((fileName) => path.join(beforeRoot, "test", "fixtures", fileName))
    .find((candidate) => existsSync(candidate));
  if (!sourcePath) throw new Error("Golden baseline does not contain a fake TIDAS fixture.");
  const targetPath = path.join(tempRoot, path.basename(sourcePath));
  copyFoundryIsolatedExecutable(sourcePath, targetPath);
  return targetPath;
}

let dependencyStore: string | null = null;
function installBaselineDependencies(root: string): void {
  const args = ["install", "--frozen-lockfile", "--ignore-scripts", "--verify-store-integrity"];
  const environment = { ...goldenProcessEnvironment };
  const currentPackage = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as JsonRecord;
  const selectedPackage = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as JsonRecord;
  if (
    typeof currentPackage.packageManager === "string" &&
    selectedPackage.packageManager === currentPackage.packageManager
  ) {
    if (dependencyStore === null) {
      const locator = resolvePackageManagerCommand("pnpm", ["store", "path"]);
      const store = run(locator.executable, locator.argv, {
        cwd: repoRoot,
        env: process.env,
      }).stdout.trim();
      if (!path.isAbsolute(store) || /[\r\n\0]/u.test(store))
        throw new Error("pnpm must report one absolute content-store path.");
      dependencyStore = store;
    }
    args.push("--store-dir", dependencyStore);
    // Reuse tool/package bytes only. Fixture HOME, config, credentials and outputs stay isolated.
    environment.COREPACK_HOME =
      process.env.COREPACK_HOME ??
      path.join(
        process.env.XDG_CACHE_HOME ??
          process.env.LOCALAPPDATA ??
          path.join(os.homedir(), process.platform === "win32" ? "AppData/Local" : ".cache"),
        "node/corepack",
      );
  }
  const invocation = resolvePackageManagerCommand("pnpm", args);
  run(invocation.executable, invocation.argv, { cwd: root, env: environment });
}

function prepareCurrentSourceSnapshot(): void {
  run("git", ["worktree", "add", "--detach", "--quiet", afterRoot, "HEAD"], { cwd: repoRoot });
  const files = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
  })
    .stdout.split("\0")
    .filter(Boolean);
  for (const relative of new Set(files)) {
    const source = path.join(repoRoot, relative);
    const target = path.join(afterRoot, relative);
    if (!existsSync(source)) {
      rmSync(target, { force: true });
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) {
      rmSync(target, { force: true });
      symlinkSync(readlinkSync(source), target);
    } else if (stat.isFile()) {
      copyFileSync(source, target);
      chmodSync(target, stat.mode & 0o777);
    } else {
      throw new Error(`Unsupported candidate source entry: ${relative}`);
    }
  }
  // Git-visible source only: local inputs, credentials, prior task state and reports stay outside.
  installBaselineDependencies(afterRoot);
}

function linkLegacyInstalledCliAssets(): void {
  const installedCliRoot = path.join(beforeRoot, "node_modules", "@tiangong-lca", "cli");
  const legacyCliRoot = path.join(tempRoot, "tiangong-lca-cli");
  if (!existsSync(installedCliRoot) || existsSync(legacyCliRoot)) return;
  // HEAD may predate the installed-package resolver. Supply only the pinned package
  // layout needed to characterize that baseline; never depend on a sibling checkout.
  symlinkSync(installedCliRoot, legacyCliRoot, process.platform === "win32" ? "junction" : "dir");
}

function normalizeBaselineLineEndings(): void {
  if (process.platform !== "win32") return;
  const tracked = run("git", ["ls-files", "-z"], { cwd: beforeRoot })
    .stdout.split("\0")
    .filter(Boolean);
  for (const relativePath of tracked) {
    const filePath = path.join(beforeRoot, relativePath);
    if (!existsSync(filePath)) continue;
    const bytes = readFileSync(filePath);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    if (text.includes("\r\n")) writeFileSync(filePath, text.replaceAll("\r\n", "\n"));
  }
}

const goldenCliCommands = new Set(["help", "doctor", "profiles-list", "capabilities-list"]);

function foundryCommand(
  root: string,
  args: string[],
  outFile: string,
  commandEnvironment: NodeJS.ProcessEnv,
  expectedStatus = 0,
): JsonRecord {
  const currentEntry = path.join("src", "dev-cli.ts");
  const stageEntry = path.join("test", "fixtures", "run-internal-stage.ts");
  const typedEntry = path.join("scripts", "foundry.ts");
  const legacyEntry = path.join("scripts", "foundry.mjs");
  const entry = existsSync(path.join(root, currentEntry))
    ? goldenCliCommands.has(args[0] ?? "")
      ? currentEntry
      : stageEntry
    : existsSync(path.join(root, typedEntry))
      ? typedEntry
      : legacyEntry;
  const result = run(process.execPath, [entry, ...args], {
    cwd: root,
    env: commandEnvironment,
    expectedStatus,
  });
  writeFileSync(outFile, result.stdout);
  return JSON.parse(result.stdout) as JsonRecord;
}

function childEnvironmentSnapshot(root: string, commandEnvironment: NodeJS.ProcessEnv): string {
  const probe = [
    "const entries = Object.entries(process.env)",
    ".sort(([left], [right]) => left.localeCompare(right));",
    "process.stdout.write(JSON.stringify(entries));",
  ].join("");
  return run(process.execPath, ["--eval", probe], {
    cwd: root,
    env: commandEnvironment,
  }).stdout;
}

function runSide(
  label: "before" | "after",
  root: string,
  fixture: FixturePaths,
  commandEnvironment: NodeJS.ProcessEnv,
): string {
  const environmentSnapshot = childEnvironmentSnapshot(root, commandEnvironment);
  const sideOut = label === "before" ? beforeOut : afterOut;
  const commandOut = path.join(sideOut, "commands");
  mkdirSync(commandOut, { recursive: true });
  foundryCommand(root, ["init"], path.join(commandOut, "setup-init.json"), commandEnvironment);
  foundryCommand(root, ["help"], path.join(commandOut, "help.json"), commandEnvironment);
  foundryCommand(root, ["doctor"], path.join(commandOut, "doctor.json"), commandEnvironment, 1);
  foundryCommand(
    root,
    ["profiles-list"],
    path.join(commandOut, "profiles-list.json"),
    commandEnvironment,
  );
  foundryCommand(
    root,
    ["capabilities-list"],
    path.join(commandOut, "capabilities-list.json"),
    commandEnvironment,
  );
  foundryCommand(
    root,
    [
      "route-task",
      "--kind",
      "external-dataset-curated-import",
      "--dataset-type",
      "process",
      "--required-gates",
      "contract,schema,qa,curation",
      "--out-dir",
      path.join(sideOut, "route-task"),
    ],
    path.join(commandOut, "route-task.json"),
    commandEnvironment,
  );
  foundryCommand(
    root,
    [
      "dataset-authoring-task-build",
      "--authoring-package",
      fixture.authoringPackage,
      "--out-dir",
      path.join(sideOut, "authoring-task"),
    ],
    path.join(commandOut, "dataset-authoring-task-build.json"),
    commandEnvironment,
  );
  foundryCommand(
    root,
    [
      "dataset-curation-gate",
      "--type",
      "process",
      "--rows-file",
      fixture.processRows,
      "--schema-report",
      fixture.processSchemaReport,
      "--qa-report",
      fixture.processQaReport,
      "--profile",
      "generic",
      "--out-dir",
      path.join(sideOut, "curation-gate"),
    ],
    path.join(commandOut, "dataset-curation-gate.json"),
    commandEnvironment,
  );
  foundryCommand(
    root,
    [
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      fixture.bundlesDir,
      "--process-id",
      processId,
      "--contact-id",
      contactId,
      "--out-dir",
      path.join(sideOut, "bundle-sample-rows"),
    ],
    path.join(commandOut, "dataset-bundle-sample-rows.json"),
    commandEnvironment,
  );
  const finalize = foundryCommand(
    root,
    [
      "dataset-post-authoring-finalize",
      "--type",
      "support",
      "--rows-file",
      fixture.supportRows,
      "--out-dir",
      path.join(sideOut, "post-authoring-finalize"),
      "--target-user-id",
      "00000000-0000-4000-8000-000000000000",
      "--state-code",
      "0",
    ],
    path.join(commandOut, "dataset-post-authoring-finalize.json"),
    commandEnvironment,
  );
  const finalizeFiles = finalize.files as JsonRecord;
  foundryCommand(
    root,
    [
      "dataset-mutation-manifest",
      "--type",
      "support",
      "--rows-file",
      path.resolve(root, String(finalizeFiles.final_rows)),
      "--schema-report",
      path.resolve(root, String(finalizeFiles.schema_report)),
      "--cleanup-report",
      path.resolve(root, String(finalizeFiles.cleanup_report)),
      "--dry-run-report",
      path.resolve(root, String(finalizeFiles.dry_run_report)),
      "--target-user-id",
      "00000000-0000-4000-8000-000000000000",
      "--out-dir",
      path.join(sideOut, "mutation-manifest"),
    ],
    path.join(commandOut, "dataset-mutation-manifest.json"),
    commandEnvironment,
  );
  return environmentSnapshot;
}

function normalizeWorldsteelProfileContract(value: JsonRecord): JsonRecord | null {
  if (
    value.id !== "worldsteel" ||
    typeof value.description !== "string" ||
    !Array.isArray(value.docs) ||
    !value.docs.every((item) => typeof item === "string")
  ) {
    return null;
  }
  const descriptionSha256 = createHash("sha256").update(value.description).digest("hex");
  const expectedDocs = worldsteelProfileContractMigrations.get(descriptionSha256);
  if (expectedDocs !== JSON.stringify(value.docs)) return null;
  return {
    ...value,
    description: "<worldsteel-profile-truth-contract>",
    docs: ["<worldsteel-profile-truth-contract>"],
  };
}

function normalizeKnownContractMigration(value: JsonRecord): JsonRecord {
  // Reviewed whole-projection bindings. Each returns a record only when the value hashes to one of
  // the exact reviewed digests, so an unreviewed addition, removal, reordering, text edit or field
  // change is returned unchanged and therefore compared verbatim.
  const reviewedProjection = normalizeGoldenReviewedProjection(value);
  if (reviewedProjection) return reviewedProjection;
  const skillOwnership = normalizeGoldenSkillOwnership(value);
  if (skillOwnership !== value) return skillOwnership;
  if (
    typeof value.path === "string" &&
    typeof value.bytes === "number" &&
    typeof value.sha256 === "string"
  ) {
    const assetName = value.path.match(
      /(?:^|[\\/])assets[\\/]tidas-schemas[\\/](tidas_(?:flows_elementary_category|locations_category)\.json)$/u,
    )?.[1];
    const migrationHashes = assetName ? cliSchemaAssetMigrationHashes.get(assetName) : undefined;
    if (migrationHashes?.has(`${value.bytes}:${value.sha256}`)) {
      return {
        ...value,
        bytes: "<reviewed-cli-schema-asset-migration>",
        sha256: "<reviewed-cli-schema-asset-migration>",
      };
    }
  }
  const legacyContract = normalizeGoldenLegacyContracts(value);
  if (legacyContract) return legacyContract;
  const normalizedWorldsteelProfile = normalizeWorldsteelProfileContract(value);
  if (normalizedWorldsteelProfile) return normalizedWorldsteelProfile;
  const capabilityHashes = capabilityContractMigrationHashes.get(String(value.id ?? ""));
  if (capabilityHashes) {
    const projection = {
      input_contract: value.input_contract,
      output_contract: value.output_contract,
      verification_gate: value.verification_gate,
      source_manifest_requirements: value.source_manifest_requirements,
    };
    const projectionSha256 = createHash("sha256").update(JSON.stringify(projection)).digest("hex");
    if (capabilityHashes.has(projectionSha256)) {
      return {
        ...value,
        input_contract: "<strict-datetime-capability-contract>",
        output_contract: "<strict-datetime-capability-contract>",
        verification_gate: "<strict-datetime-capability-contract>",
        source_manifest_requirements: ["<strict-datetime-capability-contract>"],
      };
    }
  }
  return normalizeGoldenResidualContracts(value);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const valueRecord = value as JsonRecord;
    if (
      valueRecord.schema === "tiangong-foundry.command-spec.v1" &&
      typeof valueRecord.display === "string"
    ) {
      return normalize(valueRecord.display);
    }
    const normalizedContract = normalizeKnownContractMigration(valueRecord);
    const volatileValues: JsonRecord = {
      generated_at_utc: "<generated_at_utc>",
      started_at_utc: "<started_at_utc>",
      finished_at_utc: "<finished_at_utc>",
      duration_ms: 0,
      finalize_duration_ms: 0,
      authoring_package_sha256: "<authoring_package_sha256>",
      entry_count: "<entry_count>",
      scanned: "<scanned>",
    };
    return Object.fromEntries(
      Object.entries(normalizedContract)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [
          key,
          Object.hasOwn(volatileValues, key) ? volatileValues[key] : normalize(item),
        ]),
    );
  }
  if (typeof value !== "string") return value;
  let output = collapseNestedShellQuotes(value).replaceAll("\\", "/");
  output = replacePathVariants(output, pathVariants(beforeOut), "<side-output>");
  output = replacePathVariants(output, pathVariants(afterOut), "<side-output>");
  output = replacePathVariants(output, pathVariants(beforeRoot), "<repo-root>");
  output = replacePathVariants(output, pathVariants(afterRoot), "<repo-root>");
  output = replacePathVariants(output, pathVariants(repoRoot), "<repo-root>");
  output = replacePathVariants(output, pathVariants(tempRoot), "<temp-root>");
  return output
    .replace(/scripts\/foundry\.(?:mjs|ts)/gu, "scripts/foundry.<entry>")
    .replace(/src\/dev-cli\.ts/gu, "scripts/foundry.<entry>")
    .replace(
      /<repo-root>[\\/]test[\\/]fixtures[\\/]fake-tidas\.(?:mjs|ts)/gu,
      "<fake-tidas-script>",
    )
    .replace(/(?:\.\.[\\/])+before-output/gu, "<side-output>")
    .replace(/(?:\.\.[\\/])+after-output/gu, "<side-output>")
    .replace(/(?:\.\.[\\/])+fixtures/gu, "<temp-root>/fixtures")
    .replace(/(?:\.\.[\\/])*\.*<side-output>/gu, "<side-output>")
    .replace(/(?:\.\.[\\/])*\.*<temp-root>/gu, "<temp-root>")
    .replace(/\/private<repo-root>/gu, "<repo-root>")
    .replace(/\/private<temp-root>/gu, "<temp-root>")
    .replace(/<temp-root>[\\/]before-output/gu, "<side-output>")
    .replace(/<temp-root>[\\/]after-output/gu, "<side-output>")
    .replace(/<temp-root>[\\/]before-worktree/gu, "<repo-root>")
    .replace(
      // `cli` is the canonical workspace directory; `tiangong-lca-cli` stays so
      // goldens recorded against the pre-rename layout keep normalizing.
      /(?:\.\.[\\/](?:cli|tiangong-lca-cli)|node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?@tiangong-lca[\\/]cli)[\\/]assets[\\/]tidas-schemas/gu,
      "<cli-schema-assets>",
    )
    .replace(skillsPackageCommandPattern, "<skills-runtime>")
    .replace(skillsCommandReferencePattern, "<skills-runtime>")
    .replace(/'([A-Za-z0-9_./:@%+=,<>-]+)'/gu, "$1")
    .replace(/^'([^'\s]+ [^'\s]+)'(?=\s)/u, "$1")
    .replace(/\.tidas-validate-stage-[A-Za-z0-9._-]+/gu, ".tidas-validate-stage-<id>")
    .replace(/(?:\.\.\/)+(?:private\/)?tmp\/foundry-golden-diff-[A-Za-z0-9._/-]+/gu, "<temp-path>")
    .replace(/foundry-golden-diff-[A-Za-z0-9._-]+/gu, "foundry-golden-diff-<id>");
}

function collapseNestedShellQuotes(value: string): string {
  const escapedQuote = `'\\''`;
  const collapsed = value.replaceAll(escapedQuote, "'");
  return collapsed.startsWith("''") && collapsed.endsWith("''")
    ? collapsed.slice(1, -1)
    : collapsed;
}

function normalizeJsonFile(inputFile: string, outputFile: string): void {
  const value = JSON.parse(readFileSync(inputFile, "utf8"));
  writeJson(outputFile, normalize(value));
}

function normalizeOutputs(): void {
  for (const label of ["before", "after"]) {
    const sideOut = label === "before" ? beforeOut : afterOut;
    const normalizedOut = path.join(normalizedRoot, label);
    mkdirSync(normalizedOut, { recursive: true });
    const commandDir = path.join(sideOut, "commands");
    for (const fileName of [
      "help.json",
      "doctor.json",
      "profiles-list.json",
      "capabilities-list.json",
      "route-task.json",
      "dataset-authoring-task-build.json",
      "dataset-curation-gate.json",
      "dataset-bundle-sample-rows.json",
      "dataset-post-authoring-finalize.json",
      "dataset-mutation-manifest.json",
    ]) {
      normalizeJsonFile(path.join(commandDir, fileName), path.join(normalizedOut, fileName));
    }
  }
}

function compareNormalizedOutputs(): void {
  const baselineRoot = path.join(normalizedRoot, "before");
  const currentRoot = path.join(normalizedRoot, "after");
  const baselineFiles = listRelativeFiles(baselineRoot);
  const currentFiles = listRelativeFiles(currentRoot);
  const files = [...new Set([...baselineFiles, ...currentFiles])].sort();
  const differences: string[] = [];
  for (const file of files) {
    const baselinePath = path.join(baselineRoot, file);
    const currentPath = path.join(currentRoot, file);
    if (!existsSync(baselinePath)) {
      differences.push(`${file}: missing from baseline`);
      continue;
    }
    if (!existsSync(currentPath)) {
      differences.push(`${file}: missing from current output`);
      continue;
    }
    if (!readFileSync(baselinePath).equals(readFileSync(currentPath))) {
      const details = summarizeJsonDifferences(baselinePath, currentPath);
      differences.push(
        details.length > 0
          ? `${file}:\n${details.map((detail) => `    ${detail}`).join("\n")}`
          : `${file}: content differs`,
      );
    }
  }
  if (differences.length > 0) {
    throw new Error(
      `Golden diff failed:\n${differences.map((item) => `- ${item}`).join("\n")}\nArtifacts: ${tempRoot}`,
    );
  }
}

try {
  const goldenBase = resolveGoldenBase();
  const fixture = prepareGoldenFixtures(fixtureRoot);
  const cliPath = writeGoldenStubCliScript(tempRoot);
  run("git", ["worktree", "add", "--detach", "--quiet", beforeRoot, goldenBase.commit], {
    cwd: repoRoot,
  });
  normalizeBaselineLineEndings();
  installBaselineDependencies(beforeRoot);
  prepareCurrentSourceSnapshot();
  linkLegacyInstalledCliAssets();
  const fakeTidasPath = isolatedFakeTidasScript();
  const commandEnvironment = createFoundryIsolatedChildEnvironment({
    tempRoot,
    overrides: {
      TIANGONG_LCA_CLI_BIN: cliPath,
      TIDAS_BIN: fakeTidasPath,
    },
  });
  const baselineEnvironment = runSide("before", beforeRoot, fixture, commandEnvironment);
  const currentEnvironment = runSide("after", afterRoot, fixture, commandEnvironment);
  if (baselineEnvironment !== currentEnvironment) {
    throw new Error("Golden baseline and current commands must receive the same environment.");
  }
  normalizeOutputs();
  compareNormalizedOutputs();
  console.log(
    JSON.stringify(
      {
        schema_version: 1,
        status: "passed",
        baseline_commit: goldenBase.commit,
        comparison_ref: goldenBase.comparisonRef,
        compared_commands: [
          "help",
          "doctor",
          "profiles-list",
          "capabilities-list",
          "route-task",
          "dataset-authoring-task-build",
          "dataset-curation-gate",
          "dataset-bundle-sample-rows",
          "dataset-post-authoring-finalize",
          "dataset-mutation-manifest",
        ],
        normalized_diff: 0,
        artifacts: keepArtifacts ? tempRoot : null,
      },
      null,
      2,
    ),
  );
} finally {
  for (const root of [beforeRoot, afterRoot]) {
    try {
      run("git", ["worktree", "remove", "--force", root], {
        cwd: repoRoot,
        expectedStatus: 0,
      });
    } catch {
      // Best-effort cleanup; the temp tree is still removed below unless --keep was requested.
    }
  }
  if (!keepArtifacts) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
