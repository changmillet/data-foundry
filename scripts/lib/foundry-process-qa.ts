// Deterministic Process QA retained from TianGong LCA CLI 0.1.28 (MIT).
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import {
  assessProcessMassBalance,
  type MassReferenceEvidence,
} from "./foundry-process-mass-balance.ts";

const methodologyRules: Record<string, string> = {
  process_missing_source_base_name: "tidas.process.name.base-name.align-reference-flow",
  process_missing_functional_unit: "tidas.process.quantitative-reference.required",
  process_missing_quantitative_reference: "tidas.process.quantitative-reference.required",
  process_missing_exchange_amount: "tidas.process.exchange.amount.required",
  process_material_balance_deviation: "tidas.process.exchange.amount.required",
  process_missing_system_boundary: "tidas.process.evidence.field-bindings.required",
  process_missing_time: "tidas.process.evidence.field-bindings.required",
  process_missing_geography: "tidas.process.evidence.field-bindings.required",
  process_missing_technology: "tidas.process.evidence.field-bindings.required",
  process_missing_admin_metadata: "tidas.process.evidence.field-bindings.required",
  process_exchange_unit_semantic_mismatch: "tidas.process.exchange.amount.required",
};

type JsonRecord = Record<string, unknown>;

const KIND_RE = /\[tg_io_kind_tag=([^\]]+)\]/gu;
const UOM_RE = /\[tg_io_uom_tag=([^\]]+)\]/giu;

const ENERGY_WORDS = [
  "electric",
  "electricity",
  "kwh",
  "mj",
  "heat",
  "steam",
  "fuel",
  "diesel",
  "gas",
  "power",
  "电",
  "能",
] as const;

const RAW_WORDS = [
  "raw material",
  "feedstock",
  "fertilizer",
  "water",
  "seed",
  "pesticide",
  "原材料",
  "投入",
  "肥料",
  "种子",
  "农药",
  "用水",
] as const;

const BYP_WORDS = ["by-product", "co-product", "副产品", "联产"] as const;
const WASTE_WORDS = ["waste", "废", "residue", "sludge"] as const;

type BaseInfoCheck = {
  source_name_ok: boolean;
  functional_unit_ok: boolean;
  system_boundary_ok: boolean;
  time_ok: boolean;
  geo_ok: boolean;
  tech_ok: boolean;
  admin_ok: boolean;
  completeness_score: number;
  base_names: string[];
};

type ClassifiedExchange = {
  classification:
    | "raw_material_input"
    | "energy_input"
    | "other_input"
    | "product_output"
    | "byproduct_output"
    | "waste_output"
    | "other_output"
    | "other";
  kinds: string[];
  uoms: string[];
  blob: string;
  source_input_group: string | null;
  source_output_group: string | null;
  reference_flow: boolean;
};

type UnitIssue = {
  flow_uuid: string;
  current_unit: string;
  suggested_unit: string;
  basis: string;
  confidence: string;
};

type ProcessQaFinding = {
  process_file: string;
  severity: "info" | "warning" | "blocker";
  code: string;
  methodology_rule_id: string | null;
  message: string;
  source: "rule";
  evidence?: JsonRecord;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function textFromValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter(isRecord)
      .map((item) => String(item["#text"] ?? ""))
      .join(" ");
  }

  if (isRecord(value)) {
    return String(value["#text"] ?? "");
  }

  return String(value ?? "");
}

function deepGet(value: unknown, pathParts: string[]): unknown {
  let current: unknown = value;

  for (const key of pathParts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
    if (current === undefined || current === null) {
      return undefined;
    }
  }

  return current;
}

function hasNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasNonEmpty(item));
  }

  if (isRecord(value)) {
    if ("#text" in value) {
      return hasNonEmpty(value["#text"]);
    }
    return Object.values(value).some((item) => hasNonEmpty(item));
  }

  return true;
}

function extractBaseNames(processPayload: JsonRecord): [boolean, string[]] {
  const base = deepGet(processPayload, [
    "processDataSet",
    "processInformation",
    "dataSetInformation",
    "name",
    "baseName",
  ]);
  const items = Array.isArray(base) ? base : base ? [base] : [];
  const values: string[] = [];

  items.forEach((item) => {
    if (!isRecord(item)) {
      return;
    }
    const text = String(item["#text"] ?? "").trim();
    if (!text) {
      return;
    }
    values.push(text);
  });

  return [values.length > 0, values];
}

function sourceTracePayload(exchange: JsonRecord): JsonRecord | null {
  const payload = deepGet(exchange, ["common:other", "tidasimport:sourceTrace", "payload"]);
  if (!isRecord(payload)) {
    return null;
  }
  return isRecord(payload.sourceTrace) ? payload.sourceTrace : payload;
}

function sourceClassification(exchange: JsonRecord): JsonRecord {
  const payload = sourceTracePayload(exchange);
  return payload && isRecord(payload.sourceClassification) ? payload.sourceClassification : {};
}

function sourceGroup(exchange: JsonRecord, groupName: "inputGroup" | "outputGroup"): string | null {
  const value = sourceClassification(exchange)[groupName];
  const text = String(value ?? "").trim();
  return text || null;
}

function classifyExchange(
  exchange: JsonRecord,
  referenceFlowId: string | null = null,
): ClassifiedExchange {
  const comments = `${textFromValue(exchange.commonComment)} ${textFromValue(exchange.generalComment)}`;
  const flowDescription = textFromValue(
    isRecord(exchange.referenceToFlowDataSet)
      ? exchange.referenceToFlowDataSet["common:shortDescription"]
      : undefined,
  );
  const rawBlob = `${comments} ${flowDescription}`.trim();
  const blob = rawBlob.toLowerCase();
  const kinds = Array.from(blob.matchAll(KIND_RE), (match) => match[1].toLowerCase());
  const kindSet = new Set(kinds);
  const uoms = Array.from(rawBlob.matchAll(UOM_RE), (match) => match[1]);
  const direction = String(exchange.exchangeDirection ?? "").toLowerCase();
  const inputGroup = sourceGroup(exchange, "inputGroup");
  const outputGroup = sourceGroup(exchange, "outputGroup");
  const internalId = String(exchange["@dataSetInternalID"] ?? "").trim();
  const isReferenceFlow = Boolean(referenceFlowId && internalId === referenceFlowId);
  const meta = {
    kinds,
    uoms,
    blob,
    source_input_group: inputGroup,
    source_output_group: outputGroup,
    reference_flow: isReferenceFlow,
  };
  const isEnergy =
    ENERGY_WORDS.some((word) => blob.includes(word)) ||
    uoms.some((uom) => uom === "kwh" || uom === "mj" || uom === "gj");

  if (direction === "input") {
    if (kindSet.has("energy") || isEnergy) {
      return { classification: "energy_input", ...meta };
    }
    if (kindSet.has("waste")) {
      return { classification: "other_input", ...meta };
    }
    if (inputGroup === "4" || kindSet.has("raw_material") || kindSet.has("resource")) {
      return { classification: "raw_material_input", ...meta };
    }
    if (kindSet.has("product") || RAW_WORDS.some((word) => blob.includes(word))) {
      return { classification: "raw_material_input", ...meta };
    }
    return { classification: "other_input", ...meta };
  }

  if (direction === "output") {
    if (isReferenceFlow || outputGroup === "0") {
      return { classification: "product_output", ...meta };
    }
    if (
      kindSet.has("waste") ||
      outputGroup === "4" ||
      outputGroup === "5" ||
      WASTE_WORDS.some((word) => blob.includes(word))
    ) {
      return { classification: "waste_output", ...meta };
    }
    if (BYP_WORDS.some((word) => blob.includes(word))) {
      return { classification: "byproduct_output", ...meta };
    }
    if (kindSet.has("product")) {
      return { classification: "product_output", ...meta };
    }
    return { classification: "other_output", ...meta };
  }

  return { classification: "other", ...meta };
}

function unitIssueCheck(exchange: JsonRecord, uoms: string[], blob: string): UnitIssue[] {
  const flowUuid = isRecord(exchange.referenceToFlowDataSet)
    ? String(exchange.referenceToFlowDataSet["@refObjectId"] ?? "")
    : "";

  if (!flowUuid) {
    return [];
  }

  const currentUnit = (uoms[0] ?? "").toLowerCase();
  if (
    ["electric", "electricity", "交流电", "电力"].some((word) => blob.includes(word)) &&
    currentUnit &&
    !["kwh", "mj", "gj"].includes(currentUnit)
  ) {
    return [
      {
        flow_uuid: flowUuid,
        current_unit: currentUnit,
        suggested_unit: "kWh",
        basis: "flow 描述为电力/电能，但 uom 标签非能量单位",
        confidence: "高",
      },
    ];
  }

  if (
    ["water", "用水", "工艺用水"].some((word) => blob.includes(word)) &&
    currentUnit &&
    ["kwh", "mj", "gj"].includes(currentUnit)
  ) {
    return [
      {
        flow_uuid: flowUuid,
        current_unit: currentUnit,
        suggested_unit: "m3 或 kg",
        basis: "flow 描述为水，但 uom 标签为能量单位",
        confidence: "高",
      },
    ];
  }

  if (
    ["co2", "carbon dioxide", "二氧化碳"].some((word) => blob.includes(word)) &&
    currentUnit &&
    ["kwh", "mj", "gj"].includes(currentUnit)
  ) {
    return [
      {
        flow_uuid: flowUuid,
        current_unit: currentUnit,
        suggested_unit: "kg",
        basis: "排放流通常质量单位计，当前为能量单位",
        confidence: "中",
      },
    ];
  }

  return [];
}

function hasNumericAmount(exchange: JsonRecord): boolean {
  for (const key of ["meanAmount", "resultingAmount"]) {
    const value = exchange[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return true;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return true;
    }
  }
  return false;
}

function createProcessQaFinding(options: {
  processFile: string;
  severity: ProcessQaFinding["severity"];
  code: string;
  message: string;
  evidence?: JsonRecord;
}): ProcessQaFinding {
  const methodologyRuleId = methodologyRules[options.code] ?? null;
  return {
    process_file: options.processFile,
    severity: options.severity,
    code: options.code,
    methodology_rule_id: methodologyRuleId,
    message: options.message,
    source: "rule",
    ...(options.evidence ? { evidence: options.evidence } : {}),
  };
}

function reviewFindingsForBase(processFile: string, base: BaseInfoCheck): ProcessQaFinding[] {
  const findings: ProcessQaFinding[] = [];
  if (!base.source_name_ok) {
    findings.push(
      createProcessQaFinding({
        processFile,
        severity: "warning",
        code: "process_missing_source_base_name",
        message:
          "Process baseName should include a usable source-language entry before Foundry authoring is complete.",
        evidence: { base_names: base.base_names },
      }),
    );
  }
  if (!base.functional_unit_ok) {
    findings.push(
      createProcessQaFinding({
        processFile,
        severity: "warning",
        code: "process_missing_functional_unit",
        message:
          "Process quantitative reference functionalUnitOrOther is missing and should be curated by Foundry.",
      }),
    );
  }
  for (const [ok, code, message] of [
    [
      base.system_boundary_ok,
      "process_missing_system_boundary",
      "Process system boundary or typeOfDataSet context is missing.",
    ],
    [base.time_ok, "process_missing_time", "Process time coverage is missing."],
    [base.geo_ok, "process_missing_geography", "Process geography is missing."],
    [base.tech_ok, "process_missing_technology", "Process technology description is missing."],
    [
      base.admin_ok,
      "process_missing_admin_metadata",
      "Process administrative metadata is missing.",
    ],
  ] as const) {
    if (!ok) {
      findings.push(
        createProcessQaFinding({
          processFile,
          severity: "warning",
          code,
          message,
        }),
      );
    }
  }
  return findings;
}

function baseInfoCheck(processPayload: JsonRecord): BaseInfoCheck {
  const [sourceNameOk, values] = extractBaseNames(processPayload);
  const functionalUnit = deepGet(processPayload, [
    "processDataSet",
    "processInformation",
    "quantitativeReference",
    "functionalUnitOrOther",
  ]);
  const mixAndLocation = deepGet(processPayload, [
    "processDataSet",
    "processInformation",
    "geography",
    "mixAndLocationTypes",
  ]);
  const route = deepGet(processPayload, [
    "processDataSet",
    "modellingAndValidation",
    "LCIMethodAndAllocation",
    "typeOfDataSet",
  ]);
  const time = deepGet(processPayload, ["processDataSet", "processInformation", "time"]);
  const geography = deepGet(processPayload, ["processDataSet", "processInformation", "geography"]);
  const technology = deepGet(processPayload, ["processDataSet", "modellingAndValidation"]);
  const administrativeInformation = deepGet(processPayload, [
    "processDataSet",
    "administrativeInformation",
  ]);

  const functionalUnitOk = hasNonEmpty(functionalUnit);
  const systemBoundaryOk = hasNonEmpty(mixAndLocation) || hasNonEmpty(route);
  const timeOk = hasNonEmpty(time);
  const geographyOk = hasNonEmpty(geography);
  const technologyOk = hasNonEmpty(technology);
  const administrativeOk = hasNonEmpty(administrativeInformation);
  const completenessScore = [
    sourceNameOk,
    functionalUnitOk,
    systemBoundaryOk,
    timeOk,
    geographyOk,
    technologyOk,
    administrativeOk,
  ].filter(Boolean).length;

  return {
    source_name_ok: sourceNameOk,
    functional_unit_ok: functionalUnitOk,
    system_boundary_ok: systemBoundaryOk,
    time_ok: timeOk,
    geo_ok: geographyOk,
    tech_ok: technologyOk,
    admin_ok: administrativeOk,
    completeness_score: completenessScore,
    base_names: values,
  };
}

export function foundryProcessQa(rows: readonly unknown[], references: MassReferenceEvidence) {
  const findings: ProcessQaFinding[] = [];
  const massBalance = rows.map((row, index) => {
    const { id, version, payload } = datasetIdentity(row, index, "process");
    if (!isRecord(payload))
      throw new FoundryContextError(
        "workflow_qa_failed",
        "Process QA requires a complete dataset.",
      );
    const rawExchanges = deepGet(payload, ["processDataSet", "exchanges", "exchange"]);
    const exchanges = (Array.isArray(rawExchanges) ? rawExchanges : [rawExchanges]).filter(
      isRecord,
    );
    const referenceFlowId =
      String(
        deepGet(payload, [
          "processDataSet",
          "processInformation",
          "quantitativeReference",
          "referenceToReferenceFlow",
        ]) ?? "",
      ).trim() || null;
    const processFile = `${id}__${version}.json`;
    const base = baseInfoCheck(payload);
    findings.push(...reviewFindingsForBase(processFile, base));
    const addFinding = (code: string, message: string, evidence: JsonRecord) =>
      findings.push(
        createProcessQaFinding({ processFile, severity: "warning", code, message, evidence }),
      );
    for (const exchange of exchanges) {
      const classified = classifyExchange(exchange, referenceFlowId);
      if (!hasNumericAmount(exchange))
        addFinding(
          "process_missing_exchange_amount",
          "Process exchange is missing both numeric meanAmount and resultingAmount and should be curated by Foundry.",
          {
            exchange_internal_id: String(exchange["@dataSetInternalID"] ?? ""),
            direction: String(exchange.exchangeDirection ?? ""),
          },
        );
      for (const issue of unitIssueCheck(exchange, classified.uoms, classified.blob))
        addFinding(
          "process_exchange_unit_semantic_mismatch",
          "Exchange unit tag conflicts with flow description semantics.",
          issue,
        );
    }
    const mass = assessProcessMassBalance({
      processFile,
      processPayload: payload,
      exchanges,
      referenceFlowId,
      references,
      classify: (exchange) => classifyExchange(exchange, referenceFlowId),
    });
    for (const finding of mass.findings)
      addFinding(finding.code, finding.message, { ...finding, unit: "kg" });
    if (
      (mass.relative_deviation !== null && mass.relative_deviation > 0.05) ||
      (mass.input_mass_kg === 0 && (mass.output_mass_kg ?? 0) > 0)
    )
      addFinding(
        "process_material_balance_deviation",
        "Comparable mass inputs and outputs require review: positive output has zero input, or the relative kg deviation exceeds the QA threshold.",
        {
          raw_input: mass.raw_input,
          product: mass.product,
          byproduct: mass.byproduct,
          waste: mass.waste,
          relative_deviation: mass.relative_deviation,
          policy_decision_owner: "foundry",
        },
      );
    return mass;
  });
  return {
    status: "completed_local_process_qa",
    policy_decision_owner: "foundry",
    qa_mode: "deterministic_qa_report",
    mass_balance: massBalance,
    findings,
  };
}
