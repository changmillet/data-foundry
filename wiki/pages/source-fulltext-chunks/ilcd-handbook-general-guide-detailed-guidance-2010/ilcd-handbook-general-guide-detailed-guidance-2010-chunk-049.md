---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook General Guide for LCA Detailed Guidance (2010) - chunk 049"
nodeId: "ilcd-handbook-general-guide-detailed-guidance-2010-chunk-049"
status: "active"
visibility: "private"
sourceRefs:
  - "source-summaries/ilcd-handbook-general-guide-detailed-guidance-2010.md"
relatedPages:
  - "concepts/foundry-rulesbook-wiki.md"
tags:
  - "rulesbook"
  - "ilcd"
  - "lca"
  - "handbook"
  - "detailed-guidance"
  - "source-fulltext"
createdAt: "2026-05-14"
updatedAt: "2026-05-14"
sourceTitle: "ILCD Handbook General Guide for LCA Detailed Guidance (2010)"
sourceFile: "1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf"
sourceDocId: "ilcd-handbook-general-guide-detailed-guidance-2010"
chunkIndex: 49
pageRange: "238-241"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 238 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  218
  7.4.3.3 Emission of ionic compounds
  (Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
  Introduction and overview
  For a number of compounds methodological questions arise how to inventory them, e.g. is
  the ionic but environmentally very stable substance CdS to be inventoried as the two ions
  Cd2+ and S2- or as the compound CdS? For the impact assessment this is crucial, as the fate
  strongly depends on water solubility. For particle emissions only those that do not dissolve in
  the lungs act carcinogenic. To limit the number of elementary flows and to avoid "forgetting"
  flows that have no impact factors assigned, it is desirable to limit the number of single
  elementary flows by inventorying the ions separately.
  Along the initially named considerations, the following solution is derived:
  Easily water soluble ionic compounds  (e.g. salts such as Ammonium nitrate , Cadmium
  chloride, etc.) are to be inventoried as the ions of which they exist: These compounds, when
  released to the environment (with some exceptions however)  behave largely as if dealing
  with the ions separately. Looking at a single particle and its solubility in one droplet of water
  of 1mm diameter and hence about 0.0005 ml (formed as rain or in the lung tissue), the limit is
  set roughly  where at 20 oC less t han half of a particle of 2 μm diameter dissolves in that
  amount of water. This depends also on the density of the material, but for orientation
  assuming th e density to be 2 kg/l itre resulting in  a particle mass of about 8*10E-12 g, the
  border is at 0.5*8*10E-12 g / 0.00 05 ml =  8*10E-9 g/ml (or 8*10-6 g/litre, i.e. about 10
  μg/litre).  As convention the limit is hence set at a solubility in water at 20 oC of below 10
  μg/litre145,146.
  Less good water soluble compounds are to be inventoried as compound.
  Note that this provision - other than the similar provision on particles does not apply for
  water-soluble, dissociating organic compounds.

  Provisions: 7.4.3.3 Emission of ionic compounds
  I) SHALL - Inventory easily water soluble salts as ions:  For data sets as deliverables,
  emissions to air, water, or soil of easily water -soluble ionic compounds (salts) shall be
  inventoried as separate ions, unless the selected LCIA methods would require
  otherwise. As convention, the limit is set at a solubility in water at 20 oC of 10 μg/litre,
  above which the ions shall be inventoried separately, below which the compound shall
  be inventoried. This applies unless the selected LCIA method requires otherwise. [ISO!]
  Note that if the above provisions cannot be fully met, this shal l be explicitly considered when reporting achieved
  data quality and when interpreting the results of LCA studies. Note that LCI data sets' inventories that do not meet
  the above requirements are not compliant with the ILCD nomenclature.
  7.4.3.4 Emission of particles to air
  (Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
  Overview
  Three issues play a role for particulate mater:

  145 Some examples: CaCO3 = 600 μg/l, Cu(OH)2 = 17 μg/l, CdS = 0.0001 μg/l.
  146 For orientation: for a substance of 100g/mol this is hence 0.001 mol/litre.

  --- Page 239 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  219
  Particle size classes, water solubility, and additivity of impacts.
  Particle size classes
  Firstly, and given the different impact, par ticulate matter should be split up into different
  size classes with different toxicity implications (as the size determines the access to the
  lungs and uptake into the lung tissue).
  Water solubility
  Secondly for particulates it is to be considered that on ly particulate matter emissions to air
  that are insoluble in water are relevant for human toxicity. The easily water -soluble ones
  such as e.g. Ammonium nitrate when inhaled will immediately solve in the tissue water and
  pose no carcinogenic effect due to t heir particle character. Hence, not to overestimate the
  impact, the composition of the measured PM should be identified or derived from the source -
  process to determine whether/how much of it is water-soluble.
  Note that this applies not only to inorganic salts but also to e.g. organic substances.
  The third issue also relates to other types of emissions:
  Emission of substances with several additive / serial action schemes
  Elementary flows with additive / serial action schemes (e.g. NOx as contributing to bot h
  Photochemical ozone creation (summer smog) and Eutrophication) need to carry more than
  one characterisation factor.
  Complex elementary flows may need a special treatment in inventorying. E.g. an emission
  to air of 0.0001 kg Particl es (<2.5 μm) that cont ains 50 % Chromium VI implies an additive
  cancer potential from both being a particle and being (to 50 %) Chromium VI.
  To avoid that a huge number of “Particle XY” elementary flows with different composition
  needs to be inventoried (including the problem f or LCA practitioners to correctly assigning
  the impact factors), a splitting up into the single components (e.g. in the given example into
  0.0001 kg “Particles <2.5 μm” plus 0.00005 kg “Chromium VI”) is recommended. In this case
  (and analogously if both th e amount of particles and the amount of chromium are separately
  measured but in the same off -gas stream), both amounts are inventoried as separate
  elementary flows. Note that this results in a (in absolute terms however very small) double
  counting of the m ass. The impact effect however is more appropriately addressed. As an
  exact mass-balance of LCI results is never given in practice (as e.g. incineration air is left
  out, certain water losses are not inventoried etc.) this minor double counting of the masse s
  (while correctly addressing the effect of the inventory) is acceptable147.
  Note: In the cases of interest in a more detailed impact modelling and taking into account
  more details such as speciation, in such specific application cases also more specific
  elementary flows can be created, of course, while for background databases this should be
  avoided, as to ensure a consistent databases and to have appropriate LCIA factors available
  and fully linked to the inventory.

  147 Discussion of other options: Other solutions could be, to inventory only the most important aspect as a flow (in
  the above example e.g. as particles <2.5 μm without Chromium) or to enter only the most important impact factor
  into the combined flow. This however creates problems, where the substance contributes to different impact
  categories (e.g. "NO 2 to air" to Human Toxicity and Eutrophication), since it is not possible to determine
  independently, which of the different impacts is quantitatively more important. The possibility to apply reduced
  characterisation factors for both effects - which may be developed in the future by LCIA – is kept. This is however
  not expected to solve this issue, as it causes a number of other problems in LCI practice. Among others a steadily
  growing set of elementary flows of slightly different composition that would require the final users / LCA
  practitioners to correctly calculate and assign the impact factors to these new flows.

  --- Page 240 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  220

  Provisions: 7.4.3.4 Emission of particles to air
  I) SHALL - Inventory only poorly water soluble compounds as particles:  Particulate
  matter (PM) emissions to air shall include only poorly water -soluble compounds below a
  solubility in water at 20 oC of 10 ug/litre , as far as feasible . Expert judgemen t may be
  needed to identify the composition of the particles. [ISO!]
  II) SHOULD - Differentiate particle size classes: Particles should be reported split up by
  particle size class <0.2 μm, 0.2 -2.5 μm, 2.5 -10 μm, >10 μm if the information is
  available. <10 μm may be used alternatively is a more differentiated information below
  10 μm is not available. This applies unless the  selected LCIA method requires
  otherwise. [ISO!]
  III) SHALL - Inventory particles additionally as the substances they are composed of:
  Particles shall be inventoried as both PM and additionally as elementary flows of their
  environmentally relevant components ( e.g. metals contributing to cancer effects), i.e.
  double counting their mass in the inventory, as far as possible. This applies analogously
  to other emissions with additive action schemes. [ISO!]
  Note that if the above provisions cannot be fully met, this  shall be explicitly considered when reporting achieved
  data quality and when interpreting the results of LCA studies. Note that LCI data sets' inventories that do not meet
  the above requirements are not compliant with the ILCD nomenclature.
  7.4.3.5 Emission of s ubstances of complementary, alternative action
  schemes
  (Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
  For the emission of substances of complementary, alternative action schemes, the fate is
  fully modelled in the LCIA method and the impact factors c onsider this fact. An example are
  NOx emissions to air that either have a Human toxicity effect (inorganic respiratory effect) or
  an Eutrophication effect on land and water bodies).
  7.4.3.6 Resource elementary flows
  (Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
  7.4.3.6.1 Energy resources
  (Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
  Taking into account the initially made considerations, the following can be concluded for
  energetic resources: To evaluate the resource depletion of energetic resources, with
  currently used and practice -tested impact models do not require differentiating them by their
  specific energy-content/mass ratio or by the country or origin. This allows to keep the number
  of non -renewable energy resource elementary flows low , i.e. instead of hundreds of
  elementary flows of the type "Crude oil Norway", "Crude oil Saudi Arabia", or “Brent Spar”,
  “Tia Juana Light” etc., or "Crude oil 42.6 MJ/kg", "Crude oil 42.3 MJ/kg", etc. only 1 (most
  energy resources) to 3 (crude oils) elementary flows are required (see below).
  To support established practice in resource -depletion impact assessment of energetic
  resource elementary flows, exclusively a differentiation by type of deposit/source is required,
  i.e. primary, secondary, tertiary crude oil and open p it or underground mining of hard coal.
  Other fossil fuel resource elementary flows (natural gas, oil shale, tar sand, lignite, peat) do
  currently not need a differentiation.

  --- Page 241 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  221
  For renewable energy forms, the usable amount of energy that is extracted from na ture is
  to be inventoried. E.g. for solar electricity and heat this relates to the amount of electricity
  and/or heat captured by the solar cells (i.e. not the total solar energy, but what is delivered
  directly by the cells as electricity and/or usable heat ). For biomass from nature this is the
  amount physically embodied, measured as Lower calorific value, however of the water -free
  substance (i.e. measured as if the e.g. wood would be oven -dry). Note that biomass from
  fields and managed forests is no element ary flow. In that case, the named energy resources
  shall be inventoried directly as the respective elementary flows, e.g. "Solar energy" as
  "Renewable energy resources from air", expressed as Lower calorific value and measured in
  the reference unit MJ.
  As to the reference flow property and the reference unit of energetic resources see the
  respective chapter in the separate document “Nomenclature and other conventions”.
  7.4.3.6.2 Ores for winning metals or other elemental constituents
  (Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
  Taking into account the initially made considerations, the following can be concluded for
  non-energetic resources: To evaluate the resource depletion of most non -energetic
  resources with currently used and practice -tested LCIA method s, it is not required to
  differentiate them by their specific element-content/mass ratio or by the country or origin.
  This allows lowering the number of elementary flows in the inventory, following a similar
  approach as for the non -renewable energetic reso urce elementary flows (see also previous
  point). The inventorying of (metal) ore elementary flows shall hence be based on a
  differentiation of ore bodies or minerals into the single elements' elementary flows (e.g. 0.012
  kg “Lead” and 0.023 kg “Zinc” elementary flows are inventoried, when e.g. 1 kg Lead-zinc ore
  (1.2 % Pb, 2.3 % Zn) is extracted. 0.78 kg "Anhydrite" is inventoried, when e.g. an anhydrite -
  containing body of 1 kg Anhydrite -containing rock (78  % anhydrite) is extracted.) This at the
  same time allows to overcome the problematic current situation of having a huge number of
  “impact-free”/forgotten specific ores and minerals in the inventory for which by -default no
  impact factors are provided.
  For functional/material resources it is however necessa ry to capture their specificity (e.g.
  “Granite”).
  To complete the mass flow of the resource, the non -resource part of the ore is to be
  inventoried as “inert rock” “Resources from ground” (or water, as applicable)148.
  7.4.3.6.3 Land use
  (Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
  Direct land use and land transformation shall be inventoried along the needs of the
  applied LCIA method (if included in the impact assessment).  Specific guidance is not
  provided at this point but might be given in a supplement or revised version.
  For CO2 release caused by land use and land transformation, the use of the most recent
  IPCC CO2 emission factors shall be used, unless more accurate, specific data is available.
  Detailed provisions and table with the current IPCC factors: see chapter 7.4.4.1 and annex
  13.

  148 In practice, the inventory of a lead -zinc ore mining process would have in the input -side the above named e.g.
  “Lead”, “Zinc”, and “Inert rock” elementary flows, while i n the output side the product flow (!) “Lead -zinc ore; 1.2%
  Pb, 2.3% Zn”. (After processing the “tailings” would be a waste that is modelled to the leached emissions.) This
  has the effect that when calculating LCI results, only the relevant elementary reso urce flows “Lead” and “Zinc”
  remain in the inventory, resulting in the desired reduction of the number of elementary flows in the inventory.
---

## Chunk Identity

- Source: ILCD Handbook General Guide for LCA Detailed Guidance (2010)
- Source file: `1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf`
- Page range: 238-241
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 238 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  218
7.4.3.3 Emission of ionic compounds
(Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
Introduction and overview
For a number of compounds methodological questions arise how to inventory them, e.g. is
the ionic but environmentally very stable substance CdS to be inventoried as the two ions
Cd2+ and S2- or as the compound CdS? For the impact assessment this is crucial, as the fate
strongly depends on water solubility. For particle emissions only those that do not dissolve in
the lungs act carcinogenic. To limit the number of elementary flows and to avoid "forgetting"
flows that have no impact factors assigned, it is desirable to limit the number of single
elementary flows by inventorying the ions separately.
Along the initially named considerations, the following solution is derived:
Easily water soluble ionic compounds  (e.g. salts such as Ammonium nitrate , Cadmium
chloride, etc.) are to be inventoried as the ions of which they exist: These compounds, when
released to the environment (with some exceptions however)  behave largely as if dealing
with the ions separately. Looking at a single particle and its solubility in one droplet of water
of 1mm diameter and hence about 0.0005 ml (formed as rain or in the lung tissue), the limit is
set roughly  where at 20 oC less t han half of a particle of 2 μm diameter dissolves in that
amount of water. This depends also on the density of the material, but for orientation
assuming th e density to be 2 kg/l itre resulting in  a particle mass of about 8*10E-12 g, the
border is at 0.5*8*10E-12 g / 0.00 05 ml =  8*10E-9 g/ml (or 8*10-6 g/litre, i.e. about 10
μg/litre).  As convention the limit is hence set at a solubility in water at 20 oC of below 10
μg/litre145,146.
Less good water soluble compounds are to be inventoried as compound.
Note that this provision - other than the similar provision on particles does not apply for
water-soluble, dissociating organic compounds.

Provisions: 7.4.3.3 Emission of ionic compounds
I) SHALL - Inventory easily water soluble salts as ions:  For data sets as deliverables,
emissions to air, water, or soil of easily water -soluble ionic compounds (salts) shall be
inventoried as separate ions, unless the selected LCIA methods would require
otherwise. As convention, the limit is set at a solubility in water at 20 oC of 10 μg/litre,
above which the ions shall be inventoried separately, below which the compound shall
be inventoried. This applies unless the selected LCIA method requires otherwise. [ISO!]
Note that if the above provisions cannot be fully met, this shal l be explicitly considered when reporting achieved
data quality and when interpreting the results of LCA studies. Note that LCI data sets' inventories that do not meet
the above requirements are not compliant with the ILCD nomenclature.
7.4.3.4 Emission of particles to air
(Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
Overview
Three issues play a role for particulate mater:

145 Some examples: CaCO3 = 600 μg/l, Cu(OH)2 = 17 μg/l, CdS = 0.0001 μg/l.
146 For orientation: for a substance of 100g/mol this is hence 0.001 mol/litre.

--- Page 239 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  219
Particle size classes, water solubility, and additivity of impacts.
Particle size classes
Firstly, and given the different impact, par ticulate matter should be split up into different
size classes with different toxicity implications (as the size determines the access to the
lungs and uptake into the lung tissue).
Water solubility
Secondly for particulates it is to be considered that on ly particulate matter emissions to air
that are insoluble in water are relevant for human toxicity. The easily water -soluble ones
such as e.g. Ammonium nitrate when inhaled will immediately solve in the tissue water and
pose no carcinogenic effect due to t heir particle character. Hence, not to overestimate the
impact, the composition of the measured PM should be identified or derived from the source -
process to determine whether/how much of it is water-soluble.
Note that this applies not only to inorganic salts but also to e.g. organic substances.
The third issue also relates to other types of emissions:
Emission of substances with several additive / serial action schemes
Elementary flows with additive / serial action schemes (e.g. NOx as contributing to bot h
Photochemical ozone creation (summer smog) and Eutrophication) need to carry more than
one characterisation factor.
Complex elementary flows may need a special treatment in inventorying. E.g. an emission
to air of 0.0001 kg Particl es (<2.5 μm) that cont ains 50 % Chromium VI implies an additive
cancer potential from both being a particle and being (to 50 %) Chromium VI.
To avoid that a huge number of “Particle XY” elementary flows with different composition
needs to be inventoried (including the problem f or LCA practitioners to correctly assigning
the impact factors), a splitting up into the single components (e.g. in the given example into
0.0001 kg “Particles <2.5 μm” plus 0.00005 kg “Chromium VI”) is recommended. In this case
(and analogously if both th e amount of particles and the amount of chromium are separately
measured but in the same off -gas stream), both amounts are inventoried as separate
elementary flows. Note that this results in a (in absolute terms however very small) double
counting of the m ass. The impact effect however is more appropriately addressed. As an
exact mass-balance of LCI results is never given in practice (as e.g. incineration air is left
out, certain water losses are not inventoried etc.) this minor double counting of the masse s
(while correctly addressing the effect of the inventory) is acceptable147.
Note: In the cases of interest in a more detailed impact modelling and taking into account
more details such as speciation, in such specific application cases also more specific
elementary flows can be created, of course, while for background databases this should be
avoided, as to ensure a consistent databases and to have appropriate LCIA factors available
and fully linked to the inventory.

147 Discussion of other options: Other solutions could be, to inventory only the most important aspect as a flow (in
the above example e.g. as particles <2.5 μm without Chromium) or to enter only the most important impact factor
into the combined flow. This however creates problems, where the substance contributes to different impact
categories (e.g. "NO 2 to air" to Human Toxicity and Eutrophication), since it is not possible to determine
independently, which of the different impacts is quantitatively more important. The possibility to apply reduced
characterisation factors for both effects - which may be developed in the future by LCIA – is kept. This is however
not expected to solve this issue, as it causes a number of other problems in LCI practice. Among others a steadily
growing set of elementary flows of slightly different composition that would require the final users / LCA
practitioners to correctly calculate and assign the impact factors to these new flows.

--- Page 240 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  220

Provisions: 7.4.3.4 Emission of particles to air
I) SHALL - Inventory only poorly water soluble compounds as particles:  Particulate
matter (PM) emissions to air shall include only poorly water -soluble compounds below a
solubility in water at 20 oC of 10 ug/litre , as far as feasible . Expert judgemen t may be
needed to identify the composition of the particles. [ISO!]
II) SHOULD - Differentiate particle size classes: Particles should be reported split up by
particle size class <0.2 μm, 0.2 -2.5 μm, 2.5 -10 μm, >10 μm if the information is
available. <10 μm may be used alternatively is a more differentiated information below
10 μm is not available. This applies unless the  selected LCIA method requires
otherwise. [ISO!]
III) SHALL - Inventory particles additionally as the substances they are composed of:
Particles shall be inventoried as both PM and additionally as elementary flows of their
environmentally relevant components ( e.g. metals contributing to cancer effects), i.e.
double counting their mass in the inventory, as far as possible. This applies analogously
to other emissions with additive action schemes. [ISO!]
Note that if the above provisions cannot be fully met, this  shall be explicitly considered when reporting achieved
data quality and when interpreting the results of LCA studies. Note that LCI data sets' inventories that do not meet
the above requirements are not compliant with the ILCD nomenclature.
7.4.3.5 Emission of s ubstances of complementary, alternative action
schemes
(Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
For the emission of substances of complementary, alternative action schemes, the fate is
fully modelled in the LCIA method and the impact factors c onsider this fact. An example are
NOx emissions to air that either have a Human toxicity effect (inorganic respiratory effect) or
an Eutrophication effect on land and water bodies).
7.4.3.6 Resource elementary flows
(Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
7.4.3.6.1 Energy resources
(Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
Taking into account the initially made considerations, the following can be concluded for
energetic resources: To evaluate the resource depletion of energetic resources, with
currently used and practice -tested impact models do not require differentiating them by their
specific energy-content/mass ratio or by the country or origin. This allows to keep the number
of non -renewable energy resource elementary flows low , i.e. instead of hundreds of
elementary flows of the type "Crude oil Norway", "Crude oil Saudi Arabia", or “Brent Spar”,
“Tia Juana Light” etc., or "Crude oil 42.6 MJ/kg", "Crude oil 42.3 MJ/kg", etc. only 1 (most
energy resources) to 3 (crude oils) elementary flows are required (see below).
To support established practice in resource -depletion impact assessment of energetic
resource elementary flows, exclusively a differentiation by type of deposit/source is required,
i.e. primary, secondary, tertiary crude oil and open p it or underground mining of hard coal.
Other fossil fuel resource elementary flows (natural gas, oil shale, tar sand, lignite, peat) do
currently not need a differentiation.

--- Page 241 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  221
For renewable energy forms, the usable amount of energy that is extracted from na ture is
to be inventoried. E.g. for solar electricity and heat this relates to the amount of electricity
and/or heat captured by the solar cells (i.e. not the total solar energy, but what is delivered
directly by the cells as electricity and/or usable heat ). For biomass from nature this is the
amount physically embodied, measured as Lower calorific value, however of the water -free
substance (i.e. measured as if the e.g. wood would be oven -dry). Note that biomass from
fields and managed forests is no element ary flow. In that case, the named energy resources
shall be inventoried directly as the respective elementary flows, e.g. "Solar energy" as
"Renewable energy resources from air", expressed as Lower calorific value and measured in
the reference unit MJ.
As to the reference flow property and the reference unit of energetic resources see the
respective chapter in the separate document “Nomenclature and other conventions”.
7.4.3.6.2 Ores for winning metals or other elemental constituents
(Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
Taking into account the initially made considerations, the following can be concluded for
non-energetic resources: To evaluate the resource depletion of most non -energetic
resources with currently used and practice -tested LCIA method s, it is not required to
differentiate them by their specific element-content/mass ratio or by the country or origin.
This allows lowering the number of elementary flows in the inventory, following a similar
approach as for the non -renewable energetic reso urce elementary flows (see also previous
point). The inventorying of (metal) ore elementary flows shall hence be based on a
differentiation of ore bodies or minerals into the single elements' elementary flows (e.g. 0.012
kg “Lead” and 0.023 kg “Zinc” elementary flows are inventoried, when e.g. 1 kg Lead-zinc ore
(1.2 % Pb, 2.3 % Zn) is extracted. 0.78 kg "Anhydrite" is inventoried, when e.g. an anhydrite -
containing body of 1 kg Anhydrite -containing rock (78  % anhydrite) is extracted.) This at the
same time allows to overcome the problematic current situation of having a huge number of
“impact-free”/forgotten specific ores and minerals in the inventory for which by -default no
impact factors are provided.
For functional/material resources it is however necessa ry to capture their specificity (e.g.
“Granite”).
To complete the mass flow of the resource, the non -resource part of the ore is to be
inventoried as “inert rock” “Resources from ground” (or water, as applicable)148.
7.4.3.6.3 Land use
(Refers to aspects of ISO 14044:2006 chapter 4.2.3.5)
Direct land use and land transformation shall be inventoried along the needs of the
applied LCIA method (if included in the impact assessment).  Specific guidance is not
provided at this point but might be given in a supplement or revised version.
For CO2 release caused by land use and land transformation, the use of the most recent
IPCC CO2 emission factors shall be used, unless more accurate, specific data is available.
Detailed provisions and table with the current IPCC factors: see chapter 7.4.4.1 and annex
13.

148 In practice, the inventory of a lead -zinc ore mining process would have in the input -side the above named e.g.
“Lead”, “Zinc”, and “Inert rock” elementary flows, while i n the output side the product flow (!) “Lead -zinc ore; 1.2%
Pb, 2.3% Zn”. (After processing the “tailings” would be a waste that is modelled to the leached emissions.) This
has the effect that when calculating LCI results, only the relevant elementary reso urce flows “Lead” and “Zinc”
remain in the inventory, resulting in the desired reduction of the number of elementary flows in the inventory.
