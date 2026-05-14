---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook General Guide for LCA Detailed Guidance (2010) - chunk 080"
nodeId: "ilcd-handbook-general-guide-detailed-guidance-2010-chunk-080"
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
chunkIndex: 80
pageRange: "399-405"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 399 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  16 Annex E: Addressing uncertainties in LCA  379
  Ignorance
  A third source of uncertainty is the error at tributable to ignorance, i.e. the lack of
  knowledge about the system, leading to omission of data or incorrect assumptions about
  processes or elementary flows. Ignorance is related to choice uncertainty in the sense that it
  shows discrete behaviour but sin ce it is not realized, it cannot be dealt with in the way that
  choices are dealt with. It is not handled by quantitative uncertainty assessment, but may be
  revealed by a qualified peer review.
  16.3 Aggregating uncertainties over the life cycle
  Overview
  The st ochastic uncertainties of the inventory and assessment data must be known
  together with the important choice -related uncertainties in order to determine how they
  propagate into the final results of the LCA. For the stochastic uncertainties, the influence o n
  the stochastic uncertainty of final results can be assessed in two fundamentally different
  ways – through an analytical solution or through simulation. Both require knowledge about
  distribution type, mean and variation for the process and assessment data.
  Analytical solution
  When the inventory results are calculated disregarding the variation of the individual
  inventory data (i.e. just using the mean values), the result is the true mean value of final
  results, but this approach fails to give any information about the uncertainty of this mean. The
  analytical approach to meet this challenge develops an equation describing the distribution
  (and hence also variation) of the final results as function of the distributions of process data
  for all processes in th e system. The analytical solution becomes a very complex expression
  for even a simple system but it can be approximated with a Taylor series expressing the error
  on the results as a function of the error on the process data for each process. Although it ca n
  be simplified in this way, the analytical approach requires qualified simplifying assumptions in
  order to be operational for the types of systems normally modelled in LCAs. Therefore, the
  simulation approach is normally applied in software used for modelling of systems
  Simulation
  Simulation of the error on the total results of an LCA is typically done using a Monte Carlo
  approach. Each peace of inventory data is varied independently of the other inventory data
  around its mean following the distribution t hat is specified for it (type of distribution and
  measure of variation). A calculation of the inventory results is performed and stored, and the
  inventory data is varied again at random within the distributions to arrive at a new set of
  inventory results. The distribution of the calculated inventory results will approach the true
  distribution of the results when the number of calculations gets sufficiently high ( often above
  1000), and thus give an estimate of the variation around the mean for the final results.
  In Monte Carlo simulation it is a default assumption that all processes and elementary
  flows are independent and hence vary independently of each other, both within the system
  and among the systems that are compared in a comparative LCA. This is often  not the case
  as the processes may have a technically based mutual dependency or even be the same
  process occurring at different places in the system (e.g. for background processes like power
  production or transportation). Next to positive correlation also  negative correlation occurs.
  Rather than independent variation, these cases may have a high degree of co -variation
  which will tend to either reduce or increase the variation of the final results, and it must
  therefore be taken into account when setting up  the simulation, which is often not straight
  forward.

  --- Page 400 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  16 Annex E: Addressing uncertainties in LCA  380
  Choice-related variation
  The variation in the final results that is caused by choice -related differences must be
  handled by separate calculations for each combination of the identified relevant choices.
  Where the stochastic uncertainties can be handled and aggregated into one set of final
  results as described above, the choice -related variation thus leads to a number of discrete
  results that may be presented to the decision maker together with a specific ation of the
  underlying choices as possible outcomes of the LCA, dependent on which choices are made.
  In order to strengthen the decision -making support of the LCA results it is important to
  reduce the number of choices that are considered to the required minimum.
  A pragmatic approach
  Simulation using the Monte Carlo approach relies on the information on the distribution of
  the individual elementary flows that are provided by the LCA practitioner. It is often a
  challenge to provide good information about th e statistic distribution of all elementary flows
  for all processes in the system and this influences the quality of the statistic information
  provided by a Monte Carlo simulation.
  Sensitivity analysis is a useful tool to identify where good basic statisti c information is
  most needed. The processes and flows that contribute most to the final results are also the
  ones with the strongest potential to contribute to the uncertainty of the final results, and
  particularly for these key figures, it is thus crucial that the statistical information is correct.
  In the absence of tools to support a Monte Carlo simulation, an analysis of the uncertainty
  of the final results may still be performed along this line, using a sensitivity analysis to identify
  the key processe s, key elementary flows and key choices. For each of these, the potential
  variation is analysed and basically handled as discrete choices (for stochastic uncertainties
  as realistic worst case and realistic best case values) in a number of what -if calculations. The
  outcome in some cases allows an indicative answer to the question of the goal definition. In
  other cases the outcome is inconclusive meaning that a more detailed approach is needed in
  a new iteration, but then it helps focus the effort on some of the identified key data and
  assumptions.
  The earlier mentioned "reasonably best case" and "reasonably worst case" can be formed
  in this way and help to quantify approximately the range of results and hence the robustness
  of the results interpretation.

  --- Page 401 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  17 Annex F: System boundary template  381
  17 Annex F: System boundary template
  A system boundary diagram is essential to clarify which life cycle stages and processes
  have been included in the system model.
  Technical audience
  For technical audience it makes sense to have a more formalised diagram. The system
  boundary template of Figure 35  is also available as MS PowerPoint TM file for free use.  It
  contains graphical elements that represent the ecosphere, the technosphere, the main life
  cycle stages and sub -stages, sets of product and waste flows that enter or leave the system
  boundary from or to the rest of the technosphere, respectively, and sets of excluded activity
  types and processes that need to be explicitly listed in complementation of the diagram.
  Alternatively also other diagrams can be used (e.g. the one described below, that is also
  suitable for non -technical audience) as long as it correctly depicts the system boundary,
  names the fist and last process step in case of incomplete life cycle models, lists quantified
  but not fully modelled product and waste flows, and lists excluded items.
  Non-technical audience
  For non -technical audience it is equally useful to have a representation of what is
  included, while less formalised.
  The challenge is that a system boundary d iagram ideally should show all of the following:
  included life cycle stages, systematically excluded activity types and elementary flows,
  specifically excluded processes and elementary flows, and quantified but not completely
  modelled product and waste flows. For in-complete life cycles (e.g. cradle-to-gate) in addition
  the first and/or last included process step is to be identified.
  Especially to show a potentially large number of excluded activity types, processes, and
  flows would overload such a diagram . To provide guidance on a suitable diagram for non -
  technical audience that is not misleading on what is included / excluded, it is suggested to
  combine a diagram with lists of excluded items. The description of the diagram  shall state
  that it is schematic and incomplete (unless it would be complete, as possible e.g. in case of a
  single unit process). It would also refer to the lists of excluded items and state that in
  principle all relevant activities, processes and elementary flows are included in the lif e cycle
  model unless explicitly listed.
  .

  --- Page 402 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  17 Annex F: System boundary template  382
  Figure 35 System boundary  diagram template for technical audience . This example
  sketches a system (e.g. it could be a partly terminated system data set of an electric heater,
  excluding use stage but including the main recycling step). The diagram shows that the system
  includes the production stages up to the production of the final product plus the recycling /
  recovery, while excluding specific initial waste management steps (e.g. collection) an d final
  depositing. These excluded steps would be listed  separately, referring to  the boxes E in and
  Eout. The system also has at least one product or waste flow in the input (P in) that needs to be
  completed when using the data of that system. Additionally the fist and last process step of the
  end-of-life stage would need to be named to ensure correct use of the data set when
  completing the system.
  Ecosphere
  Rest of technosphere
  Production stage Use stage End-of-life stage
  Eout
  Ein
  Pin
  Uin
  Pout Uout
  Pin
  Eout
  Ein

  --- Page 403 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  18 Annex G: Development of this document  383
  18 Annex G: Development of this document
  Based on and considering the following documents
  The background document has been drafted taking into account amongst others the
  following existing sources:
  Harmonised ISO standards
   ISO 14040: 2006 Environmental management - Life cycle assessment – Principles and
  framework
   ISO 14044: 2006 Environmental management - Life cycle a ssessment - Requirements
  and guidelines
  A large number of LCA manuals of business associations, national LCA projects,
  consultants and research groups as well as scientific LCA publications have been analysed
  and taken into account. The detailed list is provided more below.
  Drafting
  This document was initially drafted by contractors (see list below) with support under the
  European Commission Joint Research Centre (JRC) contract no. contract no.  383136 F1SC
  concerning “Development of a technical guidance handbook on Life Cycle Assessment”.
  This work has been funded by the European Commission, partially supported through
  Commission-internal Administrative Arrangements (Nos 070402/2005/414023/G4,
  070402/2006/443456/G4, 070307/2007/474521/G4, and 070307/2008/5 13489/G4) between
  DG Environment and the Joint Research Centre.
  Invited stakeholder consultations
  An earlier draft version of this document has been distributed to more than 60
  organisations and groups.
  These include the 27  EU Member States, various European Commission (EC) services,
  National Life Cycle Database Initiatives outside the European Union, business associations
  as members of the Business Advisory Group, Life Cycle Assessment software and database
  developers and Life Cycle Impact Assessment meth od developers as members of the
  respective Advisory Groups, as well as other relevant institutions.
  Public consultation
  A public consultation was carried out on the advanced draft guidance document from June
  10, 2009 to August 31, 2009.
  This included a p ublic consultation workshop, which took place from June 29 to July 2,
  2009, in Brussels.

  Disclaimer: Involvement in the development or consultation process does not imply an
  agreement with or endorsement of this document.

  Overview of involved or consulted organisations and individuals
  The following organisations and individuals have been consulted or provided comments,
  inputs and feedback during the invited or public consultations in the development of this
  document:

  --- Page 404 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  18 Annex G: Development of this document  384
  Invited consultation
  Internal EU steering committee:
  - European Commission services (EC),
  - European Environment Agency (EEA),
  - European Committee for Standardization (CEN),
  - IPP Regular Meeting Representatives of the 27 EU Member States

  National database projects and international organisations:
  - United Nations Environment Programme, DTIE Department (UNEP-DTIE)
  - World Business Council for Sustainable Development (WBCSD)
  - Brazilian Institute for Informatics in Science and Technology (IBICT)
  - University of Brasilia (UnB)
  - China National Institute for Standardization (CNIS)
  - Sichuan University, Chengdu, China
  - Japan Environmental Management Association for Industry (JEMAI)
  - Research Center for Life Cycle Assessment (AIST), Japan
  - SIRIM-Berhad, Malaysia
  - National Metal and Material Technology Center (MTEC) , Focus Center on Life Cycle
  Assessment and EcoProduct Development, Thailand

  Advisory group members
  Business advisory group members:
  - Alliance for Beverage Cartons and the Environment (ACE)
  - Association of Plastics Manufacturers (PlasticsEurope)
  - Confederation of European Waste-to-Energy plants (CEWEP)
  - European Aluminium Association
  - European Automobile Manufacturers' Association (ACEA)
  - European Cement Association (CEMBUREAU)
  - European Confederation of Iron and Steel Industries (EUROFER)
  - European Copper Institute
  - European  Confederation of woodworking industries (CEI-Bois)
  - European Federation of Corrugated Board Manufacturers (FEFCO)
  - Industrial Minerals Association Europe (IMA Europe)
  - Lead Development Association International (LDAI)
  - Sustainable Landfill Foundation (SLF)
  - The Voice of the European Gypsum Industry (EUROGYPSUM)
  - Tiles and Bricks of Europe (TBE)
  - Technical Association of the European Natural Gas Industry (Marcogaz)


  Disclaimer: Involvement in the development or consultation process does not imply an
  agreement with or endorsement of this document.

  --- Page 405 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  18 Annex G: Development of this document  385
  LCA database and tool advisory group members:
  - BRE Building Research Establishment Ltd - Watford (United Kingdom)
  - CML Institute of Environmental Science, University of Leiden (The Netherlands)
  - CODDE Conception, Developement Durable, Environnement (now: Bureau Veritas)
  - Paris (France)
  - ecoinvent centre – (Switzerland)
  - ENEA – Bologna (Italy)
  - Forschungszentrum Karlsruhe GmbH - Eggenstein-Leopoldshafen (Germany)
  - Green Delta TC GmbH – Berlin (Germany)
  - Ifu Institut für Umweltinformatik GmbH – Hamburg (Germany)
  - IVL Swedish Environmental Research Institute – Stockholm (Sweden)
  - KCL Oy Keskuslaboratorio-Centrallaboratorium Ab – Espoo (Finland)
  - LBP, University Stuttgart (Germany)
  - LCA Center Denmark c/o FORCE Technology – Lyngby (Denmark)
  - LEGEP Software GmbH - Dachau (Germany)
  - PE International GmbH – Leinfelden-Echterdingen (Germany)
  - PRé Consultants – Amersfoort (The Netherlands)
  - Wuppertal Institut für Klima, Umwelt, Energie GmbH – Wuppertal (Germany)

  Life Cycle Impact Assessment advisory group members:
  - CIRAIG – Montreal (Canada)
  - CML Institute of Environmental Science, University of Leiden (The Netherlands)
  - Ecointesys Life Cycle Systems - Lausanne (Switzerland)
  - IVL Swedish Environmental Research Institute – Stockholm (Sweden)
  - PRé Consultants – Amersfoort (The Netherlands)
  - LCA Center Denmark – Lyngby (Denmark)
  - Musashi Institute of Technology (Japan)
  - Research Center for Life Cycle Assessment (AIST) (Japan)
  - U.S. Environmental Protection Agency (US EPA) (USA)

  Public consultation
  Contributors providing written feedback in the public consultation  ("General guide on LCA"
  and "Specific guide for LCI data sets")
  Organisations
  - French Environment and Energy Management Agency (ADEME)
  - Department for Environment, Food and Rural Affairs of the UK (DEFRA)
  - Federal Office for the Environment (FOEN) Switzerland
  - 2.-0 LCA Consultants (Denmark)
  - Alliance for Beverage Cartons and the Environment (ACE)

  Disclaimer: Involvement in the development or consultation process does not  imply an
  agreement with or endorsement of this document.
---

## Chunk Identity

- Source: ILCD Handbook General Guide for LCA Detailed Guidance (2010)
- Source file: `1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf`
- Page range: 399-405
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 399 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
16 Annex E: Addressing uncertainties in LCA  379
Ignorance
A third source of uncertainty is the error at tributable to ignorance, i.e. the lack of
knowledge about the system, leading to omission of data or incorrect assumptions about
processes or elementary flows. Ignorance is related to choice uncertainty in the sense that it
shows discrete behaviour but sin ce it is not realized, it cannot be dealt with in the way that
choices are dealt with. It is not handled by quantitative uncertainty assessment, but may be
revealed by a qualified peer review.
16.3 Aggregating uncertainties over the life cycle
Overview
The st ochastic uncertainties of the inventory and assessment data must be known
together with the important choice -related uncertainties in order to determine how they
propagate into the final results of the LCA. For the stochastic uncertainties, the influence o n
the stochastic uncertainty of final results can be assessed in two fundamentally different
ways – through an analytical solution or through simulation. Both require knowledge about
distribution type, mean and variation for the process and assessment data.
Analytical solution
When the inventory results are calculated disregarding the variation of the individual
inventory data (i.e. just using the mean values), the result is the true mean value of final
results, but this approach fails to give any information about the uncertainty of this mean. The
analytical approach to meet this challenge develops an equation describing the distribution
(and hence also variation) of the final results as function of the distributions of process data
for all processes in th e system. The analytical solution becomes a very complex expression
for even a simple system but it can be approximated with a Taylor series expressing the error
on the results as a function of the error on the process data for each process. Although it ca n
be simplified in this way, the analytical approach requires qualified simplifying assumptions in
order to be operational for the types of systems normally modelled in LCAs. Therefore, the
simulation approach is normally applied in software used for modelling of systems
Simulation
Simulation of the error on the total results of an LCA is typically done using a Monte Carlo
approach. Each peace of inventory data is varied independently of the other inventory data
around its mean following the distribution t hat is specified for it (type of distribution and
measure of variation). A calculation of the inventory results is performed and stored, and the
inventory data is varied again at random within the distributions to arrive at a new set of
inventory results. The distribution of the calculated inventory results will approach the true
distribution of the results when the number of calculations gets sufficiently high ( often above
1000), and thus give an estimate of the variation around the mean for the final results.
In Monte Carlo simulation it is a default assumption that all processes and elementary
flows are independent and hence vary independently of each other, both within the system
and among the systems that are compared in a comparative LCA. This is often  not the case
as the processes may have a technically based mutual dependency or even be the same
process occurring at different places in the system (e.g. for background processes like power
production or transportation). Next to positive correlation also  negative correlation occurs.
Rather than independent variation, these cases may have a high degree of co -variation
which will tend to either reduce or increase the variation of the final results, and it must
therefore be taken into account when setting up  the simulation, which is often not straight
forward.

--- Page 400 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
16 Annex E: Addressing uncertainties in LCA  380
Choice-related variation
The variation in the final results that is caused by choice -related differences must be
handled by separate calculations for each combination of the identified relevant choices.
Where the stochastic uncertainties can be handled and aggregated into one set of final
results as described above, the choice -related variation thus leads to a number of discrete
results that may be presented to the decision maker together with a specific ation of the
underlying choices as possible outcomes of the LCA, dependent on which choices are made.
In order to strengthen the decision -making support of the LCA results it is important to
reduce the number of choices that are considered to the required minimum.
A pragmatic approach
Simulation using the Monte Carlo approach relies on the information on the distribution of
the individual elementary flows that are provided by the LCA practitioner. It is often a
challenge to provide good information about th e statistic distribution of all elementary flows
for all processes in the system and this influences the quality of the statistic information
provided by a Monte Carlo simulation.
Sensitivity analysis is a useful tool to identify where good basic statisti c information is
most needed. The processes and flows that contribute most to the final results are also the
ones with the strongest potential to contribute to the uncertainty of the final results, and
particularly for these key figures, it is thus crucial that the statistical information is correct.
In the absence of tools to support a Monte Carlo simulation, an analysis of the uncertainty
of the final results may still be performed along this line, using a sensitivity analysis to identify
the key processe s, key elementary flows and key choices. For each of these, the potential
variation is analysed and basically handled as discrete choices (for stochastic uncertainties
as realistic worst case and realistic best case values) in a number of what -if calculations. The
outcome in some cases allows an indicative answer to the question of the goal definition. In
other cases the outcome is inconclusive meaning that a more detailed approach is needed in
a new iteration, but then it helps focus the effort on some of the identified key data and
assumptions.
The earlier mentioned "reasonably best case" and "reasonably worst case" can be formed
in this way and help to quantify approximately the range of results and hence the robustness
of the results interpretation.

--- Page 401 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
17 Annex F: System boundary template  381
17 Annex F: System boundary template
A system boundary diagram is essential to clarify which life cycle stages and processes
have been included in the system model.
Technical audience
For technical audience it makes sense to have a more formalised diagram. The system
boundary template of Figure 35  is also available as MS PowerPoint TM file for free use.  It
contains graphical elements that represent the ecosphere, the technosphere, the main life
cycle stages and sub -stages, sets of product and waste flows that enter or leave the system
boundary from or to the rest of the technosphere, respectively, and sets of excluded activity
types and processes that need to be explicitly listed in complementation of the diagram.
Alternatively also other diagrams can be used (e.g. the one described below, that is also
suitable for non -technical audience) as long as it correctly depicts the system boundary,
names the fist and last process step in case of incomplete life cycle models, lists quantified
but not fully modelled product and waste flows, and lists excluded items.
Non-technical audience
For non -technical audience it is equally useful to have a representation of what is
included, while less formalised.
The challenge is that a system boundary d iagram ideally should show all of the following:
included life cycle stages, systematically excluded activity types and elementary flows,
specifically excluded processes and elementary flows, and quantified but not completely
modelled product and waste flows. For in-complete life cycles (e.g. cradle-to-gate) in addition
the first and/or last included process step is to be identified.
Especially to show a potentially large number of excluded activity types, processes, and
flows would overload such a diagram . To provide guidance on a suitable diagram for non -
technical audience that is not misleading on what is included / excluded, it is suggested to
combine a diagram with lists of excluded items. The description of the diagram  shall state
that it is schematic and incomplete (unless it would be complete, as possible e.g. in case of a
single unit process). It would also refer to the lists of excluded items and state that in
principle all relevant activities, processes and elementary flows are included in the lif e cycle
model unless explicitly listed.
.

--- Page 402 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
17 Annex F: System boundary template  382
Figure 35 System boundary  diagram template for technical audience . This example
sketches a system (e.g. it could be a partly terminated system data set of an electric heater,
excluding use stage but including the main recycling step). The diagram shows that the system
includes the production stages up to the production of the final product plus the recycling /
recovery, while excluding specific initial waste management steps (e.g. collection) an d final
depositing. These excluded steps would be listed  separately, referring to  the boxes E in and
Eout. The system also has at least one product or waste flow in the input (P in) that needs to be
completed when using the data of that system. Additionally the fist and last process step of the
end-of-life stage would need to be named to ensure correct use of the data set when
completing the system.
Ecosphere
Rest of technosphere
Production stage Use stage End-of-life stage
Eout
Ein
Pin
Uin
Pout Uout
Pin
Eout
Ein

--- Page 403 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
18 Annex G: Development of this document  383
18 Annex G: Development of this document
Based on and considering the following documents
The background document has been drafted taking into account amongst others the
following existing sources:
Harmonised ISO standards
 ISO 14040: 2006 Environmental management - Life cycle assessment – Principles and
framework
 ISO 14044: 2006 Environmental management - Life cycle a ssessment - Requirements
and guidelines
A large number of LCA manuals of business associations, national LCA projects,
consultants and research groups as well as scientific LCA publications have been analysed
and taken into account. The detailed list is provided more below.
Drafting
This document was initially drafted by contractors (see list below) with support under the
European Commission Joint Research Centre (JRC) contract no. contract no.  383136 F1SC
concerning “Development of a technical guidance handbook on Life Cycle Assessment”.
This work has been funded by the European Commission, partially supported through
Commission-internal Administrative Arrangements (Nos 070402/2005/414023/G4,
070402/2006/443456/G4, 070307/2007/474521/G4, and 070307/2008/5 13489/G4) between
DG Environment and the Joint Research Centre.
Invited stakeholder consultations
An earlier draft version of this document has been distributed to more than 60
organisations and groups.
These include the 27  EU Member States, various European Commission (EC) services,
National Life Cycle Database Initiatives outside the European Union, business associations
as members of the Business Advisory Group, Life Cycle Assessment software and database
developers and Life Cycle Impact Assessment meth od developers as members of the
respective Advisory Groups, as well as other relevant institutions.
Public consultation
A public consultation was carried out on the advanced draft guidance document from June
10, 2009 to August 31, 2009.
This included a p ublic consultation workshop, which took place from June 29 to July 2,
2009, in Brussels.

Disclaimer: Involvement in the development or consultation process does not imply an
agreement with or endorsement of this document.

Overview of involved or consulted organisations and individuals
The following organisations and individuals have been consulted or provided comments,
inputs and feedback during the invited or public consultations in the development of this
document:

--- Page 404 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
18 Annex G: Development of this document  384
Invited consultation
Internal EU steering committee:
- European Commission services (EC),
- European Environment Agency (EEA),
- European Committee for Standardization (CEN),
- IPP Regular Meeting Representatives of the 27 EU Member States

National database projects and international organisations:
- United Nations Environment Programme, DTIE Department (UNEP-DTIE)
- World Business Council for Sustainable Development (WBCSD)
- Brazilian Institute for Informatics in Science and Technology (IBICT)
- University of Brasilia (UnB)
- China National Institute for Standardization (CNIS)
- Sichuan University, Chengdu, China
- Japan Environmental Management Association for Industry (JEMAI)
- Research Center for Life Cycle Assessment (AIST), Japan
- SIRIM-Berhad, Malaysia
- National Metal and Material Technology Center (MTEC) , Focus Center on Life Cycle
Assessment and EcoProduct Development, Thailand

Advisory group members
Business advisory group members:
- Alliance for Beverage Cartons and the Environment (ACE)
- Association of Plastics Manufacturers (PlasticsEurope)
- Confederation of European Waste-to-Energy plants (CEWEP)
- European Aluminium Association
- European Automobile Manufacturers' Association (ACEA)
- European Cement Association (CEMBUREAU)
- European Confederation of Iron and Steel Industries (EUROFER)
- European Copper Institute
- European  Confederation of woodworking industries (CEI-Bois)
- European Federation of Corrugated Board Manufacturers (FEFCO)
- Industrial Minerals Association Europe (IMA Europe)
- Lead Development Association International (LDAI)
- Sustainable Landfill Foundation (SLF)
- The Voice of the European Gypsum Industry (EUROGYPSUM)
- Tiles and Bricks of Europe (TBE)
- Technical Association of the European Natural Gas Industry (Marcogaz)


Disclaimer: Involvement in the development or consultation process does not imply an
agreement with or endorsement of this document.

--- Page 405 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
18 Annex G: Development of this document  385
LCA database and tool advisory group members:
- BRE Building Research Establishment Ltd - Watford (United Kingdom)
- CML Institute of Environmental Science, University of Leiden (The Netherlands)
- CODDE Conception, Developement Durable, Environnement (now: Bureau Veritas)
- Paris (France)
- ecoinvent centre – (Switzerland)
- ENEA – Bologna (Italy)
- Forschungszentrum Karlsruhe GmbH - Eggenstein-Leopoldshafen (Germany)
- Green Delta TC GmbH – Berlin (Germany)
- Ifu Institut für Umweltinformatik GmbH – Hamburg (Germany)
- IVL Swedish Environmental Research Institute – Stockholm (Sweden)
- KCL Oy Keskuslaboratorio-Centrallaboratorium Ab – Espoo (Finland)
- LBP, University Stuttgart (Germany)
- LCA Center Denmark c/o FORCE Technology – Lyngby (Denmark)
- LEGEP Software GmbH - Dachau (Germany)
- PE International GmbH – Leinfelden-Echterdingen (Germany)
- PRé Consultants – Amersfoort (The Netherlands)
- Wuppertal Institut für Klima, Umwelt, Energie GmbH – Wuppertal (Germany)

Life Cycle Impact Assessment advisory group members:
- CIRAIG – Montreal (Canada)
- CML Institute of Environmental Science, University of Leiden (The Netherlands)
- Ecointesys Life Cycle Systems - Lausanne (Switzerland)
- IVL Swedish Environmental Research Institute – Stockholm (Sweden)
- PRé Consultants – Amersfoort (The Netherlands)
- LCA Center Denmark – Lyngby (Denmark)
- Musashi Institute of Technology (Japan)
- Research Center for Life Cycle Assessment (AIST) (Japan)
- U.S. Environmental Protection Agency (US EPA) (USA)

Public consultation
Contributors providing written feedback in the public consultation  ("General guide on LCA"
and "Specific guide for LCI data sets")
Organisations
- French Environment and Energy Management Agency (ADEME)
- Department for Environment, Food and Rural Affairs of the UK (DEFRA)
- Federal Office for the Environment (FOEN) Switzerland
- 2.-0 LCA Consultants (Denmark)
- Alliance for Beverage Cartons and the Environment (ACE)

Disclaimer: Involvement in the development or consultation process does not  imply an
agreement with or endorsement of this document.
