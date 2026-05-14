---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook General Guide for LCA Detailed Guidance (2010) - chunk 072"
nodeId: "ilcd-handbook-general-guide-detailed-guidance-2010-chunk-072"
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
chunkIndex: 72
pageRange: "352-359"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 352 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  12 Annex A: Data quality concept and approach  332
   By this way of classifying the achieved overall quality and its components of the
  developed e.g. unit process or LCI result  data set , a structured communication and
  identification (e.g. sorting/filtering of suitable data e.g. in the ILCD Data Network ) is
  supported.
  Overall data quality and three data quality levels for LCI data sets
  In addition to the more differentiated quality levels, for orientation it is useful to label data
  sets with different levels of overall LCI data quality. The overall quality of the data set can be
  derived form the quality rating of the various quality indicators / components. As said earlier,
  the weakest of the quality indicators generally weakens the overall quality of the data set.
  The overall data quality shall be calculated by summing up the achieved quality rating for
  each of the quality components. The rating of the weakest quality level is counted 5 -fold. The
  sum is divided by the number of applicable quality components plus 4.  The Data Quality
  Rating result is used to identify the corresponding quality level in Table 7. Formula 3 provides
  the calculation provision:
  Formula 3
  4
  4*
  i
  XMPCTiRGRTeRDQR w
   DQR : Data Quality Rating of the LCI data set; see Table 7
   TeR, GR, TiR, C, P, M : see Table 5
   Xw : weakest quality level obtained (i.e. highest numeric value) among the data quality
  indicators
   i : number of applicable (i.e. not equal "0") data quality indicators
  Table 7 Overall quality level of a data set according to the achieved overall data quality
  rating
  Overall data quality rating (DQR) Overall data quality level
   1.6218 "High quality"
  >1.6 to
   3 "Basic quality"
  >3 to
   4 "Data estimate"

  See Table 8 and the text below for an example.
  Table 8 Illustrative example for determining the data quality rating. Illustrated with a
  location unspecific technology data set (e.g. a diesel electricity generator for a construction
  site and of a given emission standard)
  Component Achieved quality level Corresponding quality rating
  Technological
  representativeness (TeR)
  Very good 1

  218 This means that not all quality indicator need to be "very good", but two can be only "good". If more than two
  are only good, the data set is downgraded to the next quality class.

  --- Page 353 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  12 Annex A: Data quality concept and approach  333
  Geographical representativeness
  (GR)
  Not applicable219 0
  Time-related representativeness
  (TiR)
  Fair 3
  Completeness (C) Good 2
  Precision / uncertainty (P) Fair 3
  Methodological appropriateness
  and consistency (M)
  Good 2

  For the example given in Table 8, the overall data quality rating is calculated as:
  DQR = (TeR+GR+TiR+C+P220+M+3*4) /  (5221+4) = (1+0+3+2+3+2+3*4) / 9 = 2.56.
  Table 7 helps to identify the corresponding overall data quality level "Basic quality" for the
  overall data quality rating of that virtual example data set.
  Accuracy, precision and completeness of LCI data, LCIA res ults and LCA studies
  including normalisation and weighting
  Accuracy, precision and completeness of LCI data should be assessed on the  system
  level. This in addition needs to  be done in view of  the respective LCIA results, per impact
  category, but disregard ing the (additional) uncertainties and limited accuracy of the
  characterisation factors (and any eventually applied normalisation and weighting factors) as
  the focus here is on the requirements to the inventory data.
  Accuracy, precision and completeness o f LCIA results would than include also the
  uncertainty and limited accuracy of the LCIA factors.
  For LCA studies including normalisation , the respective uncertainty and limited accuracy
  would be additionally included.
  In contrast , for the weighting step (same as for methodological choices and other
  assumptions), an uncertainty calculation is potentially less suitable. Scenario analysis should
  better suit to capture the additional lack of robustness any specific weighting method
  introduces.
  12.4 ILCD Handbook compliance criteria
  (Refers to aspects of ISO 14044:2006 chapters 4.2.3.6 and 4.3.2.1)
  Overview
  For structuring the approach of developing ILCD Handbook compliant data and studies as
  well as product -specific guidance documents or Product Category Rules (PCR s), the ILCD

  219 Not applicable as location unspecific technology data set.
  220 The second occurrence of the lowest level "fair". In the calculation the lowest level rating i s multiplied only
  once with "5", here for TiR.
  221 As "Geographical representativeness" is not applicable here, only five of the otherwise up to six indicators /
  components are counted.

  --- Page 354 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  12 Annex A: Data quality concept and approach  334
  compliance is composed of five  groups of aspects: Data quality, Method, Nomenclature,
  Review, and Documentation222.
  These aspects shall also be used when referring only to selected of the ILCD compliance
  criteria and reporting this partial comp liance in a structured way, e.g. when documenting LCI
  data sets, using the ILCD reference data set format.
  The requirements for claiming ILCD compliance for data sets and studies are found in
  chapter 2.3.
  Note that exclusively  the "Data quality" compliance is further differentiated by different
  levels of achieved data quality. The other compliance criteria can only either have been
  achieved or not; there is not further differentiation.
  Logic of compliance criteria structure
  The structure of the ILCD compliance criteria applies the following logic:
   Items that directly relate to the inventory data and impact assessment results data are
  grouped under “Data quality”. These were addressed in the preceding chapter 12.3.
   “Method” groups all issues around the appropriateness of applied methods and the
  consistency of their use. This can be assessed without having relevant
  interrelationships to the underlying data. Note however, that method consistency is
  necessarily also part of the “Data quality”, e.g. technological representativeness means
  something different under attributional and consequential modelling and consistent use
  of the methods hence affects the overall achieved representativeness especially of LCI
  results data.
   “Nomenclature” is an issue that predominantly relates to the used naming and
  structuring of elementary flows and other named elements . This  ensure that different
  practitioners can at all consistently work with the data (e.g. that the ele mentary flow
  Carbon dioxide is clearly identified by name, CAS number, measured always in the
  same unit etc.) and that the LCI data can be correctly linked with the LCIA factors.
  Correct and consistent use of LCA terminology is a second component under
  “Nomenclature”.
   “Review” captures all review aspects.
   “Documentation” finally captures several issues: the exten t and detail of the
  documentation as key requirement to support transparency and to ensure that the
  results can be reproduced. At the same time the documentation is important for the LCA
  practitioner to know what the data set inventory actually represents and whether it is the
  appropriate data for his/her systems. The form (report, data set) and format (ILCD
  reference format, ILCD report template e tc) completes the documentation information ,
  making sure that the documented information can be electronically exchanged without
  loss of information etc.
  Note that the exact coverage of items under each aspect and component depends on the
  type of LCI/LCA study. E.g. will an unit process LCI data set not include certain aspects that
  relate exclusively to (product) system modelling, etc.
  Table 9 gives more details on the compliance criteria.

  222 Following the same logic of this set of 5 compliance aspects, also the  overall quality of LCIA methods can be
  described and assessed. More detailed provisions for this are still to be developed.

  --- Page 355 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  12 Annex A: Data quality concept and approach  335
  Table 9 ILCD compliance of LCI and LCA studies  and data sets , direct applications, and
  derived more specific guidance documents / Product Category Rules (PCR) . Compliance
  aspects, components, brief description and main corresponding chapters (indicative).
  Aspect Components Description / Comment Main chapters
  Quality Completeness Details see Table 5 , Table 6 , and
  Table 7.
  Chapter 12.3
  Technological
  representativeness
  Geographical
  representativeness
  Time-related
  representativeness
  Precision /
  uncertainty
  Methodological
  appropriateness223
  and consistency
  Method Application of LCI
  modelling and
  method provisions of
  this document
  Adhering to  the provisions for the
  selection and LCI modelling of the
  applicable goal situation A, B, or C.
  Chapter 6.5.4,
  and referenced
  chapters.
  Application of other
  method provisions of
  this document
  Adhering to the o ther method
  provisions of this document.
  Other chapters
  with method
  provisions.
  Nomenclatu
  re
  Correctness and
  consistency of
  applied
  nomenclature
  Appropriate naming of flows and
  processes, consistent use of ILCD
  reference elementary flows,
  appropriate and consistent use of
  units, etc.
  Chapter 7.4.3 and
  separate
  document
  "Nomenclature
  and other
  conventions".
  Correctness and
  consistency of
  applied terminology
  Correct and consistent use of
  technical terms (LCA and  other
  domains).
  Key terms of
  chapter 3, "terms
  and concepts"
  boxes throughout
  the document,
  and application of
  the separate
  terminology.
  Review Appropriateness of
  applied review type
  Selection of the applicabl e review
  type.
  Chapter 11 and
  separate
  document
  "Review schemes
  for Life Cycle
  Assessment

  223 See text for reason to include “method…” in both data quality and as separate item “Method”

  --- Page 356 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  12 Annex A: Data quality concept and approach  336
  (LCA)".
  Correctness of
  applied review
  scope
  Correct scope of what is reviewed. Separate
  document on
  "Review scope,
  methods, and
  documentation".
  Correctness of
  applied review
  methods
  Correct methods of how to review
  each of the items within the review
  scope.
  Separate
  document on
  "Review scope,
  methods, and
  documentation".
  Correctness of the
  review
  documentation224
  Correct scope, form and extent of
  what is documented about the final
  outcome of the review.
  Separate
  document on
  "Review scope,
  methods, and
  documentation".
  Documentat
  ion
  Appropriateness of
  documentation
  extent
  Appropriate coverage of what is
  reported / documented.
  Chapter 10.
  Appropriateness of
  form of
  documentation
  Selection of the applicable form(s) of
  reporting / documentation.
  Chapter 10.3.
  Appropriateness of
  documentation
  format
  Selection and correct use of the data
  set format or report template, plus
  review documentation requirements.
  See separate
  ILCD data set
  format and LCA
  report template
  (separately
  available files).


  224 The documentation of the review fin dings belongs to the "Review" part, since it does not relate to the
  documentation of the object of the data set.

  --- Page 357 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  13 Annex B: Calculation of CO2 emissions from land transformation  337
  13 Annex B: Calculation of CO 2 emissions f rom
  land transformation
  Many aspects influence emissions form land transformations. Their combinations result in
  the native soil carbon stock, varied by three further influence factors:
   Native soil carbon stock (factors climate region and soil type (Table 10)),
   land use factor ( land use type, temperature regime, and moisture regime (Table 11)),
  and
   management factor (specific land management for cropland and for grassland (Table 12
  and Table 13)), and the related
   input level factor (in variation of the  above named land management types, in the same
  tables).
  These aspects and result ing factors are derived from the most recent available related
  IPCC reports and are included in the tables below . CO 2 emissions from any land
  transformation can be easily calculated  by calculating the difference of the steady -state soil
  carbon content between the land use before and after transformation. This number is then to
  be multiplied by 44/12 to convert C -losses stoichiometrically to CO2 emissions. The steady -
  state carbon stock of each land use is calculated  by simple multiplication of its basic soil
  carbon stock with the loss factors.
  Formula 4 and Formula 5 serve to calculate the soil organic carbon stock of the initial and
  final land use. Formula 6 provides the final prescription.
  Formula 4
  111 *** ILLMFLUFSOCnSOCi

  with
   SOCi = Initial soil organic carbon stock of initial land use "1", given in [t/ha]
   SOCn = Native soil organic carbon stock (climate region, soil type); Table 10, given in
  [t/ha]
   LUF = Land use factor; Table 11, dimensionless
   LMF = Land management factor; Table 12 and Table 13, dimensionless
   IL = Input level factor; also Table 12 and Table 13, dimensionless
  Formula 5
  222 *** ILLMFLUFSOCnSOCf

  with
   SOCf = Final soil organic carbon stock of land use "2", i.e. after transformation, given in
  [t/ha]
  Formula 6
  12
  44*)(2 SOCfSOCiCO

  with

  --- Page 358 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  13 Annex B: Calculation of CO2 emissions from land transformation  338
   CO2 = resulting CO2 emissions from soil (given in [t/ha]) as the difference in soil carbon
  stocks multiplied by the atomic weight of CO2 and divided by the atomic weight of C.
  Note that this is the total amount of CO 2 that has to be allocated to the individual crops
  and/or crop years after conversion, as detailed in chapter 7.4.4.1.

  At the end of the tables some example calculations are given.

  Table 10 Native soil carbon stocks under native vegetation (tonnes C ha -1 in upper 30 cm
  of soil) (IPCC 2006)
  Climate Region High
  activity
  clay
  soils
  Low
  activity
  clay
  soils
  Sandy
  soils
  Spodic
  soils
  Volcanic
  soils
  Wetland
  soils
  Boreal 68 NA 10 117 20 146
  Cold temperate, dry 50 33 34 NA 20 97
  Cold temperate, moist 95 85 71 115 130
  Warm temperate, dry 38 24 19 NA 70 88
  Warm temperate,
  moist
  88 63 34 NA 80
  Tropical, dry 38 35 31 NA 50 86
  Tropical, moist 65 47 39 NA 70
  Tropical, wet 44 60 66 NA 130
  Tropical montane 88 63 34 NA 80

  Table 11 Land use factors (IPCC 2006)
  Land-use Temperature regime Moisture
  regime
  Land use factors
  (IPCC default)
  Error
  (±)225
  Long-term
  cultivated
  Temperate/Boreal Dry 0.80 9 %
  Moist 0.69 12 %
  Tropical Dry 0.58 61 %
  Moist/Wet 0.48 46 %
  Tropical montane n/a 0.64 50 %

  225 Error = two standard deviations, expressed as a percent of the mean; where sufficient studies were not
  available for a statistical analysis a default, a value based on expert judgement (40 %, 50%, or 90%) is used as a
  measure of the error. NA denotes „Not Applicable‟, for factor values that constitute reference values or nominal
  practices for the input or management classes. This error range does not include potential systematic error due to
  small sample sizes that may not be representative of the true impact for all regions of the world.

  --- Page 359 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  13 Annex B: Calculation of CO2 emissions from land transformation  339
  Permanent
  grassland
  All  1.00
  Paddy rice All Dry and
  Moist/Wet
  1.10 50 %
  Perennial/Tree Crop All 1.00 50 %
  Set-aside (< 20 yrs) Temperate/Boreal
   and Tropical
  Dry 0.93 11 %
  Moist/Wet 0.82 17 %
  Tropical montane n/a 0.88 90 %

  Table 12 Land management and input level factors for cropland (IPCC 2006)
  Land management (for cultivated land only)
  Land-use
  management
  Temperature regime Moisture
  regime
  Land
  management and
  input level
  factors ( IPCC
  defaults)
   Error
  (±)225
  Full tillage All Dry and
  Moist/Wet
  1.00 NA
  Reduced tillage Temperate/Boreal Dry 1.02 6 %
  Moist 1.08 5 %
  Tropical Dry 1.09 9 %
  Moist/Wet 1.15 8 %
  Tropical montane n/a 1.09 50 %
  No tillage Temperate/Boreal Dry 1.10 5 %
  Moist 1.15 4 %
  Tropical Dry 1.17 8 %
  Moist/Wet 1.22 7 %
  Tropical montane n/a 1.16 50 %
    Input level (for cultivated land only)
  Low input


  Temperate/Boreal Dry 0.95 13 %
  Moist 0.92 14 %
  Tropical Dry 0.95 13 %
  Moist/Wet 0.92 14 %
  Tropical montane n/a 0.94 50 %
  Medium input All Dry and 1.00 NA
---

## Chunk Identity

- Source: ILCD Handbook General Guide for LCA Detailed Guidance (2010)
- Source file: `1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf`
- Page range: 352-359
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 352 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
12 Annex A: Data quality concept and approach  332
 By this way of classifying the achieved overall quality and its components of the
developed e.g. unit process or LCI result  data set , a structured communication and
identification (e.g. sorting/filtering of suitable data e.g. in the ILCD Data Network ) is
supported.
Overall data quality and three data quality levels for LCI data sets
In addition to the more differentiated quality levels, for orientation it is useful to label data
sets with different levels of overall LCI data quality. The overall quality of the data set can be
derived form the quality rating of the various quality indicators / components. As said earlier,
the weakest of the quality indicators generally weakens the overall quality of the data set.
The overall data quality shall be calculated by summing up the achieved quality rating for
each of the quality components. The rating of the weakest quality level is counted 5 -fold. The
sum is divided by the number of applicable quality components plus 4.  The Data Quality
Rating result is used to identify the corresponding quality level in Table 7. Formula 3 provides
the calculation provision:
Formula 3
4
4*
i
XMPCTiRGRTeRDQR w
 DQR : Data Quality Rating of the LCI data set; see Table 7
 TeR, GR, TiR, C, P, M : see Table 5
 Xw : weakest quality level obtained (i.e. highest numeric value) among the data quality
indicators
 i : number of applicable (i.e. not equal "0") data quality indicators
Table 7 Overall quality level of a data set according to the achieved overall data quality
rating
Overall data quality rating (DQR) Overall data quality level
 1.6218 "High quality"
>1.6 to
 3 "Basic quality"
>3 to
 4 "Data estimate"

See Table 8 and the text below for an example.
Table 8 Illustrative example for determining the data quality rating. Illustrated with a
location unspecific technology data set (e.g. a diesel electricity generator for a construction
site and of a given emission standard)
Component Achieved quality level Corresponding quality rating
Technological
representativeness (TeR)
Very good 1

218 This means that not all quality indicator need to be "very good", but two can be only "good". If more than two
are only good, the data set is downgraded to the next quality class.

--- Page 353 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
12 Annex A: Data quality concept and approach  333
Geographical representativeness
(GR)
Not applicable219 0
Time-related representativeness
(TiR)
Fair 3
Completeness (C) Good 2
Precision / uncertainty (P) Fair 3
Methodological appropriateness
and consistency (M)
Good 2

For the example given in Table 8, the overall data quality rating is calculated as:
DQR = (TeR+GR+TiR+C+P220+M+3*4) /  (5221+4) = (1+0+3+2+3+2+3*4) / 9 = 2.56.
Table 7 helps to identify the corresponding overall data quality level "Basic quality" for the
overall data quality rating of that virtual example data set.
Accuracy, precision and completeness of LCI data, LCIA res ults and LCA studies
including normalisation and weighting
Accuracy, precision and completeness of LCI data should be assessed on the  system
level. This in addition needs to  be done in view of  the respective LCIA results, per impact
category, but disregard ing the (additional) uncertainties and limited accuracy of the
characterisation factors (and any eventually applied normalisation and weighting factors) as
the focus here is on the requirements to the inventory data.
Accuracy, precision and completeness o f LCIA results would than include also the
uncertainty and limited accuracy of the LCIA factors.
For LCA studies including normalisation , the respective uncertainty and limited accuracy
would be additionally included.
In contrast , for the weighting step (same as for methodological choices and other
assumptions), an uncertainty calculation is potentially less suitable. Scenario analysis should
better suit to capture the additional lack of robustness any specific weighting method
introduces.
12.4 ILCD Handbook compliance criteria
(Refers to aspects of ISO 14044:2006 chapters 4.2.3.6 and 4.3.2.1)
Overview
For structuring the approach of developing ILCD Handbook compliant data and studies as
well as product -specific guidance documents or Product Category Rules (PCR s), the ILCD

219 Not applicable as location unspecific technology data set.
220 The second occurrence of the lowest level "fair". In the calculation the lowest level rating i s multiplied only
once with "5", here for TiR.
221 As "Geographical representativeness" is not applicable here, only five of the otherwise up to six indicators /
components are counted.

--- Page 354 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
12 Annex A: Data quality concept and approach  334
compliance is composed of five  groups of aspects: Data quality, Method, Nomenclature,
Review, and Documentation222.
These aspects shall also be used when referring only to selected of the ILCD compliance
criteria and reporting this partial comp liance in a structured way, e.g. when documenting LCI
data sets, using the ILCD reference data set format.
The requirements for claiming ILCD compliance for data sets and studies are found in
chapter 2.3.
Note that exclusively  the "Data quality" compliance is further differentiated by different
levels of achieved data quality. The other compliance criteria can only either have been
achieved or not; there is not further differentiation.
Logic of compliance criteria structure
The structure of the ILCD compliance criteria applies the following logic:
 Items that directly relate to the inventory data and impact assessment results data are
grouped under “Data quality”. These were addressed in the preceding chapter 12.3.
 “Method” groups all issues around the appropriateness of applied methods and the
consistency of their use. This can be assessed without having relevant
interrelationships to the underlying data. Note however, that method consistency is
necessarily also part of the “Data quality”, e.g. technological representativeness means
something different under attributional and consequential modelling and consistent use
of the methods hence affects the overall achieved representativeness especially of LCI
results data.
 “Nomenclature” is an issue that predominantly relates to the used naming and
structuring of elementary flows and other named elements . This  ensure that different
practitioners can at all consistently work with the data (e.g. that the ele mentary flow
Carbon dioxide is clearly identified by name, CAS number, measured always in the
same unit etc.) and that the LCI data can be correctly linked with the LCIA factors.
Correct and consistent use of LCA terminology is a second component under
“Nomenclature”.
 “Review” captures all review aspects.
 “Documentation” finally captures several issues: the exten t and detail of the
documentation as key requirement to support transparency and to ensure that the
results can be reproduced. At the same time the documentation is important for the LCA
practitioner to know what the data set inventory actually represents and whether it is the
appropriate data for his/her systems. The form (report, data set) and format (ILCD
reference format, ILCD report template e tc) completes the documentation information ,
making sure that the documented information can be electronically exchanged without
loss of information etc.
Note that the exact coverage of items under each aspect and component depends on the
type of LCI/LCA study. E.g. will an unit process LCI data set not include certain aspects that
relate exclusively to (product) system modelling, etc.
Table 9 gives more details on the compliance criteria.

222 Following the same logic of this set of 5 compliance aspects, also the  overall quality of LCIA methods can be
described and assessed. More detailed provisions for this are still to be developed.

--- Page 355 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
12 Annex A: Data quality concept and approach  335
Table 9 ILCD compliance of LCI and LCA studies  and data sets , direct applications, and
derived more specific guidance documents / Product Category Rules (PCR) . Compliance
aspects, components, brief description and main corresponding chapters (indicative).
Aspect Components Description / Comment Main chapters
Quality Completeness Details see Table 5 , Table 6 , and
Table 7.
Chapter 12.3
Technological
representativeness
Geographical
representativeness
Time-related
representativeness
Precision /
uncertainty
Methodological
appropriateness223
and consistency
Method Application of LCI
modelling and
method provisions of
this document
Adhering to  the provisions for the
selection and LCI modelling of the
applicable goal situation A, B, or C.
Chapter 6.5.4,
and referenced
chapters.
Application of other
method provisions of
this document
Adhering to the o ther method
provisions of this document.
Other chapters
with method
provisions.
Nomenclatu
re
Correctness and
consistency of
applied
nomenclature
Appropriate naming of flows and
processes, consistent use of ILCD
reference elementary flows,
appropriate and consistent use of
units, etc.
Chapter 7.4.3 and
separate
document
"Nomenclature
and other
conventions".
Correctness and
consistency of
applied terminology
Correct and consistent use of
technical terms (LCA and  other
domains).
Key terms of
chapter 3, "terms
and concepts"
boxes throughout
the document,
and application of
the separate
terminology.
Review Appropriateness of
applied review type
Selection of the applicabl e review
type.
Chapter 11 and
separate
document
"Review schemes
for Life Cycle
Assessment

223 See text for reason to include “method…” in both data quality and as separate item “Method”

--- Page 356 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
12 Annex A: Data quality concept and approach  336
(LCA)".
Correctness of
applied review
scope
Correct scope of what is reviewed. Separate
document on
"Review scope,
methods, and
documentation".
Correctness of
applied review
methods
Correct methods of how to review
each of the items within the review
scope.
Separate
document on
"Review scope,
methods, and
documentation".
Correctness of the
review
documentation224
Correct scope, form and extent of
what is documented about the final
outcome of the review.
Separate
document on
"Review scope,
methods, and
documentation".
Documentat
ion
Appropriateness of
documentation
extent
Appropriate coverage of what is
reported / documented.
Chapter 10.
Appropriateness of
form of
documentation
Selection of the applicable form(s) of
reporting / documentation.
Chapter 10.3.
Appropriateness of
documentation
format
Selection and correct use of the data
set format or report template, plus
review documentation requirements.
See separate
ILCD data set
format and LCA
report template
(separately
available files).


224 The documentation of the review fin dings belongs to the "Review" part, since it does not relate to the
documentation of the object of the data set.

--- Page 357 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
13 Annex B: Calculation of CO2 emissions from land transformation  337
13 Annex B: Calculation of CO 2 emissions f rom
land transformation
Many aspects influence emissions form land transformations. Their combinations result in
the native soil carbon stock, varied by three further influence factors:
 Native soil carbon stock (factors climate region and soil type (Table 10)),
 land use factor ( land use type, temperature regime, and moisture regime (Table 11)),
and
 management factor (specific land management for cropland and for grassland (Table 12
and Table 13)), and the related
 input level factor (in variation of the  above named land management types, in the same
tables).
These aspects and result ing factors are derived from the most recent available related
IPCC reports and are included in the tables below . CO 2 emissions from any land
transformation can be easily calculated  by calculating the difference of the steady -state soil
carbon content between the land use before and after transformation. This number is then to
be multiplied by 44/12 to convert C -losses stoichiometrically to CO2 emissions. The steady -
state carbon stock of each land use is calculated  by simple multiplication of its basic soil
carbon stock with the loss factors.
Formula 4 and Formula 5 serve to calculate the soil organic carbon stock of the initial and
final land use. Formula 6 provides the final prescription.
Formula 4
111 *** ILLMFLUFSOCnSOCi

with
 SOCi = Initial soil organic carbon stock of initial land use "1", given in [t/ha]
 SOCn = Native soil organic carbon stock (climate region, soil type); Table 10, given in
[t/ha]
 LUF = Land use factor; Table 11, dimensionless
 LMF = Land management factor; Table 12 and Table 13, dimensionless
 IL = Input level factor; also Table 12 and Table 13, dimensionless
Formula 5
222 *** ILLMFLUFSOCnSOCf

with
 SOCf = Final soil organic carbon stock of land use "2", i.e. after transformation, given in
[t/ha]
Formula 6
12
44*)(2 SOCfSOCiCO

with

--- Page 358 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
13 Annex B: Calculation of CO2 emissions from land transformation  338
 CO2 = resulting CO2 emissions from soil (given in [t/ha]) as the difference in soil carbon
stocks multiplied by the atomic weight of CO2 and divided by the atomic weight of C.
Note that this is the total amount of CO 2 that has to be allocated to the individual crops
and/or crop years after conversion, as detailed in chapter 7.4.4.1.

At the end of the tables some example calculations are given.

Table 10 Native soil carbon stocks under native vegetation (tonnes C ha -1 in upper 30 cm
of soil) (IPCC 2006)
Climate Region High
activity
clay
soils
Low
activity
clay
soils
Sandy
soils
Spodic
soils
Volcanic
soils
Wetland
soils
Boreal 68 NA 10 117 20 146
Cold temperate, dry 50 33 34 NA 20 97
Cold temperate, moist 95 85 71 115 130
Warm temperate, dry 38 24 19 NA 70 88
Warm temperate,
moist
88 63 34 NA 80
Tropical, dry 38 35 31 NA 50 86
Tropical, moist 65 47 39 NA 70
Tropical, wet 44 60 66 NA 130
Tropical montane 88 63 34 NA 80

Table 11 Land use factors (IPCC 2006)
Land-use Temperature regime Moisture
regime
Land use factors
(IPCC default)
Error
(±)225
Long-term
cultivated
Temperate/Boreal Dry 0.80 9 %
Moist 0.69 12 %
Tropical Dry 0.58 61 %
Moist/Wet 0.48 46 %
Tropical montane n/a 0.64 50 %

225 Error = two standard deviations, expressed as a percent of the mean; where sufficient studies were not
available for a statistical analysis a default, a value based on expert judgement (40 %, 50%, or 90%) is used as a
measure of the error. NA denotes „Not Applicable‟, for factor values that constitute reference values or nominal
practices for the input or management classes. This error range does not include potential systematic error due to
small sample sizes that may not be representative of the true impact for all regions of the world.

--- Page 359 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
13 Annex B: Calculation of CO2 emissions from land transformation  339
Permanent
grassland
All  1.00
Paddy rice All Dry and
Moist/Wet
1.10 50 %
Perennial/Tree Crop All 1.00 50 %
Set-aside (< 20 yrs) Temperate/Boreal
 and Tropical
Dry 0.93 11 %
Moist/Wet 0.82 17 %
Tropical montane n/a 0.88 90 %

Table 12 Land management and input level factors for cropland (IPCC 2006)
Land management (for cultivated land only)
Land-use
management
Temperature regime Moisture
regime
Land
management and
input level
factors ( IPCC
defaults)
 Error
(±)225
Full tillage All Dry and
Moist/Wet
1.00 NA
Reduced tillage Temperate/Boreal Dry 1.02 6 %
Moist 1.08 5 %
Tropical Dry 1.09 9 %
Moist/Wet 1.15 8 %
Tropical montane n/a 1.09 50 %
No tillage Temperate/Boreal Dry 1.10 5 %
Moist 1.15 4 %
Tropical Dry 1.17 8 %
Moist/Wet 1.22 7 %
Tropical montane n/a 1.16 50 %
  Input level (for cultivated land only)
Low input


Temperate/Boreal Dry 0.95 13 %
Moist 0.92 14 %
Tropical Dry 0.95 13 %
Moist/Wet 0.92 14 %
Tropical montane n/a 0.94 50 %
Medium input All Dry and 1.00 NA
