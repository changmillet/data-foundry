---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook General Guide for LCA Detailed Guidance (2010) - chunk 062"
nodeId: "ilcd-handbook-general-guide-detailed-guidance-2010-chunk-062"
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
chunkIndex: 62
pageRange: "297-301"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 297 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  8 Life Cycle Impact Assessment - calculating LCIA results  277
  document "Framework and requirements for Life Cycle Impact Assessment (LCIA) models
  and indicators" on the development  and selection of Life Cycle Impact Assessment models
  and factors.
  In LCA practice, these steps are not regularly done by LCA practitioners, but this is part of
  the work towards developing LCIA methods . The practitioner is however responsible to
  ensure that the inventory elem entary flows are correctly linked with the LCIA factors  (see
  more below) and - together with LCIA experts - to derive or develop missing impact factors if
  potentially relevant for the study (details see chapter 6.7.4).
  The resu lting characterized indicator results can be summed up within each impact
  category. The resulting collection of aggregated indicator results is the characterized impact
  profile of the product, i.e. its LCIA results.
  No comparison across impact categories
  As the LCIA results per impact category have different units, they cannot directly be
  compared to identify which are most relevant. Equally it cannot be summed up.
  Ensure a correct link between inventory and impact factors
  Databases within LCA software typically provide elementary flows that have been
  classified and characterised and thereby “linked” with the LCIA methods. The practitioner is
  however responsible to ensure that the inventory elementary flows are correctly linked with
  the LCIA factors. This in any case applies for elementary flows that were added by the
  practitioner during data collection and for  newly applied LCIA methods. The work of correctly
  linking inventory and impact factors is  supported by using the same nomenclature and flow
  data sets, e.g. the ILCD nomenclature and related reference elementary flows.
  Frequent errors: Incomplete LCIA factor assignment to elementary flows
  In LCA databases of di verse origins of the data (e .g. combined by the software/database
  provider or growing over the years at the practitioner) typically have a number of elementary
  flows that should carry a characterisation factor in the covered LCIA methods, but don‟t have
  it assigned. That means the impact assessment is incomplete and – depending on the
  relevancy o f the gaps – leads to wrong results and conclusions. Some of the main
  “candidates” for such omissions and possible solutions 189 are as follows . The related
  provisions are found in the referenced chapters (here below the provision status is given only
  for orientation):
  - Combined ores (e.g. “Lead -zinc ore; 2.5  % Pb, 1.8  % Zn " as "Resources from
  ground” that were created by the practitioner or imported from the database
  developers). Possible solution:
  ° a) (not permissible 190:) Calculate the resource depletion fact ors of the single
  elements, scale them to the respective element contents of the flow, sum them up
  and assign the resulting factor to that flow.
  ° b) (shall:) Avoid specific ore resource flows by splitting the ore flow up into the

  189 These cases and possible solutions have been considered and are in line with the ILCD „Nomenclature and
  other conventions“ guidance, the chapter on ove rarching methodological issues (annex 7.4.3) and are
  implemented in the related ILCD reference elementary flows.
  190 "not permissible" refers here to reporting for external use, as the respective flows would not meet the
  provisions of the "Nomenclature and other provisions" (see separate document) and/or the "Overarching method
  provisions for specific elementary flow types" (see chapter 7.4.3).

  --- Page 298 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  8 Life Cycle Impact Assessment - calculating LCIA results  278
  flows of the contained che mical elements and use the respective elementary
  flows that already have impact factors assigned (i.e. for the above example to
  “Lead" as "Resources from ground” and “Zinc" as "Resources from ground” and a
  complementary "Inert rock" as "Resources from grou nd” for the mass balance.)
  Note that for some ores the compound may need to be inventoried (e.g. Rock salt
  (NaCl); details see chapter 7.4.3.6.2.
  - Composed emissions such as e.g. salts (e.g. Ammonium nitrate,  while
  characterisation factors exist for the contained ions Ammonium and Nitrate ).
  Possible solution:
  ° a) (not permissible:) Calculate the correct factor stoichiometrically (or other
  method, as appropriate) and assign to the flow.
  ° b) (shall:) Inventory the components as separate elementary flows (e.g.
  "Ammonium" and "Nitrate"  for the above example) . See also chapter 7.4.3.3 on
  when to split elementary flows of salts depending on their water solubility.
  - Process-type specific (composed) emissions such as “Diesel engine off -gas” etc.,
  which cannot be usefully addressed in impact assessment and which typically have
  no impact factor at all and that shall not remain in the inventory. Possible solution:
  ° a) (should:) Inventory the specific substances emitted if data is available or
  ° b) (may) Estimate the composition by using technology -specific information on
  emission-composition or default break -down tables (documenting assumptions
  made) and inventory the individual substances emitted.
  - Newly user-created flows of e.g. emissions that even may have a factor in the used
  LCIA method but that were not provided with the LCA database package  or
  software. Possible solution:
  ° First check whether the package is complete; obtain the missing factors. For flows
  that were newly created by the user , it should be verified that it is not actually an
  existing flow but named with an e.g. trivial name or an alternative chemical name.
  CAS numbers help in verifying this.
  - Emissions to sub-compartments or at specific locations for which no specific impact
  factor is available. Possible solution:
  ° a) (recommended) Avoid use of such flows unless specific factors are available in
  the applied LCIA method for all quantitatively relevant elementary flows, or
  ° b) (shall) Assign the impact factor of the same elementary flow of the parent
  compartment (e.g. the impact factor for "Nitrate" as "Emissions to freshwater" is
  also assigned to "Nitrate" as "Emissions to lakes") . See the separate document
  "Nomenclature and other conventions" for applicable default compartments.
  - Sum-indicators such as “Metals”  and measured indicators,  which cannot be usefully
  addressed in impact assessment and which typically have no impact factor at all  and
  that shall not remain in the inventory. Possible solution:
  ° a) (should) Inventory the individual substances (e.g. for the sum-indicator "Metals"
  the individual "Lead", "Iron", etc. metals), if composition information is available,
  or
  ° b) (may) Estimate the composition  by using tec hnology-specific information on

  --- Page 299 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  8 Life Cycle Impact Assessment - calculating LCIA results  279
  emission-composition or default break -down tables (documenting assumptions
  made) and inventory the individual substances emitted.  See chapter 7.4.3.2 for
  permissible sum-indicators.
  - Unspecified “Biomass”, “Renewable energy”, “Unspecified emissions”, etc.
  elementary flows. Possible solution:
  ° a) (should) Inventory the individual components if data is available, or
  ° b) (may) Estimate the composition by using technology -specific info rmation on
  composition or default break -down tables or a typical generic case (documenting
  assumptions made) and inventory the individual substances emitted.
  Note: Check also whether the respective flow is potentially relevant (along process -specific
  worst-case assumptions) and remove it from the inventory if clearly not relevant in line with
  the applied cut-off rules.
  Additional, modified, or non-generic / differentiated LCIA methods
  As already mentioned in chapter 6.7, in cas e the inventory work reveals the need to
  address additional impacts that where not originally considered, the respective scope step
  has to be revised.  In summary: If a characterisation factor is missing for an elementary flow
  in the inventory, which is kno wn to contribute to an impact category, its  potential importance
  should be checked . If the contribution from the elementary flow is found to be potentially
  significant, an attempt should be made to estimate the missing characterisation factor, and if
  this is not possible, the fact of a potentially  relevant missing characterisation factor must be
  reported, and the potential influence of the missing factor must be considered in the
  interpretation of the results.
  Normalisation and weighting necessary?
  The decision of inclusion/exclusion of normalisation and weighting shall have been made
  and documented in the initial scope definition  (see chapter 6.7.7). Note that normalisation
  and weighting may be required as interim step for defi ning the quantitative cut -off rules (see
  chapter 6.6.3) and for checking the achieved completeness of the inventory (see chapter
  9.3.2); this depends on the chosen approach for implementing the cut -off rules . If used
  exclusively for this purpose, the respective normalised and weighted figures are not staying
  in the data set or report.
  In comparisons without normalisation and weighting, LCIA results of the different impact
  categories or damages/areas -of-protection may point to different directions, i.e. for different
  impact categories not always the alternative product performs best. However, if the study is
  intended to support a comparative assertion to be disclosed to the public, no form of
  numerical, value -based weighting of the indicator results is permitted to be published in
  accordance with ISO 14040 and 14044:2006.
  For in-house purposes, the use of normalisation and weighting – preferably using several
  different approaches and value perspectives - can help to demonstrate the robustness of the
  analysis.
  If in contrast all impact indicators point into the same direction, t he LCIA results can
  already be the basis for interpretation phase of the LCA, including for comparative studies,
  clearly identifying a superior alternative (or, in case of limited significance of the differences,
  identifying equality of the compared alternatives).

  --- Page 300 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  8 Life Cycle Impact Assessment - calculating LCIA results  280
  Provisions: 8.2 Calculation of LCIA results
  Note that this provision applies to all types of deliverables of the study , while for unit process, partly terminated
  system and LCI results data sets as deliverables only to quantify the achieved completeness  and precision, as
  they needs to be evaluated from the system's perspective.
  Note: If third-party LCIA methods are used  that correctly provide characterisation factors for all used elementary
  flows, the first two following provisions mean to exclusively control that this has been done correctly. For any
  newly created elementary flow however, the characterisation factor has  to be assigned and/or developed (see
  also chapter 6.7.4):
  I) SHALL - Classification of elementary flows:  All elementary flows of the inventory
  shall be assigned to those one or more impact categories to which the y contribute
  (“classification”) and that were selected for the impact assessment in the scope
  definition of the study.
  II) SHALL - Characterisation of elementary flows:  To all classified elementary flows
  each one quantitative characterisation factor shall be  assigned for each category to
  which the flow relevantly contributes ("characterisation"). That factor expresses how
  much that flow contributes to the impact category indicator (at midpoint level) or
  category endpoint indicator (at endpoint level). For mid point level indicators this relative
  factor typically relates to a reference flow (e.g. it may be expressed in "kg CO 2-
  equivalents" per kg elementary flow in case of Global Warming Potential) . For endpoint
  level indicators it typically relates to a specifi c damage that relates to the broader area
  of protection.  Examples are e.g. species loss measured e.g. as potentially displaced
  fraction of species for an affected area and duration (pdf*m 2*a), or damage to Human
  health measured e.g. in Disability Adjusted Life Years (DALYs) . (For terms and details
  refer to the separate document "Framework and requirements for Life Cycle Impact
  Assessment (LCIA) models and indicators").
  III) SHALL - Calculate LCIA results per impact category:  For each impact category
  separately, calculate the LCIA indicator results by multiplying 191 the amount of each
  contributing (i.e. classified) elementary flow of the inventory with its characterisation
  factor. The results may be summed up per impact category, but summing up shall not
  be done across impact categories.
  Note that this is done with either the midpoint level (impact potential) or the endpoint level (damage)
  factors, as had to be decided in scope chapter 6.7.7.
  IV) SHALL - Separately calculate LCIA results of long -term emissions: LCIA results of
  long-term emissions (i.e. beyond 100 years from the time of the study) shall be
  calculated separately from the LCIA results that relate to interventions that occur within
  100 years from the time of study. [ISO!]
  Note: Given the different extent of uncertainty, these two sets of results will later be presented separately
  while discussed jointly.
  V) SHALL - Separately calculate non -generic LCIA results, if included: In the case
  additional or modified, non-generic (e.g. geographically or otherwise differentiated)
  characterisation factors or LCIA methods are used, the results applying the original,
  generic LCIA methods shall be calculated (and later be presented and discussed)

  191 Certain LCIA methods use non -linear relationships for th e characterisation; if such are used the calculation is
  non-linear.

  --- Page 301 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  8 Life Cycle Impact Assessment - calculating LCIA results  281
  separately as well. [ISO!]
  VI) SHOULD - Keep results of non -LCA impacts separate: For LCIA results of impacts
  that are outside the LCA frame 93 but that were considered relevant for the analysed or
  compared system(s) and have been included qu antitatively, the inventory, impact
  assessment, etc. shall be kept separately for clear interpretation. [ISO+]
  Note that classification and characterisation of all elementary flows is typically already done in combined LCI /
  LCIA database packages or LCA software. In any case this is to be checked responsibly by the LCA practitioner.
  The step of manual classification and assigning characterisation factors applies hence especially to newly created
  or imported elementary flows. It is one of the most widely f ound errors to not classify and characterise newly
  introduced flows despite of their environmental relevance. The "frequent errors" box in the main text of this
  chapter provides some guidance for identifying and solving such cases.
  8.3 Normalisation192
  (Refers to ISO 14044:2006 chapter 4.4.3.2)
  Introduction and overview
  Normalisation is an optional step under ISO 14044:2006. It supports the interpretation of
  the impact profile  and is the first step 193 towards a fully aggregated result that additionally
  requires a weighting across indicators (see next chapter).
  Normalised LCIA results give for each impact topic on midpoint level (e.g. Climate
  change, Eutrophication, etc.) or area of protection on endpoint level (e.g. Human health,
  Natural environment, Natural resou rces) the relative share of the impact of the analysed
  system in the total impact of this category per average citizen or globally, per country, etc .
  When displaying the normalised LCIA results of the different impact topics next to each
  other, it can hence be seen to which impact topics the analysed system contributes relatively
  more and to which less.
  Also to implement the cut -off criteria, weighted and normalised LCIA results can be used
  (see chapter 6.6.3). If this approach has been chosen, normalisation is a required step for all
  kinds of deliverables of the LCI/LCA study.
  The decision about inclusion of normalisation and the used normalisation basis has been
  made and documented in the first scope definition; it is binding and shall not be changed
  later during the study (see chapter 6.7.6).
  Calculating normalised LCIA results
  Normalised LCIA results are obtained by dividing the LCIA results by the normalisation
  basis, separately for each impact c ategory (for midpoint level related approaches) or area of
  protection (for endpoint level related approaches).
  No comparison across impact topics
  The different impact topics on midpoint level are typically understood to be of different
  absolute relevance (e.g. the issue Climate change may be judged to be more important than

  192 "Grouping" is not addressed in this guidance document as not seen as adding practical value in context of
  decision support. If it is planned to include a grouping step in an LCA study, p lease refer to the ISO 14044
  provisions.
  193 Note that there are also weighting approaches that do not include an initial normalisation step. Note
  furthermore that also for endpoint / damage modelling a weighting is required (across the areas -of-protection) if a
  single indicator is aimed at.
---

## Chunk Identity

- Source: ILCD Handbook General Guide for LCA Detailed Guidance (2010)
- Source file: `1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf`
- Page range: 297-301
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 297 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
8 Life Cycle Impact Assessment - calculating LCIA results  277
document "Framework and requirements for Life Cycle Impact Assessment (LCIA) models
and indicators" on the development  and selection of Life Cycle Impact Assessment models
and factors.
In LCA practice, these steps are not regularly done by LCA practitioners, but this is part of
the work towards developing LCIA methods . The practitioner is however responsible to
ensure that the inventory elem entary flows are correctly linked with the LCIA factors  (see
more below) and - together with LCIA experts - to derive or develop missing impact factors if
potentially relevant for the study (details see chapter 6.7.4).
The resu lting characterized indicator results can be summed up within each impact
category. The resulting collection of aggregated indicator results is the characterized impact
profile of the product, i.e. its LCIA results.
No comparison across impact categories
As the LCIA results per impact category have different units, they cannot directly be
compared to identify which are most relevant. Equally it cannot be summed up.
Ensure a correct link between inventory and impact factors
Databases within LCA software typically provide elementary flows that have been
classified and characterised and thereby “linked” with the LCIA methods. The practitioner is
however responsible to ensure that the inventory elementary flows are correctly linked with
the LCIA factors. This in any case applies for elementary flows that were added by the
practitioner during data collection and for  newly applied LCIA methods. The work of correctly
linking inventory and impact factors is  supported by using the same nomenclature and flow
data sets, e.g. the ILCD nomenclature and related reference elementary flows.
Frequent errors: Incomplete LCIA factor assignment to elementary flows
In LCA databases of di verse origins of the data (e .g. combined by the software/database
provider or growing over the years at the practitioner) typically have a number of elementary
flows that should carry a characterisation factor in the covered LCIA methods, but don‟t have
it assigned. That means the impact assessment is incomplete and – depending on the
relevancy o f the gaps – leads to wrong results and conclusions. Some of the main
“candidates” for such omissions and possible solutions 189 are as follows . The related
provisions are found in the referenced chapters (here below the provision status is given only
for orientation):
- Combined ores (e.g. “Lead -zinc ore; 2.5  % Pb, 1.8  % Zn " as "Resources from
ground” that were created by the practitioner or imported from the database
developers). Possible solution:
° a) (not permissible 190:) Calculate the resource depletion fact ors of the single
elements, scale them to the respective element contents of the flow, sum them up
and assign the resulting factor to that flow.
° b) (shall:) Avoid specific ore resource flows by splitting the ore flow up into the

189 These cases and possible solutions have been considered and are in line with the ILCD „Nomenclature and
other conventions“ guidance, the chapter on ove rarching methodological issues (annex 7.4.3) and are
implemented in the related ILCD reference elementary flows.
190 "not permissible" refers here to reporting for external use, as the respective flows would not meet the
provisions of the "Nomenclature and other provisions" (see separate document) and/or the "Overarching method
provisions for specific elementary flow types" (see chapter 7.4.3).

--- Page 298 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
8 Life Cycle Impact Assessment - calculating LCIA results  278
flows of the contained che mical elements and use the respective elementary
flows that already have impact factors assigned (i.e. for the above example to
“Lead" as "Resources from ground” and “Zinc" as "Resources from ground” and a
complementary "Inert rock" as "Resources from grou nd” for the mass balance.)
Note that for some ores the compound may need to be inventoried (e.g. Rock salt
(NaCl); details see chapter 7.4.3.6.2.
- Composed emissions such as e.g. salts (e.g. Ammonium nitrate,  while
characterisation factors exist for the contained ions Ammonium and Nitrate ).
Possible solution:
° a) (not permissible:) Calculate the correct factor stoichiometrically (or other
method, as appropriate) and assign to the flow.
° b) (shall:) Inventory the components as separate elementary flows (e.g.
"Ammonium" and "Nitrate"  for the above example) . See also chapter 7.4.3.3 on
when to split elementary flows of salts depending on their water solubility.
- Process-type specific (composed) emissions such as “Diesel engine off -gas” etc.,
which cannot be usefully addressed in impact assessment and which typically have
no impact factor at all and that shall not remain in the inventory. Possible solution:
° a) (should:) Inventory the specific substances emitted if data is available or
° b) (may) Estimate the composition by using technology -specific information on
emission-composition or default break -down tables (documenting assumptions
made) and inventory the individual substances emitted.
- Newly user-created flows of e.g. emissions that even may have a factor in the used
LCIA method but that were not provided with the LCA database package  or
software. Possible solution:
° First check whether the package is complete; obtain the missing factors. For flows
that were newly created by the user , it should be verified that it is not actually an
existing flow but named with an e.g. trivial name or an alternative chemical name.
CAS numbers help in verifying this.
- Emissions to sub-compartments or at specific locations for which no specific impact
factor is available. Possible solution:
° a) (recommended) Avoid use of such flows unless specific factors are available in
the applied LCIA method for all quantitatively relevant elementary flows, or
° b) (shall) Assign the impact factor of the same elementary flow of the parent
compartment (e.g. the impact factor for "Nitrate" as "Emissions to freshwater" is
also assigned to "Nitrate" as "Emissions to lakes") . See the separate document
"Nomenclature and other conventions" for applicable default compartments.
- Sum-indicators such as “Metals”  and measured indicators,  which cannot be usefully
addressed in impact assessment and which typically have no impact factor at all  and
that shall not remain in the inventory. Possible solution:
° a) (should) Inventory the individual substances (e.g. for the sum-indicator "Metals"
the individual "Lead", "Iron", etc. metals), if composition information is available,
or
° b) (may) Estimate the composition  by using tec hnology-specific information on

--- Page 299 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
8 Life Cycle Impact Assessment - calculating LCIA results  279
emission-composition or default break -down tables (documenting assumptions
made) and inventory the individual substances emitted.  See chapter 7.4.3.2 for
permissible sum-indicators.
- Unspecified “Biomass”, “Renewable energy”, “Unspecified emissions”, etc.
elementary flows. Possible solution:
° a) (should) Inventory the individual components if data is available, or
° b) (may) Estimate the composition by using technology -specific info rmation on
composition or default break -down tables or a typical generic case (documenting
assumptions made) and inventory the individual substances emitted.
Note: Check also whether the respective flow is potentially relevant (along process -specific
worst-case assumptions) and remove it from the inventory if clearly not relevant in line with
the applied cut-off rules.
Additional, modified, or non-generic / differentiated LCIA methods
As already mentioned in chapter 6.7, in cas e the inventory work reveals the need to
address additional impacts that where not originally considered, the respective scope step
has to be revised.  In summary: If a characterisation factor is missing for an elementary flow
in the inventory, which is kno wn to contribute to an impact category, its  potential importance
should be checked . If the contribution from the elementary flow is found to be potentially
significant, an attempt should be made to estimate the missing characterisation factor, and if
this is not possible, the fact of a potentially  relevant missing characterisation factor must be
reported, and the potential influence of the missing factor must be considered in the
interpretation of the results.
Normalisation and weighting necessary?
The decision of inclusion/exclusion of normalisation and weighting shall have been made
and documented in the initial scope definition  (see chapter 6.7.7). Note that normalisation
and weighting may be required as interim step for defi ning the quantitative cut -off rules (see
chapter 6.6.3) and for checking the achieved completeness of the inventory (see chapter
9.3.2); this depends on the chosen approach for implementing the cut -off rules . If used
exclusively for this purpose, the respective normalised and weighted figures are not staying
in the data set or report.
In comparisons without normalisation and weighting, LCIA results of the different impact
categories or damages/areas -of-protection may point to different directions, i.e. for different
impact categories not always the alternative product performs best. However, if the study is
intended to support a comparative assertion to be disclosed to the public, no form of
numerical, value -based weighting of the indicator results is permitted to be published in
accordance with ISO 14040 and 14044:2006.
For in-house purposes, the use of normalisation and weighting – preferably using several
different approaches and value perspectives - can help to demonstrate the robustness of the
analysis.
If in contrast all impact indicators point into the same direction, t he LCIA results can
already be the basis for interpretation phase of the LCA, including for comparative studies,
clearly identifying a superior alternative (or, in case of limited significance of the differences,
identifying equality of the compared alternatives).

--- Page 300 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
8 Life Cycle Impact Assessment - calculating LCIA results  280
Provisions: 8.2 Calculation of LCIA results
Note that this provision applies to all types of deliverables of the study , while for unit process, partly terminated
system and LCI results data sets as deliverables only to quantify the achieved completeness  and precision, as
they needs to be evaluated from the system's perspective.
Note: If third-party LCIA methods are used  that correctly provide characterisation factors for all used elementary
flows, the first two following provisions mean to exclusively control that this has been done correctly. For any
newly created elementary flow however, the characterisation factor has  to be assigned and/or developed (see
also chapter 6.7.4):
I) SHALL - Classification of elementary flows:  All elementary flows of the inventory
shall be assigned to those one or more impact categories to which the y contribute
(“classification”) and that were selected for the impact assessment in the scope
definition of the study.
II) SHALL - Characterisation of elementary flows:  To all classified elementary flows
each one quantitative characterisation factor shall be  assigned for each category to
which the flow relevantly contributes ("characterisation"). That factor expresses how
much that flow contributes to the impact category indicator (at midpoint level) or
category endpoint indicator (at endpoint level). For mid point level indicators this relative
factor typically relates to a reference flow (e.g. it may be expressed in "kg CO 2-
equivalents" per kg elementary flow in case of Global Warming Potential) . For endpoint
level indicators it typically relates to a specifi c damage that relates to the broader area
of protection.  Examples are e.g. species loss measured e.g. as potentially displaced
fraction of species for an affected area and duration (pdf*m 2*a), or damage to Human
health measured e.g. in Disability Adjusted Life Years (DALYs) . (For terms and details
refer to the separate document "Framework and requirements for Life Cycle Impact
Assessment (LCIA) models and indicators").
III) SHALL - Calculate LCIA results per impact category:  For each impact category
separately, calculate the LCIA indicator results by multiplying 191 the amount of each
contributing (i.e. classified) elementary flow of the inventory with its characterisation
factor. The results may be summed up per impact category, but summing up shall not
be done across impact categories.
Note that this is done with either the midpoint level (impact potential) or the endpoint level (damage)
factors, as had to be decided in scope chapter 6.7.7.
IV) SHALL - Separately calculate LCIA results of long -term emissions: LCIA results of
long-term emissions (i.e. beyond 100 years from the time of the study) shall be
calculated separately from the LCIA results that relate to interventions that occur within
100 years from the time of study. [ISO!]
Note: Given the different extent of uncertainty, these two sets of results will later be presented separately
while discussed jointly.
V) SHALL - Separately calculate non -generic LCIA results, if included: In the case
additional or modified, non-generic (e.g. geographically or otherwise differentiated)
characterisation factors or LCIA methods are used, the results applying the original,
generic LCIA methods shall be calculated (and later be presented and discussed)

191 Certain LCIA methods use non -linear relationships for th e characterisation; if such are used the calculation is
non-linear.

--- Page 301 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
8 Life Cycle Impact Assessment - calculating LCIA results  281
separately as well. [ISO!]
VI) SHOULD - Keep results of non -LCA impacts separate: For LCIA results of impacts
that are outside the LCA frame 93 but that were considered relevant for the analysed or
compared system(s) and have been included qu antitatively, the inventory, impact
assessment, etc. shall be kept separately for clear interpretation. [ISO+]
Note that classification and characterisation of all elementary flows is typically already done in combined LCI /
LCIA database packages or LCA software. In any case this is to be checked responsibly by the LCA practitioner.
The step of manual classification and assigning characterisation factors applies hence especially to newly created
or imported elementary flows. It is one of the most widely f ound errors to not classify and characterise newly
introduced flows despite of their environmental relevance. The "frequent errors" box in the main text of this
chapter provides some guidance for identifying and solving such cases.
8.3 Normalisation192
(Refers to ISO 14044:2006 chapter 4.4.3.2)
Introduction and overview
Normalisation is an optional step under ISO 14044:2006. It supports the interpretation of
the impact profile  and is the first step 193 towards a fully aggregated result that additionally
requires a weighting across indicators (see next chapter).
Normalised LCIA results give for each impact topic on midpoint level (e.g. Climate
change, Eutrophication, etc.) or area of protection on endpoint level (e.g. Human health,
Natural environment, Natural resou rces) the relative share of the impact of the analysed
system in the total impact of this category per average citizen or globally, per country, etc .
When displaying the normalised LCIA results of the different impact topics next to each
other, it can hence be seen to which impact topics the analysed system contributes relatively
more and to which less.
Also to implement the cut -off criteria, weighted and normalised LCIA results can be used
(see chapter 6.6.3). If this approach has been chosen, normalisation is a required step for all
kinds of deliverables of the LCI/LCA study.
The decision about inclusion of normalisation and the used normalisation basis has been
made and documented in the first scope definition; it is binding and shall not be changed
later during the study (see chapter 6.7.6).
Calculating normalised LCIA results
Normalised LCIA results are obtained by dividing the LCIA results by the normalisation
basis, separately for each impact c ategory (for midpoint level related approaches) or area of
protection (for endpoint level related approaches).
No comparison across impact topics
The different impact topics on midpoint level are typically understood to be of different
absolute relevance (e.g. the issue Climate change may be judged to be more important than

192 "Grouping" is not addressed in this guidance document as not seen as adding practical value in context of
decision support. If it is planned to include a grouping step in an LCA study, p lease refer to the ISO 14044
provisions.
193 Note that there are also weighting approaches that do not include an initial normalisation step. Note
furthermore that also for endpoint / damage modelling a weighting is required (across the areas -of-protection) if a
single indicator is aimed at.
