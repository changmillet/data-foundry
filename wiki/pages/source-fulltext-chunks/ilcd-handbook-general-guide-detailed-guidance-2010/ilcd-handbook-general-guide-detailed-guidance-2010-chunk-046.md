---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook General Guide for LCA Detailed Guidance (2010) - chunk 046"
nodeId: "ilcd-handbook-general-guide-detailed-guidance-2010-chunk-046"
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
chunkIndex: 46
pageRange: "223-227"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 223 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  203
  process is operated and are also enforced, they give an indication of the possibl e
  maximum values of the amounts of these flows. [ISO+]
  Note that legal limit values - also of the country where they originally apply - normally cannot be used as
  inventory values, unless this is checked and justified for the modelled process and in line with the goal.
  7.4.2.9 From raw data to unit process inventory
  (Refers to aspects of ISO 14044:2006 chapter 4.3.3)
  The amount of products produced by a production unit process (or of functions performed
  in case of services) is required in order to relate the em issions and other flows to the
  functional unit and reference flow of this unit process. In data collection often accounts are
  available that report the total annual load of emissions and consumption of fuels, materials
  and ancillary chemicals of a process or a plant. These annual account figures must be
  quantitatively related to the amount of goods or services provided during the period which is
  covered by the account.
  Frequent errors: Un-reflected use of machine specifications
  A very common error, which i s difficult to detect in review, is to model the performance of a
  process based on some theory on how it operates and not verifying this with data from the
  process in real operation. For electrical equipment, sometimes the specified maximum power
  consumption (e.g. “10 kW”) is used, implicitly assuming to be the average consumption. This
  does not consider that the equipment is not running all the time and that when it runs it
  typically is running not on maximum load.
  In other cases of collecting the raw da ta, only concentration measurements for emissions
  are available. This applies e.g. to flue gas concentrations of priority air pollutants as required
  by legal authorities, to concentrations of specific pollutants in wastewater discharges , but
  also to produc t concentrations measurements in continuous processing operations.  In order
  to be of use in the data compilation for the inventory, concentrations must be translated to
  mass flows, and this requires information about the volume of the e.g. flue gas , wastewater,
  product flow  in which the concentration is measured. To relate the resulting numbers
  correctly to the reference flow, in a second step they must be scaled to the amount of
  product(s) of the process.
  Errors in this scaling including when converting a dditionally between units (e.g. from
  “ng/m3” to “kg”) can often be observed and must be carefully avoided. This is best done by
  documenting all the calculation steps from the raw data to the final inventory data e.g. in one
  spreadsheet. This also eases interim quality control, review, and later updating of the data
  set.
  Frequent errors: Unit conversion errors
  Unit conversion errors resulting in values being in the range of 1,000 or more too large (e.g.
  when interpreting kg instead of g or mg) are easily det ected. In the other direction, e.g.
  erroneously downscaling an e.g. PAH emission by a factor 1 ,000 or more is very difficult to
  detect as it does not peak out in the inventory analysis. Such cases need deeper expert
  inside to be observed as conspicuously low numbers.
  Even worst are errors of below one order of magnitude, as they can much easier pass
  unnoticed, while still rendering the data and conclusions invalid. One potential source for
  such errors is the use of the “.” and the “,” for decimal separator  that is handled differently in
  different regions and countries.
  Other unit conversion errors relate to using different unit systems (e.g. Imperial system to SI).

  --- Page 224 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  204
  Per default the SI units shall be used for reporting, while - depending on data availability -
  other units will be necessarily used when collecting raw data.

  Provisions: 7.4.2.9 From raw data to unit process inventory
  Note that these provisions are to be applied to each unit process separately, in case more than one is modelled
  (e.g. in the foreground system of an analysed system).
  I) SHALL - Correct scaling to the functional unit(s) / reference flow(s): Correct scaling
  to the functional unit(s) / reference flow(s) shall be ensured when converting the raw
  data to inventory flows.
  Note that the e .g. measured concentrations, annual numbers, relative stoichiometric data, yield
  percentages, etc. usually need to be mathematically processed to correctly relate to the functional unit of
  the unit process.
  II) MAY - Documentation of all steps:  It is recommended to document all data treatment
  steps from the raw data to the inventory flows  of the unit process , such as
  averaging/aggregation, scaling, unit -conversion etc. This substantially facilitates the
  review process in case questions come up and it eases lat er updating of the data set.
  Details see chapter 10 on reporting. [ISO+]
  7.4.2.10 Solving confidentiality issues
  (Refers to aspect of ISO 14044:2006 chapter 5.2)
  Confidentiality issues may occur in data collection and t hey need to be respected in view
  of protecting technology know -how and patent rights. Such issues occur both for the
  foreground system data of the process operator and its tier-one suppliers, but may also occur
  in background data in cases where there are only 1 or 2 producers in a country or region.
  In all such cases special confidentiality agreements may be necessary for data collection
  and modelling, but also review. This may in extreme cases involve that the processes or
  system is modelled in -house and the external review is equally done in -site, i.e. without
  sending out the sensitive unit process information.
  For publication purposes the use of (independently and externally reviewed) LCI result
  data sets (e.g. aggregated from cradle to gate) can in mos t cases fully address or sufficiently
  reduce the confidentiality concerns, as such data does not allow to derive sensitive details
  about the operations.  To ensure the necessary transparency for review, confidential
  information can be documented in a separa te "confidential report" that is made accessible
  only to the critical reviewers under confidentiality; see in chapter 10.3.4.
  Similar confidentiality issues of protecting know -how and ownership exists for data
  developed e.g. by consultants and research groups as secondary data providers. Equally
  here an independent external review can assure that the claimed data quality has actually
  been achieved and is correctly documented.

  Provisions: 7.4.2.10 Solving confidentiality issues
  I) MAY - Aggregation: Confidential and proprietary information can be protected by
  aggregation to LCI results data set and partly terminated system data sets. [ISO+]
  II) MAY - Confidential report: Transparency can be ensured by documenting confidential

  --- Page 225 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  205
  information in a separate "confidential report" that is made accessible only to the critical
  reviewers under confidentiality; see chapter 10.3.4.
  7.4.2.11 Interim quality control for improving data quality
  (Refers to aspects of ISO 14044:2006 chapters 4.3.3.2, 4.3.3.4 and in several other chapters)
  7.4.2.11.1 General approach
  Quality control of the collected data on unit process as well as in the context of the system
  is an important part of data collection. The approaches that can be app lied for this are the
  same as those foreseen for an external review and drawing on the procedures of chapter 9
  on interpretation. While these step as are in principle the same as the ones taken at the end
  of each iterative roun d of doing the LCI / LCA study, they can be applied in a less extensive
  way and only drawing on their aspects. The interim quality control can hence include:
   identifying significant issues,
   completeness check,
   sensitivity check, and
   consistency check.
  This way, the data sets' accuracy, completeness and precision can be improved already in
  parallel to data collection. This can limit the number of full iterative rounds needed to achieve
  the required or aimed at quality of the final results.
  Drawing on these steps, the following can be checked in parallel to data collection and
  modelling:
   Does the unit process inventory include all relevant product, waste and elementary
  flows that would be expected based on e.g. the input of processed materials, of the
  nature of transformations occurring in the process, and/or based on experience gained
  with similar processes? When doing so, make sure to reflect the required technological,
  geographical and time-related representativeness.
   Are the amounts of the individual flow s and of the chemical elements, energy and parts
  in the input and output in expected proportion to each other? There are often
  stoichiometric or other systematic relationships that can help to check whether
  measured data is plausible. Performing chemical element and energy balances, as well
  as cost balances between the input and the output of a unit process (and also LCI
  result) are key checks for improving data completeness, but also for identifying errors.
   Controls may also be based on impact assessment r esults that are calculated ad hoc
  for the process as well as for the whole system. They may reveal errors in the inventory
  results through showing unexpected high or low values of contributing elementary flows.
  It is also recommended to compare the LCIA re sults with data of the same or similar
  processes / systems from other sources to identify possible problems. However, this is
  only useful if the other sources are of high quality and especially high completeness. It
  must be avoided to assume completeness o f a data set only because it includes all
  flows that are found in a similar process from another source.
   On the system level, carefully check that methods have been applied consistently. This
  especially applies if combining data from different sources. Bot h for the steps from raw
  data to unit processes, but also and especially for combining LCI result data sets in a
  life cycle model.

  --- Page 226 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  206
   Critically check the findings and aim at clearly qualitatively and quantitatively explaining
  any observed discrepancies in th e inventory data. This can be done by consulting
  additional data sources or technical experts for the analysed process. They may also
  help to improve the data, at least qualitatively.
   It is recommended providing for each unit process data set an at least b rief internal
  quality control report on the above findings. If the process is intended to support
  comparative assertions (e.g. as background data set) it shall be accompanied by a
  third-party report, as also required in ISO 14044.
   Finally, reflect the fi ndings in the reported data set quality criteria. Make sure that the
  data set documentation appropriately describes the process and the finally achieved
  accuracy, precision, and completeness as well as any limitations.
  7.4.2.11.2 Obtaining better unit process data
  Identify and prioritise the need for obtaining better data
  Based on the above steps and for any still missing data or quantitative information, the
  following is recommended:
  To identify exactly which specific or higher quality data  needs to be collected or obtained,
  for the initially missing data "reasonably worst case" flows and values would be used. These
  can be obtained via expert judgment. E.g. an unknown "metal" emission could be "Lead"
  and/or "Arsenic" in case of a lead -zinc-ore roasting process, a mis sing "unspecific polymer
  part" could be an "injection moulded ABS or PUR" for a consumer electronic product. Note
  that this information and data is for the given case to be identified.
  Using these "reasonably worst case" approximations, LCI results and LCIA results are
  calculated for the compete system and a contribution analysis performed. Based on that, the
  most relevant flows and processes of this missing data/information are identified. If feasible
  and timely, this information can be used during data collection to better steer this step.
  Taking a system's perspective
  The procedure described above works directly on the level of the unit process and is
  straightforward for the flows' chemical elements‟ mass, energy, and cost and for other
  potentially releva nt emissions. For the final completeness assessment criteria, i.e. for
  quantifying the completeness of the data in terms of covered overall environmental impact,
  the environmental impacts related to the consumed goods and services of the unit process
  need to be included as well. This means that the unit process is first to be completed to a
  complete system over its life cycle. Using generic or average background data sets to
  complete this draft inventory, the completeness of the overall impact can be evalua ted, and
  the collection of better unit process data can be focussed on the main contributing goods and
  services, i.e. their exact specification and amount.
  This check is again supported by quantifying the share of data of different quality levels
  among the aggregated LCIA results, i.e. which share is of "high  quality", "basic quality" and
  which share only of "data estimate" quality, next to the share of lower quality data that is to
  be cut off (see more below).
  It is important to reiterate that completeness / cut-off criteria and precision / uncertainty
  calculations always relate to the final aggregation level of the developed data set:
  In the case the individual unit process data set is the deliverable of the LCI/LCA study, the
  procedure is as described a bove. However, any limited completeness in the background LCI
  data sets is not considered, as those were only added to complete the system and to identify
  the relevance of the product and waste flows of that unit process.

  --- Page 227 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  207
  Potential sources for data and information to fill gaps
  First step to deal with initially missing data is the attempt to measure/obtain the data at the
  process operator. If this fails, data can be obtained from a third-party LCI data provider.
  While data gaps are acceptable for purely me thodological studies, a complete lack of
  funds or time cannot be an excuse for data gaps: If relevant data gaps remain at the end of
  the LCI/LCA study, it cannot deliver quality results and may fail to answer the initial question.
  However, budgets are alwa ys limited and data gaps will often occur also in appropriately
  funded LCI/LCA study. At least t he following principle options exist for dealing with missing
  information:
   calculation from other, known information,
   using information from similar processes  or regions with similar process operation (and
  background processes in case of LCI results) or older data,
   estimate the value based on specific expertise,
   using methodologically not fully but sufficiently consistent data  (what mainly refers to
  LCI data sets for background use), or
   accept and document the gap.
  Which is the best solution , depends on the specific case: qualified estimates may be very
  accurate while using data from not sufficiently similar processes or regions may result in
  relevant errors. A good technical understanding of the process is indispensible to correctly
  deal with missing data. Measures taken are to be documented.
  Calculating data values
  Often available information can be combined to generate the missing information, e.g. by
  stoichiometrically calculating CO 2 emissions of an incineration process by multiplying the
  carbon content of the fuel with  the stoichiometrical factor 44/12, assuming a full
  combustion140.
  Completing the inventory via correlations
  Another approach is to improve incomplete but measured foreground data (which often
  has only few emitted substances measured) via correlation with further elementary and
  waste flows as well as consumables, services etc. from generic data of the same process,
  thereby completing and improving the inventory.
  Adjusting data from other countries / markets or from similar technologies
  Another principle possibility is to adjust existing data that represent a similar situation.
  However, to do so requires a very good understanding of which differ ences exist e.g. in the
  technology mix between two countries, which specific raw material basis is used, which raw
  gas treatment technologies are applied, etc. (and also which legal emission limits may
  apply). The number of aspects is very extensive and specific for each case.
  As was already highlighted in a frequent error box in chapter 6.8.3, it can be found often in
  practice that data receive just a basic adjustment (e.g. by replacing electricity background
  data) and are assumed to sufficiently represent another country. Without working together
  with technical experts of the respective sector and / or country, and without a systematic and
  case-wise adjusted approach such an adjustment can be expected to not result in sufficie nt
  data quality.

  140 I.e. 44 g per mol of CO2 divided by 12 g per mol of C.
---

## Chunk Identity

- Source: ILCD Handbook General Guide for LCA Detailed Guidance (2010)
- Source file: `1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf`
- Page range: 223-227
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 223 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  203
process is operated and are also enforced, they give an indication of the possibl e
maximum values of the amounts of these flows. [ISO+]
Note that legal limit values - also of the country where they originally apply - normally cannot be used as
inventory values, unless this is checked and justified for the modelled process and in line with the goal.
7.4.2.9 From raw data to unit process inventory
(Refers to aspects of ISO 14044:2006 chapter 4.3.3)
The amount of products produced by a production unit process (or of functions performed
in case of services) is required in order to relate the em issions and other flows to the
functional unit and reference flow of this unit process. In data collection often accounts are
available that report the total annual load of emissions and consumption of fuels, materials
and ancillary chemicals of a process or a plant. These annual account figures must be
quantitatively related to the amount of goods or services provided during the period which is
covered by the account.
Frequent errors: Un-reflected use of machine specifications
A very common error, which i s difficult to detect in review, is to model the performance of a
process based on some theory on how it operates and not verifying this with data from the
process in real operation. For electrical equipment, sometimes the specified maximum power
consumption (e.g. “10 kW”) is used, implicitly assuming to be the average consumption. This
does not consider that the equipment is not running all the time and that when it runs it
typically is running not on maximum load.
In other cases of collecting the raw da ta, only concentration measurements for emissions
are available. This applies e.g. to flue gas concentrations of priority air pollutants as required
by legal authorities, to concentrations of specific pollutants in wastewater discharges , but
also to produc t concentrations measurements in continuous processing operations.  In order
to be of use in the data compilation for the inventory, concentrations must be translated to
mass flows, and this requires information about the volume of the e.g. flue gas , wastewater,
product flow  in which the concentration is measured. To relate the resulting numbers
correctly to the reference flow, in a second step they must be scaled to the amount of
product(s) of the process.
Errors in this scaling including when converting a dditionally between units (e.g. from
“ng/m3” to “kg”) can often be observed and must be carefully avoided. This is best done by
documenting all the calculation steps from the raw data to the final inventory data e.g. in one
spreadsheet. This also eases interim quality control, review, and later updating of the data
set.
Frequent errors: Unit conversion errors
Unit conversion errors resulting in values being in the range of 1,000 or more too large (e.g.
when interpreting kg instead of g or mg) are easily det ected. In the other direction, e.g.
erroneously downscaling an e.g. PAH emission by a factor 1 ,000 or more is very difficult to
detect as it does not peak out in the inventory analysis. Such cases need deeper expert
inside to be observed as conspicuously low numbers.
Even worst are errors of below one order of magnitude, as they can much easier pass
unnoticed, while still rendering the data and conclusions invalid. One potential source for
such errors is the use of the “.” and the “,” for decimal separator  that is handled differently in
different regions and countries.
Other unit conversion errors relate to using different unit systems (e.g. Imperial system to SI).

--- Page 224 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  204
Per default the SI units shall be used for reporting, while - depending on data availability -
other units will be necessarily used when collecting raw data.

Provisions: 7.4.2.9 From raw data to unit process inventory
Note that these provisions are to be applied to each unit process separately, in case more than one is modelled
(e.g. in the foreground system of an analysed system).
I) SHALL - Correct scaling to the functional unit(s) / reference flow(s): Correct scaling
to the functional unit(s) / reference flow(s) shall be ensured when converting the raw
data to inventory flows.
Note that the e .g. measured concentrations, annual numbers, relative stoichiometric data, yield
percentages, etc. usually need to be mathematically processed to correctly relate to the functional unit of
the unit process.
II) MAY - Documentation of all steps:  It is recommended to document all data treatment
steps from the raw data to the inventory flows  of the unit process , such as
averaging/aggregation, scaling, unit -conversion etc. This substantially facilitates the
review process in case questions come up and it eases lat er updating of the data set.
Details see chapter 10 on reporting. [ISO+]
7.4.2.10 Solving confidentiality issues
(Refers to aspect of ISO 14044:2006 chapter 5.2)
Confidentiality issues may occur in data collection and t hey need to be respected in view
of protecting technology know -how and patent rights. Such issues occur both for the
foreground system data of the process operator and its tier-one suppliers, but may also occur
in background data in cases where there are only 1 or 2 producers in a country or region.
In all such cases special confidentiality agreements may be necessary for data collection
and modelling, but also review. This may in extreme cases involve that the processes or
system is modelled in -house and the external review is equally done in -site, i.e. without
sending out the sensitive unit process information.
For publication purposes the use of (independently and externally reviewed) LCI result
data sets (e.g. aggregated from cradle to gate) can in mos t cases fully address or sufficiently
reduce the confidentiality concerns, as such data does not allow to derive sensitive details
about the operations.  To ensure the necessary transparency for review, confidential
information can be documented in a separa te "confidential report" that is made accessible
only to the critical reviewers under confidentiality; see in chapter 10.3.4.
Similar confidentiality issues of protecting know -how and ownership exists for data
developed e.g. by consultants and research groups as secondary data providers. Equally
here an independent external review can assure that the claimed data quality has actually
been achieved and is correctly documented.

Provisions: 7.4.2.10 Solving confidentiality issues
I) MAY - Aggregation: Confidential and proprietary information can be protected by
aggregation to LCI results data set and partly terminated system data sets. [ISO+]
II) MAY - Confidential report: Transparency can be ensured by documenting confidential

--- Page 225 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  205
information in a separate "confidential report" that is made accessible only to the critical
reviewers under confidentiality; see chapter 10.3.4.
7.4.2.11 Interim quality control for improving data quality
(Refers to aspects of ISO 14044:2006 chapters 4.3.3.2, 4.3.3.4 and in several other chapters)
7.4.2.11.1 General approach
Quality control of the collected data on unit process as well as in the context of the system
is an important part of data collection. The approaches that can be app lied for this are the
same as those foreseen for an external review and drawing on the procedures of chapter 9
on interpretation. While these step as are in principle the same as the ones taken at the end
of each iterative roun d of doing the LCI / LCA study, they can be applied in a less extensive
way and only drawing on their aspects. The interim quality control can hence include:
 identifying significant issues,
 completeness check,
 sensitivity check, and
 consistency check.
This way, the data sets' accuracy, completeness and precision can be improved already in
parallel to data collection. This can limit the number of full iterative rounds needed to achieve
the required or aimed at quality of the final results.
Drawing on these steps, the following can be checked in parallel to data collection and
modelling:
 Does the unit process inventory include all relevant product, waste and elementary
flows that would be expected based on e.g. the input of processed materials, of the
nature of transformations occurring in the process, and/or based on experience gained
with similar processes? When doing so, make sure to reflect the required technological,
geographical and time-related representativeness.
 Are the amounts of the individual flow s and of the chemical elements, energy and parts
in the input and output in expected proportion to each other? There are often
stoichiometric or other systematic relationships that can help to check whether
measured data is plausible. Performing chemical element and energy balances, as well
as cost balances between the input and the output of a unit process (and also LCI
result) are key checks for improving data completeness, but also for identifying errors.
 Controls may also be based on impact assessment r esults that are calculated ad hoc
for the process as well as for the whole system. They may reveal errors in the inventory
results through showing unexpected high or low values of contributing elementary flows.
It is also recommended to compare the LCIA re sults with data of the same or similar
processes / systems from other sources to identify possible problems. However, this is
only useful if the other sources are of high quality and especially high completeness. It
must be avoided to assume completeness o f a data set only because it includes all
flows that are found in a similar process from another source.
 On the system level, carefully check that methods have been applied consistently. This
especially applies if combining data from different sources. Bot h for the steps from raw
data to unit processes, but also and especially for combining LCI result data sets in a
life cycle model.

--- Page 226 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  206
 Critically check the findings and aim at clearly qualitatively and quantitatively explaining
any observed discrepancies in th e inventory data. This can be done by consulting
additional data sources or technical experts for the analysed process. They may also
help to improve the data, at least qualitatively.
 It is recommended providing for each unit process data set an at least b rief internal
quality control report on the above findings. If the process is intended to support
comparative assertions (e.g. as background data set) it shall be accompanied by a
third-party report, as also required in ISO 14044.
 Finally, reflect the fi ndings in the reported data set quality criteria. Make sure that the
data set documentation appropriately describes the process and the finally achieved
accuracy, precision, and completeness as well as any limitations.
7.4.2.11.2 Obtaining better unit process data
Identify and prioritise the need for obtaining better data
Based on the above steps and for any still missing data or quantitative information, the
following is recommended:
To identify exactly which specific or higher quality data  needs to be collected or obtained,
for the initially missing data "reasonably worst case" flows and values would be used. These
can be obtained via expert judgment. E.g. an unknown "metal" emission could be "Lead"
and/or "Arsenic" in case of a lead -zinc-ore roasting process, a mis sing "unspecific polymer
part" could be an "injection moulded ABS or PUR" for a consumer electronic product. Note
that this information and data is for the given case to be identified.
Using these "reasonably worst case" approximations, LCI results and LCIA results are
calculated for the compete system and a contribution analysis performed. Based on that, the
most relevant flows and processes of this missing data/information are identified. If feasible
and timely, this information can be used during data collection to better steer this step.
Taking a system's perspective
The procedure described above works directly on the level of the unit process and is
straightforward for the flows' chemical elements‟ mass, energy, and cost and for other
potentially releva nt emissions. For the final completeness assessment criteria, i.e. for
quantifying the completeness of the data in terms of covered overall environmental impact,
the environmental impacts related to the consumed goods and services of the unit process
need to be included as well. This means that the unit process is first to be completed to a
complete system over its life cycle. Using generic or average background data sets to
complete this draft inventory, the completeness of the overall impact can be evalua ted, and
the collection of better unit process data can be focussed on the main contributing goods and
services, i.e. their exact specification and amount.
This check is again supported by quantifying the share of data of different quality levels
among the aggregated LCIA results, i.e. which share is of "high  quality", "basic quality" and
which share only of "data estimate" quality, next to the share of lower quality data that is to
be cut off (see more below).
It is important to reiterate that completeness / cut-off criteria and precision / uncertainty
calculations always relate to the final aggregation level of the developed data set:
In the case the individual unit process data set is the deliverable of the LCI/LCA study, the
procedure is as described a bove. However, any limited completeness in the background LCI
data sets is not considered, as those were only added to complete the system and to identify
the relevance of the product and waste flows of that unit process.

--- Page 227 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  207
Potential sources for data and information to fill gaps
First step to deal with initially missing data is the attempt to measure/obtain the data at the
process operator. If this fails, data can be obtained from a third-party LCI data provider.
While data gaps are acceptable for purely me thodological studies, a complete lack of
funds or time cannot be an excuse for data gaps: If relevant data gaps remain at the end of
the LCI/LCA study, it cannot deliver quality results and may fail to answer the initial question.
However, budgets are alwa ys limited and data gaps will often occur also in appropriately
funded LCI/LCA study. At least t he following principle options exist for dealing with missing
information:
 calculation from other, known information,
 using information from similar processes  or regions with similar process operation (and
background processes in case of LCI results) or older data,
 estimate the value based on specific expertise,
 using methodologically not fully but sufficiently consistent data  (what mainly refers to
LCI data sets for background use), or
 accept and document the gap.
Which is the best solution , depends on the specific case: qualified estimates may be very
accurate while using data from not sufficiently similar processes or regions may result in
relevant errors. A good technical understanding of the process is indispensible to correctly
deal with missing data. Measures taken are to be documented.
Calculating data values
Often available information can be combined to generate the missing information, e.g. by
stoichiometrically calculating CO 2 emissions of an incineration process by multiplying the
carbon content of the fuel with  the stoichiometrical factor 44/12, assuming a full
combustion140.
Completing the inventory via correlations
Another approach is to improve incomplete but measured foreground data (which often
has only few emitted substances measured) via correlation with further elementary and
waste flows as well as consumables, services etc. from generic data of the same process,
thereby completing and improving the inventory.
Adjusting data from other countries / markets or from similar technologies
Another principle possibility is to adjust existing data that represent a similar situation.
However, to do so requires a very good understanding of which differ ences exist e.g. in the
technology mix between two countries, which specific raw material basis is used, which raw
gas treatment technologies are applied, etc. (and also which legal emission limits may
apply). The number of aspects is very extensive and specific for each case.
As was already highlighted in a frequent error box in chapter 6.8.3, it can be found often in
practice that data receive just a basic adjustment (e.g. by replacing electricity background
data) and are assumed to sufficiently represent another country. Without working together
with technical experts of the respective sector and / or country, and without a systematic and
case-wise adjusted approach such an adjustment can be expected to not result in sufficie nt
data quality.

140 I.e. 44 g per mol of CO2 divided by 12 g per mol of C.
