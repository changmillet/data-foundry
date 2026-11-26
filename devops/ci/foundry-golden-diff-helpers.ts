import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { JsonRecord } from "./foundry-golden-fixtures.ts";

export function normalizeGoldenLegacyContracts(value: JsonRecord): JsonRecord | null {
  // #98 adds current profile-rule evidence to the fixed generic support fixture.
  // Only this exact reviewed rule digest may be omitted for the old/new comparison.
  if (
    value.profile === "generic" &&
    value.dataset_type === "support" &&
    value.target_user_id === "00000000-0000-4000-8000-000000000000" &&
    value.profile_rules_sha256 ===
      "6f0186da749ee4be26717071c4294b2fc7adf8eada2d37013c326324497e4bf4"
  ) {
    const { profile_rules_sha256: _profileRules, ...priorEnvelope } = value;
    return priorEnvelope;
  }
  // #98: exact reviewed rule-list transition from historical global exceptions to
  // task-bound authority. Bind the entire four-profile public projection; any other
  // rule, waiver, full-context, description, doc or default-profile change still fails.
  if (value.profiles && value.default_profile) {
    const projection = {
      schema_version: value.schema_version,
      default_profile: value.default_profile,
      profiles: value.profiles,
    };
    const digest = createHash("sha256").update(JSON.stringify(projection)).digest("hex");
    if (
      [
        "09a5eee67d148109fde4c93a9a6e50d729c803fd996a8c3f8f9cb8f5f587d210",
        "c5e200e5f9f5926da41869ead3701655bb88eb6d13c5cacb6628e7bac461f539",
      ].includes(digest)
    ) {
      return {
        ...value,
        schema_version: "<task-profile-rules-v2>",
        profiles: "<task-profile-rules-v2>",
      };
    }
  }
  // #97 replaces the legacy API-key example with two additional OAuth public inputs.
  // Bind the complete successful env-surface report; any new error or other change still fails.
  if (value.file === ".env.example") {
    const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    if (
      [
        "0e3ad50419bf8947e7a7736b3d97dff76e42f73471ab2bcda8cfc3ee3f487b37",
        "fcf4ade16b65a2cd77910d972062ea5e4522be52cfb487199545d0f6bb039642",
      ].includes(digest)
    ) {
      return { ...value, variable_count: "<oauth-env-contract>" };
    }
  }
  // #112 admits only the exact reviewed native-version wording transition.
  // All other capability fields and every unreviewed gate text remain compared.
  if (
    value.id === "cli.dataset.contract-context" &&
    typeof value.verification_gate === "string" &&
    [
      "a013b31338bc5ac996c1a0b95bf43003836e10181d8075c4e1372c7398e95714",
      "8747c9ebb10457b9be9b7e4686d6466a469021aac1ecc74b0c0ce2c879b01533",
    ].includes(createHash("sha256").update(value.verification_gate).digest("hex"))
  ) {
    return { ...value, verification_gate: "<reviewed-tidas-version-admission>" };
  }
  return null;
}

export function normalizeGoldenResidualContracts(value: JsonRecord): JsonRecord {
  if (value.id === "foundry.dataset.commit-handoff-plan") {
    return {
      ...value,
      output_contract: "<commit-handoff-command-spec-contract>",
      verification_gate: "<commit-handoff-command-spec-verification>",
      source_manifest_requirements: ["<commit-handoff-command-spec-requirements>"],
    };
  }
  if (value.id === "foundry.dataset.post-write-closeout") {
    return {
      ...value,
      input_contract: "<post-write-closeout-command-spec-input>",
    };
  }
  if (
    ["safety_policy", "profile_context"].includes(String(value.kind ?? "")) &&
    typeof value.path === "string" &&
    Object.hasOwn(value, "sha256")
  ) {
    return { ...value, sha256: "<policy_snapshot_sha256>" };
  }
  return value;
}

export function summarizeJsonDifferences(baselinePath: string, currentPath: string): string[] {
  try {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const current = JSON.parse(readFileSync(currentPath, "utf8"));
    const differences: string[] = [];
    collectJsonDifferences(baseline, current, "", differences, 8);
    return differences;
  } catch {
    return [];
  }
}

function collectJsonDifferences(
  baseline: unknown,
  current: unknown,
  pointer: string,
  differences: string[],
  limit: number,
): void {
  if (differences.length >= limit || Object.is(baseline, current)) return;
  const baselineRecord = baseline && typeof baseline === "object";
  const currentRecord = current && typeof current === "object";
  if (!baselineRecord || !currentRecord || Array.isArray(baseline) !== Array.isArray(current)) {
    differences.push(
      `${pointer || "/"}: ${compactJsonValue(baseline)} -> ${compactJsonValue(current)}`,
    );
    return;
  }
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort();
  const baselineValues = baseline as JsonRecord;
  const currentValues = current as JsonRecord;
  for (const key of keys) {
    if (differences.length >= limit) return;
    const escapedKey = key.replaceAll("~", "~0").replaceAll("/", "~1");
    collectJsonDifferences(
      baselineValues[key],
      currentValues[key],
      `${pointer}/${escapedKey}`,
      differences,
      limit,
    );
  }
}

function compactJsonValue(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return "<missing>";
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`;
}

export function listRelativeFiles(root: string, relative = ""): string[] {
  const files: string[] = [];
  const directory = path.join(root, relative);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listRelativeFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}
