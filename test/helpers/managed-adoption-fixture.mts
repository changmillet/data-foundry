import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import type { TestContext } from "node:test";
import {
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  ensureRuntimeComponents,
  inspectRuntimeComponents,
  trustRuntimeManifest,
  writeRuntimeComponentArchive,
  type ComponentFile,
  type RuntimeManifest,
  type RuntimeComponent,
} from "@tiangong-lca/cli/runtime";
import {
  assertFoundryOperationResult,
  type FoundryOperationResult,
} from "../../scripts/lib/foundry-operation-result.ts";
import {
  createFoundryPackageDescriptor,
  captureFoundryPackageFile,
} from "../../scripts/lib/foundry-package-contract.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { flowRow, processRowWithFlowRef } from "../fixtures/row-builders.ts";

const repo = path.resolve(import.meta.dirname, "../..");
const entryRelative = "node_modules/@tiangong-lca/foundry/package-dist/scripts/package-entry.js";
const managed = "tiangong-foundry.managed-runtime.v1";
const adoption = "tiangong-foundry.managed-adoption.v1";
const platform = `${process.platform}-${process.arch}` as RuntimeComponent["platform"];
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export const managedFixtureAccount = {
  projectRef: "abcdefghijklmnopqrst",
  userId: "11111111-1111-4111-8111-111111111111",
};
export const managedFixtureToken = "managed-fixture-process-token-never-a-credential";
export const managedFileFact = (file: string) => {
  const bytes = fs.readFileSync(file);
  return { path: fs.realpathSync(file), bytes: bytes.length, sha256: digest(bytes) };
};
const json = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};
export function managedInventory(root: string, relative = ""): ComponentFile[] {
  return fs
    .readdirSync(path.join(root, relative))
    .flatMap((name): ComponentFile[] => {
      const selected = relative ? `${relative}/${name}` : name;
      const file = path.join(root, selected),
        stat = fs.lstatSync(file);
      assert.equal(stat.isSymbolicLink(), false, file);
      if (stat.isDirectory()) return managedInventory(root, selected);
      assert.ok(stat.isFile(), file);
      assert.equal(stat.nlink, 1, file);
      const bytes = fs.readFileSync(file);
      return [
        {
          path: selected,
          bytes: bytes.length,
          sha256: digest(bytes),
          mode: stat.mode & 0o111 ? 493 : 420,
        },
      ];
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
function packageFiles(root: string) {
  return managedInventory(root)
    .filter((file) => !file.path.startsWith("node_modules/"))
    .map(({ mode: _mode, ...file }) => file);
}
function physicalPackage(source: string, target: string) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const origin = path.join(source, entry.name),
      destination = path.join(target, entry.name);
    if (entry.isDirectory()) physicalPackage(origin, destination);
    else {
      assert.ok(entry.isFile(), origin);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(origin, destination);
      fs.chmodSync(destination, fs.statSync(origin).mode & 0o777);
      assert.equal(
        digest(fs.readFileSync(destination)),
        digest(fs.readFileSync(origin)),
        destination,
      );
      assert.equal(fs.statSync(destination).nlink, 1);
      if (process.platform !== "win32")
        assert.notEqual(fs.statSync(destination).ino, fs.statSync(origin).ino);
    }
  }
}
function resolvePackage(file: string, name: string): string {
  const selected = createRequire(file)
    .resolve.paths(name)
    ?.map((directory) => path.join(directory, name, "package.json"))
    .find((candidate) => fs.existsSync(candidate));
  assert.ok(selected, `${name} from ${file}`);
  return fs.realpathSync(path.dirname(selected));
}
function closure(cliRoot: string): Array<{ name: string; version: string; root: string }> {
  const selected = new Map<string, { name: string; version: string; root: string }>();
  const visit = (root: string) => {
    const file = path.join(root, "package.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as {
      name: string;
      version: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    const previous = selected.get(manifest.name);
    if (previous) {
      assert.equal(previous.version, manifest.version, manifest.name);
      return;
    }
    selected.set(manifest.name, { name: manifest.name, version: manifest.version, root });
    for (const name of Object.keys(manifest.dependencies ?? {})) visit(resolvePackage(file, name));
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      try {
        visit(resolvePackage(file, name));
      } catch (error) {
        if (!manifest.peerDependenciesMeta?.[name]?.optional) throw error;
      }
    }
  };
  visit(cliRoot);
  return [...selected.values()];
}
let build: { root: string; stage: string } | undefined;
export function managedAdoptionPackage() {
  if (build) return build;
  const supplied = process.env.FOUNDRY_MANAGED_TEST_PACKAGE_ROOT;
  if (supplied)
    return (build = { root: fs.realpathSync(supplied), stage: fs.realpathSync(supplied) });
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "foundry-managed-adoption-build-")),
  );
  for (const item of [
    "scripts",
    "specs",
    "docs",
    "package.json",
    "tsconfig.json",
    "tsconfig.package.json",
    "README.md",
    "LICENSE",
  ])
    fs.cpSync(path.join(repo, item), path.join(root, item), { recursive: true });
  fs.symlinkSync(
    path.join(repo, "node_modules"),
    path.join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/build-foundry-package.ts")],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return (build = { root, stage: path.join(root, "package-stage") });
}
export function cleanManagedAdoptionPackage() {
  if (build && !process.env.FOUNDRY_MANAGED_TEST_PACKAGE_ROOT)
    fs.rmSync(build.root, { recursive: true, force: true });
  build = undefined;
}
function syntheticQueryableFlow(id: string) {
  const basic = flowRow(id).flowDataSet;
  return {
    flowDataSet: {
      ...basic,
      flowInformation: {
        ...basic.flowInformation,
        dataSetInformation: {
          ...basic.flowInformation.dataSetInformation,
          name: {
            ...basic.flowInformation.dataSetInformation.name,
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "Swiss market" },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "06", "#text": "Crude petroleum and natural gas" },
              ],
            },
          },
        },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
      flowProperties: {
        flowProperty: [
          {
            "@dataSetInternalID": "0",
            meanValue: "1",
            referenceToFlowPropertyDataSet: {
              "@refObjectId": "93a60a56-a3c8-11da-a746-0800200b9a66",
              "@version": "03.00.003",
              "common:shortDescription": { "@xml:lang": "en", "#text": "Mass" },
            },
          },
        ],
      },
    },
  };
}
function syntheticQueryableProcess(id: string, flowId: string) {
  const basic = processRowWithFlowRef(id, flowId).processDataSet;
  return {
    processDataSet: {
      ...basic,
      processInformation: {
        ...basic.processInformation,
        dataSetInformation: {
          ...basic.processInformation.dataSetInformation,
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "35", "#text": "Electricity and heat production" },
              ],
            },
          },
        },
        quantitativeReference: { referenceToReferenceFlow: "0" },
        geography: { locationOfOperationSupplyOrProduction: { "@location": "CH" } },
      },
      exchanges: {
        exchange: [
          {
            ...basic.exchanges.exchange[0],
            "@dataSetInternalID": "0",
            exchangeDirection: "Output",
            meanAmount: "1",
            referenceToFlowDataSet: {
              ...basic.exchanges.exchange[0].referenceToFlowDataSet,
              "common:shortDescription": { "@xml:lang": "en", "#text": "Natural gas" },
            },
          },
        ],
      },
    },
  };
}

export type ManagedFixtureMutation =
  | "control-mode"
  | "control-protocol"
  | "successor-product"
  | "successor-launch"
  | "qualification-manifest"
  | "qualification-files"
  | "cli-expectation"
  | "tidas-expectation"
  | "node-expectation"
  | "entry-argv";

/** Real CLI manager + direct emitted package-entry subprocess. Release metadata/history are synthetic. */
export async function managedAdoptionFixture(t: TestContext, syntheticTransport = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foundry-managed-adoption-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = managedAdoptionPackage().stage;
  const cliRoot = fs.realpathSync(
    process.env.FOUNDRY_MANAGED_TEST_CLI_ROOT ??
      resolveInstalledTiangongLcaCliPackage().packageRoot,
  );
  const graph = closure(cliRoot);
  const manager = path.join(root, "manager/node_modules"),
    app = path.join(root, "application-input"),
    previous = path.join(root, "previous-input");
  const control = path.join(root, "synthetic-control.json"),
    calls = path.join(root, "synthetic-calls.jsonl");
  json(control, { auth: "valid", query: "manual" });
  fs.writeFileSync(calls, "");
  const copyGraph = (destination: string, includeFoundry: boolean) => {
    for (const pkg of graph) physicalPackage(pkg.root, path.join(destination, pkg.name));
    if (includeFoundry) physicalPackage(stage, path.join(destination, "@tiangong-lca/foundry"));
  };
  copyGraph(manager, false);
  copyGraph(path.join(app, "node_modules"), true);
  const appCli = path.join(app, "node_modules/@tiangong-lca/cli");
  const managerInventory = managedInventory(manager);
  if (syntheticTransport) {
    const bin = path.join(appCli, "bin");
    fs.copyFileSync(path.join(bin, "tiangong-lca.js"), path.join(bin, "managed-real-cli.js"));
    for (const [source, target] of [
      ["managed-auth-owner-cli.mts", "managed-auth-owner-cli.js"],
      ["auth-identity-receipt.ts", "auth-identity-receipt.js"],
    ]) {
      const code = stripTypeScriptTypes(
        fs.readFileSync(path.join(repo, "test/fixtures", source), "utf8"),
        { mode: "strip" },
      ).replace("./auth-identity-receipt.ts", "./auth-identity-receipt.js");
      fs.writeFileSync(path.join(bin, target), code);
    }
    const cliVersion = (
      JSON.parse(fs.readFileSync(path.join(appCli, "package.json"), "utf8")) as { version: string }
    ).version;
    json(path.join(bin, "managed-owner-configuration.json"), {
      control,
      calls,
      package_version: cliVersion,
      boundary: "SYNTHETIC auth/search transport only; original manager CLI remains unchanged",
    });
    fs.writeFileSync(
      path.join(bin, "tiangong-lca.js"),
      '#!/usr/bin/env node\nimport {runManagedAuthOwnerFixture} from "./managed-auth-owner-cli.js";\nif (!runManagedAuthOwnerFixture(process.argv.slice(2))) { const {runFromBin} = await import("./managed-real-cli.js"); process.exitCode = await runFromBin(); }\n',
    );
    fs.chmodSync(path.join(bin, "tiangong-lca.js"), 0o755);
  }
  // Copy each package separately into the retained flat physical graph.
  for (const entry of fs.readdirSync(path.join(app, "node_modules"), { withFileTypes: true })) {
    if (entry.name.startsWith("@"))
      for (const child of fs.readdirSync(path.join(app, "node_modules", entry.name)))
        physicalPackage(
          path.join(app, "node_modules", entry.name, child),
          path.join(previous, "node_modules", entry.name, child),
        );
    else
      physicalPackage(
        path.join(app, "node_modules", entry.name),
        path.join(previous, "node_modules", entry.name),
      );
  }
  const previousPackage = path.join(previous, "node_modules/@tiangong-lca/foundry");
  fs.appendFileSync(
    path.join(previousPackage, "package-dist/scripts/package-entry.js"),
    "\n// synthetic immutable predecessor package\n",
  );
  const oldDescriptor = path.join(
    previousPackage,
    "package-dist/assets/foundry-package-descriptor.json",
  );
  const declared = JSON.parse(fs.readFileSync(oldDescriptor, "utf8")) as {
    files: Array<{ path: string }>;
  };
  json(
    oldDescriptor,
    createFoundryPackageDescriptor(
      declared.files.map((file) => captureFoundryPackageFile(previousPackage, file.path)),
    ),
  );
  const nativeInput = path.join(root, "native-input");
  fs.mkdirSync(path.join(nativeInput, "bin"), { recursive: true });
  const nodePath = process.platform === "win32" ? "bin/node.exe" : "bin/node";
  fs.copyFileSync(process.execPath, path.join(nativeInput, nodePath));
  fs.chmodSync(path.join(nativeInput, nodePath), 0o755);
  const nativeSource =
    process.env.FOUNDRY_MANAGED_TEST_TIDAS_BIN ?? path.join(repo, "test/fixtures/fake-tidas.ts");
  const nativePath = nativeSource.endsWith(".ts")
    ? "bin/tidas.ts"
    : process.platform === "win32"
      ? "bin/tidas.exe"
      : "bin/tidas";
  fs.copyFileSync(nativeSource, path.join(nativeInput, nativePath));
  fs.chmodSync(path.join(nativeInput, nativePath), 0o755);
  const cliManifest = JSON.parse(fs.readFileSync(path.join(appCli, "package.json"), "utf8")) as {
    version: string;
    exports: Record<string, { import: string }>;
  };
  const cliApi = (await import(
    pathToFileURL(path.join(appCli, cliManifest.exports["./runtime"].import)).href
  )) as typeof import("@tiangong-lca/cli/runtime");
  const cli = cliApi.describeCliRuntime();
  json(path.join(root, "physical-production-inventory.json"), {
    boundary: syntheticTransport
      ? "Real Foundry/manager/production closure; ONLY owned app CLI auth/search transport differs"
      : "All unmodified package/CLI/Node payloads; release metadata and predecessor marker synthetic",
    production_packages: graph.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      source_files: packageFiles(pkg.root),
      manager_files: packageFiles(path.join(manager, pkg.name)),
      application_files: packageFiles(path.join(app, "node_modules", pkg.name)),
    })),
    application_foundry: packageFiles(path.join(app, "node_modules/@tiangong-lca/foundry")),
    changed_application_cli_content_sha256: cli.content_sha256,
    manager_files: managerInventory,
  });
  const described = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {describeCliRuntime} from ${JSON.stringify(pathToFileURL(path.join(appCli, cliManifest.exports["./runtime"].import)).href)};process.stdout.write(JSON.stringify(describeCliRuntime()));`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(described.status, 0, described.stderr);
  assert.equal(JSON.parse(described.stdout).content_sha256, cli.content_sha256);
  const nativeDescription = spawnSync(
    nativeSource.endsWith(".ts") ? process.execPath : nativeSource,
    nativeSource.endsWith(".ts")
      ? [nativeSource, "validate", "--describe", "--format", "json"]
      : ["validate", "--describe", "--format", "json"],
    { encoding: "utf8" },
  );
  assert.equal(nativeDescription.status, 0, nativeDescription.stderr);
  const validation = JSON.parse(nativeDescription.stdout).summary.validation_describe as {
    package: { version: string };
    asset_fingerprint: string;
    schema_version: string;
    protocols: string[];
    event_schema_versions: string[];
  };
  const expectation = {
    schema: "tiangong-lca.cli-runtime-expectation.v1",
    package_version: cli.package.version,
    platform,
    content_sha256: cli.content_sha256,
    node_version: cli.node.version,
    node_sha256: cli.node.sha256,
  };
  const nativeFact = managedFileFact(path.join(nativeInput, nativePath));
  const tidasExpectation = {
    schema: "tiangong-foundry.tidas-runtime-expectation.v1",
    platform,
    binary_version: validation.package.version,
    executable: { bytes: nativeFact.bytes, sha256: nativeFact.sha256 },
    validation: {
      schema_version: validation.schema_version,
      asset_fingerprint: validation.asset_fingerprint,
      protocols: [...validation.protocols].sort(),
      event_schema_versions: [...validation.event_schema_versions].sort(),
    },
  };
  const metadata = {
    schema: managed,
    platform,
    cli: expectation,
    tidas: { executable: { component: "native", path: nativePath }, expectation: tidasExpectation },
    launches: [
      { id: "foundry", access: "write", target: null },
      { id: "foundry-read", access: "read", target: null },
    ],
  };
  json(path.join(app, "metadata/foundry-runtime.json"), metadata);
  json(path.join(previous, "metadata/foundry-runtime.json"), metadata);
  const version = (
    JSON.parse(fs.readFileSync(path.join(stage, "package.json"), "utf8")) as { version: string }
  ).version;
  const prepareComponent = async (id: string, input: string, protocols: string[]) => {
    for (const name of ["fixture-lock.json", "fixture-sbom.json", "fixture-provenance.json"])
      json(path.join(input, name), {
        boundary: "Synthetic release metadata; not publication authority",
      });
    fs.writeFileSync(
      path.join(input, "fixture-license.txt"),
      "Synthetic component metadata only.\n",
    );
    const files = managedInventory(input),
      archive = path.join(root, `${id}-${digest(JSON.stringify(files))}.tar.gz`);
    const archiveFact = fs.existsSync(archive)
      ? { bytes: managedFileFact(archive).bytes, sha256: managedFileFact(archive).sha256 }
      : await writeRuntimeComponentArchive(input, files, archive);
    const component: RuntimeComponent = {
      id,
      version,
      platform,
      archive: {
        format: "tar-gzip-ustar-v1",
        url: `https://github.com/tiangong-lca/runtime-fixture/releases/download/v1.0.0/${id}.tar.gz`,
        ...archiveFact,
      },
      files,
      content_sha256: digest(JSON.stringify(files)),
      production_lock: "fixture-lock.json",
      sbom: "fixture-sbom.json",
      licenses: ["fixture-license.txt"],
      provenance: ["fixture-provenance.json"],
      protocols,
      asset_fingerprints: {},
    };
    return { component, archive };
  };
  const newApp = await prepareComponent("application", app, [managed]),
    oldApp = await prepareComponent("previous", previous, [managed]),
    native = await prepareComponent("native", nativeInput, ["fixture-native.v1"]);
  const launches: RuntimeManifest["launches"] = ["foundry", "foundry-read"].map((id) => ({
    id,
    platform,
    executable: { component: "native", path: nodePath },
    environment: syntheticTransport ? "cli-auth" : "isolated",
    context_protocol: RUNTIME_HOST_CONTEXT_PROTOCOL,
    argv: [{ component: "application", path: entryRelative }],
  }));
  const manifest = (components: RuntimeComponent[], old = false): RuntimeManifest => ({
    schema: "tiangong-lca.runtime-manifest.v1",
    bootstrap_protocol: "tiangong-lca.runtime-bootstrap.v1",
    product: { id: "tiangong-foundry", version },
    minimum_hosts: {
      [platform]: { os_release: "0.0.0", glibc: platform.startsWith("linux") ? "0.0" : null },
    },
    workspace: {
      read: [
        {
          schema: "tiangong-foundry.workspace.v1",
          features: ["migration-adoption-v1", "registered-tasks-v2"],
        },
      ],
      write: [
        {
          schema: "tiangong-foundry.workspace.v1",
          features: ["migration-adoption-v1", "registered-tasks-v2"],
        },
      ],
    },
    components,
    launches: old
      ? launches.map((launch) => ({
          ...launch,
          argv: [{ component: "previous", path: entryRelative }],
        }))
      : launches,
  });
  const cache = path.join(root, "cache"),
    seeds = new Map<string, string>();
  const install = async (
    value: RuntimeManifest,
    pathName: string,
    items: Array<{ component: RuntimeComponent; archive: string }>,
  ) => {
    const bytes = Buffer.from(JSON.stringify(value)),
      trusted = trustRuntimeManifest(bytes, digest(bytes));
    const file = path.join(root, pathName);
    fs.writeFileSync(file, bytes);
    for (const item of items)
      if (
        value.components.find((component) => component.id === item.component.id)?.content_sha256 ===
        item.component.content_sha256
      )
        seeds.set(
          inspectRuntimeComponents(trusted, { cacheDir: cache }).components.find(
            (component) => component.id === item.component.id,
          )!.key,
          item.archive,
        );
    const ready = await ensureRuntimeComponents(trusted, {
      cacheDir: cache,
      archiveSeeds: Object.fromEntries(seeds),
      fetchImpl: async () => {
        throw new Error("Managed fixture forbids network component downloads.");
      },
    });
    assert.equal(ready.status, "ready");
    return { value, trusted, file, ready };
  };
  const old = await install(
    manifest([oldApp.component, native.component], true),
    "original-runtime.json",
    [oldApp, native],
  );
  const successor = await install(
    manifest([newApp.component, native.component]),
    "successor-runtime.json",
    [newApp, native],
  );
  const appRoot = successor.ready.components.find(
    (component) => component.id === "application",
  )!.root;
  const oldRoot = old.ready.components.find((component) => component.id === "previous")!.root;
  const nativeRoot = successor.ready.components.find(
    (component) => component.id === "native",
  )!.root;
  const workspace = path.join(root, "workspace");
  const environment: NodeJS.ProcessEnv = {
    PATH: path.join(nativeRoot, "bin") + path.delimiter + (process.env.PATH ?? ""),
    HOME: path.join(root, "home"),
    USERPROFILE: path.join(root, "home"),
    TMPDIR: path.join(root, "temp"),
  };
  fs.mkdirSync(environment.HOME!, { recursive: true });
  fs.mkdirSync(environment.TMPDIR!, { recursive: true });
  const managerBin = path.join(manager, "@tiangong-lca/cli/bin/tiangong-lca.js"),
    selectedNode = path.join(nativeRoot, nodePath);
  const run = async (
    selected: { file: string; trusted: { sha256: string } },
    argv: readonly string[],
    entry = "foundry",
    env: NodeJS.ProcessEnv = {},
  ) => {
    const args = [
      managerBin,
      "runtime",
      "exec",
      "--manifest",
      selected.file,
      "--manifest-sha256",
      selected.trusted.sha256,
      "--cache-dir",
      cache,
      "--entry",
      entry,
      "--cwd",
      root,
      "--",
      ...argv,
    ];
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(selectedNode, args, {
          cwd: root,
          env: { ...environment, ...env },
          shell: false,
        });
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (bytes: Buffer) => (stdout += bytes.toString()));
        child.stderr.on("data", (bytes: Buffer) => (stderr += bytes.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
    assert.equal(result.stderr, "", result.stderr);
    assert.deepEqual(
      managedInventory(manager),
      managerInventory,
      "Unmodified parent CLI/production closure must remain unchanged",
    );
    const operation = assertFoundryOperationResult(JSON.parse(result.stdout));
    return { ...result, operation, args };
  };
  const publicArgs = (group: string, operation: string, rest: string[] = []) => [
    group,
    operation,
    "--workspace",
    workspace,
    ...rest,
    "--json",
  ];
  assert.equal((await run(old, publicArgs("workspace", "init"))).operation.status, "ready");
  const seed = path.join(root, "seed.json"),
    spec = path.join(root, "task.json");
  const flowIds = [
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
  ];
  const rows = syntheticTransport
    ? [
        ...flowIds.map((id) => ({ id, version: "00.00.001", json: syntheticQueryableFlow(id) })),
        {
          id: "88888888-8888-4888-8888-888888888888",
          version: "00.00.001",
          json: syntheticQueryableProcess("88888888-8888-4888-8888-888888888888", flowIds[0]),
        },
        ...["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"].map(
          (id) => ({ id, version: "00.00.001", json: { sourceDataSet: { "common:UUID": id } } }),
        ),
      ]
    : [{ id: flowIds[0], version: "00.00.001", json: flowRow(flowIds[0]) }];
  json(seed, { rows });
  json(spec, {
    schema: "tiangong-foundry.task-start.v1",
    request_id: "synthetic-managed-adoption",
    actor_id: "synthetic-managed-writer",
    lane: "source-evidence-dataset-development",
    profile_id: "generic",
    target_entities: syntheticTransport ? ["flow", "process", "source"] : ["flow"],
    sources: [{ path: seed }],
    seed: { path: seed },
    account_intent: syntheticTransport
      ? {
          project_ref: managedFixtureAccount.projectRef,
          user_id: managedFixtureAccount.userId,
          session_reference: null,
        }
      : null,
    preparation: null,
  });
  const started = (await run(old, publicArgs("task", "start", ["--spec", spec]))).operation;
  assert.equal(started.status, "ready", JSON.stringify(started));
  assert.ok(started.task_id);
  const jobArtifact = started.artifacts.find((artifact) => artifact.role === "foundry_job");
  assert.ok(jobArtifact?.kind === "file");
  const taskId = started.task_id,
    actor = "synthetic-managed-writer",
    taskRoot = path.dirname(jobArtifact.path);
  const registration = path.join(workspace, ".foundry/state/task-registrations", `${taskId}.json`),
    job = JSON.parse(fs.readFileSync(path.join(taskRoot, "foundry-job.json"), "utf8")) as {
      runtime_identity: Record<string, string>;
    };
  const newPackage = path.join(appRoot, "node_modules/@tiangong-lca/foundry"),
    oldPackage = path.join(oldRoot, "node_modules/@tiangong-lca/foundry");
  const successorIdentity = {
    package_name: "@tiangong-lca/foundry",
    package_version: version,
    manifest_sha256: managedFileFact(path.join(newPackage, "package.json")).sha256,
    entry_sha256: managedFileFact(path.join(newPackage, "package-dist/scripts/package-entry.js"))
      .sha256,
  };
  const review = path.join(root, "synthetic-review.json"),
    authorization = path.join(root, "synthetic-local-scope.json"),
    stopped = path.join(root, "synthetic-stopped-writer.json"),
    retainedNative = path.join(root, "retained-original-native");
  json(review, { boundary: "Synthetic reviewed fixture compatibility; not DATA approval" });
  json(authorization, { scope: taskId, boundary: "Synthetic adoption only; no write authority" });
  json(stopped, { actor_id: actor, writer_stopped: true });
  fs.copyFileSync(path.join(nativeRoot, nativePath), retainedNative);
  const qualification = {
    schema: "tiangong-foundry.runtime-adoption-qualification.v1",
    original_runtime: job.runtime_identity,
    successor_runtime: successorIdentity,
    original_manifest_sha256: old.trusted.sha256,
    successor_manifest_sha256: successor.trusted.sha256,
    original_descriptor_sha256: managedFileFact(
      path.join(oldPackage, "package-dist/assets/foundry-package-descriptor.json"),
    ).sha256,
    successor_descriptor_sha256: managedFileFact(
      path.join(newPackage, "package-dist/assets/foundry-package-descriptor.json"),
    ).sha256,
    original_cli: { expectation, files: cli.files },
    successor_cli: { expectation, files: cli.files },
    tidas: [managedFileFact(retainedNative), managedFileFact(path.join(nativeRoot, nativePath))],
    reviewer: "synthetic-independent-reviewer",
    evidence: [managedFileFact(review)],
    allowed_changes: ["foundry", "cli"],
    runtime_manifests: [managedFileFact(old.file), managedFileFact(successor.file)],
  };
  const selection = {
    schema: "tiangong-foundry.task-runtime-compatibility-selection.v1",
    scope: [{ task_id: taskId, registration_sha256: managedFileFact(registration).sha256 }],
    original_entry: managedFileFact(path.join(oldPackage, "package-dist/scripts/package-entry.js")),
    original_descriptor: managedFileFact(
      path.join(oldPackage, "package-dist/assets/foundry-package-descriptor.json"),
    ),
    original_runtime: job.runtime_identity,
    successor_runtime: successorIdentity,
    qualification,
    authorization: managedFileFact(authorization),
    writer_handoff: {
      schema: "tiangong-foundry.runtime-adoption-handoff.v1",
      task_id: taskId,
      actor_id: actor,
      registration_sha256: managedFileFact(registration).sha256,
      writer_stopped: true,
      evidence: managedFileFact(stopped),
    },
  };
  const selectionFile = path.join(root, "selection.json");
  json(selectionFile, selection);
  const carrier = async (mutation?: ManagedFixtureMutation, qualified = true) => {
    const input = fs.mkdtempSync(path.join(root, "control-input-"));
    let execution = successor.value;
    if (["cli-expectation", "node-expectation", "tidas-expectation"].includes(mutation ?? "")) {
      const changedInput = fs.mkdtempSync(path.join(root, "changed-execution-input-"));
      fs.cpSync(app, changedInput, { recursive: true });
      const changed = structuredClone(metadata);
      if (mutation === "cli-expectation") changed.cli.content_sha256 = "0".repeat(64);
      if (mutation === "node-expectation") changed.cli.node_sha256 = "0".repeat(64);
      if (mutation === "tidas-expectation")
        changed.tidas.expectation.executable.sha256 = "0".repeat(64);
      json(path.join(changedInput, "metadata/foundry-runtime.json"), changed);
      const changedApp = await prepareComponent("application", changedInput, [managed]);
      execution = { ...successor.value, components: [changedApp.component, native.component] };
      seeds.set(
        inspectRuntimeComponents(
          trustRuntimeManifest(
            Buffer.from(JSON.stringify(execution)),
            digest(JSON.stringify(execution)),
          ),
          { cacheDir: cache },
        ).components.find((component) => component.id === "application")!.key,
        changedApp.archive,
      );
    }
    if (mutation === "entry-argv")
      execution = {
        ...execution,
        launches: execution.launches.map((item, at) =>
          at === 0 ? { ...item, argv: [...item.argv, { literal: "--unexpected" }] } : item,
        ),
      };
    const value: RuntimeManifest = {
      ...execution,
      ...(mutation === "successor-product"
        ? { product: { ...execution.product, version: "0.0.0" } }
        : {}),
      ...(mutation === "successor-launch"
        ? {
            launches: execution.launches.map((item, at) =>
              at === 0
                ? {
                    ...item,
                    environment: item.environment === "isolated" ? "cli-auth" : "isolated",
                  }
                : item,
            ),
          }
        : {}),
    };
    const q = structuredClone(qualification);
    if (mutation === "qualification-manifest") q.successor_manifest_sha256 = "0".repeat(64);
    if (mutation === "qualification-files") q.successor_cli.files = [];
    fs.mkdirSync(path.join(input, "metadata"), { recursive: true });
    fs.writeFileSync(
      path.join(input, "metadata/successor.json"),
      Buffer.from(JSON.stringify(value)),
    );
    json(path.join(input, "metadata/qualification.json"), q);
    json(path.join(input, "metadata/foundry-adoption.json"), {
      schema: adoption,
      platform,
      successor_manifest: { component: "adoption", path: "metadata/successor.json" },
      launches: [
        {
          id: "foundry",
          qualification: qualified
            ? { component: "adoption", path: "metadata/qualification.json" }
            : null,
        },
        {
          id: "foundry-read",
          qualification: qualified
            ? { component: "adoption", path: "metadata/qualification.json" }
            : null,
        },
      ],
    });
    if (mutation === "control-mode")
      fs.chmodSync(path.join(input, "metadata/foundry-adoption.json"), 0o755);
    const prepared = await prepareComponent("adoption", input, [
      mutation === "control-protocol" ? "tiangong-foundry.managed-adoption.v999" : adoption,
    ]);
    return install(
      { ...execution, components: [...execution.components, prepared.component] },
      `carrier-${digest(JSON.stringify(prepared.component))}.json`,
      [newApp, native, prepared],
    );
  };
  const launch = await carrier();
  const snapshot = () =>
    [
      registration,
      "foundry-job.json",
      "source-manifest.json",
      "profile-lock.json",
      "seed-manifest.json",
    ].map((file) => managedFileFact(path.isAbsolute(file) ? file : path.join(taskRoot, file)));
  const initial = snapshot();
  const taskArgs = (operation: string, rest: string[] = []) =>
    publicArgs("task", operation, ["--task", taskId, "--actor", actor, ...rest]);
  const authEnvironment = {
    TIANGONG_LCA_AUTH_MODE: "access_token",
    TIANGONG_LCA_ACCESS_TOKEN: managedFixtureToken,
    TIANGONG_LCA_API_BASE_URL: `https://${managedFixtureAccount.projectRef}.supabase.co`,
    TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
    EXTRA_SECRET: "must-not-cross-manager-boundary",
  };
  return {
    root,
    workspace,
    taskRoot,
    taskId,
    actor,
    old,
    successor,
    launch,
    qualification,
    selection,
    selectionFile,
    nativeRoot,
    appRoot,
    newPackage,
    oldPackage,
    nativePath,
    cli,
    managerBin,
    selectedNode,
    environment,
    authEnvironment,
    run,
    carrier,
    taskArgs,
    publicArgs,
    control,
    calls,
    snapshot,
    initial,
    setControl: (value: { auth?: string; query?: string }) =>
      json(control, { auth: "valid", query: "manual", ...value }),
    counts: () =>
      fs
        .readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              kind: string;
              token_present: boolean;
              cache_disabled: boolean;
              ambient_secret_present: boolean;
              node_options_present: boolean;
            },
        ),
    assertPreserved: () => assert.deepEqual(snapshot(), initial),
    packageFiles,
    json,
  };
}

/** Setup-only historical native artifacts; every tested admission/resume remains a real managed subprocess. */
export async function seedManagedIdentityHistory(
  f: Awaited<ReturnType<typeof managedAdoptionFixture>>,
) {
  const contextModule = (await import(
    pathToFileURL(path.join(f.oldPackage, "package-dist/scripts/lib/foundry-runtime-context.js"))
      .href
  )) as typeof import("../../scripts/lib/foundry-runtime-context.ts");
  const store = (await import(
    pathToFileURL(path.join(f.oldPackage, "package-dist/scripts/lib/foundry-task-store.js")).href
  )) as typeof import("../../scripts/lib/foundry-task-store.ts");
  const seed = path.join(f.root, "seed.json");
  const values = (
    JSON.parse(fs.readFileSync(seed, "utf8")) as { rows: Array<Record<string, unknown>> }
  ).rows;
  const base = contextModule.createFoundryRuntimeContext({
    moduleUrl: pathToFileURL(path.join(f.oldPackage, "package-dist/scripts/runtime-entry.js")).href,
    workspace: f.workspace,
    cacheBase: path.join(f.root, "setup-cache"),
    taskId: f.taskId,
    actorId: f.actor,
    accountIntent: managedFixtureAccount,
    inputs: [contextModule.captureFoundryInput(seed)],
  });
  const rowsFile = path.join(f.taskRoot, "outputs/synthetic-history/foundry-rows.json");
  const sets = ["flow", "process", "source"]
    .map((type) => ({
      type,
      file: path.join(f.taskRoot, `outputs/synthetic-history/${type}.jsonl`),
      values: values.filter((row) => `${type}DataSet` in (row.json as Record<string, unknown>)),
    }))
    .filter((set) => set.values.length);
  await store.runFoundryTaskOperation(
    base,
    { command: "dataset-workflow-rows", options: { synthetic_setup: true } },
    (operation) => {
      for (const set of sets)
        operation.writeText(
          set.file,
          set.values.map((value) => JSON.stringify(value)).join("\n") + "\n",
        );
      const report = {
        schema: "tiangong-foundry.rows-stage.v1",
        status: "completed",
        sets: sets.map((set) => ({ type: set.type, file: set.file, count: set.values.length })),
        identity_reports: [],
        identity_rewrite_reports: [],
      };
      operation.writeJson(rowsFile, report);
      return report;
    },
  );
  await store.runFoundryTaskOperation(
    base,
    { command: "dataset-workflow-assessment", options: { synthetic_setup: true } },
    (operation) => {
      const assessedSets = sets.map((set) => {
        const authoringManifest = path.join(
          f.taskRoot,
          `outputs/synthetic-history/authoring/${set.type}/authoring-task-manifest.json`,
        );
        operation.writeJson(authoringManifest, { tasks: [] });
        return { type: set.type, rows: set.file, authoring_manifest: authoringManifest };
      });
      const report = {
        schema: "tiangong-foundry.assessment-stage.v1",
        status: "completed",
        owner_base: base.assetRoot,
        rows_report: rowsFile,
        identity_report: "superseded-synthetic-identity",
        sets: assessedSets,
      };
      operation.writeJson("outputs/synthetic-history/foundry-assessment.json", report);
      return report;
    },
  );
  const predecessor = path.join(f.taskRoot, "outputs/synthetic-history/foundry-identity.json");
  await store.runFoundryTaskOperation(
    base,
    { command: "dataset-workflow-identity", options: { synthetic_setup: true } },
    (operation) => {
      const report = {
        schema: "tiangong-foundry.identity-stage.v1",
        status: "blocked",
        owner_base: base.assetRoot,
        rows_report: rowsFile,
        account: {
          project_ref: managedFixtureAccount.projectRef,
          user_id: managedFixtureAccount.userId,
        },
        sets: [],
        index: null,
        blockers: [{ code: "synthetic-missing-original-raw-auth" }],
      };
      operation.writeJson(predecessor, report);
      return report;
    },
  );
  const descriptor = path.join(f.root, "explicit-readonly.json");
  json(descriptor, {
    schema: "tiangong-foundry.identity-stage-input.v1",
    intent_id: "same-task-managed-readonly-intent",
    task_id: f.taskId,
    actor_id: f.actor,
    rows_report_sha256: managedFileFact(rowsFile).sha256,
    predecessor_identity_sha256: managedFileFact(predecessor).sha256,
    targets: sets
      .filter((set) => set.type !== "source")
      .flatMap((set) =>
        set.values.map((row) => ({
          dataset_type: set.type,
          dataset_id: row.id,
          dataset_version: row.version,
          source_row_sha256: sha256Json(row),
        })),
      ),
  });
  return {
    descriptor,
    predecessor,
    predecessorBefore: managedFileFact(predecessor),
    source: sets.find((set) => set.type === "source")!.file,
    sourceBefore: managedFileFact(sets.find((set) => set.type === "source")!.file),
    rowsFile,
  };
}
export async function adoptManagedFixture(f: Awaited<ReturnType<typeof managedAdoptionFixture>>) {
  const planned = (
    await f.run(
      f.launch,
      f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]),
    )
  ).operation;
  assert.equal(planned.status, "ready", JSON.stringify(planned));
  const artifact = planned.artifacts.find((item) => item.role === "runtime_adoption_plan");
  assert.ok(artifact?.kind === "inline");
  const plan = path.join(f.root, "adoption-plan.json");
  f.json(plan, artifact.value);
  const applied = (await f.run(f.launch, f.taskArgs("adopt-runtime", ["--apply", "--plan", plan])))
    .operation;
  assert.equal(applied.status, "completed", JSON.stringify(applied));
  const audited = (await f.run(f.launch, f.taskArgs("adopt-runtime", ["--audit"]))).operation;
  assert.equal(audited.status, "completed", JSON.stringify(audited));
  f.assertPreserved();
  return { planned, applied, audited };
}
export const managedExplicitStage = (
  operation: FoundryOperationResult,
): Record<string, unknown> => {
  const artifact = operation.artifacts.findLast(
    (item) => item.role === "explicit_readonly_identity_stage",
  );
  assert.ok(artifact?.kind === "inline", JSON.stringify(operation));
  return artifact.value as Record<string, unknown>;
};
