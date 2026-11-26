import path from "node:path";
import { sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readJson,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";
import { isAnnualSupplyTarget } from "./workflow-queue-context.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface ActionItem extends JsonRecord {
  source?: unknown;
  code?: unknown;
  rule_id?: unknown;
  ruleId?: unknown;
  path?: unknown;
  message?: unknown;
  evidence?: unknown;
  instruction?: unknown;
  action_kind?: unknown;
  required_owner?: unknown;
  ai_required?: unknown;
  common_other_deferral_allowed?: unknown;
  commonOtherDeferralAllowed?: unknown;
  deferral_cleanup_path?: unknown;
  deferral_trace_path?: unknown;
}

interface CompactActionItem extends JsonRecord {
  index: number;
  source: string | null;
  code: string;
  path: string | null;
  json_pointer: string;
  message: string | null;
  evidence: unknown;
  instruction: string | null;
  allowed_resolution_modes: string[];
  action_kind: string;
  required_owner: string;
  ai_required: boolean;
  common_other_deferral_allowed: boolean;
  deferral_cleanup_path: string | null;
  deferral_trace_path: string | null;
}

interface SharedContextOptions {
  repoRoot: string;
  sharedContextBundle: unknown;
  sourceKind: string;
  sourcePath?: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asActionItem(value: unknown): ActionItem {
  return isRecord(value) ? value : {};
}

export function jsonPointerToken(value: unknown): string {
  return String(value).replace(/~/gu, "~0").replace(/\//gu, "~1");
}

export function dotPathToJsonPointer(value: unknown): string {
  const text = asText(value);
  if (!text || text === "<root>") return "/__AI_FILL_JSON_POINTER__";
  if (text.startsWith("/")) return text;
  const normalized = text.replace(/\[(\d+)\]/gu, ".$1").replace(/^\.+|\.+$/gu, "");
  const tokens = normalized
    .split(".")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "/__AI_FILL_JSON_POINTER__";
  return `/${tokens.map(jsonPointerToken).join("/")}`;
}

export function actionItemClosure(item: unknown): { code: string; path?: string } {
  const typedItem = asActionItem(item);
  const code = asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId) || "action_item";
  const itemPath = asText(typedItem.path) || null;
  return {
    code,
    ...(itemPath ? { path: itemPath } : {}),
  };
}

export const allowedPatchResolutionModes = new Set([
  "evidence_backed_completion",
  "source_language_normalization",
  "classification_decision",
  "location_decision",
  "exchange_set_repaired",
  "source_trace_verified",
  "deferred_to_common_other",
]);

export function actionItemAllowsCommonOtherDeferral(item: unknown): boolean {
  const typedItem = asActionItem(item);
  if (
    typedItem.common_other_deferral_allowed === true ||
    typedItem.commonOtherDeferralAllowed === true
  ) {
    return true;
  }
  const code = asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId);
  const itemPath = asText(typedItem.path);
  if (isAnnualSupplyTarget(code, itemPath)) return true;
  return [
    "source_system_boilerplate",
    "local_source_path_visible",
    "trace_visible",
    "provenance_visible",
  ].some((token) => code.includes(token));
}

export function actionItemResolutionModes(item: unknown): string[] {
  const typedItem = asActionItem(item);
  const code = asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId);
  const itemPath = asText(typedItem.path);
  if (code.includes("classification")) return ["classification_decision"];
  if (code.includes("location")) return ["location_decision"];
  if (isAnnualSupplyTarget(code, itemPath)) {
    return ["evidence_backed_completion", "deferred_to_common_other"];
  }
  if (code.includes("only_output_exchange"))
    return ["source_trace_verified", "exchange_set_repaired"];
  if (actionItemAllowsCommonOtherDeferral(item)) {
    return ["source_language_normalization", "deferred_to_common_other"];
  }
  if (code.includes("placeholder") || code.includes("geography_token") || code.includes("name")) {
    return ["evidence_backed_completion", "source_language_normalization"];
  }
  return ["evidence_backed_completion"];
}

export function compactActionItemForAuthoring(item: unknown, index: number): CompactActionItem {
  const typedItem = asActionItem(item);
  const itemPath = asText(typedItem.path) || null;
  return {
    index,
    source: asText(typedItem.source) || null,
    code: asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId) || "action_item",
    path: itemPath,
    json_pointer: dotPathToJsonPointer(itemPath),
    message: asText(typedItem.message) || null,
    evidence: typedItem.evidence ?? null,
    instruction: asText(typedItem.instruction) || null,
    allowed_resolution_modes: actionItemResolutionModes(item),
    action_kind: asText(typedItem.action_kind) || "ai_authoring",
    required_owner: asText(typedItem.required_owner) || "foundry_ai_authoring",
    ai_required: typedItem.ai_required !== false,
    common_other_deferral_allowed: actionItemAllowsCommonOtherDeferral(item),
    deferral_cleanup_path: asText(typedItem.deferral_cleanup_path) || null,
    deferral_trace_path: asText(typedItem.deferral_trace_path) || null,
  };
}

export function markdownList(values: unknown, fallback = "- none"): string {
  const rows = ensureArray(values).filter(
    (value) => value !== undefined && value !== null && value !== "",
  );
  if (rows.length === 0) return fallback;
  return rows.map((value) => `- ${String(value)}`).join("\n");
}

export function relOrNull(repoRoot: string, filePath: string | null | undefined): string | null {
  return filePath ? repoRelativePath(repoRoot, filePath) : null;
}

export function packageContextFileSummary(contextFiles: unknown): JsonRecord[] {
  return ensureArray(contextFiles).map((file) => {
    const typedFile = asRecord(file);
    return {
      kind: asText(typedFile.kind) || "context",
      path: asText(typedFile.path) || null,
      sha256: sha256Text(typedFile.text ?? ""),
      bytes: Buffer.byteLength(String(typedFile.text ?? ""), "utf8"),
    };
  });
}

export const decisionOnlyActionKinds = new Set([
  "identity_decision_authoring",
  "classification_decision_authoring",
  "location_decision_authoring",
]);

export function isPatchAuthoringActionItem(item: unknown): boolean {
  const typedItem = asActionItem(item);
  if (!item || typedItem.ai_required === false) return false;
  return !decisionOnlyActionKinds.has(asText(typedItem.action_kind));
}

export function patchAuthoringActionItems(packagePayload: unknown): CompactActionItem[] {
  return ensureArray(asRecord(packagePayload).action_items)
    .filter(isPatchAuthoringActionItem)
    .map(compactActionItemForAuthoring);
}

export function decisionOnlyActionItems(packagePayload: unknown): CompactActionItem[] {
  return ensureArray(asRecord(packagePayload).action_items)
    .filter((item) => asActionItem(item).ai_required !== false && !isPatchAuthoringActionItem(item))
    .map(compactActionItemForAuthoring);
}

export function buildPatchTemplate(packagePayload: unknown, packagePath: string): JsonRecord {
  const typedPackage = asRecord(packagePayload);
  const actionItems = patchAuthoringActionItems(packagePayload);
  const packageRef = path.basename(packagePath);
  const requiredContextKinds = ensureArray(
    asRecord(typedPackage.full_context_ai_completion).required_context_kinds ??
      asRecord(typedPackage.full_context_ai_completion).requiredContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
  const templateContextKinds =
    requiredContextKinds.length > 0
      ? requiredContextKinds
      : ["schema", "methodology_yaml", "ruleset"];
  return {
    schema_version: 1,
    kind: "tiangong_foundry_dataset_patch_template",
    template_status: "requires_ai_completion",
    instructions: [
      "Replace __AI_FILL_VALUE__ with the final JSON value and fill basis or evidence before applying.",
      "For full-context import profiles, every non-test operation must include both basis and structured evidence with source plus quote_or_trace/source_path/field_path/citation.",
      "Use test operations before replace/add/remove when preserving an existing value matters.",
      "Treat generated paths as suggestions. Adjust JSON Pointers when a field is an array or the authoring package shows a different concrete structure.",
      "Keep closes_action_items aligned with the authoring package action_items resolved by each operation.",
      "For full-context import profiles, every non-test operation must close at least one authoring action item; supporting cleanup operations should close the same item they are needed to resolve.",
      "Do not remove authoring_package; strict Foundry apply uses it for package lineage and action-item closure.",
      "Do not use common:other as a substitute for mandatory schema fields. Only action items whose allowed_resolution_modes include deferred_to_common_other may be deferred.",
      "For deferred_to_common_other, add tiangongfoundry:unresolvedTrace under common:other with status, action_item_code, blocked_path, reason, structured evidence, and next_action. Evidence must include source plus quote_or_trace/source_path/field_path/citation.",
      "Do not defer annualSupplyOrProductionVolume to common:other and do not invent a quantity from a reference flow or a default unit. Supply a real annualized quantity from source evidence, or leave the field to Foundry deterministic cleanup, which normalizes it to the supported empty array and records a row-level evidence gap.",
      "For source_trace_verified, add tiangongfoundry:sourceExchangeCompleteness under common:other with accepted status and structured source trace evidence. Evidence must include source plus quote_or_trace/source_path/field_path/citation.",
    ],
    patch_sets: [
      {
        dataset_id: typedPackage.entity_id ?? typedPackage.process_id ?? null,
        version: typedPackage.version ?? "00.00.001",
        authoring_package: packageRef,
        operations: actionItems.map((item) => ({
          op: "replace",
          path: item.json_pointer,
          value: "__AI_FILL_VALUE__",
          basis: "",
          evidence: {
            source: "",
            quote_or_trace: "",
          },
          resolution: {
            mode: "__AI_FILL_RESOLUTION_MODE__",
            allowed_modes: item.allowed_resolution_modes,
            used_context_kinds: templateContextKinds,
            summary: "",
            deferred_reason: null,
          },
          closes_action_items: [actionItemClosure(item)],
        })),
      },
    ],
  };
}

export function fullContextAiConfigRequiresAuthoring(value: unknown): boolean {
  const record = asRecord(value);
  return record.required === true || record.required === "true";
}

export function requiredFullContextKinds(value: unknown): string[] {
  const record = asRecord(value);
  const kinds = ensureArray(record.required_context_kinds ?? record.requiredContextKinds)
    .map((kind) => asText(kind))
    .filter(Boolean);
  return kinds.length > 0
    ? kinds
    : ["schema", "methodology_yaml", "ruleset", "classification_schema", "location_schema"];
}

export function requiredFullContextFilePatterns(value: unknown): string[] {
  const record = asRecord(value);
  return ensureArray(record.required_context_file_patterns ?? record.requiredContextFilePatterns)
    .map((pattern) => asText(pattern))
    .filter(Boolean);
}

export function contextSummaryHasNonEmptyPayload(file: unknown): boolean {
  const record = asRecord(file);
  if (Number(record.bytes ?? 0) > 0) return true;
  return Buffer.byteLength(String(record.text ?? ""), "utf8") > 0;
}

export function contextSummaryHasKind(files: unknown, kind: string): boolean {
  return ensureArray(files).some(
    (file) => asText(asRecord(file).kind) === kind && contextSummaryHasNonEmptyPayload(file),
  );
}

export function contextSummaryHasPattern(files: unknown, pattern: unknown): boolean {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some(
    (file) =>
      String(asRecord(file).path ?? "")
        .toLowerCase()
        .includes(needle) && contextSummaryHasNonEmptyPayload(file),
  );
}

export function stableSharedContextBundleSha256(bundle: unknown): string | null {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return null;
  }
  const {
    generated_at_utc: _generatedAtUtc,
    generatedAtUtc: _generatedAtUtcCamel,
    hash_scope: _hashScope,
    hashScope: _hashScopeCamel,
    sha256: _sha256,
    ...stablePayload
  } = bundle as JsonRecord;
  return sha256Text(JSON.stringify(stablePayload));
}

export function sharedContextBundleReadinessBlockers({
  repoRoot,
  sharedContextBundle,
  sourceKind,
  sourcePath = null,
}: SharedContextOptions): JsonRecord[] {
  const sharedContext = asRecord(sharedContextBundle);
  const sharedPath = asText(sharedContext.path);
  if (!sharedPath) return [];
  const expectedSha256 = asText(sharedContext.sha256);
  const prefix =
    sourceKind === "manifest"
      ? "authoring_manifest_shared_context_bundle"
      : "authoring_task_shared_context_bundle";
  const sourceField = sourceKind === "manifest" ? "task_manifest" : "authoring_task";
  const sourceValue = sourcePath ? repoRelativeArtifactPath(repoRoot, sourcePath) : null;
  const base = {
    stage: "ai_patch_collect",
    shared_context_bundle: repoRelativeArtifactPath(repoRoot, sharedPath),
    ...(sourceValue ? { [sourceField]: sourceValue } : {}),
  };
  const bundlePath = resolveRepoPath(repoRoot, sharedPath);
  if (!bundlePath || !fileExists(bundlePath)) {
    return [
      {
        ...base,
        code: `${prefix}_missing`,
        message:
          "AI patch collect cannot verify a referenced shared full-context bundle because it is unreadable.",
        expected_sha256: expectedSha256 || null,
      },
    ];
  }
  if (!expectedSha256) {
    return [
      {
        ...base,
        code: `${prefix}_hash_missing`,
        message:
          "AI patch collect requires shared full-context bundle references to be hash-bound.",
      },
    ];
  }
  try {
    const bundle = readJson<JsonRecord>(bundlePath);
    const actualSha256 = asText(bundle.sha256);
    const computedSha256 = stableSharedContextBundleSha256(bundle);
    const blockers: JsonRecord[] = [];
    if (actualSha256 !== expectedSha256) {
      blockers.push({
        ...base,
        code: `${prefix}_hash_mismatch`,
        message:
          "Shared full-context bundle sha256 no longer matches the task or manifest reference.",
        expected_sha256: expectedSha256,
        actual_sha256: actualSha256 || null,
      });
    }
    if (actualSha256 && computedSha256 && actualSha256 !== computedSha256) {
      blockers.push({
        ...base,
        code: `${prefix}_content_hash_mismatch`,
        message: "Shared full-context bundle content no longer matches its recorded stable sha256.",
        expected_sha256: actualSha256,
        actual_sha256: computedSha256,
      });
    }
    if (!Array.isArray(bundle.files)) {
      blockers.push({
        ...base,
        code: `${prefix}_invalid`,
        message: "Shared full-context bundle must be a JSON object with files[].",
      });
    }
    return blockers;
  } catch (error) {
    return [
      {
        ...base,
        code: `${prefix}_invalid`,
        message: error instanceof Error ? error.message : String(error),
        expected_sha256: expectedSha256,
      },
    ];
  }
}
