import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

export const MANIFEST_SCHEMA_PATH = "specs/schemas/final-delivery-manifest.schema.json";
export const MANIFEST_SCHEMA_URL =
  "https://tiangong-lca.dev/schemas/foundry-final-delivery-manifest.v1.json";
export const MAX_REPORTED_SCHEMA_ERRORS = 50;

interface AjvRuntime {
  validateSchema: (schema: object) => boolean;
  compile: (schema: object) => ValidateFunction;
}

export type ManifestSchemaFinding = {
  // The Ajv keyword and the instance location only. Values, messages and parameters are never
  // carried through, so a rejected manifest cannot reflect artifact text or secrets into the
  // reader-facing report or the ledger.
  category: string;
  locator: string;
};

export type ManifestSchemaOutcome = {
  valid: boolean;
  findings: ManifestSchemaFinding[];
  errorCount: number;
};

let cachedValidator: ValidateFunction | null = null;
let cachedSchemaPath: string | null = null;

function compileManifestSchema(repoRoot: string): ValidateFunction {
  const schemaPath = path.join(repoRoot, MANIFEST_SCHEMA_PATH);
  if (cachedValidator && cachedSchemaPath === schemaPath) return cachedValidator;
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as object;
  const Ajv2020Constructor = Ajv2020 as unknown as new (
    options: Record<string, unknown>,
  ) => AjvRuntime;
  // `allowUnionTypes` is required because a required workbook control cell is deliberately
  // declared as `type: ["string", "number", "boolean"]`. It only permits the union `type`
  // keyword; every other strict-mode rule stays on, so vocabulary, formats, unknown keywords and
  // additional properties are still rejected.
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: true, allowUnionTypes: true });
  if (!ajv.validateSchema(schema)) throw new Error("Final-delivery manifest schema is not valid.");
  cachedValidator = ajv.compile(schema);
  cachedSchemaPath = schemaPath;
  return cachedValidator;
}

function findingFrom(error: ErrorObject): ManifestSchemaFinding {
  const locator = error.instancePath && error.instancePath.length > 0 ? error.instancePath : "/";
  return { category: error.keyword, locator };
}

// The declared `schema_version` string is a claim; this is the check that the manifest actually
// satisfies its own published schema. Nothing is filtered out ahead of it: a bad artifact,
// reviewer, workbook or control cell is reported rather than silently dropped.
export function validateManifestSchema(repoRoot: string, manifest: unknown): ManifestSchemaOutcome {
  const validate = compileManifestSchema(repoRoot);
  const valid = validate(manifest);
  const errors = validate.errors ?? [];
  return {
    valid: Boolean(valid),
    findings: errors.slice(0, MAX_REPORTED_SCHEMA_ERRORS).map(findingFrom),
    errorCount: errors.length,
  };
}
