import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTidasLanguageCode,
  tidasLanguageForText,
} from "../../scripts/lib/tidas-language-utils.mjs";

test("TIDAS language helpers accept enumerated language codes", () => {
  assert.equal(normalizeTidasLanguageCode("en"), "en");
  assert.equal(normalizeTidasLanguageCode("DE"), "de");
  assert.equal(normalizeTidasLanguageCode(" zh "), "zh");
});

test("TIDAS language helpers reject regional language tags", () => {
  assert.throws(() => normalizeTidasLanguageCode("zh-CN"), /TIDAS Languages enumeration value/u);
  assert.throws(() => normalizeTidasLanguageCode("en-US"), /TIDAS Languages enumeration value/u);
});

test("TIDAS language helpers detect Chinese source text as zh", () => {
  assert.equal(tidasLanguageForText("中文名称"), "zh");
  assert.equal(tidasLanguageForText("German source text", "de"), "de");
});
