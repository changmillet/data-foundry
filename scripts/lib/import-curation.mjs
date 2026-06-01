import fs from 'node:fs';
import path from 'node:path';

const supportedDatasetTypes = new Set(['process', 'flow', 'lifecyclemodel']);
const datasetTypePlural = {
  process: 'processes',
  flow: 'flows',
  lifecyclemodel: 'lifecyclemodels',
};

const importProfiles = {
  generic: {
    id: 'generic',
    docs: [],
    waivedQaCodesByType: {},
    waiverReasons: {},
  },
  bafu: {
    id: 'bafu',
    docs: [
      'docs/import-profiles/bafu/profile.md',
      'docs/import-profiles/bafu/constraints.md',
    ],
    waivedQaCodesByType: {
      process: ['process_material_balance_deviation'],
    },
    waiverReasons: {
      process_material_balance_deviation:
        'BAFU profile treats process_material_balance_deviation as QA observation, not remote-write blocker.',
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
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeJson(filePath, data) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function fileExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function directoryExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory());
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
  if (filePath.endsWith('.jsonl')) {
    return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
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

function jsonLines(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

function sanitizeFileName(value) {
  return String(value ?? 'missing')
    .replace(/[^A-Za-z0-9._-]+/gu, '_')
    .replace(/^_+|_+$/gu, '') || 'missing';
}

function asText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function unwrapDatasetPayload(row, datasetType) {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const typedKey = datasetType === 'lifecyclemodel' ? 'lifecyclemodel' : datasetType;
    for (const key of [typedKey, 'json_ordered', 'jsonOrdered', 'json', 'payload']) {
      if (row[key] && typeof row[key] === 'object' && !Array.isArray(row[key])) {
        return row[key];
      }
    }
  }
  return row;
}

function datasetRoot(payload, datasetType) {
  const rootKeys = {
    process: ['processDataSet'],
    flow: ['flowDataSet'],
    lifecyclemodel: ['lifeCycleModelDataSet', 'lifecycleModelDataSet', 'lifecyclemodelDataSet'],
  };
  for (const key of rootKeys[datasetType] ?? []) {
    if (payload?.[key] && typeof payload[key] === 'object') return payload[key];
  }
  return {};
}

function dataSetInformation(root, datasetType) {
  const candidates = [
    root?.processInformation?.dataSetInformation,
    root?.flowInformation?.dataSetInformation,
    root?.lifeCycleModelInformation?.dataSetInformation,
    root?.lifecycleModelInformation?.dataSetInformation,
    root?.[`${datasetType}Information`]?.dataSetInformation,
    root?.dataSetInformation,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === 'object') ?? {};
}

function datasetIdentity(row, index, datasetType) {
  const payload = unwrapDatasetPayload(row, datasetType);
  const root = datasetRoot(payload, datasetType);
  const info = dataSetInformation(root, datasetType);
  const publication = root?.administrativeInformation?.publicationAndOwnership ?? {};
  const directId = row?.id ?? row?.[`${datasetType}_id`] ?? row?.dataset_id;
  const id = asText(directId ?? info['common:UUID']) || `row-${index + 1}`;
  const version = asText(row?.version ?? publication['common:dataSetVersion']) || '00.00.001';
  return { id, version, payload };
}

function idFromArtifactFile(fileName) {
  const base = path.basename(String(fileName ?? ''));
  const withoutExt = base.replace(/\.json$/u, '').replace(/\.jsonl$/u, '');
  return withoutExt.split('__')[0] || '';
}

function entityIdFromFinding(finding, datasetType) {
  if (!finding || typeof finding !== 'object') return '';
  const directKeys = [
    `${datasetType}_id`,
    'entity_id',
    'dataset_id',
    'row_id',
    'id',
  ];
  for (const key of directKeys) {
    const value = asText(finding[key]);
    if (value) return value;
  }
  const fileKeys = [
    `${datasetType}_file`,
    'process_file',
    'flow_file',
    'lifecyclemodel_file',
    'model_file',
    'file',
  ];
  for (const key of fileKeys) {
    const value = idFromArtifactFile(finding[key]);
    if (value) return value;
  }
  return '';
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
  return asText(finding?.code ?? finding?.rule_code ?? finding?.rule_id ?? finding?.id) || 'qa_finding';
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
    if (!finding || typeof finding !== 'object') continue;
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

function schemaIssueCurationAction(issue) {
  const code = String(issue?.code ?? '');
  const issuePath = String(issue?.path ?? '');
  const base = {
    source: 'schema',
    code: issue?.code,
    path: issue?.path ?? null,
    message: issue?.message ?? null,
  };
  if (issuePath.includes('common:other.tidasimport:sourceTrace')) {
    return {
      ...base,
      action_kind: 'source_trace_externalization',
      required_owner: 'foundry_deterministic_cleanup',
      ai_required: false,
      instruction: 'Preserve sourceTrace in the authoring package context, then remove or externalize it before remote write.',
    };
  }
  if (code === 'invalid_format' && issuePath.endsWith('common:timeStamp')) {
    return {
      ...base,
      action_kind: 'timestamp_normalization',
      required_owner: 'foundry_deterministic_cleanup',
      ai_required: false,
      instruction: 'Normalize the timestamp to the SDK-accepted datetime format before validation.',
    };
  }
  return {
    ...base,
    action_kind: 'ai_authoring',
    required_owner: 'foundry_ai_authoring',
    ai_required: true,
  };
}

function collectExplicitContextFiles(options) {
  return [
    ['contract_context', options.contractContext ?? options.contextFile],
    ['schema', options.schemaFile],
    ['methodology_yaml', options.yamlFile],
    ['ruleset', options.rulesetFile],
    ['contract', options.contractFile],
  ].filter(([, filePath]) => Boolean(filePath));
}

function collectContextDirFiles(repoRoot, contextDir) {
  const resolvedDir = resolveRepoPath(repoRoot, contextDir);
  if (!directoryExists(resolvedDir)) return [];
  return fs.readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(json|ya?ml|md|txt)$/iu.test(name))
    .sort()
    .map((name) => ['context_dir_file', path.join(resolvedDir, name)]);
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
      missing.push({ kind, path: path.isAbsolute(filePath) ? filePath : filePath });
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

function stripImportTraceMetadata(value) {
  let removed = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node['common:other'];
    if (commonOther && typeof commonOther === 'object' && !Array.isArray(commonOther)) {
      if (Object.hasOwn(commonOther, 'tidasimport:sourceTrace')) {
        delete commonOther['tidasimport:sourceTrace'];
        removed += 1;
      }
      if (Object.hasOwn(commonOther, '@xmlns:tidasimport')) {
        delete commonOther['@xmlns:tidasimport'];
      }
      if (Object.keys(commonOther).length === 0) {
        delete node['common:other'];
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return removed;
}

function profileFor(profileId) {
  return importProfiles[profileId] ?? importProfiles.generic;
}

function datasetTypeFromOptions(options, forcedType = null) {
  const datasetType = String(
    forcedType ?? options.type ?? options.datasetType ?? options.kind ?? 'process',
  ).trim().toLowerCase();
  if (!supportedDatasetTypes.has(datasetType)) {
    throw new Error(`Unsupported dataset type: ${datasetType}. Expected process, flow, or lifecyclemodel.`);
  }
  return datasetType;
}

export function runDatasetCurationGate({
  repoRoot,
  options = {},
  forcedType = null,
  legacyProcessNames = false,
} = {}) {
  const datasetType = datasetTypeFromOptions(options, forcedType);
  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const schemaReportPath = resolveRepoPath(repoRoot, options.schemaReport);
  const qaReportPath = resolveRepoPath(repoRoot, options.qaReport);
  const defaultOut = legacyProcessNames
    ? '.foundry/workspaces/process-curation-gate'
    : `.foundry/workspaces/${datasetType}-dataset-curation-gate`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const profileId = String(options.profile || 'generic').trim().toLowerCase();
  const profile = profileFor(profileId);
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error('--rows-file is required and must point to a JSON/JSONL dataset row file.');
  }
  if (!schemaReportPath || !fileExists(schemaReportPath)) {
    throw new Error('--schema-report is required and must point to dataset validate report JSON.');
  }
  if (!qaReportPath || !fileExists(qaReportPath)) {
    throw new Error('--qa-report is required and must point to a QA report JSON.');
  }

  const rows = readRows(rowsFile);
  const schemaReport = readJson(schemaReportPath);
  const qaReport = readJson(qaReportPath);
  const qaFindings = readQaFindings(repoRoot, qaReport, qaReportPath, datasetType);
  const profileContext = readContextFiles(repoRoot, profile.docs.map((filePath) => ['profile', filePath]));
  const contractContext = readContextFiles(repoRoot, [
    ...collectExplicitContextFiles(options),
    ...collectContextDirFiles(repoRoot, options.contextDir),
  ]);
  const waivedQaCodes = new Set(profile.waivedQaCodesByType?.[datasetType] ?? []);
  const schemaRowsById = new Map(
    ensureArray(schemaReport.rows).map((row) => [String(row.id ?? row.dataset_id ?? ''), row]),
  );
  const qaFindingsById = new Map();
  for (const finding of qaFindings) {
    const id = entityIdFromFinding(finding, datasetType);
    if (!id) continue;
    if (!qaFindingsById.has(id)) qaFindingsById.set(id, []);
    qaFindingsById.get(id).push(finding);
  }

  const packageDir = path.join(outDir, 'ai-authoring-packages');
  const entityReports = rows.map((row, index) => {
    const identity = datasetIdentity(row, index, datasetType);
    const schemaRow = schemaRowsById.get(identity.id) ?? null;
    const schemaIssues = ensureArray(schemaRow?.issues);
    const entityQaFindings = qaFindingsById.get(identity.id) ?? [];
    const waivedFindings = entityQaFindings.filter((finding) => waivedQaCodes.has(qaFindingCode(finding)));
    const actionableQaFindings = entityQaFindings.filter((finding) => !waivedQaCodes.has(qaFindingCode(finding)));
    const schemaActionItems = schemaIssues.map((issue) => schemaIssueCurationAction(issue));
    const qaActionItems = actionableQaFindings.map((finding) => ({
      source: `${datasetType}_qa`,
      code: qaFindingCode(finding),
      path: finding.path ?? null,
      message: finding.message ?? null,
      evidence: finding.evidence ?? null,
      action_kind: 'ai_authoring',
      required_owner: 'foundry_ai_authoring',
      ai_required: true,
    }));
    const actionItems = [
      ...schemaActionItems.filter((item) => item.ai_required),
      ...qaActionItems,
    ];
    const deterministicCleanupItems = schemaActionItems.filter((item) => !item.ai_required);
    const blockingItemCount = actionItems.length + deterministicCleanupItems.length;
    const status = actionItems.length > 0
      ? 'needs_foundry_ai_authoring'
      : deterministicCleanupItems.length > 0
        ? 'needs_foundry_deterministic_cleanup'
        : waivedFindings.length > 0
          ? 'ready_with_profile_waivers'
          : 'ready';
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
      source_rows_file: repoRelativePath(repoRoot, rowsFile),
      profile_context_files: profileContext.files,
      contract_context_files: contractContext.files,
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
      source_row: row,
      entity_payload: identity.payload,
      output_contract: {
        artifact: `${datasetType}-build-plan.json or structured patch set`,
        apply_owner: 'tiangong-lca-cli deterministic apply/validate/materialize step',
        cleanup_owner: 'Foundry removes or externalizes import-only trace metadata before remote write',
        final_gate_owner: 'Foundry profile-aware curation gate',
      },
    };
    if (datasetType === 'process') {
      packagePayload.process_id = identity.id;
      packagePayload.process_payload = identity.payload;
      packagePayload.process_qa_findings = entityQaFindings;
    }
    writeJson(packagePath, packagePayload);
    return {
      dataset_type: datasetType,
      entity_id: identity.id,
      ...(datasetType === 'process' ? { process_id: identity.id } : {}),
      version: identity.version,
      schema_status: schemaRow?.status ?? 'not_found',
      schema_issue_count: schemaIssues.length,
      qa_finding_count: entityQaFindings.length,
      ...(datasetType === 'process' ? { process_qa_finding_count: entityQaFindings.length } : {}),
      waived_finding_count: waivedFindings.length,
      action_item_count: actionItems.length,
      deterministic_cleanup_count: deterministicCleanupItems.length,
      blocking_item_count: blockingItemCount,
      authoring_package: repoRelativePath(repoRoot, packagePath),
      status,
    };
  });

  const actionItemCount = entityReports.reduce((total, item) => total + item.action_item_count, 0);
  const deterministicCleanupCount = entityReports.reduce(
    (total, item) => total + item.deterministic_cleanup_count,
    0,
  );
  const blockingItemCount = actionItemCount + deterministicCleanupCount;
  const waiverCount = entityReports.reduce((total, item) => total + item.waived_finding_count, 0);
  const report = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status: actionItemCount > 0
      ? 'blocked_needs_foundry_ai_authoring'
      : deterministicCleanupCount > 0
        ? 'blocked_needs_foundry_deterministic_cleanup'
        : waiverCount > 0
          ? 'ready_with_profile_waivers'
          : 'ready',
    profile: profile.id,
    dataset_type: datasetType,
    rows_file: repoRelativePath(repoRoot, rowsFile),
    schema_report: repoRelativePath(repoRoot, schemaReportPath),
    qa_report: repoRelativePath(repoRoot, qaReportPath),
    policy: {
      cli_qa_role: 'deterministic_qa_report_only',
      foundry_role: 'profile policy, AI authoring package, deterministic cleanup, waiver, final prewrite decision',
      waived_qa_codes: [...waivedQaCodes],
      source_language_only_before_import: true,
    },
    context: {
      profile_files: profileContext.files.map((file) => file.path),
      contract_context_files: contractContext.files.map((file) => file.path),
      missing_context_files: [
        ...profileContext.missing,
        ...contractContext.missing,
      ],
    },
    counts: {
      entities: entityReports.length,
      [datasetTypePlural[datasetType]]: entityReports.length,
      action_items: actionItemCount,
      deterministic_cleanup_items: deterministicCleanupCount,
      blocking_items: blockingItemCount,
      waivers: waiverCount,
    },
    entities: entityReports,
  };
  if (datasetType === 'process') {
    report.processes = entityReports;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const reportFileName = legacyProcessNames
    ? 'process-curation-gate-report.json'
    : 'dataset-curation-gate-report.json';
  const entitiesFileName = legacyProcessNames
    ? 'process-curation-gate-processes.jsonl'
    : `${datasetType}-curation-gate-entities.jsonl`;
  const reportPath = path.join(outDir, reportFileName);
  const jsonlPath = path.join(outDir, entitiesFileName);
  writeJson(reportPath, report);
  writeText(jsonlPath, jsonLines(entityReports));
  return {
    ...report,
    files: {
      report: repoRelativePath(repoRoot, reportPath),
      entities: repoRelativePath(repoRoot, jsonlPath),
      ...(datasetType === 'process' ? { processes: repoRelativePath(repoRoot, jsonlPath) } : {}),
      authoring_packages_dir: repoRelativePath(repoRoot, packageDir),
    },
  };
}

export function runDatasetCurationCleanup({
  repoRoot,
  options = {},
  forcedType = null,
  legacyProcessNames = false,
} = {}) {
  const datasetType = datasetTypeFromOptions(options, forcedType);
  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const defaultOut = legacyProcessNames
    ? '.foundry/workspaces/process-curation-cleanup'
    : `.foundry/workspaces/${datasetType}-dataset-curation-cleanup`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const defaultOutFile = path.join(outDir, `${datasetTypePlural[datasetType]}.cleaned.jsonl`);
  const outFile = resolveRepoPath(repoRoot, options.outFile) || defaultOutFile;
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error('--rows-file is required and must point to a JSON/JSONL dataset row file.');
  }

  const rows = readRows(rowsFile);
  let removedSourceTraceBlocks = 0;
  const cleanedRows = rows.map((row) => {
    const cleaned = JSON.parse(JSON.stringify(row));
    removedSourceTraceBlocks += stripImportTraceMetadata(cleaned);
    return cleaned;
  });
  writeText(outFile, jsonLines(cleanedRows));

  const report = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status: 'completed',
    dataset_type: datasetType,
    rows_file: repoRelativePath(repoRoot, rowsFile),
    cleaned_rows_file: repoRelativePath(repoRoot, outFile),
    counts: {
      rows: cleanedRows.length,
      removed_source_trace_blocks: removedSourceTraceBlocks,
    },
    policy: {
      purpose: 'Remove import-only tidasimport:sourceTrace metadata after curation context has been captured and before remote write.',
      preserves_payload_semantics: true,
    },
  };
  const reportFileName = legacyProcessNames
    ? 'process-curation-cleanup-report.json'
    : 'dataset-curation-cleanup-report.json';
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
