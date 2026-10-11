import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensureRuntimeComponents,
  executeRuntimeLaunch,
  inspectRuntimeComponents,
  trustRuntimeManifest,
  writeRuntimeComponentArchive,
  type RuntimeComponent,
} from "@tiangong-lca/cli/runtime";
import {
  FOUNDRY_MANAGED_ADOPTION_SCHEMA,
  FOUNDRY_MANAGED_ADOPTION_PATH,
} from "./foundry-managed-adoption.ts";
import {
  createFoundryRuntimeAdoptionQualification,
  verifyEvidence,
} from "./foundry-task-runtime-adoption.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { assertFoundryOperationResult } from "./foundry-operation-result.ts";
import { FOUNDRY_BOOTSTRAP_CLI } from "./foundry-release-bootstrap.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import {
  adoptionFileFact,
  adoptionObject,
  readAdoptionJson,
  parseAdoptionRuntimeSelection,
  inspectFoundryAdoptionRuntime,
  assertFoundryAdoptionCompatibleDependencies,
  type FoundryAdoptionFileFact,
  type FoundryAdoptionRuntimeFacts,
} from "./foundry-release-adoption-facts.ts";
import {
  foundryComponentHash as hash,
  foundryComponentJson as json,
  writeFoundryComponentFile,
  assertFoundryComponentFiles,
  freezeFoundryReleaseValue,
} from "./foundry-release-component-io.ts";

/** Review supplies the conclusion; native preparation supplies every runtime fact. */
export function readFoundryAdoptionReviewInput(
  reviewFact: FoundryAdoptionFileFact,
  requestFact: FoundryAdoptionFileFact,
) {
  const review = adoptionObject(readAdoptionJson(reviewFact));
  const request = adoptionObject(readAdoptionJson(requestFact));
  if (
    Object.keys(review).sort().join(",") !==
      "allowed_changes,conclusion,evidence,original_facts_sha256,request,reviewer,schema,successor_facts_sha256" ||
    review.schema !== "tiangong-foundry.runtime-adoption-compatibility-review.v1" ||
    review.conclusion !== "compatible" ||
    typeof review.reviewer !== "string" ||
    !review.reviewer.trim() ||
    JSON.stringify(review.allowed_changes) !== '["foundry","cli"]' ||
    request.schema !== "tiangong-foundry.runtime-adoption-review-request.v1" ||
    sha256Json(review.request) !== sha256Json(requestFact) ||
    hash(json(request.original)) !== request.original_facts_sha256 ||
    hash(json(request.successor)) !== request.successor_facts_sha256 ||
    review.original_facts_sha256 !== request.original_facts_sha256 ||
    review.successor_facts_sha256 !== request.successor_facts_sha256
  )
    throw new Error(
      "Adoption requires an explicit independent compatible review of the exact native request.",
    );
  const evidence = verifyEvidence(review.evidence);
  if (evidence.length > 62)
    throw new Error(
      "Adoption review evidence must leave room for retained review and request facts.",
    );
  return { review, request, evidence };
}
export function verifyFoundryAdoptionReview(
  reviewFact: FoundryAdoptionFileFact,
  requestFact: FoundryAdoptionFileFact,
) {
  const { review, request, evidence } = readFoundryAdoptionReviewInput(reviewFact, requestFact);
  const original = inspectFoundryAdoptionRuntime(
    parseAdoptionRuntimeSelection(adoptionObject(request.original).selection),
  );
  const successor = inspectFoundryAdoptionRuntime(
    parseAdoptionRuntimeSelection(adoptionObject(request.successor).selection),
  );
  assertFoundryAdoptionCompatibleDependencies(original, successor);
  if (
    hash(json(original)) !== request.original_facts_sha256 ||
    hash(json(successor)) !== request.successor_facts_sha256
  )
    throw new Error("Reviewed complete runtime facts changed after native preparation.");
  const qualification = freezeFoundryReleaseValue({
    schema: "tiangong-foundry.runtime-adoption-qualification.v1",
    original_runtime: original.runtime,
    successor_runtime: successor.runtime,
    original_manifest_sha256: original.selection.manifest.sha256,
    successor_manifest_sha256: successor.selection.manifest.sha256,
    original_cli: original.cli,
    successor_cli: successor.cli,
    tidas: [original.toolkit.executable, successor.toolkit.executable],
    reviewer: review.reviewer,
    evidence: [reviewFact, requestFact, ...evidence],
    allowed_changes: ["foundry", "cli"],
    runtime_manifests: [original.selection.manifest, successor.selection.manifest],
    original_descriptor_sha256: original.descriptor.sha256,
    successor_descriptor_sha256: successor.descriptor.sha256,
  });
  const bytes = json(qualification);
  createFoundryRuntimeAdoptionQualification({ bytes, expectedSha256: hash(bytes) });
  return { original, successor, qualification, qualificationBytes: bytes };
}

/** Check the independently inventoried combination against the real managed child's public doctor result. */
export function assertFoundryAdoptionNativeIdentity(
  value: unknown,
  expected: FoundryAdoptionRuntimeFacts,
): void {
  const identity = adoptionObject(value);
  const foundry = adoptionObject(identity.foundry);
  const qualification = adoptionObject(identity.qualification);
  const qualified = adoptionObject(qualification.identity);
  const toolkitValidation = adoptionObject(expected.toolkit.expectation.validation);
  const { schema: _schema, ...cli } = expected.cli.expectation;
  if (
    qualification.status !== "ready" ||
    sha256Json(foundry) !==
      sha256Json({
        package_name: expected.runtime.package_name,
        package_version: expected.runtime.package_version,
        package_manifest_sha256: expected.runtime.manifest_sha256,
        entry_sha256: expected.runtime.entry_sha256,
      }) ||
    sha256Json(qualified.cli) !== sha256Json(cli) ||
    sha256Json(qualified.tidas) !==
      sha256Json({
        binary_version: expected.toolkit.expectation.binary_version,
        executable: expected.toolkit.expectation.executable,
        asset_fingerprint: toolkitValidation.asset_fingerprint,
        protocols: toolkitValidation.protocols,
        event_schema_versions: toolkitValidation.event_schema_versions,
      })
  )
    throw new Error(
      "Native managed adoption owner returned a different exact runtime combination.",
    );
}

/** Seal Q then non-executable K and exact S+K carrier, using only the existing public CLI manager. */
export async function completeFoundryManagedAdoptionPreparation(
  output: string,
  reviewFact: FoundryAdoptionFileFact,
) {
  if (!path.isAbsolute(output) || fs.realpathSync(output) !== output)
    throw new Error("Adoption completion requires its exact physical preparation output.");
  const requestFact = adoptionFileFact(path.join(output, "adoption-review-request.json"));
  const reviewed = verifyFoundryAdoptionReview(reviewFact, requestFact);
  if (
    reviewed.successor.selection.manifest.path !== path.join(output, "runtime-manifest.json") ||
    reviewed.successor.selection.cache_dir !== path.join(output, "consumer-cache") ||
    reviewed.original.selection.cache_dir === reviewed.successor.selection.cache_dir
  )
    throw new Error(
      "Adoption successor must use its own native output and independent consumer cache.",
    );
  const successorBytes = readFoundryReleaseArtifact(
    reviewed.successor.selection.manifest.path,
    32 * 1024 * 1024,
  );
  const successor = trustRuntimeManifest(
    successorBytes,
    reviewed.successor.selection.manifest.sha256,
  );
  const platform = reviewed.successor.cli.expectation.platform;
  const id = "foundry-adoption-control";
  if (successor.manifest.components.some((component) => component.id === id))
    throw new Error("Successor already contains an adoption control component.");
  const controlRoot = path.join(output, "adoption-control");
  fs.mkdirSync(controlRoot, { mode: 0o700 });
  const files = [
    writeFoundryComponentFile(controlRoot, "metadata/successor-runtime.json", successorBytes),
    writeFoundryComponentFile(
      controlRoot,
      "metadata/qualification.json",
      reviewed.qualificationBytes,
    ),
    writeFoundryComponentFile(
      controlRoot,
      FOUNDRY_MANAGED_ADOPTION_PATH,
      json({
        schema: FOUNDRY_MANAGED_ADOPTION_SCHEMA,
        platform,
        successor_manifest: { component: id, path: "metadata/successor-runtime.json" },
        launches: successor.manifest.launches.map((launch) => ({
          id: launch.id,
          qualification: { component: id, path: "metadata/qualification.json" },
        })),
      }),
    ),
    writeFoundryComponentFile(
      controlRoot,
      "metadata/runtime-lock.json",
      json({
        schema: "tiangong-foundry.adoption-control-lock.v1",
        successor_manifest: reviewed.successor.selection.manifest,
        qualification_sha256: hash(reviewed.qualificationBytes),
      }),
    ),
    writeFoundryComponentFile(
      controlRoot,
      "metadata/runtime-provenance.json",
      json({
        schema: "tiangong-foundry.adoption-control-provenance.v1",
        request: requestFact,
        review: reviewFact,
        allowed_changes: ["foundry", "cli"],
      }),
    ),
    writeFoundryComponentFile(
      controlRoot,
      "metadata/runtime-sbom.spdx.json",
      json({
        spdxVersion: "SPDX-2.3",
        dataLicense: "CC0-1.0",
        SPDXID: "SPDXRef-DOCUMENT",
        name: "Foundry non-executable adoption control",
        documentNamespace: `https://github.com/tiangong-lca/foundry/adoption/${hash(reviewed.qualificationBytes)}`,
        creationInfo: {
          creators: ["Tool: tiangong-foundry-release-prepare-runtime"],
          created: "1970-01-01T00:00:00Z",
        },
        packages: [],
      }),
    ),
    writeFoundryComponentFile(
      controlRoot,
      "LICENSE",
      readFoundryReleaseArtifact(path.resolve(import.meta.dirname, "../../LICENSE"), 1024 * 1024),
    ),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  assertFoundryComponentFiles(controlRoot, files, platform);
  const archivePath = path.join(output, "components", `adoption-control-${platform}.tar.gz`);
  const archive = await writeRuntimeComponentArchive(controlRoot, files, archivePath);
  const control: RuntimeComponent = {
    id,
    version: successor.manifest.product.version,
    platform,
    archive: {
      format: "tar-gzip-ustar-v1",
      url: `https://github.com/tiangong-lca/foundry/releases/download/local-adoption-${hash(reviewed.qualificationBytes)}/adoption-control-${platform}.tar.gz`,
      ...archive,
    },
    files,
    content_sha256: hash(Buffer.from(JSON.stringify(files))),
    production_lock: "metadata/runtime-lock.json",
    sbom: "metadata/runtime-sbom.spdx.json",
    licenses: ["LICENSE"],
    provenance: ["metadata/runtime-provenance.json"],
    protocols: [FOUNDRY_MANAGED_ADOPTION_SCHEMA],
    asset_fingerprints: {},
  };
  const carrierBytes = json({
    ...successor.manifest,
    components: [...successor.manifest.components, control],
  });
  const carrier = trustRuntimeManifest(carrierBytes, hash(carrierBytes));
  const cacheDir = reviewed.successor.selection.cache_dir;
  const key = inspectRuntimeComponents(carrier, { cacheDir }).components.find(
    (component) => component.id === id,
  )!.key;
  const lease = { id: `foundry-adoption-${carrier.sha256}`, owner: output };
  await ensureRuntimeComponents(carrier, {
    cacheDir,
    archiveSeeds: { [key]: archivePath },
    lease,
    fetchImpl: async () => {
      throw new Error(
        "Adoption sealing may only use its retained complete cache and local control archive.",
      );
    },
  });
  const inspected = inspectRuntimeComponents(carrier, { cacheDir });
  if (inspected.status !== "ready")
    throw new Error("Managed adoption carrier cache is incomplete.");
  const qualificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-adoption-carrier-"));
  const checks: Array<{
    entry: string;
    operation: string;
    status: string;
    exit: number;
    runtime_identity: unknown;
  }> = [];
  try {
    const workspace = path.join(qualificationRoot, "workspace");
    const home = path.join(qualificationRoot, "home");
    const emptyPath = path.join(qualificationRoot, "no-global-tools");
    for (const directory of [workspace, home, emptyPath]) fs.mkdirSync(directory);
    const environment: NodeJS.ProcessEnv = {
      HOME: home,
      USERPROFILE: home,
      PATH: emptyPath,
      Path: emptyPath,
      TMPDIR: qualificationRoot,
      TEMP: qualificationRoot,
      TMP: qualificationRoot,
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
    };
    for (const key of ["SystemRoot", "WINDIR", "PATHEXT"])
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    const run = async (entry: string, argv: string[]) => {
      const result = await executeRuntimeLaunch(carrier, {
        cacheDir,
        entry,
        cwd: workspace,
        argv,
        env: environment,
        timeoutMs: 120000,
        fetchImpl: async () => {
          throw new Error(
            "Managed adoption native qualification must use its retained complete cache.",
          );
        },
      });
      if (
        result.status !== 0 ||
        result.signal ||
        result.error ||
        result.stderr ||
        result.stdout.trimEnd().split("\n").length !== 1
      )
        throw new Error(`Native managed adoption entry failed (${entry}).`);
      const value = assertFoundryOperationResult(JSON.parse(result.stdout));
      if (value.status !== "ready")
        throw new Error("Native managed adoption operation did not become ready.");
      checks.push({
        entry,
        operation: value.operation,
        status: value.status,
        exit: result.status,
        runtime_identity: value.runtime_identity,
      });
      return value;
    };
    await run("foundry", ["workspace", "init", "--workspace", workspace, "--json"]);
    for (const launch of carrier.manifest.launches.filter((item) => item.platform === platform)) {
      const result = await run(launch.id, ["doctor", "--workspace", workspace, "--json"]);
      assertFoundryAdoptionNativeIdentity(result.runtime_identity, reviewed.successor);
    }
    if (inspectRuntimeComponents(carrier, { cacheDir }).status !== "ready")
      throw new Error("Native carrier qualification changed its component cache.");
    writeFoundryComponentFile(
      output,
      "adoption-carrier-qualification.json",
      json({
        schema: "tiangong-foundry.managed-adoption-carrier-qualification.v1",
        status: "passed",
        scope: "isolated-native-managed-entry",
        carrier_sha256: carrier.sha256,
        successor_sha256: successor.sha256,
        checks,
        task_adoption_performed: false,
        original_data_acceptance: false,
      }),
    );
  } finally {
    fs.rmSync(qualificationRoot, { recursive: true, force: true });
  }
  // Reinspect the reviewed external programs before publishing immutable selection material.
  verifyFoundryAdoptionReview(reviewFact, requestFact);
  const manifestFile = writeFoundryComponentFile(output, "adoption-carrier.json", carrierBytes);
  const node = inspected.components.find((component) => component.id === "node")!;
  const entry = freezeFoundryReleaseValue({
    schema: "tiangong-foundry.runtime-adoption-candidate-entry.v1",
    successor_manifest: reviewed.successor.selection.manifest,
    carrier_manifest: { ...manifestFile, path: path.join(output, manifestFile.path) },
    qualification: {
      path: path.join(controlRoot, "metadata/qualification.json"),
      bytes: reviewed.qualificationBytes.length,
      sha256: hash(reviewed.qualificationBytes),
    },
    request: requestFact,
    review: reviewFact,
    components: carrier.manifest.components.map((component) => ({
      component,
      cache: inspected.components.find((item) => item.id === component.id)!,
    })),
    local_archives: carrier.manifest.components.map((component) => {
      const archive =
        component.id === id
          ? archivePath
          : path.join(
              output,
              "components",
              `${component.id}-${component.version}-${component.platform}.tar.gz`,
            );
      const fact = adoptionFileFact(archive, 512 * 1024 * 1024);
      if (fact.bytes !== component.archive.bytes || fact.sha256 !== component.archive.sha256)
        throw new Error(
          "Adoption carrier local archive differs from its complete component record.",
        );
      return { component: component.id, ...fact };
    }),
    native_qualification: adoptionFileFact(
      path.join(output, "adoption-carrier-qualification.json"),
    ),
    control_archive: adoptionFileFact(archivePath, 512 * 1024 * 1024),
    consumer_cache: {
      path: cacheDir,
      carrier_lease: lease,
      public_cli_revalidation_required: true,
    },
    command_prefix: {
      executable: path.join(node.root, platform === "win32-x64" ? "bin/node.exe" : "bin/node"),
      argv: [
        path.join(node.root, FOUNDRY_BOOTSTRAP_CLI),
        "runtime",
        "exec",
        "--manifest",
        path.join(output, manifestFile.path),
        "--manifest-sha256",
        carrier.sha256,
        "--cache-dir",
        cacheDir,
        "--entry",
        "foundry",
      ],
      shell: false,
      append: ["--cwd", "<consumer-cwd>", "--", "<public-operation-argv>"],
    },
    limits: [
      "Technical compatibility grants no authentication, task, account, scientific, finalization or write authority.",
      "Original DATA must separately qualify its native same-task plan/apply/audit and permitted preparation continuation.",
      "This local carrier has no published archive URL; its explicit carrier lease retains K for later managed actions.",
    ],
  });
  const entryFile = writeFoundryComponentFile(output, "adoption-entry.json", json(entry));
  return {
    entry: { ...entryFile, path: path.join(output, entryFile.path) },
    carrier_sha256: carrier.sha256,
    successor_sha256: successor.sha256,
    qualification_sha256: hash(reviewed.qualificationBytes),
  };
}
