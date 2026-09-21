import { type JsonRecord, compareText, sha256 } from "./final-delivery-manifest.ts";
import type { ArtifactDescriptor } from "./final-delivery-rows.ts";

const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["DATABASE_URL", /\bpostgres(?:ql)?:\/\/[^\s"']+/iu],
  ["BEARER_TOKEN", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/u],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u],
  ["AWS_ACCESS_KEY", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  [
    "SECRET_ASSIGNMENT",
    /\b(?:api[_-]?key|access[_-]?token|password|secret)\b\s*[:=]\s*["'][^"'\s]{8,}["']/iu,
  ],
  ["USER_ABSOLUTE_PATH", /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/u],
];

export const MAX_FORBIDDEN_LITERALS = 50;

// Complete redaction coverage over every textual content: credential-shaped values, local
// user-absolute paths, and the manifest-declared forbidden literals.
export function secretFindingCodes(text: string, forbiddenLiterals: readonly string[]): string[] {
  const findings: string[] = [];
  for (const [code, expression] of SECRET_PATTERNS) {
    if (expression.test(text)) findings.push(code);
  }
  for (const [index, literal] of forbiddenLiterals.entries()) {
    if (text.includes(literal)) findings.push(`FORBIDDEN_LITERAL_${index + 1}`);
  }
  return findings;
}

// A label is echoed only when it carries no credential-shaped or forbidden content. Otherwise a
// stable ordinal and a content digest replace it, so a failure report never becomes a second copy
// of a secret while staying navigable.
export function safeLabel(
  value: unknown,
  ordinal: number,
  forbiddenLiterals: readonly string[],
): string {
  const text = typeof value === "string" ? value : "";
  if (text.length > 0 && secretFindingCodes(text, forbiddenLiterals).length === 0) return text;
  return `#${ordinal}:${sha256(text).slice(0, 12)}`;
}

export function redactionContractValid(redaction: unknown): boolean {
  if (!isRedactionContract(redaction)) return false;
  const scanIds = redaction.artifact_ids;
  const forbidden = redaction.forbidden_literals;
  return (
    scanIds.length > 0 &&
    new Set(scanIds).size === scanIds.length &&
    forbidden.length <= MAX_FORBIDDEN_LITERALS &&
    forbidden.every((value) => typeof value === "string" && value.length > 0)
  );
}

type RedactionContract = { artifact_ids: string[]; forbidden_literals: string[] };

function isRedactionContract(value: unknown): value is RedactionContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as JsonRecord;
  return Array.isArray(record.artifact_ids) && Array.isArray(record.forbidden_literals);
}

export function redactionScanIds(redaction: unknown): string[] {
  return isRedactionContract(redaction) ? redaction.artifact_ids : [];
}

export function redactionForbiddenLiterals(redaction: unknown): string[] {
  return isRedactionContract(redaction) ? redaction.forbidden_literals.map(String) : [];
}

// Every declared artifact must be scanned exactly once. A row_count declaration describes row
// shape only and can never switch scanning off for an artifact whose bytes are still shipped.
export function redactableArtifactIds(artifacts: readonly ArtifactDescriptor[]): string[] {
  return artifacts
    .map((artifact) => artifact?.artifact_id)
    .filter((artifactId): artifactId is string => Boolean(artifactId))
    .sort(compareText);
}
