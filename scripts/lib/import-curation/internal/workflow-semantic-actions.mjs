import path from "node:path";
import {
  dataSetInformation,
  datasetRoot,
} from "./dataset-payload.mjs";
import {
  fullContextAiCompletionRequirement,
} from "./context-inputs.mjs";
import {
  sha256Text,
} from "./hash-utils.mjs";
import {
  collectCommonOtherTraceEntries,
} from "./trace-summary.mjs";
import {
  annualSupplyMissingDataSentinelText,
} from "./prewrite-cleanup.mjs";
import {
  asText,
  ensureArray,
  fileExists,
  readJson,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.mjs";
import {
  hasNonEmptyTraceEvidence,
} from "./workflow-authoring-tasks.mjs";
import {
  hasStructuredTraceEvidence,
} from "./workflow-patch-evidence.mjs";
import {
  isAnnualSupplyTarget,
} from "./workflow-queue-context.mjs";

// part-02.mjs
export function collectTextEntries(value, pathName = "") {
  const entries = [];
  const visit = (node, currentPath) => {
    if (typeof node === "string") {
      entries.push({ path: currentPath, text: node });
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("@")) continue;
      visit(child, currentPath ? `${currentPath}.${key}` : key);
    }
  };
  visit(value, pathName);
  return entries;
}

export function nameCarrier(root, datasetType) {
  const info = dataSetInformation(root, datasetType);
  return info?.name && typeof info.name === "object" ? info.name : {};
}

export function nameTextForPayload(payload, datasetType) {
  const root = datasetRoot(payload, datasetType);
  return collectTextEntries(nameCarrier(root, datasetType))
    .map((entry) => entry.text)
    .join(" ");
}

export function flowTypeForPayload(payload) {
  const root = datasetRoot(payload, "flow");
  return asText(
    root?.modellingAndValidation?.LCIMethod?.typeOfDataSet ??
      root?.modellingAndValidation?.LCIMethodAndAllocation?.typeOfDataSet,
  );
}

export function flowUsesElementaryClassification(payload) {
  return /^elementary flow$/iu.test(flowTypeForPayload(payload));
}

export function flowUsesProductClassification(payload) {
  const type = flowTypeForPayload(payload);
  return /^product flow$/iu.test(type) || /^waste flow$/iu.test(type);
}

export function classificationActionPathForPayload(payload, datasetType) {
  if (datasetType === "flow") {
    return flowUsesElementaryClassification(payload)
      ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:elementaryFlowCategorization"
      : "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification";
  }
  return "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification";
}

export function classificationEntriesForPayload(payload, datasetType) {
  const root = datasetRoot(payload, datasetType);
  const info = dataSetInformation(root, datasetType);
  if (datasetType === "flow") {
    const classificationInformation = info?.classificationInformation ?? {};
    const categories =
      classificationInformation?.["common:elementaryFlowCategorization"]?.[
        "common:category"
      ] ??
      classificationInformation?.elementaryFlowCategorization?.category ??
      [];
    const classes =
      classificationInformation?.["common:classification"]?.[
        "common:class"
      ] ??
      classificationInformation?.classification?.class ??
      [];
    const items = flowUsesElementaryClassification(payload)
      ? categories
      : classes;
    return ensureArray(items)
      .filter((entry) => entry && typeof entry === "object")
      .map((entry, index) => ({
        index,
        level: asText(entry["@level"]),
        class_id: asText(entry["@classId"] ?? entry["@catId"]),
        text: asText(entry["#text"]),
      }));
  }
  const classes =
    info?.classificationInformation?.["common:classification"]?.[
      "common:class"
    ] ??
    info?.classificationInformation?.classification?.class ??
    [];
  return ensureArray(classes)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      index,
      level: asText(entry["@level"]),
      class_id: asText(entry["@classId"] ?? entry["@catId"]),
      text: asText(entry["#text"]),
    }));
}

export function classificationPathForPayload(payload, datasetType) {
  return classificationEntriesForPayload(payload, datasetType)
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
}

export function processExchangeList(payload) {
  const root = datasetRoot(payload, "process");
  return ensureArray(root?.exchanges?.exchange).filter(
    (exchange) => exchange && typeof exchange === "object",
  );
}

export function hasFoundryOtherEvidence(value, evidenceKey, acceptedStatuses = []) {
  let found = false;
  const accepted = new Set(
    acceptedStatuses.map((status) => String(status).toLowerCase()),
  );
  const visit = (node) => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const other = node["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      const evidence = other[evidenceKey];
      if (evidence !== undefined) {
        if (accepted.size === 0) {
          found = true;
          return;
        }
        for (const item of ensureArray(evidence)) {
          const status = asText(
            item?.status ?? item?.decision_status ?? item?.decisionStatus,
          );
          if (status && accepted.has(status.toLowerCase())) {
            found = true;
            return;
          }
        }
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return found;
}

export function semanticActionItem({
  code,
  path: itemPath,
  message,
  evidence,
  instruction,
  common_other_deferral_allowed = false,
  action_kind = "ai_authoring",
}) {
  return {
    source: "profile_semantic_gate",
    code,
    path: itemPath ?? null,
    message,
    evidence: evidence ?? null,
    instruction,
    action_kind,
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed,
  };
}

export function collectTextQualitySemanticActions(payload, datasetType) {
  const entries = collectTextEntries(payload);
  const actions = [];
  const seen = new Set();
  const add = (item) => {
    const key = JSON.stringify([item.code, item.path, item.message]);
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(item);
  };
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    const pathLower = entry.path.toLowerCase();
    const isNameLike =
      pathLower.includes(".name.") ||
      pathLower.endsWith(".common:shortdescription.#text") ||
      pathLower.endsWith(".common:shortname.#text") ||
      pathLower.endsWith(".common:name.#text") ||
      pathLower.includes("functionalunitorother");
    if (
      /__AI_FILL_[A-Z0-9_]*__|TIDAS_IMPORT_PLACEHOLDER|UNSPECIFIED_TEXT|Not declared in source package|placeholder\.example|pending-confirmation/iu.test(
        text,
      )
    ) {
      add(
        semanticActionItem({
          code: "semantic_placeholder_text",
          path: entry.path,
          message:
            "Payload contains placeholder or unresolved import text that schema validation alone cannot accept.",
          evidence: { text },
          instruction:
            "Use the full schema/YAML/context authoring package to replace this with source-language content, or move unresolved provenance into common:other when schema permits.",
        }),
      );
    }
    if (/\bxx\b/iu.test(text) && isNameLike) {
      add(
        semanticActionItem({
          code: "semantic_name_placeholder_token",
          path: entry.path,
          message: 'Name-like text contains the placeholder token "xx".',
          evidence: { text },
          instruction:
            "Derive a source-language name plan from source evidence and TIDAS name YAML semantics; do not keep placeholder tokens in final name fields.",
        }),
      );
    }
    if (/\{[A-Z]{2,3}\}/u.test(text) && isNameLike) {
      add(
        semanticActionItem({
          code: "semantic_geography_token_in_name",
          path: entry.path,
          message:
            "Name-like text contains a geography token such as {GLO}; geography belongs in the geography/location fields or name-plan mix/location segment as defined by the contract.",
          evidence: { text },
          instruction:
            "Use the full schema/YAML/context authoring package to split geography out of base names and materialize display names from proper fields.",
        }),
      );
    }
    if (
      /\bBAFU ecoSpold1 source\b/iu.test(text) &&
      /\b(Not specified|No |not declared|is specified)\b/iu.test(text)
    ) {
      add(
        semanticActionItem({
          code: "semantic_source_system_boilerplate_visible",
          path: entry.path,
          message:
            "User-facing text contains source-system boilerplate. Source-system details should be evidence/provenance, not visible filler.",
          evidence: { text },
          instruction:
            'Use neutral source-language text such as "Not specified" when the schema requires content; preserve BAFU/ecoSpold provenance in evidence or common:other.',
          common_other_deferral_allowed: true,
        }),
      );
    }
    if (/\/Users\/|\.zip:|LCI ecoSpold version2 Files/iu.test(text)) {
      add(
        semanticActionItem({
          code: "semantic_local_source_path_visible",
          path: entry.path,
          message:
            "Payload contains local source path or package trace text in a visible field.",
          evidence: { text },
          instruction:
            "Move local/package trace to authoring evidence or safe common:other provenance before remote write.",
          common_other_deferral_allowed: true,
        }),
      );
    }
  }
  return actions.map((item) => ({ ...item, dataset_type: datasetType }));
}

export function isBafuConvertedDefaultProcessClassification(classificationPath) {
  return /Other service activities\s*>\s*Activities of membership organizations\s*>\s*Activities of other membership organizations\s*>\s*Activities of other membership organizations n\.e\.c\.|Community,\s*social and personal services\s*>\s*Sewage and waste collection,\s*treatment and disposal and other environmental protection services\s*>\s*Other environmental protection services n\.e\.c\./iu.test(
    classificationPath,
  );
}

export function collectClassificationSemanticActions(
  payload,
  datasetType,
  { profile = null, hasClassificationQueueContext = false } = {},
) {
  if (!["flow", "process"].includes(datasetType)) return [];
  const classes = classificationEntriesForPayload(payload, datasetType);
  const classificationPath = classificationPathForPayload(payload, datasetType);
  const nameText = nameTextForPayload(payload, datasetType);
  const actions = [];
  if (classes.length === 0) {
    actions.push(
      semanticActionItem({
        code: "semantic_classification_missing",
        path: classificationActionPathForPayload(payload, datasetType),
        message: "Dataset is missing target classification information.",
        instruction:
          "Select the target TianGong/TIDAS classification from full source context and record the decision basis.",
      }),
    );
    return actions;
  }
  const sourceLooksIndustrial =
    /\b(hydrometallurgical|Li-ion|battery|batteries|Li salt|lithium|processing)\b/iu.test(
      nameText,
    );
  const classificationLooksService =
    /membership organizations|community, social and personal services|environmental protection services|other service activities/iu.test(
      classificationPath,
    );
  if (
    !hasClassificationQueueContext &&
    ((datasetType === "process") ||
      (datasetType === "flow" && flowUsesProductClassification(payload))) &&
    asText(profile?.id).toLowerCase() === "bafu" &&
    isBafuConvertedDefaultProcessClassification(classificationPath)
  ) {
    actions.push(
      semanticActionItem({
        code: "semantic_classification_converted_default",
        path: classificationActionPathForPayload(payload, datasetType),
        message:
          `BAFU ${datasetType} classification still has the tidas-tools converted default service path and must be replaced with a target TIDAS classification.`,
        evidence: {
          name_text: nameText,
          classification_path: classificationPath,
        },
        instruction:
          `Use the BAFU source context, classification queue/candidates when available, and the full schema/YAML/context package to choose the target TianGong/TIDAS ${datasetType} classification.`,
      }),
    );
  }
  if (sourceLooksIndustrial && classificationLooksService) {
    actions.push(
      semanticActionItem({
        code: "semantic_classification_mismatch",
        path:
          datasetType === "flow"
            ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification"
            : "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification",
        message:
          "The selected classification appears to be copied from source/converted data and does not match the dataset semantics.",
        evidence: {
          name_text: nameText,
          classification_path: classificationPath,
        },
        instruction:
          "Use the classification command/candidates and full schema/YAML/context package to choose a target TianGong/TIDAS classification, and keep source classification only as provenance.",
      }),
    );
  }
  return actions;
}

export function collectProcessExchangeSemanticActions(payload) {
  const exchanges = processExchangeList(payload);
  if (exchanges.length === 0) return [];
  const directions = exchanges.map((exchange) =>
    asText(exchange.exchangeDirection),
  );
  const hasInput = directions.some((direction) => /^input$/iu.test(direction));
  const hasOnlyOutput =
    directions.length > 0 &&
    directions.every((direction) => /^output$/iu.test(direction));
  if (
    !hasInput &&
    hasOnlyOutput &&
    !hasFoundryOtherEvidence(
      payload,
      "tiangongfoundry:sourceExchangeCompleteness",
      [
        "source_only_output_exchange_verified",
        "accepted_source_only_output",
        "verified",
      ],
    )
  ) {
    return [
      semanticActionItem({
        code: "semantic_process_only_output_exchange_requires_review",
        path: "processDataSet.exchanges.exchange",
        message:
          "Process exchanges contain outputs only. This may be source-faithful, but it must be explicitly verified against the source package before remote write.",
        evidence: { exchange_count: exchanges.length, directions },
        instruction:
          "Analyze source EcoSpold/TIDAS trace in the full authoring package. If source really has only outputs, add evidence under common:other.tiangongfoundry:sourceExchangeCompleteness; otherwise repair the exchange set.",
      }),
    ];
  }
  return [];
}

export function collectFoundryTraceSemanticActions(payload, datasetType) {
  const actions = [];
  const add = (item) => actions.push({ ...item, dataset_type: datasetType });
  for (const trace of collectCommonOtherTraceEntries(
    payload,
    "tiangongfoundry:unresolvedTrace",
  )) {
    const entry = trace.entry;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      add(
        semanticActionItem({
          code: "semantic_unresolved_trace_invalid",
          path: trace.path,
          message:
            "common:other.tiangongfoundry:unresolvedTrace entries must be structured JSON objects.",
          evidence: { trace: entry ?? null },
          instruction:
            "Rewrite the unresolved trace with status, action_item_code, blocked_path, reason, evidence, and next_action.",
          common_other_deferral_allowed: true,
        }),
      );
      continue;
    }
    const status = asText(
      entry.status ?? entry.decision_status ?? entry.decisionStatus,
    );
    const actionCode = asText(
      entry.action_item_code ?? entry.actionItemCode ?? entry.code,
    );
    const blockedPath = asText(
      entry.blocked_path ??
        entry.blockedPath ??
        entry.field_path ??
        entry.fieldPath ??
        entry.path,
    );
    const reason = asText(
      entry.reason ?? entry.deferred_reason ?? entry.deferredReason,
    );
    const nextAction = asText(
      entry.next_action ??
        entry.nextAction ??
        entry.follow_up ??
        entry.followUp,
    );
    const evidence =
      entry.evidence ?? entry.source_evidence ?? entry.sourceEvidence;
    const invalidReasons = [];
    if (
      ![
        "unresolved_deferred",
        "deferred_to_common_other",
        "needs_followup",
      ].includes(status)
    ) {
      invalidReasons.push("status");
    }
    if (!actionCode) invalidReasons.push("action_item_code");
    if (!blockedPath) invalidReasons.push("blocked_path");
    if (!reason) invalidReasons.push("reason");
    if (!hasNonEmptyTraceEvidence(evidence)) {
      invalidReasons.push("evidence");
    } else if (!hasStructuredTraceEvidence(evidence)) {
      invalidReasons.push("evidence_pointer");
    }
    if (!nextAction) invalidReasons.push("next_action");
    if (invalidReasons.length > 0) {
      add(
        semanticActionItem({
          code: "semantic_unresolved_trace_invalid",
          path: trace.path,
          message: `common:other.tiangongfoundry:unresolvedTrace is missing or has invalid fields: ${invalidReasons.join(", ")}.`,
          evidence: { invalid_fields: invalidReasons, trace: entry },
          instruction:
            "Rewrite the unresolved trace with status, action_item_code, blocked_path, reason, evidence, and next_action.",
          common_other_deferral_allowed: true,
        }),
      );
    }
  }

  for (const trace of collectCommonOtherTraceEntries(
    payload,
    "tiangongfoundry:sourceExchangeCompleteness",
  )) {
    const entry = trace.entry;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      add(
        semanticActionItem({
          code: "semantic_source_exchange_trace_invalid",
          path: trace.path,
          message:
            "common:other.tiangongfoundry:sourceExchangeCompleteness entries must be structured JSON objects.",
          evidence: { trace: entry ?? null },
          instruction:
            "Rewrite source exchange completeness evidence with accepted status and source trace evidence.",
          common_other_deferral_allowed: true,
        }),
      );
      continue;
    }
    const status = asText(
      entry.status ?? entry.decision_status ?? entry.decisionStatus,
    );
    const evidence =
      entry.evidence ??
      entry.source_evidence ??
      entry.sourceEvidence ??
      entry.trace;
    const invalidReasons = [];
    if (
      ![
        "source_only_output_exchange_verified",
        "accepted_source_only_output",
        "verified",
      ].includes(status)
    ) {
      invalidReasons.push("status");
    }
    if (!hasNonEmptyTraceEvidence(evidence)) {
      invalidReasons.push("evidence");
    } else if (!hasStructuredTraceEvidence(evidence)) {
      invalidReasons.push("evidence_pointer");
    }
    if (invalidReasons.length > 0) {
      add(
        semanticActionItem({
          code: "semantic_source_exchange_trace_invalid",
          path: trace.path,
          message: `common:other.tiangongfoundry:sourceExchangeCompleteness is missing or has invalid fields: ${invalidReasons.join(", ")}.`,
          evidence: { invalid_fields: invalidReasons, trace: entry },
          instruction:
            "Rewrite source exchange completeness evidence with accepted status and source trace evidence.",
          common_other_deferral_allowed: true,
        }),
      );
    }
  }
  return actions;
}

export function collectFlowReuseSemanticActions(payload, datasetType) {
  if (datasetType !== "flow") return [];
  if (!flowUsesElementaryClassification(payload)) return [];
  const classification = classificationEntriesForPayload(payload, "flow")
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
  return [
    semanticActionItem({
      code: "elementary_flow_requires_existing_database_match",
      path: "flowDataSet.flowInformation.dataSetInformation",
      message:
        "Elementary flow rows cannot be published as BAFU-owned flows. They must be resolved to an existing TianGong database elementary flow before any process that references them can be written.",
      evidence: {
        flow_type: flowTypeForPayload(payload) || null,
        source_flow_name: nameTextForPayload(payload, "flow") || null,
        source_classification: classification || null,
      },
      instruction:
        "Search TianGong existing elementary flows by UUID/version first, then CAS/name/category/synonyms and structured semantic candidates. Output a mapping to the selected existing flow and rewrite process exchange references. If no defensible existing flow exists, keep the flow unresolved in the mapping queue and block the referencing process write.",
      action_kind: "identity_decision_authoring",
    }),
  ];
}

export function collectProfileSemanticActionItems({
  profile,
  datasetType,
  payload,
  hasClassificationQueueContext = false,
}) {
  const requirement = fullContextAiCompletionRequirement(profile, datasetType);
  if (!requirement) return [];
  return [
    ...collectTextQualitySemanticActions(payload, datasetType),
    ...collectClassificationSemanticActions(payload, datasetType, {
      profile,
      hasClassificationQueueContext,
    }),
    ...collectFlowReuseSemanticActions(payload, datasetType),
    ...(datasetType === "process"
      ? collectProcessExchangeSemanticActions(payload)
      : []),
    ...collectFoundryTraceSemanticActions(payload, datasetType),
  ];
}

export function jsonPointerToken(value) {
  return String(value).replace(/~/gu, "~0").replace(/\//gu, "~1");
}

export function dotPathToJsonPointer(value) {
  const text = asText(value);
  if (!text || text === "<root>") return "/__AI_FILL_JSON_POINTER__";
  if (text.startsWith("/")) return text;
  const normalized = text
    .replace(/\[(\d+)\]/gu, ".$1")
    .replace(/^\.+|\.+$/gu, "");
  const tokens = normalized
    .split(".")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "/__AI_FILL_JSON_POINTER__";
  return `/${tokens.map(jsonPointerToken).join("/")}`;
}

export function actionItemClosure(item) {
  const code =
    asText(item?.code ?? item?.rule_id ?? item?.ruleId) || "action_item";
  const itemPath = asText(item?.path) || null;
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

export function actionItemAllowsCommonOtherDeferral(item) {
  if (
    item?.common_other_deferral_allowed === true ||
    item?.commonOtherDeferralAllowed === true
  ) {
    return true;
  }
  const code = asText(item?.code ?? item?.rule_id ?? item?.ruleId);
  const itemPath = asText(item?.path);
  if (isAnnualSupplyTarget(code, itemPath)) return true;
  return [
    "source_system_boilerplate",
    "local_source_path_visible",
    "trace_visible",
    "provenance_visible",
  ].some((token) => code.includes(token));
}

export function actionItemResolutionModes(item) {
  const code = asText(item?.code ?? item?.rule_id ?? item?.ruleId);
  const itemPath = asText(item?.path);
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
  if (
    code.includes("placeholder") ||
    code.includes("geography_token") ||
    code.includes("name")
  ) {
    return ["evidence_backed_completion", "source_language_normalization"];
  }
  return ["evidence_backed_completion"];
}

export function compactActionItemForAuthoring(item, index) {
  const itemPath = asText(item?.path) || null;
  return {
    index,
    source: asText(item?.source) || null,
    code: asText(item?.code ?? item?.rule_id ?? item?.ruleId) || "action_item",
    path: itemPath,
    json_pointer: dotPathToJsonPointer(itemPath),
    message: asText(item?.message) || null,
    evidence: item?.evidence ?? null,
    instruction: asText(item?.instruction) || null,
    allowed_resolution_modes: actionItemResolutionModes(item),
    action_kind: asText(item?.action_kind) || "ai_authoring",
    required_owner: asText(item?.required_owner) || "foundry_ai_authoring",
    ai_required: item?.ai_required !== false,
    common_other_deferral_allowed: actionItemAllowsCommonOtherDeferral(item),
    deferral_cleanup_path: asText(item?.deferral_cleanup_path) || null,
    deferral_trace_path: asText(item?.deferral_trace_path) || null,
  };
}

export function markdownList(values, fallback = "- none") {
  const rows = ensureArray(values).filter(
    (value) => value !== undefined && value !== null && value !== "",
  );
  if (rows.length === 0) return fallback;
  return rows.map((value) => `- ${String(value)}`).join("\n");
}

export function relOrNull(repoRoot, filePath) {
  return filePath ? repoRelativePath(repoRoot, filePath) : null;
}

export function packageContextFileSummary(contextFiles) {
  return ensureArray(contextFiles).map((file) => ({
    kind: asText(file?.kind) || "context",
    path: asText(file?.path) || null,
    sha256: sha256Text(file?.text ?? ""),
    bytes: Buffer.byteLength(String(file?.text ?? ""), "utf8"),
  }));
}

export const decisionOnlyActionKinds = new Set([
  "identity_decision_authoring",
  "classification_decision_authoring",
  "location_decision_authoring",
]);

export function isPatchAuthoringActionItem(item) {
  if (!item || item.ai_required === false) return false;
  return !decisionOnlyActionKinds.has(asText(item.action_kind));
}

export function patchAuthoringActionItems(packagePayload) {
  return ensureArray(packagePayload.action_items)
    .filter(isPatchAuthoringActionItem)
    .map(compactActionItemForAuthoring);
}

export function decisionOnlyActionItems(packagePayload) {
  return ensureArray(packagePayload.action_items)
    .filter((item) => item?.ai_required !== false && !isPatchAuthoringActionItem(item))
    .map(compactActionItemForAuthoring);
}

export function buildPatchTemplate(packagePayload, packagePath) {
  const actionItems = patchAuthoringActionItems(packagePayload);
  const packageRef = path.basename(packagePath);
  const requiredContextKinds = ensureArray(
    packagePayload.full_context_ai_completion?.required_context_kinds ??
      packagePayload.full_context_ai_completion?.requiredContextKinds,
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
      `Do not defer annualSupplyOrProductionVolume to common:other. When source annual volume evidence is missing, Foundry deterministic cleanup writes '${annualSupplyMissingDataSentinelText}' so the required schema field remains present and later database-side curation can bulk-locate it.`,
      "For source_trace_verified, add tiangongfoundry:sourceExchangeCompleteness under common:other with accepted status and structured source trace evidence. Evidence must include source plus quote_or_trace/source_path/field_path/citation.",
    ],
    patch_sets: [
      {
        dataset_id:
          packagePayload.entity_id ?? packagePayload.process_id ?? null,
        version: packagePayload.version ?? "00.00.001",
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

export function fullContextAiConfigRequiresAuthoring(value) {
  return value?.required === true || value?.required === "true";
}

export function requiredFullContextKinds(value) {
  const kinds = ensureArray(
    value?.required_context_kinds ?? value?.requiredContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
  return kinds.length > 0
    ? kinds
    : [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ];
}

export function requiredFullContextFilePatterns(value) {
  return ensureArray(
    value?.required_context_file_patterns ??
      value?.requiredContextFilePatterns,
  )
    .map((pattern) => asText(pattern))
    .filter(Boolean);
}

export function contextSummaryHasNonEmptyPayload(file) {
  if (Number(file?.bytes ?? 0) > 0) return true;
  return Buffer.byteLength(String(file?.text ?? ""), "utf8") > 0;
}

export function contextSummaryHasKind(files, kind) {
  return ensureArray(files).some(
    (file) => asText(file?.kind) === kind && contextSummaryHasNonEmptyPayload(file),
  );
}

export function contextSummaryHasPattern(files, pattern) {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some(
    (file) =>
      String(file?.path ?? "").toLowerCase().includes(needle) &&
      contextSummaryHasNonEmptyPayload(file),
  );
}

export function stableSharedContextBundleSha256(bundle) {
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
  } = bundle;
  return sha256Text(JSON.stringify(stablePayload));
}

export function sharedContextBundleReadinessBlockers({
  repoRoot,
  sharedContextBundle,
  sourceKind,
  sourcePath = null,
}) {
  const sharedPath = asText(sharedContextBundle?.path);
  if (!sharedPath) return [];
  const expectedSha256 = asText(sharedContextBundle?.sha256);
  const prefix =
    sourceKind === "manifest"
      ? "authoring_manifest_shared_context_bundle"
      : "authoring_task_shared_context_bundle";
  const sourceField =
    sourceKind === "manifest" ? "task_manifest" : "authoring_task";
  const sourceValue = sourcePath
    ? repoRelativeArtifactPath(repoRoot, sourcePath)
    : null;
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
    const bundle = readJson(bundlePath);
    const actualSha256 = asText(bundle?.sha256);
    const computedSha256 = stableSharedContextBundleSha256(bundle);
    const blockers = [];
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
        message:
          "Shared full-context bundle content no longer matches its recorded stable sha256.",
        expected_sha256: actualSha256,
        actual_sha256: computedSha256,
      });
    }
    if (!Array.isArray(bundle?.files)) {
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
