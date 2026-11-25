import {
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  copyTrustedRuntimeManifestBytes,
  trustRuntimeManifest,
  type RuntimeHostContext,
  type RuntimeLaunch,
  type TrustedRuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import {
  createFoundryRuntimeAdoptionQualification,
  type TrustedFoundryRuntimeAdoptionQualification,
} from "./foundry-task-runtime-adoption.ts";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import { transferHash } from "./foundry-migration-transfer-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export const FOUNDRY_MANAGED_ADOPTION_SCHEMA = "tiangong-foundry.managed-adoption.v1" as const;
export const FOUNDRY_MANAGED_ADOPTION_PATH = "metadata/foundry-adoption.json" as const;
const protocolPrefix = "tiangong-foundry.managed-adoption.";
type Reference = RuntimeLaunch["executable"];

export interface ManagedFoundryAdoption {
  readonly manifest: TrustedRuntimeManifest;
  readonly qualification?: TrustedFoundryRuntimeAdoptionQualification;
}

function fail(message: string): never {
  throw new FoundryContextError("managed_runtime_invalid", message);
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Managed adoption control metadata must be an object.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    fail("Managed adoption control metadata has missing or unsupported fields.");
  return record;
}

/** Admit only an independently trusted carrier; task, environment and argv bytes are not inputs. */
export function prepareFoundryManagedAdoption(
  context: RuntimeHostContext,
  read: (reference: Reference, limit: number) => Uint8Array,
  target: Reference | null = null,
): ManagedFoundryAdoption | null {
  // The public CLI's brand prevents a serialized carrier from issuing host authority.
  copyTrustedRuntimeManifestBytes(context.manifest);
  const carrier = context.manifest.manifest;
  const controls = carrier.components.filter(
    (component) =>
      component.protocols.some((protocol) => protocol.startsWith(protocolPrefix)) ||
      component.files.some((file) => file.path === FOUNDRY_MANAGED_ADOPTION_PATH),
  );
  if (!controls.length) return null;
  if (controls.length !== 1) fail("Managed adoption requires exactly one control component.");
  const control = controls[0];
  const protocols = control.protocols.filter((protocol) => protocol.startsWith(protocolPrefix));
  if (protocols.some((protocol) => protocol !== FOUNDRY_MANAGED_ADOPTION_SCHEMA))
    throw new FoundryContextError(
      "managed_runtime_unsupported",
      "This Foundry package cannot read the selected managed adoption protocol.",
    );
  if (
    protocols.length !== 1 ||
    control.protocols.length !== 1 ||
    control.platform !== context.host.platform ||
    control.files.some((file) => file.mode !== 0o644)
  )
    fail("Managed adoption control must use one supported protocol and non-executable files.");
  if (target !== null) fail("Managed adoption cannot be mixed with a rollback target policy.");
  if (
    carrier.launches.some(
      (launch) =>
        launch.executable.component === control.id ||
        launch.argv.some(
          (argument) => "component" in argument && argument.component === control.id,
        ),
    )
  )
    fail("Managed adoption control cannot be referenced by a runtime launch.");
  const reference = (value: unknown): Reference => {
    const item = object(value, ["component", "path"]);
    if (
      item.component !== control.id ||
      typeof item.path !== "string" ||
      !control.files.some((file) => file.path === item.path)
    )
      fail("Managed adoption references must name files in the same control component.");
    return { component: control.id, path: item.path };
  };
  const bound = (ref: Reference, limit: number) => {
    const fact = control.files.find((file) => file.path === ref.path);
    if (ref.component !== control.id || !fact || fact.bytes > limit)
      fail("Managed adoption control file is missing or exceeds its inventory bound.");
    const data = Buffer.from(read(ref, limit));
    if (data.length !== fact.bytes || transferHash(data) !== fact.sha256)
      fail("Managed adoption control bytes changed after inventory admission.");
    return { data, sha256: fact.sha256 };
  };
  const metadata = object(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bound({ component: control.id, path: FOUNDRY_MANAGED_ADOPTION_PATH }, 256 * 1024).data,
      ),
    ),
    ["schema", "platform", "successor_manifest", "launches"],
  );
  if (
    metadata.schema !== FOUNDRY_MANAGED_ADOPTION_SCHEMA ||
    metadata.platform !== context.host.platform
  )
    fail("Managed adoption control metadata must match its protocol and current platform.");
  const successorFile = bound(reference(metadata.successor_manifest), 32 * 1024 * 1024);
  const manifest = trustRuntimeManifest(successorFile.data, successorFile.sha256);
  const { components: runtimeComponents, ...runtimeFields } = manifest.manifest;
  const { components: carrierComponents, ...carrierFields } = carrier;
  if (
    runtimeComponents.some((component) => component.id === control.id) ||
    sha256Json(runtimeFields) !== sha256Json(carrierFields) ||
    sha256Json(runtimeComponents) !==
      sha256Json(carrierComponents.filter((component) => component !== control))
  )
    fail("Managed adoption carrier must preserve every runtime component and execution binding.");
  if (
    !Array.isArray(metadata.launches) ||
    !metadata.launches.length ||
    metadata.launches.length > 16
  )
    fail("Managed adoption requires bounded explicit launch policies.");
  const seen = new Set<string>();
  const policies = metadata.launches.map((value: unknown) => {
    const item = object(value, ["id", "qualification"]);
    if (
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(item.id) ||
      seen.has(item.id) ||
      !carrier.launches.some(
        (launch) =>
          launch.platform === context.host.platform &&
          launch.id === item.id &&
          launch.context_protocol === RUNTIME_HOST_CONTEXT_PROTOCOL,
      )
    )
      fail("Managed adoption policies require unique declared managed launch ids.");
    seen.add(item.id);
    return {
      id: item.id,
      qualification: item.qualification === null ? null : reference(item.qualification),
    };
  });
  const selected = policies.find((policy) => policy.id === context.entry);
  if (!selected) fail("The selected managed launch requires an explicit adoption policy.");
  if (selected.qualification === null) return Object.freeze({ manifest });
  const qualificationFile = bound(selected.qualification, 8 * 1024 * 1024);
  const qualification = createFoundryRuntimeAdoptionQualification({
    bytes: qualificationFile.data,
    expectedSha256: qualificationFile.sha256,
  });
  if (qualification.value.successor_manifest_sha256 !== manifest.sha256)
    fail("Managed adoption qualification must bind the exact successor runtime manifest.");
  return Object.freeze({ manifest, qualification });
}
