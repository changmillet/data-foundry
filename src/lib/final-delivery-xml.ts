import { SaxesParser } from "saxes";
import { PromotionArtifactError, decodeArtifactText } from "./final-delivery-manifest.ts";

export type XmlAttribute = { uri: string; local: string; value: string };

export type XmlNode = {
  uri: string;
  local: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  text: string;
};

export const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_XML_DEPTH = 64;
const MAX_XML_NODES = 200_000;

// The OOXML relationship and content-type namespaces used by this gate.
export const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const PACKAGE_RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
export const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
export const OFFICE_DOCUMENT_REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// A real namespace-aware parse. Malformed XML, undeclared prefixes, a DTD/DOCTYPE declaration, and
// any saxes error fail closed immediately; events after an error are never trusted. Comments and
// CDATA are not elements, so markup that only looks like a sheet inside them is never surfaced.
export function parseXmlDocument(input: Buffer | string): XmlNode {
  if (typeof input !== "string" && input.byteLength > MAX_XML_BYTES) {
    throw new PromotionArtifactError("xml_size_limit", "XML document exceeds the size limit.");
  }
  // XML bytes are held to the same strict UTF-8 contract as any other text artifact: an
  // undecodable byte must not be silently replaced with U+FFFD and then parsed as markup.
  const text = typeof input === "string" ? input : decodeArtifactText(input);
  if (Buffer.byteLength(text, "utf8") > MAX_XML_BYTES) {
    throw new PromotionArtifactError("xml_size_limit", "XML document exceeds the size limit.");
  }
  let sawDoctype = false;
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  parser.on("doctype", () => {
    sawDoctype = true;
  });

  const document: XmlNode = { uri: "", local: "#document", attributes: [], children: [], text: "" };
  const stack: XmlNode[] = [document];
  let nodes = 0;

  parser.on("opentag", (tag) => {
    nodes += 1;
    if (nodes > MAX_XML_NODES)
      throw new PromotionArtifactError("xml_node_limit", "XML document exceeds the element limit.");
    if (stack.length > MAX_XML_DEPTH)
      throw new PromotionArtifactError("xml_depth_limit", "XML document exceeds the depth limit.");
    const node: XmlNode = {
      uri: tag.uri ?? "",
      local: tag.local ?? tag.name,
      attributes: Object.values(tag.attributes ?? {}).map((attribute) => ({
        uri: attribute.uri ?? "",
        local: attribute.local ?? attribute.name,
        value: attribute.value,
      })),
      children: [],
      text: "",
    };
    stack[stack.length - 1]?.children.push(node);
    stack.push(node);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("text", (value) => {
    const current = stack[stack.length - 1];
    if (current) current.text += value;
  });
  parser.on("cdata", (value) => {
    const current = stack[stack.length - 1];
    if (current) current.text += value;
  });

  try {
    parser.write(text).close();
  } catch (error) {
    throw new PromotionArtifactError(
      "xml_not_well_formed",
      `XML document is not well formed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (sawDoctype)
    throw new PromotionArtifactError(
      "xml_doctype_forbidden",
      "XML DTD/DOCTYPE declarations are not supported.",
    );
  const root = document.children[0];
  if (!root) throw new PromotionArtifactError("xml_no_root", "XML document has no root element.");
  return root;
}

export function attribute(node: XmlNode, uri: string, local: string): string | null {
  const found = node.attributes.find((item) => item.local === local && item.uri === uri);
  return found ? found.value : null;
}

// Child and attribute lookup is namespace-consistent. A correct root does not vouch for its
// descendants, so a foreign-namespace element or attribute is never read as OOXML.
export function children(node: XmlNode, uri: string, local: string): XmlNode[] {
  return node.children.filter((item) => item.local === local && item.uri === uri);
}

export function child(node: XmlNode, uri: string, local: string): XmlNode | null {
  return node.children.find((item) => item.local === local && item.uri === uri) ?? null;
}

// Unqualified OOXML attributes live in no namespace.
export function plainAttribute(node: XmlNode, local: string): string | null {
  return attribute(node, "", local);
}

// Descendants are matched on the local name only where OOXML places a repeated wrapper
// (`sheets/sheet`, `Relationships/Relationship`); namespace identity is enforced by the caller.
export function descendants(node: XmlNode, local: string): XmlNode[] {
  const found: XmlNode[] = [];
  const walk = (current: XmlNode): void => {
    for (const item of current.children) {
      if (item.local === local) found.push(item);
      walk(item);
    }
  };
  walk(node);
  return found;
}

// Every decoded text node and attribute value in a document, for redaction scanning. The parser
// has already resolved entity and character references, so a literal written as `&#x41;` is visible
// here in the form a reader would see it. This deliberately includes text that is not a cell's body,
// such as phonetic annotation or a shared string no cell references: those are still shipped
// content and must not escape the scan.
export function collectDecodedText(node: XmlNode, out: string[]): void {
  if (node.text.length > 0) out.push(node.text);
  for (const attribute of node.attributes) {
    if (attribute.value.length > 0) out.push(attribute.value);
  }
  for (const child of node.children) collectDecodedText(child, out);
}

export function textValue(node: XmlNode): string {
  return node.text;
}
