---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook General Guide for LCA Detailed Guidance (2010) - chunk 051"
nodeId: "ilcd-handbook-general-guide-detailed-guidance-2010-chunk-051"
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
chunkIndex: 51
pageRange: "247-250"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 247 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  227
  Also, no incentive would exist to temporarily store the CO 2 e.g. in the wooden beams of the
  house in the above example.
  On the other hand does temporary storage of CO 2 and the delayed emissions not
  consider that the CO2 will in any case exert its full radiative effect, only later. For that reason
  carbon storage should only be considered quantitatively if this is explicitly required to meet
  the needs of the goal of the study. Otherwise, i.e. per default , temporary carbon storage and
  the equivalent delayed emissions and delayed reuse/recycling/recovery within the first 100
  years from the time of the study shall not be considered quantitatively.
  Note that the provided inventorying solution allows to do bo th with the same data set, as
  the storage / delay information is inventoried as separate inventory item:
  Modelling / inventorying provisions and examples:
  To account for this and to at the same time ensure a transparent, plausible, and practice -
  applicable life cycle inventory, the following provisions are made:
  As all emissions that occur within the next 100 years from the year of the analysis are
  inventoried as normal elementary flows, and all emissions that occur after 100 hundred years
  are inventoried as long -term emissions, simply a correction elementary flow of
  storage/delayed emission can be introduced for each contributing substance.
  For fossil carbon dioxide this flow is named "Correction flow for delayed emission of fossil
  carbon dioxide (within first 100 years)" as “ Emissions to  air”. It is  measured in the flow
  property “Mass*years” and the reference unit “kg*a”. The flow is to carry a GWP 100 impact
  factor of “ -0.01 kg CO 2-equivalents” per 1 kg*a. The information about the assumed time o
  emission and the actual amount of the emission shall be documented in the unit process and
  hence available for review. Flows for biogenic (i.e. temporarily stored) carbon dioxide and
  methane, but also for other, fossil greenhouse gases with delayed emissions can be
  developed analogously.
  These new elementary flow s should be used in addition to the normal elementary flows
  including the flow “Carbon dioxide” as “Resources from air” that model the physical uptake of
  CO2 into biomass.
  A quantitative example: In the case of the above example of the end -of-life of a newly
  build house that is assumed to be demolished in 80 years, releasing the stored e.g. 4 tons of
  carbon in the 10 tons of wood beams as CO 2 would carry the following inventory flows and
  values:
   Inputs:
  - 4,000*44/12 = 14,666 kg “Carbon dioxide” as “Resources from air”
   Outputs:
  - 4,000*44/12 = 14666 kg “Carbon dioxide (biogenic)” as “Emissions to air”
  - 4,000*44/12*80 = 1 ,173,333 kg*a “Correction flow for delayed emission of biogenic
  carbon dioxide (within first 100 years)” as “Emissions to air”
  In an impact assessment the result would be calculated as follows, with the biological
  uptake and release of the carbon dioxide cancelling each other out 151, giving a correct
  resulting GWP 100 benefit for the 80 years stor age, as 1 ,173,333 kg*a * -0.01 kg CO 2-
  eq./(kg*a) = -11,733.33 kg CO2-eq.

  151  Note that this works independently whether both have a GWP factor assigned or both not. That means that
  both modelling approaches can be supported by the mechanism of the CO2  temporary storage flow.

  --- Page 248 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  228
  Note that in the above example in total a negative Climate change effect is accounted for
  in the LCIA results, if considering the short -term perspective. If however the indefinite
  perspective would be considered, being the default perspective under the ILCD, the delayed
  emissions are not considered.
  Note that this approach is applicable also to wood from primary forests  that is used as
  wood product for a certain time: in case the fore st is effectively removed and e.g. a pasture
  established this loss of C -storage is already addressed via the provisions for land
  transformation, i.e. not accounting for the CO 2 uptake from air . Equally is the calculation
  applicable to temporal storage of CO2 in landfilled bio-based materials.
  An example for delayed fossil CO 2 emissions: In the case of a delayed emission of fossil
  greenhouse gases, for clarity assuming the above example of the house would have e.g. 4
  tons of fossil carbon in it, e.g. in insulation material and window frames, the example looks as
  follows:
   Inputs:
  - (none, as the CO2 is fossil)
   Outputs:
  - 4,000*44/12 = 14,666 kg “Carbon dioxide (fossil)” as “Emissions to air”
  - 4,000*44/12*80 = 1 ,173,333 kg*a “Correction flow for delayed emission of fossil
  carbon dioxide (within first 100 years)” as “Emissions to air”
  In an impact assessment the result would be calculated as follows, with the correction for
  the delayed emissions partly (here by - 80 % as the storage time is 80 years) compensating
  the release of fossil CO 2, giving a correct resulting GWP 100 result for the 80 years delayed
  emission, as 14 ,666 kg CO2-eq. + 1 ,173,333 kg*a * -0.01 kg CO 2-eq./(kg*a) = +2 ,932.67 kg
  CO2-eq.
  Hence, in comparison, the biogenic wood has still its full advantage  of having extracted
  CO2 from the atmosphere, while the delayed emissions are a benefit that both systems have
  in common (note that the difference between both examples is 14666 kg CO2-eq.).
  The above works analogously with Nitrous oxide and other greenhouse gases.
  Note that for the use stage of long -living goods the inventory would contain the integral of
  the emissions at different ages. This can be simplified in the common case that the use stage
  emissions are the same for all years: the total amount of u se stage emissions would be
  multiplied with half of the assumed life time years.

  The maximum amount of each correction flow that can be inventoried per kg delayed
  emission shall be 100 kg*a. That is if the delayed emission takes place exactly 100 years into
  the future.
  The correction flow shall be inventoried only if the emission is forecasted to take place at
  a maximum of 100 years into the future from the time of study. It shall not be inventoried if
  the emission takes place beyond the 100 years : An emission that takes place more than 100
  years into the future shall be reflected in the inventory exclusively by inventorying the future
  emissions with the long -term emission elementary flows such as e.g. “Carbon dioxide,
  biogenic (long-term)” as “Emissions to air”. I.e. in that case no correction flow is required but
  would be wrong (see footnote 155).

  --- Page 249 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  229
  Substitution / crediting for general cases of multifunctionality and for reuse / recycling
  / recovery that take place in the future
  In analogy to rewarding delayed emissions of greenhouse gases with credits, also
  substitution when solving general cases of multifunctionality need to consider the delay, e.g.
  when crediting the benefit of a co-product that supersedes an alternative production. This is if
  the temporary storage is considered in the first place as it is required to meet the specific
  goal of the study.
  The provisions for delayed greenhouse gas emissions apply analogously, i.e. respective
  "Correction flows.. ." sh ould be inventoried with negative values. This results in a positive
  value (i.e. additional impact) for the Climate change impacts.
  In analogy to treating general cases of multifunctionality , the delayed substitution for
  reused parts/goods, recycled materials and recovered energy needs to consider the delay.
  7.4.3.7.4 Long-term storage of potential emissions beyond 100 years
  In the case  the CO2-storage in goods, landfills or dedicated e.g. underground storages is
  longer than 100 years and the emission occurs s omewhen in the future beyond 100 years,
  the maximum accountable CO 2-removal of 100 years storage is inventoried as detailed
  above.
  The quasi -permanent storage of CO 2 and generally of potential emissions  in dedicated
  long-term storage forms (e.g. injection into former natur al gas fields ) is accounted for by
  inventorying no emissions, if the respective storage form can "guarantee" according to
  current scientific knowledge, and under independent external and qualified expert review,
  that the substance is not emitted for at least 100,000 years (number set by convention).
  (Partial) emissions before that time are inventoried as long -term CO2-emission elementary
  flows; emissions within the first 100 years are inventoried as normal CO2 emissions.

  Provisions: 7.4.3.7 Future processes and elementary flows
  Implicitly differentiated for attributional and consequential modelling.
  V) SHALL - Separate inventory items for emissions more than 100 years into the
  future: Emissions and other elementary flows that occur beyond t he next 100 years
  from the time of the LCI/LCA study shall be inventoried separately  (e.g. as “Emissions
  to water, unspecified (long -term)”) from those that occur within the first 100 years (e.g.
  “Emissions to water, unspecified”). [ISO!]
  Note that the IL CD reference elementary flows include a set of such long -term emissions to air, water and
  soil.
  VI) SHALL - Uptake of “Carbon dioxide” by plants : This shall be inventoried under
  “Resources from air”. This applies to all photosynthetic organisms. [ISO!]
  Note that both the uptake of CO 2 from the atmosphere and the release of both fossil and biogenic CO 2
  should be assigned characterisation factors for the impact assessment. The lack of knowledge whether a
  carbon dioxide or methane emission is biogenic or fossil (i.e. inventoried as e.g. "Carbon dioxide
  (unspecified)") therefore does not render the results erroneous.
  VII) SHALL - Inventory temporary carbon storage and delayed GHG emissions:  If
  "temporary carbon storage in bio-based goods" is considered, the temporary removal of
  carbon dioxide from the atmosphere, storage in long -living bio -based products or
  landfills, and delayed emission as CO2 or CH4 shall be modelled analogously to delayed
  emissions of fossil carbon dioxide and other greenhouse gases. The difference  is that

  --- Page 250 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  230
  Provisions: 7.4.3.7 Future processes and elementary flows
  for fossil emissions the uptake from the atmosphere is not considered, but only the
  delayed emission152. See also chapter 9 on interpretation and note that the temporary
  storage shall only be considered i f explicitly required to meet the specific goal of the
  study. If this is the case, it shall both be modelled as follows: [ISO+]
  VII.a) Special correction elementary flows shall be used to inventory the amount of CO 2
  that is emitted in the future. This can be bot h due to temporary storage as
  embodied biogenic carbon in long -living and land-filled bio-based goods and due
  to processes with fossil GHG emissions that take place in the future. If this is
  done, the following correction flows shall be used:
  VII.a.i) “Correction flow for delayed emission of biogenic carbon dioxide (within
  first 100 years)” and "Correction flow for delayed emission of fossil
  carbon dioxide (within first 100 years)", respectively. Both as elementary
  flows and classified on the general level as "Emis sions", measured in the
  reference flow property “Mass*years” of storage and the reference unit
  “kg*a”. Both flows shall carry a GWP100 impact factor of “ -0.01 kg CO 2-
  equivalents” per 1 kg carbon dioxide and 1 year of storage/delayed
  emission; this exclusiv ely if "temporary carbon storage" is considered in
  the study.
  VII.a.ii) “Correction flow for delayed emission of biogenic methane (within first
  100 years)” and “Correction flow for delayed emission of fossil methane
  (within first 100 years)”, respectively. Both as  elementary flow and
  classified on the general level as "Emissions", measured in the reference
  flow property “Mass*years” of storage and the reference unit “kg*a”. Both
  flows shall carry a GWP100 impact factor of “ -0.25153,154 kg CO 2-

  152 The logic behind accounting for biogenic carbon storage is tha t for the duration of storage the CO 2 is not
  exerting a radiative forcing. This makes sense only in case near -term radiative forcing is considered more
  relevant than future radiative forcing, as the later re -emitted biogenic CO 2 will still exert its full r adiative forcing
  effect, only later. That is reflected by the commonly used one hundred years perspective for GWP100: the higher
  radiative forcing per unit (kg) of e.g. Methane and Nitrous oxide is weighted higher then the relatively lower
  radiative forcin g per unit of CO 2, always for 100 years. To reward the temporary removal of CO 2 from the
  atmosphere is fully equivalent to the effect of avoided radiative forcing due to delayed emission of fossil carbon
  dioxide, methane, nitrous oxide, and other greenhous e gases: While the uptake of CO 2 from the atmosphere is
  unique for biomass and considered in the impact assessment as negative impact, it does not matter whether one
  burns a block of wood or of plastic and releases the CO 2 as emission: both biogenic and fossil CO2 are identically
  contributing to radiative forcing when emitted. For Climate change it is the same whether one keeps a piece of
  wood or of plastic unburned for e.g. 60 years. If the time when an emission takes place is considered for biomass
  it mus t also be considered for fossil materials. Some examples/aspects: Note that on a net basis temporarily
  stored biogenic carbon has a negative Climate Change impact: at 60 years storage of e.g. 1 kg CO 2: CO2 uptake
  (negative value -1 kg CO 2-eq.) plus emissio n after 60 years (+1 kg CO 2-eq.) minus the credit for 60 years
  temporary storage, = -1 + 1 - 0.6 = -0.6 kg CO 2-equiv. in total. For delayed fossil emissions the net impact is
  always positive: CO 2 emission minus credit for 60 years delayed emission, e.g. fo r 1 kg CO 2 = 1 - 0.6 = 0.4 kg
  CO2-equiv. in total. Note that the difference between biogenic and fossil delayed emissions for the same time of
  delay is always the same (i.e. 1 kg CO 2-equiv. difference per kg CO 2 emitted), rewarding both biogenic carbon
  storage and long-living products.
  153 This factor uses the IPCC GWP100 factors of 2007 by multiplying the base -value for carbon dioxide of 0.01
  with the substance -specific factor (e.g. 25 for methane, 298 for nitrous oxide (laughing gas, N 2O)). The
  substance-specific factor shall be adjusted in line with any ILCD recommendations on LCIA methods or updated
  factors from the IPCC if the former is not available.
---

## Chunk Identity

- Source: ILCD Handbook General Guide for LCA Detailed Guidance (2010)
- Source file: `1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf`
- Page range: 247-250
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 247 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  227
Also, no incentive would exist to temporarily store the CO 2 e.g. in the wooden beams of the
house in the above example.
On the other hand does temporary storage of CO 2 and the delayed emissions not
consider that the CO2 will in any case exert its full radiative effect, only later. For that reason
carbon storage should only be considered quantitatively if this is explicitly required to meet
the needs of the goal of the study. Otherwise, i.e. per default , temporary carbon storage and
the equivalent delayed emissions and delayed reuse/recycling/recovery within the first 100
years from the time of the study shall not be considered quantitatively.
Note that the provided inventorying solution allows to do bo th with the same data set, as
the storage / delay information is inventoried as separate inventory item:
Modelling / inventorying provisions and examples:
To account for this and to at the same time ensure a transparent, plausible, and practice -
applicable life cycle inventory, the following provisions are made:
As all emissions that occur within the next 100 years from the year of the analysis are
inventoried as normal elementary flows, and all emissions that occur after 100 hundred years
are inventoried as long -term emissions, simply a correction elementary flow of
storage/delayed emission can be introduced for each contributing substance.
For fossil carbon dioxide this flow is named "Correction flow for delayed emission of fossil
carbon dioxide (within first 100 years)" as “ Emissions to  air”. It is  measured in the flow
property “Mass*years” and the reference unit “kg*a”. The flow is to carry a GWP 100 impact
factor of “ -0.01 kg CO 2-equivalents” per 1 kg*a. The information about the assumed time o
emission and the actual amount of the emission shall be documented in the unit process and
hence available for review. Flows for biogenic (i.e. temporarily stored) carbon dioxide and
methane, but also for other, fossil greenhouse gases with delayed emissions can be
developed analogously.
These new elementary flow s should be used in addition to the normal elementary flows
including the flow “Carbon dioxide” as “Resources from air” that model the physical uptake of
CO2 into biomass.
A quantitative example: In the case of the above example of the end -of-life of a newly
build house that is assumed to be demolished in 80 years, releasing the stored e.g. 4 tons of
carbon in the 10 tons of wood beams as CO 2 would carry the following inventory flows and
values:
 Inputs:
- 4,000*44/12 = 14,666 kg “Carbon dioxide” as “Resources from air”
 Outputs:
- 4,000*44/12 = 14666 kg “Carbon dioxide (biogenic)” as “Emissions to air”
- 4,000*44/12*80 = 1 ,173,333 kg*a “Correction flow for delayed emission of biogenic
carbon dioxide (within first 100 years)” as “Emissions to air”
In an impact assessment the result would be calculated as follows, with the biological
uptake and release of the carbon dioxide cancelling each other out 151, giving a correct
resulting GWP 100 benefit for the 80 years stor age, as 1 ,173,333 kg*a * -0.01 kg CO 2-
eq./(kg*a) = -11,733.33 kg CO2-eq.

151  Note that this works independently whether both have a GWP factor assigned or both not. That means that
both modelling approaches can be supported by the mechanism of the CO2  temporary storage flow.

--- Page 248 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  228
Note that in the above example in total a negative Climate change effect is accounted for
in the LCIA results, if considering the short -term perspective. If however the indefinite
perspective would be considered, being the default perspective under the ILCD, the delayed
emissions are not considered.
Note that this approach is applicable also to wood from primary forests  that is used as
wood product for a certain time: in case the fore st is effectively removed and e.g. a pasture
established this loss of C -storage is already addressed via the provisions for land
transformation, i.e. not accounting for the CO 2 uptake from air . Equally is the calculation
applicable to temporal storage of CO2 in landfilled bio-based materials.
An example for delayed fossil CO 2 emissions: In the case of a delayed emission of fossil
greenhouse gases, for clarity assuming the above example of the house would have e.g. 4
tons of fossil carbon in it, e.g. in insulation material and window frames, the example looks as
follows:
 Inputs:
- (none, as the CO2 is fossil)
 Outputs:
- 4,000*44/12 = 14,666 kg “Carbon dioxide (fossil)” as “Emissions to air”
- 4,000*44/12*80 = 1 ,173,333 kg*a “Correction flow for delayed emission of fossil
carbon dioxide (within first 100 years)” as “Emissions to air”
In an impact assessment the result would be calculated as follows, with the correction for
the delayed emissions partly (here by - 80 % as the storage time is 80 years) compensating
the release of fossil CO 2, giving a correct resulting GWP 100 result for the 80 years delayed
emission, as 14 ,666 kg CO2-eq. + 1 ,173,333 kg*a * -0.01 kg CO 2-eq./(kg*a) = +2 ,932.67 kg
CO2-eq.
Hence, in comparison, the biogenic wood has still its full advantage  of having extracted
CO2 from the atmosphere, while the delayed emissions are a benefit that both systems have
in common (note that the difference between both examples is 14666 kg CO2-eq.).
The above works analogously with Nitrous oxide and other greenhouse gases.
Note that for the use stage of long -living goods the inventory would contain the integral of
the emissions at different ages. This can be simplified in the common case that the use stage
emissions are the same for all years: the total amount of u se stage emissions would be
multiplied with half of the assumed life time years.

The maximum amount of each correction flow that can be inventoried per kg delayed
emission shall be 100 kg*a. That is if the delayed emission takes place exactly 100 years into
the future.
The correction flow shall be inventoried only if the emission is forecasted to take place at
a maximum of 100 years into the future from the time of study. It shall not be inventoried if
the emission takes place beyond the 100 years : An emission that takes place more than 100
years into the future shall be reflected in the inventory exclusively by inventorying the future
emissions with the long -term emission elementary flows such as e.g. “Carbon dioxide,
biogenic (long-term)” as “Emissions to air”. I.e. in that case no correction flow is required but
would be wrong (see footnote 155).

--- Page 249 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  229
Substitution / crediting for general cases of multifunctionality and for reuse / recycling
/ recovery that take place in the future
In analogy to rewarding delayed emissions of greenhouse gases with credits, also
substitution when solving general cases of multifunctionality need to consider the delay, e.g.
when crediting the benefit of a co-product that supersedes an alternative production. This is if
the temporary storage is considered in the first place as it is required to meet the specific
goal of the study.
The provisions for delayed greenhouse gas emissions apply analogously, i.e. respective
"Correction flows.. ." sh ould be inventoried with negative values. This results in a positive
value (i.e. additional impact) for the Climate change impacts.
In analogy to treating general cases of multifunctionality , the delayed substitution for
reused parts/goods, recycled materials and recovered energy needs to consider the delay.
7.4.3.7.4 Long-term storage of potential emissions beyond 100 years
In the case  the CO2-storage in goods, landfills or dedicated e.g. underground storages is
longer than 100 years and the emission occurs s omewhen in the future beyond 100 years,
the maximum accountable CO 2-removal of 100 years storage is inventoried as detailed
above.
The quasi -permanent storage of CO 2 and generally of potential emissions  in dedicated
long-term storage forms (e.g. injection into former natur al gas fields ) is accounted for by
inventorying no emissions, if the respective storage form can "guarantee" according to
current scientific knowledge, and under independent external and qualified expert review,
that the substance is not emitted for at least 100,000 years (number set by convention).
(Partial) emissions before that time are inventoried as long -term CO2-emission elementary
flows; emissions within the first 100 years are inventoried as normal CO2 emissions.

Provisions: 7.4.3.7 Future processes and elementary flows
Implicitly differentiated for attributional and consequential modelling.
V) SHALL - Separate inventory items for emissions more than 100 years into the
future: Emissions and other elementary flows that occur beyond t he next 100 years
from the time of the LCI/LCA study shall be inventoried separately  (e.g. as “Emissions
to water, unspecified (long -term)”) from those that occur within the first 100 years (e.g.
“Emissions to water, unspecified”). [ISO!]
Note that the IL CD reference elementary flows include a set of such long -term emissions to air, water and
soil.
VI) SHALL - Uptake of “Carbon dioxide” by plants : This shall be inventoried under
“Resources from air”. This applies to all photosynthetic organisms. [ISO!]
Note that both the uptake of CO 2 from the atmosphere and the release of both fossil and biogenic CO 2
should be assigned characterisation factors for the impact assessment. The lack of knowledge whether a
carbon dioxide or methane emission is biogenic or fossil (i.e. inventoried as e.g. "Carbon dioxide
(unspecified)") therefore does not render the results erroneous.
VII) SHALL - Inventory temporary carbon storage and delayed GHG emissions:  If
"temporary carbon storage in bio-based goods" is considered, the temporary removal of
carbon dioxide from the atmosphere, storage in long -living bio -based products or
landfills, and delayed emission as CO2 or CH4 shall be modelled analogously to delayed
emissions of fossil carbon dioxide and other greenhouse gases. The difference  is that

--- Page 250 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
7 Life Cycle Inventory analysis - collecting data, modelling the system, calculating results  230
Provisions: 7.4.3.7 Future processes and elementary flows
for fossil emissions the uptake from the atmosphere is not considered, but only the
delayed emission152. See also chapter 9 on interpretation and note that the temporary
storage shall only be considered i f explicitly required to meet the specific goal of the
study. If this is the case, it shall both be modelled as follows: [ISO+]
VII.a) Special correction elementary flows shall be used to inventory the amount of CO 2
that is emitted in the future. This can be bot h due to temporary storage as
embodied biogenic carbon in long -living and land-filled bio-based goods and due
to processes with fossil GHG emissions that take place in the future. If this is
done, the following correction flows shall be used:
VII.a.i) “Correction flow for delayed emission of biogenic carbon dioxide (within
first 100 years)” and "Correction flow for delayed emission of fossil
carbon dioxide (within first 100 years)", respectively. Both as elementary
flows and classified on the general level as "Emis sions", measured in the
reference flow property “Mass*years” of storage and the reference unit
“kg*a”. Both flows shall carry a GWP100 impact factor of “ -0.01 kg CO 2-
equivalents” per 1 kg carbon dioxide and 1 year of storage/delayed
emission; this exclusiv ely if "temporary carbon storage" is considered in
the study.
VII.a.ii) “Correction flow for delayed emission of biogenic methane (within first
100 years)” and “Correction flow for delayed emission of fossil methane
(within first 100 years)”, respectively. Both as  elementary flow and
classified on the general level as "Emissions", measured in the reference
flow property “Mass*years” of storage and the reference unit “kg*a”. Both
flows shall carry a GWP100 impact factor of “ -0.25153,154 kg CO 2-

152 The logic behind accounting for biogenic carbon storage is tha t for the duration of storage the CO 2 is not
exerting a radiative forcing. This makes sense only in case near -term radiative forcing is considered more
relevant than future radiative forcing, as the later re -emitted biogenic CO 2 will still exert its full r adiative forcing
effect, only later. That is reflected by the commonly used one hundred years perspective for GWP100: the higher
radiative forcing per unit (kg) of e.g. Methane and Nitrous oxide is weighted higher then the relatively lower
radiative forcin g per unit of CO 2, always for 100 years. To reward the temporary removal of CO 2 from the
atmosphere is fully equivalent to the effect of avoided radiative forcing due to delayed emission of fossil carbon
dioxide, methane, nitrous oxide, and other greenhous e gases: While the uptake of CO 2 from the atmosphere is
unique for biomass and considered in the impact assessment as negative impact, it does not matter whether one
burns a block of wood or of plastic and releases the CO 2 as emission: both biogenic and fossil CO2 are identically
contributing to radiative forcing when emitted. For Climate change it is the same whether one keeps a piece of
wood or of plastic unburned for e.g. 60 years. If the time when an emission takes place is considered for biomass
it mus t also be considered for fossil materials. Some examples/aspects: Note that on a net basis temporarily
stored biogenic carbon has a negative Climate Change impact: at 60 years storage of e.g. 1 kg CO 2: CO2 uptake
(negative value -1 kg CO 2-eq.) plus emissio n after 60 years (+1 kg CO 2-eq.) minus the credit for 60 years
temporary storage, = -1 + 1 - 0.6 = -0.6 kg CO 2-equiv. in total. For delayed fossil emissions the net impact is
always positive: CO 2 emission minus credit for 60 years delayed emission, e.g. fo r 1 kg CO 2 = 1 - 0.6 = 0.4 kg
CO2-equiv. in total. Note that the difference between biogenic and fossil delayed emissions for the same time of
delay is always the same (i.e. 1 kg CO 2-equiv. difference per kg CO 2 emitted), rewarding both biogenic carbon
storage and long-living products.
153 This factor uses the IPCC GWP100 factors of 2007 by multiplying the base -value for carbon dioxide of 0.01
with the substance -specific factor (e.g. 25 for methane, 298 for nitrous oxide (laughing gas, N 2O)). The
substance-specific factor shall be adjusted in line with any ILCD recommendations on LCIA methods or updated
factors from the IPCC if the former is not available.
