import { createHash } from "node:crypto";

import { FoundryContextError } from "./foundry-runtime-context.ts";

const components = [
  { key: "schema", name: "schema.json" },
  { key: "methodology", name: "methodology.yaml" },
  { key: "ruleset", name: "runtime-ruleset.json" },
] as const;

function cliType(type: string): string {
  return type === "lifecyclemodel" ? "model" : type;
}

export function createTypedContextCommand(type: string, output: string): string[] {
  return [
    "dataset",
    cliType(type),
    "contract",
    "--include",
    components.map(({ key }) => key).join(","),
    "--output",
    output,
    "--json",
  ];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function reject(message: string): never {
  throw new FoundryContextError("workflow_context_invalid", message);
}

export function projectTypedContext(type: string, output: string, receipt: unknown, bytes: Buffer) {
  const result = record(receipt);
  const artifact = Array.isArray(result.artifacts) ? record(result.artifacts[0]) : {};
  if (
    result.schemaVersion !== 1 ||
    result.operation !== `dataset ${cliType(type)} contract` ||
    result.status !== "completed" ||
    result.outcome !== "contract_read" ||
    artifact.path !== output ||
    artifact.purpose !== "complete_result" ||
    artifact.bytes !== bytes.length
  )
    return reject("Invalid typed CLI contract receipt for the current task scope.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return reject("Typed CLI contract output must be valid JSON.");
  }
  const contract = record(parsed);
  const manifest = record(contract.manifest);
  if (
    !["sdk-contract-api", "sdk-runtime-assets"].includes(String(contract.source)) ||
    manifest.kind !== type ||
    typeof manifest.profile !== "string" ||
    !Array.isArray(contract.unavailable)
  )
    return reject("Typed CLI contract manifest does not match the task dataset type.");

  const payload = record(contract.components);
  const files = [];
  for (const { key, name } of components) {
    const value = payload[key];
    const fact = record(manifest[key]);
    if (
      value === null &&
      manifest[key] === null &&
      contract.unavailable.includes(key) &&
      key !== "schema" &&
      type !== "flow" &&
      type !== "process"
    )
      continue;

    const text =
      key === "ruleset" && value && typeof value === "object" && !Array.isArray(value)
        ? JSON.stringify(value, null, 2)
        : value;
    if (typeof text !== "string" || !text.length || contract.unavailable.includes(key))
      return reject(`Typed CLI contract is missing ${key} for ${type}.`);
    if (
      Buffer.byteLength(text) !== fact.bytes ||
      createHash("sha256").update(text).digest("hex") !== fact.sha256
    )
      return reject(`Typed CLI contract ${key} digest does not match its manifest.`);
    files.push({ key, name, text });
  }
  return { source: contract.source, manifest, profile: manifest.profile, files };
}
