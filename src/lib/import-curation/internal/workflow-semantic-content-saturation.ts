import { dataSetInformation, datasetRoot } from "./dataset-payload.ts";
import { asText, ensureArray } from "./runtime-io.ts";
import { collectCommonOtherTraceEntries } from "./trace-summary.ts";
import { type ProfileLike } from "./workflow-context-types.ts";
import {
  hasNonEmptyTraceEvidence,
  hasStructuredTraceEvidence,
} from "./workflow-evidence-primitives.ts";
import {
  firstTraceAttribute,
  flowNameLocationEvidence,
  hasMeaningfulFieldValue,
  isPlaceholderishText,
  multiLangSuggestion,
  nameTextForPayload,
  semanticActionItem,
  sourceTraceEvidence,
  sourceTraceLanguage,
  sourceTraceLocationEvidence,
  sourceTracePayloads,
  textValue,
  traceAttributeMap,
  traceObjectsNamed,
  type JsonRecord,
  type SemanticAction,
  type SemanticActionOptions,
} from "./workflow-semantic-text-rules.ts";

interface ProfileOptions {
  profile?: ProfileLike | null;
}

export interface ClassificationOptions extends ProfileOptions {
  hasClassificationQueueContext?: boolean;
}

interface ContentSaturationOptions extends SemanticActionOptions {
  datasetType: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function flowTypeForPayload(payload: unknown): string {
  const root = datasetRoot(payload, "flow");
  return asText(
    root?.modellingAndValidation?.LCIMethod?.typeOfDataSet ??
      root?.modellingAndValidation?.LCIMethodAndAllocation?.typeOfDataSet,
  );
}

export function flowUsesElementaryClassification(payload: unknown): boolean {
  return /^elementary flow$/iu.test(flowTypeForPayload(payload));
}

export function flowUsesProductClassification(payload: unknown): boolean {
  const type = flowTypeForPayload(payload);
  return /^product flow$/iu.test(type) || /^waste flow$/iu.test(type);
}

export function classificationActionPathForPayload(payload: unknown, datasetType: string): string {
  if (datasetType === "flow") {
    return flowUsesElementaryClassification(payload)
      ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:elementaryFlowCategorization"
      : "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification";
  }
  return "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification";
}

export function classificationEntriesForPayload(
  payload: unknown,
  datasetType: string,
): Array<{ index: number; level: string; class_id: string; text: string }> {
  const root = datasetRoot(payload, datasetType);
  const info = dataSetInformation(root, datasetType);
  if (datasetType === "flow") {
    const classificationInformation = info?.classificationInformation ?? {};
    const categories =
      classificationInformation?.["common:elementaryFlowCategorization"]?.["common:category"] ??
      classificationInformation?.elementaryFlowCategorization?.category ??
      [];
    const classes =
      classificationInformation?.["common:classification"]?.["common:class"] ??
      classificationInformation?.classification?.class ??
      [];
    const items = flowUsesElementaryClassification(payload) ? categories : classes;
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
    info?.classificationInformation?.["common:classification"]?.["common:class"] ??
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

export function classificationPathForPayload(payload: unknown, datasetType: string): string {
  return classificationEntriesForPayload(payload, datasetType)
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
}

export function processExchangeList(payload: unknown): JsonRecord[] {
  const root = datasetRoot(payload, "process");
  return ensureArray(root?.exchanges?.exchange).filter(isRecord);
}

export function hasFoundryOtherEvidence(
  value: unknown,
  evidenceKey: string,
  acceptedStatuses: string[] = [],
): boolean {
  let found = false;
  const accepted = new Set(acceptedStatuses.map((status) => String(status).toLowerCase()));
  const visit = (node: unknown): void => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as JsonRecord;
    const other = record["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      const evidence = (other as JsonRecord)[evidenceKey];
      if (evidence !== undefined) {
        if (accepted.size === 0) {
          found = true;
          return;
        }
        for (const item of ensureArray(evidence)) {
          const typedItem = asRecord(item);
          const status = asText(
            typedItem.status ?? typedItem.decision_status ?? typedItem.decisionStatus,
          );
          if (status && accepted.has(status.toLowerCase())) {
            found = true;
            return;
          }
        }
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return found;
}

export function isBafuConvertedDefaultProcessClassification(classificationPath: string): boolean {
  return /Other service activities\s*>\s*Activities of membership organizations\s*>\s*Activities of other membership organizations\s*>\s*Activities of other membership organizations n\.e\.c\.|Community,\s*social and personal services\s*>\s*Sewage and waste collection,\s*treatment and disposal and other environmental protection services\s*>\s*Other environmental protection services n\.e\.c\./iu.test(
    classificationPath,
  );
}

export function collectClassificationSemanticActions(
  payload: unknown,
  datasetType: string,
  { profile = null, hasClassificationQueueContext = false }: ClassificationOptions = {},
): SemanticAction[] {
  if (!["flow", "process"].includes(datasetType)) return [];
  const classes = classificationEntriesForPayload(payload, datasetType);
  const classificationPath = classificationPathForPayload(payload, datasetType);
  const nameText = nameTextForPayload(payload, datasetType);
  const actions: SemanticAction[] = [];
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
    /\b(hydrometallurgical|Li-ion|battery|batteries|Li salt|lithium|processing)\b/iu.test(nameText);
  const sourceLooksWasteTreatment =
    /\b(disposal|waste treatment|treatment of|treatment,? (?:of )?.*batteries)\b/iu.test(nameText);
  const classificationLooksService =
    /membership organizations|community, social and personal services|environmental protection services|other service activities/iu.test(
      classificationPath,
    );
  const classificationLooksWasteTreatment =
    /waste (?:collection,\s*)?treatment and disposal|waste treatment|hazardous waste treatment|waste treatment services/iu.test(
      classificationPath,
    );
  if (
    !hasClassificationQueueContext &&
    (datasetType === "process" ||
      (datasetType === "flow" && flowUsesProductClassification(payload))) &&
    asText(profile?.id).toLowerCase() === "bafu" &&
    isBafuConvertedDefaultProcessClassification(classificationPath)
  ) {
    actions.push(
      semanticActionItem({
        code: "semantic_classification_converted_default",
        path: classificationActionPathForPayload(payload, datasetType),
        message: `BAFU ${datasetType} classification still has the converter default service path and must be replaced with a target TIDAS classification.`,
        evidence: {
          name_text: nameText,
          classification_path: classificationPath,
        },
        instruction: `Use the BAFU source context, classification queue/candidates when available, and the full schema/YAML/context package to choose the target TianGong/TIDAS ${datasetType} classification.`,
      }),
    );
  }
  if (
    sourceLooksIndustrial &&
    classificationLooksService &&
    !(sourceLooksWasteTreatment && classificationLooksWasteTreatment)
  ) {
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

export function effectiveContentDatasetType(payload: unknown, datasetType: string): string {
  const record = asRecord(payload);
  if (record.processDataSet) return "process";
  if (record.flowDataSet) return "flow";
  if (record.sourceDataSet) return "source";
  if (record.contactDataSet) return "contact";
  return datasetType;
}

export function contentSaturationAction({
  datasetType,
  code,
  path: itemPath,
  message,
  evidence,
  instruction,
  common_other_deferral_allowed = false,
}: ContentSaturationOptions): SemanticAction {
  return {
    ...semanticActionItem({
      code,
      path: itemPath,
      message,
      evidence,
      instruction,
      common_other_deferral_allowed,
    }),
    dataset_type: datasetType,
    saturation_gate: true,
  };
}

export function collectProcessContentSaturationActions(payload: unknown): SemanticAction[] {
  const root = datasetRoot(payload, "process");
  const info = root?.processInformation?.dataSetInformation ?? {};
  const representativeness =
    root?.modellingAndValidation?.dataSourcesTreatmentAndRepresentativeness ?? {};
  const traces = sourceTracePayloads(payload);
  if (traces.length === 0) return [];

  const actions: SemanticAction[] = [];
  const localName = firstTraceAttribute(traces, "referenceFunction", "localName");
  if (localName && !hasMeaningfulFieldValue(info["common:synonyms"])) {
    const language = sourceTraceLanguage(traces, "de");
    actions.push(
      contentSaturationAction({
        datasetType: "process",
        code: "semantic_content_saturation_process_synonyms_missing",
        path: "processDataSet.processInformation.dataSetInformation.common:synonyms",
        message:
          "Source trace contains a local/alternative process name, but process synonyms are empty.",
        evidence: sourceTraceEvidence(localName, {
          suggested_value: multiLangSuggestion(localName.value, language),
        }),
        instruction:
          "Use source trace and TIDAS process schema semantics to add the source-local process name as common:synonyms. Preserve the source language; do not invent translations.",
      }),
    );
  }

  const percent = firstTraceAttribute(traces, "representativeness", "percent");
  if (percent && !hasMeaningfulFieldValue(representativeness.percentageSupplyOrProductionCovered)) {
    actions.push(
      contentSaturationAction({
        datasetType: "process",
        code: "semantic_content_saturation_process_percentage_missing",
        path: "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.percentageSupplyOrProductionCovered",
        message:
          "Source trace contains representativeness.percent, but percentageSupplyOrProductionCovered is empty.",
        evidence: sourceTraceEvidence(percent, { suggested_value: percent.value }),
        instruction:
          "Fill percentageSupplyOrProductionCovered from representativeness.percent when the value is physically meaningful for the represented market/location.",
      }),
    );
  }

  const uncertaintyAdjustments = firstTraceAttribute(
    traces,
    "representativeness",
    "uncertaintyAdjustments",
    { allowNone: true },
  );
  if (
    uncertaintyAdjustments &&
    !hasMeaningfulFieldValue(representativeness.uncertaintyAdjustments)
  ) {
    actions.push(
      contentSaturationAction({
        datasetType: "process",
        code: "semantic_content_saturation_process_uncertainty_adjustments_missing",
        path: "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.uncertaintyAdjustments",
        message:
          "Source trace contains uncertainty adjustment information, but uncertaintyAdjustments is empty.",
        evidence: sourceTraceEvidence(uncertaintyAdjustments, {
          suggested_value: multiLangSuggestion(uncertaintyAdjustments.value, "en"),
        }),
        instruction:
          "Fill uncertaintyAdjustments from source trace when the source explicitly states a value such as none; preserve source wording.",
      }),
    );
  }
  return actions;
}

export function flowReferencePropertyNames(root: JsonRecord): string[] {
  const flowProperties = asRecord(root.flowProperties);
  return ensureArray(flowProperties.flowProperty)
    .map((property) => {
      const reference = asRecord(asRecord(property).referenceToFlowPropertyDataSet);
      return textValue(reference["common:shortDescription"] ?? reference.shortDescription);
    })
    .filter(Boolean);
}

export function collectFlowContentSaturationActions(payload: unknown): SemanticAction[] {
  const root = datasetRoot(payload, "flow");
  const info = root?.flowInformation?.dataSetInformation ?? {};
  const traces = sourceTracePayloads(payload);
  const actions: SemanticAction[] = [];
  const locationEvidence = sourceTraceLocationEvidence(traces) ?? flowNameLocationEvidence(root);
  if (
    locationEvidence &&
    !hasMeaningfulFieldValue(root?.flowInformation?.geography?.locationOfSupply)
  ) {
    actions.push(
      contentSaturationAction({
        datasetType: "flow",
        code: "semantic_content_saturation_flow_location_of_supply_missing",
        path: "flowDataSet.flowInformation.geography.locationOfSupply",
        message:
          "Flow context contains a location-of-supply candidate, but flow locationOfSupply is empty.",
        evidence: locationEvidence,
        instruction:
          "Fill locationOfSupply with the source-backed TIDAS/ILCD location code when the candidate is valid. If the candidate is not a valid code or conflicts with process/exchange geography, keep the scope blocked for location authoring.",
      }),
    );
  }

  const propertyNames = flowReferencePropertyNames(root);
  if (propertyNames.length > 0 && !hasMeaningfulFieldValue(info.name?.flowProperties)) {
    actions.push(
      contentSaturationAction({
        datasetType: "flow",
        code: "semantic_content_saturation_flow_quantitative_properties_missing",
        path: "flowDataSet.flowInformation.dataSetInformation.name.flowProperties",
        message:
          "Flow reference property evidence exists, but the name.flowProperties descriptor is empty.",
        evidence: {
          source: "flowDataSet.flowProperties.flowProperty.referenceToFlowPropertyDataSet",
          reference_flow_properties: propertyNames,
          suggested_value: multiLangSuggestion(propertyNames.join(", "), "en"),
        },
        instruction:
          "Fill the TIDAS flow name.flowProperties descriptor from the referenced quantitative flow property names when the values are not redundant with the base name.",
      }),
    );
  }

  const generalComment = firstTraceAttribute(traces, "exchange", "generalComment", {
    allowNone: true,
  });
  if (generalComment && !hasMeaningfulFieldValue(info["common:generalComment"])) {
    actions.push(
      contentSaturationAction({
        datasetType: "flow",
        code: "semantic_content_saturation_flow_general_comment_missing",
        path: "flowDataSet.flowInformation.dataSetInformation.common:generalComment",
        message: "Source trace contains exchange.generalComment, but flow generalComment is empty.",
        evidence: sourceTraceEvidence(generalComment, {
          suggested_value: multiLangSuggestion(generalComment.value, "en"),
        }),
        instruction:
          "Promote source-backed exchange generalComment into the product/waste flow comment when it describes the flow meaning, assumptions, or geography; otherwise preserve a structured reason in patch evidence.",
      }),
    );
  }
  return actions;
}

export function collectSourceContentSaturationActions(payload: unknown): SemanticAction[] {
  const root = datasetRoot(payload, "source");
  const info = root?.sourceInformation?.dataSetInformation ?? {};
  const traces = sourceTracePayloads(payload);
  if (traces.length === 0) return [];
  const sourceObjects = traceObjectsNamed(traces, "source");
  if (sourceObjects.length === 0) return [];
  const description = textValue(info.sourceDescriptionOrComment);
  const requiredAttributes = [
    "firstAuthor",
    "additionalAuthors",
    "year",
    "title",
    "titleOfAnthology",
    "placeOfPublications",
    "publisher",
    "volumeNo",
  ];
  const missing: JsonRecord[] = [];
  for (const traceObject of sourceObjects) {
    const attributes = traceAttributeMap(traceObject.node);
    for (const attributeName of requiredAttributes) {
      const value = attributes.get(attributeName);
      if (!value || isPlaceholderishText(value)) continue;
      if (!description.toLowerCase().includes(value.toLowerCase())) {
        missing.push({
          object_name: asText(traceObject.node.name),
          attribute_name: attributeName,
          value,
          trace_path: traceObject.trace_path,
        });
      }
    }
  }
  if (missing.length === 0) return [];
  return [
    contentSaturationAction({
      datasetType: "source",
      code: "semantic_content_saturation_source_description_incomplete",
      path: "sourceDataSet.sourceInformation.dataSetInformation.sourceDescriptionOrComment",
      message:
        "Source trace contains bibliographic fields that are not represented in sourceDescriptionOrComment.",
      evidence: {
        source: "tidasimport:sourceTrace",
        missing_bibliographic_fields: missing,
        current_description: description || null,
      },
      instruction:
        "Expand sourceDescriptionOrComment from the trace-backed bibliographic fields in one evidence-backed patch. Preserve source wording and do not invent DOI/URL values that are absent from context.",
    }),
  ];
}

export function collectContactContentSaturationActions(
  payload: unknown,
  { profile = null }: ProfileOptions = {},
): SemanticAction[] {
  const root = datasetRoot(payload, "contact");
  const info = root?.contactInformation?.dataSetInformation ?? {};
  if (asText(profile?.id).toLowerCase() !== "bafu") return [];
  const name = textValue(info["common:name"] ?? info["common:shortName"]);
  if (!/\b(BAFU|FOEN|Federal Office for the Environment)\b/iu.test(name)) return [];
  const required = [
    ["WWWAddress", "contactDataSet.contactInformation.dataSetInformation.WWWAddress"],
    ["email", "contactDataSet.contactInformation.dataSetInformation.email"],
    ["telephone", "contactDataSet.contactInformation.dataSetInformation.telephone"],
    ["contactAddress", "contactDataSet.contactInformation.dataSetInformation.contactAddress"],
    [
      "centralContactPoint",
      "contactDataSet.contactInformation.dataSetInformation.centralContactPoint",
    ],
  ].filter(([field]) => !hasMeaningfulFieldValue(info[field]));
  if (required.length === 0) return [];
  return [
    contentSaturationAction({
      datasetType: "contact",
      code: "semantic_content_saturation_bafu_contact_incomplete",
      path: "contactDataSet.contactInformation.dataSetInformation",
      message:
        "BAFU/FOEN library contact is missing one or more official contact fields required by the BAFU import profile.",
      evidence: {
        contact_name: name,
        missing_fields: required.map(([field, itemPath]) => ({ field, path: itemPath })),
        profile_source: "docs/import-profiles/bafu/constraints.md",
      },
      instruction:
        "Fill the shared BAFU/FOEN contact fields from the profile-approved official contact evidence: website, email, telephone, postal address, and central contact point.",
    }),
  ];
}

export function collectContentSaturationSemanticActions(
  payload: unknown,
  datasetType: string,
  { profile = null }: ProfileOptions = {},
): SemanticAction[] {
  const effectiveDatasetType = effectiveContentDatasetType(payload, datasetType);
  if (effectiveDatasetType === "process") return collectProcessContentSaturationActions(payload);
  if (effectiveDatasetType === "flow") return collectFlowContentSaturationActions(payload);
  if (effectiveDatasetType === "source") return collectSourceContentSaturationActions(payload);
  if (effectiveDatasetType === "contact") {
    return collectContactContentSaturationActions(payload, { profile });
  }
  return [];
}

export function collectProcessExchangeSemanticActions(payload: unknown): SemanticAction[] {
  const exchanges = processExchangeList(payload);
  if (exchanges.length === 0) return [];
  const directions = exchanges.map((exchange) => asText(exchange.exchangeDirection));
  const hasInput = directions.some((direction) => /^input$/iu.test(direction));
  const hasOnlyOutput =
    directions.length > 0 && directions.every((direction) => /^output$/iu.test(direction));
  if (
    !hasInput &&
    hasOnlyOutput &&
    !hasFoundryOtherEvidence(payload, "tiangongfoundry:sourceExchangeCompleteness", [
      "source_only_output_exchange_verified",
      "accepted_source_only_output",
      "verified",
    ])
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

export function collectFoundryTraceSemanticActions(
  payload: unknown,
  datasetType: string,
): SemanticAction[] {
  const actions: SemanticAction[] = [];
  const add = (item: SemanticAction): number =>
    actions.push({ ...item, dataset_type: datasetType });
  for (const trace of collectCommonOtherTraceEntries(payload, "tiangongfoundry:unresolvedTrace")) {
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
    const typedEntry = entry as JsonRecord;
    const status = asText(
      typedEntry.status ?? typedEntry.decision_status ?? typedEntry.decisionStatus,
    );
    const actionCode = asText(
      typedEntry.action_item_code ?? typedEntry.actionItemCode ?? typedEntry.code,
    );
    const blockedPath = asText(
      typedEntry.blocked_path ??
        typedEntry.blockedPath ??
        typedEntry.field_path ??
        typedEntry.fieldPath ??
        typedEntry.path,
    );
    const reason = asText(
      typedEntry.reason ?? typedEntry.deferred_reason ?? typedEntry.deferredReason,
    );
    const nextAction = asText(
      typedEntry.next_action ??
        typedEntry.nextAction ??
        typedEntry.follow_up ??
        typedEntry.followUp,
    );
    const evidence = typedEntry.evidence ?? typedEntry.source_evidence ?? typedEntry.sourceEvidence;
    const invalidReasons: string[] = [];
    if (!["unresolved_deferred", "deferred_to_common_other", "needs_followup"].includes(status)) {
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
          evidence: { invalid_fields: invalidReasons, trace: typedEntry },
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
    const typedEntry = entry as JsonRecord;
    const status = asText(
      typedEntry.status ?? typedEntry.decision_status ?? typedEntry.decisionStatus,
    );
    const evidence =
      typedEntry.evidence ??
      typedEntry.source_evidence ??
      typedEntry.sourceEvidence ??
      typedEntry.trace;
    const invalidReasons: string[] = [];
    if (
      !["source_only_output_exchange_verified", "accepted_source_only_output", "verified"].includes(
        status,
      )
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
          evidence: { invalid_fields: invalidReasons, trace: typedEntry },
          instruction:
            "Rewrite source exchange completeness evidence with accepted status and source trace evidence.",
          common_other_deferral_allowed: true,
        }),
      );
    }
  }
  return actions;
}

export function collectFlowReuseSemanticActions(
  payload: unknown,
  datasetType: string,
): SemanticAction[] {
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
