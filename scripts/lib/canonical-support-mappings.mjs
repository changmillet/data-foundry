export function defaultCanonicalFlowPropertyMappings() {
  return [
    {
      source_units: ["kg", "g", "mg", "ug", "t", "kt", "mg"],
      canonical_flow_property_id: "93a60a56-a3c8-11da-a746-0800200b9a66",
      reason: "Mass units must reuse the public canonical Mass flow property.",
    },
    {
      source_units: ["p", "item", "items", "item(s)", "dozen(s)"],
      canonical_flow_property_id: "01846770-4cfe-4a25-8ad9-919d8d378345",
      reason: "Countable-item units must reuse the public canonical Number of items flow property.",
    },
    {
      source_units: ["m", "km", "cm", "mm", "ft", "mi", "in", "yd"],
      canonical_flow_property_id: "838aaa23-0117-11db-92e3-0800200c9a66",
      reason: "Length units must reuse the public canonical Length flow property.",
    },
    {
      source_units: ["mj", "kwh", "j", "gj", "mwh", "toe", "kcal", "btu", "tce"],
      canonical_flow_property_id: "93a60a56-a3c8-11da-a746-0800200c9a66",
      reason:
        "Energy units currently reuse the public canonical Net calorific value support row; this is the existing platform canonical available to imports.",
      legacy_support_note:
        "The public library does not yet expose a generic Energy flow property; do not create an account-local replacement.",
    },
    {
      source_units: ["m3", "nm3", "l", "cuft"],
      canonical_flow_property_id: "93a60a56-a3c8-22da-a746-0800200c9a66",
      reason: "Volume units must reuse the public canonical Volume flow property.",
    },
    {
      source_units: ["m2", "km2", "ha", "ft2", "mi2", "cm2"],
      canonical_flow_property_id: "93a60a56-a3c8-19da-a746-0800200c9a66",
      reason: "Area units must reuse the public canonical Area flow property.",
    },
    {
      source_units: ["m2a", "m2*a", "km2*a", "ha*a", "ft2*a", "mi2*a", "m2*d"],
      canonical_flow_property_id: "93a60a56-a3c8-21da-a746-0800200c9a66",
      reason: "Area*time units must reuse the public canonical Area*time flow property.",
    },
    {
      source_units: ["kbq", "bq", "ci", "rutherford"],
      canonical_flow_property_id: "93a60a56-a3c8-17da-a746-0800200c9a66",
      reason: "Radioactivity units must reuse the public canonical Radioactivity flow property.",
    },
    {
      source_units: ["tkm", "t*km", "kg*km"],
      canonical_flow_property_id: "118f2a40-50ec-457c-aa60-9bc6b6af9931",
      reason: "Mass*distance units must reuse the public canonical mass*distance flow property.",
    },
    {
      source_units: ["m3a", "m3*a", "l*a"],
      canonical_flow_property_id: "441238a3-ba09-46ec-b35b-c30cfba746d1",
      reason: "Volume*time units must reuse the public canonical Volume*time flow property.",
    },
    {
      source_units: ["mol"],
      canonical_flow_property_id: "341fd786-b2ad-4552-a762-5eafcab45dee",
      reason: "Mole units must reuse the public canonical Moles flow property.",
    },
    {
      source_units: ["kg*a", "t*a", "kg*d", "t*d", "kga", "ta", "kgd", "td"],
      canonical_flow_property_id: "b3f0f892-c5a3-4c66-a432-c09e3d1e9bd6",
      reason: "Mass*time units must reuse the public canonical Mass*time flow property.",
    },
  ];
}
