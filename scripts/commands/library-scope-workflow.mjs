import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readOnlyStageContract } from "../lib/stage-contract.mjs";

const libraryScopeStageContract = readOnlyStageContract([
  {
    stage: "library_index",
    phase: "prepare",
    purpose:
      "Build one root TIDAS entity index so bundle-local copies do not multiply authoring or identity work.",
    inputs: ["root tidas/processes", "root tidas/flows", "root tidas/flowproperties", "root tidas/unitgroups"],
    outputs: ["library-entity-index.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "scope_projection",
    phase: "rewrite_cleanup",
    purpose:
      "Project unique library decisions back to process-bundle scopes with dependency closure evidence.",
    inputs: ["process-bundles/index.json", "bundle manifest.json files"],
    outputs: ["scope-projection.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "decision_resolution",
    phase: "gate_validate",
    purpose:
      "Merge AI identity/classification decisions and canonical support mappings into ready or blocked process scopes.",
    inputs: ["identity-decisions.jsonl", "classification-decisions.jsonl", "canonical-support-mappings.jsonl"],
    outputs: ["library-resolution.json", "scope-checkpoints.jsonl", "blocked-scope-ledger.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "scope_run",
    phase: "report",
    purpose:
      "Run only dependency-closed scopes through the local scope runner and keep blocked scopes out of write queues.",
    inputs: ["library-resolution.json", "scope file"],
    outputs: ["scope-checkpoints.jsonl", "blocked-scope-ledger.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
]);

const indexedEntityTypes = ["process", "flow", "flowproperty", "unitgroup"];

export function createLibraryScopeWorkflowCommands({
  asText,
  booleanOption,
  bundleClassificationPath,
  cloneJson,
  datasetIdentity,
  directoryExists,
  ensureArray,
  fileExists,
  flowTypeOfDataSet,
  jsonSha256,
  nowIso,
  positiveIntegerOption,
  readJson,
  readJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  sha256Text,
  textValue,
  writeJson,
  writeJsonLines,
}) {
  const typePlural = {
    process: "processes",
    flow: "flows",
    flowproperty: "flowproperties",
    unitgroup: "unitgroups",
  };

  function help(command, purpose, usage) {
    return {
      schema_version: 1,
      status: "help",
      command,
      purpose,
      usage,
      remote_write_mode: "read-only",
      ...libraryScopeStageContract,
    };
  }

  function normalizedText(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase();
  }

  function listJsonFiles(dir) {
    if (!directoryExists(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  }

  function sourceDirOption(options) {
    return resolveRepoPath(options.sourceDir || options.input || options.root);
  }

  function processBundlesDirOption(options, sourceDir = null) {
    return resolveRepoPath(
      options.processBundlesDir ||
        options.bundlesDir ||
        (sourceDir ? path.join(sourceDir, "process-bundles") : null),
    );
  }

  function libraryIndexDirOption(options) {
    const resolved = resolveRepoPath(options.libraryIndex || options.indexDir);
    if (!resolved) return null;
    return fileExists(resolved) ? path.dirname(resolved) : resolved;
  }

  function datasetDataSetInformation(payload, type) {
    if (type === "flow") {
      return payload?.flowDataSet?.flowInformation?.dataSetInformation ?? {};
    }
    if (type === "process") {
      return payload?.processDataSet?.processInformation?.dataSetInformation ?? {};
    }
    if (type === "flowproperty") {
      return (
        payload?.flowPropertyDataSet?.flowPropertiesInformation
          ?.dataSetInformation ?? {}
      );
    }
    if (type === "unitgroup") {
      return payload?.unitGroupDataSet?.unitGroupInformation?.dataSetInformation ?? {};
    }
    return {};
  }

  function datasetName(payload, type) {
    const info = datasetDataSetInformation(payload, type);
    if (type === "flow" || type === "process") {
      const name = info.name ?? {};
      return [
        textValue(name.baseName),
        textValue(name.treatmentStandardsRoutes),
        textValue(name.mixAndLocationTypes),
        textValue(name.functionalUnitFlowProperties),
        textValue(info["common:shortName"]),
      ]
        .filter(Boolean)
        .join("; ");
    }
    return textValue(info["common:name"] ?? info["common:shortName"]);
  }

  function referenceRows(value, pathSegments = []) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) {
      return value.flatMap((item, index) =>
        referenceRows(item, [...pathSegments, index]),
      );
    }
    const rows = [];
    if (value["@refObjectId"]) {
      rows.push({
        path: pathSegments.join("."),
        type: asText(value["@type"]),
        id: asText(value["@refObjectId"]),
        version: asText(value["@version"]) || "00.00.001",
        short_description: textValue(value["common:shortDescription"]),
      });
    }
    for (const [key, child] of Object.entries(value)) {
      rows.push(...referenceRows(child, [...pathSegments, key]));
    }
    return rows;
  }

  function classificationPath(payload, type) {
    if (type === "flow") {
      const info = datasetDataSetInformation(payload, type);
      const categories =
        info.classificationInformation?.["common:elementaryFlowCategorization"]?.[
          "common:category"
        ];
      const elementaryPath = ensureArray(categories)
        .map((entry) => textValue(entry))
        .filter(Boolean)
        .join(" > ");
      if (elementaryPath) return elementaryPath;
    }
    return bundleClassificationPath(payload, type);
  }

  function unitGroupUnits(payload) {
    return ensureArray(payload?.unitGroupDataSet?.units?.unit)
      .map((unit) => ({
        internal_id: asText(unit?.["@dataSetInternalID"]),
        name: textValue(unit?.name ?? unit?.["common:name"]),
        mean_value: asText(unit?.meanValue),
      }))
      .filter((unit) => unit.name || unit.internal_id);
  }

  function flowPropertyReferenceUnitGroup(payload) {
    const ref =
      payload?.flowPropertyDataSet?.flowPropertiesInformation
        ?.quantitativeReference?.referenceToReferenceUnitGroup ?? {};
    return {
      id: asText(ref["@refObjectId"]),
      version: asText(ref["@version"]) || "00.00.001",
      short_description: textValue(ref["common:shortDescription"]),
    };
  }

  function flowPropertyRefs(payload) {
    return ensureArray(payload?.flowDataSet?.flowProperties?.flowProperty)
      .map((property) => {
        const ref = property?.referenceToFlowPropertyDataSet ?? {};
        return {
          id: asText(ref["@refObjectId"]),
          version: asText(ref["@version"]) || "00.00.001",
          short_description: textValue(ref["common:shortDescription"]),
          internal_id: asText(property?.["@dataSetInternalID"]),
          mean_value: asText(property?.meanValue),
        };
      })
      .filter((ref) => ref.id);
  }

  function processExchangeRefs(payload) {
    return ensureArray(payload?.processDataSet?.exchanges?.exchange)
      .map((exchange, index) => {
        const ref = exchange?.referenceToFlowDataSet ?? {};
        return {
          exchange_index: index,
          flow_id: asText(ref["@refObjectId"]),
          flow_version: asText(ref["@version"]) || "00.00.001",
          direction: asText(exchange?.exchangeDirection),
          amount: asText(exchange?.meanAmount ?? exchange?.resultingAmount),
          short_description: textValue(ref["common:shortDescription"]),
        };
      })
      .filter((ref) => ref.flow_id);
  }

  function entitySemanticKey(payload, type) {
    const info = datasetDataSetInformation(payload, type);
    const parts = [
      type,
      datasetName(payload, type),
      type === "flow" ? flowTypeOfDataSet(payload) : "",
      type === "flow" ? asText(info.CASNumber) : "",
      classificationPath(payload, type),
      type === "flowproperty"
        ? flowPropertyReferenceUnitGroup(payload).short_description
        : "",
      type === "unitgroup" ? unitGroupUnits(payload).map((u) => u.name).join(",") : "",
    ].map(normalizedText);
    return parts.filter(Boolean).join("|");
  }

  function entityRowFromPayload({ payload, type, sourceFile, sourceKind }) {
    const identity = datasetIdentity(payload, type);
    const id = identity.id || path.basename(sourceFile, ".json");
    const version = identity.version || "00.00.001";
    const flowType = type === "flow" ? flowTypeOfDataSet(payload) : null;
    const row = {
      schema_version: 1,
      entity_key: `${type}:${id}:${version}`,
      dataset_type: type,
      dataset_id: id,
      dataset_version: version,
      source_kind: sourceKind,
      source_file: repoRelativePath(sourceFile),
      payload_sha256: jsonSha256(payload),
      semantic_key: entitySemanticKey(payload, type),
      semantic_hash: sha256Text(entitySemanticKey(payload, type)),
      name: datasetName(payload, type),
      classification_path: classificationPath(payload, type),
      flow_type: flowType,
      reference_only:
        type === "unitgroup" ||
        type === "flowproperty" ||
        (type === "flow" && /^elementary flow$/iu.test(flowType)),
      references: referenceRows(payload),
    };
    if (type === "flow") {
      row.flow_property_refs = flowPropertyRefs(payload);
    }
    if (type === "flowproperty") {
      row.reference_unit_group = flowPropertyReferenceUnitGroup(payload);
    }
    if (type === "unitgroup") {
      row.units = unitGroupUnits(payload);
    }
    return row;
  }

  function addEntityRow(rowMap, row) {
    const existing = rowMap.get(row.entity_key);
    if (!existing) {
      rowMap.set(row.entity_key, { ...row, source_files: [row.source_file] });
      return;
    }
    existing.source_files.push(row.source_file);
    existing.duplicate_source_file_count = existing.source_files.length;
    existing.payload_hashes = [
      ...new Set([...(existing.payload_hashes ?? [existing.payload_sha256]), row.payload_sha256]),
    ];
  }

  function buildEntityIndex(sourceDir) {
    const rowMap = new Map();
    for (const type of indexedEntityTypes) {
      const dir = path.join(sourceDir, "tidas", typePlural[type]);
      for (const filePath of listJsonFiles(dir)) {
        const payload = readJson(filePath);
        addEntityRow(
          rowMap,
          entityRowFromPayload({
            payload,
            type,
            sourceFile: filePath,
            sourceKind: "root_tidas",
          }),
        );
      }
    }
    return [...rowMap.values()].sort((left, right) =>
      left.entity_key.localeCompare(right.entity_key),
    );
  }

  function entityMaps(entityRows) {
    const byKey = new Map(entityRows.map((row) => [row.entity_key, row]));
    const byTypeId = new Map();
    for (const row of entityRows) {
      byTypeId.set(`${row.dataset_type}:${row.dataset_id}`, row);
      byTypeId.set(
        `${row.dataset_type}:${row.dataset_id}:${row.dataset_version}`,
        row,
      );
    }
    return { byKey, byTypeId };
  }

  function processBundleEntries(processBundlesDir) {
    function resolveBundlePath(value, expectedKind) {
      if (!value) return null;
      if (path.isAbsolute(value)) return value;
      const fromBundleRoot = path.join(processBundlesDir, value);
      if (
        (expectedKind === "file" && fileExists(fromBundleRoot)) ||
        (expectedKind === "dir" && directoryExists(fromBundleRoot))
      ) {
        return fromBundleRoot;
      }
      return resolveRepoPath(value);
    }
    const indexFile = path.join(processBundlesDir, "index.json");
    if (fileExists(indexFile)) {
      const index = readJson(indexFile);
      return ensureArray(index.bundles).map((bundle) => {
        const manifest = resolveBundlePath(bundle.manifest, "file");
        const tidasDir = resolveBundlePath(bundle.tidas_dir, "dir");
        const bundleDir = manifest
          ? path.dirname(manifest)
          : tidasDir
            ? path.dirname(tidasDir)
            : path.join(processBundlesDir, asText(bundle.process_id));
        return {
          process_id: asText(bundle.process_id),
          bundle_dir: bundleDir,
          manifest: manifest || path.join(bundleDir, "manifest.json"),
          tidas_dir: tidasDir || path.join(bundleDir, "tidas"),
          index_row: bundle,
        };
      });
    }
    if (!directoryExists(processBundlesDir)) return [];
    return fs
      .readdirSync(processBundlesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const bundleDir = path.join(processBundlesDir, entry.name);
        return {
          process_id: entry.name,
          bundle_dir: bundleDir,
          manifest: path.join(bundleDir, "manifest.json"),
          tidas_dir: path.join(bundleDir, "tidas"),
          index_row: null,
        };
      })
      .filter((entry) => fileExists(entry.manifest))
      .sort((left, right) => left.process_id.localeCompare(right.process_id));
  }

  function bundlePayloadsFromManifest(bundle) {
    const manifest = fileExists(bundle.manifest) ? readJson(bundle.manifest) : {};
    const payloads = Object.fromEntries(indexedEntityTypes.map((type) => [type, []]));
    for (const type of indexedEntityTypes) {
      const plural = typePlural[type];
      for (const relativeFile of ensureArray(manifest.files?.[plural])) {
        const filePath = path.join(bundle.bundle_dir, relativeFile);
        if (!fileExists(filePath)) continue;
        payloads[type].push({ filePath, payload: readJson(filePath) });
      }
    }
    return { manifest, payloads };
  }

  function entityKeyForRef(type, id, version = "00.00.001") {
    return `${type}:${id}:${version || "00.00.001"}`;
  }

  function rootEntityForRef(maps, type, id, version = "00.00.001") {
    return (
      maps.byKey.get(entityKeyForRef(type, id, version)) ||
      maps.byTypeId.get(`${type}:${id}:${version}`) ||
      maps.byTypeId.get(`${type}:${id}`) ||
      null
    );
  }

  function projectionForBundle(bundle, maps) {
    const { manifest, payloads } = bundlePayloadsFromManifest(bundle);
    const processPayload =
      payloads.process[0]?.payload ||
      (fileExists(path.join(bundle.tidas_dir, "processes", `${bundle.process_id}.json`))
        ? readJson(path.join(bundle.tidas_dir, "processes", `${bundle.process_id}.json`))
        : null);
    const processIdentity = processPayload
      ? datasetIdentity(processPayload, "process")
      : { id: bundle.process_id, version: "00.00.001" };
    const processId = processIdentity.id || bundle.process_id;
    const processVersion = processIdentity.version || "00.00.001";
    const processEntity =
      rootEntityForRef(maps, "process", processId, processVersion) ||
      (processPayload
        ? entityRowFromPayload({
            payload: processPayload,
            type: "process",
            sourceFile: payloads.process[0]?.filePath || bundle.manifest,
            sourceKind: "bundle_fallback",
          })
        : null);
    const flowDeps = new Map();
    const flowPropertyDeps = new Map();
    const unitGroupDeps = new Map();
    const exchangeRefs = processPayload ? processExchangeRefs(processPayload) : [];

    for (const flow of payloads.flow) {
      const identity = datasetIdentity(flow.payload, "flow");
      if (identity.id) {
        flowDeps.set(identity.id, {
          id: identity.id,
          version: identity.version || "00.00.001",
          source: "bundle_manifest",
        });
      }
    }
    for (const ref of exchangeRefs) {
      flowDeps.set(ref.flow_id, {
        id: ref.flow_id,
        version: ref.flow_version,
        source: "process_exchange",
        exchange_index: ref.exchange_index,
      });
    }

    for (const dep of flowDeps.values()) {
      const rootFlow = rootEntityForRef(maps, "flow", dep.id, dep.version);
      for (const fp of ensureArray(rootFlow?.flow_property_refs)) {
        flowPropertyDeps.set(fp.id, {
          id: fp.id,
          version: fp.version || "00.00.001",
          source: "flow_property_ref",
          parent_flow_id: dep.id,
        });
      }
    }
    for (const flowProperty of payloads.flowproperty) {
      const identity = datasetIdentity(flowProperty.payload, "flowproperty");
      if (identity.id) {
        flowPropertyDeps.set(identity.id, {
          id: identity.id,
          version: identity.version || "00.00.001",
          source: "bundle_manifest",
        });
      }
    }
    for (const dep of flowPropertyDeps.values()) {
      const rootFlowProperty = rootEntityForRef(
        maps,
        "flowproperty",
        dep.id,
        dep.version,
      );
      const unitGroup = rootFlowProperty?.reference_unit_group;
      if (unitGroup?.id) {
        unitGroupDeps.set(unitGroup.id, {
          id: unitGroup.id,
          version: unitGroup.version || "00.00.001",
          source: "flowproperty_reference_unit_group",
          parent_flow_property_id: dep.id,
        });
      }
    }
    for (const unitGroup of payloads.unitgroup) {
      const identity = datasetIdentity(unitGroup.payload, "unitgroup");
      if (identity.id) {
        unitGroupDeps.set(identity.id, {
          id: identity.id,
          version: identity.version || "00.00.001",
          source: "bundle_manifest",
        });
      }
    }

    const flowDependencyRows = [...flowDeps.values()].map((dep) => {
      const entity = rootEntityForRef(maps, "flow", dep.id, dep.version);
      return {
        ...dep,
        entity_key: entity?.entity_key ?? entityKeyForRef("flow", dep.id, dep.version),
        flow_type: entity?.flow_type ?? null,
        reference_only: Boolean(entity?.reference_only),
      };
    });
    const flowPropertyDependencyRows = [...flowPropertyDeps.values()].map((dep) => {
      const entity = rootEntityForRef(maps, "flowproperty", dep.id, dep.version);
      return {
        ...dep,
        entity_key:
          entity?.entity_key ?? entityKeyForRef("flowproperty", dep.id, dep.version),
        reference_only: true,
      };
    });
    const unitGroupDependencyRows = [...unitGroupDeps.values()].map((dep) => {
      const entity = rootEntityForRef(maps, "unitgroup", dep.id, dep.version);
      return {
        ...dep,
        entity_key:
          entity?.entity_key ?? entityKeyForRef("unitgroup", dep.id, dep.version),
        reference_only: true,
      };
    });

    return {
      schema_version: 1,
      process_id: processId,
      process_version: processVersion,
      process_entity_key:
        processEntity?.entity_key ?? entityKeyForRef("process", processId, processVersion),
      process_file: repoRelativeMaybe(payloads.process[0]?.filePath),
      bundle_dir: repoRelativePath(bundle.bundle_dir),
      manifest: repoRelativePath(bundle.manifest),
      tidas_dir: repoRelativePath(bundle.tidas_dir),
      dependency_ids: {
        flows: flowDependencyRows,
        flowproperties: flowPropertyDependencyRows,
        unitgroups: unitGroupDependencyRows,
      },
      usage_refs: {
        process_exchange_flow_refs: exchangeRefs,
      },
      estimated_weight:
        1 +
        flowDependencyRows.length +
        flowPropertyDependencyRows.length +
        unitGroupDependencyRows.length +
        exchangeRefs.length,
      closure_status: "planned",
      unresolved_references: ensureArray(manifest.unresolved_references),
    };
  }

  function runDatasetLibraryIndexBuild(options) {
    if (options.help) {
      return help(
        "dataset-library-index-build",
        "Build root TIDAS unique entity index and process-scope projection for a process-bundled source library.",
        [
          "node scripts/foundry.mjs dataset-library-index-build --source-dir <BAFU-root> --process-bundles-dir <BAFU-root>/process-bundles --out-dir <run-dir>/library-index",
        ],
      );
    }
    const sourceDir = sourceDirOption(options);
    if (!sourceDir || !directoryExists(sourceDir)) {
      throw new Error("--source-dir is required and must point to a source library root.");
    }
    const processBundlesDir = processBundlesDirOption(options, sourceDir);
    if (!processBundlesDir || !directoryExists(processBundlesDir)) {
      throw new Error("--process-bundles-dir is required and must point to process-bundles.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(sourceDir, ".foundry", "library-index"),
    );
    const entityRows = buildEntityIndex(sourceDir);
    const maps = entityMaps(entityRows);
    const projectionRows = processBundleEntries(processBundlesDir).map((bundle) =>
      projectionForBundle(bundle, maps),
    );
    const entityIndexPath = path.join(outDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(outDir, "scope-projection.jsonl");
    const reportPath = path.join(outDir, "dataset-library-index-build-report.json");
    writeJsonLines(entityIndexPath, entityRows);
    writeJsonLines(scopeProjectionPath, projectionRows);
    const countsByType = Object.fromEntries(
      indexedEntityTypes.map((type) => [
        type,
        entityRows.filter((row) => row.dataset_type === type).length,
      ]),
    );
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: "completed",
      command: "dataset-library-index-build",
      source_dir: repoRelativePath(sourceDir),
      process_bundles_dir: repoRelativePath(processBundlesDir),
      counts: {
        unique_entities: entityRows.length,
        process_scopes: projectionRows.length,
        ...countsByType,
        elementary_flows: entityRows.filter(
          (row) => row.dataset_type === "flow" && /^elementary flow$/iu.test(row.flow_type),
        ).length,
        reference_only_support: entityRows.filter((row) =>
          ["flowproperty", "unitgroup"].includes(row.dataset_type),
        ).length,
      },
      files: {
        report: repoRelativePath(reportPath),
        library_entity_index: repoRelativePath(entityIndexPath),
        scope_projection: repoRelativePath(scopeProjectionPath),
      },
      policy: {
        root_tidas_is_unique_entity_source: true,
        process_bundles_index_is_scope_projection_source: true,
      },
      blockers: [],
    };
    writeJson(reportPath, report);
    return report;
  }

  function chunkRows(rows, chunkSize) {
    const chunks = [];
    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize));
    }
    return chunks;
  }

  function writeChunkFiles(outDir, stem, rows, chunkSize) {
    const chunksDir = path.join(outDir, "chunks");
    return chunkRows(rows, chunkSize).map((chunk, index) => {
      const filePath = path.join(
        chunksDir,
        `${stem}.chunk-${String(index + 1).padStart(4, "0")}.jsonl`,
      );
      writeJsonLines(filePath, chunk);
      return repoRelativePath(filePath);
    });
  }

  function runDatasetLibraryAuthoringPlan(options) {
    if (options.help) {
      return help(
        "dataset-library-authoring-plan",
        "Create deduplicated AI authoring templates for library-level identity, classification, and canonical support decisions.",
        [
          "node scripts/foundry.mjs dataset-library-authoring-plan --library-index <run-dir>/library-index --out-dir <run-dir>/authoring-plan",
        ],
      );
    }
    const indexDir = libraryIndexDirOption(options);
    if (!indexDir) throw new Error("--library-index is required.");
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!fileExists(entityIndexPath) || !fileExists(scopeProjectionPath)) {
      throw new Error("--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "authoring-plan"),
    );
    const chunkSize = positiveIntegerOption(options.chunkSize, 200);
    const entityRows = readJsonLines(entityIndexPath);
    const projectionRows = readJsonLines(scopeProjectionPath);
    const usedEntityKeys = new Set(
      projectionRows.flatMap((scope) => [
        scope.process_entity_key,
        ...ensureArray(scope.dependency_ids?.flows).map((dep) => dep.entity_key),
        ...ensureArray(scope.dependency_ids?.flowproperties).map((dep) => dep.entity_key),
        ...ensureArray(scope.dependency_ids?.unitgroups).map((dep) => dep.entity_key),
      ]),
    );
    const identityTemplateRows = entityRows
      .filter(
        (row) =>
          row.dataset_type === "flow" &&
          /^elementary flow$/iu.test(row.flow_type) &&
          usedEntityKeys.has(row.entity_key),
      )
      .map((row) => ({
        schema_version: 1,
        decision: "__AI_DECIDE_REUSE_EXISTING_REFERENCE_OR_BLOCK__",
        dataset_type: "flow",
        source_dataset_id: row.dataset_id,
        source_dataset_version: row.dataset_version,
        source_entity_key: row.entity_key,
        source_name: row.name,
        flow_type: row.flow_type,
        classification_path: row.classification_path,
        required_resolution:
          "If physically identity-equivalent to an existing TianGong elementary flow, return reuse_existing_reference with canonical_flow_id/version and evidence. Otherwise return manual_review/block_unresolved.",
      }));
    const classificationTemplateRows = entityRows
      .filter(
        (row) =>
          usedEntityKeys.has(row.entity_key) &&
          (row.dataset_type === "process" ||
            (row.dataset_type === "flow" && !/^elementary flow$/iu.test(row.flow_type))),
      )
      .map((row) => ({
        schema_version: 1,
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        entity_key: row.entity_key,
        category_type:
          row.dataset_type === "process" ? "process" : "flow-product",
        selected_code: "__AI_SELECT_CLASSIFICATION_CODE__",
        basis: "__AI_WRITE_MEANING_BASED_BASIS__",
        confidence: "__AI_CONFIDENCE__",
        source_name: row.name,
        converted_classification_reference: row.classification_path,
        required_resolution:
          "Classify from the real meaning of the process/flow. tidas-tools classification is weak reference only.",
      }));
    const supportTemplateRows = entityRows
      .filter(
        (row) =>
          usedEntityKeys.has(row.entity_key) &&
          ["flowproperty", "unitgroup"].includes(row.dataset_type),
      )
      .map((row) => ({
        schema_version: 1,
        support_type: row.dataset_type,
        source_support_id: row.dataset_id,
        source_support_version: row.dataset_version,
        source_entity_key: row.entity_key,
        source_name: row.name,
        source_units: row.units ?? null,
        source_reference_unit_group: row.reference_unit_group ?? null,
        canonical_support_id: "__AI_OR_HUMAN_SELECT_CANONICAL_SUPPORT_ID__",
        canonical_support_version: "__AI_OR_HUMAN_SELECT_CANONICAL_SUPPORT_VERSION__",
        physical_dimension_evidence:
          "__REQUIRED_FOR_AUTOMATIC_MAPPING_OR_LEAVE_BLOCKED__",
        required_resolution:
          "Map generated support to public canonical support only when unit/physical dimension equivalence is proven; otherwise leave blocked for human support authoring.",
      }));

    const identityPath = path.join(outDir, "identity-decisions.template.jsonl");
    const classificationPathOut = path.join(
      outDir,
      "classification-decisions.template.jsonl",
    );
    const supportPath = path.join(outDir, "canonical-support-mappings.template.jsonl");
    writeJsonLines(identityPath, identityTemplateRows);
    writeJsonLines(classificationPathOut, classificationTemplateRows);
    writeJsonLines(supportPath, supportTemplateRows);
    const chunkFiles = [
      ...writeChunkFiles(outDir, "identity-decisions", identityTemplateRows, chunkSize),
      ...writeChunkFiles(
        outDir,
        "classification-decisions",
        classificationTemplateRows,
        chunkSize,
      ),
      ...writeChunkFiles(
        outDir,
        "canonical-support-mappings",
        supportTemplateRows,
        chunkSize,
      ),
    ];
    const reportPath = path.join(outDir, "dataset-library-authoring-plan-report.json");
    const actionItems =
      identityTemplateRows.length +
      classificationTemplateRows.length +
      supportTemplateRows.length;
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status:
        actionItems > 0
          ? "ready_for_ai_library_decisions"
          : "ready_no_action_items",
      command: "dataset-library-authoring-plan",
      library_index: repoRelativePath(indexDir),
      counts: {
        identity_decisions: identityTemplateRows.length,
        classification_decisions: classificationTemplateRows.length,
        canonical_support_mappings: supportTemplateRows.length,
        action_items: actionItems,
        chunks: chunkFiles.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        identity_decisions_template: repoRelativePath(identityPath),
        classification_decisions_template: repoRelativePath(classificationPathOut),
        canonical_support_mappings_template: repoRelativePath(supportPath),
        chunks: chunkFiles,
      },
      blockers: [],
    };
    writeJson(reportPath, report);
    return report;
  }

  function readDecisionRows(decisionsDir, fileName, optionValue) {
    const explicit = resolveRepoPath(optionValue);
    const filePath = explicit || path.join(decisionsDir, fileName);
    return fileExists(filePath) ? readJsonLines(filePath) : [];
  }

  function identityDecisionKey(row) {
    return [
      "flow",
      asText(row.source_dataset_id || row.dataset_id || row.source_flow_id || row.id),
      asText(row.source_dataset_version || row.dataset_version || row.version) ||
        "00.00.001",
    ].join(":");
  }

  function classificationDecisionKey(row) {
    return [
      asText(row.dataset_type || row.type),
      asText(row.dataset_id || row.id),
      asText(row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function supportDecisionKey(row) {
    return [
      asText(row.support_type || row.dataset_type || row.type),
      asText(row.source_support_id || row.dataset_id || row.id),
      asText(row.source_support_version || row.dataset_version || row.version) ||
        "00.00.001",
    ].join(":");
  }

  function canonicalTarget(row, type) {
    const source = row ?? {};
    const target = source.canonical_target || source.target || {};
    return {
      id: asText(
        source.canonical_flow_id ||
          source.canonical_support_id ||
          source.canonical_id ||
          source.target_dataset_id ||
          target.id,
      ),
      version:
        asText(
          source.canonical_flow_version ||
            source.canonical_support_version ||
            source.canonical_version ||
            source.target_dataset_version ||
            target.version,
        ) || "00.00.001",
      uri: asText(source.canonical_uri || target.uri),
      short_description: textValue(
        source.canonical_short_description ||
          source.short_description ||
          target.short_description,
      ),
      type,
    };
  }

  function decisionIsCompleteClassification(row) {
    const source = row ?? {};
    return Boolean(
      asText(
        source.selected_code ||
          source.code ||
          source.leaf_code ||
          source.class_id ||
          source.cat_id,
      ),
    );
  }

  function exchangePreservationHash(exchange) {
    const clone = cloneJson(exchange);
    delete clone.referenceToFlowDataSet;
    return jsonSha256(clone);
  }

  function rewriteProcessExchangeReferences(scope, identityByKey, maps, outDir) {
    const processFile = resolveRepoPath(scope.process_file);
    if (!processFile || !fileExists(processFile)) {
      return { rewritten_process_file: null, rewrite_rows: [] };
    }
    const payload = readJson(processFile);
    const exchanges = ensureArray(payload?.processDataSet?.exchanges?.exchange);
    const rewriteRows = [];
    exchanges.forEach((exchange, index) => {
      const ref = exchange?.referenceToFlowDataSet;
      const flowId = asText(ref?.["@refObjectId"]);
      const flowVersion = asText(ref?.["@version"]) || "00.00.001";
      const rootFlow = rootEntityForRef(maps, "flow", flowId, flowVersion);
      if (!rootFlow || !/^elementary flow$/iu.test(rootFlow.flow_type)) return;
      const decision = identityByKey.get(`flow:${flowId}:${flowVersion}`);
      if (asText(decision?.decision) !== "reuse_existing_reference") return;
      const target = canonicalTarget(decision, "flow data set");
      if (!target.id) return;
      const beforePreservationHash = exchangePreservationHash(exchange);
      const previousReference = cloneJson(ref);
      exchange.referenceToFlowDataSet = {
        "@type": previousReference?.["@type"] || "flow data set",
        "@refObjectId": target.id,
        "@version": target.version,
        "@uri": target.uri || `../flows/${target.id}.json`,
        "common:shortDescription":
          decision.canonical_short_description ||
          previousReference?.["common:shortDescription"] ||
          target.short_description ||
          undefined,
      };
      const afterPreservationHash = exchangePreservationHash(exchange);
      rewriteRows.push({
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        exchange_index: index,
        source_flow_id: flowId,
        source_flow_version: flowVersion,
        canonical_flow_id: target.id,
        canonical_flow_version: target.version,
        changed_path: "referenceToFlowDataSet",
        preserved_exchange_fields: beforePreservationHash === afterPreservationHash,
        before_preservation_hash: beforePreservationHash,
        after_preservation_hash: afterPreservationHash,
      });
    });
    if (rewriteRows.length === 0) {
      return { rewritten_process_file: null, rewrite_rows: [] };
    }
    const rewrittenFile = path.join(
      outDir,
      "rewritten-processes",
      `${scope.process_id}.json`,
    );
    writeJson(rewrittenFile, payload);
    return {
      rewritten_process_file: repoRelativePath(rewrittenFile),
      rewrite_rows: rewriteRows,
    };
  }

  function blockRow(scope, dependency, code, message, requiredHumanAction) {
    return {
      schema_version: 1,
      blocked_process_id: scope.process_id,
      blocked_process_version: scope.process_version,
      blocking_dependency: dependency,
      reason: code,
      message,
      required_human_action: requiredHumanAction,
      rerun_command:
        "node scripts/foundry.mjs dataset-library-decisions-apply --library-index <library-index> --decisions-dir <decisions-dir> --out-dir <library-resolution>",
    };
  }

  function increment(map, key, count = 1) {
    const normalizedKey = asText(key) || "unknown";
    map.set(normalizedKey, (map.get(normalizedKey) ?? 0) + count);
  }

  function sortedCountObject(map) {
    return Object.fromEntries(
      [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  function compactBlockingDependency(row) {
    const dependency = row.blocking_dependency ?? {};
    return {
      dataset_type: asText(dependency.dataset_type || dependency.type) || "unknown",
      id: asText(dependency.id || dependency.dataset_id),
      version:
        asText(dependency.version || dependency.dataset_version) || "00.00.001",
      reason: asText(row.reason) || "unknown",
      message: asText(row.message),
      required_human_action: asText(row.required_human_action),
    };
  }

  function blockerScopeKey(row) {
    return [
      asText(row.blocked_process_id || row.process_id),
      asText(row.blocked_process_version || row.process_version) || "00.00.001",
    ].join(":");
  }

  function buildBlockedScopeReport({
    command,
    blockedRows,
    blockedLedgerPath,
    reportPath,
  }) {
    const sampleLimit = 20;
    const reasonMap = new Map();
    const scopeMap = new Map();
    const dependencyTypeCounts = new Map();
    for (const row of blockedRows) {
      const reason = asText(row.reason) || "unknown";
      const dependency = compactBlockingDependency(row);
      increment(dependencyTypeCounts, dependency.dataset_type);

      if (!reasonMap.has(reason)) {
        reasonMap.set(reason, {
          reason,
          blocked_ledger_rows: 0,
          blocked_scope_ids: new Set(),
          blocking_dependency_types: new Map(),
          messages: new Set(),
          required_human_actions: new Set(),
          sample_blocking_dependencies: [],
        });
      }
      const reasonEntry = reasonMap.get(reason);
      reasonEntry.blocked_ledger_rows += 1;
      reasonEntry.blocked_scope_ids.add(asText(row.blocked_process_id));
      increment(reasonEntry.blocking_dependency_types, dependency.dataset_type);
      if (row.message) reasonEntry.messages.add(asText(row.message));
      if (row.required_human_action) {
        reasonEntry.required_human_actions.add(asText(row.required_human_action));
      }
      if (reasonEntry.sample_blocking_dependencies.length < sampleLimit) {
        reasonEntry.sample_blocking_dependencies.push({
          process_id: asText(row.blocked_process_id),
          process_version:
            asText(row.blocked_process_version) || "00.00.001",
          ...dependency,
        });
      }

      const scopeKey = blockerScopeKey(row);
      if (!scopeMap.has(scopeKey)) {
        scopeMap.set(scopeKey, {
          process_id: asText(row.blocked_process_id),
          process_version:
            asText(row.blocked_process_version) || "00.00.001",
          blocker_count: 0,
          reasons: new Map(),
          sample_blocking_dependencies: [],
          rerun_commands: new Set(),
        });
      }
      const scopeEntry = scopeMap.get(scopeKey);
      scopeEntry.blocker_count += 1;
      increment(scopeEntry.reasons, reason);
      if (row.rerun_command) scopeEntry.rerun_commands.add(asText(row.rerun_command));
      if (scopeEntry.sample_blocking_dependencies.length < sampleLimit) {
        scopeEntry.sample_blocking_dependencies.push(dependency);
      }
    }

    const reasonSummary = [...reasonMap.values()]
      .sort((left, right) => left.reason.localeCompare(right.reason))
      .map((entry) => ({
        reason: entry.reason,
        blocked_ledger_rows: entry.blocked_ledger_rows,
        blocked_scope_count: entry.blocked_scope_ids.size,
        blocking_dependency_types: sortedCountObject(entry.blocking_dependency_types),
        messages: [...entry.messages].sort(),
        required_human_actions: [...entry.required_human_actions].sort(),
        sample_blocking_dependencies: entry.sample_blocking_dependencies,
      }));
    const scopeSummary = [...scopeMap.values()]
      .sort((left, right) => left.process_id.localeCompare(right.process_id))
      .map((entry) => ({
        process_id: entry.process_id,
        process_version: entry.process_version,
        blocker_count: entry.blocker_count,
        reasons: sortedCountObject(entry.reasons),
        sample_blocking_dependencies: entry.sample_blocking_dependencies,
        sample_limit: sampleLimit,
        full_details_file: repoRelativePath(blockedLedgerPath),
        rerun_commands: [...entry.rerun_commands].sort(),
      }));
    return {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length > 0 ? "blocked_scopes_present" : "no_blocked_scopes",
      command,
      counts: {
        blocked_ledger_rows: blockedRows.length,
        blocked_scopes: scopeMap.size,
        blocker_reasons: reasonMap.size,
        blocking_dependency_types: sortedCountObject(dependencyTypeCounts),
      },
      reason_summary: reasonSummary,
      scope_summary: scopeSummary,
      files: {
        blocked_scope_report: repoRelativePath(reportPath),
        blocked_scope_ledger: repoRelativePath(blockedLedgerPath),
      },
      ledger_semantics:
        "blocked-scope-ledger.jsonl is the complete row-level blocker source of truth; this report is the per-run reader-facing summary.",
    };
  }

  function runDatasetLibraryDecisionsApply(options) {
    if (options.help) {
      return help(
        "dataset-library-decisions-apply",
        "Apply library-level decisions to process scopes and defer only scopes with unresolved closure.",
        [
          "node scripts/foundry.mjs dataset-library-decisions-apply --library-index <run-dir>/library-index --decisions-dir <run-dir>/decisions --out-dir <run-dir>/library-resolution",
        ],
      );
    }
    const indexDir = libraryIndexDirOption(options);
    if (!indexDir) throw new Error("--library-index is required.");
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!fileExists(entityIndexPath) || !fileExists(scopeProjectionPath)) {
      throw new Error("--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.");
    }
    const decisionsDir = resolveRepoPath(options.decisionsDir || options.decisions) || indexDir;
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "library-resolution"),
    );
    const entityRows = readJsonLines(entityIndexPath);
    const scopeRows = readJsonLines(scopeProjectionPath);
    const maps = entityMaps(entityRows);
    const identityRows = readDecisionRows(
      decisionsDir,
      "identity-decisions.jsonl",
      options.identityDecisions,
    );
    const classificationRows = readDecisionRows(
      decisionsDir,
      "classification-decisions.jsonl",
      options.classificationDecisions,
    );
    const supportRows = readDecisionRows(
      decisionsDir,
      "canonical-support-mappings.jsonl",
      options.canonicalSupportMappings,
    );
    const identityByKey = new Map(identityRows.map((row) => [identityDecisionKey(row), row]));
    const classificationByKey = new Map(
      classificationRows.map((row) => [classificationDecisionKey(row), row]),
    );
    const supportByKey = new Map(supportRows.map((row) => [supportDecisionKey(row), row]));
    const checkpoints = [];
    const blockedLedger = [];
    const readyScopes = [];
    const rewriteRows = [];

    for (const scope of scopeRows) {
      const blockers = [];
      const processClassification = classificationByKey.get(
        `process:${scope.process_id}:${scope.process_version || "00.00.001"}`,
      );
      if (!decisionIsCompleteClassification(processClassification)) {
        blockers.push(
          blockRow(
            scope,
            { dataset_type: "process", id: scope.process_id, version: scope.process_version },
            "process_classification_requires_authoring",
            "Process classification must be authored from full process meaning before this scope can write.",
            "Run semantic classification authoring and provide classification-decisions.jsonl.",
          ),
        );
      }

      for (const dep of ensureArray(scope.dependency_ids?.flows)) {
        const entity = maps.byKey.get(dep.entity_key);
        if (entity && /^elementary flow$/iu.test(entity.flow_type)) {
          const decision = identityByKey.get(`flow:${dep.id}:${dep.version || "00.00.001"}`);
          const target = canonicalTarget(decision, "flow data set");
          if (
            asText(decision?.decision) !== "reuse_existing_reference" ||
            !target.id
          ) {
            blockers.push(
              blockRow(
                scope,
                { dataset_type: "flow", id: dep.id, version: dep.version },
                decision
                  ? "elementary_flow_reference_unresolved"
                  : "elementary_flow_requires_existing_database_match",
                "Elementary flow is reference-only for BAFU and must reuse an existing canonical TianGong flow when physically equivalent.",
                "Provide identity-decisions.jsonl with reuse_existing_reference and physical-equivalence evidence, or leave this scope deferred for human review.",
              ),
            );
          }
        } else {
          const classification = classificationByKey.get(
            `flow:${dep.id}:${dep.version || "00.00.001"}`,
          );
          if (!decisionIsCompleteClassification(classification)) {
            blockers.push(
              blockRow(
                scope,
                { dataset_type: "flow", id: dep.id, version: dep.version },
                "flow_classification_requires_authoring",
                "Product flow classification must be authored from full flow meaning before this scope can write.",
                "Run semantic classification authoring and provide classification-decisions.jsonl.",
              ),
            );
          }
        }
      }
      for (const dep of ensureArray(scope.dependency_ids?.flowproperties)) {
        const mapping = supportByKey.get(
          `flowproperty:${dep.id}:${dep.version || "00.00.001"}`,
        );
        const target = canonicalTarget(mapping, "flow property data set");
        if (!target.id) {
          blockers.push(
            blockRow(
              scope,
              { dataset_type: "flowproperty", id: dep.id, version: dep.version },
              "canonical_flow_property_reference_unresolved",
              "Generated Flow Property support is reference-only and must map to public canonical support before this scope can write.",
              "Add canonical-support-mappings.jsonl with physical-dimension evidence or manually add canonical support to the database and rerun.",
            ),
          );
        }
      }
      for (const dep of ensureArray(scope.dependency_ids?.unitgroups)) {
        const mapping = supportByKey.get(
          `unitgroup:${dep.id}:${dep.version || "00.00.001"}`,
        );
        const target = canonicalTarget(mapping, "unit group data set");
        if (!target.id) {
          blockers.push(
            blockRow(
              scope,
              { dataset_type: "unitgroup", id: dep.id, version: dep.version },
              "canonical_unit_group_reference_unresolved",
              "Generated Unit Group support is reference-only and must map to public canonical support before this scope can write.",
              "Add canonical-support-mappings.jsonl with unit evidence or manually add canonical support to the database and rerun.",
            ),
          );
        }
      }
      const rewrite = rewriteProcessExchangeReferences(scope, identityByKey, maps, outDir);
      rewriteRows.push(...rewrite.rewrite_rows);
      const state = blockers.length > 0 ? "blocked_deferred" : "ready";
      const checkpoint = {
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        state,
        blocker_count: blockers.length,
        bundle_dir: scope.bundle_dir,
        rewritten_process_file: rewrite.rewritten_process_file,
        dependency_counts: {
          flows: ensureArray(scope.dependency_ids?.flows).length,
          flowproperties: ensureArray(scope.dependency_ids?.flowproperties).length,
          unitgroups: ensureArray(scope.dependency_ids?.unitgroups).length,
        },
      };
      checkpoints.push(checkpoint);
      if (blockers.length > 0) {
        blockedLedger.push(...blockers);
      } else {
        readyScopes.push({ ...scope, closure_status: "ready", checkpoint });
      }
    }

    const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
    const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
    const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
    const readyPath = path.join(outDir, "ready-scopes.jsonl");
    const rewritePath = path.join(outDir, "exchange-reference-rewrites.jsonl");
    const resolutionPath = path.join(outDir, "library-resolution.json");
    writeJsonLines(checkpointPath, checkpoints);
    writeJsonLines(blockedPath, blockedLedger);
    const blockedReport = buildBlockedScopeReport({
      command: "dataset-library-decisions-apply",
      blockedRows: blockedLedger,
      blockedLedgerPath: blockedPath,
      reportPath: blockedReportPath,
    });
    writeJson(blockedReportPath, blockedReport);
    writeJsonLines(readyPath, readyScopes);
    writeJsonLines(rewritePath, rewriteRows);
    const resolution = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedLedger.length > 0 ? "completed_with_deferred_scopes" : "completed",
      command: "dataset-library-decisions-apply",
      library_index: repoRelativePath(indexDir),
      decisions_dir: repoRelativeMaybe(decisionsDir),
      counts: {
        process_scopes: scopeRows.length,
        ready_scopes: readyScopes.length,
        blocked_scopes: checkpoints.filter((row) => row.state === "blocked_deferred").length,
        blocked_scope_ledger_rows: blockedLedger.length,
        identity_decisions: identityRows.length,
        classification_decisions: classificationRows.length,
        canonical_support_mappings: supportRows.length,
        exchange_reference_rewrites: rewriteRows.length,
      },
      ready_scope_ids: readyScopes.map((scope) => scope.process_id),
      blocked_scope_ids: checkpoints
        .filter((row) => row.state === "blocked_deferred")
        .map((row) => row.process_id),
      files: {
        library_resolution: repoRelativePath(resolutionPath),
        scope_checkpoints: repoRelativePath(checkpointPath),
        blocked_scope_ledger: repoRelativePath(blockedPath),
        blocked_scope_report: repoRelativePath(blockedReportPath),
        ready_scopes: repoRelativePath(readyPath),
        exchange_reference_rewrites: repoRelativePath(rewritePath),
      },
      policy: {
        process_scope_atomic_write: true,
        ready_scopes_do_not_wait_for_blocked_scopes: true,
        elementary_flows_reference_only: true,
        flowproperty_unitgroup_reference_only: true,
      },
      blockers: [],
    };
    writeJson(resolutionPath, resolution);
    return resolution;
  }

  function scopeRowsFromFile(scopeFile) {
    if (!scopeFile || !fileExists(scopeFile)) return [];
    if (scopeFile.toLowerCase().endsWith(".jsonl")) return readJsonLines(scopeFile);
    const value = readJson(scopeFile);
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.rows)) return value.rows;
    if (Array.isArray(value.scopes)) return value.scopes;
    return [value];
  }

  function commandArrayFromScope(scope, key) {
    const value =
      scope?.[key] ||
      scope?.checkpoint?.[key] ||
      scope?.handoff?.[key] ||
      scope?.commit_handoff?.[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return [];
  }

  function runScopeHandoffCommand(argv, { cwd, logDir, token, stage }) {
    if (!Array.isArray(argv) || argv.length === 0) return null;
    const stdoutLog = path.join(logDir, `${token}.${stage}.stdout.log`);
    const stderrLog = path.join(logDir, `${token}.${stage}.stderr.log`);
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd,
      env: process.env,
      encoding: "utf8",
    });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(stdoutLog, result.stdout || "");
    fs.writeFileSync(stderrLog, result.stderr || "");
    const exitCode = typeof result.status === "number" ? result.status : 1;
    if (result.error) {
      return {
        stage,
        command: argv,
        exit_code: exitCode,
        error: String(result.error?.message || result.error),
        stdout_log: repoRelativePath(stdoutLog),
        stderr_log: repoRelativePath(stderrLog),
      };
    }
    return {
      stage,
      command: argv,
      exit_code: exitCode,
      stdout_log: repoRelativePath(stdoutLog),
      stderr_log: repoRelativePath(stderrLog),
    };
  }

  function runDatasetProcessScopeRun(options) {
    if (options.help) {
      return help(
        "dataset-process-scope-run",
        "Run only ready process scopes through a scope-locked dry-run or commit handoff queue.",
        [
          "node scripts/foundry.mjs dataset-process-scope-run --process-bundles-dir <.../process-bundles> --library-resolution <.../library-resolution.json> --scope-file <ready-scopes.jsonl> --parallel 5 --dry-run",
          "node scripts/foundry.mjs dataset-process-scope-run --process-bundles-dir <.../process-bundles> --library-resolution <.../library-resolution.json> --scope-file <ready-scopes.jsonl> --parallel 5 --commit",
        ],
      );
    }
    const processBundlesDir = resolveRepoPath(
      options.processBundlesDir || options.bundlesDir,
    );
    if (!processBundlesDir || !directoryExists(processBundlesDir)) {
      throw new Error("--process-bundles-dir is required.");
    }
    const libraryResolutionPath = resolveRepoPath(
      options.libraryResolution || options.resolution,
    );
    if (!libraryResolutionPath || !fileExists(libraryResolutionPath)) {
      throw new Error("--library-resolution is required.");
    }
    const resolution = readJson(libraryResolutionPath);
    const scopeFile = resolveRepoPath(
      options.scopeFile || resolution.files?.ready_scopes,
    );
    const scopeRows = scopeRowsFromFile(scopeFile);
    const readyIds = new Set(ensureArray(resolution.ready_scope_ids));
    const outDir = resolveRepoPath(
      options.outDir ||
        path.join(path.dirname(libraryResolutionPath), "process-scope-run"),
    );
    const parallel = positiveIntegerOption(
      options.parallel,
      Math.min(12, Math.max(1, os.cpus().length - 1)),
    );
    const commit = booleanOption(options.commit);
    const dryRun = booleanOption(options.dryRun) || !commit;
    const checkpoints = [];
    const blocked = [];
    const selectedScopes = scopeRows.map((scope) => ({
      process_id: asText(scope.process_id || scope.id),
      process_version: asText(scope.process_version || scope.version) || "00.00.001",
      state: asText(scope.state || scope.closure_status || scope.checkpoint?.state),
      bundle_dir: scope.bundle_dir,
      rewritten_process_file: scope.rewritten_process_file || scope.checkpoint?.rewritten_process_file,
      commit_command: commandArrayFromScope(scope, "commit_command"),
      verify_command: commandArrayFromScope(scope, "verify_command"),
    }));
    const logDir = path.join(outDir, "logs");
    for (const scope of selectedScopes) {
      const isReady =
        readyIds.has(scope.process_id) ||
        scope.state === "ready" ||
        scope.state === "";
      if (!isReady) {
        const row = blockRow(
          scope,
          { dataset_type: "process", id: scope.process_id, version: scope.process_version },
          "scope_not_ready",
          "Only dependency-closed ready scopes can enter dry-run/write/verify queues.",
          "Resolve this scope in dataset-library-decisions-apply and rerun with the ready scope file.",
        );
        blocked.push(row);
        checkpoints.push({
          schema_version: 1,
          process_id: scope.process_id,
          process_version: scope.process_version,
          state: "blocked_deferred",
          reason: "scope_not_ready",
        });
        continue;
      }
      const commandStages = [];
      let state = dryRun ? "dry_run_planned" : "commit_handoff_planned";
      if (commit && scope.commit_command.length > 0) {
        const token = `${scope.process_id}-${scope.process_version}`.replace(
          /[^A-Za-z0-9_.-]+/gu,
          "-",
        );
        const commitStage = runScopeHandoffCommand(scope.commit_command, {
          cwd: process.cwd(),
          logDir,
          token,
          stage: "commit",
        });
        commandStages.push(commitStage);
        if (commitStage?.exit_code === 0 && scope.verify_command.length > 0) {
          const verifyStage = runScopeHandoffCommand(scope.verify_command, {
            cwd: process.cwd(),
            logDir,
            token,
            stage: "verify",
          });
          commandStages.push(verifyStage);
          state = verifyStage?.exit_code === 0 ? "verified" : "verify_failed";
        } else {
          state = commitStage?.exit_code === 0 ? "committed" : "commit_failed";
        }
      }
      checkpoints.push({
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        state,
        scope_lock: `process:${scope.process_id}:${scope.process_version}`,
        parallel,
        bundle_dir: scope.bundle_dir,
        rewritten_process_file: scope.rewritten_process_file,
        remote_write_mode: commit ? "commit_handoff_required" : "read-only",
        command_stages: commandStages.filter(Boolean),
      });
    }
    const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
    const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
    const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
    const reportPath = path.join(outDir, "dataset-process-scope-run-report.json");
    writeJsonLines(checkpointPath, checkpoints);
    writeJsonLines(blockedPath, blocked);
    const blockedReport = buildBlockedScopeReport({
      command: "dataset-process-scope-run",
      blockedRows: blocked,
      blockedLedgerPath: blockedPath,
      reportPath: blockedReportPath,
    });
    writeJson(blockedReportPath, blockedReport);
    const commandFailures = checkpoints.filter((row) =>
      ["commit_failed", "verify_failed"].includes(row.state),
    );
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status:
        commandFailures.length > 0
          ? "failed"
          : blocked.length > 0
            ? "completed_with_deferred_scopes"
            : "completed",
      command: "dataset-process-scope-run",
      process_bundles_dir: repoRelativePath(processBundlesDir),
      library_resolution: repoRelativePath(libraryResolutionPath),
      scope_file: repoRelativeMaybe(scopeFile),
      mode: commit ? "commit" : "dry-run",
      parallel,
      counts: {
        selected_scopes: selectedScopes.length,
        ready_scopes_planned: checkpoints.filter((row) =>
          ["dry_run_planned", "commit_handoff_planned"].includes(row.state),
        ).length,
        committed: checkpoints.filter((row) => row.state === "committed")
          .length,
        verified: checkpoints.filter((row) => row.state === "verified").length,
        command_failures: commandFailures.length,
        blocked_scopes_deferred: blocked.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        scope_checkpoints: repoRelativePath(checkpointPath),
        blocked_scope_ledger: repoRelativePath(blockedPath),
        blocked_scope_report: repoRelativePath(blockedReportPath),
      },
      policy: {
        ready_only_commit: true,
        blocked_scopes_do_not_enter_write_queue: true,
        process_scope_locking: true,
        commit_mode_requires_existing_finalize_mutation_handoff_verify_chain:
          "This command executes scope-provided commit/verify handoff commands only after the existing finalize/mutation-manifest/commit-handoff/post-write-verify chain has produced them. Without handoff commands, it creates scope-locked commit_handoff_planned checkpoints.",
      },
      blockers: commandFailures.map((row) => ({
        code: row.state,
        message: "Scope handoff command failed; inspect command stage logs.",
        process_id: row.process_id,
        process_version: row.process_version,
        command_stages: row.command_stages,
      })),
    };
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetLibraryIndexBuild,
    runDatasetLibraryAuthoringPlan,
    runDatasetLibraryDecisionsApply,
    runDatasetProcessScopeRun,
  };
}
