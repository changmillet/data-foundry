import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const supportedDatasetTypes = new Set([
  "contact",
  "flow",
  "flowproperty",
  "lifecyclemodel",
  "process",
  "source",
  "support",
  "unitgroup",
]);
const supportDatasetTypes = new Set([
  "contact",
  "source",
]);
const referenceOnlySupportDatasetTypes = new Set(["unitgroup", "flowproperty"]);
const datasetTypePlural = {
  contact: "contacts",
  process: "processes",
  flow: "flows",
  flowproperty: "flowproperties",
  lifecyclemodel: "lifecyclemodels",
  source: "sources",
  support: "support",
  unitgroup: "unitgroups",
};
const defaultProfilesFile = "specs/import-profiles.json";
const fallbackProfiles = {
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

function nowIso() {
  return new Date().toISOString();
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readJsonIfExists(filePath) {
  return fileExists(filePath) ? readJson(filePath) : null;
}

function writeJson(filePath, data) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function fileExists(filePath) {
  return Boolean(
    filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
  );
}

function directoryExists(filePath) {
  return Boolean(
    filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory(),
  );
}

function resolveRepoPath(repoRoot, filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function repoRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath);
}

function readJsonOrJsonl(filePath) {
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

function readRows(filePath) {
  const parsed = readJsonOrJsonl(filePath);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.processes)) return parsed.processes;
  if (Array.isArray(parsed?.flows)) return parsed.flows;
  if (Array.isArray(parsed?.lifecyclemodels)) return parsed.lifecyclemodels;
  return [parsed];
}

function optionList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => optionList(item));
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function jsonLines(rows) {
  return (
    rows.map((row) => JSON.stringify(row)).join("\n") +
    (rows.length ? "\n" : "")
  );
}

function unique(values) {
  return [...new Set(ensureArray(values).filter(Boolean))];
}

function sanitizeFileName(value) {
  return (
    String(value ?? "missing")
      .replace(/[^A-Za-z0-9._-]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "missing"
  );
}

function asText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

function unwrapDatasetPayload(row, datasetType) {
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

function datasetRoot(payload, datasetType) {
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

function detectSupportDatasetType(value) {
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

function detectDatasetType(value, fallback = null) {
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

function dataSetInformation(root, datasetType) {
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

function datasetIdentity(row, index, datasetType) {
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

function idFromArtifactFile(fileName) {
  const base = path.basename(String(fileName ?? ""));
  const withoutExt = base.replace(/\.json$/u, "").replace(/\.jsonl$/u, "");
  return withoutExt.split("__")[0] || "";
}

function entityIdFromFinding(finding, datasetType) {
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

function readJsonLinesIfExists(filePath) {
  if (!filePath || !fileExists(filePath)) return [];
  const parsed = readJsonOrJsonl(filePath);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.findings)) return parsed.findings;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  return [];
}

function resolveArtifactPath(repoRoot, filePath, baseDir) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  const fromBase = path.resolve(baseDir, filePath);
  if (fileExists(fromBase)) return fromBase;
  return resolveRepoPath(repoRoot, filePath);
}

function qaFindingCode(finding) {
  return (
    asText(
      finding?.code ?? finding?.rule_code ?? finding?.rule_id ?? finding?.id,
    ) || "qa_finding"
  );
}

const qaFindingPathDefaults = {
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

function qaFindingPath(finding, datasetType) {
  return (
    asText(finding?.path ?? finding?.field_path ?? finding?.fieldPath) ||
    qaFindingPathDefaults[datasetType]?.[qaFindingCode(finding)] ||
    null
  );
}

function qaFindingInstruction(finding, datasetType) {
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

function qaFindingCurationAction(finding, datasetType) {
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

function readQaFindings(repoRoot, qaReport, qaReportPath, datasetType) {
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

const annualSupplyFieldPath =
  "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume";
const annualSupplyMissingDataSentinelText = "9999 missing-data-sentinel/year";
const tidasSchemaSearchRoots = [
  ["tiangong-lca-cli", "assets", "tidas-schemas"],
  ["tidas-tools", "src", "tidas_tools", "tidas", "schemas"],
];

function isAnnualSupplyTarget(code, itemPath) {
  return (
    asText(code).startsWith("annual_supply_or_production_volume") ||
    asText(itemPath).includes("annualSupplyOrProductionVolume")
  );
}

function isAnnualSupplySchemaIssue(issue) {
  return isAnnualSupplyTarget(issue?.code, issue?.path);
}

function tidasSchemaPath(repoRoot, schemaFile) {
  for (const parts of tidasSchemaSearchRoots) {
    const candidate = path.resolve(repoRoot, "..", ...parts, schemaFile);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function loadTidasSchema(repoRoot, schemaFile) {
  const schemaPath = tidasSchemaPath(repoRoot, schemaFile);
  return schemaPath ? readJson(schemaPath) : null;
}

function schemaIssueInstruction(issue) {
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

function schemaIssueCurationAction(issue) {
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

function collectExplicitContextFiles(options) {
  return [
    ["contract_context", options.contractContext ?? options.contextFile],
    ["schema", options.schemaFile],
    ["methodology_yaml", options.yamlFile],
    ["ruleset", options.rulesetFile],
    ["contract", options.contractFile],
  ].filter(([, filePath]) => Boolean(filePath));
}

function collectContextDirFiles(repoRoot, contextDir) {
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

function firstTidasSchemaDir(repoRoot) {
  for (const parts of tidasSchemaSearchRoots) {
    const candidate = path.resolve(repoRoot, "..", ...parts);
    if (directoryExists(candidate)) return candidate;
  }
  return null;
}

function bundledCategorySchemaFileNames(repoRoot) {
  const schemaDir = firstTidasSchemaDir(repoRoot);
  if (!schemaDir) return [];
  return fs
    .readdirSync(schemaDir)
    .filter((name) => /^tidas_.*_category\.json$/u.test(name))
    .sort();
}

function collectBundledSchemaContextFiles(repoRoot) {
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

function readContextFiles(repoRoot, entries) {
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

function normalizeFullContextAiCompletion(value) {
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

function fullContextAiCompletionRequirement(profile, datasetType, repoRoot) {
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

function contextFileDetails(files) {
  return ensureArray(files).map((file) => ({
    kind: asText(file?.kind) || "context",
    path: asText(file?.path) || null,
    sha256: sha256Text(file?.text ?? ""),
    bytes: Buffer.byteLength(String(file?.text ?? ""), "utf8"),
  }));
}

function contextHasFilePattern(files, pattern) {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some((file) =>
    String(file?.path ?? "")
      .toLowerCase()
      .includes(needle),
  );
}

function fullContextGateItems({ contractContext, requirement }) {
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

function readCurationQueueContext(repoRoot, options) {
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

function queueFilePath(repoRoot, queueContext, fileRef) {
  return resolveArtifactPath(repoRoot, fileRef, queueContext.queueDir);
}

function queueFileRelativePath(repoRoot, queueContext, fileRef) {
  const resolved = queueFilePath(repoRoot, queueContext, fileRef);
  return resolved ? repoRelativePath(repoRoot, resolved) : null;
}

function summarizeQueueTask(repoRoot, queueContext, task) {
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

function readQueueTaskRows(repoRoot, queueContext, task) {
  const inputRowsPath = queueFilePath(
    repoRoot,
    queueContext,
    task?.input_rows_file,
  );
  return fileExists(inputRowsPath) ? readRows(inputRowsPath) : [];
}

function findQueueTask(queueContext, datasetType, identity) {
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

function buildQueueAuthoringContext(
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

function readAuthoringQueueContext(repoRoot, optionValue, kind) {
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

function authoringQueueRowsForIdentity(queueContext, identity) {
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

function identityPreflightIndexPath(repoRoot, options, rowsFile) {
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

function identityPreflightResultFile(repoRoot, indexPath, row) {
  const baseDir = path.dirname(indexPath);
  const explicit =
    row?.expected_report_file ??
    row?.identity_decision_file ??
    row?.identityDecisionFile ??
    row?.report_file ??
    row?.reportFile;
  if (explicit) return resolveArtifactPath(repoRoot, explicit, baseDir);
  const outputDir = row?.output_dir ?? row?.outputDir;
  if (!outputDir) return null;
  const resolvedOutputDir = path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(baseDir, outputDir);
  const fromIndexBase = path.join(
    resolvedOutputDir,
    "outputs",
    "identity-decision.json",
  );
  if (fileExists(fromIndexBase)) return fromIndexBase;
  return resolveRepoPath(
    repoRoot,
    path.join(outputDir, "outputs", "identity-decision.json"),
  );
}

function identityPreflightCandidatesFile(repoRoot, indexPath, row, result) {
  const baseDir = path.dirname(indexPath);
  const explicit =
    row?.expected_candidates_file ??
    row?.identity_candidates_file ??
    row?.identityCandidatesFile ??
    result?.files?.candidates;
  return explicit ? resolveArtifactPath(repoRoot, explicit, baseDir) : null;
}

function readIdentityPreflightIndexRow(repoRoot, indexPath, row) {
  const baseDir = path.dirname(indexPath);
  const datasetType = asText(row?.dataset_type ?? row?.type);
  const datasetId = asText(row?.dataset_id ?? row?.entity_id ?? row?.id);
  const datasetVersion =
    asText(row?.dataset_version ?? row?.version) || "00.00.001";
  if (!datasetType || !datasetId) return null;
  const requestPath = resolveArtifactPath(repoRoot, row?.request_file, baseDir);
  const request = readJsonIfExists(requestPath);
  const resultPath = identityPreflightResultFile(repoRoot, indexPath, row);
  const result = readJsonIfExists(resultPath);
  const candidatesPath = identityPreflightCandidatesFile(
    repoRoot,
    indexPath,
    row,
    result,
  );
  const candidateRows = readJsonLinesIfExists(candidatesPath);
  const outputDir = row?.output_dir
    ? resolveArtifactPath(repoRoot, row.output_dir, baseDir) ??
      resolveRepoPath(repoRoot, row.output_dir)
    : result?.out_dir ?? null;
  return {
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: datasetVersion,
    source_file: row?.source_file ?? null,
    request_file: requestPath ? repoRelativePath(repoRoot, requestPath) : null,
    output_dir: outputDir ? repoRelativePath(repoRoot, outputDir) : null,
    command: row?.command ?? null,
    remote_search: row?.remote_search ?? request?.remote_candidate_search ?? null,
    request: request
      ? {
          schema_version: request.schema_version ?? null,
          remote_candidate_search: request.remote_candidate_search ?? null,
          target_sha256:
            row?.target_sha256 ??
            row?.targetSha256 ??
            sha256Json(request.target ?? null),
        }
      : row?.target_sha256 || row?.targetSha256
        ? {
            schema_version: null,
            remote_candidate_search: null,
            target_sha256: row?.target_sha256 ?? row?.targetSha256,
          }
        : null,
    result: result
      ? {
          status: result.status ?? null,
          decision: result.decision ?? null,
          confidence: result.confidence ?? null,
          next_action: result.next_action ?? null,
          target: result.target ?? null,
          candidates:
            candidateRows.length > 0 ? candidateRows : ensureArray(result.candidates),
          candidate_sources: result.candidate_sources ?? null,
          findings: result.findings ?? [],
          blockers: result.blockers ?? [],
          files: result.files ?? null,
        }
      : null,
    status: result ? "completed" : "pending_execution",
  };
}

function readIdentityPreflightContext(repoRoot, options, rowsFile) {
  const indexPath = identityPreflightIndexPath(repoRoot, options, rowsFile);
  if (!indexPath) return null;
  if (!fileExists(indexPath)) {
    throw new Error(
      `--identity-preflight-index must point to a readable JSONL file: ${indexPath}`,
    );
  }
  const rows = readJsonLinesIfExists(indexPath)
    .map((row) => readIdentityPreflightIndexRow(repoRoot, indexPath, row))
    .filter(Boolean);
  const rowsByIdentity = new Map();
  for (const row of rows) {
    const key = `${row.dataset_type}:${row.dataset_id}@@${row.dataset_version}`;
    rowsByIdentity.set(key, row);
    if (!rowsByIdentity.has(`${row.dataset_type}:${row.dataset_id}`)) {
      rowsByIdentity.set(`${row.dataset_type}:${row.dataset_id}`, row);
    }
  }
  return {
    indexPath,
    rows,
    rowsByIdentity,
    completed: rows.filter((row) => row.status === "completed").length,
    pending: rows.filter((row) => row.status !== "completed").length,
  };
}

function identityPreflightRowForIdentity(context, datasetType, identity) {
  if (!context || !identity?.id) return null;
  return (
    context.rowsByIdentity.get(
      `${datasetType}:${identity.id}@@${identity.version || "00.00.001"}`,
    ) ??
    context.rowsByIdentity.get(`${datasetType}:${identity.id}`) ??
    null
  );
}

function identityPreflightFreshness(row, payload) {
  const currentPayloadSha256 = payload ? sha256Json(payload) : null;
  const requestTargetSha256 = asText(row?.request?.target_sha256) || null;
  return {
    current_payload_sha256: currentPayloadSha256,
    request_target_sha256: requestTargetSha256,
    current_payload_matches_request: Boolean(
      currentPayloadSha256 &&
        requestTargetSha256 &&
        currentPayloadSha256 === requestTargetSha256,
    ),
  };
}

function identityFreshnessIdentityKey({ datasetType, identity }) {
  const id = asText(identity?.id);
  const version = asText(identity?.version) || "00.00.001";
  return id ? `${datasetType}:${id}@@${version}` : null;
}

function classificationFreshnessAllowance({
  repoRoot,
  freshness,
  datasetType,
  identity,
  classificationDecisionApplyContext,
}) {
  if (
    freshness?.current_payload_matches_request === true ||
    classificationDecisionApplyContext?.status !== "completed"
  ) {
    return null;
  }
  const key = identityFreshnessIdentityKey({ datasetType, identity });
  if (!key) return null;
  const classificationInputPayloadSha256 =
    classificationDecisionApplyContext.inputPayloadSha256ByIdentity?.get(key) ??
    null;
  const classificationOutputPayloadSha256 =
    classificationDecisionApplyContext.outputPayloadSha256ByIdentity?.get(key) ??
    null;
  const requestMatchesClassificationInput = Boolean(
    freshness?.request_target_sha256 &&
      classificationInputPayloadSha256 &&
      freshness.request_target_sha256 === classificationInputPayloadSha256,
  );
  const currentMatchesClassificationOutput = Boolean(
    freshness?.current_payload_sha256 &&
      classificationOutputPayloadSha256 &&
      freshness.current_payload_sha256 === classificationOutputPayloadSha256,
  );
  if (!requestMatchesClassificationInput || !currentMatchesClassificationOutput) {
    return null;
  }
  return {
    reason: "classification_decision_apply",
    report: classificationDecisionApplyContext.reportPath
      ? repoRelativePath(repoRoot, classificationDecisionApplyContext.reportPath)
      : null,
    input_rows_files: classificationDecisionApplyContext.inputRows.map((file) =>
      repoRelativePath(repoRoot, file),
    ),
    output_rows_files: classificationDecisionApplyContext.outputRows.map((file) =>
      repoRelativePath(repoRoot, file),
    ),
    request_payload_matches_classification_input:
      requestMatchesClassificationInput,
    current_payload_matches_classification_output:
      currentMatchesClassificationOutput,
    classification_input_payload_sha256: classificationInputPayloadSha256,
    classification_output_payload_sha256: classificationOutputPayloadSha256,
  };
}

function externalizationFreshnessAllowance({
  freshness,
  datasetType,
  identity,
  unresolvedExchangeExternalizationContext,
}) {
  if (
    datasetType !== "process" ||
    freshness?.current_payload_matches_request === true ||
    unresolvedExchangeExternalizationContext?.status !== "completed"
  ) {
    return null;
  }
  const key = identityFreshnessIdentityKey({ datasetType, identity });
  if (!key || !unresolvedExchangeExternalizationContext.affectedKeys.has(key)) {
    return null;
  }
  const externalizedPayloadSha256 =
    unresolvedExchangeExternalizationContext.outputPayloadSha256ByIdentity.get(
      key,
    ) ?? null;
  return {
    reason: "unresolved_exchange_externalization",
    report: unresolvedExchangeExternalizationContext.reportPathRelative,
    input_rows_file:
      unresolvedExchangeExternalizationContext.inputRowsFileRelative,
    output_rows_file:
      unresolvedExchangeExternalizationContext.outputRowsFileRelative,
    traces_file: unresolvedExchangeExternalizationContext.tracesFileRelative,
    externalized_exchange_count:
      unresolvedExchangeExternalizationContext.externalizedExchangeCountByIdentity.get(
        key,
      ) ?? 0,
    current_payload_matches_externalized_output: Boolean(
      freshness?.current_payload_sha256 &&
        externalizedPayloadSha256 &&
        freshness.current_payload_sha256 === externalizedPayloadSha256,
    ),
    externalized_payload_sha256: externalizedPayloadSha256,
  };
}

function attachIdentityPreflightFreshness(row, payload, options = {}) {
  if (!row) return null;
  const freshness = identityPreflightFreshness(row, payload);
  const deterministicAllowances = [
    classificationFreshnessAllowance({
      repoRoot: options.repoRoot,
      freshness,
      datasetType: options.datasetType,
      identity: options.identity,
      classificationDecisionApplyContext:
        options.classificationDecisionApplyContext,
    }),
    externalizationFreshnessAllowance({
      freshness,
      datasetType: options.datasetType,
      identity: options.identity,
      unresolvedExchangeExternalizationContext:
        options.unresolvedExchangeExternalizationContext,
    }),
  ].filter(Boolean);
  return {
    ...row,
    freshness: {
      ...freshness,
      deterministic_transform_allowance: deterministicAllowances[0] ?? null,
      deterministic_transform_allowances: deterministicAllowances,
      current_payload_scope_accepted: Boolean(
        freshness.current_payload_matches_request ||
          deterministicAllowances.length > 0,
      ),
    },
  };
}

function identityPreflightFreshnessAccepted(freshness) {
  return Boolean(
    freshness?.current_payload_matches_request === true ||
      freshness?.current_payload_scope_accepted === true,
  );
}

function identityPreflightSourceContextRequired({
  profile,
  datasetType,
  curationQueueContext,
  context,
}) {
  return Boolean(
    asText(profile?.id).toLowerCase() === "bafu" &&
      ["flow", "process"].includes(datasetType) &&
      curationQueueContext?.status === "attached" &&
      ensureArray(context?.rows).some((row) => asText(row?.source_file)),
  );
}

function identityPreflightHasSourceContext(row) {
  return Boolean(asText(row?.source_file));
}

function dependencyPayloadForFreshness(dependency) {
  const rows = ensureArray(
    dependency?.input_rows ??
      dependency?.rows ??
      dependency?.payload_rows ??
      dependency?.payloadRows,
  ).filter(Boolean);
  return rows[0] ?? dependency?.payload ?? null;
}

function dependencyIdentityPreflightRows(
  context,
  curationQueueContext,
  options = {},
) {
  if (!context || !curationQueueContext) return [];
  const rows = [];
  const seen = new Set();
  for (const dependency of ensureArray(curationQueueContext.dependency_rows)) {
    const task = dependency?.task;
    const datasetType = asText(task?.entity_type);
    const identity = {
      id: asText(task?.entity_id),
      version: asText(task?.version) || "00.00.001",
    };
    const row = identityPreflightRowForIdentity(context, datasetType, identity);
    if (!row) continue;
    const key = `${row.dataset_type}:${row.dataset_id}@@${row.dataset_version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      relation: "dependency",
      ref: dependency?.ref ?? null,
      ref_path: dependency?.ref_path ?? null,
      identity_preflight: attachIdentityPreflightFreshness(
        row,
        dependencyPayloadForFreshness(dependency),
        {
          datasetType,
          identity,
          repoRoot: options.repoRoot,
          classificationDecisionApplyContext:
            options.classificationDecisionApplyContext,
          unresolvedExchangeExternalizationContext:
            options.unresolvedExchangeExternalizationContext,
        },
      ),
    });
  }
  return rows;
}

function buildIdentityPreflightAuthoringContext({
  context,
  datasetType,
  identity,
  curationQueueContext,
  repoRoot,
  unresolvedExchangeExternalizationContext,
  classificationDecisionApplyContext,
}) {
  if (!context) return null;
  const current = attachIdentityPreflightFreshness(
    identityPreflightRowForIdentity(context, datasetType, identity),
    identity.payload,
    {
      datasetType,
      identity,
      repoRoot,
      classificationDecisionApplyContext,
      unresolvedExchangeExternalizationContext,
    },
  );
  const dependencies = dependencyIdentityPreflightRows(
    context,
    curationQueueContext,
    {
      repoRoot,
      classificationDecisionApplyContext,
      unresolvedExchangeExternalizationContext,
    },
  );
  return {
    index_file: repoRelativePath(repoRoot, context.indexPath),
    status:
      current?.status === "completed" && dependencies.every((row) => row.identity_preflight.status === "completed")
        ? "completed"
        : "pending_or_partial",
    current,
    dependencies,
    counts: {
      index_rows: context.rows.length,
      completed: context.completed,
      pending: context.pending,
      dependency_rows: dependencies.length,
    },
    policy:
      "Identity preflight is a read-only database candidate recall and deterministic identity decision artifact. AI may use it as evidence, but database writes still require Foundry finalize and CLI commit handoff gates.",
  };
}

function identityPreflightGateItems({
  required,
  context,
  authoringContext,
  datasetType,
  identity,
  curationQueueContext,
  profile,
}) {
  if (!required || !["flow", "process"].includes(datasetType)) return [];
  const items = [];
  const baseInstruction =
    "Run dataset-identity-preflight-run for the generated identity-preflight-requests index before AI authoring, then pass the same index to dataset-curation-gate with --identity-preflight-index.";
  if (!context) {
    return [
      {
        source: "identity_preflight",
        code: "identity_preflight_index_required",
        path: null,
        message:
          "Full-context AI authoring requires read-only database identity-preflight request/result context.",
        action_kind: "identity_preflight_required",
        required_owner: "foundry_identity_preflight_run",
        ai_required: false,
        instruction: baseInstruction,
      },
    ];
  }

  const current = authoringContext?.current ?? null;
  const staleInstruction =
    "Regenerate identity-preflight requests from the exact current rows file, rerun dataset-identity-preflight-run, and pass that same fresh index to the curation gate.";
  const sourceContextInstruction =
    "Regenerate identity-preflight requests from the exact current rows file with dataset-identity-preflight-requests-build --source-index <original-full-identity-preflight-requests.jsonl>, rerun dataset-identity-preflight-run, merge the refreshed current rows back into the original full index, and pass that merged index to the curation gate.";
  const requiresSourceContext = identityPreflightSourceContextRequired({
    profile,
    datasetType,
    curationQueueContext,
    context,
  });
  if (!current) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_result_missing",
      path: null,
      message:
        "No identity-preflight result is attached for the current entity.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: baseInstruction,
    });
  } else if (current.status !== "completed") {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_result_pending",
      path: null,
      message: `Current entity identity-preflight status is ${current.status}.`,
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: baseInstruction,
    });
  } else if (!identityPreflightFreshnessAccepted(current.freshness)) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_scope_stale",
      path: null,
      message:
        "Current entity identity-preflight result was generated from a different target payload than the rows file currently being curated.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: staleInstruction,
      evidence: current.freshness ?? null,
    });
  } else if (requiresSourceContext && !identityPreflightHasSourceContext(current)) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_source_context_missing",
      path: null,
      message:
        "Current entity identity-preflight was refreshed without source_file trace context, so hybrid search and AI authoring may lose source-package evidence.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: sourceContextInstruction,
      evidence: {
        remote_search: current.remote_search ?? null,
        request_file: current.request_file ?? null,
      },
    });
  }

  if (datasetType === "process" && curationQueueContext?.status === "attached") {
    const dependencyPreflightRows = ensureArray(
      authoringContext?.dependencies,
    ).map((dependency) => dependency?.identity_preflight);
    const dependencyRows = ensureArray(curationQueueContext.dependency_rows);
    for (const dependency of dependencyRows) {
      const task = dependency?.task;
      const dependencyType = asText(task?.entity_type);
      if (!["flow", "process"].includes(dependencyType)) continue;
      const dependencyIdentity = {
        id: asText(task?.entity_id),
        version: asText(task?.version) || "00.00.001",
      };
      if (!dependencyIdentity.id) continue;
      const dependencyPreflight = identityPreflightRowForIdentity(
        context,
        dependencyType,
        dependencyIdentity,
      );
      const dependencyPreflightWithFreshness =
        dependencyPreflightRows.find(
          (row) =>
            row?.dataset_type === dependencyType &&
            row?.dataset_id === dependencyIdentity.id &&
            row?.dataset_version === dependencyIdentity.version,
        ) ?? dependencyPreflight;
      if (!dependencyPreflight) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_result_missing",
          path: dependency?.ref_path ?? null,
          message:
            "No identity-preflight result is attached for a referenced dependency entity.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: baseInstruction,
        });
      } else if (dependencyPreflightWithFreshness.status !== "completed") {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_result_pending",
          path: dependency?.ref_path ?? null,
          message: `Referenced dependency identity-preflight status is ${dependencyPreflightWithFreshness.status}.`,
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: baseInstruction,
        });
      } else if (
        dependencyPreflightWithFreshness.freshness &&
        !identityPreflightFreshnessAccepted(
          dependencyPreflightWithFreshness.freshness,
        )
      ) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_scope_stale",
          path: dependency?.ref_path ?? null,
          message:
            "Referenced dependency identity-preflight result was generated from a different dependency payload than the current curation queue context.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: staleInstruction,
          evidence: dependencyPreflightWithFreshness.freshness,
        });
      } else if (
        requiresSourceContext &&
        !identityPreflightHasSourceContext(dependencyPreflightWithFreshness)
      ) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_source_context_missing",
          path: dependency?.ref_path ?? null,
          message:
            "Referenced dependency identity-preflight is missing source_file trace context, so hybrid search and AI authoring may lose source-package evidence.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: sourceContextInstruction,
          evidence: {
            remote_search: dependencyPreflightWithFreshness.remote_search ?? null,
            request_file: dependencyPreflightWithFreshness.request_file ?? null,
          },
        });
      }
    }
  }
  return items;
}

function identityPreflightNeedsAiDecision(row) {
  const result = row?.result;
  if (!result) return false;
  const status = asText(result.status);
  const decision = asText(result.decision);
  return status === "needs_review" || decision === "manual_review";
}

function identityPreflightAiDecisionActionItem({
  datasetType,
  identity,
  row,
  relation = "current",
  path = null,
  dependencyType = null,
  dependencyId = null,
  dependencyVersion = null,
}) {
  const result = row?.result ?? {};
  const candidates = ensureArray(result.candidates);
  const resultFlowType = asText(result?.target?.fields?.type_of_dataset);
  const isElementaryFlow =
    (dependencyType || datasetType) === "flow" &&
    (flowUsesElementaryClassification(identity.payload) ||
      resultFlowType === "Elementary flow");
  return {
    source: "identity_preflight",
    code: isElementaryFlow
      ? "elementary_flow_identity_manual_review"
      : "identity_preflight_manual_review",
    path,
    message: isElementaryFlow
      ? "Elementary flow identity-preflight needs AI review. Elementary flows are reference-only and must select an existing TianGong flow before write planning."
      : "Identity-preflight returned manual_review/needs_review and requires AI to decide whether to reuse an existing database row or continue as a new write candidate.",
    action_kind: "identity_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    dataset_type: datasetType,
    dataset_id: identity.id,
    dataset_version: identity.version,
    relation,
    dependency_type: dependencyType,
    dependency_id: dependencyId,
    dependency_version: dependencyVersion,
    common_other_deferral_allowed: false,
    evidence: {
      identity_preflight_status: result.status ?? null,
      identity_preflight_decision: result.decision ?? null,
      confidence: result.confidence ?? null,
      next_action: result.next_action ?? null,
      candidate_count: candidates.length,
      remote_search: row?.remote_search ?? null,
      target: result.target ?? null,
      top_candidates: candidates.slice(0, 10),
    },
    instruction: isElementaryFlow
      ? "Use the full schema/YAML/context package plus flow_hybrid_search candidates to choose the existing TianGong elementary flow reference. Do not create or write a BAFU-owned elementary flow. If no candidate is sufficient, return an unresolved identity blocker with the searched query and candidate evidence."
      : "Use the full schema/YAML/context package plus identity-preflight candidates to decide reuse_existing_reference versus create_new. If reusing, output a structured identity reference rewrite with canonical id/version and evidence. If creating new, include evidence explaining why candidates are not identity-equivalent.",
  };
}

function identityPreflightAuthoringActionItems({
  required,
  authoringContext,
  datasetType,
  identity,
  identityDecisionApplyContext = null,
}) {
  if (!required || !authoringContext) return [];
  const items = [];
  const current = authoringContext.current;
  if (identityPreflightNeedsAiDecision(current)) {
    const item = identityPreflightAiDecisionActionItem({
      datasetType,
      identity,
      row: current,
    });
    if (
      !identityDecisionApplyContextClosesAction({
        context: identityDecisionApplyContext,
        datasetType,
        id: current?.dataset_id ?? identity.id,
        version: current?.dataset_version ?? identity.version,
        code: item.code,
      })
    ) {
      items.push(item);
    }
  }
  if (datasetType === "process") {
    for (const dependency of ensureArray(authoringContext.dependencies)) {
      const dependencyPreflight = dependency?.identity_preflight;
      if (!identityPreflightNeedsAiDecision(dependencyPreflight)) continue;
      const item = identityPreflightAiDecisionActionItem({
        datasetType,
        identity,
        row: dependencyPreflight,
        relation: "dependency",
        path: dependency?.ref_path ?? null,
        dependencyType: dependencyPreflight?.dataset_type ?? null,
        dependencyId: dependencyPreflight?.dataset_id ?? null,
        dependencyVersion: dependencyPreflight?.dataset_version ?? null,
      });
      if (
        !identityDecisionApplyContextClosesAction({
          context: identityDecisionApplyContext,
          datasetType: dependencyPreflight?.dataset_type ?? null,
          id: dependencyPreflight?.dataset_id ?? null,
          version: dependencyPreflight?.dataset_version ?? null,
          code: item.code,
        })
      ) {
        items.push(item);
      }
    }
  }
  return items;
}

function comparableText(value) {
  return asText(value).replace(/\s+/gu, " ").trim().toLowerCase();
}

function classificationClassesForPayload(payload, datasetType) {
  const root = datasetRoot(payload, datasetType);
  const info = dataSetInformation(root, datasetType);
  const classification =
    info?.classificationInformation?.["common:classification"] ?? null;
  const classes =
    classification?.["common:class"] ??
    classification?.["common:category"] ??
    null;
  return ensureArray(classes).filter(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );
}

function classificationDisplayForPayload(payload, datasetType) {
  return classificationClassesForPayload(payload, datasetType)
    .map((item) => asText(item?.["#text"] ?? item?.text ?? item?.label))
    .filter(Boolean)
    .join(" > ");
}

function textContent(value) {
  if (Array.isArray(value)) {
    return value.map(textContent).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    return asText(value["#text"] ?? value.text ?? value.label ?? value.name);
  }
  return asText(value);
}

function sourcePrewriteIdentityBlockers(payload, datasetType) {
  if (datasetType !== "source") return [];
  const root = datasetRoot(payload, "source");
  const info = dataSetInformation(root, "source");
  const shortName = textContent(info?.["common:shortName"] ?? info?.shortName);
  const sourceCitation = textContent(
    info?.sourceCitation ?? info?.["common:sourceCitation"],
  );
  const classification = classificationDisplayForPayload(payload, "source");
  const blockers = [];
  if (/^(ILCD format|Not specified|Not declared|Unspecified)$/iu.test(shortName)) {
    blockers.push({
      code: "source_identity_not_true_source",
      stage: "source_semantics",
      message:
        "Source shortName is a format/compliance/placeholder identity, not a true report, publication, or traceable source record.",
      short_name: shortName,
      source_citation: sourceCitation || null,
      classification: classification || null,
    });
  }
  if (
    /^(ILCD format|Not specified|Not declared|Unspecified)$/iu.test(
      sourceCitation,
    )
  ) {
    blockers.push({
      code: "source_citation_not_true_source",
      stage: "source_semantics",
      message:
        "Source citation is a format/compliance/placeholder identity, not bibliographic or report evidence.",
      short_name: shortName || null,
      source_citation: sourceCitation,
      classification: classification || null,
    });
  }
  if (/\b(Data set formats|Compliance systems)\b/iu.test(classification)) {
    blockers.push({
      code: "source_classification_not_true_source",
      stage: "source_semantics",
      message:
        "Source classification identifies a data format or compliance system. BAFU-owned source rows must be reports, publications, or traceable source records.",
      short_name: shortName || null,
      source_citation: sourceCitation || null,
      classification,
    });
  }
  return blockers;
}

function flowPrewriteIdentityBlockers(payload, datasetType) {
  if (datasetType !== "flow") return [];
  if (!flowUsesElementaryClassification(payload)) return [];
  const root = datasetRoot(payload, "flow");
  const info = dataSetInformation(root, "flow");
  const name = nameTextForPayload(payload, "flow");
  const classification = classificationEntriesForPayload(payload, "flow")
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
  return [
    {
      code: "elementary_flow_write_blocked",
      stage: "flow_identity_reuse_policy",
      message:
        "Elementary flows are reference-only for Foundry imports. Select an existing TianGong database elementary flow and rewrite references instead of writing a BAFU-owned elementary flow.",
      flow_name: name || null,
      flow_type: flowTypeForPayload(payload) || null,
      flow_uuid: asText(info?.["common:UUID"] ?? info?.UUID) || null,
      classification: classification || null,
    },
  ];
}

function prewriteIdentityBlockers(payload, datasetType) {
  return [
    ...sourcePrewriteIdentityBlockers(payload, datasetType),
    ...flowPrewriteIdentityBlockers(payload, datasetType),
  ];
}

function processClassificationClassesAreCanonical(repoRoot, classes) {
  const rawCodes = classes.map(classCode).filter(Boolean);
  const leafCode = rawCodes.at(-1);
  const canonical = processCategoryPathForCode(repoRoot, leafCode);
  if (!leafCode || canonical.length === 0) return false;
  const canonicalPrefix = canonical.slice(0, rawCodes.length);
  if (
    rawCodes.join("/") !== canonicalPrefix.map((entry) => entry.code).join("/")
  ) {
    return false;
  }
  return classes.every((item, index) => {
    const expected = canonicalPrefix[index];
    if (!expected) return false;
    const level = classLevel(item);
    const text = classText(item);
    return (
      (level === null || level === expected.level) &&
      (!text || text === expected.text)
    );
  });
}

function classificationQueueRowStillNeedsAuthoring({
  repoRoot,
  datasetType,
  payload,
  row,
}) {
  const expectedDisplay = comparableText(row?.current_classification);
  if (!expectedDisplay) return true;
  const currentDisplay = comparableText(
    classificationDisplayForPayload(payload, datasetType),
  );
  if (!currentDisplay) return true;
  if (currentDisplay === expectedDisplay) return true;
  if (
    datasetType === "process" &&
    !processClassificationClassesAreCanonical(
      repoRoot,
      classificationClassesForPayload(payload, datasetType),
    )
  ) {
    return true;
  }
  return false;
}

function valueAtDotPath(value, dotPath) {
  const parts = asText(dotPath).split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function locationQueueRowStillNeedsAuthoring({ repoRoot, payload, row }) {
  const targetPath = asText(row?.target_path ?? row?.path);
  if (!targetPath) return true;
  const currentLocation = asText(valueAtDotPath(payload, targetPath));
  if (!currentLocation) return true;
  const queuedLocation = asText(row?.current_location ?? row?.location);
  if (!locationCodeMapForPatch(repoRoot).has(currentLocation)) return true;
  if (queuedLocation && currentLocation === queuedLocation) return true;
  return false;
}

function classificationQueueActionItem(row) {
  const datasetType = asText(row?.dataset_type) || "process";
  const classificationPath =
    datasetType === "flow"
      ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification"
      : "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification";
  return {
    source: "classification_authoring_queue",
    code: asText(row?.code) || "process_classification_requires_authoring",
    path: classificationPath,
    message:
      asText(row?.message) ||
      "Converted classification requires AI authoring before remote write.",
    evidence: {
      current_classification: row?.current_classification ?? null,
      source_classification: row?.source_classification ?? null,
      authoring_context: row?.authoring_context ?? null,
      source_file: row?.source_file ?? null,
      classification_workflow: row?.classification_workflow ?? null,
    },
    instruction:
      asText(row?.required_resolution) ||
      "Use the full schema/YAML/context package and TIDAS classification workflow to choose the target classification. Preserve source classification only as provenance.",
    action_kind: "classification_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed: false,
  };
}

function locationQueueActionItem(row) {
  return {
    source: "location_authoring_queue",
    code: asText(row?.code) || "location_code_requires_authoring",
    path: asText(row?.target_path ?? row?.path) || null,
    message:
      asText(row?.message) ||
      "Location value must be replaced with a valid TIDAS location code before remote write.",
    evidence: {
      current_location: row?.current_location ?? row?.location ?? null,
      target_path: row?.target_path ?? row?.path ?? null,
      location_workflow: row?.location_workflow ?? null,
      source_file: row?.source_file ?? null,
    },
    instruction:
      asText(row?.required_resolution) ||
      "Use the full schema/YAML/context package and TIDAS location classification workflow to choose the target location code.",
    action_kind: "location_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed: false,
  };
}

function collectTextEntries(value, pathName = "") {
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

function nameCarrier(root, datasetType) {
  const info = dataSetInformation(root, datasetType);
  return info?.name && typeof info.name === "object" ? info.name : {};
}

function nameTextForPayload(payload, datasetType) {
  const root = datasetRoot(payload, datasetType);
  return collectTextEntries(nameCarrier(root, datasetType))
    .map((entry) => entry.text)
    .join(" ");
}

function flowTypeForPayload(payload) {
  const root = datasetRoot(payload, "flow");
  return asText(
    root?.modellingAndValidation?.LCIMethod?.typeOfDataSet ??
      root?.modellingAndValidation?.LCIMethodAndAllocation?.typeOfDataSet,
  );
}

function flowUsesElementaryClassification(payload) {
  return /^elementary flow$/iu.test(flowTypeForPayload(payload));
}

function flowUsesProductClassification(payload) {
  const type = flowTypeForPayload(payload);
  return /^product flow$/iu.test(type) || /^waste flow$/iu.test(type);
}

function classificationActionPathForPayload(payload, datasetType) {
  if (datasetType === "flow") {
    return flowUsesElementaryClassification(payload)
      ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:elementaryFlowCategorization"
      : "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification";
  }
  return "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification";
}

function classificationEntriesForPayload(payload, datasetType) {
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

function classificationPathForPayload(payload, datasetType) {
  return classificationEntriesForPayload(payload, datasetType)
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
}

function processExchangeList(payload) {
  const root = datasetRoot(payload, "process");
  return ensureArray(root?.exchanges?.exchange).filter(
    (exchange) => exchange && typeof exchange === "object",
  );
}

function hasFoundryOtherEvidence(value, evidenceKey, acceptedStatuses = []) {
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

function semanticActionItem({
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

function collectTextQualitySemanticActions(payload, datasetType) {
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

function isBafuConvertedDefaultProcessClassification(classificationPath) {
  return /Other service activities\s*>\s*Activities of membership organizations\s*>\s*Activities of other membership organizations\s*>\s*Activities of other membership organizations n\.e\.c\.|Community,\s*social and personal services\s*>\s*Sewage and waste collection,\s*treatment and disposal and other environmental protection services\s*>\s*Other environmental protection services n\.e\.c\./iu.test(
    classificationPath,
  );
}

function collectClassificationSemanticActions(
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

function collectProcessExchangeSemanticActions(payload) {
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

function collectFoundryTraceSemanticActions(payload, datasetType) {
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

function collectFlowReuseSemanticActions(payload, datasetType) {
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

function collectProfileSemanticActionItems({
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

function jsonPointerToken(value) {
  return String(value).replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function dotPathToJsonPointer(value) {
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

function actionItemClosure(item) {
  const code =
    asText(item?.code ?? item?.rule_id ?? item?.ruleId) || "action_item";
  const itemPath = asText(item?.path) || null;
  return {
    code,
    ...(itemPath ? { path: itemPath } : {}),
  };
}

const allowedPatchResolutionModes = new Set([
  "evidence_backed_completion",
  "source_language_normalization",
  "classification_decision",
  "location_decision",
  "exchange_set_repaired",
  "source_trace_verified",
  "deferred_to_common_other",
]);

function actionItemAllowsCommonOtherDeferral(item) {
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

function actionItemResolutionModes(item) {
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

function compactActionItemForAuthoring(item, index) {
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

function markdownList(values, fallback = "- none") {
  const rows = ensureArray(values).filter(
    (value) => value !== undefined && value !== null && value !== "",
  );
  if (rows.length === 0) return fallback;
  return rows.map((value) => `- ${String(value)}`).join("\n");
}

function relOrNull(repoRoot, filePath) {
  return filePath ? repoRelativePath(repoRoot, filePath) : null;
}

function packageContextFileSummary(contextFiles) {
  return ensureArray(contextFiles).map((file) => ({
    kind: asText(file?.kind) || "context",
    path: asText(file?.path) || null,
    sha256: sha256Text(file?.text ?? ""),
    bytes: Buffer.byteLength(String(file?.text ?? ""), "utf8"),
  }));
}

const decisionOnlyActionKinds = new Set([
  "identity_decision_authoring",
  "classification_decision_authoring",
  "location_decision_authoring",
]);

function isPatchAuthoringActionItem(item) {
  if (!item || item.ai_required === false) return false;
  return !decisionOnlyActionKinds.has(asText(item.action_kind));
}

function patchAuthoringActionItems(packagePayload) {
  return ensureArray(packagePayload.action_items)
    .filter(isPatchAuthoringActionItem)
    .map(compactActionItemForAuthoring);
}

function decisionOnlyActionItems(packagePayload) {
  return ensureArray(packagePayload.action_items)
    .filter((item) => item?.ai_required !== false && !isPatchAuthoringActionItem(item))
    .map(compactActionItemForAuthoring);
}

function buildPatchTemplate(packagePayload, packagePath) {
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

function fullContextAiConfigRequiresAuthoring(value) {
  return value?.required === true || value?.required === "true";
}

function requiredFullContextKinds(value) {
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

function requiredFullContextFilePatterns(value) {
  return ensureArray(
    value?.required_context_file_patterns ??
      value?.requiredContextFilePatterns,
  )
    .map((pattern) => asText(pattern))
    .filter(Boolean);
}

function contextSummaryHasNonEmptyPayload(file) {
  if (Number(file?.bytes ?? 0) > 0) return true;
  return Buffer.byteLength(String(file?.text ?? ""), "utf8") > 0;
}

function contextSummaryHasKind(files, kind) {
  return ensureArray(files).some(
    (file) => asText(file?.kind) === kind && contextSummaryHasNonEmptyPayload(file),
  );
}

function contextSummaryHasPattern(files, pattern) {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some(
    (file) =>
      String(file?.path ?? "").toLowerCase().includes(needle) &&
      contextSummaryHasNonEmptyPayload(file),
  );
}

function stableSharedContextBundleSha256(bundle) {
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

function sharedContextBundleReadinessBlockers({
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

function authoringPackageFullContextReadinessBlockers({
  repoRoot,
  packagePayload,
  actionItems,
  packagePath = null,
}) {
  if (ensureArray(actionItems).length === 0) return [];
  const requirement = packagePayload?.full_context_ai_completion;
  if (!fullContextAiConfigRequiresAuthoring(requirement)) return [];
  const blockers = [];
  const authoringPackage = packagePath ? repoRelativePath(repoRoot, packagePath) : null;
  const contractFiles = ensureArray(packagePayload?.contract_context_files);
  for (const missingContext of ensureArray(packagePayload?.missing_context_files)) {
    blockers.push({
      code: "authoring_task_context_file_missing",
      message:
        "AI authoring task cannot start while its authoring package records missing context files.",
      authoring_package: authoringPackage,
      kind: asText(missingContext?.kind) || null,
      path: asText(missingContext?.path) || null,
    });
  }
  for (const file of contractFiles) {
    if (!contextSummaryHasNonEmptyPayload(file)) {
      blockers.push({
        code: "authoring_task_context_file_empty",
        message:
          "AI authoring task cannot start with an empty contract context file.",
        authoring_package: authoringPackage,
        kind: asText(file?.kind) || null,
        path: asText(file?.path) || null,
      });
    }
  }
  for (const kind of requiredFullContextKinds(requirement)) {
    if (!contextSummaryHasKind(contractFiles, kind)) {
      blockers.push({
        code: "authoring_task_required_context_missing",
        message:
          "AI authoring task must include full schema/YAML/ruleset/category/location context before patch authoring.",
        authoring_package: authoringPackage,
        required_kind: kind,
      });
    }
  }
  for (const pattern of requiredFullContextFilePatterns(requirement)) {
    if (!contextSummaryHasPattern(contractFiles, pattern)) {
      blockers.push({
        code: "authoring_task_required_context_file_missing",
        message:
          "AI authoring task must include the required full-context file before patch authoring.",
        authoring_package: authoringPackage,
        required_file_pattern: pattern,
      });
    }
  }
  if (
    !packagePayload?.source_row ||
    typeof packagePayload.source_row !== "object" ||
    Array.isArray(packagePayload.source_row)
  ) {
    blockers.push({
      code: "authoring_task_source_row_payload_missing",
      message:
        "AI authoring task must include the source row payload used as evidence.",
      authoring_package: authoringPackage,
    });
  }
  if (
    !packagePayload?.entity_payload ||
    typeof packagePayload.entity_payload !== "object" ||
    Array.isArray(packagePayload.entity_payload)
  ) {
    blockers.push({
      code: "authoring_task_entity_payload_missing",
      message:
        "AI authoring task must include the converted TIDAS entity payload to patch.",
      authoring_package: authoringPackage,
    });
  }
  return blockers;
}

function authoringTaskFullContextReadinessBlockers({ repoRoot, task }) {
  if (ensureArray(task?.action_items).length === 0) return [];
  const requirement = task?.context?.full_context_ai_completion;
  if (!fullContextAiConfigRequiresAuthoring(requirement)) return [];
  const blockers = [];
  const contractFiles = ensureArray(task?.context?.contract_context_files);
  blockers.push(
    ...sharedContextBundleReadinessBlockers({
      repoRoot,
      sharedContextBundle: task?.context?.shared_context_bundle,
      sourceKind: "task",
      sourcePath: task?.files?.task_json,
    }),
  );
  for (const missingContext of ensureArray(task?.context?.missing_context_files)) {
    blockers.push({
      code: "authoring_task_context_file_missing",
      message:
        "AI patch collect cannot accept a task whose context files were missing at authoring time.",
      kind: asText(missingContext?.kind) || null,
      path: asText(missingContext?.path) || null,
    });
  }
  for (const kind of requiredFullContextKinds(requirement)) {
    if (!contextSummaryHasKind(contractFiles, kind)) {
      blockers.push({
        code: "authoring_task_required_context_missing",
        message:
          "AI patch collect requires the authoring task to carry full schema/YAML/ruleset/category/location context.",
        required_kind: kind,
      });
    }
  }
  for (const pattern of requiredFullContextFilePatterns(requirement)) {
    if (!contextSummaryHasPattern(contractFiles, pattern)) {
      blockers.push({
        code: "authoring_task_required_context_file_missing",
        message:
          "AI patch collect requires the authoring task to carry every required full-context file.",
        required_file_pattern: pattern,
      });
    }
  }
  const packagePath = resolveRepoPath(repoRoot, task?.files?.authoring_package);
  if (!packagePath || !fileExists(packagePath)) {
    blockers.push({
      code: "authoring_task_authoring_package_missing",
      message:
        "AI patch collect cannot verify full-context readiness without the authoring package.",
      authoring_package: task?.files?.authoring_package ?? null,
    });
    return blockers;
  }
  try {
    const packagePayload = readJson(packagePath);
    blockers.push(
      ...authoringPackageFullContextReadinessBlockers({
        repoRoot,
        packagePayload,
        actionItems: task.action_items,
        packagePath,
      }),
    );
  } catch (error) {
    blockers.push({
      code: "authoring_task_authoring_package_invalid",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: task?.files?.authoring_package ?? null,
    });
  }
  return blockers;
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replace(/'/gu, `'\\''`)}'`;
}

function renderAuthoringTaskMarkdown(task) {
  const actionItems = task.action_items.map((item) => {
    const lines = [
      `- [${item.index}] ${item.code}`,
      `  - path: ${item.path ?? "(AI must choose path)"}`,
      `  - json_pointer: ${item.json_pointer}`,
      `  - message: ${item.message ?? "(none)"}`,
    ];
    if (item.instruction) lines.push(`  - instruction: ${item.instruction}`);
    if (ensureArray(item.allowed_resolution_modes).length > 0) {
      lines.push(
        `  - allowed_resolution_modes: ${item.allowed_resolution_modes.join(", ")}`,
      );
    }
    if (item.evidence !== null && item.evidence !== undefined) {
      lines.push(`  - evidence: ${JSON.stringify(item.evidence)}`);
    }
    return lines.join("\n");
  });
  const contextFiles = [
    ...task.context.profile_context_files,
    ...task.context.contract_context_files,
  ].map(
    (file) =>
      `${file.kind}: ${file.path} (${file.bytes} bytes, sha256=${file.sha256})`,
  );
  const sharedContextBundle = task.context?.shared_context_bundle;
  const sharedContextLines = sharedContextBundle
    ? [
        `- shared context bundle: ${sharedContextBundle.path} (sha256=${sharedContextBundle.sha256})`,
        `- shared context files: ${sharedContextBundle.counts?.files ?? "(unknown)"}`,
        `- duplicate context bytes avoided: ${sharedContextBundle.counts?.duplicate_context_bytes_avoided ?? 0}`,
      ]
    : [];
  const sharedContextInstruction = sharedContextBundle
    ? "\nIf a shared context bundle is listed above, read it once for the batch-level full schema/YAML/ruleset/category/location text. Still read the entity authoring package for source row, entity payload, action items, support rows, queue/dependency closure, and hash-bound proof. Do not treat the shared bundle as a replacement for package lineage or action-item evidence.\n"
    : "";

  return `# Foundry AI Authoring Task

Status: ${task.status}

## Entity

- type: ${task.entity.dataset_type}
- id: ${task.entity.entity_id}
- version: ${task.entity.version}
- profile: ${task.entity.profile}

## Required Inputs

- authoring package: ${task.files.authoring_package}
- source rows file: ${task.context.source_rows_file ?? "(not recorded)"}
- patch template: ${task.files.patch_template}
- output patch file: ${task.files.output_patch_file}
${sharedContextLines.length > 0 ? sharedContextLines.join("\n") : ""}

Read the full authoring package before writing the patch. It contains the converted row, source row, schema issues, QA findings, profile constraints, queue/dependency closure, support rows, bundled TIDAS taxonomy/location schemas, and full contract context text when supplied by the SDK/CLI.
${sharedContextInstruction}

## Context Files

${markdownList(contextFiles)}

## Action Items

${actionItems.length > 0 ? actionItems.join("\n") : "- none"}

## Output Contract

Write a structured patch JSON to:

\`${task.files.output_patch_file}\`

The patch must:

- target this dataset id/version or row_index
- keep \`authoring_package\` set to the package filename
- treat template paths as suggestions and fix JSON Pointers against the actual authoring package row
- provide \`basis\` or \`evidence\` for every non-test operation
- for full-context tasks, provide both \`basis\` and structured \`evidence\` with a source/context identifier plus \`quote_or_trace\`, source path, field path, citation, or equivalent pointer
- provide \`resolution.mode\` for every non-test operation; use one of the action item's allowed modes
- include \`resolution.used_context_kinds\` with every full-context kind required by the task, normally \`schema\`, \`methodology_yaml\`, \`ruleset\`, \`classification_schema\`, and \`location_schema\`
- close every AI-required action item with \`closes_action_items\`
- for full-context import profiles, every non-test operation must include \`closes_action_items\`; supporting cleanup operations should close the same action item they are needed to resolve
- avoid database writes, direct Supabase calls, or hand-edited row files
- preserve source-language content; do not add extra language variants unless the source evidence supports them
- do not use \`common:other\` as a substitute for mandatory schema fields; schema-required values need evidence-backed values or must remain blocked
- if a value cannot be inferred safely and the action item's allowed modes include \`deferred_to_common_other\`, add \`common:other.tiangongfoundry:unresolvedTrace\` with \`status\`, \`action_item_code\`, \`blocked_path\`, \`reason\`, structured \`evidence\`, and \`next_action\`; evidence must include source plus quote/trace/path/citation pointer
- do not defer \`annualSupplyOrProductionVolume\` to \`common:other\`; if source annual volume evidence is missing, Foundry deterministic cleanup writes \`${annualSupplyMissingDataSentinelText}\` into the required field for later database-side curation
- if source exchange completeness is being accepted as source-faithful, use \`resolution.mode=source_trace_verified\` and add \`common:other.tiangongfoundry:sourceExchangeCompleteness\` with accepted \`status\` and structured source trace evidence; evidence must include source plus quote/trace/path/citation pointer

## Deterministic Apply

\`\`\`bash
${task.commands.apply_patch}
\`\`\`

After apply, rerun SDK validation, deterministic QA where relevant, Foundry cleanup, dry-run publish/save, mutation manifest, explicit commit, and post-commit \`dataset verify-remote --compare-root-payload\`.
`;
}

function buildDatasetAuthoringTaskFromPackage({
  repoRoot,
  packagePath,
  outDir,
  options = {},
}) {
  if (!packagePath || !fileExists(packagePath)) {
    throw new Error(
      "--authoring-package is required and must point to a Foundry AI authoring package JSON file.",
    );
  }

  const packagePayload = readJson(packagePath);
  const datasetType = asText(packagePayload.dataset_type);
  if (!supportedDatasetTypes.has(datasetType)) {
    throw new Error(
      `Authoring package dataset_type must be one of ${[...supportedDatasetTypes].join(", ")}.`,
    );
  }
  const entityId = asText(
    packagePayload.entity_id ?? packagePayload.process_id,
  );
  if (!entityId) {
    throw new Error("Authoring package is missing entity_id.");
  }

  const patchFile = resolveRepoPath(
    repoRoot,
    options.patchFile || options.patch || path.join(outDir, "ai-patches.json"),
  );
  const patchTemplateFile = path.join(outDir, "patch-template.json");
  const taskFile = path.join(outDir, "ai-authoring-task.json");
  const markdownFile = path.join(outDir, "ai-authoring-task.md");
  const patchedRowsFile = resolveRepoPath(
    repoRoot,
    options.patchedRows ||
      options.out ||
      path.join(outDir, `${datasetTypePlural[datasetType]}.patched.jsonl`),
  );
  const applyDir = resolveRepoPath(
    repoRoot,
    options.applyDir || path.join(outDir, "patch-apply"),
  );
  const packageDir = path.dirname(packagePath);
  const actionItems = patchAuthoringActionItems(packagePayload);
  const decisionOnlyItems = decisionOnlyActionItems(packagePayload);
  const contextBlockers = authoringPackageFullContextReadinessBlockers({
    repoRoot,
    packagePayload,
    actionItems,
    packagePath,
  });
  const patchTemplate = buildPatchTemplate(packagePayload, packagePath);
  const sourceRowsFile = packagePayload.source_rows_file
    ? repoRelativePath(
        repoRoot,
        resolveRepoPath(repoRoot, packagePayload.source_rows_file),
      )
    : null;
  const applyArgs = [
    "node",
    "scripts/foundry.mjs",
    "dataset-patch-apply",
    "--input",
    sourceRowsFile ?? "<source-rows.jsonl>",
    "--patch",
    relOrNull(repoRoot, patchFile),
    "--out",
    relOrNull(repoRoot, patchedRowsFile),
    "--out-dir",
    relOrNull(repoRoot, applyDir),
    "--authoring-package-dir",
    relOrNull(repoRoot, packageDir),
    "--require-authoring-package",
    "--require-action-item-closure",
  ];
  const task = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status:
      actionItems.length > 0 && contextBlockers.length > 0
        ? "blocked_missing_full_context"
        : actionItems.length > 0
          ? "ready_for_ai_authoring"
          : "ready_no_action_items",
    purpose:
      "Use Codex/skill semantic judgment to turn one Foundry AI authoring package into a strict structured patch. Deterministic CLI apply and validation remain separate gates.",
    entity: {
      dataset_type: datasetType,
      entity_id: entityId,
      version: asText(packagePayload.version) || "00.00.001",
      profile: asText(packagePayload.profile) || null,
    },
    context: {
      source_rows_file: sourceRowsFile,
      authoring_package_sha256: sha256Text(readText(packagePath)),
      profile_context_files: packageContextFileSummary(
        packagePayload.profile_context_files,
      ),
      contract_context_files: packageContextFileSummary(
        packagePayload.contract_context_files,
      ),
      full_context_ai_completion: packagePayload.full_context_ai_completion ?? {
        required: false,
      },
      missing_context_files: ensureArray(packagePayload.missing_context_files),
      curation_queue_status:
        packagePayload.curation_queue_context?.status ?? null,
    },
    action_items: actionItems,
    decision_only_action_items: decisionOnlyItems,
    blockers: contextBlockers,
    counts: {
      action_items: actionItems.length,
      decision_only_action_items: decisionOnlyItems.length,
      blockers: contextBlockers.length,
    },
    policy: {
      database_write: "forbidden_in_ai_authoring_task",
      ai_output: "structured_patch_json_only",
      decision_only_action_items:
        "Identity, classification, and location action items are not patchable here; resolve them with the dedicated deterministic decision apply commands.",
      unresolved_trace:
        "If a value cannot be inferred safely and the action item allows deferral, record structured tiangongfoundry:unresolvedTrace under common:other. Mandatory schema fields need evidence-backed values or remain blocked.",
      source_language:
        "Preserve source-language content. Do not require bilingual fields or add language variants unless source evidence supports them.",
    },
    files: {
      authoring_package: repoRelativePath(repoRoot, packagePath),
      task_json: repoRelativePath(repoRoot, taskFile),
      task_markdown: repoRelativePath(repoRoot, markdownFile),
      patch_template: repoRelativePath(repoRoot, patchTemplateFile),
      output_patch_file: repoRelativePath(repoRoot, patchFile),
      patched_rows: repoRelativePath(repoRoot, patchedRowsFile),
      apply_dir: repoRelativePath(repoRoot, applyDir),
    },
    commands: {
      apply_patch: applyArgs.map(shellQuote).join(" "),
      validate_after_apply: `tiangong-lca dataset validate --type ${datasetType} --input ${shellQuote(repoRelativePath(repoRoot, patchedRowsFile))} --out-dir ${shellQuote(path.join(repoRelativePath(repoRoot, outDir), "dataset-validate"))}`,
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  writeJson(patchTemplateFile, patchTemplate);
  writeJson(taskFile, task);
  writeText(markdownFile, renderAuthoringTaskMarkdown(task));
  return {
    ...task,
    files: task.files,
  };
}

function shouldBuildAuthoringTaskFromEntity(entity, includeReady) {
  if (includeReady) return true;
  const actionItemCount = Number(
    entity?.action_item_count ?? entity?.actionItemCount ?? 0,
  );
  if (actionItemCount > 0) return true;
  return String(entity?.status ?? "").includes("needs_foundry_ai_authoring");
}

function authoringPackageEntriesFromGate(repoRoot, reportPath, includeReady) {
  const report = readJson(reportPath);
  const entities = ensureArray(
    report?.entities ?? report?.processes ?? report?.flows ?? report?.items,
  );
  return entities
    .filter((entity) =>
      shouldBuildAuthoringTaskFromEntity(entity, includeReady),
    )
    .map((entity, index) => {
      const packageRef = asText(
        entity?.authoring_package ?? entity?.authoringPackage,
      );
      const packagePath = resolveRepoPath(repoRoot, packageRef);
      const datasetType =
        asText(entity?.dataset_type ?? entity?.type) || "dataset";
      const entityId =
        asText(entity?.entity_id ?? entity?.process_id ?? entity?.id) ||
        `entity-${index + 1}`;
      return {
        index,
        entity,
        package_ref: packageRef || null,
        package_path: packagePath,
        task_dir_name: `${sanitizeFileName(datasetType)}-${sanitizeFileName(entityId)}`,
      };
    });
}

function buildSharedAuthoringContextBundle(
  repoRoot,
  outDir,
  tasks,
  source,
  options = {},
) {
  const fileMap = new Map();
  const references = [];
  for (const task of tasks) {
    const packageRef = task.files?.authoring_package;
    const packagePath = resolveRepoPath(repoRoot, packageRef);
    if (!packagePath || !fileExists(packagePath)) continue;
    let packagePayload = null;
    try {
      packagePayload = readJson(packagePath);
    } catch {
      continue;
    }
    for (const [scope, contextFiles] of [
      ["profile_context_files", packagePayload.profile_context_files],
      ["contract_context_files", packagePayload.contract_context_files],
    ]) {
      for (const contextFile of ensureArray(contextFiles)) {
        const text = String(contextFile?.text ?? "");
        const sha256 = asText(contextFile?.sha256) || sha256Text(text);
        const bytes =
          Number(contextFile?.bytes) || Buffer.byteLength(text, "utf8");
        const kind = asText(contextFile?.kind) || "context";
        const contextPath = asText(contextFile?.path) || null;
        const key = JSON.stringify([scope, kind, contextPath, sha256]);
        if (!fileMap.has(key)) {
          fileMap.set(key, {
            scope,
            kind,
            path: contextPath,
            sha256,
            bytes,
            text,
          });
        }
        references.push({
          authoring_package: packageRef,
          dataset_type: task.entity?.dataset_type ?? null,
          entity_id: task.entity?.entity_id ?? null,
          dataset_version: task.entity?.version ?? null,
          scope,
          kind,
          path: contextPath,
          sha256,
          bytes,
        });
      }
    }
  }
  const files = [...fileMap.values()];
  const uniqueBytes = files.reduce(
    (total, file) => total + (Number(file.bytes) || 0),
    0,
  );
  const referenceBytes = references.reduce(
    (total, ref) => total + (Number(ref.bytes) || 0),
    0,
  );
  const stablePayload = {
    schema_version: 1,
    kind: "tiangong_foundry_shared_authoring_context_bundle",
    source,
    counts: {
      tasks: tasks.length,
      authoring_packages: unique(
        tasks.map((task) => task.files?.authoring_package).filter(Boolean),
      ).length,
      files: files.length,
      references: references.length,
      duplicate_references: Math.max(0, references.length - files.length),
      unique_context_bytes: uniqueBytes,
      referenced_context_bytes: referenceBytes,
      duplicate_context_bytes_avoided: Math.max(0, referenceBytes - uniqueBytes),
    },
    files,
    references,
  };
  const bundle = {
    ...stablePayload,
    generated_at_utc: nowIso(),
    hash_scope:
      "schema_version, kind, source, counts, files, and references; generated_at_utc is excluded so identical batch context keeps a stable hash.",
    sha256: sha256Text(JSON.stringify(stablePayload)),
  };
  const cacheDir = options.sharedContextCacheDir
    ? resolveRepoPath(repoRoot, options.sharedContextCacheDir)
    : null;
  const bundlePath = cacheDir
    ? path.join(cacheDir, `authoring.${bundle.sha256}.json`)
    : path.join(outDir, "shared-context-bundle.json");
  let cacheReused = false;
  if (cacheDir && fileExists(bundlePath)) {
    try {
      cacheReused = readJson(bundlePath)?.sha256 === bundle.sha256;
    } catch {
      cacheReused = false;
    }
  }
  if (!cacheReused) writeJson(bundlePath, bundle);
  return {
    path: bundlePath,
    bundle,
    cache: cacheDir
      ? {
          enabled: true,
          dir: repoRelativePath(repoRoot, cacheDir),
          reused: cacheReused,
        }
      : {
          enabled: false,
          reused: false,
        },
  };
}

function attachSharedContextBundleToTask(task, sharedContextBundle) {
  return {
    ...task,
    context: {
      ...task.context,
      shared_context_bundle: sharedContextBundle,
    },
  };
}

function rewriteAuthoringTaskFile(repoRoot, task) {
  const taskFile = resolveRepoPath(repoRoot, task?.files?.task_json);
  const markdownFile = resolveRepoPath(repoRoot, task?.files?.task_markdown);
  if (taskFile) writeJson(taskFile, task);
  if (markdownFile) writeText(markdownFile, renderAuthoringTaskMarkdown(task));
}

function writeAuthoringTaskBatchManifest(
  repoRoot,
  outDir,
  tasks,
  source,
  options = {},
) {
  const manifestPath = path.join(outDir, "authoring-task-manifest.json");
  const tasksPath = path.join(outDir, "authoring-tasks.jsonl");
  const batchPatchFile = path.join(outDir, "ai-patches.batch.json");
  const datasetTypes = [
    ...new Set(tasks.map((task) => task.entity.dataset_type).filter(Boolean)),
  ];
  const sourceRowsFiles = [
    ...new Set(
      tasks.map((task) => task.context.source_rows_file).filter(Boolean),
    ),
  ];
  const packageDirs = [
    ...new Set(
      tasks
        .map((task) => resolveRepoPath(repoRoot, task.files.authoring_package))
        .filter(Boolean)
        .map((filePath) => repoRelativePath(repoRoot, path.dirname(filePath))),
    ),
  ];
  const totalActionItems = tasks.reduce(
    (total, task) => total + ensureArray(task.action_items).length,
    0,
  );
  const totalDecisionOnlyActionItems = tasks.reduce(
    (total, task) =>
      total + ensureArray(task.decision_only_action_items).length,
    0,
  );
  const canApplyBatch =
    totalActionItems > 0 &&
    datasetTypes.length === 1 &&
    sourceRowsFiles.length === 1 &&
    packageDirs.length === 1;
  const batchPatchedRows = path.join(
    outDir,
    `${datasetTypePlural[datasetTypes[0]] ?? "datasets"}.patched.jsonl`,
  );
  const batchApplyDir = path.join(outDir, "patch-apply");
  const applyBatchArgs = canApplyBatch
    ? [
        "node",
        "scripts/foundry.mjs",
        "dataset-patch-apply",
        "--input",
        sourceRowsFiles[0],
        "--patch",
        repoRelativePath(repoRoot, batchPatchFile),
        "--out",
        repoRelativePath(repoRoot, batchPatchedRows),
        "--out-dir",
        repoRelativePath(repoRoot, batchApplyDir),
        "--authoring-package-dir",
        packageDirs[0],
        "--require-authoring-package",
        "--require-action-item-closure",
      ]
    : [];
  const blockedTasks = tasks.filter(
    (task) => task.status === "blocked_missing_full_context",
  );
  const taskBlockers = tasks.flatMap((task, taskIndex) =>
    task.status === "blocked_missing_full_context"
      ? ensureArray(task.blockers).map((blocker) => ({
          ...blocker,
          task_index: taskIndex,
          entity: task.entity,
        }))
      : [],
  );
  fs.mkdirSync(outDir, { recursive: true });
  const sharedContext = buildSharedAuthoringContextBundle(
    repoRoot,
    outDir,
    tasks,
    source,
    options,
  );
  const sharedContextBundleRef = {
    path: repoRelativePath(repoRoot, sharedContext.path),
    sha256: sharedContext.bundle.sha256,
    counts: sharedContext.bundle.counts,
    cache: sharedContext.cache,
    instruction:
      "Read this shared bundle once per batch for full schema/YAML/ruleset/category/location context; per-entity authoring packages still carry source/entity/action evidence and remain the hash-bound proof records.",
  };
  const tasksWithSharedContext = tasks.map((task) =>
    attachSharedContextBundleToTask(task, sharedContextBundleRef),
  );
  for (const task of tasksWithSharedContext) {
    rewriteAuthoringTaskFile(repoRoot, task);
  }
  const manifest = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status:
      blockedTasks.length > 0
        ? "blocked_missing_full_context"
        : tasks.some((task) => task.status === "ready_for_ai_authoring")
          ? "ready_for_ai_authoring_batch"
          : "ready_no_action_items",
    source,
    counts: {
      tasks: tasks.length,
      ready_for_ai_authoring: tasks.filter(
        (task) => task.status === "ready_for_ai_authoring",
      ).length,
      ready_no_action_items: tasks.filter(
        (task) => task.status === "ready_no_action_items",
      ).length,
      blocked_missing_full_context: blockedTasks.length,
      action_items: totalActionItems,
      decision_only_action_items: totalDecisionOnlyActionItems,
      blockers: taskBlockers.length,
      shared_context_files: sharedContext.bundle.counts.files,
      shared_context_references: sharedContext.bundle.counts.references,
      duplicate_context_references:
        sharedContext.bundle.counts.duplicate_references,
      duplicate_context_bytes_avoided:
        sharedContext.bundle.counts.duplicate_context_bytes_avoided,
    },
    blockers: taskBlockers,
    batch_patch_contract: {
      status:
        totalActionItems === 0
          ? "not_required_no_patch_action_items"
          : canApplyBatch
            ? "available"
            : "not_available_mixed_inputs",
      output_patch_file: canApplyBatch
        ? repoRelativePath(repoRoot, batchPatchFile)
        : null,
      patched_rows: canApplyBatch
        ? repoRelativePath(repoRoot, batchPatchedRows)
        : null,
      apply_dir: canApplyBatch
        ? repoRelativePath(repoRoot, batchApplyDir)
        : null,
      instruction:
        totalActionItems === 0
          ? "No patch batch is required; resolve decision_only_action_items with the dedicated deterministic decision apply commands."
          : "AI/Codex may combine all per-task patch sets into this batch file, then run apply_all_patches once to produce one patched rows file.",
    },
    commands: {
      apply_all_patches: canApplyBatch
        ? applyBatchArgs.map(shellQuote).join(" ")
        : null,
    },
    shared_context_bundle: sharedContextBundleRef,
    tasks: tasksWithSharedContext.map((task) => ({
      status: task.status,
      entity: task.entity,
      context: task.context,
      action_item_count: ensureArray(task.action_items).length,
      action_items: task.action_items,
      decision_only_action_item_count: ensureArray(
        task.decision_only_action_items,
      ).length,
      decision_only_action_items: task.decision_only_action_items,
      blockers: ensureArray(task.blockers),
      files: task.files,
      commands: task.commands,
    })),
  };
  writeJson(manifestPath, manifest);
  writeText(tasksPath, jsonLines(manifest.tasks));
  return {
    ...manifest,
    files: {
      manifest: repoRelativePath(repoRoot, manifestPath),
      tasks: repoRelativePath(repoRoot, tasksPath),
      shared_context_bundle: repoRelativePath(repoRoot, sharedContext.path),
    },
  };
}

function patchSetOperations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const operations = Array.isArray(value.operations)
    ? value.operations
    : Array.isArray(value.patches)
      ? value.patches
      : null;
  if (
    !operations ||
    !operations.every((operation) => operation && typeof operation === "object")
  ) {
    return null;
  }
  return operations;
}

function patchPayloadPatchSets(rawPatch) {
  if (Array.isArray(rawPatch)) return rawPatch;
  if (!rawPatch || typeof rawPatch !== "object") return [];
  if (patchSetOperations(rawPatch)) return [rawPatch];
  for (const key of [
    "patch_sets",
    "patchSets",
    "patches",
    "suggestions",
    "items",
  ]) {
    if (Array.isArray(rawPatch[key])) return rawPatch[key];
  }
  return [];
}

function patchSetDatasetId(patchSet) {
  return asText(
    patchSet?.dataset_id ??
      patchSet?.id ??
      patchSet?.uuid ??
      patchSet?.entity_id,
  );
}

function patchSetDatasetVersion(patchSet) {
  return asText(patchSet?.dataset_version ?? patchSet?.version) || "00.00.001";
}

function patchSetAuthoringPackage(patchSet) {
  return asText(patchSet?.authoring_package ?? patchSet?.authoringPackage);
}

function operationHasEvidence(operation) {
  const basis = asText(operation?.basis);
  const evidence = operation?.evidence;
  if (basis) return true;
  if (typeof evidence === "string") return evidence.trim().length > 0;
  if (Array.isArray(evidence)) return evidence.length > 0;
  if (evidence && typeof evidence === "object")
    return Object.keys(evidence).length > 0;
  return false;
}

function taskRequiresFullContextEvidence(task) {
  return (
    task?.context?.full_context_ai_completion?.required === true ||
    task?.context?.fullContextAiCompletion?.required === true
  );
}

function evidenceEntries(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function firstNonEmptyEvidenceValue(entry, keys) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  for (const key of keys) {
    const value = asText(entry[key]);
    if (value) return value;
  }
  return "";
}

const evidenceSourceKeys = [
  "source",
  "source_id",
  "sourceId",
  "source_file",
  "sourceFile",
  "context_kind",
  "contextKind",
  "citation",
  "cited_source",
  "citedSource",
  "provenance",
];

const evidenceTraceKeys = [
  "quote_or_trace",
  "quoteOrTrace",
  "quote",
  "trace",
  "source_trace",
  "sourceTrace",
  "source_path",
  "sourcePath",
  "source_field",
  "sourceField",
  "field_path",
  "fieldPath",
  "json_pointer",
  "jsonPointer",
  "path",
  "evidence_path",
  "evidencePath",
  "pointer",
  "note",
  "excerpt",
];

function operationFullContextEvidenceBlockers({ operation, task }) {
  if (!taskRequiresFullContextEvidence(task)) return [];
  const blockers = [];
  if (!asText(operation?.basis)) {
    blockers.push({
      code: "patch_basis_required_full_context",
      message:
        "Full-context AI patch operations must include basis explaining why the value follows from the package/context.",
    });
  }
  const structuredEntries = evidenceEntries(operation?.evidence).filter(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
  );
  if (structuredEntries.length === 0) {
    blockers.push({
      code: "patch_structured_evidence_required_full_context",
      message:
        "Full-context AI patch operations must include structured evidence, not only a free-text basis.",
    });
    return blockers;
  }
  const hasEvidencePointer = structuredEntries.some(
    (entry) =>
      firstNonEmptyEvidenceValue(entry, evidenceSourceKeys) &&
      firstNonEmptyEvidenceValue(entry, evidenceTraceKeys),
  );
  if (!hasEvidencePointer) {
    blockers.push({
      code: "patch_structured_evidence_incomplete_full_context",
      message:
        "Full-context AI patch evidence must include both a source/context identifier and a quote, trace, field path, citation, or equivalent pointer.",
    });
  }
  return blockers;
}

function operationResolution(operation) {
  return operation?.resolution &&
    typeof operation.resolution === "object" &&
    !Array.isArray(operation.resolution)
    ? operation.resolution
    : null;
}

function operationResolutionMode(operation) {
  return asText(operationResolution(operation)?.mode);
}

function operationUsedContextKinds(operation) {
  return ensureArray(
    operationResolution(operation)?.used_context_kinds ??
      operationResolution(operation)?.usedContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
}

function taskRequiredContextKinds(task) {
  const kinds = new Set(
    ensureArray(task?.context?.contract_context_files)
      .map((file) => asText(file?.kind))
      .filter(Boolean),
  );
  const requiredKinds = ensureArray(
    task?.context?.full_context_ai_completion?.required_context_kinds ??
      task?.context?.fullContextAiCompletion?.requiredContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
  const candidates =
    requiredKinds.length > 0
      ? requiredKinds
      : [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ];
  return candidates.filter(
    (kind) => kinds.has(kind) || requiredKinds.includes(kind),
  );
}

function operationTouchesCommonOther(operation) {
  const pointer = asText(operation?.path);
  if (
    pointer.includes("/common:other") ||
    pointer.includes("/tiangongfoundry:")
  )
    return true;
  return (
    JSON.stringify(operation?.value ?? "").includes("common:other") ||
    JSON.stringify(operation?.value ?? "").includes("tiangongfoundry:")
  );
}

function hasNonEmptyTraceEvidence(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value))
    return value.some((item) => hasNonEmptyTraceEvidence(item));
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function hasStructuredTraceEvidence(value) {
  return evidenceEntries(value)
    .filter(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
    )
    .some(
      (entry) =>
        firstNonEmptyEvidenceValue(entry, evidenceSourceKeys) &&
        firstNonEmptyEvidenceValue(entry, evidenceTraceKeys),
    );
}

function objectTraceEntries(value, traceKey) {
  const entries = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (Object.hasOwn(node, traceKey)) {
      entries.push(...ensureArray(node[traceKey]));
    }
    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      if (Object.hasOwn(commonOther, traceKey)) {
        entries.push(...ensureArray(commonOther[traceKey]));
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return entries;
}

function operationTraceEntries(operation, traceKey) {
  const pointer = asText(operation?.path);
  const value = operation?.value;
  if (pointer.includes(`/${traceKey}`)) return ensureArray(value);
  if (pointer.includes("/common:other"))
    return objectTraceEntries(value, traceKey);
  return objectTraceEntries(value, traceKey);
}

function validateDeferredCommonOtherTrace({ operation, actionItems }) {
  const traceEntries = operationTraceEntries(
    operation,
    "tiangongfoundry:unresolvedTrace",
  );
  const closureCodes = new Set(operationClosureCodes(operation));
  const actionCodes = new Set(
    ensureArray(actionItems)
      .map((item) => asText(item?.code ?? item?.rule_id ?? item?.ruleId))
      .filter(Boolean),
  );
  const acceptedCodes = closureCodes.size > 0 ? closureCodes : actionCodes;
  const blockers = [];
  if (traceEntries.length === 0) {
    blockers.push({
      code: "patch_deferred_trace_missing",
      message:
        "resolution.mode=deferred_to_common_other must add tiangongfoundry:unresolvedTrace under common:other.",
    });
    return blockers;
  }
  const closureCodesOnly = new Set([...closureCodes].filter(Boolean));
  const tracedActionCodes = new Set(
    traceEntries
      .map((entry) =>
        asText(entry?.action_item_code ?? entry?.actionItemCode ?? entry?.code),
      )
      .filter(Boolean),
  );
  for (const closureCode of closureCodesOnly) {
    if (!tracedActionCodes.has(closureCode)) {
      blockers.push({
        code: "patch_deferred_trace_action_item_untraced",
        message:
          "Each action item closed by a deferred_to_common_other operation must have a matching tiangongfoundry:unresolvedTrace.action_item_code entry.",
        action_item_code: closureCode,
      });
    }
  }
  traceEntries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      blockers.push({
        code: "patch_deferred_trace_invalid",
        message:
          "tiangongfoundry:unresolvedTrace entries must be JSON objects.",
        trace_index: index,
      });
      return;
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
    if (
      ![
        "unresolved_deferred",
        "deferred_to_common_other",
        "needs_followup",
      ].includes(status)
    ) {
      blockers.push({
        code: "patch_deferred_trace_status_invalid",
        message:
          "tiangongfoundry:unresolvedTrace.status must be unresolved_deferred, deferred_to_common_other, or needs_followup.",
        trace_index: index,
      });
    }
    if (
      !actionCode ||
      (acceptedCodes.size > 0 && !acceptedCodes.has(actionCode))
    ) {
      blockers.push({
        code: "patch_deferred_trace_action_item_missing",
        message:
          "tiangongfoundry:unresolvedTrace must identify the deferred action item code closed by this operation.",
        trace_index: index,
      });
    }
    if (!blockedPath) {
      blockers.push({
        code: "patch_deferred_trace_path_missing",
        message:
          "tiangongfoundry:unresolvedTrace must record the blocked field/path.",
        trace_index: index,
      });
    }
    if (!reason) {
      blockers.push({
        code: "patch_deferred_trace_reason_missing",
        message:
          "tiangongfoundry:unresolvedTrace must record why the value could not be safely inferred.",
        trace_index: index,
      });
    }
    const evidence =
      entry.evidence ?? entry.source_evidence ?? entry.sourceEvidence;
    if (!hasNonEmptyTraceEvidence(evidence)) {
      blockers.push({
        code: "patch_deferred_trace_evidence_missing",
        message:
          "tiangongfoundry:unresolvedTrace must preserve source/context evidence for later database-side repair.",
        trace_index: index,
      });
    } else if (!hasStructuredTraceEvidence(evidence)) {
      blockers.push({
        code: "patch_deferred_trace_evidence_incomplete",
        message:
          "tiangongfoundry:unresolvedTrace evidence must include both a source/context identifier and a quote, trace, field path, citation, or equivalent pointer.",
        trace_index: index,
      });
    }
    if (!nextAction) {
      blockers.push({
        code: "patch_deferred_trace_next_action_missing",
        message:
          "tiangongfoundry:unresolvedTrace must record a concrete next_action/follow_up.",
        trace_index: index,
      });
    }
  });
  return blockers;
}

function validateSourceExchangeCompletenessTrace(operation) {
  const traceEntries = operationTraceEntries(
    operation,
    "tiangongfoundry:sourceExchangeCompleteness",
  );
  const blockers = [];
  if (traceEntries.length === 0) {
    blockers.push({
      code: "patch_source_exchange_trace_missing",
      message:
        "resolution.mode=source_trace_verified must add tiangongfoundry:sourceExchangeCompleteness under common:other.",
    });
    return blockers;
  }
  traceEntries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      blockers.push({
        code: "patch_source_exchange_trace_invalid",
        message:
          "tiangongfoundry:sourceExchangeCompleteness entries must be JSON objects.",
        trace_index: index,
      });
      return;
    }
    const status = asText(
      entry.status ?? entry.decision_status ?? entry.decisionStatus,
    );
    if (
      ![
        "source_only_output_exchange_verified",
        "accepted_source_only_output",
        "verified",
      ].includes(status)
    ) {
      blockers.push({
        code: "patch_source_exchange_trace_status_invalid",
        message:
          "tiangongfoundry:sourceExchangeCompleteness.status must prove source-only-output verification.",
        trace_index: index,
      });
    }
    const evidence =
      entry.evidence ??
      entry.source_evidence ??
      entry.sourceEvidence ??
      entry.trace;
    if (!hasNonEmptyTraceEvidence(evidence)) {
      blockers.push({
        code: "patch_source_exchange_trace_evidence_missing",
        message:
          "tiangongfoundry:sourceExchangeCompleteness must include source trace evidence used for verification.",
        trace_index: index,
      });
    } else if (!hasStructuredTraceEvidence(evidence)) {
      blockers.push({
        code: "patch_source_exchange_trace_evidence_incomplete",
        message:
          "tiangongfoundry:sourceExchangeCompleteness evidence must include both a source/context identifier and a quote, trace, field path, citation, or equivalent pointer.",
        trace_index: index,
      });
    }
  });
  return blockers;
}

function operationClosureCodes(operation) {
  return operationClosureKeys(operation)
    .map((key) => key.split("\u0000")[0])
    .filter(Boolean);
}

function containsAiTemplatePlaceholder(value) {
  if (typeof value === "string") {
    return /__AI_FILL_[A-Z0-9_]*__|\/__AI_FILL_JSON_POINTER__/u.test(value);
  }
  if (Array.isArray(value))
    return value.some((item) => containsAiTemplatePlaceholder(item));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) =>
      containsAiTemplatePlaceholder(item),
    );
  }
  return false;
}

function operationClosureKeys(operation) {
  const raw =
    operation?.closes ??
    operation?.closes_action_items ??
    operation?.closesActionItems ??
    operation?.action_items ??
    operation?.actionItems;
  return ensureArray(raw)
    .map((item) => {
      if (typeof item === "string") return `${item}\u0000`;
      const code = asText(
        item?.code ??
          item?.action_item_code ??
          item?.actionItemCode ??
          item?.rule_id ??
          item?.ruleId,
      );
      const itemPath = asText(item?.path ?? item?.json_path ?? item?.jsonPath);
      return code ? `${code}\u0000${itemPath}` : "";
    })
    .filter(Boolean);
}

function operationClosesAnnualSupplyTarget(operation) {
  return operationClosureKeys(operation).some((key) => {
    const [code, itemPath] = key.split("\u0000");
    return isAnnualSupplyTarget(code, itemPath);
  });
}

function categoryEntries(repoRoot, schemaFile) {
  const schema = loadTidasSchema(repoRoot, schemaFile);
  const entries = ensureArray(schema?.oneOf)
    .map((entry) => {
      const properties = entry?.properties ?? {};
      const levelText = asText(properties?.["@level"]?.const);
      const code = asText(
        properties?.["@classId"]?.const ??
          properties?.["@catId"]?.const ??
          properties?.["@code"]?.const,
      );
      const text = asText(properties?.["#text"]?.const);
      const level = levelText === "" ? Number.NaN : Number(levelText);
      return Number.isInteger(level) && code && text
        ? { level, code, text }
        : null;
    })
    .filter(Boolean);
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const parentByCode = new Map();
  const lastPerLevel = new Map();
  for (const entry of entries) {
    if (entry.level === 0) {
      parentByCode.set(entry.code, null);
    } else {
      let parent = null;
      for (let level = entry.level - 1; level >= 0; level -= 1) {
        parent = lastPerLevel.get(level) ?? null;
        if (parent) break;
      }
      parentByCode.set(entry.code, parent);
    }
    lastPerLevel.set(entry.level, entry);
  }
  return { byCode, parentByCode };
}

function categoryPathForCode(repoRoot, schemaFile, code) {
  const { byCode, parentByCode } = categoryEntries(repoRoot, schemaFile);
  const entry = byCode.get(asText(code));
  if (!entry) return [];
  const pathEntries = [entry];
  let current = entry;
  while (true) {
    const parent = parentByCode.get(current.code);
    if (!parent) break;
    pathEntries.push(parent);
    current = parent;
  }
  return pathEntries.reverse();
}

function processCategoryPathForCode(repoRoot, code) {
  return categoryPathForCode(repoRoot, "tidas_processes_category.json", code);
}

function classCode(value) {
  return asText(
    value?.["@classId"] ??
      value?.classId ??
      value?.class_id ??
      value?.["@catId"] ??
      value?.catId ??
      value?.cat_id,
  );
}

function classText(value) {
  return asText(value?.["#text"] ?? value?.text ?? value?.label ?? value?.name);
}

function classLevel(value) {
  const text = asText(value?.["@level"] ?? value?.level);
  return text === "" ? null : Number(text);
}

function classificationItemsFromOperation(operation) {
  const value = operation?.value;
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const commonClass = value["common:class"];
  if (Array.isArray(commonClass)) return commonClass;
  if (commonClass && typeof commonClass === "object") return [commonClass];
  const commonCategory = value["common:category"];
  if (Array.isArray(commonCategory)) return commonCategory;
  if (commonCategory && typeof commonCategory === "object")
    return [commonCategory];
  const wrappedClassification = value["common:classification"];
  if (
    wrappedClassification &&
    typeof wrappedClassification === "object" &&
    !Array.isArray(wrappedClassification)
  ) {
    const wrappedClass = wrappedClassification["common:class"];
    if (Array.isArray(wrappedClass)) return wrappedClass;
    if (wrappedClass && typeof wrappedClass === "object")
      return [wrappedClass];
  }
  const wrappedElementary = value["common:elementaryFlowCategorization"];
  if (
    wrappedElementary &&
    typeof wrappedElementary === "object" &&
    !Array.isArray(wrappedElementary)
  ) {
    const wrappedCategory = wrappedElementary["common:category"];
    if (Array.isArray(wrappedCategory)) return wrappedCategory;
    if (wrappedCategory && typeof wrappedCategory === "object")
      return [wrappedCategory];
  }
  const classes = value.classes ?? value.classification_classes;
  if (Array.isArray(classes)) return classes;
  const categories = value.categories ?? value.category;
  if (Array.isArray(categories)) return categories;
  return [];
}

function validateClassificationDecisionOperation({
  repoRoot,
  operation,
  schemaFile,
  codeAttribute,
  datasetLabel,
  itemLabel,
}) {
  const items = classificationItemsFromOperation(operation);
  if (items.length === 0) {
    return [
      {
        code: "patch_classification_decision_value_missing",
        message:
          `${datasetLabel} classification_decision operations must write ${itemLabel} from the bundled TIDAS category schema.`,
      },
    ];
  }
  const rawCodes = items.map(classCode).filter(Boolean);
  const leafCode = rawCodes.at(-1);
  const canonical = categoryPathForCode(repoRoot, schemaFile, leafCode);
  if (!leafCode || canonical.length === 0) {
    return [
      {
        code: "patch_classification_decision_code_invalid",
        message:
          `${datasetLabel} classification_decision leaf code is not present in ${schemaFile}.`,
        leaf_code: leafCode || null,
      },
    ];
  }
  const canonicalPrefix = canonical.slice(0, rawCodes.length);
  const canonicalCodes = canonicalPrefix.map((entry) => entry.code);
  if (rawCodes.join("/") !== canonicalCodes.join("/")) {
    return [
      {
        code: "patch_classification_decision_path_invalid",
        message:
          `${datasetLabel} classification_decision path does not match the canonical TIDAS category path.`,
        expected_codes: canonical.map((entry) => entry.code),
        actual_codes: rawCodes,
      },
    ];
  }
  const invalidEntries = items
    .map((item, index) => {
      const expected = canonicalPrefix[index];
      if (!expected) return null;
      const level = classLevel(item);
      const text = classText(item);
      const problems = [];
      if (level !== null && level !== expected.level) problems.push("level");
      if (text && text !== expected.text) problems.push("text");
      const itemCode = asText(item?.[codeAttribute]);
      if (itemCode && itemCode !== expected.code) problems.push(codeAttribute);
      return problems.length > 0
        ? {
            index,
            code: expected.code,
            expected_level: expected.level,
            actual_level: level,
            expected_text: expected.text,
            actual_text: text || null,
            expected_code_attribute: codeAttribute,
            actual_code: itemCode || null,
            problems,
          }
        : null;
    })
    .filter(Boolean);
  return invalidEntries.length > 0
    ? [
      {
        code: "patch_classification_decision_entry_invalid",
        message:
          `${datasetLabel} classification_decision entries must use canonical @level/${codeAttribute}/#text values from ${schemaFile}.`,
        invalid_entries: invalidEntries,
      },
    ]
    : [];
}

function validateProcessClassificationDecisionOperation({
  repoRoot,
  task,
  operation,
}) {
  if (asText(task?.entity?.dataset_type) !== "process") return [];
  return validateClassificationDecisionOperation({
    repoRoot,
    operation,
    schemaFile: "tidas_processes_category.json",
    codeAttribute: "@classId",
    datasetLabel: "Process",
    itemLabel: "common:classification.common:class",
  });
}

function validateFlowClassificationDecisionOperation({
  repoRoot,
  task,
  operation,
}) {
  if (asText(task?.entity?.dataset_type) !== "flow") return [];
  const actionPaths = ensureArray(task?.action_items)
    .map((item) => asText(item?.path))
    .filter(Boolean);
  const operationPath = asText(operation?.path);
  const isElementary =
    operationPath.includes("elementaryFlowCategorization") ||
    actionPaths.some((itemPath) =>
      itemPath.includes("elementaryFlowCategorization"),
    );
  return validateClassificationDecisionOperation({
    repoRoot,
    operation,
    schemaFile: isElementary
      ? "tidas_flows_elementary_category.json"
      : "tidas_flows_product_category.json",
    codeAttribute: isElementary ? "@catId" : "@classId",
    datasetLabel: isElementary ? "Elementary flow" : "Product/waste flow",
    itemLabel: isElementary
      ? "common:elementaryFlowCategorization.common:category"
      : "common:classification.common:class",
  });
}

function locationCodeMapForPatch(repoRoot) {
  const schema = loadTidasSchema(repoRoot, "tidas_locations_category.json");
  return new Map(
    ensureArray(schema?.oneOf)
      .map((entry) => [asText(entry?.const), asText(entry?.description)])
      .filter(([code]) => code),
  );
}

function locationCodeFromOperation(operation) {
  const value = operation?.value;
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asText(
      value.code ??
        value.location ??
        value["@location"] ??
        value["@subLocation"] ??
        value.impactLocation ??
        value.interventionLocation ??
        value.intervensionSubLocation ??
        value.locationOfSupply,
    );
  }
  return "";
}

function validateLocationDecisionOperation({ repoRoot, operation }) {
  const code = locationCodeFromOperation(operation);
  if (!code) {
    return [
      {
        code: "patch_location_decision_value_missing",
        message:
          "location_decision operations must write a location code from tidas_locations_category.json.",
      },
    ];
  }
  if (!locationCodeMapForPatch(repoRoot).has(code)) {
    return [
      {
        code: "patch_location_decision_code_invalid",
        message:
          "location_decision code is not present in tidas_locations_category.json.",
        location_code: code,
      },
    ];
  }
  return [];
}

function taskActionItemKeys(task) {
  return ensureArray(task?.action_items)
    .map((item) => {
      const code = asText(item?.code ?? item?.rule_id ?? item?.ruleId);
      const itemPath = asText(item?.path);
      return code ? `${code}\u0000${itemPath}` : "";
    })
    .filter(Boolean);
}

function taskActionItemsForOperation(task, operation) {
  const closures = operationClosureKeys(operation).map((key) => {
    const [code, itemPath] = key.split("\u0000");
    return { code, path: itemPath || null };
  });
  return ensureArray(task?.action_items).filter((item) => {
    const code = asText(item?.code ?? item?.rule_id ?? item?.ruleId);
    const itemPath = asText(item?.path) || null;
    return closures.some(
      (closure) =>
        closure.code === code &&
        (!closure.path || !itemPath || closure.path === itemPath),
    );
  });
}

function taskAuthoringPackageName(repoRoot, task) {
  const resolved = resolveRepoPath(repoRoot, task?.files?.authoring_package);
  return resolved ? path.basename(resolved) : "";
}

function validateCollectedPatchSet({
  repoRoot,
  task,
  patchSet,
  patchSetIndex,
  patchPath,
}) {
  const blockers = [];
  const operations = patchSetOperations(patchSet);
  const entity = task.entity ?? {};
  const datasetId = patchSetDatasetId(patchSet);
  const datasetVersion = patchSetDatasetVersion(patchSet);
  const expectedPackage = taskAuthoringPackageName(repoRoot, task);
  const authoringPackage = patchSetAuthoringPackage(patchSet);
  const patchLocation = repoRelativePath(repoRoot, patchPath);

  if (!operations) {
    blockers.push({
      code: "patch_set_invalid",
      message: "AI patch output must contain patch sets with operations[].",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
    return blockers;
  }
  const nonTestOperations = operations.filter(
    (operation) => asText(operation?.op) !== "test",
  );
  const deferredAnnualSupply = nonTestOperations.some(
    (operation) =>
      operationResolutionMode(operation) === "deferred_to_common_other" &&
      operationClosesAnnualSupplyTarget(operation),
  );
  if (deferredAnnualSupply) {
    blockers.push({
      code: "patch_deferred_annual_supply_not_allowed",
      message:
        "annualSupplyOrProductionVolume is schema-required and must not be deferred to common:other; use Foundry deterministic cleanup to write the searchable 9999 missing-data sentinel when source evidence is missing.",
      sentinel_value: annualSupplyMissingDataSentinelText,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (nonTestOperations.length === 0) {
    blockers.push({
      code: "patch_effective_operation_missing",
      message:
        "Patch set must include at least one non-test operation for AI-authored curation.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (
    !datasetId &&
    patchSet.row_index === undefined &&
    patchSet.rowIndex === undefined
  ) {
    blockers.push({
      code: "patch_target_missing",
      message:
        "Patch set must target a row by dataset_id/id/uuid/entity_id or row_index.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (datasetId && datasetId !== entity.entity_id) {
    blockers.push({
      code: "patch_dataset_id_mismatch",
      message: `Patch dataset id ${datasetId} does not match task entity ${entity.entity_id}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (datasetVersion && datasetVersion !== entity.version) {
    blockers.push({
      code: "patch_dataset_version_mismatch",
      message: `Patch dataset version ${datasetVersion} does not match task version ${entity.version}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (!authoringPackage) {
    blockers.push({
      code: "patch_authoring_package_missing",
      message: "Patch set must include authoring_package.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  } else if (
    expectedPackage &&
    path.basename(authoringPackage) !== expectedPackage
  ) {
    blockers.push({
      code: "patch_authoring_package_mismatch",
      message: `Patch authoring_package ${authoringPackage} does not match ${expectedPackage}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }

  const closed = new Set(nonTestOperations.flatMap(operationClosureKeys));
  for (const required of taskActionItemKeys(task)) {
    const [code, itemPath] = required.split("\u0000");
    const matched = [...closed].some((closure) => {
      const [closedCode, closedPath] = closure.split("\u0000");
      return (
        closedCode === code &&
        (!closedPath || !itemPath || closedPath === itemPath)
      );
    });
    if (!matched) {
      blockers.push({
        code: "patch_action_item_unclosed",
        message: `Patch set does not close required action item ${code}.`,
        path: itemPath || null,
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        entity,
      });
    }
  }

  operations.forEach((operation, operationIndex) => {
    const op = asText(operation?.op);
    const pointer = asText(operation?.path);
    const mode = operationResolutionMode(operation);
    if (!["add", "replace", "remove", "test"].includes(op)) {
      blockers.push({
        code: "patch_operation_invalid",
        message: `Unsupported or missing patch operation: ${op || "(missing)"}.`,
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test") {
      if (!operationResolution(operation)) {
        blockers.push({
          code: "patch_resolution_missing",
          message:
            "Non-test patch operations must include resolution with mode and used_context_kinds.",
          patch_file: patchLocation,
          patch_set_index: patchSetIndex,
          operation_index: operationIndex,
          entity,
        });
      } else {
        if (!allowedPatchResolutionModes.has(mode)) {
          blockers.push({
            code: "patch_resolution_mode_invalid",
            message: `Unsupported patch resolution mode: ${mode || "(missing)"}.`,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        for (const actionItem of taskActionItemsForOperation(task, operation)) {
          const allowedModes = ensureArray(actionItem?.allowed_resolution_modes)
            .map((item) => asText(item))
            .filter(Boolean);
          if (allowedModes.length > 0 && !allowedModes.includes(mode)) {
            blockers.push({
              code: "patch_resolution_mode_not_allowed_for_action_item",
              message: `Patch resolution mode ${mode || "(missing)"} is not allowed for action item ${asText(actionItem.code) || "(unknown)"}.`,
              allowed_resolution_modes: allowedModes,
              action_item_code: asText(actionItem.code) || null,
              action_item_path: asText(actionItem.path) || null,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          }
        }
        const usedKinds = new Set(operationUsedContextKinds(operation));
        for (const requiredKind of taskRequiredContextKinds(task)) {
          if (!usedKinds.has(requiredKind)) {
            blockers.push({
              code: "patch_resolution_context_kind_missing",
              message: `Patch resolution does not declare use of required context kind '${requiredKind}'.`,
              required_kind: requiredKind,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          }
        }
        if (
          ["deferred_to_common_other", "source_trace_verified"].includes(
            mode,
          ) &&
          !operationTouchesCommonOther(operation)
        ) {
          blockers.push({
            code: "patch_resolution_trace_not_in_common_other",
            message:
              "deferred_to_common_other and source_trace_verified resolutions must add or update common:other provenance.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        const traceContractBlockers =
          mode === "deferred_to_common_other"
            ? validateDeferredCommonOtherTrace({
                operation,
                actionItems: taskActionItemsForOperation(task, operation),
              })
            : mode === "source_trace_verified"
              ? validateSourceExchangeCompletenessTrace(operation)
              : [];
        traceContractBlockers.forEach((blocker) => {
          blockers.push({
            ...blocker,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        });
        const closureCodes = operationClosureCodes(operation);
        if (
          closureCodes.some((code) => code.includes("only_output_exchange")) &&
          !["source_trace_verified", "exchange_set_repaired"].includes(mode)
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message:
              "Only-output exchange action items must be resolved by source_trace_verified or exchange_set_repaired.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("classification")) &&
          mode !== "classification_decision"
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message:
              "Classification action items must be resolved by classification_decision.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("classification")) &&
          mode === "classification_decision"
        ) {
          validateProcessClassificationDecisionOperation({
            repoRoot,
            task,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
          validateFlowClassificationDecisionOperation({
            repoRoot,
            task,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
        }
        if (
          closureCodes.some((code) => code.includes("location")) &&
          mode !== "location_decision"
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message:
              "Location action items must be resolved by location_decision.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("location")) &&
          mode === "location_decision"
        ) {
          validateLocationDecisionOperation({
            repoRoot,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
        }
      }
    }
    if (!pointer.startsWith("/")) {
      blockers.push({
        code: "patch_path_invalid",
        message: "Patch operation path must be a JSON Pointer.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test" && !operationHasEvidence(operation)) {
      blockers.push({
        code: "patch_evidence_missing",
        message:
          "Non-test patch operations need basis or evidence before collect/apply.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test") {
      if (
        taskRequiresFullContextEvidence(task) &&
        operationClosureKeys(operation).length === 0
      ) {
        blockers.push({
          code: "patch_action_item_closure_missing_full_context",
          message:
            "Full-context AI patch operations must close at least one authoring action item so mutation-manifest evidence remains fully traceable.",
          patch_file: patchLocation,
          patch_set_index: patchSetIndex,
          operation_index: operationIndex,
          entity,
        });
      }
      operationFullContextEvidenceBlockers({ operation, task }).forEach(
        (blocker) => {
          blockers.push({
            ...blocker,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        },
      );
    }
    if (containsAiTemplatePlaceholder(operation)) {
      blockers.push({
        code: "patch_template_placeholder_unresolved",
        message: "Patch operation still contains an AI template placeholder.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
  });

  return blockers;
}

export function runDatasetAuthoringPatchCollect({
  repoRoot,
  options = {},
} = {}) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-authoring-patch-collect",
      usage: [
        "node scripts/foundry.mjs dataset-authoring-patch-collect --task-manifest <authoring-task-manifest.json>",
        "npm run dataset:authoring-patch:collect -- --task-manifest ./authoring-tasks/authoring-task-manifest.json",
      ],
      purpose:
        "Collect per-task AI patch outputs into one batch patch file and block if any task output is missing or structurally invalid. This command is local-only and never writes the database.",
    };
  }

  const manifestPath = resolveRepoPath(
    repoRoot,
    options.taskManifest ?? options.manifest ?? options.input,
  );
  if (!manifestPath || !fileExists(manifestPath)) {
    throw new Error(
      "--task-manifest is required and must point to authoring-task-manifest.json.",
    );
  }
  const manifest = readJson(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const outDir = resolveRepoPath(repoRoot, options.outDir || manifestDir);
  const batchPatchPath = resolveRepoPath(
    repoRoot,
    options.out ||
      options.patchOut ||
      manifest.batch_patch_contract?.output_patch_file ||
      path.join(outDir, "ai-patches.batch.json"),
  );
  const reportPath = path.join(outDir, "authoring-patch-collect-report.json");
  const requiredTasks = ensureArray(manifest.tasks).filter(
    (task) =>
      task?.status === "ready_for_ai_authoring" ||
      Number(task?.action_item_count ?? 0) > 0,
  );
  const patchSets = [];
  const patchFiles = [];
  const blockers = [];

  if (requiredTasks.length > 0) {
    blockers.push(
      ...sharedContextBundleReadinessBlockers({
        repoRoot,
        sharedContextBundle: manifest?.shared_context_bundle,
        sourceKind: "manifest",
        sourcePath: manifestPath,
      }),
    );
  }

  for (const [taskIndex, task] of requiredTasks.entries()) {
    const taskContextBlockers = authoringTaskFullContextReadinessBlockers({
      repoRoot,
      task,
    });
    if (taskContextBlockers.length > 0) {
      blockers.push(
        ...taskContextBlockers.map((blocker) => ({
          ...blocker,
          task_index: taskIndex,
          entity: task.entity ?? null,
        })),
      );
      continue;
    }
    const patchPath = resolveRepoPath(repoRoot, task?.files?.output_patch_file);
    if (!patchPath || !fileExists(patchPath)) {
      blockers.push({
        code: "ai_patch_missing",
        message: "Expected AI patch file is missing for authoring task.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        expected_patch_file: task?.files?.output_patch_file ?? null,
      });
      continue;
    }
    let rawPatch;
    try {
      rawPatch = readJson(patchPath);
    } catch (error) {
      blockers.push({
        code: "ai_patch_invalid_json",
        message: error instanceof Error ? error.message : String(error),
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    if (asText(rawPatch?.template_status) === "requires_ai_completion") {
      blockers.push({
        code: "ai_patch_template_incomplete",
        message:
          "AI patch file still has template_status=requires_ai_completion.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    const patchStatus = asText(rawPatch?.patch_status ?? rawPatch?.status);
    if (patchStatus !== "completed") {
      blockers.push({
        code: "ai_patch_status_not_completed",
        message:
          "AI patch file must declare patch_status=completed before collect.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
        patch_status: patchStatus || null,
      });
      continue;
    }
    const taskPatchSets = patchPayloadPatchSets(rawPatch);
    if (taskPatchSets.length === 0) {
      blockers.push({
        code: "ai_patch_no_patch_sets",
        message: "AI patch file must contain a patch set or patch_sets[].",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    for (const [patchSetIndex, patchSet] of taskPatchSets.entries()) {
      blockers.push(
        ...validateCollectedPatchSet({
          repoRoot,
          task,
          patchSet,
          patchSetIndex,
          patchPath,
        }),
      );
    }
    patchSets.push(...taskPatchSets);
    patchFiles.push(repoRelativePath(repoRoot, patchPath));
  }

  const operationCount = patchSets.reduce(
    (total, patchSet) => total + (patchSetOperations(patchSet)?.length ?? 0),
    0,
  );
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length > 0 ? "blocked" : "ready_for_patch_apply",
    task_manifest: repoRelativePath(repoRoot, manifestPath),
    counts: {
      tasks: ensureArray(manifest.tasks).length,
      required_tasks: requiredTasks.length,
      patch_files: patchFiles.length,
      patch_sets: patchSets.length,
      operations: operationCount,
      blockers: blockers.length,
    },
    patch_files: patchFiles,
    blockers,
    commands: {
      apply_all_patches: manifest.commands?.apply_all_patches ?? null,
    },
    files: {
      batch_patch: repoRelativePath(repoRoot, batchPatchPath),
      report: repoRelativePath(repoRoot, reportPath),
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  if (blockers.length === 0) {
    writeJson(batchPatchPath, {
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch_batch",
      patch_status: "completed",
      generated_at_utc: report.generated_at_utc,
      task_manifest: repoRelativePath(repoRoot, manifestPath),
      patch_sets: patchSets,
    });
  }
  writeJson(reportPath, report);
  return report;
}

export function runDatasetAuthoringTaskBuild({ repoRoot, options = {} } = {}) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-authoring-task-build",
      usage: [
        "node scripts/foundry.mjs dataset-authoring-task-build --authoring-package <package.json> --out-dir <task-dir>",
        "node scripts/foundry.mjs dataset-authoring-task-build --curation-gate-report <dataset-curation-gate-report.json> --out-dir <tasks-dir> [--shared-context-cache-dir <cache-dir>]",
        "npm run dataset:authoring-task:build -- --package ./curation-gate/ai-authoring-packages/process-<uuid>.authoring-package.json --out-dir ./authoring-task",
      ],
      purpose:
        "Build Codex/skill-facing authoring tasks and strict patch templates from Foundry AI authoring packages. This command is local-only and never writes the database.",
    };
  }

  const curationGateReportInput =
    options.curationGateReport ?? options.gateReport ?? options.report;
  const curationGateReportPath = resolveRepoPath(
    repoRoot,
    curationGateReportInput,
  );
  if (curationGateReportPath) {
    if (!fileExists(curationGateReportPath)) {
      throw new Error(
        "--curation-gate-report must point to dataset-curation-gate-report.json.",
      );
    }
    const outDir = resolveRepoPath(
      repoRoot,
      options.outDir || ".foundry/workspaces/dataset-authoring-tasks",
    );
    const sharedContextCacheDir = resolveRepoPath(
      repoRoot,
      options.sharedContextCacheDir || options.contextCacheDir,
    );
    const includeReady =
      options.includeReady === true || options.includeReady === "true";
    const entries = authoringPackageEntriesFromGate(
      repoRoot,
      curationGateReportPath,
      includeReady,
    );
    const missingPackages = entries.filter(
      (entry) => !entry.package_path || !fileExists(entry.package_path),
    );
    if (missingPackages.length > 0) {
      return {
        schema_version: 1,
        generated_at_utc: nowIso(),
        status: "blocked_missing_authoring_packages",
        curation_gate_report: repoRelativePath(
          repoRoot,
          curationGateReportPath,
        ),
        missing_packages: missingPackages.map((entry) => ({
          entity: entry.entity,
          authoring_package: entry.package_ref,
        })),
      };
    }
    const tasks = entries.map((entry) =>
      buildDatasetAuthoringTaskFromPackage({
        repoRoot,
        packagePath: entry.package_path,
        outDir: path.join(outDir, entry.task_dir_name),
        options: {},
      }),
    );
    return writeAuthoringTaskBatchManifest(
      repoRoot,
      outDir,
      tasks,
      {
        curation_gate_report: repoRelativePath(repoRoot, curationGateReportPath),
        include_ready: includeReady,
      },
      {
        sharedContextCacheDir,
      },
    );
  }

  const authoringPackageInput =
    options.authoringPackage ?? options.package ?? options.input;
  const packagePath = resolveRepoPath(repoRoot, authoringPackageInput);
  const packagePayload =
    packagePath && fileExists(packagePath) ? readJson(packagePath) : null;
  const datasetType = asText(packagePayload?.dataset_type);
  const entityId = asText(
    packagePayload?.entity_id ?? packagePayload?.process_id,
  );
  const defaultOut = `.foundry/workspaces/dataset-authoring-task/${datasetType || "dataset"}-${sanitizeFileName(entityId || "entity")}`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  return buildDatasetAuthoringTaskFromPackage({
    repoRoot,
    packagePath,
    outDir,
    options,
  });
}

const foundryTraceNamespace =
  "https://tiangong-lca.dev/foundry/import-curation/1";
const datetimeFieldsToNormalize = new Set([
  "common:timeStamp",
  "common:dateOfLastRevision",
]);

function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function normalizeUtcDateTimeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      trimmed,
    )
  ) {
    return null;
  }
  const time = Date.parse(trimmed);
  if (Number.isNaN(time)) return null;
  const normalized = new Date(time).toISOString();
  return normalized === value ? null : normalized;
}

function normalizeDateTimeMetadata(value) {
  let normalized = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (datetimeFieldsToNormalize.has(key)) {
        const nextValue = normalizeUtcDateTimeString(child);
        if (nextValue) {
          node[key] = nextValue;
          normalized += 1;
        }
        continue;
      }
      visit(child);
    }
  };
  visit(value);
  return normalized;
}

function annualSupplyTextValue(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asText(value["#text"] ?? value.value);
  }
  return "";
}

function isPlaceholderAnnualSupplyValue(value) {
  const text = annualSupplyTextValue(value);
  return (
    !text ||
    /^9999$/u.test(text) ||
    /^not\s+specified\.?$/iu.test(text) ||
    /^not\s+declared\s+in\s+source\s+package\.?$/iu.test(text)
  );
}

function annualSupplySentinelValue() {
  return {
    "@xml:lang": "en",
    "#text": annualSupplyMissingDataSentinelText,
  };
}

function applyAnnualSupplyMissingDataSentinel(row, datasetType) {
  if (datasetType !== "process") return false;
  const payload = unwrapDatasetPayload(row, datasetType);
  const root = datasetRoot(payload, datasetType);
  const dataSources =
    root?.modellingAndValidation?.dataSourcesTreatmentAndRepresentativeness;
  if (!dataSources || typeof dataSources !== "object") return false;
  const current = dataSources.annualSupplyOrProductionVolume;
  if (current !== undefined && !isPlaceholderAnnualSupplyValue(current)) {
    return false;
  }
  dataSources.annualSupplyOrProductionVolume = annualSupplySentinelValue();
  return true;
}

function appendImportTraceSummary(commonOther, sourceTrace) {
  commonOther["@xmlns:tiangongfoundry"] =
    commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
  const summary = {
    "@sourceExtension": "tidasimport:sourceTrace",
    "@status": "externalized_before_remote_write",
    traceHash: sha256Json(sourceTrace),
    note: "Original import trace was captured in the Foundry AI authoring package and removed from the write payload.",
  };
  const existing = commonOther["tiangongfoundry:importTraceSummary"];
  if (existing === undefined) {
    commonOther["tiangongfoundry:importTraceSummary"] = summary;
  } else if (Array.isArray(existing)) {
    existing.push(summary);
  } else {
    commonOther["tiangongfoundry:importTraceSummary"] = [existing, summary];
  }
}

function externalizeImportTraceMetadata(value) {
  let removed = 0;
  let summaries = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      if (Object.hasOwn(commonOther, "tidasimport:sourceTrace")) {
        appendImportTraceSummary(
          commonOther,
          commonOther["tidasimport:sourceTrace"],
        );
        delete commonOther["tidasimport:sourceTrace"];
        removed += 1;
        summaries += 1;
      }
      if (Object.hasOwn(commonOther, "@xmlns:tidasimport")) {
        delete commonOther["@xmlns:tidasimport"];
      }
      if (Object.keys(commonOther).length === 0) {
        delete node["common:other"];
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return { removed, summaries };
}

function ensureFoundryTraceNamespaces(value) {
  let added = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      const hasFoundryExtension = Object.keys(commonOther).some((key) =>
        key.startsWith("tiangongfoundry:"),
      );
      if (
        hasFoundryExtension &&
        !Object.hasOwn(commonOther, "@xmlns:tiangongfoundry")
      ) {
        commonOther["@xmlns:tiangongfoundry"] = foundryTraceNamespace;
        added += 1;
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return added;
}

const foundryTraceKeys = [
  "tiangongfoundry:unresolvedTrace",
  "tiangongfoundry:sourceExchangeCompleteness",
];

const localSourceLocatorKeys = new Set([
  "source_path",
  "sourcePath",
  "local_source_path",
  "localSourcePath",
  "package_path",
  "packagePath",
  "source_object",
  "sourceObject",
]);

function containsLocalSourceLocator(value) {
  const text = asText(value);
  return Boolean(
    text &&
      /(?:^|["'\s])(?:\/Users\/|\/Volumes\/|\/private\/|\/tmp\/|file:\/\/|[A-Za-z]:\\)|\.zip:|LCI ecoSpold version2 Files/iu.test(
        text,
      ),
  );
}

function sanitizeTraceEvidenceValue(value, stats) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) sanitizeTraceEvidenceValue(item, stats);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      sanitizeTraceEvidenceValue(child, stats);
      continue;
    }
    if (!containsLocalSourceLocator(child)) continue;

    const hash = sha256Text(String(child));
    if (localSourceLocatorKeys.has(key)) {
      delete value[key];
    } else {
      value[key] = `redacted local source locator sha256:${hash}`;
    }
    value.source_locator_sha256 = value.source_locator_sha256 ?? hash;
    value.source_locator_status =
      value.source_locator_status ?? "redacted_before_remote_write";
    stats.redacted += 1;
  }
}

function sanitizeFoundryTraceEvidenceLocators(value) {
  const stats = { redacted: 0 };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      for (const traceKey of foundryTraceKeys) {
        for (const traceEntry of ensureArray(commonOther[traceKey])) {
          if (
            !traceEntry ||
            typeof traceEntry !== "object" ||
            Array.isArray(traceEntry)
          ) {
            continue;
          }
          const evidence =
            traceEntry.evidence ??
            traceEntry.source_evidence ??
            traceEntry.sourceEvidence;
          sanitizeTraceEvidenceValue(evidence, stats);
        }
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return stats.redacted;
}

function normalizeProfile(rawProfile, profileId) {
  const profile =
    rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  return {
    id: String(profile.id ?? profileId ?? "generic"),
    description: profile.description ?? "",
    docs: ensureArray(profile.docs),
    waivedQaCodesByType:
      profile.waivedQaCodesByType ?? profile.waived_qa_codes_by_type ?? {},
    waiverReasons: profile.waiverReasons ?? profile.waiver_reasons ?? {},
    fullContextAiCompletion: normalizeFullContextAiCompletion(
      profile.fullContextAiCompletion ?? profile.full_context_ai_completion,
    ),
  };
}

function readProfilesConfig(repoRoot, profilesFile = defaultProfilesFile) {
  const resolved = resolveRepoPath(repoRoot, profilesFile);
  return readJsonIfExists(resolved) ?? fallbackProfiles;
}

function profileFor(repoRoot, profileId, options = {}) {
  const config = readProfilesConfig(repoRoot, options.profilesFile);
  const requestedId = String(profileId || config.default_profile || "generic")
    .trim()
    .toLowerCase();
  const profiles = config.profiles ?? {};
  const selected =
    profiles[requestedId] ??
    profiles.generic ??
    fallbackProfiles.profiles.generic;
  const profile = normalizeProfile(selected, requestedId);
  const extraDocs = optionList(options.profileDoc ?? options.profileDocs);
  const extraWaivers = optionList(
    options.waiveQa ?? options.waiveQaCode ?? options.waivedQaCode,
  );
  return {
    ...profile,
    docs: [...profile.docs, ...extraDocs],
    waivedQaCodesByType: {
      ...profile.waivedQaCodesByType,
      ...(extraWaivers.length > 0
        ? {
            [datasetTypeFromOptions(options)]: [
              ...ensureArray(
                profile.waivedQaCodesByType?.[datasetTypeFromOptions(options)],
              ),
              ...extraWaivers,
            ],
          }
        : {}),
    },
  };
}

export function listImportProfiles({ repoRoot, options = {} } = {}) {
  const config = readProfilesConfig(repoRoot, options.profilesFile);
  const profiles = Object.fromEntries(
    Object.entries(config.profiles ?? {}).map(([id, profile]) => {
      const normalized = normalizeProfile(profile, id);
      return [
        id,
        {
          id: normalized.id,
          description: normalized.description,
          docs: normalized.docs,
          waived_qa_codes_by_type: normalized.waivedQaCodesByType,
          full_context_ai_completion: normalized.fullContextAiCompletion,
        },
      ];
    }),
  );
  return {
    schema_version: config.schema_version ?? 1,
    profiles_file: options.profilesFile ?? defaultProfilesFile,
    default_profile: config.default_profile ?? "generic",
    profiles,
  };
}

function datasetTypeFromOptions(options, forcedType = null) {
  const datasetType = String(
    forcedType ??
      options.type ??
      options.datasetType ??
      options.kind ??
      "process",
  )
    .trim()
    .toLowerCase();
  if (!supportedDatasetTypes.has(datasetType)) {
    throw new Error(
      `Unsupported dataset type: ${datasetType}. Expected contact, source, unitgroup, flowproperty, support, flow, process, or lifecyclemodel.`,
    );
  }
  return datasetType;
}

export function runDatasetCurationGate({ repoRoot, options = {} } = {}) {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 2,
      status: "help",
      command: "dataset-curation-gate",
      usage: [
        "node scripts/foundry.mjs dataset-curation-gate --type process --rows-file <rows.jsonl> --schema-report <dataset-validate-report.json> --qa-report <qa-report.json> --queue-dir <curation-queue-dir> --classification-queue <classification-authoring-queue.jsonl> --location-queue <location-authoring-queue.jsonl>",
        "npm run dataset:curation-gate -- --type process --rows-file ./rows/processes.jsonl --schema-report ./schema/report.json --qa-report ./qa/report.json --schema-file ./context/schema.json --yaml-file ./context/methodology.yaml --queue-dir ./curation-queue --classification-queue ./classification-authoring-queue.jsonl --location-queue ./location-authoring-queue.jsonl --identity-preflight-index ./identity-preflight-requests/identity-preflight-requests.jsonl",
      ],
      context: {
        queue_dir:
          "optional but required by the Foundry import workflow after queue build",
        classification_queue:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages and converted into classification action items",
        location_queue:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages and converted into location-code action items",
        identity_preflight_index:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages with read-only hybrid-search request/result evidence for process and flow reuse decisions",
        require_identity_preflight:
          "legacy explicit hard-gate flag; full-context process/flow profiles now require identity-preflight result artifacts for current entities and process dependencies automatically",
        ai_authoring_package:
          "includes source row, schema/QA blockers, contract/profile context, queue task, closure, dependency rows, and support rows when --queue-dir is provided",
      },
    };
  }
  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const schemaReportPath = resolveRepoPath(repoRoot, options.schemaReport);
  const qaReportPath = resolveRepoPath(repoRoot, options.qaReport);
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-curation-gate`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const profileId = String(options.profile || "generic")
    .trim()
    .toLowerCase();
  const profile = profileFor(repoRoot, profileId, options);
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error(
      "--rows-file is required and must point to a JSON/JSONL dataset row file.",
    );
  }
  if (!schemaReportPath || !fileExists(schemaReportPath)) {
    throw new Error(
      "--schema-report is required and must point to dataset validate report JSON.",
    );
  }
  if (!qaReportPath || !fileExists(qaReportPath)) {
    throw new Error(
      "--qa-report is required and must point to a QA report JSON.",
    );
  }

  const rows = readRows(rowsFile);
  const schemaReport = readJson(schemaReportPath);
  const qaReport = readJson(qaReportPath);
  const qaFindings = readQaFindings(
    repoRoot,
    qaReport,
    qaReportPath,
    datasetType,
  );
  const profileContext = readContextFiles(
    repoRoot,
    profile.docs.map((filePath) => ["profile", filePath]),
  );
  const contractContext = readContextFiles(repoRoot, [
    ...collectExplicitContextFiles(options),
    ...collectContextDirFiles(repoRoot, options.contextDir),
    ...collectBundledSchemaContextFiles(repoRoot),
  ]);
  const fullContextRequirement = fullContextAiCompletionRequirement(
    profile,
    datasetType,
    repoRoot,
  );
  const fullContextItems = fullContextGateItems({
    contractContext,
    requirement: fullContextRequirement,
  });
  const queueContext = readCurationQueueContext(repoRoot, options);
  const requireQueueContext =
    options.requireQueueContext === true ||
    options.requireQueueContext === "true" ||
    options.requireCurationQueueContext === true ||
    options.requireCurationQueueContext === "true";
  const classificationQueueContext = readAuthoringQueueContext(
    repoRoot,
    options.classificationQueue ?? options.classificationQueueFile,
    "classification",
  );
  const locationQueueContext = readAuthoringQueueContext(
    repoRoot,
    options.locationQueue ?? options.locationQueueFile,
    "location",
  );
  const identityPreflightContext = readIdentityPreflightContext(
    repoRoot,
    options,
    rowsFile,
  );
  const classificationDecisionApplyArtifact = readJsonIfOption(
    repoRoot,
    options.classificationDecisionApplyReport ??
      options.classificationDecisionsApplyReport,
  );
  const classificationDecisionApplyContext =
    classificationDecisionApplyArtifact
      ? readClassificationDecisionApplyContext(
          repoRoot,
          classificationDecisionApplyArtifact,
        )
      : null;
  const identityDecisionApplyArtifacts = readJsonArtifactsIfOption(
    repoRoot,
    identityDecisionApplyReportOptionValues(options),
  );
  const identityDecisionApplyArtifact = identityDecisionApplyArtifacts[0] ?? null;
  const identityDecisionApplyContext = readIdentityDecisionApplyContexts(
    repoRoot,
    identityDecisionApplyArtifacts,
  );
  const unresolvedExchangeExternalizationArtifact = readJsonIfOption(
    repoRoot,
    options.unresolvedExchangeExternalizationReport,
  );
  const unresolvedExchangeExternalizationContext =
    readUnresolvedExchangeExternalizationContext(
      repoRoot,
      unresolvedExchangeExternalizationArtifact,
    );
	  const writeRows = mapRowsByIdentity(rows, datasetType);
	  const identityReferenceRewriteContext = readIdentityReferenceRewriteContext({
	    repoRoot,
	    rowsFile,
	    options,
    writeRows,
  });
  const waivedQaCodes = new Set(
    profile.waivedQaCodesByType?.[datasetType] ?? [],
  );
  const schemaRowsById = new Map(
    ensureArray(schemaReport.rows).map((row) => [
      String(row.id ?? row.dataset_id ?? ""),
      row,
    ]),
  );
  const qaFindingsById = new Map();
  for (const finding of qaFindings) {
    const id = entityIdFromFinding(finding, datasetType);
    if (!id) continue;
    if (!qaFindingsById.has(id)) qaFindingsById.set(id, []);
    qaFindingsById.get(id).push(finding);
  }

  const packageDir = path.join(outDir, "ai-authoring-packages");
  const entityReports = rows.map((row, index) => {
    const identity = datasetIdentity(row, index, datasetType);
    const curationQueueContext = buildQueueAuthoringContext(
      repoRoot,
      queueContext,
      datasetType,
      identity,
    );
      const identityPreflightAuthoringContext =
      buildIdentityPreflightAuthoringContext({
        context: identityPreflightContext,
        datasetType,
        identity,
        curationQueueContext,
        repoRoot,
        classificationDecisionApplyContext,
        unresolvedExchangeExternalizationContext,
      });
    const unresolvedExchangeExternalizationRows =
      unresolvedExchangeExternalizationRowsForIdentity(
        unresolvedExchangeExternalizationContext,
        identity,
      );
	    const identityReferenceRewrites =
	      identityReferenceRewriteContext.byIdentity.get(identityKey(identity)) ??
	      [];
    const identityDecisionApplyRows =
      identityDecisionApplyContextDecisionsForIdentity({
        context: identityDecisionApplyContext,
        datasetType,
        id: identity.id,
        version: identity.version,
      });
	    const identityPreflightGateItemsForEntity = identityPreflightGateItems({
	      required:
	        Boolean(fullContextRequirement) &&
	        ["flow", "process"].includes(datasetType),
      context: identityPreflightContext,
      authoringContext: identityPreflightAuthoringContext,
      datasetType,
      identity,
      curationQueueContext,
      profile,
    });
    const identityPreflightActionItems = identityPreflightAuthoringActionItems({
      required:
        Boolean(fullContextRequirement) &&
        ["flow", "process"].includes(datasetType),
	      authoringContext: identityPreflightAuthoringContext,
	      datasetType,
	      identity,
      identityDecisionApplyContext,
	    });
    const classificationAuthoringRows = authoringQueueRowsForIdentity(
      classificationQueueContext,
      identity,
    );
    const locationAuthoringRows = authoringQueueRowsForIdentity(
      locationQueueContext,
      identity,
    );
    const unresolvedClassificationAuthoringRows =
      classificationAuthoringRows.filter((row) =>
        classificationQueueRowStillNeedsAuthoring({
          repoRoot,
          datasetType,
          payload: identity.payload,
          row,
        }),
      );
    const unresolvedLocationAuthoringRows = locationAuthoringRows.filter(
      (row) =>
        locationQueueRowStillNeedsAuthoring({
          repoRoot,
          payload: identity.payload,
          row,
        }),
    );
    const schemaRow = schemaRowsById.get(identity.id) ?? null;
    const schemaIssues = ensureArray(schemaRow?.issues);
    const entityQaFindings = qaFindingsById.get(identity.id) ?? [];
    const waivedFindings = entityQaFindings.filter((finding) =>
      waivedQaCodes.has(qaFindingCode(finding)),
    );
    const actionableQaFindings = entityQaFindings.filter(
      (finding) => !waivedQaCodes.has(qaFindingCode(finding)),
    );
    const schemaActionItems = schemaIssues.map((issue) =>
      schemaIssueCurationAction(issue),
    );
    const qaActionItems = actionableQaFindings.map((finding) =>
      qaFindingCurationAction(finding, datasetType),
    );
    const semanticActionItems = collectProfileSemanticActionItems({
      profile,
      datasetType,
      payload: identity.payload,
      hasClassificationQueueContext:
        unresolvedClassificationAuthoringRows.length > 0,
    });
    const classificationQueueActionItems =
      unresolvedClassificationAuthoringRows.map(classificationQueueActionItem);
    const locationQueueActionItems = unresolvedLocationAuthoringRows.map(
      locationQueueActionItem,
    );
    const actionItems = [
      ...schemaActionItems.filter((item) => item.ai_required),
      ...qaActionItems,
      ...identityPreflightActionItems,
      ...classificationQueueActionItems,
      ...locationQueueActionItems,
      ...semanticActionItems,
    ];
    const queueGateItems = [];
    if (requireQueueContext && !queueContext) {
      queueGateItems.push({
        source: "curation_queue",
        code: "curation_queue_context_required",
        path: null,
        message:
          "Full-context prewrite authoring requires curation queue and dependency closure context.",
        action_kind: "queue_rebuild",
        required_owner: "foundry_deterministic_queue_build",
        ai_required: false,
        instruction:
          "Run dataset-curation-queue-build for the exact rows and pass --queue-dir before AI authoring or remote write planning.",
      });
    } else {
      if (curationQueueContext?.status === "missing_task") {
        queueGateItems.push({
          source: "curation_queue",
          code: "curation_queue_task_missing",
          path: null,
          message:
            "No matching curation queue task was found for this entity.",
          action_kind: "queue_rebuild",
          required_owner: "foundry_deterministic_queue_build",
          ai_required: false,
          instruction:
            "Rebuild the curation queue with this entity included before AI authoring or remote write planning.",
        });
      }
      if (
        curationQueueContext?.queue_status &&
        curationQueueContext.queue_status !== "ready"
      ) {
        queueGateItems.push({
          source: "curation_queue",
          code: "curation_queue_not_ready",
          path: null,
          message:
            "The curation queue manifest is not ready, so dependency closure cannot be trusted for AI authoring or remote write planning.",
          action_kind: "queue_rebuild",
          required_owner: "foundry_deterministic_queue_build",
          ai_required: false,
          instruction:
            "Resolve curation queue blockers, rebuild the queue, and rerun the curation gate before AI authoring or remote write planning.",
          evidence: {
            queue_status: curationQueueContext.queue_status,
            queue_counts: curationQueueContext.queue_counts ?? null,
            queue_blockers: curationQueueContext.queue_blockers ?? [],
          },
        });
      }
      const unresolvedQueueRefs = ensureArray(
        curationQueueContext?.closure?.dependencies?.unresolved_refs,
      );
      if (unresolvedQueueRefs.length > 0) {
        queueGateItems.push({
          source: "curation_queue",
          code: "curation_queue_dependency_refs_unresolved",
          path: null,
          message:
            "The curation queue closure still has unresolved dependency references for this entity.",
          action_kind: "queue_rebuild",
          required_owner: "foundry_deterministic_queue_build",
          ai_required: false,
          instruction:
            "Provide local dependency rows or declared external references, rebuild the queue, and rerun the curation gate before AI authoring or remote write planning.",
          evidence: {
            unresolved_refs: unresolvedQueueRefs,
          },
        });
      }
    }
    const deterministicCleanupItems = [
      ...schemaActionItems.filter((item) => !item.ai_required),
      ...queueGateItems,
      ...fullContextItems,
      ...identityPreflightGateItemsForEntity,
    ];
    const blockingItemCount =
      actionItems.length + deterministicCleanupItems.length;
    const status =
      actionItems.length > 0
        ? "needs_foundry_ai_authoring"
        : deterministicCleanupItems.length > 0
          ? "needs_foundry_deterministic_cleanup"
          : waivedFindings.length > 0
            ? "ready_with_profile_waivers"
            : "ready";
    const packagePath = path.join(
      packageDir,
      `${datasetType}-${sanitizeFileName(identity.id)}.authoring-package.json`,
    );
    const packagePayload = {
      schema_version: 2,
      generated_at_utc: nowIso(),
      profile: profile.id,
      dataset_type: datasetType,
      entity_id: identity.id,
      version: identity.version,
      authoring_package: repoRelativePath(repoRoot, packagePath),
      source_rows_file: repoRelativePath(repoRoot, rowsFile),
      profile_context_files: profileContext.files,
      contract_context_files: contractContext.files,
      full_context_ai_completion: fullContextRequirement
        ? {
            required: true,
            proof: fullContextRequirement.proof,
            required_context_kinds: fullContextRequirement.requiredContextKinds,
            required_context_file_patterns:
              fullContextRequirement.requiredContextFilePatterns,
            context_file_details: contextFileDetails(contractContext.files),
          }
        : {
            required: false,
          },
      missing_context_files: [
        ...profileContext.missing,
        ...contractContext.missing,
      ],
      schema_issues: schemaIssues,
      qa_findings: entityQaFindings,
      waived_findings: waivedFindings.map((finding) => ({
        ...finding,
        waiver_basis: profile.waiverReasons?.[qaFindingCode(finding)] ?? null,
      })),
      action_items: actionItems,
      deterministic_cleanup_items: deterministicCleanupItems,
      curation_queue_context: curationQueueContext,
      identity_preflight_context: identityPreflightAuthoringContext,
      unresolved_exchange_externalization_context: unresolvedExchangeExternalizationContext
        ? {
            status: unresolvedExchangeExternalizationContext.status,
            report_file:
              unresolvedExchangeExternalizationContext.reportPathRelative,
            input_rows_file:
              unresolvedExchangeExternalizationContext.inputRowsFileRelative,
            output_rows_file:
              unresolvedExchangeExternalizationContext.outputRowsFileRelative,
            traces_file:
              unresolvedExchangeExternalizationContext.tracesFileRelative,
            rows: unresolvedExchangeExternalizationRows,
            policy:
              "Completed entries prove Foundry moved unresolved elementary-flow process exchanges into common:other traces before schema validation and remote write planning; they do not create new elementary flows.",
          }
        : {
            status: "not_provided",
          },
	      identity_reference_rewrite_context: {
        status:
          identityReferenceRewriteContext.sourceFile &&
          identityReferenceRewrites.length > 0
            ? "attached"
            : identityReferenceRewriteContext.sourceFile
              ? "no_rows_for_entity"
              : "not_provided",
        source_file: identityReferenceRewriteContext.sourceFile
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.sourceFile)
          : null,
        rows: identityReferenceRewrites,
	        policy:
	          "These rows prove deterministic process reference rewrites to existing database flow identities selected by CLI identity-preflight before validation and write planning.",
	      },
      identity_decision_apply_context: {
        status: identityDecisionApplyContext
          ? identityDecisionApplyContext.status
          : "not_provided",
        report_file: identityDecisionApplyArtifact
          ? repoRelativePath(repoRoot, identityDecisionApplyArtifact.path)
          : null,
        decisions: identityDecisionApplyRows,
        policy:
          "These rows prove AI-authored identity decisions were deterministically applied before write planning. Completed decisions can close identity_preflight_manual_review action items; mutation manifest still verifies full-context evidence before remote write.",
      },
      classification_authoring_context: {
        queue_file: classificationQueueContext
          ? repoRelativePath(repoRoot, classificationQueueContext.path)
          : null,
        rows: classificationAuthoringRows,
      },
      location_authoring_context: {
        queue_file: locationQueueContext
          ? repoRelativePath(repoRoot, locationQueueContext.path)
          : null,
        rows: locationAuthoringRows,
      },
      source_row: row,
      entity_payload: identity.payload,
      output_contract: {
        artifact: `${datasetType}-build-plan.json or structured patch set`,
        apply_owner:
          "tiangong-lca-cli dataset patch apply for structured patches, or type-specific build-plan materialize when a build plan is produced",
        apply_report:
          "dataset-patch-apply-report.json is required when AI output is a structured patch set",
        patch_contract:
          "Structured patch sets must include authoring_package, row_index or dataset_id/version, operation evidence or basis, and closes_action_items for the package action_items they resolve.",
        recommended_apply:
          "node scripts/foundry.mjs dataset-patch-apply --input <rows.jsonl> --patch <ai-patches.json> --out <patched.jsonl> --out-dir <apply-dir> --authoring-package-dir <ai-authoring-packages-dir> --require-authoring-package --require-action-item-closure",
        cleanup_owner:
          "Foundry removes or externalizes import-only trace metadata before remote write",
        final_gate_owner: "Foundry profile-aware curation gate",
      },
    };
    if (datasetType === "process") {
      packagePayload.process_id = identity.id;
      packagePayload.process_payload = identity.payload;
      packagePayload.process_qa_findings = entityQaFindings;
    }
    writeJson(packagePath, packagePayload);
    const authoringPackageText = readText(packagePath);
    const authoringPackageContextDetails = contextFileDetails(
      packagePayload.contract_context_files,
    );
    return {
      dataset_type: datasetType,
      entity_id: identity.id,
      ...(datasetType === "process" ? { process_id: identity.id } : {}),
      version: identity.version,
      schema_status: schemaRow?.status ?? "not_found",
      schema_issue_count: schemaIssues.length,
      qa_finding_count: entityQaFindings.length,
      ...(datasetType === "process"
        ? { process_qa_finding_count: entityQaFindings.length }
        : {}),
      waived_finding_count: waivedFindings.length,
      action_item_count: actionItems.length,
	      identity_action_item_count: identityPreflightActionItems.length,
      identity_decision_apply_count: identityDecisionApplyRows.length,
	      semantic_action_item_count: semanticActionItems.length,
      classification_queue_action_item_count:
        classificationQueueActionItems.length,
      location_queue_action_item_count: locationQueueActionItems.length,
      deterministic_cleanup_count: deterministicCleanupItems.length,
      blocking_item_count: blockingItemCount,
      authoring_package: repoRelativePath(repoRoot, packagePath),
      authoring_package_sha256: sha256Text(authoringPackageText),
      authoring_package_context_file_details: authoringPackageContextDetails,
      status,
    };
  });

  const actionItemCount = entityReports.reduce(
    (total, item) => total + item.action_item_count,
    0,
  );
  const semanticActionItemCount = entityReports.reduce(
    (total, item) => total + item.semantic_action_item_count,
    0,
  );
  const identityActionItemCount = entityReports.reduce(
    (total, item) => total + item.identity_action_item_count,
    0,
  );
  const classificationQueueActionItemCount = entityReports.reduce(
    (total, item) => total + item.classification_queue_action_item_count,
    0,
  );
  const locationQueueActionItemCount = entityReports.reduce(
    (total, item) => total + item.location_queue_action_item_count,
    0,
  );
  const deterministicCleanupCount = entityReports.reduce(
    (total, item) => total + item.deterministic_cleanup_count,
    0,
  );
  const blockingItemCount = actionItemCount + deterministicCleanupCount;
  const waiverCount = entityReports.reduce(
    (total, item) => total + item.waived_finding_count,
    0,
  );
  const report = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status:
      actionItemCount > 0
        ? "blocked_needs_foundry_ai_authoring"
        : deterministicCleanupCount > 0
          ? "blocked_needs_foundry_deterministic_cleanup"
          : waiverCount > 0
            ? "ready_with_profile_waivers"
            : "ready",
    profile: profile.id,
    dataset_type: datasetType,
    rows_file: repoRelativePath(repoRoot, rowsFile),
    schema_report: repoRelativePath(repoRoot, schemaReportPath),
    qa_report: repoRelativePath(repoRoot, qaReportPath),
    policy: {
      cli_qa_role: "deterministic_qa_report_only",
      foundry_role:
        "profile policy, AI authoring package, deterministic cleanup, waiver, final prewrite decision",
      waived_qa_codes: [...waivedQaCodes],
      source_language_only_before_import: true,
    },
    context: {
      profile_files: profileContext.files.map((file) => file.path),
      contract_context_files: contractContext.files.map((file) => file.path),
      contract_context_file_details: contextFileDetails(contractContext.files),
      full_context_ai_completion: fullContextRequirement
        ? {
            required: true,
            proof: fullContextRequirement.proof,
            required_context_kinds: fullContextRequirement.requiredContextKinds,
            required_context_file_patterns:
              fullContextRequirement.requiredContextFilePatterns,
          }
        : {
            required: false,
          },
      curation_queue: queueContext
        ? {
            queue_dir: repoRelativePath(repoRoot, queueContext.queueDir),
            manifest_file: repoRelativePath(
              repoRoot,
              queueContext.manifestPath,
            ),
            status: queueContext.manifest.status ?? null,
            counts: queueContext.manifest.counts ?? null,
          }
        : null,
      require_queue_context: requireQueueContext,
      classification_queue: classificationQueueContext
        ? {
            queue_file: repoRelativePath(
              repoRoot,
              classificationQueueContext.path,
            ),
            rows: classificationQueueContext.rows.length,
          }
        : null,
      location_queue: locationQueueContext
        ? {
            queue_file: repoRelativePath(repoRoot, locationQueueContext.path),
            rows: locationQueueContext.rows.length,
          }
        : null,
      unresolved_exchange_externalization:
        unresolvedExchangeExternalizationContext
          ? {
              status: unresolvedExchangeExternalizationContext.status,
              report_file:
                unresolvedExchangeExternalizationContext.reportPathRelative,
              input_rows_file:
                unresolvedExchangeExternalizationContext.inputRowsFileRelative,
              output_rows_file:
                unresolvedExchangeExternalizationContext.outputRowsFileRelative,
              traces_file:
                unresolvedExchangeExternalizationContext.tracesFileRelative,
              externalized_exchanges:
                unresolvedExchangeExternalizationContext.externalizedExchanges,
              affected_rows:
                unresolvedExchangeExternalizationContext.affectedRows,
            }
          : null,
      identity_preflight: identityPreflightContext
        ? {
            index_file: repoRelativePath(
              repoRoot,
              identityPreflightContext.indexPath,
            ),
            rows: identityPreflightContext.rows.length,
            completed: identityPreflightContext.completed,
            pending: identityPreflightContext.pending,
          }
        : null,
	      identity_reference_rewrites: identityReferenceRewriteContext.sourceFile
        ? {
            source_file: repoRelativePath(
              repoRoot,
              identityReferenceRewriteContext.sourceFile,
            ),
            rows: identityReferenceRewriteContext.sourceRows.length,
            scoped_rows: identityReferenceRewriteContext.scopedRows.length,
	          }
	        : null,
      identity_decision_apply: identityDecisionApplyContext
        ? {
            report_file: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
            status: identityDecisionApplyContext.status,
            decisions: identityDecisionApplyContext.decisions.length,
            authoring_package_proofs:
              identityDecisionApplyContext.authoringPackageProofs.length,
          }
        : null,
	      missing_context_files: [
        ...profileContext.missing,
        ...contractContext.missing,
      ],
    },
    counts: {
      entities: entityReports.length,
      [datasetTypePlural[datasetType]]: entityReports.length,
      action_items: actionItemCount,
      identity_action_items: identityActionItemCount,
      semantic_action_items: semanticActionItemCount,
      classification_queue_action_items: classificationQueueActionItemCount,
      location_queue_action_items: locationQueueActionItemCount,
      deterministic_cleanup_items: deterministicCleanupCount,
      blocking_items: blockingItemCount,
      waivers: waiverCount,
      identity_preflight_rows: identityPreflightContext?.rows.length ?? 0,
      identity_preflight_completed: identityPreflightContext?.completed ?? 0,
      identity_preflight_pending: identityPreflightContext?.pending ?? 0,
	      identity_reference_rewrites:
	        identityReferenceRewriteContext.scopedRows.length,
      identity_decisions: identityDecisionApplyContext?.decisions.length ?? 0,
	    },
    entities: entityReports,
  };
  if (datasetType === "process") {
    report.processes = entityReports;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const reportFileName = "dataset-curation-gate-report.json";
  const entitiesFileName = `${datasetType}-curation-gate-entities.jsonl`;
  const reportPath = path.join(outDir, reportFileName);
  const jsonlPath = path.join(outDir, entitiesFileName);
  writeJson(reportPath, report);
  writeText(jsonlPath, jsonLines(entityReports));
  return {
    ...report,
    files: {
      report: repoRelativePath(repoRoot, reportPath),
      entities: repoRelativePath(repoRoot, jsonlPath),
      ...(datasetType === "process"
        ? { processes: repoRelativePath(repoRoot, jsonlPath) }
        : {}),
      authoring_packages_dir: repoRelativePath(repoRoot, packageDir),
    },
  };
}

export function runDatasetCurationCleanup({ repoRoot, options = {} } = {}) {
  const datasetType = datasetTypeFromOptions(options);
  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-curation-cleanup`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const defaultOutFile = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.cleaned.jsonl`,
  );
  const outFile =
    resolveRepoPath(repoRoot, options.out || options.outFile) || defaultOutFile;
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error(
      "--rows-file is required and must point to a JSON/JSONL dataset row file.",
    );
  }

  const rows = readRows(rowsFile);
  let removedSourceTraceBlocks = 0;
  let externalizedSourceTraceSummaries = 0;
  let normalizedDateTimeValues = 0;
  let addedFoundryTraceNamespaces = 0;
  let redactedFoundryTraceEvidenceLocators = 0;
  let annualSupplyMissingDataSentinels = 0;
  const cleanedRows = rows.map((row, rowIndex) => {
    const cleaned = JSON.parse(JSON.stringify(row));
    if (applyAnnualSupplyMissingDataSentinel(cleaned, datasetType, rowIndex)) {
      annualSupplyMissingDataSentinels += 1;
    }
    normalizedDateTimeValues += normalizeDateTimeMetadata(cleaned);
    const traceResult = externalizeImportTraceMetadata(cleaned);
    removedSourceTraceBlocks += traceResult.removed;
    externalizedSourceTraceSummaries += traceResult.summaries;
    redactedFoundryTraceEvidenceLocators +=
      sanitizeFoundryTraceEvidenceLocators(cleaned);
    addedFoundryTraceNamespaces += ensureFoundryTraceNamespaces(cleaned);
    return cleaned;
  });
  writeText(outFile, jsonLines(cleanedRows));

  const report = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status: "completed",
    dataset_type: datasetType,
    rows_file: repoRelativePath(repoRoot, rowsFile),
    cleaned_rows_file: repoRelativePath(repoRoot, outFile),
    counts: {
      rows: cleanedRows.length,
      removed_source_trace_blocks: removedSourceTraceBlocks,
      externalized_source_trace_summaries: externalizedSourceTraceSummaries,
      redacted_foundry_trace_evidence_locators:
        redactedFoundryTraceEvidenceLocators,
      added_foundry_trace_namespaces: addedFoundryTraceNamespaces,
      normalized_datetime_values: normalizedDateTimeValues,
      annual_supply_missing_data_sentinels: annualSupplyMissingDataSentinels,
    },
    policy: {
      purpose:
        "Normalize write-time metadata and externalize import-only tidasimport:sourceTrace after curation context has been captured and before remote write.",
      preserves_payload_semantics: true,
      source_trace_policy:
        "Original trace remains in the AI authoring package; write payload keeps only a safe hash summary in common:other.",
      foundry_trace_namespace_policy:
        "Any common:other tiangongfoundry:* trace kept in write payload gets @xmlns:tiangongfoundry before SDK validation.",
      foundry_trace_locator_policy:
        "Local machine paths from tiangongfoundry:* trace evidence are redacted from write payloads; authoring packages and patch evidence retain the full local context.",
      datetime_policy:
        "TIDAS/ILCD dateTime values with timezone offsets are normalized to UTC Z form.",
      annual_supply_placeholder_policy:
        `annualSupplyOrProductionVolume is schema-required. If source evidence is missing or converted as a placeholder such as 'Not specified', Foundry writes '${annualSupplyMissingDataSentinelText}' so the row remains importable and later database-side curation can bulk-locate the intentionally non-physical sentinel.`,
    },
  };
  const reportFileName = "dataset-curation-cleanup-report.json";
  const reportPath = path.join(outDir, reportFileName);
  writeJson(reportPath, report);
  return {
    ...report,
    files: {
      report: repoRelativePath(repoRoot, reportPath),
      cleaned_rows: repoRelativePath(repoRoot, outFile),
    },
  };
}

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

function readJsonLines(filePath) {
  if (!filePath || !fileExists(filePath)) return [];
  const text = readText(filePath).trim();
  if (!text) return [];
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readRowsIfExists(filePath) {
  return filePath && fileExists(filePath) ? readRows(filePath) : [];
}

function readJsonIfOption(repoRoot, value) {
  const resolved = resolveRepoPath(repoRoot, value);
  return resolved && fileExists(resolved)
    ? { path: resolved, value: readJson(resolved) }
    : null;
}

function readJsonArtifactsIfOption(repoRoot, value) {
  return optionList(value)
    .map((entry) => {
      const resolved = resolveRepoPath(repoRoot, entry);
      return resolved && fileExists(resolved)
        ? { path: resolved, value: readJson(resolved) }
        : null;
    })
    .filter(Boolean);
}

function identityDecisionApplyReportOptionValues(options) {
  return unique([
    ...optionList(options.identityDecisionApplyReport),
    ...optionList(options.identityDecisionsApplyReport),
    ...optionList(options.identityDecisionApplyReports),
    ...optionList(options.identityDecisionsApplyReports),
  ]);
}

function readFileArtifactIfOption(repoRoot, value) {
  const resolved = resolveRepoPath(repoRoot, value);
  return resolved && fileExists(resolved) ? resolved : null;
}

function curationEntityId(entity) {
  return asText(entity?.entity_id ?? entity?.process_id ?? entity?.id);
}

function identityKey(identity) {
  return `${identity.id}@@${identity.version}`;
}

function mapRowsByIdentity(rows, datasetType) {
  return new Map(
    rows.map((row, index) => {
      const identity = datasetIdentity(row, index, datasetType);
      return [identityKey(identity), { row, identity, index }];
    }),
  );
}

function defaultSourceReferenceRewriteFile(rowsFile) {
  const rowsDir = path.dirname(rowsFile);
  const candidates = [
    path.join(rowsDir, "source-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "source-reference-rewrites.jsonl"),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

function normalizeSourceReferenceRewriteRow(row) {
  const normalized = {
    ...row,
    dataset_type: asText(row?.dataset_type ?? row?.datasetType) || null,
    dataset_id: asText(row?.dataset_id ?? row?.datasetId ?? row?.entity_id),
    dataset_version:
      asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version) ||
      "00.00.001",
    relation: asText(row?.relation) || null,
    path: asText(row?.path) || null,
    action:
      asText(row?.action) || "rewrite_to_canonical_source_reference",
    reason: asText(row?.reason) || null,
  };
  normalized.evidence = {
    source: "source-reference-rewrites.jsonl",
    source_file: asText(row?.source_file ?? row?.sourceFile) || null,
    original: row?.original ?? null,
    canonical: row?.canonical ?? null,
    reason: normalized.reason,
  };
  return normalized;
}

function readSourceReferenceRewriteContext({
  repoRoot,
  rowsFile,
  options,
  writeRows,
}) {
  const configuredFile = resolveRepoPath(
    repoRoot,
    options.sourceReferenceRewrites ??
      options.sourceReferenceRewritesFile ??
      options.sourceReferenceRewriteFile ??
      options.referenceRewrites ??
      options.referenceRewritesFile,
  );
  const sourceFile =
    configuredFile && fileExists(configuredFile)
      ? configuredFile
      : defaultSourceReferenceRewriteFile(rowsFile);
  const sourceRows = sourceFile ? readJsonLines(sourceFile) : [];
  const writeKeys = new Set(writeRows.keys());
  const writeIds = new Set(
    [...writeRows.values()].map(({ identity }) => identity.id).filter(Boolean),
  );
  const scopedRows = sourceRows
    .map(normalizeSourceReferenceRewriteRow)
    .filter((row) => {
      if (!row.dataset_id) return false;
      const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
      return writeKeys.has(key) || writeIds.has(row.dataset_id);
    });
  const byIdentity = new Map();
  for (const row of scopedRows) {
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
  }
  return {
    sourceFile,
    sourceRows,
    scopedRows,
    byIdentity,
  };
}

function defaultIdentityReferenceRewriteFile(rowsFile) {
  const rowsDir = path.dirname(rowsFile);
  const candidates = [
    path.join(rowsDir, "identity-reference-rewrites.jsonl"),
    path.join(rowsDir, "identity-flow-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-flow-reference-rewrites.jsonl"),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

function normalizeIdentityReferenceRewriteRow(row) {
  const canonical = row?.canonical ?? row?.target ?? row?.replacement ?? null;
  const original = row?.original ?? row?.source ?? null;
  const normalized = {
    ...row,
    dataset_type: asText(row?.dataset_type ?? row?.datasetType) || null,
    dataset_id: asText(row?.dataset_id ?? row?.datasetId ?? row?.entity_id),
    dataset_version:
      asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version) ||
      "00.00.001",
    relation:
      asText(row?.relation) ||
      "flow_reference_to_identity_preflight_duplicate",
    path: asText(row?.path) || null,
    action:
      asText(row?.action) ||
      "rewrite_to_identity_preflight_duplicate_reference",
    reason: asText(row?.reason) || null,
    original,
    canonical,
  };
  normalized.evidence = {
    source: "identity-reference-rewrites.jsonl",
    identity_preflight: row?.identity_preflight ?? null,
    original,
    canonical,
    reason: normalized.reason,
  };
  return normalized;
}

function readIdentityReferenceRewriteContext({
  repoRoot,
  rowsFile,
  options,
  writeRows,
  referenceRows = [],
  datasetType = null,
}) {
  const configuredFile = resolveRepoPath(
    repoRoot,
    options.identityReferenceRewrites ??
      options.identityReferenceRewritesFile ??
      options.identityFlowReferenceRewrites ??
      options.identityFlowReferenceRewritesFile,
  );
  const sourceFile =
    configuredFile && fileExists(configuredFile)
      ? configuredFile
      : defaultIdentityReferenceRewriteFile(rowsFile);
  const sourceRows = sourceFile ? readJsonLines(sourceFile) : [];
  const scopeIdentities = [
    ...[...writeRows.values()].map(({ identity }) => identity),
    ...ensureArray(referenceRows).map((row, index) =>
      datasetIdentity(row, index, datasetType),
    ),
  ];
  const writeKeys = new Set(scopeIdentities.map(identityKey));
  const writeIds = new Set(
    scopeIdentities.map((identity) => identity.id).filter(Boolean),
  );
  const scopedRows = sourceRows
    .map(normalizeIdentityReferenceRewriteRow)
    .filter((row) => {
      if (!row.dataset_id) return false;
      const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
      return writeKeys.has(key) || writeIds.has(row.dataset_id);
    });
  const byIdentity = new Map();
  for (const row of scopedRows) {
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
    if (!byIdentity.has(row.dataset_id)) byIdentity.set(row.dataset_id, []);
    byIdentity.get(row.dataset_id).push(row);
  }
  return {
    sourceFile,
    sourceRows,
    scopedRows,
    byIdentity,
    status: asText(
      options.identityReferenceRewriteStatus ??
        options.identityReferenceRewritesStatus,
    ),
    inputRowsFile: resolveRepoPath(
      repoRoot,
      options.identityReferenceRewriteInputRows ??
        options.identityReferenceRewriteInputRowsFile,
    ),
    outputRowsFile: resolveRepoPath(
      repoRoot,
      options.identityReferenceRewriteOutputRows ??
        options.identityReferenceRewriteOutputRowsFile,
    ),
  };
}

function identityDecisionDatasetType(decision) {
  return asText(
    decision?.dataset_type ??
      decision?.datasetType ??
      decision?.kind ??
      decision?.entity_type ??
      decision?.entityType,
  );
}

function identityDecisionDatasetId(decision) {
  return asText(
    decision?.dataset_id ??
      decision?.datasetId ??
      decision?.entity_id ??
      decision?.entityId ??
      decision?.flow_id ??
      decision?.flowId,
  );
}

function identityDecisionDatasetVersion(decision) {
  return (
    asText(decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version) ||
    "00.00.001"
  );
}

function identityDecisionIdentityKeys({ datasetType, id, version }) {
  const normalizedType = asText(datasetType);
  const normalizedId = asText(id);
  const normalizedVersion = asText(version) || "00.00.001";
  if (!normalizedId) return [];
  return [
    `${normalizedType}:${normalizedId}@@${normalizedVersion}`,
    `${normalizedType}:${normalizedId}`,
    `${normalizedId}@@${normalizedVersion}`,
    normalizedId,
  ].filter(Boolean);
}

function identityDecisionClosesAction(decision, code) {
  return optionList(
    decision?.closes_action_items ??
      decision?.closesActionItems ??
      decision?.resolution?.closes_action_items,
  ).includes(code);
}

function identityDecisionValue(decision) {
  const raw = asText(
    decision?.identity_decision ??
      decision?.identityDecision ??
      decision?.decision ??
      decision?.resolution?.identity_decision ??
      decision?.resolution?.decision,
  );
  if (["reuse", "reuse_existing", "reference_reuse"].includes(raw)) {
    return "reuse_existing_reference";
  }
  if (["new", "insert", "write_new"].includes(raw)) return "create_new";
  if (["block", "blocked", "unresolved"].includes(raw)) return "block_unresolved";
  return raw;
}

function identityDecisionCanonical(decision) {
  const canonical =
    decision?.canonical ??
    decision?.selected_reference ??
    decision?.selectedReference ??
    decision?.resolution?.canonical ??
    decision?.resolution?.selected_reference ??
    null;
  if (!canonical || typeof canonical !== "object") return null;
  const id = asText(
    canonical.ref_object_id ??
      canonical.refObjectId ??
      canonical.id ??
      canonical["@refObjectId"],
  );
  if (!id) return null;
  return {
    table: asText(canonical.table) || "flows",
    ref_object_id: id,
    version:
      asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) ||
      "00.00.001",
  };
}

function identityDecisionPackageReference(decision) {
  return asText(
    decision?.authoring_package ??
      decision?.authoringPackage ??
      decision?.authoring_context?.authoring_package ??
      decision?.authoringContext?.authoringPackage,
  );
}

function identityDecisionPackageSha(decision) {
  return asText(
    decision?.authoring_package_sha256 ??
      decision?.authoringPackageSha256 ??
      decision?.authoring_context?.authoring_package_sha256 ??
      decision?.authoringContext?.authoringPackageSha256,
  );
}

function readIdentityDecisionApplyContext(repoRoot, identityDecisionApplyArtifact) {
  if (!identityDecisionApplyArtifact) return null;
  const report = identityDecisionApplyArtifact.value ?? {};
  const decisionsFile = resolveRepoPath(
    repoRoot,
    report.decisions_file ||
      report.decisionsFile ||
      report.files?.decisions ||
      report.files?.evidence,
  );
  let decisions = [];
  if (decisionsFile && fileExists(decisionsFile)) {
    decisions = normalizeClassificationDecisionRows(readJsonOrJsonl(decisionsFile));
  }
  if (decisions.length === 0) {
    decisions = normalizeClassificationDecisionRows(report.decisions);
  }
  const byIdentity = new Map();
  for (const decision of decisions) {
    const datasetType =
      identityDecisionDatasetType(decision) || asText(report.dataset_type);
    const id = identityDecisionDatasetId(decision);
    const version = identityDecisionDatasetVersion(decision);
    for (const key of identityDecisionIdentityKeys({ datasetType, id, version })) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(decision);
    }
  }
  const packageProofs = [];
  const seenPackages = new Set();
  for (const decision of decisions) {
    const packageRef = identityDecisionPackageReference(decision);
    if (!packageRef) continue;
    const packageKey = `${packageRef}\u0000${identityDecisionPackageSha(decision)}`;
    if (seenPackages.has(packageKey)) continue;
    seenPackages.add(packageKey);
    packageProofs.push(
      readAuthoringPackageProof(
        repoRoot,
        packageRef,
        identityDecisionPackageSha(decision),
        "identity_decision_apply",
      ),
    );
  }
  return {
    status: asText(report.status),
    reportPath: identityDecisionApplyArtifact.path,
    decisionsFile,
    decisions,
    byIdentity,
    authoringPackageProofs: packageProofs,
    inputRows: ensureArray(
      report.rows_file ?? report.rowsFile ?? report.files?.input_rows,
    )
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    outputRows: ensureArray(report.files?.output_rows)
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    referenceRows: ensureArray(report.files?.reference_rows)
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    identityReferenceRewritesFile: resolveRepoPath(
      repoRoot,
      report.files?.identity_reference_rewrites,
    ),
  };
}

function mergeIdentityDecisionApplyContexts(contexts) {
  const available = ensureArray(contexts).filter(Boolean);
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  const byIdentity = new Map();
  const decisions = [];
  const authoringPackageProofs = [];
  const inputRows = [];
  const outputRows = [];
  const referenceRows = [];
  const identityReferenceRewritesFiles = [];
  const reportPaths = [];
  const seenPackages = new Set();
  for (const context of available) {
    reportPaths.push(context.reportPath);
    decisions.push(...ensureArray(context.decisions));
    inputRows.push(...ensureArray(context.inputRows));
    outputRows.push(...ensureArray(context.outputRows));
    referenceRows.push(...ensureArray(context.referenceRows));
    for (const filePath of ensureArray(context.identityReferenceRewritesFiles)) {
      if (filePath) identityReferenceRewritesFiles.push(filePath);
    }
    if (context.identityReferenceRewritesFile) {
      identityReferenceRewritesFiles.push(context.identityReferenceRewritesFile);
    }
    for (const [key, rows] of context.byIdentity.entries()) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(...rows);
    }
    for (const proof of ensureArray(context.authoringPackageProofs)) {
      const key = JSON.stringify({
        package: proof?.authoring_package ?? proof?.path ?? proof?.package_ref,
        expected: proof?.expected_sha256,
        actual: proof?.actual_sha256,
      });
      if (seenPackages.has(key)) continue;
      seenPackages.add(key);
      authoringPackageProofs.push(proof);
    }
  }
  const uniqueIdentityRewriteFiles = unique(identityReferenceRewritesFiles);
  return {
    status: available.every((context) => context.status === "completed")
      ? "completed"
      : "mixed",
    reportPath: reportPaths[0],
    reportPaths,
    decisionsFile: null,
    decisions,
    byIdentity,
    authoringPackageProofs,
    inputRows: unique(inputRows),
    outputRows: unique(outputRows),
    referenceRows: unique(referenceRows),
    identityReferenceRewritesFile: uniqueIdentityRewriteFiles[0] ?? null,
    identityReferenceRewritesFiles: uniqueIdentityRewriteFiles,
  };
}

function readIdentityDecisionApplyContexts(repoRoot, artifacts) {
  const artifactList = ensureArray(artifacts).filter(Boolean);
  if (artifactList.length === 0) return null;
  return mergeIdentityDecisionApplyContexts(
    artifactList.map((artifact) =>
      readIdentityDecisionApplyContext(repoRoot, artifact),
    ),
  );
}

function identityDecisionApplyContextDecisionsForIdentity({
  context,
  datasetType,
  id,
  version,
}) {
  if (!context) return [];
  for (const key of identityDecisionIdentityKeys({ datasetType, id, version })) {
    const rows = context.byIdentity.get(key);
    if (rows?.length) return rows;
  }
  return [];
}

function identityDecisionApplyContextClosesAction({
  context,
  datasetType,
  id,
  version,
  code,
}) {
  return identityDecisionApplyContextDecisionsForIdentity({
    context,
    datasetType,
    id,
    version,
  }).some(
    (decision) =>
      classificationDecisionCompletionStatus(decision) === "completed" &&
      identityDecisionClosesAction(decision, code),
  );
}

function identityDecisionApplyContextHasDecision({
  context,
  datasetType,
  id,
  version,
  decisionValue,
  closesAction,
}) {
  return identityDecisionApplyContextDecisionsForIdentity({
    context,
    datasetType,
    id,
    version,
  }).some(
    (decision) =>
      classificationDecisionCompletionStatus(decision) === "completed" &&
      identityDecisionValue(decision) === decisionValue &&
      (!closesAction || identityDecisionClosesAction(decision, closesAction)),
  );
}

function identityDecisionUnresolvedReferenceKeys(context) {
  const keys = new Set();
  for (const decision of ensureArray(context?.decisions)) {
    const datasetType =
      identityDecisionDatasetType(decision) || asText(decision?.dataset_type);
    if (datasetType !== "flow") continue;
    if (identityDecisionValue(decision) !== "block_unresolved") continue;
    if (
      !identityDecisionClosesAction(
        decision,
        "elementary_flow_identity_manual_review",
      )
    ) {
      continue;
    }
    const id = identityDecisionDatasetId(decision);
    if (!id) continue;
    keys.add(
      referenceKey({
        table: "flows",
        id,
        version: identityDecisionDatasetVersion(decision),
      }),
    );
  }
  return keys;
}

function mapSchemaRows(schemaReport) {
  const map = new Map();
  for (const row of ensureArray(schemaReport?.rows)) {
    const id = asText(row?.id ?? row?.dataset_id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    map.set(`${id}@@${version}`, row);
    if (!map.has(id)) map.set(id, row);
  }
  return map;
}

function mapCurationEntities(curationGateReport) {
  const map = new Map();
  for (const entity of ensureArray(
    curationGateReport?.entities ?? curationGateReport?.processes,
  )) {
    const id = curationEntityId(entity);
    const version = asText(entity?.version) || "00.00.001";
    if (!id) continue;
    map.set(`${id}@@${version}`, entity);
    if (!map.has(id)) map.set(id, entity);
  }
  return map;
}

function normalizeDryRunOperation(operation) {
  switch (operation) {
    case "would_update_existing":
      return "update_existing";
    case "would_insert":
      return "insert";
    case "would_skip":
      return "skip";
    default:
      return operation || null;
  }
}

function readFlowDryRunArtifacts(repoRoot, dryRunReport) {
  const successFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.success_list,
  );
  const failureFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.remote_failed,
  );
  const success = new Map();
  const failures = new Map();
  for (const row of readRowsIfExists(successFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) success.set(`${id}@@${version}`, row);
  }
  for (const row of readJsonLines(failureFile)) {
    const payload =
      row?.json_ordered ?? row?.jsonOrdered ?? row?.json ?? row?.payload ?? row;
    const identity = datasetIdentity(payload, 0, "flow");
    failures.set(identityKey(identity), row);
  }
  return { success, failures };
}

function readProcessDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.progress_jsonl,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.failures_jsonl,
  );
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

function readLifecyclemodelDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.progress_jsonl,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.failures_jsonl,
  );
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

function readDatasetSaveDraftDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.progress_jsonl,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.failures_jsonl,
  );
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

function remoteVerifyBlockerKeys(remoteVerifyReport, options = {}) {
  const plannedRootKeys = options.plannedRootKeys ?? new Set();
  const plannedRootIds = options.plannedRootIds ?? new Set();
  const keys = new Set();
  for (const blocker of ensureArray(remoteVerifyReport?.blockers)) {
    const role = asText(blocker?.role);
    const table = asText(blocker?.table);
    const version = asText(
      blocker?.version ??
        blocker?.dataset_version ??
        blocker?.reference_version ??
        blocker?.ref_version,
    );
    for (const key of [
      blocker?.root_id,
      blocker?.dataset_id,
      blocker?.id,
      blocker?.refObjectId,
      blocker?.ref_object_id,
      blocker?.reference_id,
    ]) {
      const value = asText(key);
      if (
        role === "reference" &&
        value &&
        ((table && plannedRootKeys.has(referenceKey({ table, id: value, version }))) ||
          plannedRootIds.has(value))
      ) {
        continue;
      }
      if (value) keys.add(value);
    }
  }
  return keys;
}

function patchEvidenceIdentityKey(entry) {
  const id = asText(entry?.dataset_id ?? entry?.entity_id ?? entry?.id);
  const version =
    asText(entry?.dataset_version ?? entry?.version) || "00.00.001";
  return id ? `${id}@@${version}` : null;
}

function compactPatchEvidenceEntry(entry) {
  return {
    row_index: Number.isInteger(entry?.row_index) ? entry.row_index : null,
    dataset_id:
      asText(entry?.dataset_id ?? entry?.entity_id ?? entry?.id) || null,
    dataset_version: asText(entry?.dataset_version ?? entry?.version) || null,
    operation: asText(entry?.op ?? entry?.operation) || null,
    path: asText(entry?.path) || null,
    basis: asText(entry?.basis) || null,
    evidence: entry?.evidence ?? null,
    resolution: entry?.resolution ?? null,
    authoring_package: asText(entry?.authoring_package) || null,
    authoring_package_sha256: asText(entry?.authoring_package_sha256) || null,
    closes_action_items: ensureArray(entry?.closes_action_items),
  };
}

function readPatchApplyContext(
  repoRoot,
  patchApplyArtifact,
  patchEvidenceFile,
) {
  const report = patchApplyArtifact?.value ?? null;
  const reportPath = patchApplyArtifact?.path ?? null;
  const evidenceFile =
    patchEvidenceFile ??
    readFileArtifactIfOption(repoRoot, report?.files?.patch_evidence) ??
    null;
  const expectedEvidenceCount = Number(report?.evidence_count ?? 0);
  const evidenceRows = evidenceFile ? readJsonLines(evidenceFile) : [];
  const byIdentity = new Map();
  const byRowIndex = new Map();
  const globalBlockers = [];

  if (!report && evidenceFile) {
    globalBlockers.push({
      code: "patch_apply_report_required",
      stage: "ai_patch_apply",
      message:
        "Patch evidence was provided, but dataset-patch-apply-report.json is required to prove deterministic application.",
      patch_evidence_file: repoRelativePath(repoRoot, evidenceFile),
    });
  }
  if (report && report.status !== "completed") {
    globalBlockers.push({
      code: "patch_apply_not_completed",
      stage: "ai_patch_apply",
      message: `dataset-patch-apply status is ${report.status}.`,
      patch_apply_report: reportPath
        ? repoRelativePath(repoRoot, reportPath)
        : null,
    });
  }
  if ((expectedEvidenceCount > 0 || patchEvidenceFile) && !evidenceFile) {
    globalBlockers.push({
      code: "patch_evidence_file_missing",
      stage: "ai_patch_apply",
      message:
        "Patch apply report expects patch evidence, but no readable patch evidence JSONL file was provided.",
      patch_apply_report: reportPath
        ? repoRelativePath(repoRoot, reportPath)
        : null,
    });
  }

  for (const entry of evidenceRows) {
    const compact = compactPatchEvidenceEntry(entry);
    const key = patchEvidenceIdentityKey(entry);
    if (key) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(compact);
      if (compact.dataset_id && !byIdentity.has(compact.dataset_id)) {
        byIdentity.set(compact.dataset_id, []);
      }
      if (compact.dataset_id) byIdentity.get(compact.dataset_id).push(compact);
    }
    if (Number.isInteger(entry?.row_index)) {
      if (!byRowIndex.has(entry.row_index)) byRowIndex.set(entry.row_index, []);
      byRowIndex.get(entry.row_index).push(compact);
    }
  }

  return {
    status: report?.status ?? "not_provided",
    report,
    reportPath,
    inputRowsFile: resolveRepoPath(
      repoRoot,
      report?.input_path ?? report?.inputPath ?? report?.files?.input_rows,
    ),
    outputRows: unique([
      report?.out_path,
      report?.outPath,
      report?.output_path,
      report?.outputPath,
      report?.files?.patched_rows,
      report?.files?.output_rows,
    ])
      .flatMap((filePath) => ensureArray(filePath))
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    evidenceFile,
    evidenceRows,
    byIdentity,
    byRowIndex,
    globalBlockers,
  };
}

function patchEvidenceForRow(patchApplyContext, identity, rowIndex) {
  if (!patchApplyContext) return [];
  const seen = new Set();
  const entries = [
    ...(patchApplyContext.byIdentity.get(identityKey(identity)) ?? []),
    ...(patchApplyContext.byIdentity.get(identity.id) ?? []),
    ...(patchApplyContext.byRowIndex.get(rowIndex) ?? []),
  ];
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function patchEvidenceClosureCodes(entry) {
  return ensureArray(entry?.closes_action_items)
    .map((item) =>
      asText(
        typeof item === "string"
          ? item
          : item?.code ??
              item?.action_item_code ??
              item?.actionItemCode ??
              item?.rule_id ??
              item?.ruleId,
      ),
    )
    .filter(Boolean);
}

function isDeterministicAnnualSupplyCleanupTrace(trace) {
  const actionCode = asText(trace?.action_item_code);
  const blockedPath = asText(trace?.blocked_path);
  const evidence = trace?.evidence ?? {};
  return (
    isAnnualSupplyTarget(actionCode, blockedPath) &&
    asText(evidence?.source) === "foundry_deterministic_cleanup"
  );
}

function tracePatchEvidenceBlockers({
  traceSummary,
  aiPatchEvidence,
  identityDecisionApplyContext = null,
}) {
  const blockers = [];
  const deferredEvidence = aiPatchEvidence.filter(
    (entry) => evidenceResolutionMode(entry) === "deferred_to_common_other",
  );
  for (const trace of ensureArray(traceSummary?.unresolved_traces)) {
    const actionCode = asText(trace?.action_item_code);
    const matched =
      actionCode &&
      deferredEvidence.some((entry) =>
        patchEvidenceClosureCodes(entry).includes(actionCode),
      );
    const identityMatched =
      actionCode === "elementary_flow_identity_manual_review" &&
      identityDecisionApplyContextHasDecision({
        context: identityDecisionApplyContext,
        datasetType: "flow",
        id: trace?.reference_id,
        version: trace?.reference_version,
        decisionValue: "block_unresolved",
        closesAction: "elementary_flow_identity_manual_review",
      });
    if (
      !matched &&
      !identityMatched &&
      !isDeterministicAnnualSupplyCleanupTrace(trace)
    ) {
      blockers.push({
        code: "unresolved_trace_patch_evidence_required",
        stage: "full_context_ai_completion",
        message:
          "Final payload contains tiangongfoundry:unresolvedTrace. Each deferred trace must be backed by same-row AI patch evidence with resolution.mode=deferred_to_common_other, or by an AI identity block_unresolved decision for an elementary flow reference.",
        action_item_code: actionCode || null,
        blocked_path: trace?.blocked_path ?? null,
      });
    }
  }

  const sourceTraceEvidence = aiPatchEvidence.filter(
    (entry) => evidenceResolutionMode(entry) === "source_trace_verified",
  );
  for (const trace of ensureArray(
    traceSummary?.source_exchange_completeness,
  )) {
    if (sourceTraceEvidence.length === 0) {
      blockers.push({
        code: "source_exchange_trace_patch_evidence_required",
        stage: "full_context_ai_completion",
        message:
          "Final payload contains tiangongfoundry:sourceExchangeCompleteness. Source-only exchange acceptance must be backed by same-row AI patch evidence with resolution.mode=source_trace_verified.",
        status: trace?.status ?? null,
      });
    }
  }
  return blockers;
}

function readPolicySnapshots(repoRoot, profile) {
  const entries = [
    ["safety_policy", "docs/safety-policy.md"],
    ...ensureArray(profile?.docs).map((filePath) => [
      "profile_context",
      filePath,
    ]),
  ];
  return entries.map(([kind, filePath]) => {
    const resolved = resolveRepoPath(repoRoot, filePath);
    if (!fileExists(resolved)) {
      return {
        kind,
        path: path.isAbsolute(filePath) ? filePath : filePath,
        exists: false,
        sha256: null,
      };
    }
    const text = readText(resolved);
    return {
      kind,
      path: repoRelativePath(repoRoot, resolved),
      exists: true,
      sha256: sha256Text(text),
    };
  });
}

function traceSummaryCount(value) {
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const other = node["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      count += ensureArray(other["tiangongfoundry:importTraceSummary"]).length;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return count;
}

function collectCommonOtherTraceEntries(value, traceKey, basePath = "$") {
  const entries = [];
  const visit = (node, currentPath) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    const other = node["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      const traceValue = other[traceKey];
      if (traceValue !== undefined) {
        ensureArray(traceValue).forEach((entry, index) => {
          entries.push({
            path: `${currentPath}.common:other.${traceKey}${Array.isArray(traceValue) ? `[${index}]` : ""}`,
            entry,
          });
        });
      }
    }
    Object.entries(node).forEach(([key, child]) => {
      if (key === "common:other") return;
      visit(child, `${currentPath}.${key}`);
    });
  };
  visit(value, basePath);
  return entries;
}

function compactFoundryTraceEntry({
  datasetType,
  identity,
  rowIndex,
  traceKind,
  trace,
}) {
  const entry =
    trace?.entry &&
    typeof trace.entry === "object" &&
    !Array.isArray(trace.entry)
      ? trace.entry
      : { value: trace?.entry ?? null };
  return {
    dataset_type: datasetType,
    entity_id: identity.id,
    version: identity.version,
    row_index: rowIndex,
    trace_kind: traceKind,
    path: trace?.path ?? null,
    status:
      asText(entry.status ?? entry.decision_status ?? entry.decisionStatus) ||
      null,
    action_item_code:
      asText(entry.action_item_code ?? entry.actionItemCode ?? entry.code) ||
      null,
    reference_id:
      asText(
        entry.reference_id ??
          entry.referenceId ??
          entry.ref_object_id ??
          entry.refObjectId,
      ) || null,
    reference_version:
      asText(
        entry.reference_version ??
          entry.referenceVersion ??
          entry.ref_version ??
          entry.refVersion,
      ) || null,
    blocked_path:
      asText(
        entry.blocked_path ??
          entry.blockedPath ??
          entry.field_path ??
          entry.fieldPath ??
          entry.path,
      ) || null,
    reason:
      asText(entry.reason ?? entry.deferred_reason ?? entry.deferredReason) ||
      null,
    next_action:
      asText(
        entry.next_action ??
          entry.nextAction ??
          entry.follow_up ??
          entry.followUp,
      ) || null,
    evidence:
      entry.evidence ??
      entry.source_evidence ??
      entry.sourceEvidence ??
      entry.trace ??
      null,
    trace_sha256: sha256Text(JSON.stringify(entry)),
  };
}

export function foundryTraceSummary({ datasetType, identity, row, rowIndex }) {
  const unresolved = collectCommonOtherTraceEntries(
    row,
    "tiangongfoundry:unresolvedTrace",
  ).map((trace) =>
    compactFoundryTraceEntry({
      datasetType,
      identity,
      rowIndex,
      traceKind: "unresolved_trace",
      trace,
    }),
  );
  const sourceExchangeCompleteness = collectCommonOtherTraceEntries(
    row,
    "tiangongfoundry:sourceExchangeCompleteness",
  ).map((trace) =>
    compactFoundryTraceEntry({
      datasetType,
      identity,
      rowIndex,
      traceKind: "source_exchange_completeness",
      trace,
    }),
  );
  const unresolvedExchange = collectCommonOtherTraceEntries(
    row,
    "tiangongfoundry:unresolvedExchangeTrace",
  ).map((trace) =>
    compactFoundryTraceEntry({
      datasetType,
      identity,
      rowIndex,
      traceKind: "unresolved_exchange_trace",
      trace,
    }),
  );
  return {
    import_trace_summary_count: traceSummaryCount(row),
    unresolved_trace_count: unresolved.length,
    unresolved_exchange_trace_count: unresolvedExchange.length,
    source_exchange_completeness_count: sourceExchangeCompleteness.length,
    unresolved_traces: unresolved,
    unresolved_exchange_traces: unresolvedExchange,
    source_exchange_completeness: sourceExchangeCompleteness,
  };
}

function hasImportOnlyTrace(value) {
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const other = node["common:other"];
    if (
      other &&
      typeof other === "object" &&
      !Array.isArray(other) &&
      (Object.hasOwn(other, "tidasimport:sourceTrace") ||
        Object.hasOwn(other, "@xmlns:tidasimport"))
    ) {
      found = true;
      return;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return found;
}

function normalizedArtifactPath(repoRoot, value) {
  const text = asText(value);
  if (!text) return null;
  return path.resolve(resolveRepoPath(repoRoot, text));
}

function sameArtifactPath(repoRoot, left, right) {
  const resolvedLeft = normalizedArtifactPath(repoRoot, left);
  const resolvedRight = normalizedArtifactPath(repoRoot, right);
  return Boolean(
    resolvedLeft && resolvedRight && resolvedLeft === resolvedRight,
  );
}

function repoRelativeArtifactPath(repoRoot, value) {
  const resolved = normalizedArtifactPath(repoRoot, value);
  return resolved ? repoRelativePath(repoRoot, resolved) : null;
}

function readUnresolvedExchangeExternalizationContext(repoRoot, artifact) {
  if (!artifact) return null;
  const report = artifact.value ?? {};
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    report.input_rows_file ??
      report.inputRowsFile ??
      report.files?.input_rows ??
      report.files?.inputRows,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    report.output_rows_file ??
      report.outputRowsFile ??
      report.files?.output_rows ??
      report.files?.outputRows,
  );
  const tracesFile = resolveRepoPath(
    repoRoot,
    report.traces_file ??
      report.tracesFile ??
      report.files?.traces ??
      report.files?.unresolved_exchanges,
  );
  const traces = readJsonLinesIfExists(tracesFile);
  const affectedKeys = new Set();
  const externalizedExchangeCountByIdentity = new Map();
  for (const trace of traces) {
    const id = asText(trace?.dataset_id ?? trace?.entity_id);
    const version = asText(trace?.dataset_version ?? trace?.version) || "00.00.001";
    if (!id) continue;
    const key = `process:${id}@@${version}`;
    affectedKeys.add(key);
    externalizedExchangeCountByIdentity.set(
      key,
      (externalizedExchangeCountByIdentity.get(key) ?? 0) + 1,
    );
  }
  const outputPayloadSha256ByIdentity = new Map();
  if (outputRowsFile && fileExists(outputRowsFile)) {
    readRowsIfExists(outputRowsFile).forEach((row, index) => {
      const identity = datasetIdentity(row, index, "process");
      const key = identityFreshnessIdentityKey({
        datasetType: "process",
        identity,
      });
      if (key) {
        outputPayloadSha256ByIdentity.set(key, sha256Json(identity.payload));
      }
    });
  }
  return {
    artifact,
    status: asText(report.status),
    inputRowsFile,
    outputRowsFile,
    tracesFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    tracesFileRelative: repoRelativeArtifactPath(repoRoot, tracesFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path),
    externalizedExchanges: Number(report.counts?.externalized_exchanges ?? 0) || 0,
    affectedRows: Number(report.counts?.affected_rows ?? 0) || 0,
    traces,
    affectedKeys,
    externalizedExchangeCountByIdentity,
    outputPayloadSha256ByIdentity,
  };
}

function readCanonicalSupportRewriteContext(repoRoot, artifact) {
  if (!artifact) return null;
  const report = artifact.value ?? {};
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    report.rows_file ??
      report.rowsFile ??
      report.input_rows_file ??
      report.inputRowsFile ??
      report.files?.input_rows ??
      report.files?.inputRows,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    report.output_rows_file ??
      report.outputRowsFile ??
      report.files?.output_rows ??
      report.files?.outputRows,
  );
  const blockersFile = resolveRepoPath(
    repoRoot,
    report.files?.canonical_support_blockers ??
      report.files?.blockers ??
      report.blockers_file,
  );
  const deferredRowsFile = resolveRepoPath(
    repoRoot,
    report.files?.deferred_rows ??
      report.files?.deferredRows ??
      report.deferred_rows_file ??
      report.deferredRowsFile,
  );
  const rewritesFile = resolveRepoPath(
    repoRoot,
    report.files?.canonical_support_rewrites ??
      report.files?.rewrites ??
      report.rewrites_file,
  );
  const blockerRows = readJsonLinesIfExists(blockersFile);
  const hardBlockers = Array.isArray(report.blockers)
    ? report.blockers
    : String(report.status) === "blocked"
      ? blockerRows
      : [];
  const deferredBlockers = Array.isArray(report.deferred_blockers)
    ? report.deferred_blockers
    : String(report.status) === "completed_with_deferred_rows"
      ? blockerRows
      : [];
  return {
    artifact,
    status: asText(report.status),
    counts: report.counts && typeof report.counts === "object" ? report.counts : {},
    inputRowsFile,
    outputRowsFile,
    deferredRowsFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    deferredRowsFileRelative: repoRelativeArtifactPath(repoRoot, deferredRowsFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path),
    blockersFileRelative: repoRelativeArtifactPath(repoRoot, blockersFile),
    rewritesFileRelative: repoRelativeArtifactPath(repoRoot, rewritesFile),
    blockerRows,
    blockers: hardBlockers,
    deferredBlockers,
    rewrites: readJsonLinesIfExists(rewritesFile),
  };
}

function unresolvedExchangeExternalizationRowsForIdentity(context, identity) {
  if (!context || !identity?.id) return [];
  const key = `process:${identity.id}@@${identity.version || "00.00.001"}`;
  return context.traces.filter((trace) => {
    const id = asText(trace?.dataset_id ?? trace?.entity_id);
    const version =
      asText(trace?.dataset_version ?? trace?.version) || "00.00.001";
    return key === `process:${id}@@${version}`;
  });
}

function rowsFileChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  upstreamFile,
  finalFile,
  unresolvedExchangeExternalizationContext,
}) {
  return Boolean(
    upstreamFile &&
      finalFile &&
      unresolvedExchangeExternalizationContext?.status === "completed" &&
      unresolvedExchangeExternalizationContext.inputRowsFile &&
      unresolvedExchangeExternalizationContext.outputRowsFile &&
      sameArtifactPath(
        repoRoot,
        upstreamFile,
        unresolvedExchangeExternalizationContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        unresolvedExchangeExternalizationContext.outputRowsFile,
        finalFile,
      ),
  );
}

function evidenceScopeBlocker({
  code,
  stage,
  message,
  expected,
  actual,
  artifact,
  repoRoot,
}) {
  return {
    code,
    stage,
    message,
    expected: repoRelativeArtifactPath(repoRoot, expected),
    actual: repoRelativeArtifactPath(repoRoot, actual),
    artifact: artifact ? repoRelativePath(repoRoot, artifact) : null,
  };
}

function dryRunReportRowsFile(report) {
  return (
    report?.input_path ??
    report?.inputPath ??
    report?.input_file ??
    report?.inputFile ??
    report?.rows_file ??
    report?.rowsFile ??
    report?.source_rows_file ??
    report?.sourceRowsFile ??
    report?.source_path ??
    report?.sourcePath ??
    report?.files?.input ??
    report?.files?.input_rows ??
    report?.files?.source_rows ??
    report?.files?.selected_rows_input
  );
}

function buildEvidenceScopeBlockers({
  repoRoot,
  rowsFile,
  schemaReportArtifact,
  curationGateArtifact,
  dryRunReportArtifact,
  cleanupArtifact,
  patchApplyArtifact,
  patchApplyContext,
  patchCollectArtifact,
  requirePatchCollectReport,
  requireCurationGate = true,
  remoteVerifyArtifact,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  const blockers = [];
  const finalRowsFile = path.resolve(rowsFile);
  const schemaInput = schemaReportArtifact?.value?.input_path;
  if (!schemaInput) {
    blockers.push(
      evidenceScopeBlocker({
        code: "schema_report_input_missing",
        stage: "schema",
        message:
          "Schema validation report must record input_path for exact rows-file scope verification.",
        expected: finalRowsFile,
        actual: null,
        artifact: schemaReportArtifact?.path,
        repoRoot,
      }),
    );
  } else if (!sameArtifactPath(repoRoot, schemaInput, finalRowsFile)) {
    blockers.push(
      evidenceScopeBlocker({
        code: "schema_report_rows_mismatch",
        stage: "schema",
        message:
          "Schema validation report input_path does not match the mutation manifest rows file.",
        expected: finalRowsFile,
        actual: schemaInput,
        artifact: schemaReportArtifact?.path,
        repoRoot,
      }),
    );
  }

  if (!curationGateArtifact && requireCurationGate) {
    blockers.push({
      code: "curation_gate_report_required",
      stage: "foundry_curation",
      message:
        "dataset-mutation-manifest requires a post-authoring dataset-curation-gate report for the exact write rows.",
    });
  } else if (curationGateArtifact) {
    const curationRowsFile = curationGateArtifact.value?.rows_file;
    if (!curationRowsFile) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_rows_missing",
          stage: "foundry_curation",
          message:
            "Curation gate report must record rows_file for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, curationRowsFile, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_rows_mismatch",
          stage: "foundry_curation",
          message:
            "Curation gate report rows_file does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: curationRowsFile,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    }
    if (
      !["ready", "ready_with_profile_waivers"].includes(
        curationGateArtifact.value?.status,
      )
    ) {
      blockers.push({
        code: "curation_gate_report_not_ready",
        stage: "foundry_curation",
        message: `Curation gate report status is ${curationGateArtifact.value?.status ?? "missing"}.`,
        artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
      });
    }
    if (!curationGateArtifact.value?.qa_report) {
      blockers.push({
        code: "curation_gate_qa_report_missing",
        stage: "foundry_curation",
        message:
          "Curation gate report must record the deterministic QA report used for final prewrite curation.",
        artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
      });
    } else {
      const qaReportPath = resolveRepoPath(
        repoRoot,
        curationGateArtifact.value.qa_report,
      );
      if (!fileExists(qaReportPath)) {
        blockers.push({
          code: "curation_gate_qa_report_not_readable",
          stage: "foundry_curation",
          message: "Curation gate qa_report file is not readable.",
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
          qa_report: repoRelativeArtifactPath(
            repoRoot,
            curationGateArtifact.value.qa_report,
          ),
        });
      } else {
        try {
          const qaReport = readJson(qaReportPath);
          const qaRowsFile =
            qaReport.rows_file ?? qaReport.input_path ?? qaReport.inputPath;
          if (!qaRowsFile) {
            blockers.push({
              code: "curation_gate_qa_rows_missing",
              stage: "foundry_curation",
              message:
                "Final deterministic QA report must record rows_file or input_path for exact rows-file scope verification.",
              artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
              qa_report: repoRelativePath(repoRoot, qaReportPath),
            });
          } else if (!sameArtifactPath(repoRoot, qaRowsFile, finalRowsFile)) {
            blockers.push(
              evidenceScopeBlocker({
                code: "curation_gate_qa_rows_mismatch",
                stage: "foundry_curation",
                message:
                  "Final deterministic QA report rows_file/input_path does not match the mutation manifest rows file.",
                expected: finalRowsFile,
                actual: qaRowsFile,
                artifact: qaReportPath,
                repoRoot,
              }),
            );
          }
        } catch (error) {
          blockers.push({
            code: "curation_gate_qa_report_invalid",
            stage: "foundry_curation",
            message: error instanceof Error ? error.message : String(error),
            artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
            qa_report: repoRelativePath(repoRoot, qaReportPath),
          });
        }
      }
    }
    if (
      curationGateArtifact.value?.schema_report &&
      schemaReportArtifact?.path &&
      !sameArtifactPath(
        repoRoot,
        curationGateArtifact.value.schema_report,
        schemaReportArtifact.path,
      )
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_schema_report_mismatch",
          stage: "foundry_curation",
          message:
            "Curation gate schema_report does not match the schema report passed to mutation manifest.",
          expected: schemaReportArtifact.path,
          actual: curationGateArtifact.value.schema_report,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (cleanupArtifact) {
    const cleanedRowsFile =
      cleanupArtifact.value?.cleaned_rows_file ??
      cleanupArtifact.value?.files?.cleaned_rows;
    if (!cleanedRowsFile) {
      blockers.push(
        evidenceScopeBlocker({
          code: "cleanup_cleaned_rows_missing",
          stage: "prewrite_cleanup",
          message:
            "Cleanup report must record cleaned_rows_file/files.cleaned_rows for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: cleanupArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, cleanedRowsFile, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "cleanup_cleaned_rows_mismatch",
          stage: "prewrite_cleanup",
          message:
            "Cleanup cleaned_rows_file does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: cleanedRowsFile,
          artifact: cleanupArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (patchApplyArtifact) {
    const patchOut =
      patchApplyArtifact.value?.out_path ??
      patchApplyArtifact.value?.files?.patched_rows;
    const cleanupInput = cleanupArtifact?.value?.rows_file;
    if (!patchOut) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_output_missing",
          stage: "ai_patch_apply",
          message:
            "Patch apply report must record out_path/files.patched_rows for exact scope verification.",
          expected: cleanupInput || finalRowsFile,
          actual: null,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    } else if (
      cleanupArtifact &&
      !sameArtifactPath(repoRoot, patchOut, cleanupInput) &&
      !patchApplyOutputChainsThroughIdentityRewrite({
        repoRoot,
        patchOut,
        cleanupInput,
        identityReferenceRewriteContext,
      }) &&
      !patchApplyOutputChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        patchOut,
        cleanupInput,
        unresolvedExchangeExternalizationContext,
      }) &&
      !patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization({
        repoRoot,
        patchOut,
        cleanupInput,
        identityReferenceRewriteContext,
        unresolvedExchangeExternalizationContext,
      }) &&
      !rowsFileReachableThroughTransformChain({
        repoRoot,
        startFiles: [patchOut],
        expectedRowsFile: cleanupInput,
        transforms: deterministicRowsFileTransformEntries({
          patchApplyContext: null,
          identityReferenceRewriteContext,
          unresolvedExchangeExternalizationContext,
          canonicalSupportRewriteContext,
        }),
      })
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_cleanup_input_mismatch",
          stage: "ai_patch_apply",
          message:
            "Patch apply output must match the cleanup input rows file, or feed a completed deterministic rewrite chain whose output is the cleanup input.",
          expected: cleanupInput,
          actual: patchOut,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    } else if (
      !cleanupArtifact &&
      !sameArtifactPath(repoRoot, patchOut, finalRowsFile)
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_rows_mismatch",
          stage: "ai_patch_apply",
          message:
            "Patch apply output does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: patchOut,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    }
    if ((patchApplyContext?.evidenceRows.length ?? 0) === 0) {
      blockers.push({
        code: "patch_evidence_required",
        stage: "ai_patch_apply",
        message:
          "AI-authored patch apply report was provided, but no patch evidence rows were found.",
        patch_apply_report: repoRelativePath(repoRoot, patchApplyArtifact.path),
      });
    }
  }

  if (requirePatchCollectReport && !patchCollectArtifact) {
    blockers.push({
      code: "patch_collect_report_required",
      stage: "ai_patch_collect",
      message:
        "Foundry AI authoring task patch apply requires --patch-collect-report from dataset-authoring-patch-collect.",
    });
  }

  if (patchCollectArtifact) {
    if (patchCollectArtifact.value?.status !== "ready_for_patch_apply") {
      blockers.push({
        code: "patch_collect_not_ready",
        stage: "ai_patch_collect",
        message: `dataset-authoring-patch-collect status is ${patchCollectArtifact.value?.status ?? "missing"}.`,
        artifact: repoRelativePath(repoRoot, patchCollectArtifact.path),
      });
    }
    const batchPatch = patchCollectArtifact.value?.files?.batch_patch;
    const appliedPatch = patchApplyArtifact?.value?.patch_path;
    if (
      patchApplyArtifact &&
      batchPatch &&
      appliedPatch &&
      !sameArtifactPath(repoRoot, batchPatch, appliedPatch)
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_collect_apply_patch_mismatch",
          stage: "ai_patch_collect",
          message:
            "Collected batch patch file does not match the patch file applied by dataset-patch-apply.",
          expected: batchPatch,
          actual: appliedPatch,
          artifact: patchCollectArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (!dryRunReportArtifact) {
    blockers.push({
      code: "dry_run_report_required",
      stage: "dry_run",
      message:
        "dataset-mutation-manifest requires a dry-run report before remote write planning. Upstream prewrite gates may intentionally skip dry-run and keep the manifest blocked.",
    });
  } else {
    const dryRunInput = dryRunReportRowsFile(dryRunReportArtifact.value);
    if (!dryRunInput) {
      blockers.push(
        evidenceScopeBlocker({
          code: "dry_run_report_input_missing",
          stage: "dry_run",
          message:
            "Dry-run report must record input_path/input_file/rows_file for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: dryRunReportArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, dryRunInput, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "dry_run_report_rows_mismatch",
          stage: "dry_run",
          message:
            "Dry-run report input path does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: dryRunInput,
          artifact: dryRunReportArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (remoteVerifyArtifact) {
    const remoteInput = remoteVerifyArtifact.value?.input_path;
    if (!remoteInput) {
      blockers.push(
        evidenceScopeBlocker({
          code: "remote_verify_input_missing",
          stage: "remote_verify",
          message:
            "Remote verification report must record input_path for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: remoteVerifyArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, remoteInput, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "remote_verify_rows_mismatch",
          stage: "remote_verify",
          message:
            "Remote verification report input_path does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: remoteInput,
          artifact: remoteVerifyArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  return blockers;
}

function curationGateContextHasKind(curationGateArtifact, kind) {
  const details = ensureArray(
    curationGateArtifact?.value?.context?.contract_context_file_details,
  );
  if (details.some((file) => asText(file?.kind) === kind)) return true;
  const legacyPaths = ensureArray(
    curationGateArtifact?.value?.context?.contract_context_files,
  );
  const expectedFileByKind = {
    schema: "schema.json",
    methodology_yaml: "methodology.yaml",
    ruleset: "runtime-ruleset.json",
  };
  const expected = expectedFileByKind[kind];
  return Boolean(
    expected &&
    legacyPaths.some((filePath) =>
      String(filePath ?? "")
        .toLowerCase()
        .includes(expected),
    ),
  );
}

function curationGateContextHasPattern(curationGateArtifact, pattern) {
  const details = ensureArray(
    curationGateArtifact?.value?.context?.contract_context_file_details,
  );
  if (
    details.some((file) =>
      String(file?.path ?? "")
        .toLowerCase()
        .includes(pattern.toLowerCase()),
    )
  ) {
    return true;
  }
  const legacyPaths = ensureArray(
    curationGateArtifact?.value?.context?.contract_context_files,
  );
  return legacyPaths.some((filePath) =>
    String(filePath ?? "")
      .toLowerCase()
      .includes(pattern.toLowerCase()),
  );
}

function evidenceResolution(entry) {
  return entry?.resolution &&
    typeof entry.resolution === "object" &&
    !Array.isArray(entry.resolution)
    ? entry.resolution
    : null;
}

function evidenceResolutionMode(entry) {
  return asText(evidenceResolution(entry)?.mode);
}

function evidenceResolutionContextKinds(entry) {
  return ensureArray(
    evidenceResolution(entry)?.used_context_kinds ??
      evidenceResolution(entry)?.usedContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
}

function contextFileHasNonEmptyText(file) {
  return Buffer.byteLength(String(file?.text ?? ""), "utf8") > 0;
}

function contextFilesHaveKind(files, kind) {
  return ensureArray(files).some(
    (file) => asText(file?.kind) === kind && contextFileHasNonEmptyText(file),
  );
}

function contextFilesHavePattern(files, pattern) {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some(
    (file) =>
      String(file?.path ?? "")
        .toLowerCase()
        .includes(needle) && contextFileHasNonEmptyText(file),
  );
}

function readAuthoringPackageProof(
  repoRoot,
  packageRef,
  expectedSha256 = null,
  source = null,
) {
  const packagePath = resolveRepoPath(repoRoot, packageRef);
  const proof = {
    source,
    path: packageRef ? repoRelativeArtifactPath(repoRoot, packageRef) : null,
    exists: false,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    payload: null,
    contract_context_files: [],
    contract_context_file_details: [],
    blockers: [],
  };
  if (!packageRef || !packagePath || !fileExists(packagePath)) {
    proof.blockers.push({
      code: "full_context_authoring_package_missing",
      stage: "full_context_ai_completion",
      message:
        "Full-context AI completion evidence references an unreadable authoring package.",
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.exists = true;
  proof.path = repoRelativePath(repoRoot, packagePath);
  let rawText = "";
  try {
    rawText = readText(packagePath);
    proof.sha256 = sha256Text(rawText);
    proof.payload = JSON.parse(rawText);
  } catch (error) {
    proof.blockers.push({
      code: "full_context_authoring_package_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  if (
    !proof.payload ||
    typeof proof.payload !== "object" ||
    Array.isArray(proof.payload)
  ) {
    proof.blockers.push({
      code: "full_context_authoring_package_invalid",
      stage: "full_context_ai_completion",
      message: "Authoring package must be a JSON object.",
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.contract_context_files = ensureArray(
    proof.payload.contract_context_files,
  );
  proof.contract_context_file_details = contextFileDetails(
    proof.contract_context_files,
  );
  if (
    proof.expected_sha256 &&
    proof.sha256 &&
    proof.expected_sha256 !== proof.sha256
  ) {
    proof.blockers.push({
      code: "full_context_authoring_package_hash_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Recorded authoring_package_sha256 does not match the current authoring package content.",
      authoring_package: proof.path,
      expected_sha256: proof.expected_sha256,
      actual_sha256: proof.sha256,
      source,
    });
  }
  return proof;
}

function authoringPackageProofsFromCurationGate(
  repoRoot,
  curationGateArtifact,
) {
  const entities = ensureArray(
    curationGateArtifact?.value?.entities ??
      curationGateArtifact?.value?.processes ??
      curationGateArtifact?.value?.flows ??
      curationGateArtifact?.value?.items,
  );
  return entities
    .map((entity) => {
      const packageRef = asText(
        entity?.authoring_package ?? entity?.authoringPackage,
      );
      if (!packageRef) return null;
      return readAuthoringPackageProof(
        repoRoot,
        packageRef,
        entity?.authoring_package_sha256,
        "curation_gate",
      );
    })
    .filter(Boolean);
}

function authoringPackageProofsFromPatchCollect(
  repoRoot,
  patchCollectArtifact,
) {
  const manifestRef = patchCollectArtifact?.value?.task_manifest;
  const manifestPath = resolveRepoPath(repoRoot, manifestRef);
  if (!manifestRef || !manifestPath || !fileExists(manifestPath)) return [];
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch {
    return [];
  }
  return ensureArray(manifest?.tasks)
    .map((task) => {
      const packageRef = asText(
        task?.files?.authoring_package ?? task?.files?.authoringPackage,
      );
      if (!packageRef) return null;
      return readAuthoringPackageProof(
        repoRoot,
        packageRef,
        task?.context?.authoring_package_sha256,
        "patch_collect_task_manifest",
      );
    })
    .filter(Boolean);
}

function fullContextPackageProofBlockers({ requirement, proof }) {
  const blockers = [...proof.blockers];
  if (blockers.length > 0 || !proof.payload) return blockers;
  for (const kind of requirement.requiredContextKinds) {
    if (!contextFilesHaveKind(proof.contract_context_files, kind)) {
      blockers.push({
        code: "full_context_authoring_package_context_kind_missing",
        stage: "full_context_ai_completion",
        message: `Authoring package does not contain full non-empty context text for '${kind}'.`,
        required_kind: kind,
        authoring_package: proof.path,
        source: proof.source,
      });
    }
  }
  for (const pattern of requirement.requiredContextFilePatterns) {
    if (!contextFilesHavePattern(proof.contract_context_files, pattern)) {
      blockers.push({
        code: "full_context_authoring_package_context_file_missing",
        stage: "full_context_ai_completion",
        message: `Authoring package does not contain full non-empty context text for a file matching '${pattern}'.`,
        required_file_pattern: pattern,
        authoring_package: proof.path,
        source: proof.source,
      });
    }
  }
  if (ensureArray(proof.payload.missing_context_files).length > 0) {
    blockers.push({
      code: "full_context_authoring_package_missing_context_files",
      stage: "full_context_ai_completion",
      message:
        "Authoring package records missing context files and cannot prove full-context AI completion.",
      authoring_package: proof.path,
      missing_context_files: ensureArray(proof.payload.missing_context_files),
      source: proof.source,
    });
  }
  return blockers;
}

function normalizeClassificationDecisionRows(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(value?.decisions)) return value.decisions.filter(Boolean);
  if (Array.isArray(value?.rows)) return value.rows.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

function readDecisionTaskProof(
  repoRoot,
  taskRef,
  expectedSha256 = null,
  expectedContextBundleSha256 = null,
  source = null,
) {
  const taskPath = resolveRepoPath(repoRoot, taskRef);
  const proof = {
    source,
    path: taskRef ? repoRelativeArtifactPath(repoRoot, taskRef) : null,
    exists: false,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    expected_context_bundle_sha256:
      asText(expectedContextBundleSha256) || null,
    payload: null,
    status: null,
    task_kind: null,
    context_bundle_sha256: null,
    contract_context_files: [],
    contract_context_file_details: [],
    missing_context_files: [],
    shared_context_bundle: null,
    blockers: [],
  };
  if (!taskRef || !taskPath || !fileExists(taskPath)) {
    proof.blockers.push({
      code: "full_context_decision_task_missing",
      stage: "full_context_ai_completion",
      message:
        "Full-context decision evidence references an unreadable AI decision task.",
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  proof.exists = true;
  proof.path = repoRelativePath(repoRoot, taskPath);
  let rawText = "";
  try {
    rawText = readText(taskPath);
    proof.sha256 = sha256Text(rawText);
    proof.payload = JSON.parse(rawText);
  } catch (error) {
    proof.blockers.push({
      code: "full_context_decision_task_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  if (
    !proof.payload ||
    typeof proof.payload !== "object" ||
    Array.isArray(proof.payload)
  ) {
    proof.blockers.push({
      code: "full_context_decision_task_invalid",
      stage: "full_context_ai_completion",
      message: "Decision task must be a JSON object.",
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  const contextBundle =
    proof.payload.context_bundle ?? proof.payload.authoring_context ?? {};
  proof.status = asText(proof.payload.status);
  proof.task_kind = asText(proof.payload.task_kind);
  proof.context_bundle_sha256 = asText(
    contextBundle.sha256 ?? contextBundle.context_bundle_sha256,
  );
  proof.shared_context_bundle = readDecisionTaskSharedContextBundleProof(
    repoRoot,
    proof.payload,
    proof.path,
  );
  proof.blockers.push(...proof.shared_context_bundle.blockers);
  proof.contract_context_files = [
    ...ensureArray(proof.payload.contract_context_files),
    ...proof.shared_context_bundle.files,
  ];
  proof.contract_context_file_details = contextFileDetails(
    proof.contract_context_files,
  );
  proof.missing_context_files = ensureArray(proof.payload.missing_context_files);
  if (proof.expected_sha256 && proof.expected_sha256 !== proof.sha256) {
    proof.blockers.push({
      code: "full_context_decision_task_hash_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Recorded decision task sha256 does not match the current decision task content.",
      decision_task: proof.path,
      expected_sha256: proof.expected_sha256,
      actual_sha256: proof.sha256,
      source,
    });
  }
  if (
    proof.expected_context_bundle_sha256 &&
    proof.context_bundle_sha256 &&
    proof.expected_context_bundle_sha256 !== proof.context_bundle_sha256
  ) {
    proof.blockers.push({
      code: "full_context_decision_task_context_hash_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Recorded decision task context bundle hash does not match the decision task.",
      decision_task: proof.path,
      expected_context_bundle_sha256: proof.expected_context_bundle_sha256,
      actual_context_bundle_sha256: proof.context_bundle_sha256,
      source,
    });
  }
  return proof;
}

function decisionTaskProofFromApplyReport(repoRoot, report, source) {
  const task = report?.decision_task ?? report?.decisionTask;
  const taskRef = asText(
    task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask,
  );
  if (!taskRef) return null;
  return readDecisionTaskProof(
    repoRoot,
    taskRef,
    task?.sha256,
    task?.context_bundle_sha256 ?? task?.contextBundleSha256,
    source,
  );
}

function readDecisionTaskSharedContextBundleProof(repoRoot, payload, taskPath) {
  const contextBundle = payload?.context_bundle ?? payload?.authoring_context ?? {};
  const sharedContext =
    payload?.shared_context_bundle ?? contextBundle?.shared_context_bundle ?? {};
  const sharedPath = asText(
    sharedContext?.path ?? payload?.files?.shared_context_bundle,
  );
  const expectedSha256 = asText(
    sharedContext?.sha256 ?? contextBundle?.shared_context_bundle_sha256,
  );
  const proof = {
    path: sharedPath ? repoRelativeArtifactPath(repoRoot, sharedPath) : null,
    sha256: null,
    expected_sha256: expectedSha256 || null,
    files: [],
    blockers: [],
  };
  if (!sharedPath) return proof;
  const bundlePath = resolveRepoPath(repoRoot, sharedPath);
  if (!bundlePath || !fileExists(bundlePath)) {
    proof.blockers.push({
      code: "full_context_decision_task_shared_context_bundle_missing",
      stage: "full_context_ai_completion",
      message:
        "Decision task references an unreadable shared full-context bundle.",
      decision_task: taskPath,
      shared_context_bundle: proof.path,
    });
    return proof;
  }
  try {
    const bundle = readJson(bundlePath);
    proof.sha256 = asText(bundle?.sha256);
    proof.files = ensureArray(bundle?.files);
    if (expectedSha256 && proof.sha256 !== expectedSha256) {
      proof.blockers.push({
        code: "full_context_decision_task_shared_context_bundle_hash_mismatch",
        stage: "full_context_ai_completion",
        message:
          "Decision task shared context bundle sha256 no longer matches the task reference.",
        decision_task: taskPath,
        shared_context_bundle: proof.path,
        expected_sha256: expectedSha256,
        actual_sha256: proof.sha256 || null,
      });
    }
  } catch (error) {
    proof.blockers.push({
      code: "full_context_decision_task_shared_context_bundle_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      decision_task: taskPath,
      shared_context_bundle: proof.path,
    });
  }
  return proof;
}

function decisionTaskProofsFromApplyReport(repoRoot, report, source) {
  const tasks = ensureArray(report?.decision_tasks ?? report?.decisionTasks);
  if (tasks.length === 0) {
    const single = decisionTaskProofFromApplyReport(repoRoot, report, source);
    return single ? [single] : [];
  }
  return tasks
    .map((task) => {
      const taskRef = asText(
        task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask,
      );
      if (!taskRef) return null;
      return readDecisionTaskProof(
        repoRoot,
        taskRef,
        task?.sha256,
        task?.context_bundle_sha256 ?? task?.contextBundleSha256,
        source,
      );
    })
    .filter(Boolean);
}

function payloadSha256ByIdentityForRows(repoRoot, rowFiles, fallbackDatasetType = null) {
  const map = new Map();
  for (const rowFile of ensureArray(rowFiles)) {
    const resolved = resolveRepoPath(repoRoot, rowFile);
    if (!resolved || !fileExists(resolved)) continue;
    readRowsIfExists(resolved).forEach((row, index) => {
      const datasetType = detectDatasetType(row, fallbackDatasetType);
      if (!datasetType) return;
      const identity = datasetIdentity(row, index, datasetType);
      const key = identityFreshnessIdentityKey({ datasetType, identity });
      if (key) map.set(key, sha256Json(identity.payload));
    });
  }
  return map;
}

function fullContextDecisionTaskProofBlockers({ requirement, proof, label }) {
  if (!proof) {
    return [
      {
        code: `full_context_ai_${label}_decision_task_required`,
        stage: "full_context_ai_completion",
        message:
          "Decision apply report must bind to the AI decision task that carried the full schema/YAML/context bundle.",
      },
    ];
  }
  const blockers = [...proof.blockers];
  if (blockers.length > 0 || !proof.payload) return blockers;
  const expectedTaskKind =
    label === "location"
      ? "location_decision_authoring"
      : "classification_decision_authoring";
  const expectedStatus =
    label === "location"
      ? "ready_for_ai_location_decisions"
      : "ready_for_ai_classification_decisions";
  if (proof.task_kind !== expectedTaskKind) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_kind_invalid`,
      stage: "full_context_ai_completion",
      message:
        "Decision apply report must reference the matching full-context AI decision task kind.",
      decision_task: proof.path,
      expected_task_kind: expectedTaskKind,
      actual_task_kind: proof.task_kind || null,
      source: proof.source,
    });
  }
  if (proof.status !== expectedStatus) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_status_invalid`,
      stage: "full_context_ai_completion",
      message:
        "Decision apply report must reference a ready full-context AI decision task.",
      decision_task: proof.path,
      expected_status: expectedStatus,
      actual_status: proof.status || null,
      source: proof.source,
    });
  }
  for (const kind of requirement.requiredContextKinds) {
    if (!contextFilesHaveKind(proof.contract_context_files, kind)) {
      blockers.push({
        code: `full_context_ai_${label}_decision_task_context_kind_missing`,
        stage: "full_context_ai_completion",
        message: `Decision task does not contain full non-empty context text for '${kind}'.`,
        required_kind: kind,
        decision_task: proof.path,
        source: proof.source,
      });
    }
  }
  for (const pattern of decisionTaskRequiredContextFilePatterns({
    requirement,
    proof,
    label,
  })) {
    if (!contextFilesHavePattern(proof.contract_context_files, pattern)) {
      blockers.push({
        code: `full_context_ai_${label}_decision_task_context_file_missing`,
        stage: "full_context_ai_completion",
        message: `Decision task does not contain full non-empty context text for a file matching '${pattern}'.`,
        required_file_pattern: pattern,
        decision_task: proof.path,
        source: proof.source,
      });
    }
  }
  if (proof.missing_context_files.length > 0) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_missing_context_files`,
      stage: "full_context_ai_completion",
      message:
        "Decision task records missing context files and cannot prove full-context AI completion.",
      decision_task: proof.path,
      missing_context_files: proof.missing_context_files,
      source: proof.source,
    });
  }
  if (!proof.context_bundle_sha256) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_context_hash_missing`,
      stage: "full_context_ai_completion",
      message:
        "Decision task must include context_bundle.sha256 so decisions can be tied to the exact context bundle.",
      decision_task: proof.path,
      source: proof.source,
    });
  }
  return blockers;
}

function decisionTaskRequiredContextFilePatterns({ requirement, proof, label }) {
  const profilePatterns = ensureArray(requirement.requiredContextFilePatterns);
  if (label === "location") {
    return profilePatterns.filter((pattern) =>
      [
        "schema.json",
        "methodology.yaml",
        "runtime-ruleset.json",
        "tidas_locations_category.json",
      ].includes(String(pattern).toLowerCase()),
    );
  }
  if (label !== "classification") return profilePatterns;

  const schemaTypeToFile = {
    contact: "tidas_contacts_category.json",
    contacts: "tidas_contacts_category.json",
    flowproperty: "tidas_flowproperties_category.json",
    flowproperties: "tidas_flowproperties_category.json",
    "flow-elementary": "tidas_flows_elementary_category.json",
    elementary: "tidas_flows_elementary_category.json",
    "flow-product": "tidas_flows_product_category.json",
    flow: "tidas_flows_product_category.json",
    lciamethod: "tidas_lciamethods_category.json",
    lciamethods: "tidas_lciamethods_category.json",
    process: "tidas_processes_category.json",
    processes: "tidas_processes_category.json",
    source: "tidas_sources_category.json",
    sources: "tidas_sources_category.json",
    unitgroup: "tidas_unitgroups_category.json",
    unitgroups: "tidas_unitgroups_category.json",
  };
  const payload = proof?.payload ?? {};
  const schemaTypes = [
    ...ensureArray(payload.schema_types ?? payload.schemaTypes),
    ...ensureArray(payload.row_types ?? payload.rowTypes),
  ]
    .map((value) => asText(value).toLowerCase())
    .filter(Boolean);
  const required = new Set([
    "schema.json",
    "methodology.yaml",
    "runtime-ruleset.json",
    "tidas_locations_category.json",
  ]);
  for (const schemaType of schemaTypes) {
    const fileName = schemaTypeToFile[schemaType];
    if (fileName) required.add(fileName);
  }
  if (schemaTypes.length === 0) {
    for (const pattern of profilePatterns) {
      if (contextFilesHavePattern(proof?.contract_context_files, pattern)) {
        required.add(String(pattern).toLowerCase());
      }
    }
  }
  return profilePatterns.filter((pattern) =>
    required.has(String(pattern).toLowerCase()),
  );
}

function readClassificationDecisionApplyContext(
  repoRoot,
  classificationDecisionApplyArtifact,
  sourceLabel = "classification_decision_apply",
) {
  if (!classificationDecisionApplyArtifact) return null;
  const report = classificationDecisionApplyArtifact.value ?? {};
  const decisionsFile = resolveRepoPath(
    repoRoot,
    report.decisions_file || report.decisionsFile,
  );
  let decisions = [];
  if (decisionsFile && fileExists(decisionsFile)) {
    decisions = normalizeClassificationDecisionRows(
      readJsonOrJsonl(decisionsFile),
    );
  }
  const decisionTaskProofs = decisionTaskProofsFromApplyReport(
    repoRoot,
    report,
    sourceLabel,
  );
  const inputRows = ensureArray(report.files?.input_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);
  const outputRows = ensureArray(report.files?.output_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);
  const fallbackDatasetType =
    decisions.some((decision) =>
      asText(decision?.category_type ?? decision?.categoryType).startsWith(
        "flow",
      ),
    )
      ? "flow"
      : decisions.some(
            (decision) =>
              asText(decision?.category_type ?? decision?.categoryType) ===
              "process",
          )
        ? "process"
        : null;
	  return {
	    status: asText(report.status),
	    reportPath: classificationDecisionApplyArtifact.path,
	    decisionsFile,
	    decisions,
    decisionTaskProof:
      decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null,
    decisionTaskProofs,
    inputRows,
	    outputRows,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRows,
      fallbackDatasetType,
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      outputRows,
      fallbackDatasetType,
    ),
    applied: Number(report.counts?.applied ?? 0) || 0,
  };
}

function cleanupInputRowsFile(repoRoot, cleanupArtifact) {
  const inputRows =
    cleanupArtifact?.value?.rows_file ??
    cleanupArtifact?.value?.rowsFile ??
    cleanupArtifact?.value?.input_path ??
    cleanupArtifact?.value?.inputPath;
  return inputRows ? resolveRepoPath(repoRoot, inputRows) : null;
}

function decisionApplyExpectedRowsFile({ repoRoot, rowsFile, cleanupArtifact }) {
  return cleanupArtifact
    ? cleanupInputRowsFile(repoRoot, cleanupArtifact)
    : rowsFile;
}

function decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) {
  return Boolean(
    expectedRowsFile &&
      context?.outputRows.some((filePath) =>
        sameArtifactPath(repoRoot, filePath, expectedRowsFile),
      ),
  );
}

function decisionApplyInputRowsMatch(repoRoot, context, expectedRowsFile) {
  return Boolean(
    expectedRowsFile &&
      context?.inputRows.some((filePath) =>
        sameArtifactPath(repoRoot, filePath, expectedRowsFile),
      ),
  );
}

function rowsFileTransformEntriesFromDecisionApply(context, kind) {
  const entries = [];
  if (!context?.inputRows?.length || !context?.outputRows?.length) return entries;
  if (context.status && context.status !== "completed") return entries;
  for (const inputRowsFile of context.inputRows) {
    for (const outputRowsFile of context.outputRows) {
      entries.push({ kind, inputRowsFile, outputRowsFile });
    }
  }
  return entries;
}

function rowsFileTransformEntriesFromPatchApply(context) {
  if (!context?.inputRowsFile || !context?.outputRows?.length) return [];
  return context.outputRows.map((outputRowsFile) => ({
    kind: "patch_apply",
    inputRowsFile: context.inputRowsFile,
    outputRowsFile,
  }));
}

function rowsFileTransformEntryFromIdentityReferenceRewrite(context) {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  return [
    {
      kind: "identity_reference_rewrite",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
    },
  ];
}

function rowsFileTransformEntryFromUnresolvedExchangeExternalization(context) {
  if (
    context?.status !== "completed" ||
    !context.inputRowsFile ||
    !context.outputRowsFile
  ) {
    return [];
  }
  return [
    {
      kind: "unresolved_exchange_externalization",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
    },
  ];
}

function rowsFileTransformEntryFromCanonicalSupportRewrite(context) {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  const status = asText(context.status);
  if (
    status &&
    ![
      "completed",
      "completed_no_rewrites",
      "completed_with_deferred_rows",
      "blocked",
    ].includes(status)
  ) {
    return [];
  }
  return [
    {
      kind: "canonical_support_rewrite",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
    },
  ];
}

function deterministicRowsFileTransformEntries({
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  return [
    ...rowsFileTransformEntriesFromPatchApply(patchApplyContext),
    ...rowsFileTransformEntriesFromDecisionApply(
      classificationDecisionApplyContext,
      "classification_decision_apply",
    ),
    ...rowsFileTransformEntriesFromDecisionApply(
      locationDecisionApplyContext,
      "location_decision_apply",
    ),
    ...rowsFileTransformEntriesFromDecisionApply(
      identityDecisionApplyContext,
      "identity_decision_apply",
    ),
    ...rowsFileTransformEntryFromIdentityReferenceRewrite(
      identityReferenceRewriteContext,
    ),
    ...rowsFileTransformEntryFromUnresolvedExchangeExternalization(
      unresolvedExchangeExternalizationContext,
    ),
    ...rowsFileTransformEntryFromCanonicalSupportRewrite(
      canonicalSupportRewriteContext,
    ),
  ].filter((entry) => entry.inputRowsFile && entry.outputRowsFile);
}

function rowsFileReachableThroughTransformChain({
  repoRoot,
  startFiles,
  expectedRowsFile,
  transforms,
}) {
  if (!expectedRowsFile) return false;
  const reachable = [];
  const addReachable = (filePath) => {
    if (!filePath) return false;
    if (reachable.some((existing) => sameArtifactPath(repoRoot, existing, filePath))) {
      return false;
    }
    reachable.push(filePath);
    return true;
  };
  for (const filePath of ensureArray(startFiles)) addReachable(filePath);
  if (reachable.some((filePath) => sameArtifactPath(repoRoot, filePath, expectedRowsFile))) {
    return true;
  }
  for (let pass = 0; pass <= transforms.length; pass += 1) {
    let changed = false;
    for (const transform of transforms) {
      const inputReachable = reachable.some((filePath) =>
        sameArtifactPath(repoRoot, filePath, transform.inputRowsFile),
      );
      if (inputReachable) {
        changed = addReachable(transform.outputRowsFile) || changed;
      }
    }
    if (reachable.some((filePath) => sameArtifactPath(repoRoot, filePath, expectedRowsFile))) {
      return true;
    }
    if (!changed) break;
  }
  return false;
}

function decisionApplyOutputRowsReachableThroughDeterministicTransforms({
  repoRoot,
  context,
  expectedRowsFile,
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  return rowsFileReachableThroughTransformChain({
    repoRoot,
    startFiles: context?.outputRows ?? [],
    expectedRowsFile,
    transforms: deterministicRowsFileTransformEntries({
      patchApplyContext,
      classificationDecisionApplyContext,
      locationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    }),
  });
}

function decisionApplyOutputRowsChainThroughPatch(
  repoRoot,
  context,
  patchApplyContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      patchApplyContext?.inputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        patchApplyContext.inputRowsFile,
      ) &&
      patchApplyContext.outputRows.some((filePath) =>
        sameArtifactPath(repoRoot, filePath, expectedRowsFile),
      ),
  );
}

function patchApplyOutputChainsThroughIdentityRewrite({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
}) {
  return Boolean(
    patchOut &&
      cleanupInput &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      sameArtifactPath(
        repoRoot,
        patchOut,
        identityReferenceRewriteContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        cleanupInput,
      ),
  );
}

function patchApplyOutputChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  patchOut,
  cleanupInput,
  unresolvedExchangeExternalizationContext,
}) {
  return rowsFileChainsThroughUnresolvedExchangeExternalization({
    repoRoot,
    upstreamFile: patchOut,
    finalFile: cleanupInput,
    unresolvedExchangeExternalizationContext,
  });
}

function patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
}) {
  return Boolean(
    patchApplyOutputChainsThroughIdentityRewrite({
      repoRoot,
      patchOut,
      cleanupInput: unresolvedExchangeExternalizationContext?.inputRowsFile,
      identityReferenceRewriteContext,
    }) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: identityReferenceRewriteContext?.outputRowsFile,
        finalFile: cleanupInput,
        unresolvedExchangeExternalizationContext,
      }),
  );
}

function decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
  repoRoot,
  context,
  patchApplyContext,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      patchApplyContext?.inputRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        patchApplyContext.inputRowsFile,
      ) &&
      patchApplyContext.outputRows.some((filePath) =>
        sameArtifactPath(
          repoRoot,
          filePath,
          identityReferenceRewriteContext.inputRowsFile,
        ),
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        expectedRowsFile,
      ),
  );
}

function decisionApplyOutputRowsChainThroughIdentityRewrite(
  repoRoot,
  context,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        identityReferenceRewriteContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        expectedRowsFile,
      ),
  );
}

function decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot,
  context,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      unresolvedExchangeExternalizationContext?.inputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        identityReferenceRewriteContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        unresolvedExchangeExternalizationContext.inputRowsFile,
      ) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
        finalFile: expectedRowsFile,
        unresolvedExchangeExternalizationContext,
      }),
  );
}

function decisionApplyOutputRowsChainThroughClassification(
  repoRoot,
  context,
  classificationDecisionApplyContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      classificationDecisionApplyContext?.inputRows.some((filePath) =>
        decisionApplyOutputRowsMatch(repoRoot, context, filePath),
      ) &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        classificationDecisionApplyContext,
        expectedRowsFile,
      ),
  );
}

function decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
  repoRoot,
  context,
  classificationDecisionApplyContext,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      classificationDecisionApplyContext?.outputRows.some((filePath) =>
        sameArtifactPath(
          repoRoot,
          filePath,
          identityReferenceRewriteContext.inputRowsFile,
        ),
      ) &&
      decisionApplyOutputRowsChainThroughClassification(
        repoRoot,
        context,
        classificationDecisionApplyContext,
        identityReferenceRewriteContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        expectedRowsFile,
      ),
  );
}

function decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot,
  context,
  classificationDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      unresolvedExchangeExternalizationContext?.inputRowsFile &&
      decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
        repoRoot,
        context,
        classificationDecisionApplyContext,
        identityReferenceRewriteContext,
        unresolvedExchangeExternalizationContext.inputRowsFile,
      ) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
        finalFile: expectedRowsFile,
        unresolvedExchangeExternalizationContext,
      }),
  );
}

function decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
  repoRoot,
  context,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      unresolvedExchangeExternalizationContext?.inputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        unresolvedExchangeExternalizationContext.inputRowsFile,
      ) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
        finalFile: expectedRowsFile,
        unresolvedExchangeExternalizationContext,
      }),
  );
}

function decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
  repoRoot,
  context,
  patchApplyContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      patchApplyContext?.inputRowsFile &&
      unresolvedExchangeExternalizationContext?.inputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        patchApplyContext.inputRowsFile,
      ) &&
      patchApplyContext.outputRows.some((filePath) =>
        sameArtifactPath(
          repoRoot,
          filePath,
          unresolvedExchangeExternalizationContext.inputRowsFile,
        ),
      ) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
        finalFile: expectedRowsFile,
        unresolvedExchangeExternalizationContext,
      }),
  );
}

function decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot,
  context,
  patchApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      patchApplyContext?.inputRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      unresolvedExchangeExternalizationContext?.inputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        patchApplyContext.inputRowsFile,
      ) &&
      patchApplyContext.outputRows.some((filePath) =>
        sameArtifactPath(
          repoRoot,
          filePath,
          identityReferenceRewriteContext.inputRowsFile,
        ),
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        unresolvedExchangeExternalizationContext.inputRowsFile,
      ) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
        finalFile: expectedRowsFile,
        unresolvedExchangeExternalizationContext,
      }),
  );
}

function identityDecisionApplyProvesReferenceRewrite(
  repoRoot,
  context,
  identityReferenceRewriteContext,
) {
  const decisionRewriteFiles = unique([
    ...ensureArray(context?.identityReferenceRewritesFiles),
    context?.identityReferenceRewritesFile,
  ].filter(Boolean));
  if (decisionRewriteFiles.length === 0 || !identityReferenceRewriteContext?.sourceFile) {
    return false;
  }
  return decisionRewriteFiles.some((decisionRewriteFile) => {
    const directlyUsed = sameArtifactPath(
      repoRoot,
      decisionRewriteFile,
      identityReferenceRewriteContext.sourceFile,
    );
    const chainedThroughProcessRewrite =
      identityReferenceRewriteContext.scopedRows.some(
        (row) =>
          sameArtifactPath(repoRoot, row?.rewrite_source?.file, decisionRewriteFile) ||
          sameArtifactPath(repoRoot, row?.rewriteSource?.file, decisionRewriteFile),
      );
    return Boolean(
      identityReferenceRewriteContext.scopedRows.length > 0 &&
        (directlyUsed || chainedThroughProcessRewrite),
    );
  });
}

function classificationDecisionContextKinds(decision) {
  return [
    ...optionList(decision?.used_context_kinds ?? decision?.usedContextKinds),
    ...optionList(
      decision?.resolution?.used_context_kinds ??
        decision?.resolution?.usedContextKinds,
    ),
    ...optionList(
      decision?.evidence?.used_context_kinds ??
        decision?.evidence?.usedContextKinds,
    ),
  ];
}

function classificationDecisionContextBundleSha256(decision) {
  return asText(
    decision?.authoring_context?.context_bundle_sha256 ??
      decision?.authoringContext?.contextBundleSha256 ??
      decision?.authoring_context_sha256 ??
      decision?.context_bundle_sha256 ??
      decision?.contextBundleSha256,
  );
}

function classificationDecisionCompletionStatus(decision) {
  return asText(
    decision?.decision_status ?? decision?.decisionStatus ?? decision?.status,
  );
}

function decisionTaskProofListFromContext(context) {
  const proofs = ensureArray(context?.decisionTaskProofs).filter(Boolean);
  if (proofs.length > 0) return proofs;
  return context?.decisionTaskProof ? [context.decisionTaskProof] : [];
}

function decisionTaskContextBundleHashesFromContext(context) {
  return unique(
    decisionTaskProofListFromContext(context).map(
      (proof) => proof.context_bundle_sha256,
    ),
  );
}

function buildClassificationDecisionFullContextBlockers({
  repoRoot,
  rowsFile,
  cleanupArtifact,
  requirement,
  classificationDecisionApplyArtifact,
  classificationDecisionApplyContext,
  patchApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  const blockers = [];
  if (!classificationDecisionApplyArtifact) return blockers;
  const context = classificationDecisionApplyContext;
	  if (context?.status !== "completed") {
	    blockers.push({
	      code: "full_context_ai_classification_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-classification-decisions-apply status is ${context?.status || "missing"}.`,
      artifact: repoRelativePath(
        repoRoot,
        classificationDecisionApplyArtifact.path,
	      ),
	    });
	  }
  const decisionTaskProofs = decisionTaskProofListFromContext(context);
  if (decisionTaskProofs.length === 0) {
    blockers.push(
      ...fullContextDecisionTaskProofBlockers({
        requirement,
        proof: null,
        label: "classification",
      }),
    );
  } else {
    for (const proof of decisionTaskProofs) {
      blockers.push(
        ...fullContextDecisionTaskProofBlockers({
          requirement,
          proof,
          label: "classification",
        }),
      );
    }
  }
	  const expectedRowsFile = decisionApplyExpectedRowsFile({
	    repoRoot,
	    rowsFile,
    cleanupArtifact,
  });
  if (cleanupArtifact && !expectedRowsFile) {
    blockers.push({
      code: "full_context_ai_classification_cleanup_input_missing",
      stage: "full_context_ai_completion",
      message:
        "Classification decision proof cannot be chained because the cleanup report does not record its input rows_file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      artifact: repoRelativePath(
        repoRoot,
        classificationDecisionApplyArtifact.path,
      ),
      cleanup_report: repoRelativePath(repoRoot, cleanupArtifact.path),
    });
  } else if (
    !decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) &&
    !decisionApplyOutputRowsChainThroughPatch(
      repoRoot,
      context,
      patchApplyContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughIdentityRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
      repoRoot,
      context,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context,
      expectedRowsFile,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    })
  ) {
    blockers.push({
      code: "full_context_ai_classification_rows_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Classification decision apply report files.output_rows must match the cleanup input rows file, the exact mutation rows file, or the input rows of a completed patch apply report whose output rows then match that cleanup/mutation file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      expected_output_rows_file: repoRelativePath(repoRoot, expectedRowsFile),
      patch_apply_input_rows_file: patchApplyContext?.inputRowsFile
        ? repoRelativePath(repoRoot, patchApplyContext.inputRowsFile)
        : null,
      patch_apply_output_rows_files: patchApplyContext?.outputRows.map((file) =>
        repoRelativePath(repoRoot, file),
      ) ?? [],
      identity_reference_rewrite_input_rows_file:
        identityReferenceRewriteContext?.inputRowsFile
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.inputRowsFile)
          : null,
      identity_reference_rewrite_output_rows_file:
        identityReferenceRewriteContext?.outputRowsFile
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.outputRowsFile)
          : null,
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFile
          ? repoRelativePath(
              repoRoot,
              unresolvedExchangeExternalizationContext.inputRowsFile,
            )
          : null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFile
          ? repoRelativePath(
              repoRoot,
              unresolvedExchangeExternalizationContext.outputRowsFile,
            )
          : null,
      canonical_support_rewrite_input_rows_file:
        canonicalSupportRewriteContext?.inputRowsFile
          ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.inputRowsFile)
          : null,
      canonical_support_rewrite_output_rows_file:
        canonicalSupportRewriteContext?.outputRowsFile
          ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.outputRowsFile)
          : null,
      artifact: repoRelativePath(
        repoRoot,
        classificationDecisionApplyArtifact.path,
      ),
    });
  }
  if (!context?.decisions.length) {
    blockers.push({
      code: "full_context_ai_classification_decision_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "Classification decision apply report must point to at least one AI-authored classification decision.",
      artifact: repoRelativePath(
        repoRoot,
        classificationDecisionApplyArtifact.path,
      ),
    });
    return blockers;
  }
  const missingBasis = context.decisions.filter(
    (decision) => !asText(decision?.basis),
  );
  if (missingBasis.length > 0) {
    blockers.push({
      code: "full_context_ai_classification_basis_missing",
      stage: "full_context_ai_completion",
      message: "Every classification decision must include basis.",
      count: missingBasis.length,
      artifact: repoRelativePath(
        repoRoot,
        classificationDecisionApplyArtifact.path,
      ),
    });
  }
  const missingEvidence = context.decisions.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push({
      code: "full_context_ai_classification_evidence_missing",
      stage: "full_context_ai_completion",
      message: "Every classification decision must include structured evidence.",
      count: missingEvidence.length,
      artifact: repoRelativePath(
        repoRoot,
        classificationDecisionApplyArtifact.path,
      ),
      });
  }
  const notCompleted = context.decisions.filter(
    (decision) => classificationDecisionCompletionStatus(decision) !== "completed",
  );
  if (notCompleted.length > 0) {
    blockers.push({
      code: "full_context_ai_classification_decision_status_not_completed",
      stage: "full_context_ai_completion",
      message:
        "Every classification decision used as full-context AI evidence must declare decision_status=completed.",
      count: notCompleted.length,
      artifact: repoRelativePath(
        repoRoot,
        classificationDecisionApplyArtifact.path,
      ),
    });
  }
		  const missingContextKinds = [];
	  for (const decision of context.decisions) {
	    const usedKinds = new Set(classificationDecisionContextKinds(decision));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingContextKinds.push({ decision, requiredKind });
      }
    }
	  }
	  if (missingContextKinds.length > 0) {
    blockers.push({
      code: "full_context_ai_classification_context_missing",
      stage: "full_context_ai_completion",
      message:
        "Classification decision used_context_kinds must include every required full-context kind for this profile.",
      count: missingContextKinds.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: repoRelativePath(
        repoRoot,
        classificationDecisionApplyArtifact.path,
      ),
	    });
	  }
  const expectedContextBundleSha256AnyOf =
    decisionTaskContextBundleHashesFromContext(context);
  if (expectedContextBundleSha256AnyOf.length > 0) {
		    const mismatchedContextBundle = context.decisions.filter(
	      (decision) =>
        !expectedContextBundleSha256AnyOf.includes(
          classificationDecisionContextBundleSha256(decision),
        ),
	    );
	    if (mismatchedContextBundle.length > 0) {
	      blockers.push({
	        code: "full_context_ai_classification_context_bundle_mismatch",
	        stage: "full_context_ai_completion",
	        message:
          "Every classification decision must reference one of the AI decision task context_bundle_sha256 values.",
	        count: mismatchedContextBundle.length,
        expected_context_bundle_sha256:
          expectedContextBundleSha256AnyOf.length === 1
            ? expectedContextBundleSha256AnyOf[0]
            : null,
        expected_context_bundle_sha256_any_of:
          expectedContextBundleSha256AnyOf,
	        artifact: repoRelativePath(
	          repoRoot,
	          classificationDecisionApplyArtifact.path,
	        ),
	      });
	    }
	  }
	  return blockers;
	}

function readLocationDecisionApplyContext(repoRoot, locationDecisionApplyArtifact) {
  return readClassificationDecisionApplyContext(
    repoRoot,
    locationDecisionApplyArtifact,
    "location_decision_apply",
  );
}

function buildLocationDecisionFullContextBlockers({
  repoRoot,
  rowsFile,
  cleanupArtifact,
  requirement,
  locationDecisionApplyArtifact,
  locationDecisionApplyContext,
  patchApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  const blockers = [];
  if (!locationDecisionApplyArtifact) return blockers;
  const context = locationDecisionApplyContext;
	  if (context?.status !== "completed") {
	    blockers.push({
	      code: "full_context_ai_location_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-location-decisions-apply status is ${context?.status || "missing"}.`,
	      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
	    });
	  }
  const decisionTaskProofs = decisionTaskProofListFromContext(context);
  if (decisionTaskProofs.length === 0) {
    blockers.push(
      ...fullContextDecisionTaskProofBlockers({
        requirement,
        proof: null,
        label: "location",
      }),
    );
  } else {
    for (const proof of decisionTaskProofs) {
      blockers.push(
        ...fullContextDecisionTaskProofBlockers({
          requirement,
          proof,
          label: "location",
        }),
      );
    }
  }
	  const expectedRowsFile = decisionApplyExpectedRowsFile({
    repoRoot,
    rowsFile,
    cleanupArtifact,
  });
  if (cleanupArtifact && !expectedRowsFile) {
    blockers.push({
      code: "full_context_ai_location_cleanup_input_missing",
      stage: "full_context_ai_completion",
      message:
        "Location decision proof cannot be chained because the cleanup report does not record its input rows_file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
      cleanup_report: repoRelativePath(repoRoot, cleanupArtifact.path),
    });
  } else if (
    !decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) &&
    !decisionApplyOutputRowsChainThroughPatch(
      repoRoot,
      context,
      patchApplyContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughIdentityRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
      repoRoot,
      context,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context,
      expectedRowsFile,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    })
  ) {
    blockers.push({
      code: "full_context_ai_location_rows_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Location decision apply report files.output_rows must match the cleanup input rows file, the exact mutation rows file, or the input rows of a completed patch apply report whose output rows then match that cleanup/mutation file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      expected_output_rows_file: repoRelativePath(repoRoot, expectedRowsFile),
      patch_apply_input_rows_file: patchApplyContext?.inputRowsFile
        ? repoRelativePath(repoRoot, patchApplyContext.inputRowsFile)
        : null,
      patch_apply_output_rows_files: patchApplyContext?.outputRows.map((file) =>
        repoRelativePath(repoRoot, file),
      ) ?? [],
      identity_reference_rewrite_input_rows_file:
        identityReferenceRewriteContext?.inputRowsFile
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.inputRowsFile)
          : null,
      identity_reference_rewrite_output_rows_file:
        identityReferenceRewriteContext?.outputRowsFile
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.outputRowsFile)
          : null,
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFile
          ? repoRelativePath(
              repoRoot,
              unresolvedExchangeExternalizationContext.inputRowsFile,
            )
          : null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFile
          ? repoRelativePath(
              repoRoot,
              unresolvedExchangeExternalizationContext.outputRowsFile,
            )
          : null,
      canonical_support_rewrite_input_rows_file:
        canonicalSupportRewriteContext?.inputRowsFile
          ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.inputRowsFile)
          : null,
      canonical_support_rewrite_output_rows_file:
        canonicalSupportRewriteContext?.outputRowsFile
          ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.outputRowsFile)
          : null,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  if (!context?.decisions.length) {
    blockers.push({
      code: "full_context_ai_location_decision_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "Location decision apply report must point to at least one AI-authored location decision.",
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
    return blockers;
  }
  const missingBasis = context.decisions.filter(
    (decision) => !asText(decision?.basis),
  );
  if (missingBasis.length > 0) {
    blockers.push({
      code: "full_context_ai_location_basis_missing",
      stage: "full_context_ai_completion",
      message: "Every location decision must include basis.",
      count: missingBasis.length,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  const missingEvidence = context.decisions.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push({
      code: "full_context_ai_location_evidence_missing",
      stage: "full_context_ai_completion",
      message: "Every location decision must include structured evidence.",
      count: missingEvidence.length,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
      });
  }
  const notCompleted = context.decisions.filter(
    (decision) => classificationDecisionCompletionStatus(decision) !== "completed",
  );
  if (notCompleted.length > 0) {
    blockers.push({
      code: "full_context_ai_location_decision_status_not_completed",
      stage: "full_context_ai_completion",
      message:
        "Every location decision used as full-context AI evidence must declare decision_status=completed.",
      count: notCompleted.length,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  const missingContextKinds = [];
  for (const decision of context.decisions) {
    const usedKinds = new Set(classificationDecisionContextKinds(decision));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingContextKinds.push({ decision, requiredKind });
      }
    }
  }
	  if (missingContextKinds.length > 0) {
    blockers.push({
      code: "full_context_ai_location_context_missing",
      stage: "full_context_ai_completion",
      message:
        "Location decision used_context_kinds must include every required full-context kind for this profile.",
      count: missingContextKinds.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
	    });
	  }
  const expectedContextBundleSha256AnyOf =
    decisionTaskContextBundleHashesFromContext(context);
  if (expectedContextBundleSha256AnyOf.length > 0) {
		    const mismatchedContextBundle = context.decisions.filter(
	      (decision) =>
        !expectedContextBundleSha256AnyOf.includes(
          classificationDecisionContextBundleSha256(decision),
        ),
	    );
	    if (mismatchedContextBundle.length > 0) {
	      blockers.push({
	        code: "full_context_ai_location_context_bundle_mismatch",
	        stage: "full_context_ai_completion",
	        message:
          "Every location decision must reference one of the AI decision task context_bundle_sha256 values.",
	        count: mismatchedContextBundle.length,
        expected_context_bundle_sha256:
          expectedContextBundleSha256AnyOf.length === 1
            ? expectedContextBundleSha256AnyOf[0]
            : null,
        expected_context_bundle_sha256_any_of:
          expectedContextBundleSha256AnyOf,
	        artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
	      });
	    }
		  }
		  return blockers;
		}

function buildIdentityDecisionFullContextBlockers({
  repoRoot,
  rowsFile,
  cleanupArtifact,
  requirement,
  identityDecisionApplyArtifact,
  identityDecisionApplyContext,
  classificationDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  const blockers = [];
  if (!identityDecisionApplyArtifact) return blockers;
  const context = identityDecisionApplyContext;
  if (context?.status !== "completed") {
    blockers.push({
      code: "full_context_ai_identity_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-identity-decisions-apply status is ${context?.status || "missing"}.`,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const expectedRowsFile = decisionApplyExpectedRowsFile({
    repoRoot,
    rowsFile,
    cleanupArtifact,
  });
  if (cleanupArtifact && !expectedRowsFile) {
    blockers.push({
      code: "full_context_ai_identity_cleanup_input_missing",
      stage: "full_context_ai_completion",
      message:
        "Identity decision proof cannot be chained because the cleanup report does not record its input rows_file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
      cleanup_report: repoRelativePath(repoRoot, cleanupArtifact.path),
    });
  } else if (
    !decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) &&
    !decisionApplyOutputRowsChainThroughIdentityRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassification(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !identityDecisionApplyProvesReferenceRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
    ) &&
    !decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context,
      expectedRowsFile,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    })
  ) {
    blockers.push({
      code: "full_context_ai_identity_rows_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Identity decision apply report files.output_rows must match the cleanup input rows file, the exact mutation rows file, feed a completed identity reference rewrite / unresolved exchange externalization chain, or provide an identity-reference-rewrites file used by this scope.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      expected_output_rows_file: repoRelativePath(repoRoot, expectedRowsFile),
      identity_reference_rewrite_input_rows_file:
        identityReferenceRewriteContext?.inputRowsFile
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.inputRowsFile)
          : null,
      identity_reference_rewrite_output_rows_file:
        identityReferenceRewriteContext?.outputRowsFile
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.outputRowsFile)
          : null,
      classification_decision_apply_input_rows_files:
        classificationDecisionApplyContext?.inputRows.map((file) =>
          repoRelativePath(repoRoot, file),
        ) ?? [],
      classification_decision_apply_output_rows_files:
        classificationDecisionApplyContext?.outputRows.map((file) =>
          repoRelativePath(repoRoot, file),
        ) ?? [],
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFile
          ? repoRelativePath(
              repoRoot,
              unresolvedExchangeExternalizationContext.inputRowsFile,
            )
          : null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFile
          ? repoRelativePath(
              repoRoot,
              unresolvedExchangeExternalizationContext.outputRowsFile,
            )
          : null,
      canonical_support_rewrite_input_rows_file:
        canonicalSupportRewriteContext?.inputRowsFile
          ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.inputRowsFile)
          : null,
      canonical_support_rewrite_output_rows_file:
        canonicalSupportRewriteContext?.outputRowsFile
          ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.outputRowsFile)
          : null,
      identity_decision_reference_rewrites_file: context
        ?.identityReferenceRewritesFile
        ? repoRelativePath(repoRoot, context.identityReferenceRewritesFile)
        : null,
      identity_reference_rewrites_file: identityReferenceRewriteContext?.sourceFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.sourceFile)
        : null,
      identity_reference_rewrite_rows:
        identityReferenceRewriteContext?.scopedRows.length ?? 0,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  if (!context?.decisions.length) {
    blockers.push({
      code: "full_context_ai_identity_decision_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "Identity decision apply report must point to at least one AI-authored identity decision.",
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
    return blockers;
  }
  const packageProofs = ensureArray(context.authoringPackageProofs);
  if (packageProofs.length === 0) {
    blockers.push({
      code: "full_context_ai_identity_authoring_package_required",
      stage: "full_context_ai_completion",
      message:
        "Identity decisions must reference readable full-context authoring packages before remote write planning.",
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  } else {
    for (const proof of packageProofs) {
      blockers.push(...fullContextPackageProofBlockers({ requirement, proof }));
    }
  }
  const missingPackageBinding = context.decisions.filter(
    (decision) =>
      !identityDecisionPackageReference(decision) ||
      !identityDecisionPackageSha(decision),
  );
  if (missingPackageBinding.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_package_binding_missing",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision must include authoring_package and authoring_package_sha256.",
      count: missingPackageBinding.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingBasis = context.decisions.filter(
    (decision) => !asText(decision?.basis ?? decision?.reason),
  );
  if (missingBasis.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_basis_missing",
      stage: "full_context_ai_completion",
      message: "Every identity decision must include basis.",
      count: missingBasis.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingEvidence = context.decisions.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_evidence_missing",
      stage: "full_context_ai_completion",
      message: "Every identity decision must include structured evidence.",
      count: missingEvidence.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const notCompleted = context.decisions.filter(
    (decision) => classificationDecisionCompletionStatus(decision) !== "completed",
  );
  if (notCompleted.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_decision_status_not_completed",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision used as full-context AI evidence must declare decision_status=completed.",
      count: notCompleted.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingClosures = context.decisions.filter(
    (decision) =>
      !identityDecisionClosesAction(decision, "identity_preflight_manual_review") &&
      !identityDecisionClosesAction(
        decision,
        "elementary_flow_identity_manual_review",
      ),
  );
  if (missingClosures.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_action_closure_missing",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision must close identity_preflight_manual_review or elementary_flow_identity_manual_review.",
      count: missingClosures.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingCanonical = context.decisions.filter(
    (decision) =>
      identityDecisionValue(decision) === "reuse_existing_reference" &&
      !identityDecisionCanonical(decision),
  );
  if (missingCanonical.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_canonical_missing",
      stage: "full_context_ai_completion",
      message:
        "reuse_existing_reference identity decisions must include canonical ref_object_id/version.",
      count: missingCanonical.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingContextKinds = [];
  for (const decision of context.decisions) {
    const usedKinds = new Set(classificationDecisionContextKinds(decision));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingContextKinds.push({ decision, requiredKind });
      }
    }
  }
  if (missingContextKinds.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_context_missing",
      stage: "full_context_ai_completion",
      message:
        "Identity decision used_context_kinds must include every required full-context kind for this profile.",
      count: missingContextKinds.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  return blockers;
}

function buildFullContextAiCompletionBlockers({
  repoRoot,
  profile,
  datasetType,
  curationGateArtifact,
  rowsFile,
  patchApplyArtifact,
  patchApplyContext,
  patchCollectArtifact,
  cleanupArtifact,
  classificationDecisionApplyArtifact,
  classificationDecisionApplyContext,
  locationDecisionApplyArtifact,
  locationDecisionApplyContext,
  identityDecisionApplyArtifact,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  const requirement = fullContextAiCompletionRequirement(
    profile,
    datasetType,
    repoRoot,
  );
  if (!requirement) return [];
  const blockers = [];
  const curationPackageProofs = curationGateArtifact
    ? authoringPackageProofsFromCurationGate(repoRoot, curationGateArtifact)
    : [];
  const patchTaskPackageProofs = patchCollectArtifact
    ? authoringPackageProofsFromPatchCollect(repoRoot, patchCollectArtifact)
    : [];
  if (!curationGateArtifact) {
    blockers.push({
      code: "full_context_curation_gate_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires a post-authoring curation gate built with full schema/YAML/context before remote write planning.",
    });
  } else {
    for (const kind of requirement.requiredContextKinds) {
      if (!curationGateContextHasKind(curationGateArtifact, kind)) {
        blockers.push({
          code: "full_context_curation_gate_context_kind_missing",
          stage: "full_context_ai_completion",
          message: `Curation gate report does not prove full-context authoring kind '${kind}'.`,
          required_kind: kind,
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
        });
      }
    }
    for (const pattern of requirement.requiredContextFilePatterns) {
      if (!curationGateContextHasPattern(curationGateArtifact, pattern)) {
        blockers.push({
          code: "full_context_curation_gate_context_file_missing",
          stage: "full_context_ai_completion",
          message: `Curation gate report does not reference required context file '${pattern}'.`,
          required_file_pattern: pattern,
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
        });
      }
    }
  }

  for (const proof of [...curationPackageProofs, ...patchTaskPackageProofs]) {
    blockers.push(...fullContextPackageProofBlockers({ requirement, proof }));
  }

  const hasClassificationDecisionProof =
    classificationDecisionApplyArtifact &&
    classificationDecisionApplyContext?.status === "completed" &&
    classificationDecisionApplyContext.decisions.length > 0;
  const hasLocationDecisionProof =
    locationDecisionApplyArtifact &&
    locationDecisionApplyContext?.status === "completed" &&
    locationDecisionApplyContext.decisions.length > 0;
  const hasIdentityDecisionProof =
    identityDecisionApplyArtifact &&
    identityDecisionApplyContext?.status === "completed" &&
    identityDecisionApplyContext.decisions.length > 0;
  const hasDecisionProof =
    hasClassificationDecisionProof ||
    hasLocationDecisionProof ||
    hasIdentityDecisionProof;

  blockers.push(
    ...buildClassificationDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      classificationDecisionApplyArtifact,
      classificationDecisionApplyContext,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    }),
  );
  blockers.push(
    ...buildLocationDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      locationDecisionApplyArtifact,
      locationDecisionApplyContext,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    }),
  );
  blockers.push(
    ...buildIdentityDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      identityDecisionApplyArtifact,
      identityDecisionApplyContext,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    }),
  );

  if (!patchCollectArtifact && !hasDecisionProof) {
    blockers.push({
      code: "full_context_ai_completion_output_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires AI authoring output evidence from dataset-identity-decisions-apply, dataset-classification-decisions-apply, dataset-location-decisions-apply, or dataset-authoring-patch-collect before remote write planning.",
      proof: requirement.proof,
    });
  } else if (
    patchCollectArtifact &&
    patchCollectArtifact.value?.status !== "ready_for_patch_apply"
  ) {
    blockers.push({
      code: "full_context_ai_patch_collect_not_ready",
      stage: "full_context_ai_completion",
      message: `dataset-authoring-patch-collect status is ${patchCollectArtifact.value?.status ?? "missing"}.`,
      artifact: repoRelativePath(repoRoot, patchCollectArtifact.path),
    });
  }

  if (!patchApplyArtifact && !hasDecisionProof) {
    blockers.push({
      code: "full_context_ai_deterministic_apply_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires full-context AI semantic outputs to be deterministically applied through identity/classification/location decision apply or patch apply before remote write planning.",
      proof: requirement.proof,
    });
  } else if (
    patchApplyArtifact &&
    patchApplyArtifact.value?.status !== "completed"
  ) {
    blockers.push({
      code: "full_context_ai_patch_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-patch-apply status is ${patchApplyArtifact.value?.status ?? "missing"}.`,
      artifact: repoRelativePath(repoRoot, patchApplyArtifact.path),
    });
  }

  const evidenceRows = ensureArray(patchApplyContext?.evidenceRows);
  if (patchApplyArtifact && evidenceRows.length === 0) {
    blockers.push({
      code: "full_context_ai_patch_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "AI patch apply completed without patch evidence rows; semantic completion must be traceable to authoring packages.",
      artifact: repoRelativePath(repoRoot, patchApplyArtifact.path),
    });
  }
  const missingPackageHash = evidenceRows.filter(
    (entry) => !asText(entry?.authoring_package_sha256),
  );
  if (missingPackageHash.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_package_hash_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must include authoring_package_sha256 to prove it used the full authoring package context.",
      count: missingPackageHash.length,
      artifact: patchApplyArtifact
        ? repoRelativePath(repoRoot, patchApplyArtifact.path)
        : null,
    });
  }
  const knownPackageHashes = new Set(
    [...curationPackageProofs, ...patchTaskPackageProofs]
      .map((proof) => asText(proof?.sha256))
      .filter(Boolean),
  );
  const unknownPackageHash = evidenceRows.filter((entry) => {
    const hash = asText(entry?.authoring_package_sha256);
    return hash && !knownPackageHashes.has(hash);
  });
  if (unknownPackageHash.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_package_hash_unknown",
      stage: "full_context_ai_completion",
      message:
        "AI patch evidence authoring_package_sha256 must match a readable full-context authoring package from the patch task manifest or curation gate.",
      count: unknownPackageHash.length,
      artifact: patchApplyArtifact
        ? repoRelativePath(repoRoot, patchApplyArtifact.path)
        : null,
    });
  }
  const missingClosures = evidenceRows.filter(
    (entry) => ensureArray(entry?.closes_action_items).length === 0,
  );
  if (missingClosures.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_action_closure_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must close at least one authoring action item for this profile.",
      count: missingClosures.length,
      artifact: patchApplyArtifact
        ? repoRelativePath(repoRoot, patchApplyArtifact.path)
        : null,
    });
  }
  const missingResolution = evidenceRows.filter(
    (entry) => !evidenceResolutionMode(entry),
  );
  if (missingResolution.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must include resolution.mode to explain how the action item was completed or deferred.",
      count: missingResolution.length,
      artifact: patchApplyArtifact
        ? repoRelativePath(repoRoot, patchApplyArtifact.path)
        : null,
    });
  }
  const invalidResolutionMode = evidenceRows.filter((entry) => {
    const mode = evidenceResolutionMode(entry);
    return mode && !allowedPatchResolutionModes.has(mode);
  });
  if (invalidResolutionMode.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_mode_invalid",
      stage: "full_context_ai_completion",
      message: "AI patch evidence contains unsupported resolution.mode values.",
      count: invalidResolutionMode.length,
      artifact: patchApplyArtifact
        ? repoRelativePath(repoRoot, patchApplyArtifact.path)
        : null,
    });
  }
  const missingResolutionContext = [];
  for (const entry of evidenceRows) {
    const usedKinds = new Set(evidenceResolutionContextKinds(entry));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingResolutionContext.push({ entry, requiredKind });
      }
    }
  }
  if (missingResolutionContext.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_context_missing",
      stage: "full_context_ai_completion",
      message:
        "AI patch evidence resolution.used_context_kinds must include every required full-context kind for this profile.",
      count: missingResolutionContext.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: patchApplyArtifact
        ? repoRelativePath(repoRoot, patchApplyArtifact.path)
        : null,
    });
  }
  return blockers;
}

const referenceTableByTypeToken = [
  ["contact", "contacts"],
  ["flow property", "flowproperties"],
  ["flowproperty", "flowproperties"],
  ["flow data", "flows"],
  ["lcia method", "lciamethods"],
  ["lciamethod", "lciamethods"],
  ["life cycle model", "lifecyclemodels"],
  ["lifecycle model", "lifecyclemodels"],
  ["lifecyclemodel", "lifecyclemodels"],
  ["process", "processes"],
  ["source", "sources"],
  ["unit group", "unitgroups"],
  ["unitgroup", "unitgroups"],
];

const referenceTableByPathToken = [
  ["flowproperties", "flowproperties"],
  ["flowproperty", "flowproperties"],
  ["flowdataset", "flows"],
  ["lciamethod", "lciamethods"],
  ["lifecyclemodel", "lifecyclemodels"],
  ["processdataset", "processes"],
  ["datasource", "sources"],
  ["source", "sources"],
  ["datasetformat", "sources"],
  ["compliancesystem", "sources"],
  ["unitgroup", "unitgroups"],
  ["commissioner", "contacts"],
  ["personorentity", "contacts"],
  ["ownership", "contacts"],
  ["contact", "contacts"],
];

function referenceTableFromType(value) {
  const text = asText(value).toLowerCase();
  if (!text) return null;
  const match = referenceTableByTypeToken.find(([token]) =>
    text.includes(token),
  );
  return match?.[1] ?? null;
}

function referenceTableFromPath(pathSegments) {
  const text = pathSegments.join(".").toLowerCase();
  if (!text) return null;
  const compact = text.replace(/[^a-z0-9]/gu, "");
  const match = referenceTableByPathToken.find(([token]) =>
    compact.includes(token),
  );
  return match?.[1] ?? null;
}

function referenceKey({ table, id, version }) {
  return [asText(table), asText(id), asText(version)].join("\u0000");
}

function plannedRootReferenceKeys(rows, datasetType) {
  return new Set(
    rows.map((row, index) => {
      const identity = datasetIdentity(row, index, datasetType);
      return referenceKey({
        table: datasetTypePlural[identity.dataset_type || datasetType],
        id: identity.id,
        version: identity.version,
      });
    }),
  );
}

function plannedRootReferenceIds(rows, datasetType) {
  return new Set(
    rows
      .map((row, index) => datasetIdentity(row, index, datasetType).id)
      .filter(Boolean),
  );
}

function collectDatasetReferences(value, pathSegments = [], refs = []) {
  if (isFoundryTracePathSegments(pathSegments)) return refs;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectDatasetReferences(item, [...pathSegments, String(index)], refs),
    );
    return refs;
  }
  if (!value || typeof value !== "object") return refs;

  const id = asText(
    value["@refObjectId"] ??
      value.refObjectId ??
      value.ref_object_id ??
      value.ref_id,
  );
  if (id) {
    const version = asText(
      value["@version"] ?? value.version ?? value.refVersion ?? value.ref_version,
    );
    const table =
      referenceTableFromType(value["@type"] ?? value.type) ??
      referenceTableFromPath(pathSegments);
    refs.push({
      table,
      id,
      version,
      path:
        pathSegments.length > 0
          ? `/${pathSegments.map(jsonPointerToken).join("/")}`
          : "/",
      type: asText(value["@type"] ?? value.type) || null,
      short_description:
        asText(value["common:shortDescription"]?.["#text"]) ||
        asText(value.shortDescription) ||
        null,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    collectDatasetReferences(child, [...pathSegments, key], refs);
  }
  return refs;
}

function isFoundryTracePathSegments(pathSegments) {
  return (
    pathSegments.includes("common:other") &&
    pathSegments.some(
      (segment) =>
        segment.startsWith("tiangongfoundry:") &&
        segment.toLowerCase().includes("trace"),
    )
  );
}

function remoteVerifyChecks(repoRoot, remoteVerifyArtifact) {
  const checks = ensureArray(remoteVerifyArtifact?.value?.checks);
  if (checks.length > 0) return checks;
  const checksFile = remoteVerifyArtifact?.value?.files?.checks;
  const checksPath = resolveRepoPath(repoRoot, checksFile);
  return checksPath && fileExists(checksPath) ? readJsonLines(checksPath) : [];
}

function remoteVerifiedReferenceKeys(repoRoot, remoteVerifyArtifact) {
  return new Set(
    remoteVerifyChecks(repoRoot, remoteVerifyArtifact)
      .filter(
        (check) =>
          asText(check?.role) === "reference" &&
          asText(check?.status) === "ok" &&
          asText(check?.table) &&
          asText(check?.id),
      )
      .map((check) =>
        referenceKey({
          table: check.table,
          id: check.id,
          version: check.version,
        }),
      ),
  );
}

function identityReferenceRewriteProofKeys(context) {
  return new Set(
    ensureArray(context?.scopedRows)
      .map((row) => row?.canonical)
      .filter(Boolean)
      .map((canonical) => ({
          table: asText(canonical?.table) || "flows",
          id: asText(
            canonical?.ref_object_id ??
              canonical?.refObjectId ??
              canonical?.id,
          ),
          version:
            asText(
              canonical?.version ??
                canonical?.["@version"] ??
                canonical?.ref_version,
            ) || "00.00.001",
        }))
      .filter((reference) => reference.id)
      .map(referenceKey),
  );
}

function buildReferenceClosureBlockers({
  repoRoot,
  rows,
  datasetType,
  remoteVerifyArtifact,
  provenReferenceKeys = new Set(),
  unresolvedReferenceKeys = new Set(),
}) {
  const plannedRootKeys = plannedRootReferenceKeys(rows, datasetType);
  const remoteOkKeys = remoteVerifiedReferenceKeys(repoRoot, remoteVerifyArtifact);
  const blockers = [];
  const seen = new Set();
  rows.forEach((row, rowIndex) => {
    for (const ref of collectDatasetReferences(row)) {
      if (!ref.table) {
        const key = `unsupported\u0000${rowIndex}\u0000${ref.id}\u0000${ref.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        blockers.push({
          code: "reference_closure_type_unresolved",
          stage: "reference_closure",
          message:
            "A TIDAS reference could not be mapped to a dataset table, so Foundry cannot prove the write dependency closure.",
          row_index: rowIndex,
          reference_id: ref.id,
          reference_version: ref.version || null,
          reference_type: ref.type,
          path: ref.path,
        });
        continue;
      }
      const key = referenceKey(ref);
      if (
        plannedRootKeys.has(key) ||
        remoteOkKeys.has(key) ||
        provenReferenceKeys.has(key) ||
        unresolvedReferenceKeys.has(key)
      ) {
        continue;
      }
      const seenKey = `${rowIndex}\u0000${key}\u0000${ref.path}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      blockers.push({
        code: remoteVerifyArtifact
          ? "reference_closure_unproven"
          : "reference_closure_remote_verify_required",
        stage: "reference_closure",
        message: remoteVerifyArtifact
          ? "Referenced dataset is neither covered by the exact write scope nor proven reusable by the supplied remote verification report."
          : "Referenced dataset is outside the exact write scope; run remote verification after support rows exist, or include the dependency in an earlier write scope before commit handoff.",
        row_index: rowIndex,
        table: ref.table,
        reference_id: ref.id,
        reference_version: ref.version || null,
        path: ref.path,
      });
    }
  });
  return blockers;
}

function failureReasons(row) {
  return ensureArray(
    row?.reason ?? row?.reasons ?? row?.validation?.issues ?? row?.issues,
  ).map((item) => ({
    code: item?.code ?? "failure",
    stage: item?.stage ?? null,
    path: item?.path ?? null,
    message: item?.message ?? item?.error?.message ?? null,
    validator: item?.validator ?? null,
  }));
}

function decisionCounts(items) {
  const counts = {};
  for (const item of items) {
    counts[item.decision] = (counts[item.decision] ?? 0) + 1;
  }
  return counts;
}

function operationCounts(items) {
  const counts = {};
  for (const item of items) {
    if (!item.operation) continue;
    counts[item.operation] = (counts[item.operation] ?? 0) + 1;
  }
  return counts;
}

function buildWriteCandidateItem({
  repoRoot,
  datasetType,
  row,
  identity,
  rowIndex,
  schemaRow,
  curationEntity,
  curationGateProvided,
  dryRun,
  remoteVerifyBlockers,
  targetUserId,
  cleanupStatus,
  patchApplyContext,
  sourceReferenceRewritesByKey,
  identityReferenceRewritesByKey,
  identityDecisionApplyContext,
  evidenceScopeBlockers = [],
}) {
  const key = identityKey(identity);
  const blockers = [];
  blockers.push(...evidenceScopeBlockers);
  const invalidDryRunReport = evidenceScopeBlockers.some(
    (blocker) => blocker?.code === "dry_run_report_is_commit_report",
  );
  const aiPatchEvidence = patchEvidenceForRow(
    patchApplyContext,
    identity,
    rowIndex,
  );
  const sourceReferenceRewrites =
    sourceReferenceRewritesByKey?.get(key) ?? [];
  const identityReferenceRewrites =
    identityReferenceRewritesByKey?.get(key) ?? [];
  for (const blocker of patchApplyContext?.globalBlockers ?? []) {
    blockers.push(blocker);
  }
  const schemaStatus = schemaRow?.status ?? "not_found";
  if (schemaStatus !== "valid") {
    blockers.push({
      code: "schema_not_valid",
      stage: "schema",
      message: `Schema status is ${schemaStatus}.`,
      issues: ensureArray(schemaRow?.issues),
    });
  }
  if (referenceOnlySupportDatasetTypes.has(datasetType)) {
    blockers.push({
      code: "reference_only_support_type_write_blocked",
      stage: "support_reference_policy",
      message:
        "Unit Groups and Flow Properties are reference-only support data for Foundry imports. Select existing database rows and rewrite references instead of writing account-local My Data rows.",
    });
  }
  blockers.push(...prewriteIdentityBlockers(identity.payload, datasetType));

  const curationStatus = curationEntity?.status ?? null;
  if (curationGateProvided && !curationEntity) {
    blockers.push({
      code: "curation_gate_entity_missing",
      stage: "foundry_curation",
      message: "Curation gate report does not contain this write candidate.",
    });
  }
  if (
    curationEntity &&
    !["ready", "ready_with_profile_waivers"].includes(curationStatus)
  ) {
    blockers.push({
      code: "curation_gate_not_ready",
      stage: "foundry_curation",
      message: `Curation entity status is ${curationStatus}.`,
      authoring_package: curationEntity.authoring_package ?? null,
    });
  }

  if (remoteVerifyBlockers.has(identity.id)) {
    blockers.push({
      code: "remote_reference_closure_blocked",
      stage: "remote_verify",
      message: "Remote verification reported a blocker involving this entity.",
    });
  }

  if (hasImportOnlyTrace(row)) {
    blockers.push({
      code: "import_only_trace_not_cleaned",
      stage: "prewrite_cleanup",
      message:
        "Payload still contains tidasimport:sourceTrace or @xmlns:tidasimport.",
    });
  }

  if (!targetUserId) {
    blockers.push({
      code: "target_user_id_required",
      stage: "owner_guard",
      message: "Remote write planning requires an explicit target user id.",
    });
  }

  if (cleanupStatus !== "completed") {
    blockers.push({
      code: "curation_cleanup_required",
      stage: "prewrite_cleanup",
      message:
        "dataset-curation-cleanup must complete for the exact write rows before remote write planning.",
    });
  }

  let dryRunStatus = "missing";
  let operation = null;
  let dryRunEvidence = null;
  if (invalidDryRunReport) {
    dryRunStatus = "invalid_report";
  } else if (datasetType === "flow") {
    const success = dryRun.flow?.success.get(key);
    const failure = dryRun.flow?.failures.get(key);
    if (success) {
      dryRunStatus = "success";
      operation = normalizeDryRunOperation(success.operation);
      dryRunEvidence = success;
    } else if (failure) {
      dryRunStatus = "failure";
      blockers.push({
        code: "dry_run_failed",
        stage: "dry_run",
        message: "flow publish-version dry-run reported this row as failed.",
        reasons: failureReasons(failure),
      });
      dryRunEvidence = { reasons: failureReasons(failure) };
    }
  } else if (datasetType === "process") {
    const prepared = dryRun.process?.prepared.get(key);
    const failure = dryRun.process?.failures.get(key);
    if (prepared) {
      dryRunStatus = "success";
      operation = "save_draft_prepared";
      dryRunEvidence = prepared;
    } else if (failure) {
      dryRunStatus = "failure";
      blockers.push({
        code: "dry_run_failed",
        stage: "dry_run",
        message: "process save-draft dry-run reported this row as failed.",
        reasons: failureReasons(failure),
      });
      dryRunEvidence = { reasons: failureReasons(failure) };
    }
  } else if (datasetType === "lifecyclemodel") {
    const prepared = dryRun.lifecyclemodel?.prepared.get(key);
    const failure = dryRun.lifecyclemodel?.failures.get(key);
    if (prepared) {
      dryRunStatus = "success";
      operation = "save_draft_prepared";
      dryRunEvidence = prepared;
    } else if (failure) {
      dryRunStatus = "failure";
      blockers.push({
        code: "dry_run_failed",
        stage: "dry_run",
        message:
          "lifecyclemodel save-draft dry-run reported this row as failed.",
        reasons: failureReasons(failure),
      });
      dryRunEvidence = { reasons: failureReasons(failure) };
    }
  } else if (supportDatasetTypes.has(datasetType)) {
    const prepared = dryRun.datasetSaveDraft?.prepared.get(key);
    const failure = dryRun.datasetSaveDraft?.failures.get(key);
    if (prepared) {
      dryRunStatus = "success";
      operation = normalizeDryRunOperation(prepared.operation);
      dryRunEvidence = prepared;
    } else if (failure) {
      dryRunStatus = "failure";
      blockers.push({
        code: "dry_run_failed",
        stage: "dry_run",
        message: "dataset save-draft dry-run reported this support row as failed.",
        reasons: failureReasons(failure),
      });
      dryRunEvidence = { reasons: failureReasons(failure) };
    }
  }

  if (dryRunStatus === "missing") {
    blockers.push({
      code: "dry_run_evidence_missing",
      stage: "dry_run",
      message:
        "No matching dry-run success or failure artifact was found for this row.",
    });
  }

  const traceSummary = foundryTraceSummary({
    datasetType,
    identity,
    row,
    rowIndex,
  });
  blockers.push(
    ...tracePatchEvidenceBlockers({
      traceSummary,
      aiPatchEvidence,
      identityDecisionApplyContext,
    }),
  );
  const decision = blockers.length > 0 ? "blocked" : "write_or_update";
  return {
    dataset_type: datasetType,
    entity_id: identity.id,
    version: identity.version,
    role: "write_candidate",
    decision,
    operation,
    target_user_id: targetUserId,
    schema_status: schemaStatus,
    curation_status: curationStatus,
    ai_patch_apply_status: patchApplyContext?.status ?? "not_provided",
    ai_patch_evidence_count: aiPatchEvidence.length,
    ai_patch_evidence: aiPatchEvidence,
    source_reference_rewrite_count: sourceReferenceRewrites.length,
    source_reference_rewrites: sourceReferenceRewrites,
    identity_reference_rewrite_count: identityReferenceRewrites.length,
    identity_reference_rewrites: identityReferenceRewrites,
    dry_run_status: dryRunStatus,
    trace_summary_count: traceSummary.import_trace_summary_count,
    unresolved_trace_count: traceSummary.unresolved_trace_count,
    unresolved_exchange_trace_count:
      traceSummary.unresolved_exchange_trace_count,
    source_exchange_completeness_count:
      traceSummary.source_exchange_completeness_count,
    foundry_traces: {
      unresolved_traces: traceSummary.unresolved_traces,
      unresolved_exchange_traces: traceSummary.unresolved_exchange_traces,
      source_exchange_completeness: traceSummary.source_exchange_completeness,
    },
    blockers,
    dry_run_evidence: dryRunEvidence,
    source_rows_file: repoRelativePath(
      repoRoot,
      resolveRepoPath(repoRoot, identity.sourceRowsFile) ?? "",
    ),
  };
}

function buildReferenceReuseItems({
  repoRoot,
  datasetType,
  rows,
  writeCandidateKeys,
  identityReferenceRewritesByKey,
}) {
  return rows.map((row, index) => {
    const identity = datasetIdentity(row, index, datasetType);
    const key = identityKey(identity);
    const identityReferenceRewrites =
      identityReferenceRewritesByKey?.get(key) ??
      identityReferenceRewritesByKey?.get(identity.id) ??
      [];
    const traceSummary = foundryTraceSummary({
      datasetType,
      identity,
      row,
      rowIndex: index,
    });
    const alreadyWriteCandidate = writeCandidateKeys.has(key);
    const blockers = hasImportOnlyTrace(row)
      ? [
          {
            code: "reference_payload_contains_import_only_trace",
            stage: "prewrite_cleanup",
            message:
              "Reference-only rows are not written, but the payload snapshot still contains import-only trace metadata.",
          },
        ]
      : [];
    return {
      dataset_type: datasetType,
      entity_id: identity.id,
      version: identity.version,
      role: "reference_reuse",
      decision: alreadyWriteCandidate
        ? "covered_by_write_candidate"
        : "reuse_existing_reference",
      operation: null,
      target_user_id: null,
      schema_status: "not_required_for_reference_reuse",
      curation_status: "not_required_for_reference_reuse",
      dry_run_status: "not_required_for_reference_reuse",
      identity_reference_rewrite_count: identityReferenceRewrites.length,
      identity_reference_rewrites: identityReferenceRewrites,
      canonical_references: identityReferenceRewrites
        .map((rewrite) => rewrite.canonical)
        .filter(Boolean),
      trace_summary_count: traceSummary.import_trace_summary_count,
      unresolved_trace_count: traceSummary.unresolved_trace_count,
      unresolved_exchange_trace_count:
        traceSummary.unresolved_exchange_trace_count,
      source_exchange_completeness_count:
        traceSummary.source_exchange_completeness_count,
      foundry_traces: {
        unresolved_traces: traceSummary.unresolved_traces,
        unresolved_exchange_traces: traceSummary.unresolved_exchange_traces,
        source_exchange_completeness: traceSummary.source_exchange_completeness,
      },
      blockers,
    };
  });
}

export function runDatasetMutationManifest({ repoRoot, options = {} } = {}) {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-mutation-manifest",
      usage: [
        "node scripts/foundry.mjs dataset-mutation-manifest --type flow --rows-file <ready-flow-rows.jsonl> --schema-report <validation-report.json> --dry-run-report <flow-publish-report.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <ready-processes.jsonl> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --remote-verify-report <remote-verification-report.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type lifecyclemodel --rows-file <ready-lifecyclemodels.jsonl> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type flow --rows-file <classified-flows.jsonl> --classification-decision-apply-report <classification-decisions-apply-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <located-processes.jsonl> --location-decision-apply-report <location-decisions-apply-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <patched-cleaned-rows.jsonl> --patch-collect-report <authoring-patch-collect-report.json> --require-patch-collect-report --patch-apply-report <dataset-patch-apply-report.json> --cleanup-report <dataset-curation-cleanup-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
      ],
      purpose:
        "Build a prewrite mutation manifest that separates write/update candidates, reusable existing references, and blocked rows before any commit.",
    };
  }

  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const referenceRowsFile = resolveRepoPath(
    repoRoot,
    options.referenceRowsFile || options.referenceRows || options.reuseRowsFile,
  );
  const schemaReportArtifact = readJsonIfOption(repoRoot, options.schemaReport);
  const curationGateArtifact = readJsonIfOption(
    repoRoot,
    options.curationGateReport,
  );
  const dryRunReportArtifact = readJsonIfOption(repoRoot, options.dryRunReport);
  const remoteVerifyArtifact = readJsonIfOption(
    repoRoot,
    options.remoteVerifyReport,
  );
  const cleanupArtifact = readJsonIfOption(repoRoot, options.cleanupReport);
  const patchApplyArtifact = readJsonIfOption(
    repoRoot,
    options.patchApplyReport,
  );
  const patchCollectArtifact = readJsonIfOption(
    repoRoot,
    options.patchCollectReport ?? options.authoringPatchCollectReport,
  );
  const classificationDecisionApplyArtifact = readJsonIfOption(
    repoRoot,
    options.classificationDecisionApplyReport ??
      options.classificationDecisionsApplyReport,
  );
  const locationDecisionApplyArtifact = readJsonIfOption(
    repoRoot,
    options.locationDecisionApplyReport ?? options.locationDecisionsApplyReport,
  );
  const identityDecisionApplyArtifacts = readJsonArtifactsIfOption(
    repoRoot,
    identityDecisionApplyReportOptionValues(options),
  );
  const identityDecisionApplyArtifact = identityDecisionApplyArtifacts[0] ?? null;
  const patchEvidenceFile = readFileArtifactIfOption(
    repoRoot,
    options.patchEvidenceFile || options.patchEvidence,
  );
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-mutation-manifest`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const targetUserId = asText(
    options.targetUserId ??
      options.targetOwnerId ??
      dryRunReportArtifact?.value?.target_user_id_override ??
      process.env.FOUNDRY_TARGET_USER_ID,
  );
  const profileId = String(options.profile || "generic")
    .trim()
    .toLowerCase();
  const profile = profileFor(repoRoot, profileId, options);
  const fullContextRequirement = fullContextAiCompletionRequirement(
    profile,
    datasetType,
    repoRoot,
  );
  const classificationDecisionApplyContext =
    classificationDecisionApplyArtifact
      ? readClassificationDecisionApplyContext(
          repoRoot,
          classificationDecisionApplyArtifact,
        )
      : null;
  const locationDecisionApplyContext = locationDecisionApplyArtifact
    ? readLocationDecisionApplyContext(repoRoot, locationDecisionApplyArtifact)
    : null;
  const identityDecisionApplyContext = readIdentityDecisionApplyContexts(
    repoRoot,
    identityDecisionApplyArtifacts,
  );
  const unresolvedExchangeExternalizationArtifact = readJsonIfOption(
    repoRoot,
    options.unresolvedExchangeExternalizationReport,
  );
  const unresolvedExchangeExternalizationContext =
    readUnresolvedExchangeExternalizationContext(
      repoRoot,
      unresolvedExchangeExternalizationArtifact,
    );
  const canonicalSupportRewriteArtifact = readJsonIfOption(
    repoRoot,
    options.canonicalSupportRewriteReport ||
      options.canonicalSupportRewritesReport,
  );
  const canonicalSupportRewriteContext = readCanonicalSupportRewriteContext(
    repoRoot,
    canonicalSupportRewriteArtifact,
  );
  const hasClassificationDecisionProof =
    classificationDecisionApplyContext?.status === "completed" &&
    classificationDecisionApplyContext.decisions.length > 0;
  const hasLocationDecisionProof =
    locationDecisionApplyContext?.status === "completed" &&
    locationDecisionApplyContext.decisions.length > 0;
  const hasIdentityDecisionProof =
    identityDecisionApplyContext?.status === "completed" &&
    identityDecisionApplyContext.decisions.length > 0;
  const requirePatchCollectReport =
    options.requirePatchCollectReport === true ||
    options.requirePatchCollectReport === "true" ||
    (Boolean(fullContextRequirement) &&
      !hasClassificationDecisionProof &&
      !hasLocationDecisionProof &&
      !hasIdentityDecisionProof);

  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error(
      "--rows-file is required and must point to JSON/JSONL write-candidate rows.",
    );
  }
  if (!schemaReportArtifact) {
    throw new Error(
      "--schema-report is required for mutation manifest generation.",
    );
  }

  const rows = readRows(rowsFile);
  const referenceRows = readRowsIfExists(referenceRowsFile);
  const schemaRows = mapSchemaRows(schemaReportArtifact.value);
  const curationEntities = mapCurationEntities(curationGateArtifact?.value);
  const writeRows = mapRowsByIdentity(rows, datasetType);
  const writeCandidateKeys = new Set(writeRows.keys());
  const sourceReferenceRewriteContext = readSourceReferenceRewriteContext({
    repoRoot,
    rowsFile,
    options,
    writeRows,
  });
  const identityReferenceRewriteContext = readIdentityReferenceRewriteContext({
    repoRoot,
    rowsFile,
    options,
    writeRows,
    referenceRows,
    datasetType,
  });
  const plannedRootKeys = plannedRootReferenceKeys(rows, datasetType);
  const plannedRootIds = plannedRootReferenceIds(rows, datasetType);
  const remoteVerifyBlockers = remoteVerifyBlockerKeys(
    remoteVerifyArtifact?.value,
    { plannedRootKeys, plannedRootIds },
  );
  const patchApplyContext =
    patchApplyArtifact || patchEvidenceFile
      ? readPatchApplyContext(repoRoot, patchApplyArtifact, patchEvidenceFile)
      : null;
  const evidenceScopeBlockers = buildEvidenceScopeBlockers({
    repoRoot,
    rowsFile,
    schemaReportArtifact,
    curationGateArtifact,
    dryRunReportArtifact,
    cleanupArtifact,
    patchApplyArtifact,
    patchApplyContext,
    patchCollectArtifact,
    requirePatchCollectReport,
    remoteVerifyArtifact,
    requireCurationGate:
      options.requireCurationGate === undefined
        ? !(datasetType === "support" || supportDatasetTypes.has(datasetType))
        : options.requireCurationGate === true ||
          options.requireCurationGate === "true",
    identityReferenceRewriteContext,
    unresolvedExchangeExternalizationContext,
    canonicalSupportRewriteContext,
  });
  evidenceScopeBlockers.push(
    ...buildFullContextAiCompletionBlockers({
      repoRoot,
      profile,
      datasetType,
      curationGateArtifact,
      rowsFile,
      patchApplyArtifact,
      patchApplyContext,
      patchCollectArtifact,
      cleanupArtifact,
      classificationDecisionApplyArtifact,
      classificationDecisionApplyContext,
      locationDecisionApplyArtifact,
      locationDecisionApplyContext,
      identityDecisionApplyArtifact,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    }),
  );
  evidenceScopeBlockers.push(
    ...buildReferenceClosureBlockers({
      repoRoot,
      rows,
      datasetType,
      remoteVerifyArtifact,
      provenReferenceKeys: identityReferenceRewriteProofKeys(
        identityReferenceRewriteContext,
      ),
      unresolvedReferenceKeys: identityDecisionUnresolvedReferenceKeys(
        identityDecisionApplyContext,
      ),
    }),
  );
  if (
    dryRunReportArtifact?.value?.mode === "commit" ||
    dryRunReportArtifact?.value?.commit === true
  ) {
    evidenceScopeBlockers.push(
      evidenceScopeBlocker({
        code: "dry_run_report_is_commit_report",
        stage: "dry_run",
        message:
          "dataset-mutation-manifest --dry-run-report must point to a dry-run summary, not a commit summary. Keep commit reports as post-write evidence alongside dataset verify-remote.",
        report: dryRunReportArtifact.path,
      }),
    );
  }
  const dryRun = {
    flow:
      datasetType === "flow" && dryRunReportArtifact
        ? readFlowDryRunArtifacts(repoRoot, dryRunReportArtifact.value)
        : null,
    process:
      datasetType === "process" && dryRunReportArtifact
        ? readProcessDryRunArtifacts(repoRoot, dryRunReportArtifact.value)
        : null,
    lifecyclemodel:
      datasetType === "lifecyclemodel" && dryRunReportArtifact
        ? readLifecyclemodelDryRunArtifacts(
            repoRoot,
            dryRunReportArtifact.value,
          )
        : null,
    datasetSaveDraft:
      (datasetType === "support" || supportDatasetTypes.has(datasetType)) &&
      dryRunReportArtifact
        ? readDatasetSaveDraftDryRunArtifacts(
            repoRoot,
            dryRunReportArtifact.value,
          )
        : null,
  };

  for (const entry of writeRows.values()) {
    entry.identity.sourceRowsFile = repoRelativePath(repoRoot, rowsFile);
  }

  const writeItems = [...writeRows.values()].map(({ row, identity, index }) => {
    const itemDatasetType = identity.dataset_type || datasetType;
    const key = identityKey(identity);
    return buildWriteCandidateItem({
      repoRoot,
      datasetType: itemDatasetType,
      row,
      identity,
      rowIndex: index,
      schemaRow: schemaRows.get(key) ?? schemaRows.get(identity.id) ?? null,
      curationEntity:
        curationEntities.get(key) ?? curationEntities.get(identity.id) ?? null,
      curationGateProvided: Boolean(curationGateArtifact),
      dryRun,
      remoteVerifyBlockers,
      targetUserId,
      cleanupStatus: cleanupArtifact?.value?.status ?? "not_provided",
      patchApplyContext,
      sourceReferenceRewritesByKey: sourceReferenceRewriteContext.byIdentity,
      identityReferenceRewritesByKey:
        identityReferenceRewriteContext.byIdentity,
      identityDecisionApplyContext,
      evidenceScopeBlockers,
    });
  });
  const referenceItems = buildReferenceReuseItems({
    repoRoot,
    datasetType,
    rows: referenceRows,
    writeCandidateKeys,
    identityReferenceRewritesByKey:
      identityReferenceRewriteContext.byIdentity,
  });
  const items = [...writeItems, ...referenceItems];
  const unresolvedTraceItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.unresolved_traces),
  );
  const unresolvedExchangeTraceItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.unresolved_exchange_traces),
  );
  const sourceExchangeCompletenessItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.source_exchange_completeness),
  );
  const blockerCount = items.reduce(
    (total, item) => total + item.blockers.length,
    0,
  );
  const cleanupStatus = cleanupArtifact?.value?.status ?? "not_provided";
  const remoteVerifyStatus =
    remoteVerifyArtifact?.value?.status ?? "not_provided";
  const status =
    blockerCount > 0
      ? "blocked"
      : writeItems.length > 0
        ? "ready_for_remote_write"
        : "ready_reference_only";
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status,
    profile: profile.id,
    dataset_type: datasetType,
    rows_file: repoRelativePath(repoRoot, rowsFile),
    reference_rows_file:
      referenceRowsFile && fileExists(referenceRowsFile)
        ? repoRelativePath(repoRoot, referenceRowsFile)
        : null,
    target_user_id: targetUserId || null,
    policy_snapshots: readPolicySnapshots(repoRoot, profile),
    evidence: {
      schema_report: repoRelativePath(repoRoot, schemaReportArtifact.path),
      curation_gate_report: curationGateArtifact
        ? repoRelativePath(repoRoot, curationGateArtifact.path)
        : null,
      cleanup_report: cleanupArtifact
        ? repoRelativePath(repoRoot, cleanupArtifact.path)
        : null,
      cleanup_status: cleanupStatus,
      patch_apply_report: patchApplyArtifact
        ? repoRelativePath(repoRoot, patchApplyArtifact.path)
        : null,
      patch_apply_status: patchApplyContext?.status ?? "not_provided",
      patch_collect_report: patchCollectArtifact
        ? repoRelativePath(repoRoot, patchCollectArtifact.path)
        : null,
      patch_collect_status:
        patchCollectArtifact?.value?.status ?? "not_provided",
      patch_collect_required: requirePatchCollectReport,
      patch_evidence_file: patchApplyContext?.evidenceFile
        ? repoRelativePath(repoRoot, patchApplyContext.evidenceFile)
        : null,
      patch_evidence_count: patchApplyContext?.evidenceRows.length ?? 0,
      classification_decision_apply_report: classificationDecisionApplyArtifact
        ? repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path)
        : null,
	      classification_decision_apply_status:
	        classificationDecisionApplyContext?.status ?? "not_provided",
	      classification_decision_count:
	        classificationDecisionApplyContext?.decisions.length ?? 0,
	      classification_decision_task:
	        classificationDecisionApplyContext?.decisionTaskProof?.path ?? null,
      classification_decision_tasks:
        classificationDecisionApplyContext?.decisionTaskProofs?.map(
          (proof) => proof.path,
        ) ?? [],
	      classification_decision_context_bundle_sha256:
	        classificationDecisionApplyContext?.decisionTaskProof
	          ?.context_bundle_sha256 ?? null,
      classification_decision_context_bundle_sha256s:
        decisionTaskContextBundleHashesFromContext(
          classificationDecisionApplyContext,
        ),
	      location_decision_apply_report: locationDecisionApplyArtifact
	        ? repoRelativePath(repoRoot, locationDecisionApplyArtifact.path)
	        : null,
	      location_decision_apply_status:
	        locationDecisionApplyContext?.status ?? "not_provided",
	      location_decision_count:
	        locationDecisionApplyContext?.decisions.length ?? 0,
	      location_decision_task:
	        locationDecisionApplyContext?.decisionTaskProof?.path ?? null,
      location_decision_tasks:
        locationDecisionApplyContext?.decisionTaskProofs?.map(
          (proof) => proof.path,
        ) ?? [],
	      location_decision_context_bundle_sha256:
	        locationDecisionApplyContext?.decisionTaskProof
	          ?.context_bundle_sha256 ?? null,
	      location_decision_context_bundle_sha256s:
	        decisionTaskContextBundleHashesFromContext(locationDecisionApplyContext),
      identity_decision_apply_report: identityDecisionApplyArtifact
        ? repoRelativePath(repoRoot, identityDecisionApplyArtifact.path)
        : null,
      identity_decision_apply_reports: identityDecisionApplyArtifacts.map(
        (artifact) => repoRelativePath(repoRoot, artifact.path),
      ),
      identity_decision_apply_status:
        identityDecisionApplyContext?.status ?? "not_provided",
      identity_decision_count:
        identityDecisionApplyContext?.decisions.length ?? 0,
      identity_decision_authoring_packages:
        identityDecisionApplyContext?.authoringPackageProofs.map(
          (proof) => proof.path,
        ) ?? [],
	      dry_run_report: dryRunReportArtifact
	        ? repoRelativePath(repoRoot, dryRunReportArtifact.path)
	        : null,
      remote_verify_report: remoteVerifyArtifact
        ? repoRelativePath(repoRoot, remoteVerifyArtifact.path)
        : null,
      remote_verify_status: remoteVerifyStatus,
      canonical_support_rewrite_report:
        canonicalSupportRewriteContext?.reportPathRelative ?? null,
      canonical_support_rewrite_status:
        canonicalSupportRewriteContext?.status ?? "not_provided",
      canonical_support_rewrite_input_rows:
        canonicalSupportRewriteContext?.inputRowsFileRelative ?? null,
      canonical_support_rewrite_output_rows:
        canonicalSupportRewriteContext?.outputRowsFileRelative ?? null,
      canonical_support_rewrite_deferred_rows:
        canonicalSupportRewriteContext?.deferredRowsFileRelative ?? null,
      canonical_support_rewrite_input_row_count:
        canonicalSupportRewriteContext?.counts?.input_rows ?? null,
      canonical_support_rewrite_output_row_count:
        canonicalSupportRewriteContext?.counts?.output_rows ?? null,
      canonical_support_rewrite_deferred_row_count:
        canonicalSupportRewriteContext?.counts?.deferred_rows ?? 0,
      canonical_support_rewrite_blockers:
        canonicalSupportRewriteContext?.blockers.length ?? 0,
      canonical_support_rewrite_deferred_blockers:
        canonicalSupportRewriteContext?.deferredBlockers.length ?? 0,
      unresolved_exchange_externalization_report:
        unresolvedExchangeExternalizationContext?.reportPathRelative ?? null,
      unresolved_exchange_externalization_status:
        unresolvedExchangeExternalizationContext?.status ?? "not_provided",
      unresolved_exchange_externalized_count:
        unresolvedExchangeExternalizationContext?.externalizedExchanges ?? 0,
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFileRelative ?? null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFileRelative ?? null,
      unresolved_exchange_externalization_traces_file:
        unresolvedExchangeExternalizationContext?.tracesFileRelative ?? null,
      source_reference_rewrites_file:
        sourceReferenceRewriteContext.sourceFile &&
        sourceReferenceRewriteContext.sourceRows.length > 0
          ? repoRelativePath(repoRoot, sourceReferenceRewriteContext.sourceFile)
          : null,
      identity_reference_rewrites_file:
        identityReferenceRewriteContext.sourceFile &&
        identityReferenceRewriteContext.sourceRows.length > 0
          ? repoRelativePath(
              repoRoot,
              identityReferenceRewriteContext.sourceFile,
            )
          : null,
      full_context_ai_completion_required: Boolean(fullContextRequirement),
      full_context_ai_completion_proof: fullContextRequirement?.proof ?? null,
      scope_blockers: evidenceScopeBlockers,
    },
    counts: {
      write_candidates: writeItems.length,
      reference_reuse: referenceItems.filter(
        (item) => item.decision === "reuse_existing_reference",
      ).length,
      covered_by_write_candidate: referenceItems.filter(
        (item) => item.decision === "covered_by_write_candidate",
      ).length,
      blocked_items: items.filter((item) => item.blockers.length > 0).length,
      blockers: blockerCount,
      decisions: decisionCounts(items),
      operations: operationCounts(items),
      ai_patch_evidence_entries: writeItems.reduce(
        (total, item) => total + item.ai_patch_evidence_count,
        0,
      ),
      ai_classification_decision_entries:
        classificationDecisionApplyContext?.decisions.length ?? 0,
	      ai_location_decision_entries:
	        locationDecisionApplyContext?.decisions.length ?? 0,
      ai_identity_decision_entries:
        identityDecisionApplyContext?.decisions.length ?? 0,
	      unresolved_trace_entries: unresolvedTraceItems.length,
      unresolved_exchange_trace_entries: unresolvedExchangeTraceItems.length,
      source_exchange_completeness_entries:
        sourceExchangeCompletenessItems.length,
      source_reference_rewrites:
        sourceReferenceRewriteContext.scopedRows.length,
      identity_reference_rewrites:
        identityReferenceRewriteContext.scopedRows.length,
      identity_reference_reuse_rows: referenceItems.filter(
        (item) => item.identity_reference_rewrite_count > 0,
      ).length,
      unresolved_exchange_externalized:
        unresolvedExchangeExternalizationContext?.externalizedExchanges ?? 0,
    },
    items,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "dataset-mutation-manifest.json");
  const itemsPath = path.join(outDir, "dataset-mutation-manifest-items.jsonl");
  const writeRowsPath = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.write-candidates.jsonl`,
  );
  const referenceRowsPath = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.reference-reuse.jsonl`,
  );
  const unresolvedTracesPath = path.join(outDir, "unresolved-traces.jsonl");
  const unresolvedExchangeTracesPath = path.join(
    outDir,
    "unresolved-exchange-traces.jsonl",
  );
  const sourceExchangeCompletenessPath = path.join(
    outDir,
    "source-exchange-completeness-traces.jsonl",
  );
  const sourceReferenceRewritesPath = path.join(
    outDir,
    "source-reference-rewrites.jsonl",
  );
  const identityReferenceRewritesPath = path.join(
    outDir,
    "identity-reference-rewrites.jsonl",
  );
  const files = {
    report: repoRelativePath(repoRoot, reportPath),
    items: repoRelativePath(repoRoot, itemsPath),
    write_candidates: repoRelativePath(repoRoot, writeRowsPath),
    reference_reuse: repoRelativePath(repoRoot, referenceRowsPath),
    unresolved_traces: repoRelativePath(repoRoot, unresolvedTracesPath),
    unresolved_exchange_traces: repoRelativePath(
      repoRoot,
      unresolvedExchangeTracesPath,
    ),
    source_exchange_completeness_traces: repoRelativePath(
      repoRoot,
      sourceExchangeCompletenessPath,
    ),
    source_reference_rewrites: repoRelativePath(
      repoRoot,
      sourceReferenceRewritesPath,
    ),
    identity_reference_rewrites: repoRelativePath(
      repoRoot,
      identityReferenceRewritesPath,
    ),
    unresolved_exchange_externalization_report:
      unresolvedExchangeExternalizationContext?.reportPathRelative ?? null,
    unresolved_exchange_traces:
      unresolvedExchangeExternalizationContext?.tracesFileRelative ?? null,
  };
  writeJson(reportPath, { ...report, files });
  writeText(itemsPath, jsonLines(items));
  writeText(writeRowsPath, jsonLines(rows));
  writeText(referenceRowsPath, jsonLines(referenceRows));
  writeText(unresolvedTracesPath, jsonLines(unresolvedTraceItems));
  writeText(unresolvedExchangeTracesPath, jsonLines(unresolvedExchangeTraceItems));
  writeText(
    sourceExchangeCompletenessPath,
    jsonLines(sourceExchangeCompletenessItems),
  );
  writeText(
    sourceReferenceRewritesPath,
    jsonLines(sourceReferenceRewriteContext.scopedRows),
  );
  writeText(
    identityReferenceRewritesPath,
    jsonLines(identityReferenceRewriteContext.scopedRows),
  );
  return {
    ...report,
    files,
  };
}
