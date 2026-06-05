import fs from "node:fs";
import path from "node:path";
import { identityKey, sha256Text } from "./part-06.mjs";

export const supportedDatasetTypes = new Set([
  "contact",
  "flow",
  "flowproperty",
  "lifecyclemodel",
  "process",
  "source",
  "support",
  "unitgroup",
]);

export const supportDatasetTypes = new Set([
  "contact",
  "source",
]);

export const referenceOnlySupportDatasetTypes = new Set(["unitgroup", "flowproperty"]);

export const datasetTypePlural = {
  contact: "contacts",
  process: "processes",
  flow: "flows",
  flowproperty: "flowproperties",
  lifecyclemodel: "lifecyclemodels",
  source: "sources",
  support: "support",
  unitgroup: "unitgroups",
};

export const defaultProfilesFile = "specs/import-profiles.json";

export const fallbackProfiles = {
  schema_version: 1,
  default_profile: "generic",
  profiles: {
    generic: {
      id: "generic",
      description: "Default profile with no dataset-specific waivers.",
      docs: [],
      waived_qa_codes_by_type: {},
      waiver_reasons: {},
    },
  },
};

export function nowIso() {
  return new Date().toISOString();
}

export function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

export function readJsonIfExists(filePath) {
  return fileExists(filePath) ? readJson(filePath) : null;
}

export function writeJson(filePath, data) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function fileExists(filePath) {
  return Boolean(
    filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
  );
}

export function directoryExists(filePath) {
  return Boolean(
    filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory(),
  );
}

export function resolveRepoPath(repoRoot, filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

export function repoRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath);
}

export function readJsonOrJsonl(filePath) {
  const text = readText(filePath).trim();
  if (!text) return [];
  if (filePath.endsWith(".jsonl")) {
    return text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return readJson(filePath);
}

export function readRows(filePath) {
  const parsed = readJsonOrJsonl(filePath);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.processes)) return parsed.processes;
  if (Array.isArray(parsed?.flows)) return parsed.flows;
  if (Array.isArray(parsed?.lifecyclemodels)) return parsed.lifecyclemodels;
  return [parsed];
}

export function optionList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => optionList(item));
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function jsonLines(rows) {
  return (
    rows.map((row) => JSON.stringify(row)).join("\n") +
    (rows.length ? "\n" : "")
  );
}

export function unique(values) {
  return [...new Set(ensureArray(values).filter(Boolean))];
}

export function sanitizeFileName(value) {
  return (
    String(value ?? "missing")
      .replace(/[^A-Za-z0-9._-]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "missing"
  );
}

export function asText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

export function unwrapDatasetPayload(row, datasetType) {
  if (row && typeof row === "object" && !Array.isArray(row)) {
    const typedKey =
      datasetType === "lifecyclemodel" ? "lifecyclemodel" : datasetType;
    for (const key of [
      typedKey,
      "json_ordered",
      "jsonOrdered",
      "json",
      "payload",
    ]) {
      if (
        row[key] &&
        typeof row[key] === "object" &&
        !Array.isArray(row[key])
      ) {
        return row[key];
      }
    }
  }
  return row;
}

export function datasetRoot(payload, datasetType) {
  const effectiveDatasetType =
    datasetType === "support"
      ? detectSupportDatasetType(payload) || datasetType
      : datasetType;
  const rootKeys = {
    contact: ["contactDataSet"],
    process: ["processDataSet"],
    flow: ["flowDataSet"],
    flowproperty: ["flowPropertyDataSet"],
    lifecyclemodel: [
      "lifeCycleModelDataSet",
      "lifecycleModelDataSet",
      "lifecyclemodelDataSet",
    ],
    source: ["sourceDataSet"],
    unitgroup: ["unitGroupDataSet"],
  };
  for (const key of rootKeys[effectiveDatasetType] ?? []) {
    if (payload?.[key] && typeof payload[key] === "object") return payload[key];
  }
  return {};
}

export function detectSupportDatasetType(value) {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? unwrapDatasetPayload(value, "support")
      : value;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (payload.contactDataSet) return "contact";
  if (payload.sourceDataSet) return "source";
  if (payload.unitGroupDataSet) return "unitgroup";
  if (payload.flowPropertyDataSet) return "flowproperty";
  if (value?.contact) return "contact";
  if (value?.source) return "source";
  if (value?.unitgroup) return "unitgroup";
  if (value?.flowproperty) return "flowproperty";
  return null;
}

export function detectDatasetType(value, fallback = null) {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? unwrapDatasetPayload(value, fallback || "support")
      : value;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
  if (payload.flowDataSet) return "flow";
  if (payload.processDataSet) return "process";
  if (payload.contactDataSet) return "contact";
  if (payload.sourceDataSet) return "source";
  if (payload.unitGroupDataSet) return "unitgroup";
  if (payload.flowPropertyDataSet) return "flowproperty";
  if (
    payload.lifeCycleModelDataSet ||
    payload.lifecycleModelDataSet ||
    payload.lifecyclemodelDataSet
  ) {
    return "lifecyclemodel";
  }
  return fallback;
}

export function dataSetInformation(root, datasetType) {
  const candidates = [
    root?.contactInformation?.dataSetInformation,
    root?.processInformation?.dataSetInformation,
    root?.flowInformation?.dataSetInformation,
    root?.flowPropertiesInformation?.dataSetInformation,
    root?.lifeCycleModelInformation?.dataSetInformation,
    root?.lifecycleModelInformation?.dataSetInformation,
    root?.sourceInformation?.dataSetInformation,
    root?.unitGroupInformation?.dataSetInformation,
    root?.[`${datasetType}Information`]?.dataSetInformation,
    root?.dataSetInformation,
  ];
  return (
    candidates.find(
      (candidate) => candidate && typeof candidate === "object",
    ) ?? {}
  );
}

export function datasetIdentity(row, index, datasetType) {
  const payload = unwrapDatasetPayload(row, datasetType);
  const effectiveDatasetType =
    datasetType === "support"
      ? detectSupportDatasetType(row) || detectSupportDatasetType(payload)
      : datasetType;
  const root = datasetRoot(payload, effectiveDatasetType);
  const info = dataSetInformation(root, effectiveDatasetType);
  const publication =
    root?.administrativeInformation?.publicationAndOwnership ?? {};
  const directId = row?.id ?? row?.[`${datasetType}_id`] ?? row?.dataset_id;
  const id = asText(directId ?? info["common:UUID"]) || `row-${index + 1}`;
  const version =
    asText(row?.version ?? publication["common:dataSetVersion"]) || "00.00.001";
  return { id, version, payload, dataset_type: effectiveDatasetType };
}

export function idFromArtifactFile(fileName) {
  const base = path.basename(String(fileName ?? ""));
  const withoutExt = base.replace(/\.json$/u, "").replace(/\.jsonl$/u, "");
  return withoutExt.split("__")[0] || "";
}

export function entityIdFromFinding(finding, datasetType) {
  if (!finding || typeof finding !== "object") return "";
  const directKeys = [
    `${datasetType}_id`,
    "entity_id",
    "dataset_id",
    "row_id",
    "id",
  ];
  for (const key of directKeys) {
    const value = asText(finding[key]);
    if (value) return value;
  }
  const fileKeys = [
    `${datasetType}_file`,
    "process_file",
    "flow_file",
    "lifecyclemodel_file",
    "model_file",
    "file",
  ];
  for (const key of fileKeys) {
    const value = idFromArtifactFile(finding[key]);
    if (value) return value;
  }
  return "";
}

export function readJsonLinesIfExists(filePath) {
  if (!filePath || !fileExists(filePath)) return [];
  const parsed = readJsonOrJsonl(filePath);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.findings)) return parsed.findings;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  return [];
}

export function resolveArtifactPath(repoRoot, filePath, baseDir) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  const fromBase = path.resolve(baseDir, filePath);
  if (fileExists(fromBase)) return fromBase;
  return resolveRepoPath(repoRoot, filePath);
}

export function qaFindingCode(finding) {
  return (
    asText(
      finding?.code ?? finding?.rule_code ?? finding?.rule_id ?? finding?.id,
    ) || "qa_finding"
  );
}

export const qaFindingPathDefaults = {
  process: {
    process_missing_source_base_name:
      "processDataSet.processInformation.dataSetInformation.name.baseName",
    process_missing_functional_unit:
      "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
    process_missing_system_boundary:
      "processDataSet.processInformation.dataSetInformation.common:generalComment",
    process_missing_time:
      "processDataSet.processInformation.time.common:referenceYear",
    process_missing_geography:
      "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction",
    process_missing_technology:
      "processDataSet.processInformation.technology.technologyDescriptionAndIncludedProcesses",
  },
  flow: {
    flow_missing_base_name:
      "flowDataSet.flowInformation.dataSetInformation.name.baseName",
    flow_missing_classification:
      "flowDataSet.flowInformation.dataSetInformation.classificationInformation",
    flow_missing_reference_flow_property:
      "flowDataSet.flowInformation.quantitativeReference.referenceToReferenceFlowProperty",
  },
  lifecyclemodel: {
    lifecyclemodel_missing_functional_unit:
      "lifeCycleModelDataSet.lifeCycleModelInformation.quantitativeReference.functionalUnitOrOther",
    lifecyclemodel_missing_reference_process:
      "lifeCycleModelDataSet.lifeCycleModelInformation.quantitativeReference.referenceToReferenceProcess",
  },
};

export function qaFindingPath(finding, datasetType) {
  return (
    asText(finding?.path ?? finding?.field_path ?? finding?.fieldPath) ||
    qaFindingPathDefaults[datasetType]?.[qaFindingCode(finding)] ||
    null
  );
}

export function qaFindingInstruction(finding, datasetType) {
  const code = qaFindingCode(finding);
  if (datasetType === "process" && code === "process_missing_functional_unit") {
    return "Use the source row, reference exchange, source unit, process name, SDK schema, and methodology YAML quantitativeReference rules to write source-language functionalUnitOrOther. Do not invent a value when source evidence is absent.";
  }
  if (
    datasetType === "process" &&
    code === "process_missing_source_base_name"
  ) {
    return "Use source-language evidence and methodology YAML naming rules to write name.baseName without placeholder tokens, geography braces, or bilingual requirements.";
  }
  if (datasetType === "process" && code === "process_missing_geography") {
    return "Use source geography evidence and the TIDAS location code workflow before writing location fields.";
  }
  if (datasetType === "process" && code === "process_missing_time") {
    return "Use source temporal coverage evidence to fill the process reference year or leave the action item unresolved if no source-backed year exists.";
  }
  return asText(finding?.instruction) || null;
}

export function qaFindingCurationAction(finding, datasetType) {
  return {
    source: `${datasetType}_qa`,
    code: qaFindingCode(finding),
    path: qaFindingPath(finding, datasetType),
    message: finding.message ?? null,
    evidence: finding.evidence ?? null,
    instruction: qaFindingInstruction(finding, datasetType),
    action_kind: "ai_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
  };
}

export function readQaFindings(repoRoot, qaReport, qaReportPath, datasetType) {
  const qaReportDir = path.dirname(qaReportPath);
  const fileRefs = [
    qaReport?.files?.rule_findings,
    qaReport?.files?.findings,
    qaReport?.files?.llm_findings,
  ].filter(Boolean);
  const findings = [];
  for (const fileRef of fileRefs) {
    const resolved = resolveArtifactPath(repoRoot, fileRef, qaReportDir);
    findings.push(...readJsonLinesIfExists(resolved));
  }
  findings.push(...ensureArray(qaReport?.ruleset_gate?.blockers));
  findings.push(...ensureArray(qaReport?.blockers));
  findings.push(...ensureArray(qaReport?.findings));
  const deduped = [];
  const seen = new Set();
  for (const finding of findings) {
    if (!finding || typeof finding !== "object") continue;
    const key = JSON.stringify([
      entityIdFromFinding(finding, datasetType),
      qaFindingCode(finding),
      finding.path ?? null,
      finding.message ?? null,
      finding.evidence ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

export const annualSupplyFieldPath =
  "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume";

export const annualSupplyMissingDataSentinelText = "9999 missing-data-sentinel/year";

export const tidasSchemaSearchRoots = [
  ["tiangong-lca-cli", "assets", "tidas-schemas"],
  ["tidas-tools", "src", "tidas_tools", "tidas", "schemas"],
];

export function isAnnualSupplyTarget(code, itemPath) {
  return (
    asText(code).startsWith("annual_supply_or_production_volume") ||
    asText(itemPath).includes("annualSupplyOrProductionVolume")
  );
}

export function isAnnualSupplySchemaIssue(issue) {
  return isAnnualSupplyTarget(issue?.code, issue?.path);
}

export function tidasSchemaPath(repoRoot, schemaFile) {
  for (const parts of tidasSchemaSearchRoots) {
    const candidate = path.resolve(repoRoot, "..", ...parts, schemaFile);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

export function loadTidasSchema(repoRoot, schemaFile) {
  const schemaPath = tidasSchemaPath(repoRoot, schemaFile);
  return schemaPath ? readJson(schemaPath) : null;
}

export function schemaIssueInstruction(issue) {
  const code = String(issue?.code ?? "");
  const issuePath = String(issue?.path ?? "");
  if (isAnnualSupplyTarget(code, issuePath)) {
    return `Use source evidence or an explicitly documented profile fallback to write annualSupplyOrProductionVolume as a real annualized quantity with unit, for example '<number> <unit>/year'. If no annualized source evidence exists, Foundry deterministic cleanup must write the intentionally non-physical sentinel '${annualSupplyMissingDataSentinelText}' so database-side follow-up can bulk-locate and replace it later.`;
  }
  if (code === "invalid_format") {
    return "Use the SDK schema and methodology YAML for this field to replace the invalid value with a schema-valid source-backed value.";
  }
  return null;
}

export function schemaIssueCurationAction(issue) {
  const code = String(issue?.code ?? "");
  const issuePath = String(issue?.path ?? "");
  const annualSupplyIssue = isAnnualSupplySchemaIssue(issue);
  const base = {
    source: "schema",
    code: issue?.code,
    path: issue?.path ?? null,
    message: issue?.message ?? null,
    instruction: schemaIssueInstruction(issue),
    ...(annualSupplyIssue
      ? {
          sentinel_completion_allowed: true,
          sentinel_cleanup_path: annualSupplyFieldPath,
          sentinel_value: annualSupplyMissingDataSentinelText,
          sentinel_policy:
            "The 9999 missing-data sentinel is intentionally non-physical and easy to bulk-query; later database-side curation owns replacing it with real annual volume evidence.",
        }
      : {}),
  };
  if (annualSupplyIssue) {
    return {
      ...base,
      action_kind: "annual_supply_sentinel_completion",
      required_owner: "foundry_deterministic_cleanup",
      ai_required: false,
      instruction: schemaIssueInstruction(issue),
    };
  }
  if (issuePath.includes("common:other.tidasimport:sourceTrace")) {
    return {
      ...base,
      action_kind: "source_trace_externalization",
      required_owner: "foundry_deterministic_cleanup",
      ai_required: false,
      instruction:
        "Preserve sourceTrace in the authoring package context, then remove or externalize it before remote write.",
    };
  }
  if (code === "invalid_format" && issuePath.endsWith("common:timeStamp")) {
    return {
      ...base,
      action_kind: "timestamp_normalization",
      required_owner: "foundry_deterministic_cleanup",
      ai_required: false,
      instruction:
        "Normalize the timestamp to the SDK-accepted datetime format before validation.",
    };
  }
  return {
    ...base,
    action_kind: "ai_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
  };
}

export function collectExplicitContextFiles(options) {
  return [
    ["contract_context", options.contractContext ?? options.contextFile],
    ["schema", options.schemaFile],
    ["methodology_yaml", options.yamlFile],
    ["ruleset", options.rulesetFile],
    ["contract", options.contractFile],
  ].filter(([, filePath]) => Boolean(filePath));
}

export function collectContextDirFiles(repoRoot, contextDir) {
  const resolvedDir = resolveRepoPath(repoRoot, contextDir);
  if (!directoryExists(resolvedDir)) return [];
  return fs
    .readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(json|ya?ml|md|txt)$/iu.test(name))
    .sort()
    .map((name) => ["context_dir_file", path.join(resolvedDir, name)]);
}

export function firstTidasSchemaDir(repoRoot) {
  for (const parts of tidasSchemaSearchRoots) {
    const candidate = path.resolve(repoRoot, "..", ...parts);
    if (directoryExists(candidate)) return candidate;
  }
  return null;
}

export function bundledCategorySchemaFileNames(repoRoot) {
  const schemaDir = firstTidasSchemaDir(repoRoot);
  if (!schemaDir) return [];
  return fs
    .readdirSync(schemaDir)
    .filter((name) => /^tidas_.*_category\.json$/u.test(name))
    .sort();
}

export function collectBundledSchemaContextFiles(repoRoot) {
  const schemaDir = firstTidasSchemaDir(repoRoot);
  if (!schemaDir) return [];
  const entries = [];
  for (const name of bundledCategorySchemaFileNames(repoRoot)) {
    if (name === "tidas_locations_category.json") continue;
    entries.push(["classification_schema", path.join(schemaDir, name)]);
  }
  entries.push([
    "location_schema",
    path.join(schemaDir, "tidas_locations_category.json"),
  ]);
  return entries;
}

export function readContextFiles(repoRoot, entries) {
  const files = [];
  const missing = [];
  const seen = new Set();
  for (const [kind, filePath] of entries) {
    const resolved = resolveRepoPath(repoRoot, filePath);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    if (!fileExists(resolved)) {
      missing.push({
        kind,
        path: path.isAbsolute(filePath) ? filePath : filePath,
      });
      continue;
    }
    files.push({
      kind,
      path: repoRelativePath(repoRoot, resolved),
      text: readText(resolved),
    });
  }
  return { files, missing };
}

export function normalizeFullContextAiCompletion(value) {
  const config = value && typeof value === "object" ? value : {};
  return {
    required: Boolean(config.required ?? config.require ?? false),
    datasetTypes: ensureArray(config.dataset_types ?? config.datasetTypes)
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean),
    requiredContextKinds: ensureArray(
      config.required_context_kinds ?? config.requiredContextKinds,
    )
      .map((item) => String(item).trim())
      .filter(Boolean),
    requiredContextFilePatterns: ensureArray(
      config.required_context_file_patterns ??
        config.requiredContextFilePatterns,
    )
      .map((item) => String(item).trim())
      .filter(Boolean),
    proof:
      asText(config.proof) ||
      "dataset-authoring-patch-collect plus dataset-patch-apply with authoring package closure",
  };
}

export function fullContextAiCompletionRequirement(profile, datasetType, repoRoot) {
  const requirement =
    profile?.fullContextAiCompletion ?? normalizeFullContextAiCompletion(null);
  if (!requirement.required) return null;
  if (
    requirement.datasetTypes.length > 0 &&
    !requirement.datasetTypes.includes(datasetType)
  ) {
    return null;
  }
  const fallbackFilePatterns = [
    "schema.json",
    "methodology.yaml",
    "runtime-ruleset.json",
    "tidas_contacts_category.json",
    "tidas_flowproperties_category.json",
    "tidas_flows_elementary_category.json",
    "tidas_flows_product_category.json",
    "tidas_lciamethods_category.json",
    "tidas_processes_category.json",
    "tidas_sources_category.json",
    "tidas_unitgroups_category.json",
    "tidas_locations_category.json",
  ];
  const categorySchemaFileNames = repoRoot
    ? bundledCategorySchemaFileNames(repoRoot)
    : [];

  return {
    ...requirement,
    requiredContextKinds:
      requirement.requiredContextKinds.length > 0
        ? requirement.requiredContextKinds
        : [
            "schema",
            "methodology_yaml",
            "ruleset",
            "classification_schema",
            "location_schema",
          ],
    requiredContextFilePatterns: [
      ...new Set([
        ...(requirement.requiredContextFilePatterns.length > 0
          ? requirement.requiredContextFilePatterns
          : fallbackFilePatterns),
        ...categorySchemaFileNames,
      ]),
    ],
  };
}

export function contextFileDetails(files) {
  return ensureArray(files).map((file) => ({
    kind: asText(file?.kind) || "context",
    path: asText(file?.path) || null,
    sha256: sha256Text(file?.text ?? ""),
    bytes: Buffer.byteLength(String(file?.text ?? ""), "utf8"),
  }));
}

export function contextHasFilePattern(files, pattern) {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some((file) =>
    String(file?.path ?? "")
      .toLowerCase()
      .includes(needle),
  );
}

export function fullContextGateItems({ contractContext, requirement }) {
  if (!requirement) return [];
  const kinds = new Set(
    contractContext.files.map((file) => asText(file.kind)).filter(Boolean),
  );
  const items = [];
  for (const kind of requirement.requiredContextKinds) {
    if (!kinds.has(kind)) {
      items.push({
        source: "full_context",
        code: "full_context_required_kind_missing",
        path: null,
        message: `Full-context AI authoring requires contract context kind '${kind}'.`,
        action_kind: "context_pack_required",
        required_owner: "foundry_context_pack",
        ai_required: false,
        required_kind: kind,
        instruction:
          "Regenerate the SDK/CLI dataset context pack and pass it to dataset-curation-gate before AI authoring or remote write planning.",
      });
    }
  }
  for (const pattern of requirement.requiredContextFilePatterns) {
    if (!contextHasFilePattern(contractContext.files, pattern)) {
      items.push({
        source: "full_context",
        code: "full_context_required_file_missing",
        path: null,
        message: `Full-context AI authoring requires a context file matching '${pattern}'.`,
        action_kind: "context_pack_required",
        required_owner: "foundry_context_pack",
        ai_required: false,
        required_file_pattern: pattern,
        instruction:
          "Regenerate the SDK/CLI dataset context pack and pass it to dataset-curation-gate before AI authoring or remote write planning.",
      });
    }
  }
  return items;
}

export function readCurationQueueContext(repoRoot, options) {
  const queueDirOption = options.queueDir ?? options.curationQueueDir;
  const queueDir = resolveRepoPath(repoRoot, queueDirOption);
  if (!queueDirOption) return null;
  if (!directoryExists(queueDir)) {
    throw new Error(
      `--queue-dir must point to an existing curation queue directory: ${queueDirOption}`,
    );
  }
  const manifestPath = path.join(
    queueDir,
    "outputs",
    "curation-queue-manifest.json",
  );
  if (!fileExists(manifestPath)) {
    throw new Error(
      `--queue-dir is missing outputs/curation-queue-manifest.json: ${queueDirOption}`,
    );
  }
  const manifest = readJson(manifestPath);
  const tasks = ensureArray(manifest.tasks).filter(
    (task) => task && typeof task === "object",
  );
  return {
    queueDir,
    manifestPath,
    manifest,
    tasks,
    tasksById: new Map(tasks.map((task) => [String(task.task_id ?? ""), task])),
  };
}

export function queueFilePath(repoRoot, queueContext, fileRef) {
  return resolveArtifactPath(repoRoot, fileRef, queueContext.queueDir);
}

export function queueFileRelativePath(repoRoot, queueContext, fileRef) {
  const resolved = queueFilePath(repoRoot, queueContext, fileRef);
  return resolved ? repoRelativePath(repoRoot, resolved) : null;
}

export function summarizeQueueTask(repoRoot, queueContext, task) {
  if (!task) return null;
  return {
    schema_version: task.schema_version ?? 1,
    entity_type: task.entity_type ?? null,
    task_id: task.task_id ?? null,
    entity_id: task.entity_id ?? null,
    version: task.version ?? null,
    lock_key: task.lock_key ?? null,
    depends_on: ensureArray(task.depends_on),
    input_rows_file: queueFileRelativePath(
      repoRoot,
      queueContext,
      task.input_rows_file,
    ),
    closure_file: queueFileRelativePath(
      repoRoot,
      queueContext,
      task.closure_file,
    ),
    run_plan_file: queueFileRelativePath(
      repoRoot,
      queueContext,
      task.run_plan_file,
    ),
  };
}

export function readQueueTaskRows(repoRoot, queueContext, task) {
  const inputRowsPath = queueFilePath(
    repoRoot,
    queueContext,
    task?.input_rows_file,
  );
  return fileExists(inputRowsPath) ? readRows(inputRowsPath) : [];
}

export function findQueueTask(queueContext, datasetType, identity) {
  if (!queueContext || datasetType === "lifecyclemodel") return null;
  const exact = queueContext.tasks.find(
    (task) =>
      task.entity_type === datasetType &&
      task.entity_id === identity.id &&
      task.version === identity.version,
  );
  if (exact) return exact;
  return (
    queueContext.tasks.find(
      (task) =>
        task.entity_type === datasetType && task.entity_id === identity.id,
    ) ?? null
  );
}

export function buildQueueAuthoringContext(
  repoRoot,
  queueContext,
  datasetType,
  identity,
) {
  if (!queueContext) return null;
  const base = {
    queue_dir: repoRelativePath(repoRoot, queueContext.queueDir),
    manifest_file: repoRelativePath(repoRoot, queueContext.manifestPath),
    queue_status: queueContext.manifest.status ?? null,
    queue_counts: queueContext.manifest.counts ?? null,
    queue_blockers: ensureArray(queueContext.manifest.blockers),
  };
  if (datasetType === "lifecyclemodel") {
    return {
      ...base,
      status: "not_applicable",
      reason:
        "curation queue currently attaches entity closure for flow and process rows.",
    };
  }

  const task = findQueueTask(queueContext, datasetType, identity);
  if (!task) {
    return {
      ...base,
      status: "missing_task",
      entity_type: datasetType,
      entity_id: identity.id,
      version: identity.version,
    };
  }

  const closurePath = queueFilePath(repoRoot, queueContext, task.closure_file);
  const closure = readJsonIfExists(closurePath);
  const dependencyRows = ensureArray(closure?.dependencies?.local_tasks).map(
    (dependency) => {
      const dependencyTask = queueContext.tasksById.get(
        String(dependency.task_id ?? ""),
      );
      return {
        ref: dependency.ref ?? null,
        ref_path: dependency.ref_path ?? null,
        task: summarizeQueueTask(repoRoot, queueContext, dependencyTask),
        input_rows: readQueueTaskRows(repoRoot, queueContext, dependencyTask),
      };
    },
  );
  const supportRows = queueContext.tasks
    .filter((candidate) => candidate.entity_type === "support")
    .map((supportTask) => ({
      task: summarizeQueueTask(repoRoot, queueContext, supportTask),
      input_rows: readQueueTaskRows(repoRoot, queueContext, supportTask),
    }));

  return {
    ...base,
    status: "attached",
    task: summarizeQueueTask(repoRoot, queueContext, task),
    closure_file: closurePath ? repoRelativePath(repoRoot, closurePath) : null,
    closure,
    dependency_rows: dependencyRows,
    support_rows: supportRows,
    notes: [
      "dependency_rows are local flow/support closure inputs for this entity task.",
      "AI output must still be a structured patch or build plan; database writes are not allowed from this package.",
    ],
  };
}

export function readAuthoringQueueContext(repoRoot, optionValue, kind) {
  const queuePath = resolveRepoPath(repoRoot, optionValue);
  if (!optionValue) {
    return null;
  }
  if (!queuePath || !fileExists(queuePath)) {
    throw new Error(
      `--${kind}-queue must point to a readable JSONL queue file: ${optionValue}`,
    );
  }
  const rows = readRows(queuePath).filter(
    (row) => row && typeof row === "object" && !Array.isArray(row),
  );
  return {
    kind,
    path: queuePath,
    rows,
    rowsByIdentity: new Map(
      rows
        .map((row) => {
          const id = asText(
            row.dataset_id ??
              row.entity_id ??
              row.process_id ??
              row.flow_id ??
              row.id,
          );
          const version =
            asText(row.dataset_version ?? row.version) || "00.00.001";
          return [`${id}@@${version}`, row];
        })
        .filter(([key]) => !key.startsWith("@@")),
    ),
  };
}

export function authoringQueueRowsForIdentity(queueContext, identity) {
  if (!queueContext) return [];
  const exact = queueContext.rowsByIdentity.get(identityKey(identity));
  if (exact) return [exact];
  const idOnly = queueContext.rows.filter(
    (row) =>
      asText(
        row.dataset_id ??
          row.entity_id ??
          row.process_id ??
          row.flow_id ??
          row.id,
      ) === identity.id,
  );
  return idOnly;
}

export function identityPreflightIndexPath(repoRoot, options, rowsFile) {
  const explicit =
    options.identityPreflightIndex ??
    options.identityPreflightRequests ??
    options.identityPreflightRequestsIndex ??
    options.identityPreflightFile;
  if (explicit) return resolveRepoPath(repoRoot, explicit);
  if (!rowsFile) return null;
  const defaultPath = path.join(
    path.dirname(path.dirname(rowsFile)),
    "identity-preflight-requests",
    "identity-preflight-requests.jsonl",
  );
  return fileExists(defaultPath) ? defaultPath : null;
}
