export const supportedDatasetTypes = new Set([
  "contact",
  "flow",
  "flowproperty",
  "lifecyclemodel",
  "process",
  "source",
  "support",
  "unitgroup",
]);

export const supportDatasetTypes = new Set(["contact", "source"]);

export const referenceOnlySupportDatasetTypes = new Set(["unitgroup", "flowproperty"]);

export const datasetTypePlural = {
  contact: "contacts",
  process: "processes",
  flow: "flows",
  flowproperty: "flowproperties",
  lifecyclemodel: "lifecyclemodels",
  source: "sources",
  support: "support",
  unitgroup: "unitgroups",
};

export const defaultProfilesFile = "specs/import-profiles.json";

export const fallbackProfiles = {
  schema_version: 1,
  default_profile: "generic",
  profiles: {
    generic: {
      id: "generic",
      description: "Default profile with no dataset-specific waivers.",
      docs: [],
      waived_qa_codes_by_type: {},
      waiver_reasons: {},
    },
  },
};

export function datasetTypeFromOptions(options, forcedType = null) {
  const datasetType = String(
    forcedType ?? options.type ?? options.datasetType ?? options.kind ?? "process",
  )
    .trim()
    .toLowerCase();
  if (!supportedDatasetTypes.has(datasetType)) {
    throw new Error(
      `Unsupported dataset type: ${datasetType}. Expected contact, source, unitgroup, flowproperty, support, flow, process, or lifecyclemodel.`,
    );
  }
  return datasetType;
}
