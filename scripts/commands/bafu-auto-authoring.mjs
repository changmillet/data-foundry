import fs from "node:fs";
import path from "node:path";

const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function lowerText(value) {
  return String(value ?? "").toLowerCase();
}

function arrayValues(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function textFromMultilang(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return String(value["#text"] ?? value.text ?? "");
  }
  return "";
}

function englishText(text) {
  return { "@xml:lang": "en", "#text": text };
}

function actionCode(item) {
  return String(item?.code ?? item?.action_item_code ?? item?.rule_id ?? "");
}

function actionPath(item) {
  return String(item?.path ?? item?.json_path ?? "");
}

function closureFor(item) {
  return { code: actionCode(item), path: actionPath(item) };
}

function evidenceObject(kind, task, actionItem, extra = {}) {
  const itemPath = actionPath(actionItem);
  return {
    source: "dataset-bafu-auto-authoring",
    field_path: itemPath || null,
    quote_or_trace:
      actionItem?.evidence?.text ??
      actionItem?.evidence?.current_name?.baseName ??
      actionItem?.evidence?.reference_flow_properties?.join?.(", ") ??
      itemPath ??
      kind,
    kind,
    dataset_type: task?.entity?.dataset_type ?? null,
    dataset_id: task?.entity?.entity_id ?? null,
    dataset_version: task?.entity?.version ?? null,
    action_item: {
      code: actionCode(actionItem),
      path: actionPath(actionItem) || null,
      evidence: actionItem?.evidence ?? null,
    },
    ...extra,
  };
}

function resolution(mode, summary, extra = {}) {
  return {
    mode,
    used_context_kinds: fullContextKinds,
    summary,
    deferred_reason: null,
    ...extra,
  };
}

function splitBafuWasteDisposalName(baseName) {
  const text = textFromMultilang(baseName).trim();
  const match = /^(?<core>.+?),\s*(?<treatment>as building waste)$/iu.exec(text);
  if (!match?.groups?.core || !match?.groups?.treatment) return null;
  return {
    source: text,
    base_name: match.groups.core.trim(),
    treatment: match.groups.treatment.trim(),
  };
}

function stripTrailingLocationTokenText(value) {
  return String(value ?? "")
    .replace(/\s*\{[A-Z0-9][A-Z0-9+&-]{1,30}\}\s*$/u, "")
    .trim();
}

function stripGeneratedPrefixText(value) {
  return String(value ?? "")
    .replace(/^\s*x{2,}\s+/iu, "")
    .trim();
}

function splitBafuNamePlan(baseName) {
  const wasteSplit = splitBafuWasteDisposalName(baseName);
  if (wasteSplit) return wasteSplit;

  const text = stripGeneratedPrefixText(
    stripTrailingLocationTokenText(textFromMultilang(baseName).trim()),
  );
  const leadingGeneratedHeatMatch = /^xx\s+(?<core>heat,\s*.+?),\s*(?<route>at\s+.+)$/iu.exec(text);
  if (leadingGeneratedHeatMatch?.groups?.core && leadingGeneratedHeatMatch?.groups?.route) {
    return {
      source: text,
      base_name: leadingGeneratedHeatMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(leadingGeneratedHeatMatch.groups.route),
    };
  }
  const naturalGasBurnedMatch = /^(?<core>natural\s+gas),\s*(?<route>burned\s+in\s+.+)$/iu.exec(
    text,
  );
  if (naturalGasBurnedMatch?.groups?.core && naturalGasBurnedMatch?.groups?.route) {
    return {
      source: text,
      base_name: naturalGasBurnedMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(naturalGasBurnedMatch.groups.route),
    };
  }
  const heatAtCombustionUnitMatch =
    /^(?<core>heat,\s*.+?),\s*(?<route>at\s+(?:boiler|furnace|stove)\s+.+)$/iu.exec(text);
  if (heatAtCombustionUnitMatch?.groups?.core && heatAtCombustionUnitMatch?.groups?.route) {
    return {
      source: text,
      base_name: heatAtCombustionUnitMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(heatAtCombustionUnitMatch.groups.route),
    };
  }
  const fuelBurnedMatch = /^(?<core>.+?),\s*(?<route>burned\s+in\s+.+)$/iu.exec(text);
  if (fuelBurnedMatch?.groups?.core && fuelBurnedMatch?.groups?.route) {
    return {
      source: text,
      base_name: fuelBurnedMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(fuelBurnedMatch.groups.route),
    };
  }
  const pipeSeparatedNameMatch = /^(?<core>.+?)\s+\|\s+(?<route>.+)$/u.exec(text);
  if (pipeSeparatedNameMatch?.groups?.core && pipeSeparatedNameMatch?.groups?.route) {
    return {
      source: text,
      base_name: stripTrailingLocationTokenText(pipeSeparatedNameMatch.groups.core.trim()),
      treatment: pipeSeparatedNameMatch.groups.route.trim().replace(/\s+\|\s+/gu, ", "),
    };
  }
  const electricityBareMixMatch = /^(?<core>electricity)\s+(?<route>imports|mix)$/iu.exec(text);
  if (electricityBareMixMatch?.groups?.core && electricityBareMixMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Electricity",
      treatment: electricityBareMixMatch.groups.route.trim(),
    };
  }
  const electricityMixQualifierMatch = /^(?<core>electricity)\s+mix,\s*(?<route>.+)$/iu.exec(text);
  if (electricityMixQualifierMatch?.groups?.core && electricityMixQualifierMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Electricity",
      treatment: `mix, ${electricityMixQualifierMatch.groups.route.trim()}`,
    };
  }
  const supplyMixMatch = /^(?<core>.+?)\s+supply\s+mix$/iu.exec(text);
  if (supplyMixMatch?.groups?.core) {
    return {
      source: text,
      base_name: supplyMixMatch.groups.core.trim(),
      treatment: "supply",
      mix_location: "supply mix",
    };
  }
  const electricityCommaQualifierMatch = /^(?<core>electricity),\s*(?<route>[^,]+)$/iu.exec(text);
  if (
    electricityCommaQualifierMatch?.groups?.core &&
    electricityCommaQualifierMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: "Electricity",
      treatment: electricityCommaQualifierMatch.groups.route.trim(),
    };
  }
  const fuelSupplyMatch = /^(?<core>fuel\s+supply)\s+(?<route>for\s+.+)$/iu.exec(text);
  if (fuelSupplyMatch?.groups?.core && fuelSupplyMatch?.groups?.route) {
    return {
      source: text,
      base_name: fuelSupplyMatch.groups.core.trim(),
      treatment: fuelSupplyMatch.groups.route.trim(),
    };
  }
  const bulkGoodsIncinerationMatch =
    /^(?<core>bulk\s+goods),\s*(?<route>construction,\s*combustible,\s*in\s+MSWI)$/iu.exec(text);
  if (bulkGoodsIncinerationMatch?.groups?.core && bulkGoodsIncinerationMatch?.groups?.route) {
    return {
      source: text,
      base_name: bulkGoodsIncinerationMatch.groups.core.trim(),
      treatment: bulkGoodsIncinerationMatch.groups.route.trim(),
    };
  }
  const disposalBuildingMarketMixMatch =
    /^(?<core>disposal,\s*building,\s*.+?),\s*market\s+mix,\s*(?<quant>m2\s+visible)$/iu.exec(text);
  if (
    disposalBuildingMarketMixMatch?.groups?.core &&
    disposalBuildingMarketMixMatch?.groups?.quant
  ) {
    return {
      source: text,
      base_name: disposalBuildingMarketMixMatch.groups.core.trim(),
      treatment: disposalBuildingMarketMixMatch.groups.quant.trim(),
      clean_existing_treatment: true,
    };
  }
  const naturalGasConsumerMatch =
    /^(?<core>natural\s+gas),\s*(?<route>(?:high|low)\s+pressure,\s*at\s+consumer)$/iu.exec(text);
  if (naturalGasConsumerMatch?.groups?.core && naturalGasConsumerMatch?.groups?.route) {
    return {
      source: text,
      base_name: naturalGasConsumerMatch.groups.core.trim(),
      treatment: naturalGasConsumerMatch.groups.route.trim(),
    };
  }
  const fuelServiceStationMatch =
    /^(?<core>methane|ethanol|petrol),\s*(?<route>.+\bat\s+service\s+station)$/iu.exec(text);
  if (fuelServiceStationMatch?.groups?.core && fuelServiceStationMatch?.groups?.route) {
    return {
      source: text,
      base_name: fuelServiceStationMatch.groups.core.trim(),
      treatment: fuelServiceStationMatch.groups.route.trim(),
    };
  }
  const heatInCombustionUnitMatch =
    /^(?<core>heat),\s*(?<route>.+?,\s*in\s+.+\b(?:furnace|boiler|stove).*)$/iu.exec(text);
  if (heatInCombustionUnitMatch?.groups?.core && heatInCombustionUnitMatch?.groups?.route) {
    return {
      source: text,
      base_name: heatInCombustionUnitMatch.groups.core.trim(),
      treatment: heatInCombustionUnitMatch.groups.route.trim(),
    };
  }
  const tapWaterUserMatch =
    /^(?<core>tap\s+water),\s*(?<route>water\s+balance\s+according\s+to\s+MoeK\s+2013,\s*at\s+user)$/iu.exec(
      text,
    );
  if (tapWaterUserMatch?.groups?.core && tapWaterUserMatch?.groups?.route) {
    return {
      source: text,
      base_name: tapWaterUserMatch.groups.core.trim(),
      treatment: tapWaterUserMatch.groups.route.trim(),
    };
  }
  const trackBedMatch = /^(?<core>track\s+bed)$/iu.exec(text);
  if (trackBedMatch?.groups?.core) {
    return {
      source: text,
      base_name: "Track bed",
      treatment: "rail infrastructure",
    };
  }
  const disposalOfObjectMatch = /^disposal\s+of\s+(?<object>.+)$/iu.exec(text);
  if (disposalOfObjectMatch?.groups?.object) {
    return {
      source: text,
      base_name: disposalOfObjectMatch.groups.object.trim(),
      treatment: "disposal",
    };
  }
  const toSortingMatch = /^(?<core>.+?)\s+(?<route>to\s+(?:.+\s+)?sorting)$/iu.exec(text);
  if (toSortingMatch?.groups?.core && toSortingMatch?.groups?.route) {
    return {
      source: text,
      base_name: toSortingMatch.groups.core.trim(),
      treatment: toSortingMatch.groups.route.trim(),
    };
  }
  const toTreatmentMatch = /^(?<core>.+?)\s+(?<route>to\s+.+?\s+treatment)$/iu.exec(text);
  if (toTreatmentMatch?.groups?.core && toTreatmentMatch?.groups?.route) {
    return {
      source: text,
      base_name: toTreatmentMatch.groups.core.trim(),
      treatment: toTreatmentMatch.groups.route.trim(),
    };
  }
  const recyclingMaterialMatch = /^recycling\s+(?<core>.+)$/iu.exec(text);
  if (recyclingMaterialMatch?.groups?.core) {
    return {
      source: text,
      base_name: recyclingMaterialMatch.groups.core.trim(),
      treatment: "recycling",
    };
  }
  const liquefiedProductionShipMatch =
    /^(?<core>.+?\bliquefied),?\s+(?<route>production\s+[^,{}]+),\s*(?<mix>at freight ship)(?:\s*\{[A-Za-z]{2,3}\})?$/iu.exec(
      text,
    );
  if (
    liquefiedProductionShipMatch?.groups?.core &&
    liquefiedProductionShipMatch?.groups?.route &&
    liquefiedProductionShipMatch?.groups?.mix
  ) {
    return {
      source: text,
      base_name: liquefiedProductionShipMatch.groups.core.trim(),
      treatment: liquefiedProductionShipMatch.groups.route.trim(),
      mix_location: liquefiedProductionShipMatch.groups.mix.trim(),
    };
  }
  const disposalBuildingWasteMatch =
    /^(?<core>disposal,\s*.+?)\s+(?<route>as building waste(?:,\s*to .+)?)$/iu.exec(text);
  if (disposalBuildingWasteMatch?.groups?.core && disposalBuildingWasteMatch?.groups?.route) {
    return {
      source: text,
      base_name: disposalBuildingWasteMatch.groups.core.trim(),
      treatment: disposalBuildingWasteMatch.groups.route.trim(),
    };
  }
  const disposalToMatch = /^(?<core>disposal,\s*.+?),\s*(?<route>to .+)$/iu.exec(text);
  if (disposalToMatch?.groups?.core && disposalToMatch?.groups?.route) {
    return {
      source: text,
      base_name: disposalToMatch.groups.core.trim(),
      treatment: disposalToMatch.groups.route.trim(),
    };
  }
  const disposalObjectMatch = /^(?<core>disposal,\s*.+)$/iu.exec(text);
  if (disposalObjectMatch?.groups?.core) {
    return {
      source: text,
      base_name: disposalObjectMatch.groups.core.trim(),
      treatment: "disposal route",
    };
  }
  const shreddingMatch = /^shredding,\s*(?<object>.+)$/iu.exec(text);
  if (shreddingMatch?.groups?.object) {
    return {
      source: text,
      base_name: shreddingMatch.groups.object.trim(),
      treatment: "shredding",
    };
  }
  const mountingMatch = /^mounting,\s*(?<route>.+)$/iu.exec(text);
  if (mountingMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Mounting",
      treatment: mountingMatch.groups.route.trim(),
    };
  }
  const weldingMatch = /^welding,\s*(?<route>.+)$/iu.exec(text);
  if (weldingMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Welding",
      treatment: weldingMatch.groups.route.trim(),
    };
  }
  const sheetRollingMatch = /^sheet\s+rolling,\s*(?<route>.+)$/iu.exec(text);
  if (sheetRollingMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Sheet rolling",
      treatment: sheetRollingMatch.groups.route.trim(),
    };
  }
  const materialProcessingMatch =
    /^(?<core>powder\s+coating|anodi[sz]ing|wire\s+drawing|hot\s+rolling|section\s+bar\s+rolling|section\s+bar\s+extrusion|zinc\s+coating|tin\s+plating|coating|tempering|casting|sputtering|thermoforming|manufacturing|foaming|excavation|we+ving|production\s+efforts),\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (materialProcessingMatch?.groups?.core && materialProcessingMatch?.groups?.route) {
    return {
      source: text,
      base_name: materialProcessingMatch.groups.core.trim(),
      treatment: materialProcessingMatch.groups.route.trim(),
    };
  }
  const constructionRouteMatch =
    /^(?<core>pushed\s+pile|sheet\s+pile\s+wall|displacement\s+pile|bored\s+concrete\s+pile|stone\s+columns),\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (constructionRouteMatch?.groups?.core && constructionRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: constructionRouteMatch.groups.core.trim(),
      treatment: constructionRouteMatch.groups.route.trim(),
    };
  }
  const ekgBuildingRouteMatch = /^(?<core>EKG\s+[IVX]+),\s*(?<route>.+)$/u.exec(text);
  if (ekgBuildingRouteMatch?.groups?.core && ekgBuildingRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: ekgBuildingRouteMatch.groups.core.trim(),
      treatment: ekgBuildingRouteMatch.groups.route.trim(),
    };
  }
  const injectionMouldingMatch = /^(?<core>injection\s+mou?lding)(?:,\s*(?<route>.+))?$/iu.exec(
    text,
  );
  if (injectionMouldingMatch?.groups?.core) {
    return {
      source: text,
      base_name: injectionMouldingMatch.groups.core.trim(),
      treatment: injectionMouldingMatch.groups.route?.trim() || "manufacturing service",
    };
  }
  const extrusionMatch = /^(?<core>extrusion),\s*(?<route>.+)$/iu.exec(text);
  if (extrusionMatch?.groups?.core && extrusionMatch?.groups?.route) {
    return {
      source: text,
      base_name: extrusionMatch.groups.core.trim(),
      treatment: extrusionMatch.groups.route.trim(),
    };
  }
  const currentCollectorVariantMatch =
    /^(?<core>.+?\bcurrent\s+collector),\s*(?<route>[A-Z][A-Za-z0-9-]+)$/u.exec(text);
  if (currentCollectorVariantMatch?.groups?.core && currentCollectorVariantMatch?.groups?.route) {
    return {
      source: text,
      base_name: currentCollectorVariantMatch.groups.core.trim(),
      treatment: currentCollectorVariantMatch.groups.route.trim(),
    };
  }
  const batteryMaterialVariantMatch =
    /^(?<core>.+?\b(?:paste|material|electrode|battery|cell)|cathode|anode|electrolyte|separator),\s*(?<route>[A-Z][A-Za-z0-9-]+)$/iu.exec(
      text,
    );
  if (batteryMaterialVariantMatch?.groups?.core && batteryMaterialVariantMatch?.groups?.route) {
    return {
      source: text,
      base_name: batteryMaterialVariantMatch.groups.core.trim(),
      treatment: batteryMaterialVariantMatch.groups.route.trim(),
    };
  }
  const transportModeOnlyMatch =
    /^(?<core>transport,\s*freight),\s*(?<route>lorry|truck|rail|train|ship|barge|aircraft)$/iu.exec(
      text,
    );
  if (transportModeOnlyMatch?.groups?.core && transportModeOnlyMatch?.groups?.route) {
    return {
      source: text,
      base_name: transportModeOnlyMatch.groups.core.trim(),
      treatment: transportModeOnlyMatch.groups.route.trim(),
    };
  }
  const transportServiceModeMatch =
    /^(?<core>transport),\s*(?<route>barge\s+tanker|barge|tanker|ship)$/iu.exec(text);
  if (transportServiceModeMatch?.groups?.core && transportServiceModeMatch?.groups?.route) {
    return {
      source: text,
      base_name: transportServiceModeMatch.groups.core.trim(),
      treatment: transportServiceModeMatch.groups.route.trim(),
    };
  }
  const transportRouteMatch =
    /^(?<core>transport,\s*freight,\s*(?:lorry|truck|rail|train|ship|barge|aircraft))\s*,\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (transportRouteMatch?.groups?.core && transportRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: transportRouteMatch.groups.core.trim(),
      treatment: transportRouteMatch.groups.route.trim(),
    };
  }
  const transportGeneralRouteMatch = /^(?<core>transport),\s*(?<route>.+)$/iu.exec(text);
  if (transportGeneralRouteMatch?.groups?.core && transportGeneralRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: transportGeneralRouteMatch.groups.core.trim(),
      treatment: transportGeneralRouteMatch.groups.route.trim(),
    };
  }
  const electricityVoltageRouteMatch =
    /^(?<core>electricity,\s*(?:low|medium|high)\s+voltage)\s*,\s*(?<route>.+)$/iu.exec(text);
  if (electricityVoltageRouteMatch?.groups?.core && electricityVoltageRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: electricityVoltageRouteMatch.groups.core.trim(),
      treatment: electricityVoltageRouteMatch.groups.route.trim(),
    };
  }
  const electricityProductionMixTechnologyMatch =
    /^(?<core>electricity),\s*production\s+mix\s+(?<technology>.+?),\s*(?<route>at .+)$/iu.exec(
      text,
    );
  if (
    electricityProductionMixTechnologyMatch?.groups?.core &&
    electricityProductionMixTechnologyMatch?.groups?.technology &&
    electricityProductionMixTechnologyMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: electricityProductionMixTechnologyMatch.groups.core.trim(),
      treatment: `${electricityProductionMixTechnologyMatch.groups.technology.trim()}, ${electricityProductionMixTechnologyMatch.groups.route.trim()}`,
    };
  }
  const recoveredRouteMatch = /^(?<core>.+?),\s*(?<route>recovered\s+from\s+.+)$/iu.exec(text);
  if (recoveredRouteMatch?.groups?.core && recoveredRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: recoveredRouteMatch.groups.core.trim(),
      treatment: recoveredRouteMatch.groups.route.trim(),
    };
  }
  const windowFrameMarketMixMatch =
    /^(?<core>window\s+frame),\s*(?<route>.+?),\s*(?<mix>market\s+mix),\s*(?<quant>m2\s+visible|wall\s+opening)(?:,\s*(?<terminal>at\s+plant))?$/iu.exec(
      text,
    );
  if (
    windowFrameMarketMixMatch?.groups?.core &&
    windowFrameMarketMixMatch?.groups?.route &&
    windowFrameMarketMixMatch?.groups?.mix &&
    windowFrameMarketMixMatch?.groups?.quant
  ) {
    return {
      source: text,
      base_name: windowFrameMarketMixMatch.groups.core.trim(),
      treatment: [
        windowFrameMarketMixMatch.groups.route.trim(),
        windowFrameMarketMixMatch.groups.quant.trim(),
        windowFrameMarketMixMatch.groups.terminal?.trim(),
      ]
        .filter(Boolean)
        .join(", "),
      mix_location: windowFrameMarketMixMatch.groups.mix.trim(),
    };
  }
  const terminalAtPlantMatch = /^(?<core>.+?),\s*(?<route>at plant)$/iu.exec(text);
  if (terminalAtPlantMatch?.groups?.core && terminalAtPlantMatch?.groups?.route) {
    return {
      source: text,
      base_name: terminalAtPlantMatch.groups.core.trim(),
      treatment: terminalAtPlantMatch.groups.route.trim(),
    };
  }
  const terminalAtStorageMatch = /^(?<core>.+?),\s*(?<route>at\s+(?:regional\s+)?storage)$/iu.exec(
    text,
  );
  if (terminalAtStorageMatch?.groups?.core && terminalAtStorageMatch?.groups?.route) {
    return {
      source: text,
      base_name: terminalAtStorageMatch.groups.core.trim(),
      treatment: terminalAtStorageMatch.groups.route.trim(),
    };
  }
  const sawnTimberRouteMatch =
    /^(?<core>sawn\s+timber),\s*(?<route>.+\b(?:pine|SFM|u=\d+%|kiln\s+dried|sawmill|maritime\s+harbour)\b.*)$/iu.exec(
      text,
    );
  if (sawnTimberRouteMatch?.groups?.core && sawnTimberRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: sawnTimberRouteMatch.groups.core.trim(),
      treatment: sawnTimberRouteMatch.groups.route.trim(),
    };
  }
  const woodChipsRouteMatch =
    /^(?<core>wood\s+chips),\s*(?<route>.+\b(?:softwood|hardwood|mixed|u=\d+%|forest)\b.*)$/iu.exec(
      text,
    );
  if (woodChipsRouteMatch?.groups?.core && woodChipsRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: woodChipsRouteMatch.groups.core.trim(),
      treatment: woodChipsRouteMatch.groups.route.trim(),
    };
  }
  const woodResourceRouteMatch =
    /^(?<core>round\s*wood|roundwood|bark\s+chips|slab\s+and\s+siding),\s*(?<route>.+\b(?:forest\s+road|sawmill|under\s+bark|u=\d+%).*)$/iu.exec(
      text,
    );
  if (woodResourceRouteMatch?.groups?.core && woodResourceRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: woodResourceRouteMatch.groups.core.trim(),
      treatment: woodResourceRouteMatch.groups.route.trim(),
    };
  }
  const insulationSpecificationMatch =
    /^(?<core>.+?\binsulation(?:\s+with\s+.+?)?),\s*(?<route>insulation\s+thickness\s+\d+(?:\.\d+)?\s*mm)$/iu.exec(
      text,
    );
  if (insulationSpecificationMatch?.groups?.core && insulationSpecificationMatch?.groups?.route) {
    return {
      source: text,
      base_name: insulationSpecificationMatch.groups.core.trim(),
      treatment: insulationSpecificationMatch.groups.route.trim(),
    };
  }
  const constructionProductQualifierMatch =
    /^(?<core>pipe|steel\s+pipe|heat\s+pump|branch\s+connections\s+and\s+fittings|mineral\s+wool\s+insulation|borehole\s+heat\s+exchanger|prefabricated\s+driven\s+pile|concrete\s+pile)(?:\s+(?<dimension>\d+(?:\.\d+)?\s*mm))?,\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (
    constructionProductQualifierMatch?.groups?.core &&
    constructionProductQualifierMatch?.groups?.route
  ) {
    const dimension = constructionProductQualifierMatch.groups.dimension?.trim();
    const route = constructionProductQualifierMatch.groups.route.trim();
    return {
      source: text,
      base_name: constructionProductQualifierMatch.groups.core.trim(),
      treatment: dimension ? `${dimension}, ${route}` : route,
    };
  }
  const materialAtSourceMatch =
    /^(?<core>.+?,\s*(?:round)),\s*(?<route>at\s+(?:mine|quarry|pit|plant))$/iu.exec(text);
  if (materialAtSourceMatch?.groups?.core && materialAtSourceMatch?.groups?.route) {
    return {
      source: text,
      base_name: materialAtSourceMatch.groups.core.trim(),
      treatment: materialAtSourceMatch.groups.route.trim(),
    };
  }
  const productQualifierMatch =
    /^(?<core>paper|door|cement\s+floor\s+screed|anhydrite\s+floor\s+screed|building|photovoltaic\s+panel|render\s+carrier\s+board|petrol|steel\s+sheet|transmission\s+network|water\s+supply\s+network|glass\s+fibre-reinforced\s+polymer\s+panel|flooring|sulphite\s+pulp|ferrochromium|industrial\s+wood|plastic\s+tunnel|ventilation\s+of\s+dwellings|energy\s+reduction|SMR\s+NG|fuel\s+in\s+building\s+machine),\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (productQualifierMatch?.groups?.core && productQualifierMatch?.groups?.route) {
    return {
      source: text,
      base_name: productQualifierMatch.groups.core.trim(),
      treatment: productQualifierMatch.groups.route.trim(),
    };
  }
  const crushedAtSourceMatch =
    /^(?<core>.+?,\s*(?:crushed|washed|sorted|screened|broken|milled|ground|dried)),\s*(?<route>at\s+(?:mine|quarry|pit|plant))$/iu.exec(
      text,
    );
  if (crushedAtSourceMatch?.groups?.core && crushedAtSourceMatch?.groups?.route) {
    return {
      source: text,
      base_name: crushedAtSourceMatch.groups.core.trim(),
      treatment: crushedAtSourceMatch.groups.route.trim(),
    };
  }
  const bareProductMatch =
    /^(?<core>(?:[a-z][a-z0-9+-]*\s+)*(?:component|components|radiator|tube|tubes|panel|panels|profile|profiles|module|modules|machine|machines|equipment|system|systems))$/iu.exec(
      text,
    );
  if (bareProductMatch?.groups?.core) {
    return {
      source: text,
      base_name: bareProductMatch.groups.core.trim(),
      treatment: "production",
    };
  }
  const bareBatteryComponentMatch =
    /^(?<core>(?:positive\s+|negative\s+)?(?:cathode|anode|current\s+collector)(?:\s+[A-Za-z0-9+-]+)?)$/iu.exec(
      text,
    );
  if (bareBatteryComponentMatch?.groups?.core) {
    return {
      source: text,
      base_name: bareBatteryComponentMatch.groups.core.trim(),
      treatment: "production",
    };
  }
  const electrodeMaterialMatch = /^(?<core>.+?\belectrode\s+material(?:\s*\(.+\))?)$/iu.exec(text);
  if (electrodeMaterialMatch?.groups?.core) {
    return {
      source: text,
      base_name: electrodeMaterialMatch.groups.core.trim(),
      treatment: "production",
    };
  }
  const match = /^(?<core>[^,]+),\s*(?<treatment>.+)$/u.exec(text);
  if (!match?.groups?.core || !match?.groups?.treatment) return null;
  const core = match.groups.core.trim();
  const treatment = match.groups.treatment.trim();
  if (!core || !treatment) return null;

  const treatmentText = normalizeIdentityText(treatment);
  const routeLike =
    /^(?:as|at|from|in|production|consumption|market|supply)\b/u.test(treatmentText) ||
    /\b(?:allocation|average|cogen|cogeneration|diesel|fleet|freight|gas|grid|gross|hydropower|incineration|industrial|lorry|module|municipal|mix|nuclear|oil|plant|power|pv|reactor|recovered|river|ship|treatment|transport|voltage|waste|wind|wood)\b/u.test(
      treatmentText,
    ) ||
    /\b(?:primary|refinery|packaging)\b/u.test(treatmentText) ||
    /\b(?:assembly|electronic|fluorescent|lamp|lamps|metal|mounting|shredding|solder|surface|technology|through|welding|working|hole)\b/u.test(
      treatmentText,
    ) ||
    /\b(?:fossil|biogenic|land use change)\b/u.test(treatmentText);
  if (!routeLike) return null;

  return {
    source: text,
    base_name: core,
    treatment,
  };
}

function flowReferencePropertyActionValue(actionItem) {
  const suggested = actionItem?.evidence?.suggested_value;
  if (suggested && typeof suggested === "object" && !Array.isArray(suggested)) {
    const text = textFromMultilang(suggested).trim();
    if (text) return englishText(text);
  }
  const reference = actionItem?.evidence?.reference_flow_properties?.find?.((item) =>
    String(item ?? "").trim(),
  );
  return reference ? englishText(String(reference).trim()) : null;
}

function normalizeIdentityText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\\+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const identityStopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "source",
  "the",
  "to",
  "with",
]);

function identityTokens(value) {
  const tokens = normalizeIdentityText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !identityStopWords.has(token));
  return new Set(tokens);
}

function identityTextFromParts(parts) {
  return (parts ?? [])
    .map((part) => String(part ?? ""))
    .filter(Boolean)
    .join(" ");
}

function tokenOverlapRatio(left, right) {
  const leftTokens = identityTokens(left);
  const rightTokens = identityTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function categoriesOverlap(left, right) {
  const leftTokens = identityTokens(identityTextFromParts(left));
  const rightTokens = identityTokens(identityTextFromParts(right));
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

function namesAreExactIdentityMatch(targetNames, candidateNames) {
  const target = normalizeIdentityText(identityTextFromParts(targetNames));
  const candidate = normalizeIdentityText(identityTextFromParts(candidateNames));
  return target && target === candidate;
}

function strongNameMeaningDiffers(targetNames, candidateNames) {
  const targetText = identityTextFromParts(targetNames);
  const candidateText = identityTextFromParts(candidateNames);
  const target = normalizeIdentityText(targetText);
  const candidate = normalizeIdentityText(candidateText);
  if (!target || !candidate || target === candidate) return false;
  return tokenOverlapRatio(targetText, candidateText) < 0.45;
}

function routeOrTechnologyDiffers(targetNames, candidateNames) {
  const target = normalizeIdentityText(identityTextFromParts(targetNames));
  const candidate = normalizeIdentityText(identityTextFromParts(candidateNames));
  const routeTokens = [
    "allocation",
    "cogen",
    "cogeneration",
    "consumption",
    "disposal",
    "exergy",
    "grid",
    "low",
    "market",
    "medium",
    "mix",
    "plant",
    "production",
    "route",
    "ship",
    "supply",
    "voltage",
    "waste",
  ];
  const targetRoutes = routeTokens.filter((token) => target.includes(token));
  const candidateRoutes = routeTokens.filter((token) => candidate.includes(token));
  if (targetRoutes.length === 0 && candidateRoutes.length === 0) return false;
  return !sameList(targetRoutes, candidateRoutes);
}

function candidateHasClearNonEquivalence(reviewedCandidate) {
  return (reviewedCandidate?.non_equivalence_reasons ?? []).length > 0;
}

function reusableEquivalentCandidate(target, reviewedCandidates) {
  const targetNames = target?.names ?? [];
  const targetGeography = lowerText(target?.fields?.geography);
  return (reviewedCandidates ?? []).find((candidate) => {
    if (!candidate?.id || !candidate?.version) return false;
    if (candidateHasClearNonEquivalence(candidate)) return false;
    if (
      tokenOverlapRatio(
        identityTextFromParts(targetNames),
        identityTextFromParts(candidate.names),
      ) < 0.8
    ) {
      return false;
    }
    const candidateGeography = lowerText(candidate?.fields?.geography);
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography)
      return false;
    return true;
  });
}

function normalizedCategoryText(fields) {
  return normalizeIdentityText(arrayValues(fields?.categories).join(" "));
}

function reusableBafuElementaryFlowCandidate(target, candidates) {
  const targetType = lowerText(target?.fields?.type_of_dataset);
  if (targetType !== "elementary flow") return null;
  const targetNamesText = normalizeIdentityText(identityTextFromParts(target?.names ?? []));
  const targetProperty = normalizeIdentityText(target?.fields?.flow_property);
  const targetCategories = normalizedCategoryText(target?.fields ?? {});
  const isIndustrialOccupation =
    targetProperty === "area time" &&
    targetNamesText.includes("occupation industrial area") &&
    targetCategories.includes("land");
  const isIndustrialTransformationTo =
    targetProperty === "area" &&
    targetNamesText.includes("transformation to industrial area") &&
    targetCategories.includes("land");
  if (!isIndustrialOccupation && !isIndustrialTransformationTo) return null;

  for (const candidate of candidates ?? []) {
    const fields = candidate?.fields ?? {};
    if (lowerText(fields.type_of_dataset) !== "elementary flow") continue;
    const candidateProperty = normalizeIdentityText(fields.flow_property);
    const candidateNamesText = normalizeIdentityText(identityTextFromParts(candidate?.names ?? []));
    const candidateCategories = normalizedCategoryText(fields);
    if (isIndustrialOccupation) {
      if (candidateProperty !== "area time") continue;
      if (!candidateNamesText.includes("industrial area")) continue;
      if (!candidateCategories.includes("land occupation")) continue;
      return {
        ...candidate,
        equivalence_basis:
          "BAFU land occupation flow uses the industrial-area land-use meaning with Area*time; the canonical candidate is the matching public TianGong land occupation elementary flow.",
      };
    }
    if (isIndustrialTransformationTo) {
      if (candidateProperty !== "area") continue;
      if (!candidateNamesText.includes("to industrial area")) continue;
      if (candidateNamesText.includes("from industrial area")) continue;
      if (!candidateCategories.includes("land transformation")) continue;
      return {
        ...candidate,
        equivalence_basis:
          "BAFU land transformation flow is a transformation to industrial area with Area; the canonical candidate is the matching public TianGong land transformation elementary flow.",
      };
    }
  }
  return null;
}

function nonEquivalentFlowCandidateReasons(target, candidates) {
  const targetNames = target?.names ?? [];
  const targetFields = target?.fields ?? {};
  const targetProperty = lowerText(targetFields.flow_property);
  const targetUnit = lowerText(targetFields.reference_unit);
  const targetGeography = lowerText(targetFields.geography);
  const targetCategories = targetFields.categories ?? [];
  const reviewed = [];
  let exactEquivalentCandidate = null;

  for (const candidate of candidates ?? []) {
    const candidateNames = candidate?.names ?? [];
    const candidateFields = candidate?.fields ?? {};
    const candidateProperty = lowerText(candidateFields.flow_property);
    const candidateUnit = lowerText(candidateFields.reference_unit);
    const candidateGeography = lowerText(candidateFields.geography);
    const candidateCategories = candidateFields.categories ?? [];
    const reasons = [];
    if (targetProperty && candidateProperty && targetProperty !== candidateProperty) {
      reasons.push("flow property differs");
    }
    if (targetUnit && candidateUnit && targetUnit !== candidateUnit) {
      reasons.push("reference unit differs");
    }
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography) {
      reasons.push("geography/market context differs");
    }
    if (
      targetCategories.length > 0 &&
      candidateCategories.length > 0 &&
      !categoriesOverlap(targetCategories, candidateCategories)
    ) {
      reasons.push("source category/route differs");
    }
    if (strongNameMeaningDiffers(targetNames, candidateNames)) {
      reasons.push("flow name/physical service meaning differs");
    }
    if (routeOrTechnologyDiffers(targetNames, candidateNames)) {
      reasons.push("technology/route qualifier differs");
    }
    if (namesAreExactIdentityMatch(targetNames, candidateNames)) {
      exactEquivalentCandidate = candidate;
    }
    reviewed.push({
      id: candidate?.id ?? null,
      version: candidate?.version ?? null,
      names: candidate?.names ?? [],
      fields: candidateFields,
      non_equivalence_reasons: reasons,
    });
  }

  return { exactEquivalentCandidate, reviewed };
}

function sameList(left, right) {
  const leftSet = new Set((left ?? []).map(lowerText).filter(Boolean));
  const rightSet = new Set((right ?? []).map(lowerText).filter(Boolean));
  if (leftSet.size !== rightSet.size) return false;
  for (const item of leftSet) {
    if (!rightSet.has(item)) return false;
  }
  return leftSet.size > 0;
}

function nonEquivalentProcessCandidateReasons(target, candidates) {
  const targetNames = target?.names ?? [];
  const targetFields = target?.fields ?? {};
  const targetGeography = lowerText(targetFields.geography);
  const targetReferenceFlowIds = targetFields.reference_flow_ids ?? [];
  const targetReferenceFlowNames = targetFields.reference_flow_names ?? [];
  const targetCategories = targetFields.categories ?? [];
  const targetExchangeSignature = target?.exchange_signature ?? [];
  const reviewed = [];
  let exactEquivalentCandidate = null;

  for (const candidate of candidates ?? []) {
    const candidateNames = candidate?.names ?? [];
    const candidateFields = candidate?.fields ?? {};
    const candidateGeography = lowerText(candidateFields.geography);
    const candidateReferenceFlowIds = candidateFields.reference_flow_ids ?? [];
    const candidateReferenceFlowNames = candidateFields.reference_flow_names ?? [];
    const candidateCategories = candidateFields.categories ?? [];
    const candidateExchangeSignature = candidate?.exchange_signature ?? [];
    const reasons = [];
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography) {
      reasons.push("geography differs");
    }
    if (
      targetReferenceFlowIds.length > 0 &&
      candidateReferenceFlowIds.length > 0 &&
      !sameList(targetReferenceFlowIds, candidateReferenceFlowIds)
    ) {
      reasons.push("reference flow differs");
    }
    if (
      targetReferenceFlowNames.length > 0 &&
      candidateReferenceFlowNames.length > 0 &&
      !sameList(targetReferenceFlowNames, candidateReferenceFlowNames)
    ) {
      reasons.push("reference flow meaning differs");
    }
    if (
      targetExchangeSignature.length > 0 &&
      candidateExchangeSignature.length > 0 &&
      !sameList(targetExchangeSignature, candidateExchangeSignature)
    ) {
      reasons.push("exchange signature differs");
    }
    if (
      targetCategories.length > 0 &&
      candidateCategories.length > 0 &&
      !categoriesOverlap(targetCategories, candidateCategories)
    ) {
      reasons.push("process classification/route differs");
    }
    if (strongNameMeaningDiffers(targetNames, candidateNames)) {
      reasons.push("process name/technology meaning differs");
    }
    if (routeOrTechnologyDiffers(targetNames, candidateNames)) {
      reasons.push("process technology/route qualifier differs");
    }
    if (namesAreExactIdentityMatch(targetNames, candidateNames)) {
      exactEquivalentCandidate = candidate;
    }
    reviewed.push({
      id: candidate?.id ?? null,
      version: candidate?.version ?? null,
      names: candidate?.names ?? [],
      fields: candidateFields,
      exchange_signature: candidateExchangeSignature,
      non_equivalence_reasons: reasons,
    });
  }

  return { exactEquivalentCandidate, reviewed };
}

function canCreateBafuProductFlow(actionItem) {
  const evidence = actionItem?.evidence ?? {};
  const target = evidence.target ?? {};
  const targetType = lowerText(target?.fields?.type_of_dataset);
  const elementaryReuse = reusableBafuElementaryFlowCandidate(
    target,
    evidence.top_candidates ?? [],
  );
  if (elementaryReuse) {
    return {
      ok: false,
      reuse: elementaryReuse,
      reason:
        "A public TianGong elementary land-use flow candidate is physically identity-equivalent and should be reused.",
      reviewed: [
        {
          id: elementaryReuse.id ?? null,
          version: elementaryReuse.version ?? null,
          names: elementaryReuse.names ?? [],
          fields: elementaryReuse.fields ?? {},
          non_equivalence_reasons: [],
          equivalence_basis: elementaryReuse.equivalence_basis ?? null,
        },
      ],
    };
  }
  if (!["product flow", "waste flow"].includes(targetType)) {
    return {
      ok: false,
      reason: "Only product/waste flow identity decisions may be autofilled as create_new.",
    };
  }
  const targetNames = target.names ?? [];
  if (!normalizeIdentityText(identityTextFromParts(targetNames))) {
    return {
      ok: false,
      reason: "Target flow lacks enough name evidence for an automatic identity decision.",
    };
  }
  const { exactEquivalentCandidate, reviewed } = nonEquivalentFlowCandidateReasons(
    target,
    evidence.top_candidates ?? [],
  );
  const reuseCandidate = exactEquivalentCandidate ?? reusableEquivalentCandidate(target, reviewed);
  if (reuseCandidate) {
    return {
      ok: false,
      reuse: reuseCandidate,
      reason: "A remote candidate is physically identity-equivalent and should be reused.",
      reviewed,
    };
  }
  const equivalentRisk = reviewed.some((candidate) => !candidateHasClearNonEquivalence(candidate));
  if (equivalentRisk) {
    return {
      ok: false,
      reason: "At least one candidate lacks clear non-equivalence reasons.",
      reviewed,
    };
  }
  return { ok: true, reviewed };
}

function canCreateBafuProcess(actionItem) {
  const evidence = actionItem?.evidence ?? {};
  const target = evidence.target ?? {};
  const targetNames = target.names ?? [];
  if (!normalizeIdentityText(identityTextFromParts(targetNames))) {
    return {
      ok: false,
      reason: "Target process lacks enough name evidence for an automatic identity decision.",
    };
  }
  const { exactEquivalentCandidate, reviewed } = nonEquivalentProcessCandidateReasons(
    target,
    evidence.top_candidates ?? [],
  );
  if (exactEquivalentCandidate) {
    return {
      ok: false,
      reason: "A process candidate has an exact name match and requires explicit reuse/new review.",
      reviewed,
    };
  }
  const equivalentRisk = reviewed.some((candidate) => !candidateHasClearNonEquivalence(candidate));
  if (equivalentRisk) {
    return {
      ok: false,
      reason: "At least one process candidate lacks clear non-equivalence reasons.",
      reviewed,
    };
  }
  return { ok: true, reviewed };
}

function identityDecisionRow(actionItem, task) {
  const evidence = actionItem?.evidence ?? {};
  const target = evidence.target ?? {};
  const datasetType = String(
    actionItem?.dataset_type ?? target.dataset_type ?? "flow",
  ).toLowerCase();
  const createNew =
    datasetType === "process"
      ? canCreateBafuProcess(actionItem)
      : canCreateBafuProductFlow(actionItem);
  const datasetId = String(actionItem?.dataset_id ?? target.id ?? "");
  const datasetVersion = String(actionItem?.dataset_version ?? target.version ?? "00.00.001");
  const base = {
    schema_version: 1,
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: datasetVersion,
    decision_status: "completed",
    authoring_package: actionItem?.authoring_package ?? null,
    authoring_package_sha256: actionItem?.authoring_package_sha256 ?? null,
    used_context_kinds: fullContextKinds,
    closes_action_items: ["identity_preflight_manual_review"],
  };
  if (!createNew.ok && createNew.reuse) {
    return {
      ...base,
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: datasetType === "process" ? "processes" : "flows",
        ref_object_id: createNew.reuse.id,
        version: createNew.reuse.version,
        short_description: identityTextFromParts(createNew.reuse.names) || createNew.reuse.id,
      },
      basis:
        "A remote candidate was reviewed as physically identity-equivalent to the BAFU target by name, route, geography, flow property, and reference unit evidence, so the existing row is reused.",
      evidence: {
        source: "dataset-bafu-identity-decisions-autofill",
        policy: `reuse_existing_reference_when_${datasetType}_identity_equivalence_is_proven`,
        target,
        remote_search: evidence.remote_search ?? null,
        selected_candidate: createNew.reuse,
        reviewed_top_candidates: createNew.reviewed ?? [],
        physical_equivalence_decision: "identity_equivalent_to_existing_candidate",
      },
    };
  }
  if (!createNew.ok) {
    return {
      ...base,
      identity_decision: "block_unresolved",
      canonical: null,
      basis: createNew.reason,
      evidence: {
        source: "dataset-bafu-identity-decisions-autofill",
        policy: `blocked_when_${datasetType}_identity_equivalence_is_not_proven_safe`,
        target,
        reviewed_top_candidates: createNew.reviewed ?? [],
      },
    };
  }
  return {
    ...base,
    identity_decision: "create_new",
    canonical: null,
    basis:
      datasetType === "process"
        ? "BAFU source process was reviewed against the remote candidates; each candidate differs by reference flow, exchange signature, geography, classification/route, or process meaning, so no identity-equivalent process was found."
        : "BAFU source flow was reviewed against the remote candidates; each candidate differs by physical property, reference unit, geography/market, classification/route, technology, or flow meaning, so no identity-equivalent product/waste flow was found.",
    evidence: {
      source: "dataset-bafu-identity-decisions-autofill",
      policy:
        datasetType === "process"
          ? "create_new_allowed_for_process_when_candidates_are_not_identity_equivalent"
          : "create_new_allowed_for_non_elementary_product_flow_when_candidates_are_not_identity_equivalent",
      target,
      remote_search: evidence.remote_search ?? null,
      reviewed_top_candidates: createNew.reviewed,
      physical_equivalence_decision: "not_identity_equivalent_to_existing_candidates",
    },
  };
}

function removeTrailingLocationToken(value) {
  const text = textFromMultilang(value).trim();
  const cleaned = text.replace(/\s*\{[A-Z]{2,3}\}\s*$/u, "").trim();
  return cleaned && cleaned !== text ? englishText(cleaned) : null;
}

function cleanProcessFunctionalUnitText(value) {
  const text = textFromMultilang(value).trim();
  const cleaned = stripTrailingLocationTokenText(text)
    .replace(/(^|\s)xx\s+/iu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned && cleaned !== text ? englishText(cleaned) : null;
}

let locationLabelCache = null;

function loadLocationLabels() {
  if (locationLabelCache) return locationLabelCache;
  const labels = new Map([
    ["CH", "Switzerland"],
    ["BR", "Brazil"],
    ["CN", "China"],
    ["CY", "Cyprus"],
    ["DE", "Germany"],
    ["EU", "Europe"],
    ["GLO", "global"],
    ["IN", "India"],
    ["JP", "Japan"],
    ["LU", "Luxembourg"],
    ["MX", "Mexico"],
    ["PE", "Peru"],
    ["RLA", "Latin America"],
    ["RER", "Europe"],
    ["UCTE", "UCTE"],
    ["US", "United States"],
    ["WEU", "Western Europe"],
  ]);
  const schemaCandidates = [
    path.resolve(process.cwd(), "../tidas/static/schemas/tidas_locations_category.json"),
    path.resolve(
      process.cwd(),
      "../tiangong-lca-cli/assets/tidas-schemas/tidas_locations_category.json",
    ),
    path.resolve(
      process.cwd(),
      "../tiangong-lca-cli/node_modules/@tiangong-lca/tidas-sdk/dist/runtime-assets/tidas/schemas/tidas_locations_category.json",
    ),
  ];
  for (const schemaPath of schemaCandidates) {
    if (!fs.existsSync(schemaPath)) continue;
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
      for (const item of arrayValues(schema.oneOf)) {
        if (!item?.const || !item?.description) continue;
        labels.set(String(item.const).toUpperCase(), String(item.description));
      }
      break;
    } catch {
      // Fallback labels above keep this deterministic when sibling schema repos are unavailable.
    }
  }
  labels.set("GLO", "global");
  locationLabelCache = labels;
  return labels;
}

function locationNameLabel(locationCode) {
  const code = String(locationCode ?? "").toUpperCase();
  return loadLocationLabels().get(code) ?? code;
}

function inferMixLocationPhrase({ isProcess, name, locationCode }) {
  const locationLabel = locationNameLabel(locationCode);
  const nameText = normalizeIdentityText(
    [
      textFromMultilang(name?.baseName),
      textFromMultilang(name?.treatmentStandardsRoutes),
      textFromMultilang(name?.mixAndLocationTypes),
    ].join(" "),
  );
  if (/\b(?:mounting|surface mount|through hole|solder|assembly)\b/u.test(nameText)) {
    return isProcess ? `assembly process, ${locationLabel}` : `assembly service, ${locationLabel}`;
  }
  if (/\b(?:track bed|rail infrastructure)\b/u.test(nameText)) {
    return isProcess
      ? `rail infrastructure process, ${locationLabel}`
      : `rail infrastructure, ${locationLabel}`;
  }
  if (/\b(?:excavation|hydraulic digger|pushed pile|pile)\b/u.test(nameText)) {
    return isProcess
      ? `construction process, ${locationLabel}`
      : `construction service, ${locationLabel}`;
  }
  if (
    /\b(?:welding|rolling|hot rolling|metal working|machining|manufacturing|extrusion|injection|moulding|molding|powder coating|anodi[sz]ing|wire drawing|section bar rolling|section bar extrusion|zinc coating|tin plating|coating|tempering|casting|sputtering|thermoforming|foaming|we+ving)\b/u.test(
      nameText,
    )
  ) {
    return isProcess
      ? `manufacturing process, ${locationLabel}`
      : `manufacturing service, ${locationLabel}`;
  }
  if (
    /\b(?:shredding|dismantling|sorting)\b/u.test(nameText) ||
    /\bto\b.*\btreatment\b/u.test(nameText)
  ) {
    return isProcess
      ? `treatment process, ${locationLabel}`
      : `treatment service, ${locationLabel}`;
  }
  if (/\b(?:deconstruction|demolition)\b/u.test(nameText)) {
    return isProcess
      ? `deconstruction process, ${locationLabel}`
      : `deconstruction service, ${locationLabel}`;
  }
  if (
    /\b(?:recovered|recycling|module treatment|refined waste cooking oil|waste cooking oil)\b/u.test(
      nameText,
    )
  ) {
    return isProcess
      ? `recovery process, ${locationLabel}`
      : `recovered material, ${locationLabel}`;
  }
  if (/\b(?:transport|freight|lorry|truck|rail|ship|barge)\b/u.test(nameText)) {
    return isProcess
      ? `transport process, ${locationLabel}`
      : `transport service, ${locationLabel}`;
  }
  if (/\b(?:disposal|waste|treatment|mswi|combustible)\b/u.test(nameText)) {
    return isProcess ? `disposal process, ${locationLabel}` : `disposal service, ${locationLabel}`;
  }
  if (
    /\b(?:production|producer|power|plant|primary|refinery|current collector|electrode material|electrolyte|separator|cathode|anode|paste|cogen|cogeneration|wind|hydropower|nuclear|reactor|boiler|burned|heat|mine|quarry|mill|sawmill|kiln dried|industrial wood|roundwood|round wood|bark chips|forest road|wood chips|at forest|component|components|radiator|tube|tubes|panel|panels|module|modules|machine|machines|equipment|system|systems)\b/u.test(
      nameText,
    )
  ) {
    return isProcess ? `production process, ${locationLabel}` : `production mix, ${locationLabel}`;
  }
  if (/\b(?:consumption|consumer|market|supply|grid)\b/u.test(nameText)) {
    return isProcess ? `supply process, ${locationLabel}` : `supply mix, ${locationLabel}`;
  }
  return isProcess ? `process, ${locationLabel}` : `supply mix, ${locationLabel}`;
}

function inferBareProductNamePlan({ name, packagePayload }) {
  const source = stripGeneratedPrefixText(
    stripTrailingLocationTokenText(textFromMultilang(name?.baseName).trim()),
  );
  if (!source || /,/u.test(source)) return null;
  const flow =
    packagePayload?.source_row?.flowDataSet ?? packagePayload?.entity_payload?.flowDataSet ?? {};
  const typeOfDataSet = lowerText(flow?.modellingAndValidation?.LCIMethod?.typeOfDataSet);
  if (typeOfDataSet !== "product flow") return null;

  const normalized = normalizeIdentityText(source);
  if (!/[a-z0-9]/u.test(normalized)) return null;
  const treatment = /\b(?:consumption|consumer|market|supply|imports?|grid)\b/u.test(normalized)
    ? "supply"
    : "production";
  const locationCode = datasetLocationCode({ isProcess: false, packagePayload });
  const locationLabel = locationCode ? locationNameLabel(locationCode) : null;
  const mixKind = treatment === "supply" ? "supply mix" : "production mix";
  return {
    source,
    base_name: source,
    treatment,
    mix_location: locationLabel ? `${mixKind}, ${locationLabel}` : mixKind,
  };
}

function inferBareProcessNamePlan({ name, packagePayload }) {
  const source = stripGeneratedPrefixText(
    stripTrailingLocationTokenText(textFromMultilang(name?.baseName).trim()),
  );
  if (!source || /,/u.test(source)) return null;
  const process =
    packagePayload?.source_row?.processDataSet ??
    packagePayload?.entity_payload?.processDataSet ??
    null;
  if (!process) return null;

  const normalized = normalizeIdentityText(source);
  if (!/[a-z0-9]/u.test(normalized)) return null;

  const exchanges = arrayValues(process?.exchanges?.exchange);
  const outputNames = exchanges
    .filter((exchange) => lowerText(exchange?.exchangeDirection) === "output")
    .map((exchange) =>
      textFromMultilang(exchange?.referenceToFlowDataSet?.["common:shortDescription"]),
    )
    .filter(Boolean);
  const hasMatchingOutput = outputNames.some((outputName) => {
    const outputText = normalizeIdentityText(outputName);
    return (
      outputText === normalized ||
      outputText.includes(normalized) ||
      normalized.includes(outputText)
    );
  });
  const classificationText = lowerText(
    JSON.stringify(
      process?.processInformation?.dataSetInformation?.classificationInformation ?? {},
    ),
  );
  const hasProductionContext =
    hasMatchingOutput ||
    /\b(?:manufactur|production|producer|basic chemicals|chemical products)\b/u.test(
      classificationText,
    );
  if (!hasProductionContext) return null;

  let treatment = "production";
  let mixKind = "production process";
  if (/\b(?:consumption|consumer|market|supply|imports?|grid)\b/u.test(normalized)) {
    treatment = "supply";
    mixKind = "supply process";
  } else if (/\b(?:disposal|waste|treatment|mswi|combustible)\b/u.test(normalized)) {
    treatment = "treatment";
    mixKind = "treatment process";
  }

  const locationCode = datasetLocationCode({ isProcess: true, packagePayload });
  const locationLabel = locationCode ? locationNameLabel(locationCode) : null;
  return {
    source,
    base_name: source,
    treatment,
    mix_location: locationLabel ? `${mixKind}, ${locationLabel}` : mixKind,
  };
}

function mergeExistingTreatmentRoute(nameSplit, name) {
  if (!nameSplit) return null;
  const existing = textFromMultilang(name?.treatmentStandardsRoutes).trim();
  if (!existing || normalizeIdentityText(existing) === "source described route") return nameSplit;
  const currentTreatment = String(nameSplit.treatment ?? "").trim();
  if (nameSplit.clean_existing_treatment) {
    const parts = [...existing.split(","), ...currentTreatment.split(",")]
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !["disposal route", "market"].includes(normalizeIdentityText(part)));
    const uniqueParts = [];
    const seen = new Set();
    for (const part of parts) {
      const key = normalizeIdentityText(part);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueParts.push(part);
    }
    return {
      ...nameSplit,
      treatment: uniqueParts.join(", "),
    };
  }
  if (!currentTreatment) return { ...nameSplit, treatment: existing };
  if (normalizeIdentityText(currentTreatment).includes(normalizeIdentityText(existing))) {
    return nameSplit;
  }
  return {
    ...nameSplit,
    treatment: `${currentTreatment}, ${existing}`,
  };
}

function datasetLocationCode({ isProcess, packagePayload }) {
  if (isProcess) {
    const process =
      packagePayload?.source_row?.processDataSet ??
      packagePayload?.entity_payload?.processDataSet ??
      {};
    const location = process?.processInformation?.geography?.locationOfOperationSupplyOrProduction;
    if (typeof location === "string") return location.toUpperCase();
    return String(location?.["@location"] ?? "").toUpperCase();
  }
  const flow =
    packagePayload?.source_row?.flowDataSet ?? packagePayload?.entity_payload?.flowDataSet ?? {};
  return String(flow?.flowInformation?.geography?.locationOfSupply ?? "").toUpperCase();
}

function completeNameSplitMixLocationPhrase(mixLocation, locationCode) {
  const phrase = String(mixLocation ?? "").trim();
  if (!phrase) return null;
  if (/^(?:market|production|supply)\s+mix$/iu.test(phrase) && locationCode) {
    return `${phrase}, ${locationNameLabel(locationCode)}`;
  }
  return phrase;
}

function buildNamePatchOperations(task) {
  const operations = [];
  const actionItems = task.action_items ?? [];
  const packagePayload = task.authoring_package_payload ?? {};
  const datasetType = String(task.entity?.dataset_type ?? "").toLowerCase();
  const isProcess = datasetType === "process";
  const namePathPrefix = isProcess
    ? "/processDataSet/processInformation/dataSetInformation/name"
    : "/flowDataSet/flowInformation/dataSetInformation/name";
  const formalLocationField = isProcess
    ? "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction"
    : "flowDataSet.flowInformation.geography.locationOfSupply";
  const name = isProcess
    ? (packagePayload.source_row?.processDataSet?.processInformation?.dataSetInformation?.name ??
      packagePayload.entity_payload?.processDataSet?.processInformation?.dataSetInformation?.name ??
      {})
    : (packagePayload.source_row?.flowDataSet?.flowInformation?.dataSetInformation?.name ??
      packagePayload.entity_payload?.flowDataSet?.flowInformation?.dataSetInformation?.name ??
      {});
  const functionalUnit = isProcess
    ? (packagePayload.source_row?.processDataSet?.processInformation?.quantitativeReference
        ?.functionalUnitOrOther ??
      packagePayload.entity_payload?.processDataSet?.processInformation?.quantitativeReference
        ?.functionalUnitOrOther)
    : null;
  const functionalUnitActionItems = actionItems.filter((item) => {
    const code = actionCode(item);
    return (
      isProcess &&
      actionPath(item).includes("functionalUnitOrOther") &&
      ["semantic_geography_token_in_name", "semantic_name_placeholder_token"].includes(code)
    );
  });
  const nameSplit = mergeExistingTreatmentRoute(
    splitBafuNamePlan(name.baseName) ??
      (isProcess
        ? inferBareProcessNamePlan({ name, packagePayload })
        : inferBareProductNamePlan({ name, packagePayload })),
    name,
  );
  const nameSplitMixLocation = completeNameSplitMixLocationPhrase(
    nameSplit?.mix_location,
    datasetLocationCode({ isProcess, packagePayload }),
  );
  const nameSplitActionItems = actionItems.filter((item) =>
    [
      "semantic_name_base_contains_unsplit_segments",
      "semantic_name_treatment_placeholder",
      "semantic_name_quantitative_property_not_split",
    ].includes(actionCode(item)),
  );
  const mixLocationActionItems = actionItems.filter(
    (item) => actionCode(item) === "semantic_name_mix_location_too_bare",
  );
  let emittedNameSplit = false;
  let emittedFunctionalUnitClean = false;
  let emittedMixLocation = false;

  for (const item of actionItems) {
    const code = actionCode(item);
    if (
      isProcess &&
      actionPath(item).includes("functionalUnitOrOther") &&
      ["semantic_geography_token_in_name", "semantic_name_placeholder_token"].includes(code)
    ) {
      if (emittedFunctionalUnitClean) continue;
      emittedFunctionalUnitClean = true;
      const value =
        cleanProcessFunctionalUnitText(functionalUnit) ??
        removeTrailingLocationToken(functionalUnit);
      if (!value) {
        operations.push({
          blocker: {
            code: "bafu_process_functional_unit_location_token_unsupported",
            dataset_id: task.entity.entity_id,
            action_item: closureFor(item),
            message:
              "BAFU auto patch only removes generated placeholder tokens and trailing formal location tokens such as '{CH}' from process functionalUnitOrOther.",
          },
        });
        continue;
      }
      const closes = (
        functionalUnitActionItems.length > 0 ? functionalUnitActionItems : [item]
      ).map(closureFor);
      operations.push({
        op: "replace",
        path: "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
        value,
        basis:
          "The formal geography code belongs in processInformation.geography, and generated placeholder tokens such as 'xx' must not remain in the quantitative reference text.",
        evidence: evidenceObject("functional_unit_location_token_removed", task, item, {
          source_value: functionalUnit,
          selected_value: value,
          formal_location_field: formalLocationField,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Removed generated placeholder and trailing location tokens from the process quantitative reference while preserving the formal geography field.",
        ),
        closes_action_items: closes,
      });
    }

    if (
      code === "semantic_name_base_contains_unsplit_segments" ||
      code === "semantic_name_treatment_placeholder" ||
      code === "semantic_name_quantitative_property_not_split"
    ) {
      if (emittedNameSplit) continue;
      emittedNameSplit = true;
      const closes = (nameSplitActionItems.length > 0 ? nameSplitActionItems : [item]).map(
        closureFor,
      );
      if (!nameSplit) {
        operations.push({
          blocker: {
            code: "bafu_name_split_unsupported",
            dataset_id: task.entity.entity_id,
            action_item: closureFor(item),
            message:
              "BAFU auto patch could not split the source name into a core baseName and source-backed treatment/route qualifier.",
          },
        });
        continue;
      }
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/baseName`,
        value: englishText(nameSplit.base_name),
        basis:
          "The source base name embeds route, technology, allocation, or treatment qualifiers; TIDAS name-plan stores the core flow/process name separately from treatment/route qualifiers.",
        evidence: evidenceObject("name_plan_split", task, item, {
          source_name: nameSplit.source,
          extracted_base_name: nameSplit.base_name,
          extracted_treatment: nameSplit.treatment,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Split BAFU source-language name into core baseName and treatment/route qualifiers.",
        ),
        closes_action_items: closes,
      });
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/treatmentStandardsRoutes`,
        value: englishText(nameSplit.treatment),
        basis:
          "The extracted source-language phrase is a treatment, route, technology, or allocation qualifier, not part of the core flow/process name.",
        evidence: evidenceObject("name_plan_treatment_route", task, item, {
          source_name: nameSplit.source,
          extracted_treatment: nameSplit.treatment,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Moved the source treatment/route qualifier from baseName into treatmentStandardsRoutes.",
        ),
        closes_action_items: closes,
      });
      if (nameSplitMixLocation && !emittedMixLocation) {
        emittedMixLocation = true;
        const hasExplicitMixAction = mixLocationActionItems.length > 0;
        const mixCloses = hasExplicitMixAction ? mixLocationActionItems.map(closureFor) : closes;
        operations.push({
          op: "replace",
          path: `${namePathPrefix}/mixAndLocationTypes`,
          value: englishText(nameSplitMixLocation),
          basis:
            "The source name embeds a mix or availability phrase; TIDAS name-plan stores it in mixAndLocationTypes rather than baseName.",
          evidence: evidenceObject("name_plan_mix_location", task, item, {
            source_name: nameSplit.source,
            extracted_mix_location: nameSplitMixLocation,
          }),
          resolution: resolution(
            hasExplicitMixAction ? "location_decision" : "source_language_normalization",
            "Moved the source mix/location phrase from baseName into mixAndLocationTypes.",
          ),
          closes_action_items: mixCloses,
        });
      }
    }

    if (code === "semantic_name_mix_location_too_bare") {
      if (emittedMixLocation) continue;
      emittedMixLocation = true;
      const locationCode = String(item?.evidence?.location_code_candidate ?? "").toUpperCase();
      const locationPhrase =
        nameSplitMixLocation ?? inferMixLocationPhrase({ isProcess, name, locationCode });
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/mixAndLocationTypes`,
        value: englishText(locationPhrase),
        basis:
          "The field contains only a bare location code; the completed location decision places the formal code in locationOfSupply, while the required name-plan field should carry a human-readable availability/location-type phrase.",
        evidence: evidenceObject("bare_location_name_part_replaced", task, item, {
          removed_value: item?.evidence?.text ?? null,
          formal_location_field: formalLocationField,
          formal_location_code: locationCode || null,
          selected_name_phrase: locationPhrase,
        }),
        resolution: resolution(
          "location_decision",
          "Replaced a bare location code with a source-language location-type phrase while locationOfSupply carries the formal TIDAS code.",
        ),
        closes_action_items: [closureFor(item)],
      });
    }

    if (code === "semantic_content_saturation_flow_quantitative_properties_missing" && !isProcess) {
      const value = flowReferencePropertyActionValue(item);
      if (!value) {
        operations.push({
          blocker: {
            code: "bafu_flow_property_descriptor_missing",
            dataset_id: task.entity.entity_id,
            action_item: closureFor(item),
            message: "No reference flow-property descriptor was available for autofill.",
          },
        });
        continue;
      }
      operations.push({
        op: "add",
        path: "/flowDataSet/flowInformation/dataSetInformation/name/flowProperties",
        value,
        basis:
          "The referenced quantitative flow property is explicit evidence for the TIDAS name.flowProperties descriptor and is not redundant with the base flow name.",
        evidence: evidenceObject("flow_property_descriptor_from_reference", task, item, {
          reference_flow_properties: item?.evidence?.reference_flow_properties ?? [],
          selected_value: value,
        }),
        resolution: resolution(
          "evidence_backed_completion",
          "Filled flowProperties from the referenced quantitative flow property evidence.",
        ),
        closes_action_items: [closureFor(item)],
      });
    }

    if (code === "semantic_process_only_output_exchange_requires_review" && isProcess) {
      operations.push(buildSourceOnlyOutputExchangeTraceOperation(task, item));
    }
  }
  return operations;
}

function processSourceTraceObject(task) {
  const info =
    task.authoring_package_payload?.source_row?.processDataSet?.processInformation
      ?.dataSetInformation ??
    task.authoring_package_payload?.entity_payload?.processDataSet?.processInformation
      ?.dataSetInformation ??
    {};
  return info?.["common:other"]?.["tidasimport:sourceTrace"]?.payload ?? null;
}

function processSourceExchangeCompletenessEvidence(task, actionItem) {
  const sourceTrace = processSourceTraceObject(task);
  const sourceObject = sourceTrace?.sourceObject ?? task.context?.source_rows_file ?? null;
  const exchangeCount = actionItem?.evidence?.exchange_count ?? null;
  const directions = actionItem?.evidence?.directions ?? [];
  return {
    source: "dataset-bafu-auto-authoring",
    source_file: sourceObject,
    field_path: "processDataSet.exchanges.exchange",
    quote_or_trace:
      "Source TIDAS process row contains only Output exchanges; Foundry preserves the source exchange set and requires an explicit source-trace acceptance record before remote write.",
    source_trace: sourceTrace
      ? {
          format: sourceTrace.format ?? null,
          sourceObject,
          sourceClassification: sourceTrace.sourceClassification ?? null,
        }
      : null,
    exchange_count: exchangeCount,
    directions,
  };
}

function buildSourceOnlyOutputExchangeTraceOperation(task, actionItem) {
  const trace = {
    status: "source_only_output_exchange_verified",
    action_item_code: "semantic_process_only_output_exchange_requires_review",
    source: "dataset-bafu-auto-authoring",
    summary:
      "Foundry verified from the BAFU/TIDAS source row that this process scope is output-only in the source package; no synthetic input exchange is created.",
    evidence: processSourceExchangeCompletenessEvidence(task, actionItem),
  };
  return {
    op: "add",
    path: "/processDataSet/processInformation/dataSetInformation/common:other",
    value: {
      "@xmlns:tiangongfoundry": "https://tiangong.earth/foundry/curation/1.0",
      "tiangongfoundry:sourceExchangeCompleteness": [trace],
    },
    basis:
      "The source BAFU/TIDAS process row itself is output-only, and the import must preserve source exchange semantics rather than manufacturing missing inputs.",
    evidence: evidenceObject("source_only_output_exchange_verified", task, actionItem, {
      trace,
    }),
    resolution: resolution(
      "source_trace_verified",
      "Closed the output-only exchange action item with structured source trace evidence from the BAFU/TIDAS authoring package.",
    ),
    closes_action_items: [closureFor(actionItem)],
  };
}

export function createBafuAutoAuthoringCommands({
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  readText,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeJsonLines,
}) {
  function runDatasetBafuIdentityDecisionsAutofill(options = {}) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bafu-identity-decisions-autofill",
        usage: [
          "node scripts/foundry.mjs dataset-bafu-identity-decisions-autofill --identity-decision-task <identity-decision-task.json>",
        ],
        purpose:
          "Write BAFU-specific identity-decisions.jsonl for safe, auditable product-flow create_new cases. This command never writes the remote database.",
      };
    }
    const taskPath = resolveRepoPath(options.identityDecisionTask ?? options.task ?? options.input);
    if (!taskPath || !fileExists(taskPath)) {
      throw new Error("--identity-decision-task is required.");
    }
    const task = readJson(taskPath);
    const outFile = resolveRepoPath(
      options.out ||
        options.decisions ||
        task.files?.expected_decisions ||
        path.join(path.dirname(taskPath), "identity-decisions.jsonl"),
    );
    const outDir = resolveRepoPath(options.outDir || path.dirname(outFile));
    const reportFile = path.join(outDir, "bafu-identity-decisions-autofill-report.json");
    const rows = ensureArray(task.identity_action_items).map((item) =>
      identityDecisionRow(item, task),
    );
    const blockedRows = rows.filter((row) => row.identity_decision === "block_unresolved");
    fs.mkdirSync(outDir, { recursive: true });
    writeJsonLines(outFile, rows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-bafu-identity-decisions-autofill",
      identity_decision_task: repoRelativePath(taskPath),
      counts: {
        identity_action_items: ensureArray(task.identity_action_items).length,
        decisions: rows.length,
        create_new: rows.filter((row) => row.identity_decision === "create_new").length,
        blocked_unresolved: blockedRows.length,
      },
      blocked: blockedRows.map((row) => ({
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        reason: row.basis,
      })),
      files: {
        report: repoRelativePath(reportFile),
        decisions: repoRelativePath(outFile),
      },
    };
    writeJson(reportFile, report);
    return report;
  }

  function runDatasetBafuAuthoringPatchesAutofill(options = {}) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bafu-authoring-patches-autofill",
        usage: [
          "node scripts/foundry.mjs dataset-bafu-authoring-patches-autofill --task-manifest <authoring-task-manifest.json>",
        ],
        purpose:
          "Write per-task BAFU AI patch artifacts for supported high-confidence name-plan and flow-property saturation action items. This command never writes the remote database.",
      };
    }
    const manifestPath = resolveRepoPath(options.taskManifest ?? options.manifest ?? options.input);
    if (!manifestPath || !fileExists(manifestPath)) {
      throw new Error("--task-manifest is required.");
    }
    const manifest = readJson(manifestPath);
    const outDir = resolveRepoPath(options.outDir || path.dirname(manifestPath));
    const reportFile = path.join(outDir, "bafu-authoring-patches-autofill-report.json");
    const blockers = [];
    const patchFiles = [];

    for (const task of ensureArray(manifest.tasks)) {
      if (task.status !== "ready_for_ai_authoring") continue;
      const packagePath = resolveRepoPath(task.files?.authoring_package);
      if (!packagePath || !fileExists(packagePath)) {
        blockers.push({
          code: "authoring_package_missing",
          dataset_id: task.entity?.entity_id ?? null,
          authoring_package: task.files?.authoring_package ?? null,
        });
        continue;
      }
      const enrichedTask = {
        ...task,
        authoring_package_payload: readJson(packagePath),
      };
      const operations = buildNamePatchOperations(enrichedTask);
      const operationBlockers = operations.filter((operation) => operation.blocker);
      if (operationBlockers.length > 0) {
        blockers.push(...operationBlockers.map((operation) => operation.blocker));
        continue;
      }
      const patchPath = resolveRepoPath(task.files?.output_patch_file);
      if (!patchPath) {
        blockers.push({
          code: "output_patch_file_missing",
          dataset_id: task.entity?.entity_id ?? null,
        });
        continue;
      }
      const payload = {
        schema_version: 1,
        kind: "tiangong_foundry_dataset_patch",
        patch_status: "completed",
        generated_at_utc: nowIso(),
        task_manifest: repoRelativePath(manifestPath),
        patch_sets: [
          {
            dataset_type: task.entity.dataset_type,
            dataset_id: task.entity.entity_id,
            version: task.entity.version,
            authoring_package: path.basename(packagePath),
            authoring_package_sha256: task.context?.authoring_package_sha256 ?? null,
            operations,
          },
        ],
      };
      ensureDirFor(patchPath);
      writeJson(patchPath, payload);
      patchFiles.push(repoRelativePath(patchPath));
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-bafu-authoring-patches-autofill",
      task_manifest: repoRelativePath(manifestPath),
      counts: {
        tasks: ensureArray(manifest.tasks).length,
        patch_files: patchFiles.length,
        blockers: blockers.length,
      },
      blockers,
      files: {
        report: repoRelativePath(reportFile),
        patch_files: patchFiles,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportFile, report);
    return report;
  }

  return {
    runDatasetBafuAuthoringPatchesAutofill,
    runDatasetBafuIdentityDecisionsAutofill,
  };
}
