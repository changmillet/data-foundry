import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  inspectRuntimeComponents,
  trustRuntimeManifest,
  type CliRuntimeDescriptor,
} from "@tiangong-lca/cli/runtime";
import type { FoundryPackageDescriptor } from "./foundry-package-contract.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import {
  foundryComponentHash as hash,
  foundryComponentJson as json,
  freezeFoundryReleaseValue,
  writeFoundryComponentFile,
} from "./foundry-release-component-io.ts";
import { verifyEvidence } from "./foundry-task-runtime-adoption.ts";
import { FOUNDRY_MANAGED_RUNTIME_PATH } from "./foundry-managed-host.ts";

export interface FoundryAdoptionFileFact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface FoundryAdoptionRuntimeSelection {
  readonly manifest: FoundryAdoptionFileFact;
  readonly cache_dir: string;
}
export function adoptionFileFact(file: string, limit = 32 * 1024 * 1024): FoundryAdoptionFileFact {
  if (!path.isAbsolute(file)) throw new Error("Adoption evidence requires an absolute file.");
  const bytes = readFoundryReleaseArtifact(file, limit);
  return Object.freeze({ path: file, bytes: bytes.length, sha256: hash(bytes) });
}
export function readAdoptionJson(fact: FoundryAdoptionFileFact): unknown {
  verifyEvidence([fact]);
  return JSON.parse(readFoundryReleaseArtifact(fact.path, 32 * 1024 * 1024).toString("utf8"));
}
export function adoptionObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Adoption preparation requires an object.");
  return value as Record<string, unknown>;
}
export function parseAdoptionRuntimeSelection(value: unknown): FoundryAdoptionRuntimeSelection {
  const selected = adoptionObject(value);
  if (
    Object.keys(selected).sort().join(",") !== "cache_dir,manifest" ||
    typeof selected.cache_dir !== "string" ||
    !path.isAbsolute(selected.cache_dir)
  )
    throw new Error("Adoption runtime selection requires exact manifest facts and absolute cache.");
  const manifest = verifyEvidence([selected.manifest])[0];
  return { manifest, cache_dir: selected.cache_dir };
}

/** Mechanical installed facts only. Inspection never issues compatibility or task authority. */
export function inspectFoundryAdoptionRuntime(selection: FoundryAdoptionRuntimeSelection) {
  verifyEvidence([selection.manifest]);
  const manifest = trustRuntimeManifest(
    readFoundryReleaseArtifact(selection.manifest.path, 32 * 1024 * 1024),
    selection.manifest.sha256,
  );
  const inspected = inspectRuntimeComponents(manifest, { cacheDir: selection.cache_dir });
  if (inspected.status !== "ready")
    throw new Error("Adoption runtime requires complete verified cached components.");
  const componentRoot = (id: string) => {
    const item = inspected.components.find((component) => component.id === id);
    if (!item) throw new Error("Adoption runtime lacks a required complete component.");
    return item.root;
  };
  const application = manifest.manifest.components.find(
    (component) =>
      component.id === "foundry" && component.platform === `${process.platform}-${process.arch}`,
  );
  if (!application) throw new Error("Adoption runtime lacks its Foundry application.");
  const applicationRoot = componentRoot(application.id);
  const packageRoot = path.join(applicationRoot, "node_modules/@tiangong-lca/foundry");
  const descriptor = JSON.parse(
    readFoundryReleaseArtifact(
      path.join(packageRoot, "package-dist/assets/foundry-package-descriptor.json"),
      8 * 1024 * 1024,
    ).toString("utf8"),
  ) as FoundryPackageDescriptor;
  const packagePrefix = "node_modules/@tiangong-lca/foundry/";
  const inventory = application.files
    .filter(
      (file) =>
        file.path.startsWith(packagePrefix) &&
        ![
          `${packagePrefix}package.json`,
          `${packagePrefix}package-dist/assets/foundry-package-descriptor.json`,
        ].includes(file.path),
    )
    .map(({ path: file, bytes, sha256 }) => ({
      path: file.slice(packagePrefix.length),
      bytes,
      sha256,
    }));
  if (
    descriptor.schema !== "tiangong-foundry.package-descriptor.v1" ||
    !Array.isArray(descriptor.files) ||
    descriptor.files_sha256 !== sha256Json(descriptor.files) ||
    sha256Json(descriptor.files) !== sha256Json(inventory)
  )
    throw new Error(
      "Adoption descriptor must bind the complete inventory of its retained installed package.",
    );
  const entry = adoptionFileFact(path.join(packageRoot, "package-dist/scripts/package-entry.js"));
  const descriptorFact = adoptionFileFact(
    path.join(packageRoot, "package-dist/assets/foundry-package-descriptor.json"),
  );
  const packageFact = adoptionFileFact(path.join(packageRoot, "package.json"));
  const managedPath = path.join(applicationRoot, FOUNDRY_MANAGED_RUNTIME_PATH);
  const managed = adoptionObject(
    JSON.parse(readFoundryReleaseArtifact(managedPath, 256 * 1024).toString("utf8")),
  );
  const cliExpectation = adoptionObject(managed.cli);
  const nodePath = path.join(
    componentRoot("node"),
    process.platform === "win32" ? "bin/node.exe" : "bin/node",
  );
  const observed = spawnSync(
    nodePath,
    [
      "--input-type=module",
      "-e",
      'import {describeCliRuntime} from "@tiangong-lca/cli/runtime";process.stdout.write(JSON.stringify(describeCliRuntime()));',
    ],
    {
      cwd: packageRoot,
      env: Object.fromEntries(
        ["SystemRoot", "WINDIR", "PATHEXT"].flatMap((key) =>
          process.env[key] === undefined ? [] : [[key, process.env[key]]],
        ),
      ),
      shell: false,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (observed.error || observed.status !== 0 || observed.signal || observed.stderr)
    throw new Error("Adoption runtime public CLI inspection failed.");
  const cli = JSON.parse(observed.stdout) as CliRuntimeDescriptor;
  const expectation = {
    schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
    package_version: cli.package.version,
    platform: cli.platform,
    content_sha256: cli.content_sha256,
    node_version: cli.node.version,
    node_sha256: cli.node.sha256,
  };
  if (
    sha256Json(expectation) !== sha256Json(cliExpectation) ||
    hash(Buffer.from(JSON.stringify(cli.files))) !== cli.content_sha256
  )
    throw new Error("Adoption CLI/Node observation differs from inventory-bound managed metadata.");
  const tidas = adoptionObject(managed.tidas);
  const executable = adoptionObject(tidas.executable);
  if (typeof executable.component !== "string" || typeof executable.path !== "string")
    throw new Error("Adoption Toolkit executable binding is invalid.");
  const toolkit = adoptionFileFact(
    path.join(componentRoot(executable.component), executable.path),
    512 * 1024 * 1024,
  );
  const toolkitExpectation = adoptionObject(tidas.expectation);
  const toolkitExecutable = adoptionObject(toolkitExpectation.executable);
  if (toolkit.bytes !== toolkitExecutable.bytes || toolkit.sha256 !== toolkitExecutable.sha256)
    throw new Error("Adoption Toolkit differs from its inventory-bound expectation.");
  if (inspectRuntimeComponents(manifest, { cacheDir: selection.cache_dir }).status !== "ready")
    throw new Error("Adoption components changed during installed inspection.");
  verifyEvidence([selection.manifest, entry, descriptorFact, packageFact, toolkit]);
  return freezeFoundryReleaseValue({
    selection,
    runtime: {
      package_name: descriptor.package.name,
      package_version: descriptor.package.version,
      manifest_sha256: packageFact.sha256,
      entry_sha256: entry.sha256,
    },
    entry,
    descriptor: descriptorFact,
    package_inventory: descriptor,
    cli: { expectation, files: cli.files },
    node: adoptionFileFact(nodePath, 512 * 1024 * 1024),
    toolkit: { executable: toolkit, expectation: toolkitExpectation },
    installed_platform: inspected.platform,
    components: manifest.manifest.components.map((component) => ({
      component,
      cache:
        component.platform === inspected.platform
          ? inspected.components.find((item) => item.id === component.id)!
          : null,
    })),
    workspace: manifest.manifest.workspace,
    launches: manifest.manifest.launches,
    access_ceiling: managed.launches,
  });
}
export type FoundryAdoptionRuntimeFacts = ReturnType<typeof inspectFoundryAdoptionRuntime>;
export function assertFoundryAdoptionCompatibleDependencies(
  original: FoundryAdoptionRuntimeFacts,
  successor: FoundryAdoptionRuntimeFacts,
) {
  if (sha256Json(original.access_ceiling) !== sha256Json(successor.access_ceiling))
    throw new Error(
      "Adoption successor must preserve the original exact managed launch access ceiling.",
    );
  if (
    original.cli.expectation.platform !== successor.cli.expectation.platform ||
    original.node.bytes !== successor.node.bytes ||
    original.node.sha256 !== successor.node.sha256 ||
    original.cli.expectation.node_version !== successor.cli.expectation.node_version ||
    original.toolkit.executable.bytes !== successor.toolkit.executable.bytes ||
    original.toolkit.executable.sha256 !== successor.toolkit.executable.sha256 ||
    JSON.stringify(original.toolkit.expectation) !== JSON.stringify(successor.toolkit.expectation)
  )
    throw new Error(
      "Adoption preparation permits only Foundry/CLI changes with the same exact Node/Toolkit.",
    );
}
export function createFoundryAdoptionReviewRequest(
  output: string,
  originalSelection: FoundryAdoptionRuntimeSelection,
  successorSelection: FoundryAdoptionRuntimeSelection,
) {
  const original = inspectFoundryAdoptionRuntime(originalSelection);
  const successor = inspectFoundryAdoptionRuntime(successorSelection);
  assertFoundryAdoptionCompatibleDependencies(original, successor);
  const request = freezeFoundryReleaseValue({
    schema: "tiangong-foundry.runtime-adoption-review-request.v1",
    purpose: "independent-exact-runtime-compatibility-review",
    allowed_changes: ["foundry", "cli"],
    original,
    successor,
    original_facts_sha256: hash(json(original)),
    successor_facts_sha256: hash(json(successor)),
    limits: [
      "Mechanical facts grant no compatibility, authentication, task, scientific or write authority.",
      "Independent technical review must assess these exact complete old/new programs before Q is generated.",
    ],
  });
  const fact = writeFoundryComponentFile(output, "adoption-review-request.json", json(request));
  return {
    request,
    fact: { path: path.join(output, fact.path), bytes: fact.bytes, sha256: fact.sha256 },
  };
}
