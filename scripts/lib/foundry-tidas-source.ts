import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const cliPackageName = "@tiangong-lca/cli";
export const TIANGONG_LCA_CLI_TIDAS_SOURCE_SCHEMA =
  "tiangong-lca.cli-tidas-spec-source.v1" as const;
const expectedSource = Object.freeze({
  schema: TIANGONG_LCA_CLI_TIDAS_SOURCE_SCHEMA,
  spec_repository: "tiangong-lca/tidas-spec",
  spec_commit: "f118660dbcbfbf736be74837cce0bf26cd177245",
  spec_version: "0.2.3",
  source_repository: "https://github.com/tiangong-lca/tidas-toolkit",
  source_commit: "9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5",
  manifest_sha256: "5b69ab859e26a253dc51c6aeee68c971d727b1f8db44128143795113fe3eee6a",
});

export type TiangongLcaCliTidasSchemaSource = Readonly<{
  schema: typeof TIANGONG_LCA_CLI_TIDAS_SOURCE_SCHEMA;
  spec_repository: string;
  spec_commit: string;
  spec_version: string;
  source_repository: string;
  source_commit: string;
  manifest_sha256: string;
  schemas: readonly { name: string; sha256: string }[];
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseSource(value: JsonRecord): TiangongLcaCliTidasSchemaSource {
  const keys = [
    "manifest_sha256",
    "schema",
    "schemas",
    "source_commit",
    "source_repository",
    "spec_commit",
    "spec_repository",
    "spec_version",
  ];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.schema !== expectedSource.schema ||
    value.spec_repository !== expectedSource.spec_repository ||
    value.spec_commit !== expectedSource.spec_commit ||
    value.spec_version !== expectedSource.spec_version ||
    value.source_repository !== expectedSource.source_repository ||
    value.source_commit !== expectedSource.source_commit ||
    value.manifest_sha256 !== expectedSource.manifest_sha256
  )
    throw new Error(
      `Installed ${cliPackageName} TIDAS source manifest does not match the approved spec 0.2.3 source identity.`,
    );
  if (!Array.isArray(value.schemas) || value.schemas.length !== 18)
    throw new Error(
      `Installed ${cliPackageName} TIDAS source manifest must enumerate exactly 18 schemas.`,
    );
  const schemas = value.schemas.map((entry, index) => {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 2 ||
      typeof entry.name !== "string" ||
      !/^tidas_[a-z0-9_]+\.json$/u.test(entry.name) ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256)
    )
      throw new Error(
        `Installed ${cliPackageName} TIDAS source manifest has an invalid schema entry at index ${index}.`,
      );
    return Object.freeze({ name: entry.name, sha256: entry.sha256 });
  });
  if (new Set(schemas.map((entry) => entry.name)).size !== schemas.length)
    throw new Error(
      `Installed ${cliPackageName} TIDAS source manifest schema entries must be unique.`,
    );
  return Object.freeze({
    schema: expectedSource.schema,
    spec_repository: expectedSource.spec_repository,
    spec_commit: expectedSource.spec_commit,
    spec_version: expectedSource.spec_version,
    source_repository: expectedSource.source_repository,
    source_commit: expectedSource.source_commit,
    manifest_sha256: expectedSource.manifest_sha256,
    schemas: Object.freeze(schemas),
  });
}

export function resolveTiangongLcaCliTidasSource(
  sourceManifestPath: string,
  schemaDir: string,
): TiangongLcaCliTidasSchemaSource {
  let source: TiangongLcaCliTidasSchemaSource;
  try {
    source = parseSource(JSON.parse(fs.readFileSync(sourceManifestPath, "utf8")) as JsonRecord);
  } catch (error) {
    if (error instanceof Error && error.message.includes("TIDAS source manifest")) throw error;
    throw new Error(
      `Installed ${cliPackageName} TIDAS source manifest is unreadable at ${sourceManifestPath}.`,
      { cause: error },
    );
  }
  const actualEntries = fs.readdirSync(schemaDir, { withFileTypes: true });
  if (actualEntries.some((entry) => !entry.isFile()))
    throw new Error(
      `Installed ${cliPackageName} TIDAS schema directory contains a non-file entry.`,
    );
  const actualNames = actualEntries.map((entry) => entry.name).sort();
  const expectedNames = source.schemas.map((entry) => entry.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames))
    throw new Error(
      `Installed ${cliPackageName} TIDAS schema files do not match its approved source manifest.`,
    );
  for (const entry of source.schemas) {
    const filePath = path.join(schemaDir, entry.name);
    if (sha256File(filePath) !== entry.sha256)
      throw new Error(`Installed ${cliPackageName} TIDAS schema hash mismatch for ${entry.name}.`);
  }
  return source;
}
