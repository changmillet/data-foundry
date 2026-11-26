import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { migrationCredentialPath } from "./foundry-private-path.ts";
import fs from "node:fs";
import path from "node:path";
import { assertCliRuntimeMatches } from "@tiangong-lca/cli/runtime";
import type { FoundryRuntimeContext, FoundryInputFact } from "./foundry-runtime-context.ts";
import { digest, exact, fail, facts, object } from "./foundry-task-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  transferFileContentFact,
  transferFileFact,
  transferPath,
  transferRead,
} from "./foundry-migration-transfer-io.ts";
import { createRequire } from "node:module";
import type { TaskRuntimeIdentity } from "./foundry-task-types.ts";

export interface TrustedFoundryRuntimeAdoptionQualification {
  readonly sha256: string;
  readonly value: Readonly<Record<string, unknown>>;
}

export interface RetainedAdoptionRuntime {
  readonly root: string;
  readonly identity: TaskRuntimeIdentity;
  readonly entry: FoundryInputFact;
  readonly descriptor: FoundryInputFact;
}

const trustedQualifications = new WeakSet<object>();

export const currentPackageEntryPath = "package-dist/src/package-entry.js";
export const compatibleRetainedPackageEntries = new Set([
  currentPackageEntryPath,
  "package-dist/scripts/package-entry.js",
]);

export function currentAdoptionRuntime(context: FoundryRuntimeContext): TaskRuntimeIdentity {
  return {
    package_name: context.runtime.packageName,
    package_version: context.runtime.packageVersion,
    manifest_sha256: context.runtime.packageManifestSha256,
    entry_sha256: context.runtime.entrySha256,
  };
}

/** The independent host supplies the expected digest; task input cannot grant compatibility. */
export function createFoundryRuntimeAdoptionQualification(input: {
  bytes: Uint8Array;
  expectedSha256: string;
}): TrustedFoundryRuntimeAdoptionQualification {
  const data = Buffer.from(input.bytes);
  if (
    data.length > 8 * 1024 * 1024 ||
    !/^[0-9a-f]{64}$/u.test(input.expectedSha256) ||
    digest(data) !== input.expectedSha256
  )
    fail(
      "runtime_adoption_qualification_untrusted",
      "Qualification must match the host's independently reviewed digest.",
    );
  const value = object(JSON.parse(data.toString("utf8")));
  qualificationShape(value);
  const result = Object.freeze({ sha256: sha256Json(value), value: deepFreeze(value) });
  trustedQualifications.add(result);
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function assertTrustedQualification(
  selection: unknown,
  trusted?: TrustedFoundryRuntimeAdoptionQualification,
) {
  if (
    !trusted ||
    !trustedQualifications.has(trusted) ||
    sha256Json(object(selection).qualification) !== trusted.sha256
  )
    fail(
      "runtime_adoption_qualification_untrusted",
      "Plan/apply require an independently selected host qualification; ordinary input is not authority.",
    );
}

export function verifyEvidence(value: unknown) {
  const selected = facts(value);
  if (!selected.length || selected.length > 64)
    fail("runtime_adoption_evidence_invalid", "Select bounded nonempty qualification evidence.");
  for (const fact of selected) {
    if (!path.isAbsolute(fact.path) || migrationCredentialPath(fact.path))
      fail("runtime_adoption_evidence_invalid", "Evidence must name absolute regular files.");
    const content = transferRead(fact.path, 512 * 1024 * 1024);
    if (content.length !== fact.bytes || digest(content) !== fact.sha256)
      fail("runtime_adoption_evidence_changed", "Adoption evidence or retained input changed.");
  }
  return selected;
}

function qualificationShape(value: Record<string, unknown>) {
  exact(value, [
    "schema",
    "original_runtime",
    "successor_runtime",
    "original_manifest_sha256",
    "successor_manifest_sha256",
    "original_cli",
    "successor_cli",
    "tidas",
    "reviewer",
    "evidence",
    "allowed_changes",
    "runtime_manifests",
    "original_descriptor_sha256",
    "successor_descriptor_sha256",
  ]);
  if (
    value.schema !== "tiangong-foundry.runtime-adoption-qualification.v1" ||
    typeof value.reviewer !== "string" ||
    !value.reviewer.trim() ||
    JSON.stringify(value.allowed_changes) !== '["foundry","cli"]' ||
    ![value.original_manifest_sha256, value.successor_manifest_sha256].every(
      (item) => typeof item === "string" && /^[0-9a-f]{64}$/u.test(item),
    )
  )
    fail(
      "runtime_adoption_qualification_invalid",
      "Require reviewed exact manifests and only the qualified Foundry/CLI change.",
    );
}

export function validateAdoptionQualification(
  context: FoundryRuntimeContext,
  selection: Record<string, unknown>,
  originalEntry: string,
  successor: RetainedAdoptionRuntime,
  historical = false,
) {
  const value = object(selection.qualification);
  qualificationShape(value);
  if (
    sha256Json(value.original_runtime) !== sha256Json(selection.original_runtime) ||
    sha256Json(value.successor_runtime) !== sha256Json(successor.identity) ||
    (!historical && context.workspaceManifestSha256 !== value.successor_manifest_sha256)
  )
    fail(
      "runtime_adoption_qualification_mismatch",
      "Compatibility must bind the original identity and independently selected executing manifest.",
    );
  const originalDescriptor = facts([selection.original_descriptor])[0];
  if (
    (!historical && context.runtime.entryRepoRelativePath !== currentPackageEntryPath) ||
    originalDescriptor.sha256 !== value.original_descriptor_sha256 ||
    successor.descriptor.sha256 !== value.successor_descriptor_sha256
  )
    fail(
      "runtime_adoption_qualification_mismatch",
      "Adoption requires the independently qualified complete old/new installed package inventories.",
    );
  verifyEvidence(value.evidence);
  const manifests = verifyEvidence(value.runtime_manifests);
  if (
    manifests.length !== 2 ||
    manifests[0].sha256 !== value.original_manifest_sha256 ||
    manifests[1].sha256 !== value.successor_manifest_sha256
  )
    fail(
      "runtime_adoption_qualification_mismatch",
      "Retained product manifests differ from the qualified pair.",
    );
  const oldCli = object(value.original_cli),
    newCli = object(value.successor_cli);
  exact(oldCli, ["expectation", "files"]);
  exact(newCli, ["expectation", "files"]);
  if (!historical) {
    const current = assertCliRuntimeMatches(newCli.expectation);
    if (sha256Json(current.files) !== sha256Json(newCli.files))
      fail(
        "runtime_adoption_dependency_changed",
        "Successor CLI inventory differs from the qualified exact combination.",
      );
  }
  const oldExpectation = object(oldCli.expectation),
    newExpectation = object(newCli.expectation);
  exact(oldExpectation, [
    "schema",
    "package_version",
    "platform",
    "content_sha256",
    "node_version",
    "node_sha256",
  ]);
  if (
    oldExpectation.schema !== "tiangong-lca.cli-runtime-expectation.v1" ||
    oldExpectation.node_version !== newExpectation.node_version ||
    oldExpectation.node_sha256 !== newExpectation.node_sha256 ||
    oldExpectation.platform !== newExpectation.platform
  )
    fail(
      "runtime_adoption_dependency_changed",
      "Node and platform must remain unchanged in this compatibility protocol.",
    );
  verifyRetainedCli(originalEntry, oldCli);
  verifyRetainedCli(successor.entry.path, newCli);
  const tidas = verifyEvidence(value.tidas);
  if (
    tidas.length !== 2 ||
    tidas[0].sha256 !== tidas[1].sha256 ||
    tidas[0].bytes !== tidas[1].bytes
  )
    fail(
      "runtime_adoption_dependency_changed",
      "Original and successor Toolkit must retain identical executable bytes.",
    );
}

export function verifyRetainedCli(entry: string, claim: Record<string, unknown>) {
  const expectation = object(claim.expectation);
  exact(expectation, [
    "schema",
    "package_version",
    "platform",
    "content_sha256",
    "node_version",
    "node_sha256",
  ]);
  if (
    expectation.schema !== "tiangong-lca.cli-runtime-expectation.v1" ||
    typeof expectation.package_version !== "string" ||
    typeof expectation.platform !== "string" ||
    typeof expectation.node_version !== "string" ||
    ![expectation.node_sha256, expectation.content_sha256].every(
      (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value),
    )
  )
    fail("runtime_adoption_dependency_changed", "Retained CLI expectation is invalid.");
  const originalCliRoot = (createRequire(entry).resolve.paths("@tiangong-lca/cli") ?? [])
    .map((directory) => path.join(directory, "@tiangong-lca/cli"))
    .find((directory) => fs.existsSync(path.join(directory, "package.json")));
  if (!originalCliRoot)
    fail("runtime_adoption_dependency_changed", "Original CLI dependency is unavailable.");
  const oldRoot = fs.realpathSync(originalCliRoot);
  const oldFiles = facts(claim.files);
  if (
    !oldFiles.length ||
    oldFiles.length > 10000 ||
    digest(JSON.stringify(oldFiles)) !== expectation.content_sha256
  )
    fail(
      "runtime_adoption_dependency_changed",
      "Original CLI inventory does not match its independent expectation.",
    );
  for (const fact of oldFiles) {
    const previous = transferFileContentFact(transferPath(oldRoot, fact.path));
    if (previous.bytes !== fact.bytes || previous.sha256 !== fact.sha256)
      fail(
        "runtime_adoption_dependency_changed",
        "Original CLI bytes differ from the qualified combination.",
      );
  }
  const oldPackage = object(
    JSON.parse(transferRead(path.join(oldRoot, "package.json"), 1024 * 1024).toString("utf8")),
  );
  if (oldPackage.name !== "@tiangong-lca/cli" || oldPackage.version !== expectation.package_version)
    fail("runtime_adoption_dependency_changed", "Original CLI version differs from qualification.");
}

export function retainedRuntime(
  entryValue: unknown,
  descriptorValue: unknown,
  expected: unknown,
): RetainedAdoptionRuntime {
  const entry = verifyEvidence([entryValue])[0],
    descriptor = verifyEvidence([descriptorValue])[0];
  const root = path.resolve(entry.path, "../../..");
  if (
    !compatibleRetainedPackageEntries.has(
      path.relative(root, entry.path).split(path.sep).join("/"),
    ) ||
    descriptor.path !== path.join(root, "package-dist/assets/foundry-package-descriptor.json")
  )
    fail(
      "runtime_adoption_original_invalid",
      "Retained runtime locators must name one complete installed package.",
    );
  const manifest = transferRead(path.join(root, "package.json"), 1024 * 1024);
  const pkg = object(JSON.parse(manifest.toString("utf8")));
  const identity = {
    package_name: pkg.name,
    package_version: pkg.version,
    manifest_sha256: digest(manifest),
    entry_sha256: entry.sha256,
  };
  if (sha256Json(identity) !== sha256Json(expected))
    fail(
      "runtime_adoption_original_invalid",
      "Retained package identity differs from its qualified transition.",
    );
  const inventory = object(
    JSON.parse(transferRead(descriptor.path, 8 * 1024 * 1024).toString("utf8")),
  );
  if (
    inventory.schema !== "tiangong-foundry.package-descriptor.v1" ||
    !Array.isArray(inventory.files) ||
    inventory.files.length > 5000 ||
    inventory.files_sha256 !== sha256Json(inventory.files)
  )
    fail("runtime_adoption_original_invalid", "Retained package inventory changed.");
  for (const fact of facts(inventory.files)) {
    const current = transferFileContentFact(transferPath(root, fact.path));
    if (current.bytes !== fact.bytes || current.sha256 !== fact.sha256)
      fail("runtime_adoption_original_invalid", "Retained package code or assets changed.");
  }
  return { root, identity: identity as TaskRuntimeIdentity, entry, descriptor };
}

export function currentAdoptionRuntimeFacts(
  context: FoundryRuntimeContext,
): RetainedAdoptionRuntime {
  return retainedRuntime(
    transferFileFact(transferPath(context.runtimeRoot, currentPackageEntryPath)),
    transferFileFact(
      transferPath(context.runtimeRoot, "package-dist/assets/foundry-package-descriptor.json"),
    ),
    currentAdoptionRuntime(context),
  );
}

/** Bind an adopted task's actual selected Toolkit to the independently reviewed executable. */
export function assertRuntimeAdoptionToolkit(
  selected: QualifiedFoundryRuntime | undefined,
  selection: unknown,
): void {
  const tidas = verifyEvidence(object(object(selection).qualification).tidas);
  if (
    !selected ||
    tidas.length !== 2 ||
    fs.realpathSync(selected.tidas.executable_path) !== fs.realpathSync(tidas[1].path) ||
    selected.tidas.expectation.executable.sha256 !== tidas[1].sha256 ||
    selected.tidas.expectation.executable.bytes !== tidas[1].bytes
  )
    fail(
      "runtime_adoption_dependency_changed",
      "Select the exact independently qualified successor Toolkit for this adopted task.",
    );
}
