export const bundleRowTypes = {
  contact: {
    plural: "contacts",
    rootKey: "contactDataSet",
    informationKey: "contactInformation",
  },
  source: {
    plural: "sources",
    rootKey: "sourceDataSet",
    informationKey: "sourceInformation",
  },
  unitgroup: {
    plural: "unitgroups",
    rootKey: "unitGroupDataSet",
    informationKey: "unitGroupInformation",
  },
  flowproperty: {
    plural: "flowproperties",
    rootKey: "flowPropertyDataSet",
    informationKey: "flowPropertiesInformation",
  },
  flow: {
    plural: "flows",
    rootKey: "flowDataSet",
    informationKey: "flowInformation",
  },
  process: {
    plural: "processes",
    rootKey: "processDataSet",
    informationKey: "processInformation",
  },
  lifecyclemodel: {
    plural: "lifecyclemodels",
    rootKey: "lifeCycleModelDataSet",
    informationKey: "lifeCycleModelInformation",
  },
};

export const bundleRowTypeOrder = [
  "contact",
  "source",
  "unitgroup",
  "flowproperty",
  "flow",
  "process",
  "lifecyclemodel",
];
