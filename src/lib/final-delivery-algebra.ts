import { type JsonRecord, isPlainObject } from "./final-delivery-manifest.ts";
import { type ArtifactRuntime, jsonPointer } from "./final-delivery-rows.ts";

export type AlgebraOperator = "eq" | "lte" | "gte";

export type AlgebraAssertion = JsonRecord & {
  check_id?: string;
  left?: unknown;
  operator?: AlgebraOperator;
  right?: unknown;
};

// Declarative numbers only. An explicitly written decimal is accepted; whitespace padding,
// booleans, null, arrays, objects and empty text are not numbers and never coerce to one.
const NUMERIC_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function requireSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
  return value;
}

function explicitNumber(value: unknown, label: string): number {
  if (typeof value === "number") return requireFinite(value, label);
  if (typeof value === "string" && NUMERIC_TEXT.test(value)) {
    return requireFinite(Number(value), label);
  }
  throw new Error(`${label} is not a finite number.`);
}

// Declarative cross-artifact arithmetic. Every operand resolves to a finite number from a
// literal, an artifact row count, one JSON pointer into an artifact, or a sum of those.
export function evaluateOperand(
  operand: unknown,
  artifactsById: Map<string, ArtifactRuntime>,
): number {
  if (!isPlainObject(operand)) throw new Error("Algebra operand must be an object.");
  if (Object.hasOwn(operand, "literal")) {
    if (typeof operand.literal !== "number") throw new Error("Algebra literal must be finite.");
    return requireFinite(operand.literal, "Algebra literal");
  }
  if (typeof operand.artifact_rows === "string") {
    const artifact = artifactsById.get(operand.artifact_rows);
    if (!artifact || artifact.actualRows === null || artifact.actualRows === undefined) {
      throw new Error(`Artifact rows are unavailable: ${operand.artifact_rows}`);
    }
    return requireSafeInteger(artifact.actualRows, "Artifact row count");
  }
  if (isPlainObject(operand.artifact_json)) {
    const artifactId = operand.artifact_json.artifact_id;
    const artifact = typeof artifactId === "string" ? artifactsById.get(artifactId) : undefined;
    if (!artifact || artifact.parsed?.json === undefined) {
      throw new Error(`Artifact JSON is unavailable: ${String(artifactId)}`);
    }
    const value = jsonPointer(artifact.parsed.json, operand.artifact_json.pointer ?? "");
    return explicitNumber(value, "Artifact JSON pointer");
  }
  if (Array.isArray(operand.sum) && operand.sum.length > 0) {
    let total = 0;
    for (const child of operand.sum as unknown[]) {
      // Every step is checked, so an overflowing or precision-losing intermediate cannot be
      // carried forward and compared as if it were a real total.
      total = requireSumStep(total + evaluateOperand(child, artifactsById));
    }
    return total;
  }
  throw new Error("Unsupported algebra operand.");
}

function requireSumStep(total: number): number {
  if (!Number.isFinite(total) || Math.abs(total) > Number.MAX_SAFE_INTEGER) {
    throw new Error("Algebra sum step must remain a finite safe integer value.");
  }
  return total;
}

export function evaluateAssertion(
  assertion: AlgebraAssertion,
  artifactsById: Map<string, ArtifactRuntime>,
): { passed: boolean; left: number; right: number; operator: AlgebraOperator } {
  const operator = assertion.operator;
  if (operator !== "eq" && operator !== "lte" && operator !== "gte") {
    throw new Error("Algebra operator must be one of eq, lte, gte.");
  }
  const left = evaluateOperand(assertion.left, artifactsById);
  const right = evaluateOperand(assertion.right, artifactsById);
  const passed =
    (operator === "eq" && left === right) ||
    (operator === "lte" && left <= right) ||
    (operator === "gte" && left >= right);
  return { passed, left, right, operator };
}
