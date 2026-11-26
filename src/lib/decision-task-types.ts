export type UnknownRecord = Record<string, unknown>;

export interface WorkflowCommands extends UnknownRecord {
  input_rows?: unknown;
  output_rows?: unknown;
}

export interface DecisionWorkflow extends UnknownRecord {
  schema_type?: unknown;
  row_type?: unknown;
  commands?: WorkflowCommands;
}

export interface DecisionQueueRow extends UnknownRecord {
  dataset_id?: unknown;
  dataset_version?: unknown;
  dataset_type?: unknown;
  schema_type?: unknown;
  category_type?: unknown;
  type?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
  classification_workflow?: DecisionWorkflow;
  location_workflow?: DecisionWorkflow;
  foundry_selection?: UnknownRecord;
}

export interface ContextKindEvidence extends UnknownRecord {
  used_context_kinds?: unknown;
  usedContextKinds?: unknown;
}

export interface DecisionRecord extends UnknownRecord {
  category_type?: unknown;
  categoryType?: unknown;
  classification_type?: unknown;
  classificationType?: unknown;
  type?: unknown;
  dataset_id?: unknown;
  datasetId?: unknown;
  id?: unknown;
  uuid?: unknown;
  dataset_version?: unknown;
  datasetVersion?: unknown;
  version?: unknown;
  code?: unknown;
  class_id?: unknown;
  classId?: unknown;
  cat_id?: unknown;
  catId?: unknown;
  leaf_code?: unknown;
  leafCode?: unknown;
  used_context_kinds?: unknown;
  usedContextKinds?: unknown;
  evidence?: ContextKindEvidence;
  resolution?: ContextKindEvidence;
  authoring_context?: ContextKindEvidence;
  authoringContext?: UnknownRecord;
  authoring_context_sha256?: unknown;
  context_bundle_sha256?: unknown;
  contextBundleSha256?: unknown;
  decision_status?: unknown;
  decisionStatus?: unknown;
  status?: unknown;
}

export interface DecisionTaskOptions extends UnknownRecord {
  datasetId?: unknown;
  datasetIds?: unknown;
  id?: unknown;
  datasetType?: unknown;
  datasetTypes?: unknown;
  categoryType?: unknown;
  categoryTypes?: unknown;
  schemaType?: unknown;
  schemaTypes?: unknown;
  bundleId?: unknown;
  bundleIds?: unknown;
  processId?: unknown;
  offset?: unknown;
  limit?: unknown;
  count?: unknown;
  chunkLabel?: unknown;
  chunk?: unknown;
  label?: unknown;
  rowsFile?: unknown;
  inputRows?: unknown;
  inputRowsFile?: unknown;
  currentRows?: unknown;
  currentRowsFile?: unknown;
  schemaFile?: unknown;
  yamlFile?: unknown;
  rulesetFile?: unknown;
  contextFile?: unknown;
  classificationSchema?: unknown;
  locationSchema?: unknown;
  decisionTask?: unknown;
  classificationDecisionTask?: unknown;
  classificationTask?: unknown;
  locationDecisionTask?: unknown;
  locationTask?: unknown;
  taskReport?: unknown;
  task?: unknown;
}

export interface QueueSelection {
  dataset_ids: string[];
  dataset_types: string[];
  category_types: string[];
  bundle_ids: string[];
  offset: number;
  limit: number | null;
}

export interface SelectedQueueRow<Row extends DecisionQueueRow = DecisionQueueRow> {
  row: Row;
  sourceIndex: number;
}

export interface ContextFileInput extends UnknownRecord {
  kind?: unknown;
  path?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  text?: unknown;
}

export interface DecisionContextFile extends UnknownRecord {
  kind: string;
  path: string | null;
  sha256: string;
  bytes: number;
  text: string;
}

export interface MissingContextFile extends UnknownRecord {
  kind: string;
  path: string;
}

export interface ContractContext {
  files: ContextFileInput[];
  missing: MissingContextFile[];
}

export interface ProvenanceEntry extends UnknownRecord {
  file?: unknown;
  total_rows?: unknown;
  truncated?: unknown;
}

export interface AttachedInputRow extends UnknownRecord {
  input_rows?: unknown;
  index?: unknown;
  row_type?: unknown;
  dataset_id?: unknown;
  dataset_version?: unknown;
}

export interface SharedContextInput extends UnknownRecord {
  path?: unknown;
  sha256?: unknown;
  counts?: unknown;
}

export interface TaskContextInput extends UnknownRecord {
  sha256?: unknown;
  context_bundle_sha256?: unknown;
  shared_context_bundle?: SharedContextInput;
}

export interface DecisionTaskInput extends UnknownRecord {
  status?: unknown;
  task_kind?: unknown;
  context_bundle?: TaskContextInput;
  authoring_context?: TaskContextInput;
  shared_context_bundle?: SharedContextInput;
  files?: UnknownRecord;
  classification_queue?: unknown;
  location_queue?: unknown;
  source_classification_queue?: unknown;
  source_location_queue?: unknown;
  contract_context_files?: unknown;
  missing_context_files?: unknown;
}

export interface SharedContextProof {
  path: string | null;
  sha256: string | null;
  expected_sha256: string | null;
  counts: unknown;
  files: unknown[];
  blockers: UnknownRecord[];
}

export interface DecisionTaskProof {
  path: string;
  sha256: string | null;
  status: string | null;
  task_kind: string | null;
  context_bundle_sha256: string | null;
  queue: string | null;
  source_queue: string | null;
  contract_context_files: ContextFileInput[];
  missing_context_files: unknown[];
  context_bundle?: TaskContextInput | null;
  shared_context_bundle: SharedContextProof | null;
  blockers: UnknownRecord[];
}

export interface DecisionTaskUtilsDependencies {
  asText: (value: unknown) => string;
  cloneJson: <Value>(value: Value) => Value;
  ensureArray: <Value>(value: Value | Value[] | null | undefined) => Value[];
  fileExists: (filePath: string) => boolean;
  integerOption: (value: unknown, fallback: number | null) => number | null;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  positiveIntegerOption: (value: unknown, fallback: number | null) => number | null;
  readJson: (filePath: string) => UnknownRecord;
  readJsonLines: (filePath: string) => UnknownRecord[];
  readText: (filePath: string) => string;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  sameResolvedPath: (left: string | null, right: string | null) => boolean;
  sha256Text: (value: unknown) => string;
  unique: <Value>(values: Value[]) => Value[];
  writeJson: (filePath: string, value: unknown) => void;
}
