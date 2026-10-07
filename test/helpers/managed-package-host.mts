import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fork, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  copyTrustedRuntimeManifestBytes,
  ensureRuntimeComponents,
  executeRuntimeLaunch,
  inspectRuntimeComponents,
  trustRuntimeManifest,
  type CliRuntimeDescriptor,
  type RuntimeManifest,
  type TrustedRuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import { verifyManagedProcessPreparation } from "./managed-process-preparation.mts";
import {
  exitCodeForFoundryOperationResult,
  assertFoundryOperationResult,
} from "../../scripts/lib/foundry-operation-result.ts";
import { createManagedComponentFixture } from "./managed-package-cache.mts";
import { workspaceManifestFixture } from "./foundry-runtime-manifest.mts";
import { verifyManagedAllocationConsumer } from "./managed-allocation-consumer.mts";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const managedSchema = "tiangong-foundry.managed-runtime.v1";
const entryPath = "node_modules/@tiangong-lca/foundry/package-dist/scripts/package-entry.js";
const applicationId = "managed-application";
const nativeId = "managed-native";
function trusted(value: RuntimeManifest) {
  const bytes = Buffer.from(JSON.stringify(value));
  return trustRuntimeManifest(bytes, hash(bytes));
}

/** Real Node/installed packages and IPC; default native/release metadata are fixtures. Explicit public native qualification can bind an independently verified binary. */
export async function verifyManagedPackageHost(
  installedPackage: string,
  parent: string,
  publicTidasBin?: string,
) {
  const root = path.join(parent, "managed-process-case");
  const input = path.join(root, "input");
  const native = path.join(root, "native-input");
  fs.mkdirSync(path.join(native, "bin"), { recursive: true });
  fs.mkdirSync(path.join(input, "metadata"), { recursive: true });
  const modules = path.dirname(path.dirname(installedPackage));
  fs.cpSync(modules, path.join(input, "node_modules"), {
    recursive: true,
    filter: (source) =>
      !path
        .relative(modules, source)
        .split(path.sep)
        .some((part) => [".bin", ".package-lock.json"].includes(part)),
  });
  const nodePath = process.platform === "win32" ? "bin/node.exe" : "bin/node";
  fs.copyFileSync(process.execPath, path.join(native, nodePath));
  const tidasPath = publicTidasBin
    ? process.platform === "win32"
      ? "bin/tidas.exe"
      : "bin/tidas"
    : "bin/tidas.ts";
  const tidasBytes = fs.readFileSync(
    publicTidasBin ?? new URL("../fixtures/fake-tidas.ts", import.meta.url),
  );
  let nativeVersion = "0.2.7";
  let nativeFingerprint = "1".repeat(64);
  if (publicTidasBin) {
    const described = spawnSync(publicTidasBin, ["validate", "--describe", "--format", "json"], {
      encoding: "utf8",
      shell: false,
    });
    assert.equal(described.status, 0, described.stderr);
    const contract = JSON.parse(described.stdout).summary.validation_describe;
    nativeVersion = contract.package.version;
    nativeFingerprint = contract.asset_fingerprint;
    assert.equal(nativeVersion, "0.3.4");
    assert.equal(
      nativeFingerprint,
      "64f744ae98aa2bd84555c0946fe5a9a42e5a3cb255ff250c1f9141f321d61b43",
    );
  }
  fs.writeFileSync(path.join(native, tidasPath), tidasBytes, { mode: 0o755 });
  const environment: NodeJS.ProcessEnv = {
    HOME: path.join(root, "home"),
    USERPROFILE: path.join(root, "home"),
  };
  fs.mkdirSync(environment.HOME!);
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "PATHEXT", "TEMP", "TMP", "TMPDIR"])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  const inspected = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import {describeCliRuntime} from "@tiangong-lca/cli/runtime"; process.stdout.write(JSON.stringify(describeCliRuntime()));',
    ],
    {
      cwd: path.dirname(modules),
      env: environment,
      shell: false,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(inspected.stderr, "");
  const cli = JSON.parse(inspected.stdout) as CliRuntimeDescriptor;
  const template = workspaceManifestFixture({ write: ["registered-tasks-v2"] });
  const previousInput = path.join(root, "previous-input");
  fs.mkdirSync(previousInput);
  fs.writeFileSync(path.join(previousInput, "tool"), "Previous runtime fixture.\n");
  const previous = await createManagedComponentFixture(
    root,
    "managed-previous",
    previousInput,
    workspaceManifestFixture({ version: "0.0.9" }),
    "tool",
  );
  fs.writeFileSync(
    path.join(input, "metadata/previous-runtime.json"),
    copyTrustedRuntimeManifestBytes(previous.manifest),
  );
  const binding = {
    schema: managedSchema,
    platform: cli.platform,
    cli: {
      schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
      package_version: cli.package.version,
      platform: cli.platform,
      content_sha256: cli.content_sha256,
      node_version: cli.node.version,
      node_sha256: cli.node.sha256,
    },
    tidas: {
      executable: { component: nativeId, path: tidasPath },
      expectation: {
        schema: "tiangong-foundry.tidas-runtime-expectation.v1",
        platform: cli.platform,
        binary_version: nativeVersion,
        executable: { bytes: tidasBytes.length, sha256: hash(tidasBytes) },
        validation: {
          schema_version: "tidas.validation-describe.v1",
          asset_fingerprint: nativeFingerprint,
          protocols: ["document-validation-batch.v1"],
          event_schema_versions: [
            "tidas.validation-final-event.v1",
            "tidas.validation-issue-event.v1",
          ],
        },
      },
    },
    launches: [
      { id: "foundry", access: "write", target: null },
      { id: "foundry-read", access: "read", target: null },
      {
        id: "foundry-rollback",
        access: "write",
        target: { component: applicationId, path: "metadata/previous-runtime.json" },
      },
    ],
  };
  const metadataPath = path.join(input, "metadata/foundry-runtime.json");
  fs.writeFileSync(metadataPath, JSON.stringify(binding));
  const preparedNative = await createManagedComponentFixture(
    root,
    nativeId,
    native,
    template,
    nodePath,
    { executables: [tidasPath] },
  );
  const preparedApplication = await createManagedComponentFixture(
    root,
    applicationId,
    input,
    template,
    entryPath,
    { protocols: [managedSchema] },
  );
  const combined = (application: TrustedRuntimeManifest) =>
    trusted({
      ...template.manifest,
      components: [
        ...application.manifest.components,
        ...preparedNative.manifest.manifest.components,
      ],
      launches: [
        ...binding.launches.map((launch) => ({
          id: launch.id,
          platform: cli.platform,
          executable: { component: nativeId, path: nodePath },
          environment: "isolated" as const,
          context_protocol: RUNTIME_HOST_CONTEXT_PROTOCOL,
          argv: [{ component: applicationId, path: entryPath }],
        })),
        {
          id: "allocation-validation",
          platform: cli.platform,
          executable: { component: nativeId, path: nodePath },
          environment: "isolated" as const,
          argv: [
            {
              component: applicationId,
              path: "node_modules/@tiangong-lca/cli/bin/tiangong-lca.js",
            },
          ],
        },
      ],
    });
  const manifest = combined(preparedApplication.manifest);
  const cache = path.join(root, "components-cache");
  const archiveSeeds: Record<string, string> = {};
  for (const item of [preparedApplication, preparedNative, previous])
    archiveSeeds[inspectRuntimeComponents(item.manifest, { cacheDir: cache }).components[0].key] =
      item.archive;
  const manager = {
    cacheDir: cache,
    archiveSeeds,
    fetchImpl: async () => {
      throw new Error("Managed host fixture must not download components.");
    },
  };
  assert.equal((await ensureRuntimeComponents(previous.manifest, manager)).status, "ready");
  const workspace = path.join(root, "workspace");
  const run = async (
    entry: string,
    argv: string[],
    exit: number | undefined,
    selected = manifest,
  ) => {
    const result = await executeRuntimeLaunch(selected, {
      ...manager,
      entry,
      cwd: root,
      argv,
      env: environment,
      timeoutMs: 90_000,
    });
    if (exit !== undefined) assert.equal(result.status, exit, result.stderr || result.stdout);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    const lines = result.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 1, result.stdout);
    const operation = assertFoundryOperationResult(JSON.parse(lines[0]));
    assert.equal(
      result.status,
      exit ?? exitCodeForFoundryOperationResult(operation),
      result.stdout,
    );
    return operation;
  };
  const init = (selected: string) => ["workspace", "init", "--workspace", selected, "--json"];
  assert.equal((await run("foundry", init(workspace), 0)).status, "ready");
  const doctor = await run("foundry", ["doctor", "--workspace", workspace, "--json"], 0);
  assert.equal(doctor.status, "ready");
  assert.equal(
    (doctor.runtime_identity as { qualification: { status: string } }).qualification.status,
    "ready",
  );
  const processEvidence = await verifyManagedAllocationConsumer(root, (argv) =>
    executeRuntimeLaunch(manifest, {
      ...manager,
      entry: "allocation-validation",
      cwd: root,
      argv,
      env: environment,
      timeoutMs: 90_000,
    }),
  );
  // CLI validation above is a direct verified-cache launch. The report is selected
  // evidence below, not a Foundry semantic admission decision or remote authority.
  const processSpec = path.join(root, "allocation-process-request.json");
  fs.writeFileSync(
    processSpec,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "managed-allocation-process",
      actor_id: "allocation-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: processEvidence.input }, { path: processEvidence.report }],
      seed: { path: processEvidence.input },
      account_intent: null,
      preparation: null,
    }),
  );
  const processInputBytes = fs.readFileSync(processEvidence.input);
  const processReportBytes = fs.readFileSync(processEvidence.report);
  let processResult = await run(
    "foundry",
    ["task", "start", "--workspace", workspace, "--spec", processSpec, "--json"],
    0,
  );
  const processTaskId = processResult.task_id;
  const jobArtifact = processResult.artifacts.find(
    (item) => item.kind === "file" && item.role === "foundry_job",
  );
  assert.ok(jobArtifact?.kind === "file");
  const job = JSON.parse(fs.readFileSync(jobArtifact.path, "utf8"));
  assert.equal(job.actor_id, "allocation-actor");
  assert.equal(job.task_id, processTaskId);
  const registeredRuntime = (
    processResult.runtime_identity as {
      foundry: {
        package_name: string;
        package_version: string;
        package_manifest_sha256: string;
        entry_sha256: string;
      };
    }
  ).foundry;
  assert.deepEqual(job.runtime_identity, {
    package_name: registeredRuntime.package_name,
    package_version: registeredRuntime.package_version,
    manifest_sha256: registeredRuntime.package_manifest_sha256,
    entry_sha256: registeredRuntime.entry_sha256,
  });
  assert.deepEqual(job.write_policy, { mode: "dry-run", remote_state_code: 0 });
  const sourceBytes = fs.readFileSync(
    path.join(path.dirname(jobArtifact.path), "source-manifest.json"),
  );
  assert.equal(hash(sourceBytes), job.source_manifest.sha256);
  const selectedSources = JSON.parse(sourceBytes.toString()).source_paths as Array<{
    path: string;
    sha256: string;
  }>;
  for (const [file, bytes] of [
    [processEvidence.input, processInputBytes],
    [processEvidence.report, processReportBytes],
  ] as const)
    assert.equal(
      selectedSources.find((item) => item.path === fs.realpathSync(file))?.sha256,
      hash(bytes),
    );
  // Two returned IPC actions prepare the Process context and materialize its rows.
  for (let stage = 0; stage < 2; stage++) {
    const action = processResult.next_actions.find((item) => item.kind === "command");
    assert.ok(action?.kind === "command");
    const child = spawnSync(action.executable, [...action.argv], {
      cwd: action.cwd,
      env: environment,
      shell: false,
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.equal(child.stderr, "");
    processResult = assertFoundryOperationResult(JSON.parse(child.stdout));
    assert.equal(processResult.task_id, processTaskId);
    assert.equal(
      (processResult.runtime_identity as { qualification: { status: string } }).qualification
        .status,
      "ready",
    );
  }
  const processRows = processResult.artifacts.find(
    (item) => item.kind === "file" && path.basename(item.path) === "process.rows.json",
  );
  assert.ok(processRows?.kind === "file");
  const materialized = JSON.parse(fs.readFileSync(processRows.path, "utf8"));
  const inputWrapper = JSON.parse(processInputBytes.toString());
  assert.deepEqual(materialized, [
    { semantic_context: inputWrapper.semantic_context, json: inputWrapper.json_ordered },
  ]);
  assert.equal(hash(fs.readFileSync(processRows.path)), processRows.sha256);
  assert.deepEqual(fs.readFileSync(processEvidence.input), processInputBytes);
  assert.deepEqual(fs.readFileSync(processEvidence.report), processReportBytes);
  await verifyManagedProcessPreparation(root, (argv) =>
    run("foundry", [...argv, "--workspace", workspace], undefined),
  );
  const source = path.join(root, "action-source.json");
  fs.writeFileSync(source, JSON.stringify({ contactDataSet: {} }));
  const spec = path.join(root, "action-request.json");
  fs.writeFileSync(
    spec,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "managed-returned-action",
      actor_id: "action-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["contact"],
      sources: [{ path: source }],
      seed: { path: source },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await run(
    "foundry",
    ["task", "start", "--workspace", workspace, "--spec", spec, "--json"],
    0,
  );
  const action = started.next_actions.find((item) => item.kind === "command");
  assert.ok(action?.kind === "command");
  const continued = spawnSync(action.executable, [...action.argv], {
    cwd: action.cwd,
    env: environment,
    shell: false,
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(continued.status, 0, continued.stderr || continued.stdout);
  assert.equal(continued.stderr, "");
  const continuedResult = assertFoundryOperationResult(JSON.parse(continued.stdout));
  assert.equal(continuedResult.task_id, started.task_id);
  assert.equal(
    (continuedResult.runtime_identity as { qualification: { status: string } }).qualification
      .status,
    "ready",
    "A fresh returned-action process must retain the independent managed qualification.",
  );
  const readOnlyWorkspace = path.join(root, "read-only-workspace");
  const denied = await run("foundry-read", init(readOnlyWorkspace), 4);
  assert.equal(denied.status, "blocked");
  assert.equal(denied.blockers[0].code, "workspace_read_only");
  assert.equal(fs.existsSync(readOnlyWorkspace), false);
  const switchRuntime = (request: string, access: string) => [
    "workspace",
    "migrate",
    "--workspace",
    workspace,
    "--runtime-use",
    "--actor",
    "actor",
    "--request",
    request,
    "--access",
    access,
    "--json",
  ];
  assert.equal(
    (await run("foundry-rollback", switchRuntime("rollback", "read"), 0)).status,
    "ready",
  );
  const pointer = path.join(workspace, ".foundry/state/runtime-selection.json");
  assert.equal(
    JSON.parse(fs.readFileSync(pointer, "utf8")).selected_manifest_sha256,
    previous.manifest.sha256,
  );
  assert.equal((await run("foundry", init(workspace), 4)).status, "blocked");
  assert.equal((await run("foundry", switchRuntime("restore", "write"), 0)).status, "ready");
  assert.equal(
    JSON.parse(fs.readFileSync(pointer, "utf8")).selected_manifest_sha256,
    manifest.sha256,
  );
  for (const forbidden of [cache, path.join(cache, "new-workspace")]) {
    const result = await run("foundry", init(forbidden), 1);
    assert.equal(result.blockers[0].code, "runtime_cache_boundary");
    assert.equal(fs.existsSync(path.join(forbidden, ".foundry")), false);
  }
  const markerBytes = fs.readFileSync(path.join(workspace, ".foundry/workspace.json"));
  const pointerBytes = fs.readFileSync(pointer);
  const invalid = async (
    name: string,
    changed: typeof binding,
    expectedExit: number,
    code: string,
  ) => {
    fs.writeFileSync(metadataPath, JSON.stringify(changed));
    const variantRoot = path.join(root, name);
    fs.mkdirSync(variantRoot);
    const variant = await createManagedComponentFixture(
      variantRoot,
      applicationId,
      input,
      template,
      entryPath,
      { protocols: [managedSchema] },
    );
    archiveSeeds[
      inspectRuntimeComponents(variant.manifest, { cacheDir: cache }).components[0].key
    ] = variant.archive;
    const rejectedWorkspace = path.join(root, `${name}-workspace`);
    const result = await run(
      "foundry",
      init(rejectedWorkspace),
      expectedExit,
      combined(variant.manifest),
    );
    assert.equal(result.blockers[0].code, code);
    assert.equal(fs.existsSync(rejectedWorkspace), false);
  };
  const futureBinding = {
    ...binding,
    schema: "tiangong-foundry.managed-runtime.v999",
    future_field: true,
  };
  await invalid("unknown-protocol", futureBinding, 4, "managed_runtime_unsupported");
  await invalid(
    "wrong-cli",
    { ...binding, cli: { ...binding.cli, content_sha256: "0".repeat(64) } },
    1,
    "managed_runtime_invalid",
  );
  await invalid(
    "wrong-tidas",
    {
      ...binding,
      tidas: { ...binding.tidas, executable: { component: nativeId, path: nodePath } },
    },
    1,
    "managed_runtime_invalid",
  );
  const declaredExtraArgument = trusted({
    ...manifest.manifest,
    launches: manifest.manifest.launches.map((launch) => ({
      ...launch,
      argv: [...launch.argv, { literal: "unexpected" }],
    })),
  });
  const extraWorkspace = path.join(root, "extra-argument-workspace");
  assert.equal(
    (await run("foundry", init(extraWorkspace), 1, declaredExtraArgument)).blockers[0].code,
    "managed_runtime_invalid",
  );
  assert.equal(fs.existsSync(extraWorkspace), false);
  const foreignProduct = trusted({
    ...manifest.manifest,
    product: { ...manifest.manifest.product, version: "9.9.9" },
  });
  const foreignWorkspace = path.join(root, "foreign-product-workspace");
  assert.equal(
    (await run("foundry", init(foreignWorkspace), 1, foreignProduct)).blockers[0].code,
    "managed_runtime_invalid",
  );
  assert.equal(fs.existsSync(foreignWorkspace), false);
  assert.deepEqual(fs.readFileSync(path.join(workspace, ".foundry/workspace.json")), markerBytes);
  assert.deepEqual(fs.readFileSync(pointer), pointerBytes);
  if (process.platform !== "win32") {
    const installed = inspectRuntimeComponents(manifest, { cacheDir: cache });
    const application = installed.components.find((item) => item.id === applicationId)!;
    const nativeComponent = installed.components.find((item) => item.id === nativeId)!;
    const interruptedWorkspace = path.join(root, "interrupted-workspace");
    const child = fork(path.join(application.root, entryPath), init(interruptedWorkspace), {
      execPath: path.join(nativeComponent.root, nodePath),
      execArgv: [],
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stdout = "",
      stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (value: string) => {
      stdout += value;
    });
    child.stderr!.setEncoding("utf8").on("data", (value: string) => {
      stderr += value;
    });
    const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        let timedOut = false;
        const deadline = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, 15_000);
        child.once("message", () => {
          child.kill("SIGINT");
        });
        child.once("error", (error) => {
          clearTimeout(deadline);
          reject(error);
        });
        child.once("close", (code, signal) => {
          clearTimeout(deadline);
          if (timedOut)
            reject(new Error("Managed startup interruption did not close its IPC channel."));
          else resolve({ code, signal });
        });
      },
    );
    assert.deepEqual(closed, { code: 130, signal: null });
    assert.equal(stderr, "");
    assert.equal(stdout.trimEnd().split("\n").length, 1);
    assert.equal(
      assertFoundryOperationResult(JSON.parse(stdout)).blockers[0].code,
      "operation_interrupted",
    );
    assert.equal(fs.existsSync(interruptedWorkspace), false);
  }
}
