import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { executeRuntimeLaunch, inspectRuntimeComponents } from "@tiangong-lca/cli/runtime";
import { FOUNDRY_BOOTSTRAP_CLI } from "./foundry-release-bootstrap.ts";
import { assertFoundryOperationResult } from "./foundry-operation-result.ts";
import {
  preparedFoundryRuntimeAuthority,
  type PreparedFoundryRuntimeComponents,
} from "./foundry-release-components.ts";
import {
  foundryComponentJson as json,
  writeFoundryComponentFile,
  freezeFoundryReleaseValue,
  foundryComponentHash as hash,
} from "./foundry-release-component-io.ts";

import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import {
  createFoundryRetainedConsumerCache,
  assertFoundryRetainedConsumerCache,
  discardFoundryRetainedConsumerCache,
  type FoundryRetainedConsumerCache,
} from "./foundry-release-consumer-cache.ts";

const qualifiedConsumerCaches = new WeakMap<
  object,
  {
    prepared: PreparedFoundryRuntimeComponents;
    cache: FoundryRetainedConsumerCache;
  }
>();

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Runtime qualification received an invalid identity object.");
  return value as Record<string, unknown>;
}

/** Independent public-CLI consumer of the in-process prepared artifacts; no receipt grants authority. */
export async function qualifyFoundryRuntimeComponents(
  prepared: PreparedFoundryRuntimeComponents,
  options: { readonly retainConsumerCache?: boolean } = {},
) {
  const authority = preparedFoundryRuntimeAuthority(prepared);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-qualification-"));
  const retainedCache = options.retainConsumerCache
    ? createFoundryRetainedConsumerCache(prepared.output)
    : null;
  const cache = retainedCache?.path ?? path.join(root, "component-cache");
  const workspace = path.join(root, "项目 workspace");
  const home = path.join(root, "home"),
    temporary = path.join(root, "temp"),
    emptyPath = path.join(root, "no-global-tools");
  for (const directory of [workspace, home, temporary, emptyPath]) fs.mkdirSync(directory);
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    PATH: emptyPath,
    Path: emptyPath,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "windir",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  let downloads = 0,
    launches = 0;
  const checks: Array<{
    operation: string;
    entry: string;
    exit: number;
    status: string;
    milliseconds: number;
  }> = [];
  let failure: Record<string, unknown> = { phase: "setup" };
  const run = async (entry: string, argv: string[], expectedExit: number, seed = false) => {
    const started = performance.now();
    failure = { phase: "launch", entry, index: launches, expected_exit: expectedExit };
    const result = await executeRuntimeLaunch(authority.manifest, {
      cacheDir: cache,
      entry,
      cwd: workspace,
      argv,
      env: environment,
      archiveSeeds: seed ? authority.seeds : {},
      timeoutMs: 120_000,
      fetchImpl: async () => {
        downloads += 1;
        throw new Error("Qualified local archives and warm cache must not download components.");
      },
    });
    launches += 1;
    failure = {
      ...failure,
      observed_exit: result.status,
      signalled: Boolean(result.signal),
      execution_error: Boolean(result.error),
      stderr_present: Boolean(result.stderr),
      stdout_lines: result.stdout.trimEnd().split("\n").length,
    };
    if (
      result.status !== expectedExit ||
      result.signal ||
      result.error ||
      result.stderr ||
      result.stdout.trimEnd().split("\n").length !== 1
    )
      throw new Error(
        `Assembled runtime launch failed its public result contract (${entry}, expected exit ${expectedExit}, observed ${result.status}).`,
      );
    const value = assertFoundryOperationResult(JSON.parse(result.stdout));
    checks.push({
      operation: value.operation,
      entry,
      exit: expectedExit,
      status: value.status,
      milliseconds: Math.round(performance.now() - started),
    });
    return value;
  };
  try {
    if (inspectRuntimeComponents(authority.manifest, { cacheDir: cache }).status === "ready")
      throw new Error("Runtime cold qualification did not start with an empty cache.");
    const init = await run(
      "foundry",
      ["workspace", "init", "--workspace", workspace, "--json"],
      0,
      true,
    );
    if (init.status !== "ready")
      throw new Error("Assembled runtime did not initialize its isolated workspace.");
    const doctor = await run("foundry", ["doctor", "--workspace", workspace, "--json"], 0);
    const runtime = object(doctor.runtime_identity),
      foundry = object(runtime.foundry),
      qualification = object(runtime.qualification);
    const identity = object(qualification.identity),
      cli = object(identity.cli),
      tidas = object(identity.tidas);
    if (
      doctor.status !== "ready" ||
      qualification.status !== "ready" ||
      foundry.package_version !== authority.expected.foundry ||
      cli.package_version !== authority.expected.cli ||
      cli.node_version !== authority.expected.node ||
      tidas.binary_version !== authority.expected.tidas ||
      tidas.asset_fingerprint !== authority.expected.assetFingerprint
    )
      throw new Error(
        "Assembled runtime identity differs from its independently prepared package and native inputs.",
      );
    const source = path.join(workspace, "source.jsonl"),
      spec = path.join(workspace, "task.json");
    fs.writeFileSync(source, '{"flowDataSet":{}}\n');
    fs.writeFileSync(
      spec,
      json({
        schema: "tiangong-foundry.task-start.v1",
        request_id: "runtime-qualification",
        actor_id: "release-qualifier",
        lane: "external-dataset-curated-import",
        profile_id: "generic",
        target_entities: ["flow"],
        sources: [{ path: source }],
        seed: null,
        account_intent: null,
        preparation: {
          operation: "dataset-curation-cleanup",
          type: "flow",
          input: source,
          source_input: null,
          output_directory: "outputs/cleanup",
        },
      }),
    );
    const started = await run(
      "foundry",
      ["task", "start", "--workspace", workspace, "--spec", spec, "--json"],
      0,
    );
    if (!started.task_id || started.status !== "ready")
      throw new Error("Assembled runtime did not register its local qualification task.");
    const task = [
      "--workspace",
      workspace,
      "--task",
      started.task_id,
      "--actor",
      "release-qualifier",
      "--json",
    ];
    await run("foundry", ["task", "status", ...task], 0);
    await run("foundry", ["task", "resume", ...task], 0);
    const selection = (request: string, access: string) => [
      "workspace",
      "migrate",
      "--workspace",
      workspace,
      "--runtime-use",
      "--actor",
      "release-qualifier",
      "--request",
      request,
      "--access",
      access,
      "--json",
    ];
    await run("foundry", selection("read-selection", "read"), 0);
    await run("foundry-read", ["task", "status", ...task], 0);
    await run("foundry", ["workspace", "init", "--workspace", workspace, "--json"], 4);
    await run("foundry", selection("restore-writer", "write"), 0);
    await run("foundry", ["doctor", "--workspace", workspace, "--json"], 0);
    await run("foundry", ["profiles-list", "--workspace", workspace, "--json"], 2);
    if (
      downloads ||
      inspectRuntimeComponents(authority.manifest, { cacheDir: cache }).status !== "ready"
    )
      throw new Error("Warm runtime qualification downloaded or changed its verified components.");
    const nodeBase = inspectRuntimeComponents(authority.manifest, {
      cacheDir: cache,
    }).components.find((component) => component.id === "node");
    if (!nodeBase) throw new Error("Bootstrap base is missing after native qualification.");
    const receipt = path.join(path.dirname(nodeBase.root), "receipt.json");
    fs.unlinkSync(receipt);
    for (const phase of ["bootstrap-adoption", "bootstrap-warm"]) {
      failure = { phase };
      const started = performance.now();
      const output = spawnSync(
        path.join(nodeBase.root, `bin/node${prepared.platform === "win32-x64" ? ".exe" : ""}`),
        [
          path.join(nodeBase.root, FOUNDRY_BOOTSTRAP_CLI),
          "runtime",
          "exec",
          "--manifest",
          path.join(prepared.output, prepared.manifest.file),
          "--manifest-sha256",
          prepared.manifest.sha256,
          "--cache-dir",
          cache,
          "--entry",
          "foundry",
          "--cwd",
          workspace,
          "--",
          "doctor",
          "--workspace",
          workspace,
          "--json",
        ],
        {
          cwd: workspace,
          env: environment,
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      if (
        output.status !== 0 ||
        output.signal ||
        output.error ||
        output.stderr ||
        output.stdout.trimEnd().split("\n").length !== 1
      )
        throw new Error(`Bootstrap base CLI failed ${phase}.`);
      const result = assertFoundryOperationResult(JSON.parse(output.stdout));
      const identity = object(object(object(result.runtime_identity).qualification).identity);
      if (
        result.status !== "ready" ||
        object(identity.cli).package_version !== authority.expected.cli ||
        object(identity.cli).node_version !== authority.expected.node ||
        object(identity.tidas).binary_version !== authority.expected.tidas ||
        !fs.existsSync(receipt)
      )
        throw new Error(
          "Bootstrap base identity or cache adoption differs from its expected runtime.",
        );
      launches += 1;
      checks.push({
        operation: result.operation,
        entry: phase,
        exit: 0,
        status: result.status,
        milliseconds: Math.round(performance.now() - started),
      });
    }
    if (inspectRuntimeComponents(authority.manifest, { cacheDir: cache }).status !== "ready")
      throw new Error("Bootstrap base did not leave a verified warm cache.");
    preparedFoundryRuntimeAuthority(prepared);
    if (retainedCache) assertFoundryRetainedConsumerCache(retainedCache);
    const report = freezeFoundryReleaseValue({
      schema: "tiangong-foundry.runtime-component-qualification.v1",
      status: "passed",
      scope: "native-local-archive-runtime",
      source: prepared.source,
      platform: prepared.platform,
      manifest_sha256: prepared.manifest.sha256,
      package_source: prepared.scope,
      runtime_identity: doctor.runtime_identity,
      manager_download_calls: downloads,
      launches,
      bootstrap_base: { status: "passed", receipt_adopted: true, warm_verified: true },
      checks,
      global_node_or_package_manager_required: false,
      release_blockers: prepared.release_blockers,
      ...(retainedCache
        ? { consumer_cache: { path: retainedCache.path, selection_only: true } }
        : {}),
    });
    writeFoundryComponentFile(prepared.output, "runtime-qualification.json", json(report));
    if (retainedCache) qualifiedConsumerCaches.set(report, { prepared, cache: retainedCache });
    return report;
  } catch (error) {
    if (retainedCache) discardFoundryRetainedConsumerCache(retainedCache);
    const report = {
      schema: "tiangong-foundry.runtime-diagnostic.v1",
      status: "failed",
      source: prepared.source,
      platform: prepared.platform,
      failure,
      completed_checks: checks,
      launches,
      manager_download_calls: downloads,
    };
    writeFoundryComponentFile(prepared.output, "runtime-diagnostic.json", json(report));
    process.stderr.write(`${JSON.stringify(report)}\n`);
    throw error;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Produces a public CLI selection, never a replacement for public launch admission or task authorization. */
export function createFoundryRuntimeCandidateEntry(
  prepared: PreparedFoundryRuntimeComponents,
  qualification: Awaited<ReturnType<typeof qualifyFoundryRuntimeComponents>>,
) {
  const selected = qualifiedConsumerCaches.get(qualification);
  if (!selected || selected.prepared !== prepared)
    throw new Error(
      "Candidate entry requires its fresh in-process qualification with retained consumer cache.",
    );
  const authority = preparedFoundryRuntimeAuthority(prepared);
  assertFoundryRetainedConsumerCache(selected.cache);
  const inspected = inspectRuntimeComponents(authority.manifest, { cacheDir: selected.cache.path });
  if (inspected.status !== "ready")
    throw new Error("Candidate consumer cache no longer matches its verified component inventory.");
  const manifestPath = path.join(prepared.output, prepared.manifest.file);
  const manifestBytes = readFoundryReleaseArtifact(manifestPath, 32 * 1024 * 1024);
  const reportPath = path.join(prepared.output, "runtime-qualification.json");
  const reportBytes = readFoundryReleaseArtifact(reportPath, 32 * 1024 * 1024);
  if (hash(manifestBytes) !== prepared.manifest.sha256 || !reportBytes.equals(json(qualification)))
    throw new Error("Candidate manifest or qualification report changed before entry generation.");
  const components = prepared.components.map((component) => {
    const cached = inspected.components.find((item) => item.id === component.id);
    const archivePath = cached ? authority.seeds[cached.key] : undefined;
    if (!cached || !archivePath) throw new Error("Candidate local archive binding is incomplete.");
    const archive = readFoundryReleaseArtifact(archivePath, 512 * 1024 * 1024);
    if (archive.length !== component.archive.bytes || hash(archive) !== component.archive.sha256)
      throw new Error("Candidate local archive changed from its manifest binding.");
    return {
      id: component.id,
      key: cached.key,
      version: component.version,
      platform: component.platform,
      archive: { path: archivePath, bytes: archive.length, sha256: hash(archive) },
      content_sha256: component.content_sha256,
      files: component.files,
      cache_root: cached.root,
    };
  });
  const node = inspected.components.find((component) => component.id === "node");
  if (!node) throw new Error("Candidate entry lacks its verified Node/CLI bootstrap base.");
  const executable = path.join(
    node.root,
    `bin/node${prepared.platform === "win32-x64" ? ".exe" : ""}`,
  );
  const cli = path.join(node.root, FOUNDRY_BOOTSTRAP_CLI);
  const entry = freezeFoundryReleaseValue({
    schema: "tiangong-foundry.runtime-candidate-entry.v1",
    purpose: "explicit-local-public-cli-selection",
    source: prepared.source,
    platform: prepared.platform,
    package_source: prepared.scope,
    cli: prepared.cli,
    manifest: { path: manifestPath, bytes: manifestBytes.length, sha256: prepared.manifest.sha256 },
    qualification: {
      path: reportPath,
      bytes: reportBytes.length,
      sha256: hash(reportBytes),
      status: qualification.status,
      diagnostic_only: true,
    },
    components,
    consumer_cache: {
      path: selected.cache.path,
      component_keys: inspected.components.map((component) => component.key),
      public_cli_revalidation_required: true,
    },
    command_prefix: {
      executable,
      argv: [
        cli,
        "runtime",
        "exec",
        "--manifest",
        manifestPath,
        "--manifest-sha256",
        prepared.manifest.sha256,
        "--cache-dir",
        selected.cache.path,
        "--entry",
        "foundry",
      ],
      shell: false,
      append: ["--cwd", "<consumer-cwd>", "--", "<public-operation-argv>"],
    },
    limits: [
      "Selection material conveys no runtime, account, task, scientific or write authority.",
      "The public CLI rechecks the independently selected manifest digest and complete component cache on every launch.",
      "Original production tasks and runtimes are not adopted by this qualification.",
      "Local qualification does not prove published download URLs or four-platform release acceptance.",
    ],
    release_blockers: prepared.release_blockers,
  });
  assertFoundryRetainedConsumerCache(selected.cache);
  if (
    inspectRuntimeComponents(authority.manifest, { cacheDir: selected.cache.path }).status !==
    "ready"
  )
    throw new Error("Candidate cache changed during entry generation.");
  const file = writeFoundryComponentFile(prepared.output, "candidate-entry.json", json(entry));
  return freezeFoundryReleaseValue({
    path: path.join(prepared.output, file.path),
    bytes: file.bytes,
    sha256: file.sha256,
  });
}
