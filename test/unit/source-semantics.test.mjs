import test from "node:test";
import { createSourceSemanticUtils } from "../../scripts/lib/source-semantics.mjs";
import { assert } from "../fixtures/foundry-core.mjs";

function utils() {
  const asText = (value) => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("; ");
    if (typeof value === "object") return asText(value["#text"] ?? value.value ?? value.id);
    return "";
  };
  return createSourceSemanticUtils({
    asText,
    bundleClassificationPath: () => null,
    cloneJson: (value) => JSON.parse(JSON.stringify(value)),
    datasetIdentity: () => null,
    deterministicUuid: (seed) => `uuid:${seed}`,
    languageForText: () => "en",
    multiLang: (text, lang = "en") => ({ "@xml:lang": lang, "#text": text }),
    pathExpression: (parts) => parts.join("."),
    repoRelativeMaybe: (value) => value,
    textValue: asText,
  });
}

test("BAFU fallback source payload nests the format reference inside dataEntryBy", () => {
  const payload = utils().buildBafuFallbackSourcePayload({
    contactReference: { "@refObjectId": "contact-1" },
    timestamp: "2025-01-01T00:00:00.000Z",
  });
  const admin = payload.sourceDataSet.administrativeInformation;
  assert.ok(
    admin.dataEntryBy["common:referenceToDataSetFormat"],
    "dataEntryBy must carry common:referenceToDataSetFormat",
  );
  assert.equal(admin.dataEntryBy["common:timeStamp"], "2025-01-01T00:00:00.000Z");
  assert.equal(
    admin["common:referenceToDataSetFormat"],
    undefined,
    "format reference must not sit at the administrativeInformation root",
  );
  assert.equal(admin.publicationAndOwnership["common:dataSetVersion"], "00.00.001");
});

test("BAFU fallback source payload keeps the format reference without a timestamp", () => {
  const payload = utils().buildBafuFallbackSourcePayload({});
  const dataEntryBy = payload.sourceDataSet.administrativeInformation.dataEntryBy;
  assert.ok(dataEntryBy["common:referenceToDataSetFormat"]);
  assert.equal(dataEntryBy["common:timeStamp"], undefined);
});
