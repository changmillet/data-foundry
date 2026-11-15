import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  executeRuntimeLaunch,
  inspectRuntimeComponents,
  loadTrustedRuntimeManifest,
  RUNTIME_HOST_CONTEXT_PROTOCOL,
} from "@tiangong-lca/cli/runtime";
import { runFoundryPublicCommand } from "../runtime-entry.ts";
import { receiveFoundryManagedHost } from "./foundry-managed-host.ts";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import { transferHash, transferRead } from "./foundry-migration-transfer-io.ts";

const help = `Usage: tiangong-foundry runtime describe --json [--require-protocol <schema>]
       tiangong-foundry <workspace|task|doctor> <public arguments>

Configure the installed entry with TIANGONG_FOUNDRY_MANIFEST and
TIANGONG_FOUNDRY_MANIFEST_SHA256 from a verified Foundry release.
TIANGONG_FOUNDRY_CACHE_DIR selects an existing absolute component cache.
TIANGONG_FOUNDRY_ENTRY optionally selects a declared launch (default: foundry).

runtime describe reads local identity, protocols and cache readiness without
authentication, downloads or workspace changes. Missing configuration/assets or
unsupported required protocols exit nonzero. Install the selected release with
the existing CLI runtime ensure command, then repeat runtime describe.

Configured operations use the selected verified managed runtime. Continue an
existing task through its returned executable/argv/cwd to retain its binding.
`;

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function configuration(env: NodeJS.ProcessEnv) {
  const manifest = env.TIANGONG_FOUNDRY_MANIFEST;
  const digest = env.TIANGONG_FOUNDRY_MANIFEST_SHA256;
  const cacheDir = env.TIANGONG_FOUNDRY_CACHE_DIR;
  const entry = env.TIANGONG_FOUNDRY_ENTRY ?? "foundry";
  if ([manifest, digest, cacheDir, env.TIANGONG_FOUNDRY_ENTRY].every((item) => item === undefined))
    return null;
  if (!manifest || !path.isAbsolute(manifest) || !digest || !/^[a-f0-9]{64}$/u.test(digest))
    fail(
      "runtime_configuration_invalid",
      "Set an absolute TIANGONG_FOUNDRY_MANIFEST and its independently verified TIANGONG_FOUNDRY_MANIFEST_SHA256 together.",
    );
  if (cacheDir !== undefined && (!cacheDir || !path.isAbsolute(cacheDir)))
    fail(
      "runtime_configuration_invalid",
      "TIANGONG_FOUNDRY_CACHE_DIR must be an absolute directory.",
    );
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(entry))
    fail("runtime_configuration_invalid", "TIANGONG_FOUNDRY_ENTRY must name a declared launch.");
  if (!fs.existsSync(manifest))
    fail(
      "runtime_manifest_missing",
      "The configured manifest is missing. Install the selected release manifest before invoking Foundry.",
    );
  const trusted = loadTrustedRuntimeManifest(manifest, digest);
  if (trusted.manifest.product.id !== "tiangong-foundry")
    fail(
      "runtime_product_unsupported",
      "The configured manifest must declare the tiangong-foundry product.",
    );
  const report = inspectRuntimeComponents(trusted, { cacheDir });
  const launch = trusted.manifest.launches.find(
    (item) => item.id === entry && item.platform === report.platform,
  );
  if (
    !launch ||
    launch.context_protocol !== RUNTIME_HOST_CONTEXT_PROTOCOL ||
    launch.argv.length !== 1 ||
    !("component" in launch.argv[0])
  )
    fail(
      "runtime_launch_unsupported",
      "Select a declared Foundry managed launch with the runtime host protocol.",
    );
  return { trusted, report, launch, cacheDir, entry, manifest };
}

function describe(selection: NonNullable<ReturnType<typeof configuration>>, required: string[]) {
  const { trusted, report, launch } = selection;
  const application = launch.argv[0];
  if (!("component" in application))
    fail("runtime_launch_unsupported", "Managed launch requires a package entry.");
  let cliVersion: string | null = null;
  let protocols: string[] = [];
  if (report.status === "ready") {
    const component = trusted.manifest.components.find(
      (item) => item.id === application.component && item.platform === report.platform,
    )!;
    const installed = report.components.find((item) => item.id === application.component)!;
    const descriptorPath = path.posix.join(
      path.posix.dirname(application.path),
      "../assets/foundry-package-descriptor.json",
    );
    const fact = component.files.find((item) => item.path === descriptorPath);
    if (!fact)
      fail(
        "runtime_descriptor_missing",
        "Selected release does not bind a public Foundry package descriptor.",
      );
    const bytes = transferRead(path.join(installed.root, descriptorPath), 8 * 1024 * 1024);
    if (bytes.length !== fact.bytes || transferHash(bytes) !== fact.sha256)
      fail(
        "runtime_descriptor_changed",
        "Selected package descriptor differs from the verified manifest.",
      );
    const value = JSON.parse(bytes.toString("utf8")) as {
      schema?: unknown;
      package?: {
        name?: unknown;
        version?: unknown;
        cli_dependency?: { name?: unknown; version?: unknown };
      };
      runtime?: { protocol_schemas?: unknown };
    } | null;
    if (
      value?.schema !== "tiangong-foundry.package-descriptor.v1" ||
      value.package?.name !== "@tiangong-lca/foundry" ||
      value.package.version !== trusted.manifest.product.version ||
      value.package.cli_dependency?.name !== "@tiangong-lca/cli" ||
      typeof value.package.cli_dependency.version !== "string" ||
      !Array.isArray(value.runtime?.protocol_schemas) ||
      !value.runtime.protocol_schemas.every((item: unknown) => typeof item === "string")
    )
      fail(
        "runtime_descriptor_unsupported",
        "Selected release has an unsupported or inconsistent package descriptor.",
      );
    cliVersion = value.package.cli_dependency.version;
    protocols = value.runtime.protocol_schemas;
  }
  const missing = required.filter((protocol) => !protocols.includes(protocol));
  const status = report.status === "ready" && missing.length ? "unsupported" : report.status;
  return {
    schema: "tiangong-foundry.runtime-description.v1",
    status,
    product: trusted.manifest.product,
    cli_version: cliVersion,
    manifest_sha256: trusted.sha256,
    entry: selection.entry,
    platform: report.platform,
    components: report.components,
    protocols,
    protocol_assessment: report.status === "ready" ? "checked" : "not_checked",
    unsupported_protocols: report.status === "ready" ? missing : [],
    next:
      status === "missing"
        ? "Install the selected components with tiangong-lca runtime ensure using this manifest and digest."
        : status === "ready"
          ? "Use the public task commands; retain returned actions for existing tasks."
          : "Select a compatible verified release or repair its installation, then repeat runtime describe.",
  };
}

/** Deployment selection happens before managed IPC. Existing returned actions enter IPC directly. */
export async function runFoundryInstalledCommand(argv = process.argv): Promise<void> {
  if (typeof process.send === "function") {
    await runFoundryPublicCommand(argv, {}, receiveFoundryManagedHost);
    return;
  }
  const args = argv.slice(2);
  if (
    (args.length === 1 && ["--help", "-h"].includes(args[0])) ||
    (args[0] === "runtime" && args.includes("--help"))
  ) {
    process.stdout.write(help);
    return;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  try {
    const selected = configuration(process.env);
    if (args[0] === "runtime") {
      if (args[1] !== "describe")
        fail("runtime_operation_unsupported", "Use tiangong-foundry runtime describe --json.");
      const { values } = parseArgs({
        args: args.slice(2),
        strict: true,
        allowPositionals: false,
        options: {
          json: { type: "boolean" },
          "require-protocol": { type: "string", multiple: true },
        },
      });
      if (!values.json) fail("argument_json_required", "runtime describe requires --json.");
      if (!selected)
        fail(
          "runtime_not_configured",
          "Configure TIANGONG_FOUNDRY_MANIFEST and TIANGONG_FOUNDRY_MANIFEST_SHA256 from the installed release, then repeat runtime describe --json.",
        );
      const result = describe(selected, values["require-protocol"] ?? []);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.status === "ready" ? 0 : 4;
      return;
    }
    if (!selected) {
      await runFoundryPublicCommand(argv, {}, receiveFoundryManagedHost);
      return;
    }
    if (selected.report.status !== "ready")
      fail(
        "runtime_not_ready",
        "Selected runtime components are missing or invalid. Inspect tiangong-foundry runtime describe --json, then install the selected release with runtime ensure.",
      );
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const result = await executeRuntimeLaunch(selected.trusted, {
      cacheDir: selected.cacheDir,
      entry: selected.entry,
      cwd: process.cwd(),
      argv: args,
      env: process.env,
      signal: controller.signal,
      fetchImpl: async () =>
        fail(
          "runtime_installation_required",
          "A selected component disappeared before launch. Install it explicitly with runtime ensure, then inspect readiness before continuing.",
        ),
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.error && !result.stderr)
      process.stderr.write(
        "Foundry managed launch failed; inspect the selected runtime before recovery.\n",
      );
    process.exitCode = controller.signal.aborted ? 130 : result.error ? 1 : (result.status ?? 1);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ schema: "tiangong-foundry.runtime-description.v1", status: "blocked", error: { code: error instanceof FoundryContextError ? error.code : "runtime_selection_failed", message: error instanceof FoundryContextError ? error.message : "Runtime selection failed. Check configuration, manifest integrity and installed components with runtime describe --json." } })}\n`,
    );
    process.exitCode = 4;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
