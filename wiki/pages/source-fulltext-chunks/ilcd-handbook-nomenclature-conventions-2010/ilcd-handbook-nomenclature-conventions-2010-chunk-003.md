---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook Nomenclature and Other Conventions (2010) - chunk 003"
nodeId: "ilcd-handbook-nomenclature-conventions-2010-chunk-003"
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
chunkIndex: 3
pageRange: "17-22"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 17 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   7
  For ILCD-compliant LCI data sets , LCA studies  and other ILCD -compliant
  deliverables the "mandatory" rules shall always be met,  while the
  “recommended” ones are only recommended.
  Many rules are differentiated for technical audience (e.g. applicable to LCI data
  sets) and non-technical audience (e.g. applicable to Executive summary of LCA
  studies).
  Please note that the following nomenclature rule s partly stand in relationship to
  methodological recommendations  and requirements  on LCI and LCIA work (e.g.
  "How to inventory renewable resource flows?"). These method -related provisions are
  part of the separate ILCD Handbook document "General guide for L ife Cycle
  Assessment".
  2 Classification / categorisation of flows
  2.1 Classification / categorisation of elementary flows
  The main c ategorisation of elementary flows found in LCA practice is done
  according to the main receiving / providing environmental compartm ent, as far as
  relevant from LCIA perspective. In fact , is this class information part of the flow -
  identifying information, i.e. it is indispensable.
  As an additional, independent and not flow -identifying classification, the
  classification by substance -type is often used and also suggested here  as an
  additional, independent classification of the flows and in  support of an efficient LCI
  work.
  Both can be used in LCA software tools separately or combined to provide their
  users an efficient, structured access to the data sets.
  2.1.1 Classification / categorisation according to
  (sub)compartment of receiving / providing environment
  The smallest denominator for the top -level elementary flow categorisation found in
  the SETAC Code of Life Cycle Inventory Practice of 2001 refers to the main receiving
  environmental compartment (for emissions) and providing environmental
  compartment (for resources). ISO 14044 names "emissions to air, water and soil" as
  top-level classification, while recommending further differentiation as required for the
  given goal and scope of the LCA work.
  In between, LCIA methods that differentiate between fresh water and sea water as
  well as between industrial soil and agricultural soil are well established and reflected
  in several widely used database s, i.e. the practice has further developed.
  Nevertheless, the wider default option s “Water” and “Soil” should still be provided ,
  given inventory data availability.

  --- Page 18 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   8
  While resource-depletion methods do not differentiate the providing environment,
  a differen tiation for practical reasons seems useful . Overall, the structure of the
  elementary flows was adjusted as shown below.
  Regarding the naming rules for the categories and sub-categories it is important to
  ensure that together with the flow names the identif ication especially of elementary
  flows is unique: for these the "category plus sub-category" information is part of the
  identifying information. For this reason the "resource" and "emission" aspect of at
  least either the class or the sub -category has alway s to be part of its name (i.e.
  "Emissions to water" and not only "Water", as in that case the emission could be
  misinterpreted as a resource flow). To strengthen this clarity, the c ategory/sub-
  category information is part of the flow data set attributes in  the ILCD reference
  format and not "only" determined by the folder where the data set is placed.  As the
  category name is clear on each level, it can be implemented also as flat structure,
  only using the lowest level name, i.e. without the need to create se veral hierarchy
  levels. As the number of c ategories is still quite limited, all can be displayed in one
  view and without resulting in ambiguities.
  This structure is set as mandatory to support easy data exchange among
  practitioners and to limit errors, sin ce characterisation factors of most existing
  methods refer to this specification of the environment.
  Rule 2: Mandatory for both technical and non-technical target audience: "elementary
  flow categories" by receiving / providing environmental compartment:
   Resources - Resources from ground
   Resources - Resources from water
   Resources - Resources from air
   Resources – Resources from biosphere
   Land use – Land transformation
   Land use – Land occupation
   Emissions – Emissions to air - Emissions to air, unspecified
   Emissions – Emissions to air - Emissions to air, unspecified (long-term)
   Emissions – Emissions to air - Emissions to urban air close to ground
   Emissions – Emissions to air - Emissions to non -urban air or from high
  stacks
   Emissions – Emissions to air - Emissions to lower stratosphere and upper
  troposphere
   Emissions – Emissions to water - Emissions to water, unspecified
   Emissions – Emissions to water - Emissions to water, unspecified (long -
  term)
   Emissions – Emissions to water - Emissions to fresh water
   Emissions – Emissions to water - Emissions to sea water

  --- Page 19 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   9
   Emissions – Emissions to soil - Emissions to soil, unspecified
   Emissions – Emissions to soil - Emissions to agricultural soil
   Emissions – Emissions to soil - Emissions to non-agricultural soil
   Emissions – Emissions to soil - Emissions to soil, unspecified (long-term)
   Other elementary flows
  Note: long-term = emissions occurring over 100 years in future – in practice
  exclusively from waste deposits. Emissions within 100 years from the
  represented year are hence to be inv entoried in the other categories without
  the “... (long-term)” in the name.
  To account for the substantial different uncertainty/ "unknowability" of how future
  societies will deal with the waste deposits that we create today, long -term emissions
  beyond 100 years should be inventories separately. The only two practically relevant
  cases are emissions to air and to water from waste deposits, why only these two
  long-term emission compartments are added:
  Further discussion/explanations and need for a potential fu rther
  differentiation: From an LCIA perspective, the above classification – while widely
  used – has some points to be mentioned and well understood. Some others will need
  methodological clarification. Also, partly the need may arise to expand the
  categorisation in future:
  Air:
  The compartments "Emissions to urban air close to ground" and "Emissions to
  non-urban air or from high stacks" will need an appropriate and practical definition, as
  to what is meant by "urban" (practical definition to be derived by ap proximate
  population density) and what is meant by "close to ground" / "from high stacks" (e.g.
  such as all emissions that occur below respectively above the bottom layer of 40 m).
  "Emissions to lower stratosphere and upper atmosphere" is of relevance only  for a
  very limited number of certain emissions from air plane combustion engines, such as
  CO2. Very few elementary flows will have to be put into that c ategory, avoiding
  thereby to unnecessarily blowing up the number of flow data sets.
  "Emissions to indoo r air" may need to be considered separately , when LCIA
  methods and factors becomes available.
  Water:
  Fresh water is very diverse and brackish water as well as fresh water close to the
  sea is not addressed by dedicated LCIA factors, while in such locations  many
  industrial complexes and mayor cities are located, i.e. such emission situations are
  frequent.
  Rule 3: Recommended for both technical and non -technical target audience :
  Splitting emissions to brackish water:
  If an emission into brackish water appears, the am ount of emissions
  should be split into a 50% share of emission to seawater and 50% to
  freshwater.

  --- Page 20 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   10

  Soil:
  Direct emissions to non-agricultural soil are rather infrequent and of relevance in
  LCA mainly for persistent organics and heavy metals that stay and act in the soil for a
  longer period of time. All field management input into soil (e.g. fertiliser) that leaves it,
  possibly after conversion to other substances, to groundwater or air is to be modelled
  as such, while not as emission to soil. See also the related provisions in the "General
  guidance document on LCA"
  Emissions to agricultural soil cover emissions to soil in all sites that are under
  agriculture for at least some intermitting periods for food or fodder production, i.e. not
  forestry soils, not industrial sites, but sites for cropping of renewable raw -materials in
  non-permanent agriculture (as these are typically cropped in alternation with food
  and fodder) and also gardens (as also here a certain share of food production can be
  assumed).
  2.1.2 Discussion of a possible further differentiation of receiving /
  providing environment
  A further differentiation of the receiving / providing environmental compartments
  has to be discussed from both LCI and LCIA perspective: From LCIA perspective the
  clear need for  such a differentiation was already identified for some compartments
  and a number of substances. However, dedicated impact factors derived with
  comparable approaches for a similar range of substances, and resulting in the
  required robustness as for the mai n compartments are not yet available. From LCI
  side, a further differentiation would result in problems of data availability and of
  enlarging the elementary flow content of life cycle inventories, increasing the effort for
  handling and error -checking the d ata and reporting. At the same time , it would
  increase the reliability of the results, better reflecting reality.
  In conclusion and reflecting on presently available LCIA factors and LCI data, no
  further sub -compartments are supported for ILCD -compliant L CI data sets for the
  time being, while in LCA studies reports such can be used, as appropriate (see also
  related requirements in the "General guide on LCA" document, in the respective
  scope chapter on preparing the basis for the Life Cycle Impact Assessmen t). A clear
  need for research and development is highlighted:
  Rule 4: Mandatory for technical target audience , recommended for non-technical
  target audience: Further differentiation of providing/receiving environmental
  compartments
  Further differentiated receiving / providing environmental compartments
  below the compartments defined more above  shall presently not be
  used.

  Ongoing discussions: For further sub-compartments, three different approaches
  are in use in mayor LCA databases and tools:

  --- Page 21 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   11
   No further differentiation. This is practice in most cases.
   Further differentiation of the receiving environment into sub -compartments
  (e.g. "Emissions to groundwater") or the emission -situation / site -type (e.g.
  "Emission to indoor air"). In use by few database developers.
   Further differentiation of the elementary flows according to the country or
  region where the emission occurs (e.g. "Emission to air, Spain") or into sub-
  sub-compartments (e.g. "Emission to deep groundwater"), or the
  country/region where a resource is ente ring the technosphere (e.g. "Crude
  oil from Lybia"). Each of these is in use by few database developers.
  The two latter differentiations above are independent from each other. Both have
  certain advantages and disadvantages : The advantages are that they pro vide a
  further detailed inventory that allows in  principle for more differentiated analysis
  including impact assessment.  It is  argued that the  disadvantages outweigh the
  advantages: the lack or limited availability of related LCIA factors, the lack of
  accordingly differentiated LCI data, and a correspondingly much larger number  of
  elementary flows (beyond the already defined 19000+) to handle and quality control
  are to be named. For these reasons, no further differentiation of the receiving /
  providing environmental compartments is foreseen so far.
  The ILCD reference format nevertheless allows working with any of the above
  differentiations: The country/region information of elementary flows can be stored in
  the individual Input and Output flows in the Proce ss or LCI result data set, and can
  also be entered directly in the flow data set, resulting in a different data set object,
  while such flow data sets are not permissible for ILCD-compliant LCI data sets and
  other deliverables for technical target audience . Also a differentiation into further
  environmental sub -compartments can be done be defining own hierarchical
  elementary flow categories ; this is technically supported. Please note, that the
  resulting elementary flow data sets would not be ILCD-compliant.
  Further joint LCI and LCIA expertise is required to develop an appropriate and
  practical solution for this issue , which would be developed subsequently and
  reflected in a future revision of this document.
  2.1.3 Classification according to substance -type of elem entary
  flow
  Building on the recommended classification and structure of the former SETAC
  WG on Data Availability and Quality of 2001 , also here a substance -type-based
  classification is suggested as additional, independent and NON -identifying
  classification. In the ILCD reference format and for Emissions it is implemented as
  "Classification", for Resources it is part of the "elementaryFlowCategory"
  As resources and emissions require in practice a different substance -type based
  classification, these are addre ssed separately. The one for resources is hence
  foreseen for use as sub -classification under the "Resources"

  --- Page 22 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   12
  elementaryFlowCategory, the one for emissions as independent "Classes" for each
  of the "Emissions to ..." "elementaryFlowCategory".
  2.1.3.1 Substance-type based classification for resources
  The following classification is suggested for resource flows.
  Rule 5: Mandatory for technical target audience , re commended for non-technical
  target audience : additional, non -identifying classification for "Resources
  from ground" elementary flows (example flows in brackets ; if no example is
  given this means that this class will probably not be used actively):
   “Non-renewable material resources  from ground” (e.g. "Sand", "Anhydrite;
  100%", etc.)
   “Non-renewable element resources  from ground ” (e.g. "Gold", "Copper",
  etc.)
   “Non-renewable energy resources  from ground ” (e.g. "Hard coal; 32.7
  MJ/kg net calorific value", "Uranium; natural isotope mix; 451000 MJ/kg", etc.)
   “Renewable element resources from ground ” (e.g. "Radon", etc.)
   “Renewable energy resources  from ground ” (e.g. "Wind energy", "Water
  energy; running", etc.)
   "Renewable material resources from ground"
   “Renewable r esources from ground, unspecified”  (for renewable resource
  elementary flows from ground that do not fit into any of the other categories)
   “Non-renewable resources from ground, unspecified”  (for non -renewable
  resource elementary flows from ground that do not fit into any of the other
  categories)
  Please note, that for several resources the "function" of the resource ( e.g. the
  above listed example of uranium ore as energy carrier) is dominating the chemical
  "element" character of the uranium. Or, in other words: the classification is to a small
  but certain degree ambiguous. The few cases however, in which the possibilit y for
  different classification exist, are justified by the large majority of cases, where the
  user much easier finds the required flow compared to other classification schemes.

  Rule 6: Mandatory for technical target audience , recommended for non-technical
  target audience: additional, non -identifying classification of "Resources
  from water"  elementary flows (example flows in brackets ; if no example is
  given this means that this class will probably not be used actively):
   “Non-renewable element resources from water” (e.g. Magnesium, Bromium,
  Hydrogen etc.)
   “Non-renewable material resources from water”
   “Non-renewable energy resources from water”
   “Renewable element resources from water”
---

## Chunk Identity

- Source: ILCD Handbook Nomenclature and Other Conventions (2010)
- Source file: `9-MANPROJ-PR-ILCD-Handbook-Nomenclature-and-other-conventions-first-edition-ISBN-fin-v1.0-E.pdf`
- Page range: 17-22
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 17 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 7
For ILCD-compliant LCI data sets , LCA studies  and other ILCD -compliant
deliverables the "mandatory" rules shall always be met,  while the
“recommended” ones are only recommended.
Many rules are differentiated for technical audience (e.g. applicable to LCI data
sets) and non-technical audience (e.g. applicable to Executive summary of LCA
studies).
Please note that the following nomenclature rule s partly stand in relationship to
methodological recommendations  and requirements  on LCI and LCIA work (e.g.
"How to inventory renewable resource flows?"). These method -related provisions are
part of the separate ILCD Handbook document "General guide for L ife Cycle
Assessment".
2 Classification / categorisation of flows
2.1 Classification / categorisation of elementary flows
The main c ategorisation of elementary flows found in LCA practice is done
according to the main receiving / providing environmental compartm ent, as far as
relevant from LCIA perspective. In fact , is this class information part of the flow -
identifying information, i.e. it is indispensable.
As an additional, independent and not flow -identifying classification, the
classification by substance -type is often used and also suggested here  as an
additional, independent classification of the flows and in  support of an efficient LCI
work.
Both can be used in LCA software tools separately or combined to provide their
users an efficient, structured access to the data sets.
2.1.1 Classification / categorisation according to
(sub)compartment of receiving / providing environment
The smallest denominator for the top -level elementary flow categorisation found in
the SETAC Code of Life Cycle Inventory Practice of 2001 refers to the main receiving
environmental compartment (for emissions) and providing environmental
compartment (for resources). ISO 14044 names "emissions to air, water and soil" as
top-level classification, while recommending further differentiation as required for the
given goal and scope of the LCA work.
In between, LCIA methods that differentiate between fresh water and sea water as
well as between industrial soil and agricultural soil are well established and reflected
in several widely used database s, i.e. the practice has further developed.
Nevertheless, the wider default option s “Water” and “Soil” should still be provided ,
given inventory data availability.

--- Page 18 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 8
While resource-depletion methods do not differentiate the providing environment,
a differen tiation for practical reasons seems useful . Overall, the structure of the
elementary flows was adjusted as shown below.
Regarding the naming rules for the categories and sub-categories it is important to
ensure that together with the flow names the identif ication especially of elementary
flows is unique: for these the "category plus sub-category" information is part of the
identifying information. For this reason the "resource" and "emission" aspect of at
least either the class or the sub -category has alway s to be part of its name (i.e.
"Emissions to water" and not only "Water", as in that case the emission could be
misinterpreted as a resource flow). To strengthen this clarity, the c ategory/sub-
category information is part of the flow data set attributes in  the ILCD reference
format and not "only" determined by the folder where the data set is placed.  As the
category name is clear on each level, it can be implemented also as flat structure,
only using the lowest level name, i.e. without the need to create se veral hierarchy
levels. As the number of c ategories is still quite limited, all can be displayed in one
view and without resulting in ambiguities.
This structure is set as mandatory to support easy data exchange among
practitioners and to limit errors, sin ce characterisation factors of most existing
methods refer to this specification of the environment.
Rule 2: Mandatory for both technical and non-technical target audience: "elementary
flow categories" by receiving / providing environmental compartment:
 Resources - Resources from ground
 Resources - Resources from water
 Resources - Resources from air
 Resources – Resources from biosphere
 Land use – Land transformation
 Land use – Land occupation
 Emissions – Emissions to air - Emissions to air, unspecified
 Emissions – Emissions to air - Emissions to air, unspecified (long-term)
 Emissions – Emissions to air - Emissions to urban air close to ground
 Emissions – Emissions to air - Emissions to non -urban air or from high
stacks
 Emissions – Emissions to air - Emissions to lower stratosphere and upper
troposphere
 Emissions – Emissions to water - Emissions to water, unspecified
 Emissions – Emissions to water - Emissions to water, unspecified (long -
term)
 Emissions – Emissions to water - Emissions to fresh water
 Emissions – Emissions to water - Emissions to sea water

--- Page 19 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 9
 Emissions – Emissions to soil - Emissions to soil, unspecified
 Emissions – Emissions to soil - Emissions to agricultural soil
 Emissions – Emissions to soil - Emissions to non-agricultural soil
 Emissions – Emissions to soil - Emissions to soil, unspecified (long-term)
 Other elementary flows
Note: long-term = emissions occurring over 100 years in future – in practice
exclusively from waste deposits. Emissions within 100 years from the
represented year are hence to be inv entoried in the other categories without
the “... (long-term)” in the name.
To account for the substantial different uncertainty/ "unknowability" of how future
societies will deal with the waste deposits that we create today, long -term emissions
beyond 100 years should be inventories separately. The only two practically relevant
cases are emissions to air and to water from waste deposits, why only these two
long-term emission compartments are added:
Further discussion/explanations and need for a potential fu rther
differentiation: From an LCIA perspective, the above classification – while widely
used – has some points to be mentioned and well understood. Some others will need
methodological clarification. Also, partly the need may arise to expand the
categorisation in future:
Air:
The compartments "Emissions to urban air close to ground" and "Emissions to
non-urban air or from high stacks" will need an appropriate and practical definition, as
to what is meant by "urban" (practical definition to be derived by ap proximate
population density) and what is meant by "close to ground" / "from high stacks" (e.g.
such as all emissions that occur below respectively above the bottom layer of 40 m).
"Emissions to lower stratosphere and upper atmosphere" is of relevance only  for a
very limited number of certain emissions from air plane combustion engines, such as
CO2. Very few elementary flows will have to be put into that c ategory, avoiding
thereby to unnecessarily blowing up the number of flow data sets.
"Emissions to indoo r air" may need to be considered separately , when LCIA
methods and factors becomes available.
Water:
Fresh water is very diverse and brackish water as well as fresh water close to the
sea is not addressed by dedicated LCIA factors, while in such locations  many
industrial complexes and mayor cities are located, i.e. such emission situations are
frequent.
Rule 3: Recommended for both technical and non -technical target audience :
Splitting emissions to brackish water:
If an emission into brackish water appears, the am ount of emissions
should be split into a 50% share of emission to seawater and 50% to
freshwater.

--- Page 20 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 10

Soil:
Direct emissions to non-agricultural soil are rather infrequent and of relevance in
LCA mainly for persistent organics and heavy metals that stay and act in the soil for a
longer period of time. All field management input into soil (e.g. fertiliser) that leaves it,
possibly after conversion to other substances, to groundwater or air is to be modelled
as such, while not as emission to soil. See also the related provisions in the "General
guidance document on LCA"
Emissions to agricultural soil cover emissions to soil in all sites that are under
agriculture for at least some intermitting periods for food or fodder production, i.e. not
forestry soils, not industrial sites, but sites for cropping of renewable raw -materials in
non-permanent agriculture (as these are typically cropped in alternation with food
and fodder) and also gardens (as also here a certain share of food production can be
assumed).
2.1.2 Discussion of a possible further differentiation of receiving /
providing environment
A further differentiation of the receiving / providing environmental compartments
has to be discussed from both LCI and LCIA perspective: From LCIA perspective the
clear need for  such a differentiation was already identified for some compartments
and a number of substances. However, dedicated impact factors derived with
comparable approaches for a similar range of substances, and resulting in the
required robustness as for the mai n compartments are not yet available. From LCI
side, a further differentiation would result in problems of data availability and of
enlarging the elementary flow content of life cycle inventories, increasing the effort for
handling and error -checking the d ata and reporting. At the same time , it would
increase the reliability of the results, better reflecting reality.
In conclusion and reflecting on presently available LCIA factors and LCI data, no
further sub -compartments are supported for ILCD -compliant L CI data sets for the
time being, while in LCA studies reports such can be used, as appropriate (see also
related requirements in the "General guide on LCA" document, in the respective
scope chapter on preparing the basis for the Life Cycle Impact Assessmen t). A clear
need for research and development is highlighted:
Rule 4: Mandatory for technical target audience , recommended for non-technical
target audience: Further differentiation of providing/receiving environmental
compartments
Further differentiated receiving / providing environmental compartments
below the compartments defined more above  shall presently not be
used.

Ongoing discussions: For further sub-compartments, three different approaches
are in use in mayor LCA databases and tools:

--- Page 21 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 11
 No further differentiation. This is practice in most cases.
 Further differentiation of the receiving environment into sub -compartments
(e.g. "Emissions to groundwater") or the emission -situation / site -type (e.g.
"Emission to indoor air"). In use by few database developers.
 Further differentiation of the elementary flows according to the country or
region where the emission occurs (e.g. "Emission to air, Spain") or into sub-
sub-compartments (e.g. "Emission to deep groundwater"), or the
country/region where a resource is ente ring the technosphere (e.g. "Crude
oil from Lybia"). Each of these is in use by few database developers.
The two latter differentiations above are independent from each other. Both have
certain advantages and disadvantages : The advantages are that they pro vide a
further detailed inventory that allows in  principle for more differentiated analysis
including impact assessment.  It is  argued that the  disadvantages outweigh the
advantages: the lack or limited availability of related LCIA factors, the lack of
accordingly differentiated LCI data, and a correspondingly much larger number  of
elementary flows (beyond the already defined 19000+) to handle and quality control
are to be named. For these reasons, no further differentiation of the receiving /
providing environmental compartments is foreseen so far.
The ILCD reference format nevertheless allows working with any of the above
differentiations: The country/region information of elementary flows can be stored in
the individual Input and Output flows in the Proce ss or LCI result data set, and can
also be entered directly in the flow data set, resulting in a different data set object,
while such flow data sets are not permissible for ILCD-compliant LCI data sets and
other deliverables for technical target audience . Also a differentiation into further
environmental sub -compartments can be done be defining own hierarchical
elementary flow categories ; this is technically supported. Please note, that the
resulting elementary flow data sets would not be ILCD-compliant.
Further joint LCI and LCIA expertise is required to develop an appropriate and
practical solution for this issue , which would be developed subsequently and
reflected in a future revision of this document.
2.1.3 Classification according to substance -type of elem entary
flow
Building on the recommended classification and structure of the former SETAC
WG on Data Availability and Quality of 2001 , also here a substance -type-based
classification is suggested as additional, independent and NON -identifying
classification. In the ILCD reference format and for Emissions it is implemented as
"Classification", for Resources it is part of the "elementaryFlowCategory"
As resources and emissions require in practice a different substance -type based
classification, these are addre ssed separately. The one for resources is hence
foreseen for use as sub -classification under the "Resources"

--- Page 22 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 12
elementaryFlowCategory, the one for emissions as independent "Classes" for each
of the "Emissions to ..." "elementaryFlowCategory".
2.1.3.1 Substance-type based classification for resources
The following classification is suggested for resource flows.
Rule 5: Mandatory for technical target audience , re commended for non-technical
target audience : additional, non -identifying classification for "Resources
from ground" elementary flows (example flows in brackets ; if no example is
given this means that this class will probably not be used actively):
 “Non-renewable material resources  from ground” (e.g. "Sand", "Anhydrite;
100%", etc.)
 “Non-renewable element resources  from ground ” (e.g. "Gold", "Copper",
etc.)
 “Non-renewable energy resources  from ground ” (e.g. "Hard coal; 32.7
MJ/kg net calorific value", "Uranium; natural isotope mix; 451000 MJ/kg", etc.)
 “Renewable element resources from ground ” (e.g. "Radon", etc.)
 “Renewable energy resources  from ground ” (e.g. "Wind energy", "Water
energy; running", etc.)
 "Renewable material resources from ground"
 “Renewable r esources from ground, unspecified”  (for renewable resource
elementary flows from ground that do not fit into any of the other categories)
 “Non-renewable resources from ground, unspecified”  (for non -renewable
resource elementary flows from ground that do not fit into any of the other
categories)
Please note, that for several resources the "function" of the resource ( e.g. the
above listed example of uranium ore as energy carrier) is dominating the chemical
"element" character of the uranium. Or, in other words: the classification is to a small
but certain degree ambiguous. The few cases however, in which the possibilit y for
different classification exist, are justified by the large majority of cases, where the
user much easier finds the required flow compared to other classification schemes.

Rule 6: Mandatory for technical target audience , recommended for non-technical
target audience: additional, non -identifying classification of "Resources
from water"  elementary flows (example flows in brackets ; if no example is
given this means that this class will probably not be used actively):
 “Non-renewable element resources from water” (e.g. Magnesium, Bromium,
Hydrogen etc.)
 “Non-renewable material resources from water”
 “Non-renewable energy resources from water”
 “Renewable element resources from water”
