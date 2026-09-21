import assert from "node:assert/strict";
import test from "node:test";
import {
  cellParts,
  columnNumber,
  parseWorkbook,
} from "../../scripts/lib/final-delivery-workbook.ts";
import { parseXmlDocument } from "../../scripts/lib/final-delivery-xml.ts";
import { sheetXml, storedZip, workbookBuffer } from "../fixtures/final-delivery-fixtures.ts";

function throwsWith(fragment: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof Error, String(error));
    assert.match(error.message, new RegExp(fragment, "u"));
    return true;
  };
}

function patchFirstEntryMethod(buffer: Buffer, method: number): Buffer {
  const mutated = Buffer.from(buffer);
  mutated.writeUInt16LE(method, 8);
  const centralOffset = mutated.readUInt32LE(mutated.length - 22 + 16);
  mutated.writeUInt16LE(method, centralOffset + 10);
  return mutated;
}

function patchFirstEntryUncompressedSize(buffer: Buffer, size: number): Buffer {
  const mutated = Buffer.from(buffer);
  const centralOffset = mutated.readUInt32LE(mutated.length - 22 + 16);
  mutated.writeUInt32LE(size, centralOffset + 24);
  return mutated;
}

test("workbook parsing binds exact sheet order, cells, and scanned text", () => {
  const workbook = parseWorkbook(workbookBuffer());
  assert.deepEqual(workbook.names, ["Summary", "Evidence"]);
  assert.equal(workbook.sheets.get("Summary")?.cells.get("B2"), "ready");
  assert.equal(workbook.sheets.get("Evidence")?.cells.get("B2"), "ready");
  assert.deepEqual([...(workbook.sheets.get("Summary")?.populatedRows ?? [])], [1, 2]);
  assert.match(workbook.scanText, /summary-1/u);
  assert.match(workbook.scanText, /evidence-1/u);
});

test("workbook parsing derives cell references and columns exactly", () => {
  assert.deepEqual(cellParts("AB12"), { column: "AB", row: 12 });
  assert.equal(cellParts("A0"), null);
  assert.equal(cellParts("12"), null);
  assert.equal(columnNumber("A"), 1);
  assert.equal(columnNumber("Z"), 26);
  assert.equal(columnNumber("AA"), 27);
});

test("workbook parsing fails closed on unsafe ZIP entry paths", () => {
  assert.throws(
    () => parseWorkbook(storedZip({ "../escape.xml": "<a/>" })),
    throwsWith("unsafe or duplicated"),
  );
  assert.throws(
    () => parseWorkbook(storedZip({ "/absolute.xml": "<a/>" })),
    throwsWith("unsafe or duplicated"),
  );
});

test("workbook parsing fails closed on encrypted entries", () => {
  assert.throws(
    () => parseWorkbook(storedZip({ "xl/workbook.xml": "<a/>" }, { encrypted: true })),
    throwsWith("Encrypted XLSX entry is not supported"),
  );
});

test("workbook parsing fails closed on unsupported compression", () => {
  assert.throws(
    () => parseWorkbook(patchFirstEntryMethod(workbookBuffer(), 99)),
    throwsWith("Unsupported XLSX compression method"),
  );
});

test("workbook parsing fails closed on CRC drift", () => {
  const buffer = workbookBuffer();
  const mutated = Buffer.from(buffer);
  const offset = mutated.indexOf(Buffer.from("summary-1"));
  assert.ok(offset > 0);
  mutated[offset] = mutated[offset] === 0x73 ? 0x74 : 0x73;
  assert.throws(() => parseWorkbook(mutated), throwsWith("CRC-32 is invalid"));
});

test("workbook parsing fails closed on the decompression limit", () => {
  assert.throws(
    () => parseWorkbook(patchFirstEntryUncompressedSize(workbookBuffer(), 64 * 1024 * 1024)),
    throwsWith("exceeds the decompression limit"),
  );
});

test("workbook parsing fails closed on truncated or EOCD-less input", () => {
  assert.throws(() => parseWorkbook(Buffer.from("PK", "utf8")), throwsWith("shorter than a ZIP"));
  assert.throws(() => parseWorkbook(Buffer.alloc(64, 0x00)), throwsWith("ZIP EOCD was not found"));
});

test("workbook parsing fails closed on a missing OOXML part", () => {
  assert.throws(
    () => parseWorkbook(storedZip({ "xl/workbook.xml": "<a/>" })),
    throwsWith("missing a required part"),
  );
});

test("workbook parsing rejects a macro-enabled workbook content type", () => {
  assert.throws(
    () => parseWorkbook(workbookBuffer("ready", true)),
    throwsWith("not a standard non-macro sheet"),
  );
});

test("workbook parsing rejects a relationship that escapes the package root", () => {
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="../../evil.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheetXml([["id"], ["row-1"]]),
  };
  assert.throws(() => parseWorkbook(storedZip(files)), throwsWith("escapes the xl package root"));
});

function parts(workbookXml: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": workbookXml,
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheetXml([["id"], ["row-1"]]),
    "xl/worksheets/sheet2.xml": sheetXml([["id"], ["row-2"]]),
    ...extra,
  };
}

const WORKBOOK_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

test("workbook parsing ignores sheet elements that are only inside XML comments", () => {
  const commented = `${WORKBOOK_OPEN}<!-- <sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Evidence" sheetId="2" r:id="rId2"/> --><sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbook = parseWorkbook(storedZip(parts(commented)));
  assert.deepEqual(workbook.names, ["Real"], "commented-out sheets are not real sheets");
});

test("workbook parsing ignores sheet elements inside CDATA", () => {
  const cdata = `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets><extLst><![CDATA[<sheet name="Ghost" r:id="rId2"/>]]></extLst></workbook>`;
  assert.deepEqual(parseWorkbook(storedZip(parts(cdata))).names, ["Real"]);
});

test("workbook parsing fails closed on a DOCTYPE or an entity declaration", () => {
  const withDoctype = (declaration: string): string =>
    WORKBOOK_OPEN.replace("?>", `?>${declaration}`);
  assert.throws(
    () =>
      parseWorkbook(
        storedZip(
          parts(
            `${withDoctype('<!DOCTYPE workbook [<!ENTITY x "y">]>')}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`,
          ),
        ),
      ),
    throwsWith("DTD|DOCTYPE"),
  );
  assert.throws(
    () =>
      parseWorkbook(
        storedZip(
          parts(
            `${withDoctype('<!DOCTYPE workbook SYSTEM "http://example.invalid/x.dtd">')}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`,
          ),
        ),
      ),
    throwsWith("DTD|DOCTYPE"),
  );
  const external = `${WORKBOOK_OPEN.replace("?>", '?><!DOCTYPE workbook SYSTEM "http://example.invalid/x.dtd">')}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  assert.throws(() => parseWorkbook(storedZip(parts(external))), throwsWith("DTD|DOCTYPE"));
});

test("workbook parsing fails closed on malformed XML", () => {
  const unclosed = `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"></sheets></workbook>`;
  assert.throws(() => parseWorkbook(storedZip(parts(unclosed))));
  const stray = `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook></extra>`;
  assert.throws(() => parseWorkbook(storedZip(parts(stray))));
});

test("workbook parsing fails closed on duplicate cells and invalid shared-string indices", () => {
  const duplicateCell = storedZip({
    ...parts(
      `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/worksheets/sheet1.xml": sheetXml([["id"], ["row-1"]]).replace(
      "</sheetData>",
      '<row r="3"><c r="A3" t="inlineStr"><is><t>extra</t></is></c><c r="A3" t="inlineStr"><is><t>dupe</t></is></c></row></sheetData>',
    ),
  });
  assert.throws(() => parseWorkbook(duplicateCell), throwsWith("duplicate cell"));

  const sharedStrings =
    '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>only</t></si></sst>';
  const badIndex = storedZip({
    ...parts(
      `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/sharedStrings.xml": sharedStrings,
    "xl/worksheets/sheet1.xml":
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>7</v></c></row></sheetData></worksheet>',
  });
  assert.throws(() => parseWorkbook(badIndex), throwsWith("shared string index"));
});

test("workbook parsing fails closed when a sheet relationship is missing or mistyped", () => {
  const missing = {
    ...parts(
      `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId9"/></sheets></workbook>`,
    ),
  };
  assert.throws(() => parseWorkbook(storedZip(missing)), throwsWith("invalid or duplicate sheet"));

  const mistyped = {
    ...parts(
      `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet"/></Relationships>',
  };
  assert.throws(() => parseWorkbook(storedZip(mistyped)), throwsWith("invalid or duplicate sheet"));
});

test("workbook parsing still accepts a valid namespace-prefixed workbook", () => {
  const prefixed = `<?xml version="1.0" encoding="UTF-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="One" sheetId="1" r:id="rId1"/><x:sheet name="Two" sheetId="2" r:id="rId2"/></x:sheets></x:workbook>`;
  const files = parts(prefixed, {
    "xl/worksheets/sheet1.xml":
      '<?xml version="1.0" encoding="UTF-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>ok</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>',
    "xl/worksheets/sheet2.xml":
      '<?xml version="1.0" encoding="UTF-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>two</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>',
  });
  const workbook = parseWorkbook(storedZip(files));
  assert.deepEqual(workbook.names, ["One", "Two"]);
  assert.equal(workbook.sheets.get("One")?.cells.get("A1"), "ok");
});

test("XML bytes must be strict UTF-8 rather than silently replaced", () => {
  // Exercised at the XML boundary, because a mutated ZIP entry would fail its CRC first.
  const invalid = Buffer.concat([
    Buffer.from(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      "utf8",
    ),
    Buffer.from([0xff, 0xfe]),
    Buffer.from("</workbook>", "utf8"),
  ]);
  assert.throws(() => parseXmlDocument(invalid), throwsWith("UTF-8"));
  assert.throws(() => parseXmlDocument(invalid), throwsWith("UTF-8"), "no U+FFFD substitution");
});

test("workbook parsing matches child elements by namespace, not only by local name", () => {
  const foreign = `${WORKBOOK_OPEN}<x:sheets xmlns:x="urn:not-ooxml"><x:sheet name="Fake" sheetId="1" r:id="rId1"/></x:sheets></workbook>`;
  assert.throws(
    () => parseWorkbook(storedZip(parts(foreign))),
    throwsWith("no worksheets|invalid or duplicate sheet"),
  );

  const real = `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets><sheets xmlns="urn:not-ooxml"><sheet name="Fake2" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  assert.deepEqual(parseWorkbook(storedZip(parts(real))).names, ["Real"]);
});

test("workbook parsing requires the unqualified OOXML attribute namespace", () => {
  // A foreign-namespaced attribute must not be read as the sheet name.
  const foreignAttr = `${WORKBOOK_OPEN}<sheets><sheet xmlns:x="urn:not-ooxml" x:name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  assert.throws(
    () => parseWorkbook(storedZip(parts(foreignAttr))),
    throwsWith("invalid or duplicate sheet"),
  );
  // The relationship id must be in exactly the office-document relationship namespace.
  const foreignRel = `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" xmlns:q="urn:not-ooxml" q:id="rId1"/></sheets></workbook>`;
  assert.throws(
    () => parseWorkbook(storedZip(parts(foreignRel))),
    throwsWith("invalid or duplicate sheet"),
  );
});

function sharedStringWorkbook(si: string, extra: Record<string, string> = {}): Buffer {
  return storedZip({
    ...parts(
      `${WORKBOOK_OPEN}<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${si}</sst>`,
    "xl/worksheets/sheet1.xml":
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
    ...extra,
  });
}

test("workbook parsing concatenates rich-text runs instead of returning empty text", () => {
  const workbook = parseWorkbook(
    sharedStringWorkbook('<si><r><t>pass</t></r><r><t>word="supersecret123"</t></r></si>'),
  );
  assert.equal(
    workbook.sheets.get("S")?.cells.get("A1"),
    'password="supersecret123"',
    "splitting a literal across runs must not hide it",
  );
  assert.match(workbook.scanText, /password="supersecret123"/u);
});

test("workbook parsing keeps plain and rich shared strings and skips phonetic runs", () => {
  assert.equal(
    parseWorkbook(sharedStringWorkbook("<si><t>plain</t></si>")).sheets.get("S")?.cells.get("A1"),
    "plain",
  );
  const withPhonetic = parseWorkbook(
    sharedStringWorkbook(
      '<si><r><t>body</t></r><rPh sb="0" eb="4"><t>PHONETIC</t></rPh><phoneticPr fontId="0"/></si>',
    ),
  );
  assert.equal(
    withPhonetic.sheets.get("S")?.cells.get("A1"),
    "body",
    "phonetic annotation is not main text",
  );
});

test("workbook parsing concatenates rich inline strings", () => {
  const files = parts(
    `${WORKBOOK_OPEN}<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  const workbook = parseWorkbook(
    storedZip({
      ...files,
      "xl/worksheets/sheet1.xml":
        '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t>pass</t></r><r><t>word="supersecret123"</t></r></is></c></row></sheetData></worksheet>',
    }),
  );
  assert.equal(workbook.sheets.get("S")?.cells.get("A1"), 'password="supersecret123"');
});

test("workbook parsing does not treat an external relationship as a local part", () => {
  const external = {
    ...parts(
      `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" TargetMode="External"/></Relationships>',
  };
  assert.throws(() => parseWorkbook(storedZip(external)), throwsWith("invalid or duplicate sheet"));
});

test("workbook parsing requires the exact office-document relationship type", () => {
  const prefixed = {
    ...parts(
      `${WORKBOOK_OPEN}<sheets><sheet name="Real" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rW" Type="urn:not-ooxml/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  };
  assert.throws(() => parseWorkbook(storedZip(prefixed)), throwsWith("office document"));
});

const SCAN_SECRET = "AKIAIOSFODNN7EXAMPLE";
// Escaping the first character means only a decoded scan can see the literal.
const SCAN_ESCAPED = "&#x41;KIAIOSFODNN7EXAMPLE";

test("workbook scanning collects decoded attribute values", () => {
  const workbook = parseWorkbook(
    storedZip(
      parts(
        `${WORKBOOK_OPEN}<sheets><sheet name="S" sheetId="1" r:id="rId1"/><sheet name="${SCAN_ESCAPED}" sheetId="2" r:id="rId1"/></sheets></workbook>`,
      ),
    ),
  );
  assert.equal(workbook.scanText.includes(`&#x41;KIA`), false, "the escape must be decoded");
  assert.equal(workbook.scanText.includes(SCAN_SECRET), true, "the decoded attribute is scanned");
});

test("workbook scanning covers an unused shared string", () => {
  const workbook = parseWorkbook(
    storedZip(
      parts(
        `${WORKBOOK_OPEN}<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        {
          "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>${SCAN_ESCAPED}</t></si></sst>`,
          "xl/worksheets/sheet1.xml":
            '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>clean</t></is></c></row></sheetData></worksheet>',
        },
      ),
    ),
  );
  assert.equal(
    workbook.scanText.includes(SCAN_SECRET),
    true,
    "a shared string no cell references is still shipped content",
  );
});

test("phonetic text is scanned even though it is not cell body text", () => {
  const workbook = parseWorkbook(
    storedZip(
      parts(
        `${WORKBOOK_OPEN}<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        {
          "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>body</t><rPh sb="0" eb="4"><t>${SCAN_ESCAPED}</t></rPh></si></sst>`,
          "xl/worksheets/sheet1.xml":
            '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
        },
      ),
    ),
  );
  assert.equal(
    workbook.sheets.get("S")?.cells.get("A1"),
    "body",
    "phonetic annotation is still not the cell body value",
  );
  assert.equal(
    workbook.scanText.includes(SCAN_SECRET),
    true,
    "phonetic text is excluded from cell values, not from the redaction scan",
  );
});
