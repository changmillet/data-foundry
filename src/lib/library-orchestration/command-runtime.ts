import type { DatasetIdentity, JsonRecord } from "./entity-projection.ts";

type ProfileAuth = { authorization?: unknown };

export interface LibraryScopeWorkflowDependencies {
  asText: (value: unknown) => string;
  booleanOption: (value: unknown, fallback?: boolean) => boolean;
  profileFor: (repoRoot: string, profileId: string, options?: JsonRecord) => ProfileAuth;
  repoRoot: string;
  bundleClassificationPath: (payload: unknown, datasetType: string) => unknown;
  cloneJson: <T>(value: T) => T;
  datasetIdentity: (row: unknown, datasetType: string) => DatasetIdentity;
  directoryExists: (filePath: string | null | undefined) => boolean;
  ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
  fileExists: (filePath: string | null | undefined) => boolean;
  flowTypeOfDataSet: (payload: unknown) => string;
  jsonSha256: (value: unknown) => string;
  nowIso: () => string;
  positiveIntegerOption: (value: unknown, fallback?: number | null) => number | null | undefined;
  readJson: (filePath: string) => JsonRecord;
  readJsonLines: (filePath: string) => JsonRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  sha256Text: (value: unknown) => string;
  textValue: (value: unknown) => string;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

export function readyScopeFileValue(options: JsonRecord, resolution: JsonRecord): unknown {
  const raw = resolution.files;
  const files = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as JsonRecord) : {};
  return options.scopeFile || files.ready_scopes;
}
