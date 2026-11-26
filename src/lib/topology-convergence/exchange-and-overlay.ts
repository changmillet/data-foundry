import type { ValidateFunction } from "ajv";
import {
  asToken,
  assertSchema,
  clone,
  entityKey,
  jsonLines,
  sha256Json,
  type ClassificationRow,
  type ExchangeOccurrence,
  type FlowMapping,
  type GermanSynonym,
  type JsonObject,
  type OverlayResult,
  type VerifiedArtifact,
} from "./types-and-io.ts";

export function setFlowClassification(payload: JsonObject, classification: JsonObject): void {
  payload.flowDataSet!.flowInformation!.dataSetInformation!.classificationInformation =
    clone(classification);
}

export function leafClassificationCode(classification: JsonObject): string {
  const classes = classification?.["common:classification"]?.["common:class"];
  const array = Array.isArray(classes) ? classes : classes ? [classes] : [];
  return asToken((array.at(-1) as JsonObject | undefined)?.["@classId"]);
}

export function referenceIdentity(reference: JsonObject): string {
  return `${asToken(reference?.["@refObjectId"])}@${asToken(reference?.["@version"])}`;
}

export function collectSupportReferences(
  value: unknown,
  result: { flowproperties: Set<string>; unitgroups: Set<string> } = {
    flowproperties: new Set<string>(),
    unitgroups: new Set<string>(),
  },
) {
  if (Array.isArray(value)) {
    for (const child of value) collectSupportReferences(child, result);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "referenceToFlowPropertyDataSet")
        result.flowproperties.add(referenceIdentity(child as JsonObject));
      if (/referenceTo(?:Reference)?UnitGroup/u.test(key))
        result.unitgroups.add(referenceIdentity(child as JsonObject));
      collectSupportReferences(child, result);
    }
  }
  return result;
}

export function candidateExchanges(payload: JsonObject): JsonObject[] {
  const value = payload?.processDataSet?.exchanges?.exchange;
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).filter((entry): entry is JsonObject =>
    Boolean(entry && typeof entry === "object"),
  );
}

function textFragments(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const child of value) textFragments(child, output);
  } else if (value && typeof value === "object") {
    const record = value as JsonObject;
    if (typeof record["#text"] === "string") output.push(record["#text"]);
    else for (const child of Object.values(record)) textFragments(child, output);
  }
  return output;
}

function sourceExchangeNumber(
  exchange: JsonObject,
  processId: string,
  exchangeIndex: number,
): string {
  const traceExchange =
    exchange["common:other"]?.["tidasimport:sourceTrace"]?.payload?.sourceTrace?.exchange;
  const attributes =
    traceExchange && typeof traceExchange === "object" && !Array.isArray(traceExchange)
      ? traceExchange.attributes
      : undefined;
  const array = (Array.isArray(attributes) ? attributes : attributes ? [attributes] : []).filter(
    (attribute): attribute is JsonObject => Boolean(attribute && typeof attribute === "object"),
  );
  const traceNumbers = [
    ...new Set(
      array
        .filter((attribute) => attribute?.name === "number")
        .map((attribute) => asToken(attribute?.value))
        .filter(Boolean),
    ),
  ];
  const commentNumbers = [
    ...new Set(
      textFragments(exchange?.generalComment).flatMap((fragment) =>
        [...fragment.matchAll(/Source EcoSpold1 exchange number:\s*([0-9]+)(?:\.|\b)/giu)].map(
          (match) => match[1],
        ),
      ),
    ),
  ];
  if (traceNumbers.length > 1 || commentNumbers.length > 1) {
    throw new Error(
      `Process ${processId} exchange ${exchangeIndex + 1} has ambiguous source numbers.`,
    );
  }
  const traceNumber = traceNumbers[0] ?? "";
  const commentNumber = commentNumbers[0] ?? "";
  if (traceNumber && commentNumber && traceNumber !== commentNumber) {
    throw new Error(
      `Process ${processId} exchange ${exchangeIndex + 1} sourceTrace/generalComment number mismatch.`,
    );
  }
  return traceNumber || commentNumber;
}

export function occurrenceKeyedExchanges(
  exchanges: JsonObject[],
  processId: string,
): ExchangeOccurrence[] {
  const occurrences = new Map<string, number>();
  const ordered: ExchangeOccurrence[] = [];
  for (let index = 0; index < exchanges.length; index += 1) {
    const exchange = exchanges[index];
    const number = sourceExchangeNumber(exchange, processId, index);
    if (!number)
      throw new Error(`Process ${processId} exchange ${index + 1} has no source number.`);
    const occurrence = (occurrences.get(number) ?? 0) + 1;
    occurrences.set(number, occurrence);
    const token = `${number}\u0000${occurrence}`;
    ordered.push({ token, number, occurrence, index, exchange });
  }
  return ordered;
}

function languageValues(value: unknown): JsonObject[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).filter((entry): entry is JsonObject =>
    Boolean(entry && typeof entry === "object"),
  );
}

export function upsertLanguage(
  value: unknown,
  language: string,
  replacement: JsonObject,
): JsonObject | JsonObject[] {
  const kept = languageValues(value).filter((entry) => entry?.["@xml:lang"] !== language);
  const output = [...kept, clone(replacement)];
  return output.length === 1 ? output[0] : output;
}

function chineseDescriptions(exchange: JsonObject): JsonObject[] {
  return languageValues(exchange?.referenceToFlowDataSet?.["common:shortDescription"]).filter(
    (entry) => entry?.["@xml:lang"] === "zh",
  );
}

export function overlayChineseDescription(
  candidateReference: JsonObject,
  currentExchange: JsonObject,
): OverlayResult {
  const output = clone(candidateReference);
  const chinese = chineseDescriptions(currentExchange);
  if (chinese.length > 1)
    throw new Error("An exchange contains duplicate zh shortDescription nodes.");
  if (chinese.length === 1) {
    output["common:shortDescription"] = upsertLanguage(
      output["common:shortDescription"],
      "zh",
      chinese[0],
    );
  }
  return { reference: output, chinese };
}

function canonicalDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const token = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(token);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  const digits = `${match[2]}${match[3] ?? ""}`;
  const point = match[2].length + exponent;
  const expanded =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? `${digits}${"0".repeat(point - digits.length)}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [wholeRaw, fractionRaw = ""] = expanded.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/u, "") || "0";
  const fraction = fractionRaw.replace(/0+$/u, "");
  const magnitude = fraction ? `${whole}.${fraction}` : whole;
  return magnitude === "0" ? "0" : `${match[1] === "-" ? "-" : ""}${magnitude}`;
}

export function decimalEqual(left: unknown, right: unknown): boolean {
  const normalized = [canonicalDecimal(left), canonicalDecimal(right)];
  return normalized[0] != null && normalized[0] === normalized[1];
}

export function exchangeFlowIdentity(exchange: JsonObject): string {
  return referenceIdentity(exchange.referenceToFlowDataSet ?? {});
}

export function loadClassifications(
  verified: VerifiedArtifact,
  validate: ValidateFunction,
): Map<string, ClassificationRow> {
  const result = new Map<string, ClassificationRow>();
  for (const { value, line } of jsonLines<ClassificationRow>(verified.filePath)) {
    assertSchema(validate, value, `target classification line ${line}`);
    if (value.entity.table !== "flows")
      throw new Error(`Classification line ${line} is not a flow.`);
    const key = entityKey(value.entity);
    if (result.has(key)) throw new Error(`Duplicate target classification: ${key}`);
    result.set(key, value);
  }
  return result;
}

export function loadGermanSynonyms(verified: VerifiedArtifact): Map<string, GermanSynonym> {
  const result = new Map<string, GermanSynonym>();
  for (const { value, line } of jsonLines(verified.filePath)) {
    const processId = asToken(
      value.process_id ?? (value.entity as { id?: unknown } | undefined)?.id,
    );
    const desired = (value.value ?? value.desired_value) as JsonObject;
    const evidence = asToken(value.evidence_sha256 ?? value.language_event_sha256);
    if (!processId || !desired || desired["@xml:lang"] !== "de" || !evidence) {
      throw new Error(`German synonym line ${line} is malformed.`);
    }
    const desiredSha = value.value_sha256 ?? value.desired_value_sha256 ?? sha256Json(desired);
    if (desiredSha !== sha256Json(desired))
      throw new Error(`German synonym line ${line} hash drift.`);
    if (result.has(processId)) throw new Error(`Duplicate German synonym process: ${processId}`);
    result.set(processId, { value: desired, evidence_sha256: evidence });
  }
  return result;
}

export function loadMappings(verified: VerifiedArtifact): {
  rows: FlowMapping[];
  byPair: Map<string, FlowMapping>;
} {
  const rows: FlowMapping[] = [];
  const byPair = new Map<string, FlowMapping>();
  for (const { value, line } of jsonLines(verified.filePath)) {
    const oldId = asToken(value.old_flow_id ?? value.old_flow_uuid);
    const newId = asToken(value.new_flow_id ?? value.new_flow_uuid);
    const mappingKind = asToken(value.mapping_kind ?? value.relation);
    const evidence = asToken(value.evidence_sha256);
    if (!newId || !mappingKind || !evidence)
      throw new Error(`Flow mapping line ${line} is malformed.`);
    const row = {
      old_flow_id: oldId || null,
      new_flow_id: newId,
      mapping_kind: mappingKind,
      evidence_sha256: evidence,
    };
    rows.push(row);
    if (oldId) {
      const pair = `${oldId}\u0000${newId}`;
      if (byPair.has(pair)) throw new Error(`Duplicate flow mapping pair at line ${line}.`);
      byPair.set(pair, row);
    }
  }
  return { rows, byPair };
}
