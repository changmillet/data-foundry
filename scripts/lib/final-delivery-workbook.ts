import path from "node:path";
import zlib from "node:zlib";
import { PromotionArtifactError } from "./final-delivery-manifest.ts";
import {
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  safeRelativePath,
} from "./final-delivery-manifest.ts";
import {
  CONTENT_TYPES_NS,
  MAX_XML_BYTES,
  OFFICE_DOCUMENT_REL_NS,
  PACKAGE_RELATIONSHIPS_NS,
  SPREADSHEET_NS,
  type XmlNode,
  attribute,
  child,
  children,
  collectDecodedText,
  parseXmlDocument,
  plainAttribute,
  textValue,
} from "./final-delivery-xml.ts";

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

const OFFICE_DOCUMENT_REL_TYPE = `${OFFICE_DOCUMENT_REL_NS}/officeDocument`;
const WORKSHEET_REL_TYPE = `${OFFICE_DOCUMENT_REL_NS}/worksheet`;
const WORKSHEET_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const WORKBOOK_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

export type WorkbookCellParts = { column: string; row: number };

export type ParsedSheet = {
  cells: Map<string, string>;
  populatedRows: Set<number>;
};

export type ParsedWorkbook = {
  entries: Map<string, Buffer>;
  names: string[];
  scanText: string;
  sheets: Map<string, ParsedSheet>;
};

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function cellParts(reference: unknown): WorkbookCellParts | null {
  const match = String(reference).match(/^([A-Z]+)([1-9]\d*)$/u);
  return match ? { column: match[1] ?? "", row: Number(match[2]) } : null;
}

export function columnNumber(column: string): number {
  let value = 0;
  for (const character of column) value = value * 26 + character.charCodeAt(0) - 64;
  return value;
}

// Bounded ZIP reader: encryption, unsafe or duplicated entry paths, unsupported compression,
// central/local disagreement, CRC drift and decompression limits all fail closed before any
// workbook content is interpreted.
export function zipEntries(buffer: Buffer): Map<string, Buffer> {
  const minimumEocd = 22;
  if (buffer.byteLength < minimumEocd)
    throw new PromotionArtifactError("workbook_zip_invalid", "XLSX is shorter than a ZIP EOCD.");
  let eocdOffset = -1;
  const lowerBound = Math.max(0, buffer.byteLength - 65_557);
  for (let offset = buffer.byteLength - minimumEocd; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0)
    throw new PromotionArtifactError("workbook_zip_invalid", "XLSX ZIP EOCD was not found.");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > MAX_ZIP_ENTRIES)
    throw new PromotionArtifactError(
      "workbook_zip_directory_invalid",
      "XLSX ZIP has too many entries.",
    );
  if (centralOffset + centralSize > buffer.byteLength) {
    throw new PromotionArtifactError(
      "workbook_zip_directory_invalid",
      "XLSX ZIP central directory exceeds the file boundary.",
    );
  }

  const entries = new Map<string, Buffer>();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.byteLength || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new PromotionArtifactError(
        "workbook_zip_directory_invalid",
        "XLSX ZIP central directory entry is invalid.",
      );
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedBytes = buffer.readUInt32LE(cursor + 20);
    const uncompressedBytes = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.byteLength)
      throw new PromotionArtifactError(
        "workbook_zip_invalid",
        "XLSX ZIP entry name exceeds the file.",
      );
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    if (!safeRelativePath(name) || name.endsWith("/") || entries.has(name)) {
      throw new PromotionArtifactError(
        "workbook_zip_entry_invalid",
        `XLSX ZIP entry path is unsafe or duplicated: ${name}`,
      );
    }
    if ((flags & 0x1) !== 0)
      throw new PromotionArtifactError(
        "workbook_zip_encrypted",
        `Encrypted XLSX entry is not supported: ${name}`,
      );
    if (![0, 8].includes(method))
      throw new PromotionArtifactError(
        "workbook_zip_compression",
        `Unsupported XLSX compression method: ${method}`,
      );
    if (uncompressedBytes > MAX_ZIP_ENTRY_BYTES) {
      throw new PromotionArtifactError(
        "workbook_zip_limit",
        `XLSX entry exceeds the decompression limit: ${name}`,
      );
    }
    totalBytes += uncompressedBytes;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES)
      throw new PromotionArtifactError(
        "workbook_zip_header_invalid",
        "XLSX exceeds the total size limit.",
      );
    if (localOffset + 30 > buffer.byteLength || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new PromotionArtifactError(
        "workbook_zip_header_invalid",
        `XLSX local header is invalid: ${name}`,
      );
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (
      localNameEnd > buffer.byteLength ||
      buffer.subarray(localNameStart, localNameEnd).toString("utf8") !== name ||
      localFlags !== flags ||
      localMethod !== method
    ) {
      throw new PromotionArtifactError(
        "workbook_zip_header_invalid",
        `XLSX local header differs from the central directory: ${name}`,
      );
    }
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedBytes;
    if (dataEnd > buffer.byteLength)
      throw new PromotionArtifactError(
        "workbook_zip_invalid",
        `XLSX entry data exceeds the file: ${name}`,
      );
    const compressed = buffer.subarray(dataStart, dataEnd);
    const content =
      method === 0
        ? Buffer.from(compressed)
        : zlib.inflateRawSync(compressed, {
            maxOutputLength: Math.min(MAX_ZIP_ENTRY_BYTES, uncompressedBytes + 1),
          });
    if (content.byteLength !== uncompressedBytes) {
      throw new PromotionArtifactError(
        "workbook_zip_directory_invalid",
        `XLSX entry byte count differs from the central directory: ${name}`,
      );
    }
    if (crc32(content) !== checksum)
      throw new PromotionArtifactError(
        "workbook_zip_crc_invalid",
        `XLSX entry CRC-32 is invalid: ${name}`,
      );
    entries.set(name, content);
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function parsePart(entries: Map<string, Buffer>, name: string): XmlNode {
  const entry = entries.get(name);
  if (!entry)
    throw new PromotionArtifactError(
      "workbook_part_missing",
      `XLSX is missing a required part: ${name}`,
    );
  if (entry.byteLength > MAX_XML_BYTES)
    throw new PromotionArtifactError(
      "workbook_part_size_limit",
      `XLSX part exceeds the size limit: ${name}`,
    );
  return parseXmlDocument(entry);
}

function relationshipTarget(basePath: string, target: string): string {
  const cleaned = target.replace(/^\/+/u, "");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(basePath), cleaned));
  if (!safeRelativePath(resolved) || !resolved.startsWith("xl/")) {
    throw new PromotionArtifactError(
      "workbook_relationship_escape",
      `Workbook relationship escapes the xl package root: ${target}`,
    );
  }
  return resolved;
}

function readContentTypes(entries: Map<string, Buffer>): Map<string, string> {
  const root = parsePart(entries, "[Content_Types].xml");
  if (root.local !== "Types" || root.uri !== CONTENT_TYPES_NS) {
    throw new PromotionArtifactError(
      "workbook_namespace_invalid",
      "XLSX content types part has an unexpected root element or namespace.",
    );
  }
  const contentTypes = new Map<string, string>();
  for (const override of children(root, CONTENT_TYPES_NS, "Override")) {
    const partName = plainAttribute(override, "PartName")?.replace(/^\/+/u, "");
    const contentType = plainAttribute(override, "ContentType");
    if (!partName || !contentType || contentTypes.has(partName)) {
      throw new PromotionArtifactError(
        "workbook_content_type_invalid",
        "XLSX content type overrides contain an invalid or duplicate part.",
      );
    }
    contentTypes.set(partName, contentType);
  }
  return contentTypes;
}

type Relationship = {
  id: string;
  type: string;
  target: string;
  internal: boolean;
};

function readRelationships(
  entries: Map<string, Buffer>,
  partName: string,
  basePath: string,
): Relationship[] {
  const root = parsePart(entries, partName);
  if (root.local !== "Relationships" || root.uri !== PACKAGE_RELATIONSHIPS_NS) {
    throw new PromotionArtifactError(
      "workbook_namespace_invalid",
      `XLSX ${partName} has an unexpected root element or namespace.`,
    );
  }
  const relationships: Relationship[] = [];
  const seen = new Set<string>();
  for (const relationship of children(root, PACKAGE_RELATIONSHIPS_NS, "Relationship")) {
    const id = plainAttribute(relationship, "Id");
    const type = plainAttribute(relationship, "Type") ?? "";
    const target = plainAttribute(relationship, "Target");
    const targetMode = plainAttribute(relationship, "TargetMode");
    if (!id || !target || seen.has(id)) {
      throw new PromotionArtifactError(
        "workbook_relationship_invalid",
        `XLSX ${partName} has an invalid or duplicate relationship.`,
      );
    }
    // An external target is not a member of the package even when it looks like a relative path,
    // so it is recorded but never resolved as a local part.
    const internal = targetMode === null || targetMode === "Internal";
    seen.add(id);
    relationships.push({
      id,
      type,
      target: internal ? relationshipTarget(basePath, target) : target,
      internal,
    });
  }
  return relationships;
}

// A shared string is either a direct <t> or a sequence of rich runs, each carrying its own <t>.
// Phonetic <rPh> annotations are excluded because they are not the cell's main text — and a
// literal split across runs must still be reconstructed so it cannot hide from the scan.
function textRuns(node: XmlNode): string {
  let text = "";
  for (const item of node.children) {
    if (item.uri !== SPREADSHEET_NS) continue;
    if (item.local === "t") {
      text += textValue(item);
      continue;
    }
    if (item.local === "r") {
      for (const runChild of item.children) {
        if (runChild.uri === SPREADSHEET_NS && runChild.local === "t") {
          text += textValue(runChild);
        }
      }
    }
  }
  return text;
}

function readSharedStrings(entries: Map<string, Buffer>): string[] {
  const entry = entries.get("xl/sharedStrings.xml");
  if (!entry) return [];
  const root = parseXmlDocument(entry);
  if (root.local !== "sst" || root.uri !== SPREADSHEET_NS) {
    throw new PromotionArtifactError(
      "workbook_namespace_invalid",
      "XLSX shared strings part has an unexpected root element or namespace.",
    );
  }
  return children(root, SPREADSHEET_NS, "si").map(textRuns);
}

function readWorksheet(buffer: Buffer, sharedStrings: string[]): ParsedSheet {
  const root = parseXmlDocument(buffer);
  if (root.local !== "worksheet" || root.uri !== SPREADSHEET_NS) {
    throw new PromotionArtifactError(
      "workbook_namespace_invalid",
      "XLSX worksheet has an unexpected root element or namespace.",
    );
  }
  const sheetData = child(root, SPREADSHEET_NS, "sheetData");
  const cells = new Map<string, string>();
  const populatedRows = new Set<number>();
  for (const row of sheetData ? children(sheetData, SPREADSHEET_NS, "row") : []) {
    for (const cell of children(row, SPREADSHEET_NS, "c")) {
      const reference = plainAttribute(cell, "r");
      const parts = cellParts(reference);
      if (!reference || !parts) {
        throw new PromotionArtifactError(
          "workbook_cell_invalid",
          "XLSX worksheet contains a cell without a valid reference.",
        );
      }
      if (cells.has(reference)) {
        throw new PromotionArtifactError(
          "workbook_cell_invalid",
          `XLSX worksheet contains a duplicate cell: ${reference}`,
        );
      }
      const type = plainAttribute(cell, "t");
      let raw: string;
      if (type === "inlineStr") {
        const inline = child(cell, SPREADSHEET_NS, "is");
        raw = inline ? textRuns(inline) : "";
      } else {
        const value = child(cell, SPREADSHEET_NS, "v");
        raw = value ? textValue(value) : "";
        if (type === "s") {
          if (!/^\d+$/u.test(raw)) {
            throw new PromotionArtifactError(
              "workbook_shared_string_invalid",
              `XLSX shared string index is not an integer: ${reference}`,
            );
          }
          const index = Number(raw);
          const shared = sharedStrings[index];
          if (shared === undefined) {
            throw new PromotionArtifactError(
              "workbook_shared_string_invalid",
              `XLSX shared string index is out of range: ${reference}`,
            );
          }
          raw = shared;
        }
      }
      cells.set(reference, raw);
      if (raw !== "") populatedRows.add(parts.row);
    }
  }
  return { cells, populatedRows };
}

export function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  const entries = zipEntries(buffer);
  const contentTypes = readContentTypes(entries);
  if (!contentTypes.get("xl/workbook.xml")?.endsWith(WORKBOOK_CONTENT_TYPE)) {
    throw new PromotionArtifactError(
      "workbook_content_type_invalid",
      "XLSX workbook content type is missing or is not a standard non-macro sheet.",
    );
  }
  const rootRelationships = readRelationships(entries, "_rels/.rels", "");
  const officeDocuments = rootRelationships.filter(
    (relationship) =>
      relationship.internal &&
      relationship.type === OFFICE_DOCUMENT_REL_TYPE &&
      path.posix.normalize(relationship.target) === "xl/workbook.xml",
  );
  if (officeDocuments.length !== 1) {
    throw new PromotionArtifactError(
      "workbook_relationship_invalid",
      "XLSX root relationships must bind exactly one office document workbook.",
    );
  }
  const workbookRelationships = readRelationships(
    entries,
    "xl/_rels/workbook.xml.rels",
    "xl/workbook.xml",
  );
  // Only internal relationships name package parts; an external one never resolves locally.
  const relationshipsById = new Map(
    workbookRelationships
      .filter((relationship) => relationship.internal)
      .map((item) => [item.id, item]),
  );

  const workbook = parsePart(entries, "xl/workbook.xml");
  if (workbook.local !== "workbook" || workbook.uri !== SPREADSHEET_NS) {
    throw new PromotionArtifactError(
      "workbook_namespace_invalid",
      "XLSX workbook part has an unexpected root element or namespace.",
    );
  }
  const sheetsPart = child(workbook, SPREADSHEET_NS, "sheets");
  const sheetElements = sheetsPart ? children(sheetsPart, SPREADSHEET_NS, "sheet") : [];
  if (sheetElements.length === 0)
    throw new PromotionArtifactError(
      "workbook_sheet_invalid",
      "XLSX workbook contains no worksheets.",
    );

  const sharedStrings = readSharedStrings(entries);
  const names: string[] = [];
  const sheets = new Map<string, ParsedSheet>();
  for (const element of sheetElements) {
    const name = plainAttribute(element, "name");
    const relationId = attribute(element, OFFICE_DOCUMENT_REL_NS, "id");
    const relationship = relationId ? relationshipsById.get(relationId) : undefined;
    const target = relationship?.target ?? "";
    const sheetEntry = target ? entries.get(target) : undefined;
    if (
      !name ||
      !relationship ||
      relationship.type !== WORKSHEET_REL_TYPE ||
      !sheetEntry ||
      !contentTypes.get(target)?.endsWith(WORKSHEET_CONTENT_TYPE) ||
      sheets.has(name)
    ) {
      throw new PromotionArtifactError(
        "workbook_sheet_invalid",
        "XLSX workbook contains an invalid or duplicate sheet relationship.",
      );
    }
    names.push(name);
    sheets.set(name, readWorksheet(sheetEntry, sharedStrings));
  }

  // Every XML and relationships part is strictly parsed and its decoded text and attribute values
  // are scanned. Scanning raw bytes instead would keep entity escapes and miss the literal they
  // spell, and would not hold these parts to the strict UTF-8 contract. A malformed part fails
  // closed rather than being claimed as scanned.
  const decodedParts = [...entries.keys()]
    .filter((name) => name.endsWith(".xml") || name.endsWith(".rels"))
    .flatMap((name) => {
      const entry = entries.get(name);
      if (!entry) return [];
      const collected: string[] = [];
      collectDecodedText(parseXmlDocument(entry), collected);
      return collected;
    });
  // Reassembled cell values are kept as well: a literal split across rich runs exists only as the
  // concatenation, not as any single node's text.
  const cellValues = [...sheets.values()].flatMap((sheet) =>
    [...sheet.cells.values()].map((value) => String(value)),
  );
  const scanText = [...decodedParts, ...cellValues].join("\n");
  return { entries, names, scanText, sheets };
}
