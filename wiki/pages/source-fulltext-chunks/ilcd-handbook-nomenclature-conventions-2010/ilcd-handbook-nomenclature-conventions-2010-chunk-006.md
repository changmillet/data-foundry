---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook Nomenclature and Other Conventions (2010) - chunk 006"
nodeId: "ilcd-handbook-nomenclature-conventions-2010-chunk-006"
status: "active"
visibility: "private"
sourceRefs:
  - "source-summaries/ilcd-handbook-nomenclature-conventions-2010.md"
relatedPages:
  - "concepts/foundry-rulesbook-wiki.md"
tags:
  - "rulesbook"
  - "ilcd"
  - "lca"
  - "nomenclature"
  - "conventions"
  - "source-fulltext"
createdAt: "2026-05-14"
updatedAt: "2026-05-14"
sourceTitle: "ILCD Handbook Nomenclature and Other Conventions (2010)"
sourceFile: "9-MANPROJ-PR-ILCD-Handbook-Nomenclature-and-other-conventions-first-edition-ISBN-fin-v1.0-E.pdf"
sourceDocId: "ilcd-handbook-nomenclature-conventions-2010"
chunkIndex: 6
pageRange: "40-46"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 40 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   30
  4 Classification, nomenclature and assignment of
  Flow properties, Unit groups, and Units
  Flow properties and units are on one side indi spensable to correctly specify flows
  and on the other side one of the most prominent error sources in LCA. Therefore a
  clear structure and clear rules are important for error -free LCI work and data
  exchange.
  Flow properties that are used for flows can be "extensive" (e.g. energy content,
  element content, volume, etc.) or "intensive" (e.g. temperature, pressure, etc.). For
  calculating and analysing LCI results only extensive properties are of interest (e.g.
  the net calorific energy content of all energy res ources are linearly summed up per
  reference flow of the modelled product system to yield the primary energy
  consumption figure), while intensive properties are often used to specify flows without
  using them in subsequent calculations (e.g. temperature and pressure of different
  steams as co-products of a process).
  Providing all the relevant extensive flow properties with flow data sets eases data
  exchange and conversion between different properties and also different unit
  systems.
  4.1 Classification of Flow properties and Unit groups
  There are basically three kinds of flow properties of interest in state-of-the-art LCA:
   Technical flow properties that describe the main physical and technical properties such
  as e.g. calorific content,
   chemical composition of fl ows that describe e.g. the elemental composition of the flow
  (and not chemical properties why the class name is a bit different than the other two for
  better clarity), and
   economic flow properties that describe the economic value of the flow.
  For flow properties and unit groups the number of data sets to be expected is too
  small to justify a second -level hierarchy, while it should be avoided to have one long
  list only. Hence only the three main flow property groups are differentiated as
  classes. Even if so ftware tools can internally not store objects in classes, by
  exporting them to reports or the ILCD reference format, the assignment to the three
  suggested classes is straightforward:
  Rule 21: Mandatory for technical target audience , recommended for non-technical
  target audience: classification for flow properties:
  “Technical flow properties" (e.g. "Net calorific value", "Mass" etc.)
  "Chemical composition of flows" (e.g. "Iron content", "Methane content" etc.)
  "Economic flow properties” (e.g. "Market value US 1997, b ulk prices", "Market
  value EU-27 2008, private consumer prices", etc.)

  --- Page 41 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   31
  “Other flow properties”
  Chemical composition of flows are kept separately from technical flow properties
  as the number of data sets in these classes is rather high.
  Note: Please note th at there are no " environmental flow properties" or
  "environmental unit groups" as for LCIA factors the data set type "LCIA method" was
  introduced in the ILCD format. These LCIA method data set type is of a different
  quality and needs a quite different and more comprehensive documentation than e.g.
  technical flow properties.
  Rule 22: Mandatory for technical target audience , recommended for non-technical
  target audience: classification of unit groups:
  “Technical unit groups" (e.g. "Units of energy", "Units of mass", etc.)
  "Economic unit groups" (e.g. "Units of currency 1997", "Units of currency
  1998", etc.)
  “Other unit groups”
  Note that no "Chemical composition unit groups" class is required, as the related
  flow properties / LCIA factors will always use technical Unit groups and units (e.g.
  mass, volume, etc.). E.g. it will be "kg" Iron content (per given reference unit of
  an enriched ore flow, i.e. kg Fe per kg iron ore).
  The assignment of year-dependent currency units is required to be able to convert
  both among diffe rent units within one currency (e.g. "Euro" and "Euro -cents") and
  among currencies while the exchange rates change with time. Together with year -
  specific economic flow properties (and the option to further differentiate different
  price-levels in different regions and additionally between e.g. bulk trade prices and
  consumer prices) a complete automatic conversion is enabled.
  A "LCIA method unit group class" (for LCIA method data sets) is not required, as
  this will be equally expressed e.g. in kg (i.e. "kg" " CO2-equivalents" for the LCIA
  method "Climate Change Potential").
  4.2 Names of Flow properties, Unit groups and Units ; their
  assignment to Flows
  Errors in LCI work and in data exchange occur regularly when differing flow
  properties are used, i.e. when gases are measured in mass by the data provider, but
  in volume in the receiving database or in net calorific value by one and in upper
  calorific value by another. The same type of errors occurs when differing unit
  systems or units are used for the same flow such  as mg, g, kg, ounces, pounds,
  short tons, bushels etc. for the flow property "mass".
  To minimise such errors and to ease an automatic conversion in daily data import
  and export, as well as to support readability and acceptance of LCA reports, a
  harmonisation is required here as well and rules are to be defined to derive the
  underlying properties and units for the reference elementary flow list and data sets.

  --- Page 42 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   32
  (See also next chapter for naming of new flow properties, Unit groups and Units):
  The naming of fl ow properties and units should apply commonly understood names,
  often derived from physics. For chemical composition of flows, the chemical names
  as used for flow names are to be used; see respective chapter.
  For the units themselves common terms, often abbreviations, are to be used, such
  as kg, US$, l etc.
  Considering the existing realities in LCI and LCIA practice, the following hierarchy
  of rules are set for flow properties and units of flows:

  Rule 23: Mandatory for technical target audience , recommended for non-technical
  target audience: Reference flow properties and reference units for types of
  flows, first criterion:
  All flows that possess a mass, are measured in the flow property “Mass”,
  as long as none of the below rules would require to use a different flo w
  property.
  The unit group for mass is “Units of mass” with the reference unit “kg”.

  Rule 24: Mandatory for technical target audience , recommended for non-technical
  target audience: Reference flow properties and reference units for types of
  flows, second criterion:
  Elementary flows, for which the energy content is the most relevant unit,
  are measured in the flow property “Net calorific value”.
  The unit group for the net calorific value is “Units of energy” with the
  reference unit “MJ”.
  Product and waste flows su ch as f uels, in contrast, can be  measured as is
  general usage, e.g. in mass (e.g. diesel, hard coal, etc.) , normal volume (e.g.
  natural gas) , "Net calorific value" with the unit "MJ" , or other . Note that for
  Uranium ore, for which a net calorific value per se can not be given, the usable
  fission energy content is expressed nevertheless as "Net calorific value" to ease
  aggregation with other fossil energy resources  to primary energy consumption
  figures.

  Further explanations and discussion:
  The reasoning for measuring energy resource elementary flows such as crude oil
  in their net calorific value property, is that this allows to use a limited number of crude
  oil elementary flows, while fully supporting the energy -related impact assessment of
  "Resource depletion". Some existing databases measure crude oil in mass, with the
  effect, that each crude oil resource with differing energy content requires an own
  elementary flow to properly inventory the non -renewable primary energy
  consumption. This so far lead to ext remely many elementary flows in the LCI result
  inventories, identically for hard coal and lignite as well as for natural gas resources.

  --- Page 43 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   33
  Exergy would be - from a scientific point of view - a more appropriate flow property
  for elemental flows of energy reso urces, but reality in LCI practice presently speaks
  rather against it. Using exergy would however allow to better address energy
  resource use as very wet energy carriers such as biomass including e.g. manure
  have very low or even negative net (and also upper) calorific content values but can
  be converted to biogas with a seemingly positive energy balance, "creating" energy
  (or more exactly: net calorific value). At the same time , the property exergy also
  works well for all other energy carriers. Difficultie s would arise (to some degree)
  when collecting inventory numbers, as very often only the net calorific values are
  measured and the exergy value would have to be calculated considering further
  information such as especially the water content. This issue is to be further discussed
  with industry practitioners and other LCA experts in context of future revisions of the
  ILCD methodology.

  Rule 25: Mandatory for technical target audience , recommended for non-technical
  target audience: Reference flow properties and referen ce units for types of
  flows, further criteria:
  Product and waste flows that are typically dealt with in standard volume
  and for which none of the other units named in this chapter is in use in
  practice, are measured in the flow property “Standard volume” (e.g. for the
  product flows “Compressed air; 10 bar”, "Oxygen; from refill gas cylinder of 40 l;
  150 bar", etc.). Not applicable to elementary flows.
  The unit group is “Units of volume” with the reference unit “m3”.

  Elementary flows for which the substanc e’s radioactivity is in focus, are
  measured in the flow property “Radioactivity” (e.g. elementary flow "thallium-
  201").
  The unit group is “Units of radioactivity” with the reference unit “kBq”, i.e.
  Kilo-Becquerel.

  Flows that are typically dealt with in number of items are measured in the
  flow property “Number” (e.g. product flows "Spare tyre passenger car; generic
  average", "Milk cow; Holstein, alive, start of lactation" etc.).
  The unit group is “Units of items” with the reference unit “Item(s)".

  Product and waste flows that are typically dealt with in length or distance
  are measured in the flow property “Length” (e.g. product flows "Welding
  seam; MIG/MAG, steel on steel" and "Water pipe; copper; max 5 bar, 15mm
  diameter", etc.). Not applicable to elementary flows.
  The unit group is “Units of length” with the reference unit “m”.

  --- Page 44 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   34

  Product and waste flows that are typically dealt with in duration are
  measured in the flow property “Time” (e.g. product flow / functional unit
  "Storage in warehouse; unheated"). Not applicable to elementary flows.
  The unit group is “Units of time” with the reference unit “d”, i.e. days.

  Product and waste flows that are typically dealt with in weight multiplied
  with distance are measured in the flow property “Mass* length” (e.g. product
  flow / functional unit "Road transport; bulk goods, generic mix; long distance").
  Not applicable to elementary flows.
  The unit group is “Units of mass*length” with the reference unit “t*km”.

  Product and waste flows that are typically dealt wit h in volume multiplied
  with distance are measured in the flow property “Volume*length” (e.g.
  product flow / functional unit "Road transport; voluminous goods, generic mix;
  long distance"). Not applicable to elementary flows.
  The unit group is “Units of vo lume*length” with the reference unit
  “m3*km”.

  Person transport product flows / functional units are given in the flow
  property “Person*distance”. Not applicable to elementary flows.
  The unit group is “Units of items*length” with the reference unit
  “Items*km”.

  Flows that are typically dealt with in surface area are measured in the flow
  property “Area” (e.g. elementary flow "Land conversion; XY specification",
  product flow / functional unit "Surface cleaning; heavily soiled, plastic; 1 m2").
  The unit group is “Units of area” with the reference unit “m2”.

  Flows that are typically dealt with in surface area multiplied with time are
  measured in the flow property “Area*time” (e.g. elementary flow "Land
  occupation; XY specification", product flow / functional unit "Façade weather
  protection; exposed, white; 70% reflection").
  The unit group is “Units of area*time” with the reference unit “m2* a”. (1
  year approximated as 365 days)

  --- Page 45 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   35
  Product and waste flows that are typically dealt with in volume multiplied
  with time are measured in the flow property “Volume*time” (e.g. product flow
  / functional unit "Landfill occupation"). Not applicable to elementary flows.
  The unit group is “Units of volume*time” with the reference unit “m3* a”. (1
  year approximated as 365 days)

  For products where the content of specific elements or of well defined
  chemical compounds is of interest, the respective information should be
  given as secondary flow property for conversion, display or modelling
  purposes. T his is done using flow properti es of the type
  “Substance/element X content”, e.g. “Cadmium content”, “Ammonia
  content”, “Water content”, “Methane content” e tc. (Nomenclature for the
  element or substance name should be identical to the one for these
  elements or substances as given elsewhere in this document).
  Depending on the specific interest, the information can be given in mass or
  volume units: E.g . “Iron content” in the product flow “Iron ore, enriched;
  floating …” as mass information or “Methane content” in the product flow
  “Natural gas; …” volumetric. The required “Unit group data set” is then the
  same as already defined “Units of mass” and “Units of volume”, i.e. there is
  no necessity to define new Unit group data sets.

  For product and waste flows where the economic value should b e given
  (typically as secondary flow property for allocation purposes or cost
  calculation in Life Cycle Costing) this is done using the flow property
  “Market value”, which is further specified as required, typically referring to
  the country or region, time  period, and wholesale/retail etc. situation, by
  adding the respective information : E.g. "Market value US 1997, bulk
  prices", "Market value EU 2000, private consumer prices". (Can be used for
  e.g. product / waste / elementary flows "Gold", "Waste tyres", " Carbon dioxide",
  etc.).
  The unit group name is formed by the combination of the string "Units of
  currency" and an addition that characterises the time period to which it
  refers, e.g. "1997", "1990 -1999", "May 1995" etc., e.g. “Units of currency
  1997” with the reference unit “EUR”, i.e. Euro. (Note: The reference to a time
  period is required to allow giving correct average conversion numbers for other
  currencies for that time period).

  Remarks:
  Factors for conversion among different flow properties and uni t systems, e.g.
  between Nm3 and kg for natural gas, or ounces to kg for gold etc. are to be dealt with
  within the databases. To enable that data imported or exported in these reference
  flow properties and units can be appropriately converted all relevant f low properties

  --- Page 46 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   36
  should be given. This topic is hence no issue of this nomenclature, but the inter -
  convertible units for the predefined unit groups of mass, volume etc. are to be
  provided within the flow data sets. In case of the reference flow data sets of the ILCD
  system, this is an item of high priority for future work.

  4.3 Nomenclature for new Flow properties, Unit groups
  and Units
  Rule 26: Mandatory for technical target audience , recommended for non-technical
  target audience : Creation and naming of flow properties, unit groups and
  units:
  The creation/use of new flow properties, unit groups and units should be
  avoided, if possible, and any of the existing ones as provided in the
  upcoming more complete list of the ILCD system should be used.
  If the creation of new flo w properties and unit groups is unavoidable (as to
  be expected e.g. for economic flow properties), they should be named
  following the same pattern as the ones above, i.e. flow properties carry the
  name of the physical or other property, units carry the uni t short as name
  (with the option to provide a long name and further info in the comment
  field foreseen in the data format). Unit groups are named by a combination
  of the string “Units of” and the name of the flow property they refer to.
  Please note, that in some cases it is useful to have common unit groups for
  more than one flow property were all are measured in the same units. In
  such cases the naming can be referred to a more general flow property
  (e.g. “Energy”  “Units of energy”) and not only to one s pecific one (e.g.
  NOT “Units of net calorific value” or “Units of exergy” etc.).

  5 Classification of Contacts
  For easing a structured management of Contact data sets, the following
  hierarchical classification is recommended.
  Rule 27: Recommended for technical and no n-technical target audience :
  classification of contact data sets:
  "Group of organisations, project"
  "Organisations"
   "Private companies"
   "Governmental organisations"
   "Non-governmental organisations"
   "Other organisations"
---

## Chunk Identity

- Source: ILCD Handbook Nomenclature and Other Conventions (2010)
- Source file: `9-MANPROJ-PR-ILCD-Handbook-Nomenclature-and-other-conventions-first-edition-ISBN-fin-v1.0-E.pdf`
- Page range: 40-46
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 40 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 30
4 Classification, nomenclature and assignment of
Flow properties, Unit groups, and Units
Flow properties and units are on one side indi spensable to correctly specify flows
and on the other side one of the most prominent error sources in LCA. Therefore a
clear structure and clear rules are important for error -free LCI work and data
exchange.
Flow properties that are used for flows can be "extensive" (e.g. energy content,
element content, volume, etc.) or "intensive" (e.g. temperature, pressure, etc.). For
calculating and analysing LCI results only extensive properties are of interest (e.g.
the net calorific energy content of all energy res ources are linearly summed up per
reference flow of the modelled product system to yield the primary energy
consumption figure), while intensive properties are often used to specify flows without
using them in subsequent calculations (e.g. temperature and pressure of different
steams as co-products of a process).
Providing all the relevant extensive flow properties with flow data sets eases data
exchange and conversion between different properties and also different unit
systems.
4.1 Classification of Flow properties and Unit groups
There are basically three kinds of flow properties of interest in state-of-the-art LCA:
 Technical flow properties that describe the main physical and technical properties such
as e.g. calorific content,
 chemical composition of fl ows that describe e.g. the elemental composition of the flow
(and not chemical properties why the class name is a bit different than the other two for
better clarity), and
 economic flow properties that describe the economic value of the flow.
For flow properties and unit groups the number of data sets to be expected is too
small to justify a second -level hierarchy, while it should be avoided to have one long
list only. Hence only the three main flow property groups are differentiated as
classes. Even if so ftware tools can internally not store objects in classes, by
exporting them to reports or the ILCD reference format, the assignment to the three
suggested classes is straightforward:
Rule 21: Mandatory for technical target audience , recommended for non-technical
target audience: classification for flow properties:
“Technical flow properties" (e.g. "Net calorific value", "Mass" etc.)
"Chemical composition of flows" (e.g. "Iron content", "Methane content" etc.)
"Economic flow properties” (e.g. "Market value US 1997, b ulk prices", "Market
value EU-27 2008, private consumer prices", etc.)

--- Page 41 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 31
“Other flow properties”
Chemical composition of flows are kept separately from technical flow properties
as the number of data sets in these classes is rather high.
Note: Please note th at there are no " environmental flow properties" or
"environmental unit groups" as for LCIA factors the data set type "LCIA method" was
introduced in the ILCD format. These LCIA method data set type is of a different
quality and needs a quite different and more comprehensive documentation than e.g.
technical flow properties.
Rule 22: Mandatory for technical target audience , recommended for non-technical
target audience: classification of unit groups:
“Technical unit groups" (e.g. "Units of energy", "Units of mass", etc.)
"Economic unit groups" (e.g. "Units of currency 1997", "Units of currency
1998", etc.)
“Other unit groups”
Note that no "Chemical composition unit groups" class is required, as the related
flow properties / LCIA factors will always use technical Unit groups and units (e.g.
mass, volume, etc.). E.g. it will be "kg" Iron content (per given reference unit of
an enriched ore flow, i.e. kg Fe per kg iron ore).
The assignment of year-dependent currency units is required to be able to convert
both among diffe rent units within one currency (e.g. "Euro" and "Euro -cents") and
among currencies while the exchange rates change with time. Together with year -
specific economic flow properties (and the option to further differentiate different
price-levels in different regions and additionally between e.g. bulk trade prices and
consumer prices) a complete automatic conversion is enabled.
A "LCIA method unit group class" (for LCIA method data sets) is not required, as
this will be equally expressed e.g. in kg (i.e. "kg" " CO2-equivalents" for the LCIA
method "Climate Change Potential").
4.2 Names of Flow properties, Unit groups and Units ; their
assignment to Flows
Errors in LCI work and in data exchange occur regularly when differing flow
properties are used, i.e. when gases are measured in mass by the data provider, but
in volume in the receiving database or in net calorific value by one and in upper
calorific value by another. The same type of errors occurs when differing unit
systems or units are used for the same flow such  as mg, g, kg, ounces, pounds,
short tons, bushels etc. for the flow property "mass".
To minimise such errors and to ease an automatic conversion in daily data import
and export, as well as to support readability and acceptance of LCA reports, a
harmonisation is required here as well and rules are to be defined to derive the
underlying properties and units for the reference elementary flow list and data sets.

--- Page 42 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 32
(See also next chapter for naming of new flow properties, Unit groups and Units):
The naming of fl ow properties and units should apply commonly understood names,
often derived from physics. For chemical composition of flows, the chemical names
as used for flow names are to be used; see respective chapter.
For the units themselves common terms, often abbreviations, are to be used, such
as kg, US$, l etc.
Considering the existing realities in LCI and LCIA practice, the following hierarchy
of rules are set for flow properties and units of flows:

Rule 23: Mandatory for technical target audience , recommended for non-technical
target audience: Reference flow properties and reference units for types of
flows, first criterion:
All flows that possess a mass, are measured in the flow property “Mass”,
as long as none of the below rules would require to use a different flo w
property.
The unit group for mass is “Units of mass” with the reference unit “kg”.

Rule 24: Mandatory for technical target audience , recommended for non-technical
target audience: Reference flow properties and reference units for types of
flows, second criterion:
Elementary flows, for which the energy content is the most relevant unit,
are measured in the flow property “Net calorific value”.
The unit group for the net calorific value is “Units of energy” with the
reference unit “MJ”.
Product and waste flows su ch as f uels, in contrast, can be  measured as is
general usage, e.g. in mass (e.g. diesel, hard coal, etc.) , normal volume (e.g.
natural gas) , "Net calorific value" with the unit "MJ" , or other . Note that for
Uranium ore, for which a net calorific value per se can not be given, the usable
fission energy content is expressed nevertheless as "Net calorific value" to ease
aggregation with other fossil energy resources  to primary energy consumption
figures.

Further explanations and discussion:
The reasoning for measuring energy resource elementary flows such as crude oil
in their net calorific value property, is that this allows to use a limited number of crude
oil elementary flows, while fully supporting the energy -related impact assessment of
"Resource depletion". Some existing databases measure crude oil in mass, with the
effect, that each crude oil resource with differing energy content requires an own
elementary flow to properly inventory the non -renewable primary energy
consumption. This so far lead to ext remely many elementary flows in the LCI result
inventories, identically for hard coal and lignite as well as for natural gas resources.

--- Page 43 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 33
Exergy would be - from a scientific point of view - a more appropriate flow property
for elemental flows of energy reso urces, but reality in LCI practice presently speaks
rather against it. Using exergy would however allow to better address energy
resource use as very wet energy carriers such as biomass including e.g. manure
have very low or even negative net (and also upper) calorific content values but can
be converted to biogas with a seemingly positive energy balance, "creating" energy
(or more exactly: net calorific value). At the same time , the property exergy also
works well for all other energy carriers. Difficultie s would arise (to some degree)
when collecting inventory numbers, as very often only the net calorific values are
measured and the exergy value would have to be calculated considering further
information such as especially the water content. This issue is to be further discussed
with industry practitioners and other LCA experts in context of future revisions of the
ILCD methodology.

Rule 25: Mandatory for technical target audience , recommended for non-technical
target audience: Reference flow properties and referen ce units for types of
flows, further criteria:
Product and waste flows that are typically dealt with in standard volume
and for which none of the other units named in this chapter is in use in
practice, are measured in the flow property “Standard volume” (e.g. for the
product flows “Compressed air; 10 bar”, "Oxygen; from refill gas cylinder of 40 l;
150 bar", etc.). Not applicable to elementary flows.
The unit group is “Units of volume” with the reference unit “m3”.

Elementary flows for which the substanc e’s radioactivity is in focus, are
measured in the flow property “Radioactivity” (e.g. elementary flow "thallium-
201").
The unit group is “Units of radioactivity” with the reference unit “kBq”, i.e.
Kilo-Becquerel.

Flows that are typically dealt with in number of items are measured in the
flow property “Number” (e.g. product flows "Spare tyre passenger car; generic
average", "Milk cow; Holstein, alive, start of lactation" etc.).
The unit group is “Units of items” with the reference unit “Item(s)".

Product and waste flows that are typically dealt with in length or distance
are measured in the flow property “Length” (e.g. product flows "Welding
seam; MIG/MAG, steel on steel" and "Water pipe; copper; max 5 bar, 15mm
diameter", etc.). Not applicable to elementary flows.
The unit group is “Units of length” with the reference unit “m”.

--- Page 44 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 34

Product and waste flows that are typically dealt with in duration are
measured in the flow property “Time” (e.g. product flow / functional unit
"Storage in warehouse; unheated"). Not applicable to elementary flows.
The unit group is “Units of time” with the reference unit “d”, i.e. days.

Product and waste flows that are typically dealt with in weight multiplied
with distance are measured in the flow property “Mass* length” (e.g. product
flow / functional unit "Road transport; bulk goods, generic mix; long distance").
Not applicable to elementary flows.
The unit group is “Units of mass*length” with the reference unit “t*km”.

Product and waste flows that are typically dealt wit h in volume multiplied
with distance are measured in the flow property “Volume*length” (e.g.
product flow / functional unit "Road transport; voluminous goods, generic mix;
long distance"). Not applicable to elementary flows.
The unit group is “Units of vo lume*length” with the reference unit
“m3*km”.

Person transport product flows / functional units are given in the flow
property “Person*distance”. Not applicable to elementary flows.
The unit group is “Units of items*length” with the reference unit
“Items*km”.

Flows that are typically dealt with in surface area are measured in the flow
property “Area” (e.g. elementary flow "Land conversion; XY specification",
product flow / functional unit "Surface cleaning; heavily soiled, plastic; 1 m2").
The unit group is “Units of area” with the reference unit “m2”.

Flows that are typically dealt with in surface area multiplied with time are
measured in the flow property “Area*time” (e.g. elementary flow "Land
occupation; XY specification", product flow / functional unit "Façade weather
protection; exposed, white; 70% reflection").
The unit group is “Units of area*time” with the reference unit “m2* a”. (1
year approximated as 365 days)

--- Page 45 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 35
Product and waste flows that are typically dealt with in volume multiplied
with time are measured in the flow property “Volume*time” (e.g. product flow
/ functional unit "Landfill occupation"). Not applicable to elementary flows.
The unit group is “Units of volume*time” with the reference unit “m3* a”. (1
year approximated as 365 days)

For products where the content of specific elements or of well defined
chemical compounds is of interest, the respective information should be
given as secondary flow property for conversion, display or modelling
purposes. T his is done using flow properti es of the type
“Substance/element X content”, e.g. “Cadmium content”, “Ammonia
content”, “Water content”, “Methane content” e tc. (Nomenclature for the
element or substance name should be identical to the one for these
elements or substances as given elsewhere in this document).
Depending on the specific interest, the information can be given in mass or
volume units: E.g . “Iron content” in the product flow “Iron ore, enriched;
floating …” as mass information or “Methane content” in the product flow
“Natural gas; …” volumetric. The required “Unit group data set” is then the
same as already defined “Units of mass” and “Units of volume”, i.e. there is
no necessity to define new Unit group data sets.

For product and waste flows where the economic value should b e given
(typically as secondary flow property for allocation purposes or cost
calculation in Life Cycle Costing) this is done using the flow property
“Market value”, which is further specified as required, typically referring to
the country or region, time  period, and wholesale/retail etc. situation, by
adding the respective information : E.g. "Market value US 1997, bulk
prices", "Market value EU 2000, private consumer prices". (Can be used for
e.g. product / waste / elementary flows "Gold", "Waste tyres", " Carbon dioxide",
etc.).
The unit group name is formed by the combination of the string "Units of
currency" and an addition that characterises the time period to which it
refers, e.g. "1997", "1990 -1999", "May 1995" etc., e.g. “Units of currency
1997” with the reference unit “EUR”, i.e. Euro. (Note: The reference to a time
period is required to allow giving correct average conversion numbers for other
currencies for that time period).

Remarks:
Factors for conversion among different flow properties and uni t systems, e.g.
between Nm3 and kg for natural gas, or ounces to kg for gold etc. are to be dealt with
within the databases. To enable that data imported or exported in these reference
flow properties and units can be appropriately converted all relevant f low properties

--- Page 46 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 36
should be given. This topic is hence no issue of this nomenclature, but the inter -
convertible units for the predefined unit groups of mass, volume etc. are to be
provided within the flow data sets. In case of the reference flow data sets of the ILCD
system, this is an item of high priority for future work.

4.3 Nomenclature for new Flow properties, Unit groups
and Units
Rule 26: Mandatory for technical target audience , recommended for non-technical
target audience : Creation and naming of flow properties, unit groups and
units:
The creation/use of new flow properties, unit groups and units should be
avoided, if possible, and any of the existing ones as provided in the
upcoming more complete list of the ILCD system should be used.
If the creation of new flo w properties and unit groups is unavoidable (as to
be expected e.g. for economic flow properties), they should be named
following the same pattern as the ones above, i.e. flow properties carry the
name of the physical or other property, units carry the uni t short as name
(with the option to provide a long name and further info in the comment
field foreseen in the data format). Unit groups are named by a combination
of the string “Units of” and the name of the flow property they refer to.
Please note, that in some cases it is useful to have common unit groups for
more than one flow property were all are measured in the same units. In
such cases the naming can be referred to a more general flow property
(e.g. “Energy”  “Units of energy”) and not only to one s pecific one (e.g.
NOT “Units of net calorific value” or “Units of exergy” etc.).

5 Classification of Contacts
For easing a structured management of Contact data sets, the following
hierarchical classification is recommended.
Rule 27: Recommended for technical and no n-technical target audience :
classification of contact data sets:
"Group of organisations, project"
"Organisations"
 "Private companies"
 "Governmental organisations"
 "Non-governmental organisations"
 "Other organisations"
