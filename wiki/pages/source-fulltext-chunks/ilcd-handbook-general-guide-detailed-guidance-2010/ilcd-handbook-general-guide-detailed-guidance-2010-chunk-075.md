---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook General Guide for LCA Detailed Guidance (2010) - chunk 075"
nodeId: "ilcd-handbook-general-guide-detailed-guidance-2010-chunk-075"
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
chunkIndex: 75
pageRange: "371-375"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 371 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  14 Annex C: Modelling reuse, recycling, and energy recovery  351

  With "n" as total number of loops , and simplifying the resulting mathematical ser ies, the
  total amount of uses after n loops is:
  Formula 8
  rrprpU n
  n
  i
  i
   1/1 1
  0
  U total amount of use
  i recycling loop number
  n total number of recycling loops
  In the above example of starting with p = 1 kg and a recycling rate of 95 % (r = 0.95) after
  indefinite number n of loops one obtains a total amount of use of 20 kg (as in that case U =
  p/(1-r) ).

  Second step: Total life cycle inventory of total amount of use
  The total life cycle inventory of the total amount of use is the sum of the inventories of
  primary production "P" (up to the level of quality of the waste / end -of-life product) , all
  recycling loops " R", and all final waste management of not recycled fractions and other
  losses " W".  The repeated recycling processes and the disposal contribute to the total
  inventory. This total inventory hence  includes all processes up to the level of the quality of
  the primary material, energy carrier or part as obtained also later via recycling , plus all
  recycling and waste treatment  steps. It does not include however any of the processes from
  the manufacture and use of the products made from the material, energy carrier or part
  because those processes are not physically related to  the production of the later
  reused/recycled/recovered material, energy carrier, or part232.
  As prescription one obtains:
  Formula 9
  ))1/()((* 1 rrrRWPpI n

  I total LCI of total amount of use of one initial unit of primary material, part or energy
  carrier
  P LCI of primary production per unit of material, part, or energy carrier
  R LCI of effort for reuse/recycling/recovery per unit of material, part, or energy carrier

  232 This can best be explained along an example: an aluminium beverage  can, as an illustrative example, has as
  first co-function the function to carry and protect the beverage it contains, its second co -function is the aluminium
  scrap (i.e. the end-of-life can) it provides as secondary resource for subsequent product systems . To provide the
  first co-function of delivering the beverage, the can has to be produced, of course. To provide the second co -
  function of being a secondary resource in form of scrap it is however sufficient if the aluminium grade the can is
  made of is produced, while all other steps of transporting the aluminium to the can plant, making the can, etc. are
  not related / attributable to the provision of the scrap. Hence both co-functions share the production steps until the
  aluminium grade that is equivalent to that of the scrap is produced. The true co -producing process is hence the
  one that produces the e.g. metal bar in the quality as it is also available in the e.g. scrap.

  --- Page 372 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  14 Annex C: Modelling reuse, recycling, and energy recovery  352
  W LCI of final waste management per unit of discarded material, part, or energy carrier

  Final step: Average inventory per unit and value correction
  Now the determining physical allocation cri terion is to be determined to allocate these
  cradle-to-gate inventories of the material, energy, or part  between the two co -functions. In
  this case, the criterion is simply mass, as the amount of material, part or energy carrier that is
  physically required for both co-functions is obviously the same. From this one can obtain the
  average inventory " e" per unit of material, part, or energy carrier, dividing the total life cycle
  inventory of the total amount of use "I" by the total amount of use "U":
  Formula 10
  )1/()1(*
  )1/()(**
  1
  1
  rrp
  rrrRWPp
  U
  Ie n
  n


   e average LCI per unit of material, part, or energy carrier
  The above expression for "e" can be further simplified as follows:
  Formula 11
  )1(
  )(*)1(*
  1
  1
  n
  n
  r
  rrRrWPe
  With an indefinite number of loops the expression
  1
  nr  approximates 0 (as r [0...1) and the
  formula is simplified to yield the final version:
  Formula 12
  rRrWPe *)1(*

  Note that this assumes technical equality between primary produced and
  reused/recycled/recovered material, part, or energy carrier. If these differ (e.g. as for many
  recycled polymers), a correction factor is to be introduced. This factor ca n be understood to
  correct for not full equivalence of the technical quality of the primary produced
  material/energy or part from the true co -producing process and the end -of-life product.
  Especially for complex end -of-life products, this also captures the additional effort for e.g.
  dismantling towards isolating the different materials or parts. This correction factor should be
  the market price ratio of secondary/primary material, part, or energy carrier.
  14.4.1.3 Market value of waste / end -of-life product is negative (i.e. a
  waste treatment fee is to be paid)
  (Refers to aspect of ISO 14044:2006 chapter 4.3.4.3)
  In those cases where the waste / end -of-life product cannot directly be sold, it is not a co-
  product but waste. However, there are two types of cases to be differentiated:
  - In those cases where during the waste treatment no valuable product is produced at
  all (e.g. the waste is directly land-filled, incinerated without energy-recovery, etc.), all
  waste treatment steps are to be modelled and the inventory is fully to be assigned to
  the first system that has generated the waste / end-of-life product.

  --- Page 373 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  14 Annex C: Modelling reuse, recycling, and energy recovery  353
  - In those cases, where during the waste treatment processes a valuable product is
  produced (e.g. electricity from waste incineration or a secondary good  after some
  additional cleaning and treatment steps, etc.), this secondary good is a co-product of
  the first system and an allocation is to be applied. This leads to the question, whi ch
  burden this secondary good is to carry.
  It is argued that all treatment processes that are necessary until the treated waste / end -
  of-life product is achieving a market value of zero are within the responsibility of the first
  system (i.e. process steps  P1 to including Pn -1 in Figure 33). This is because the waste or
  end-of-life product is generated by the first system, while a waste can per se not carry any
  burden of treatment . Furthermore  is it considered inappropriate to a ttribute all preceding
  waste treatment processes to the eventually produced secondary good233.
  An allocation of burdens to the secondary goods can plausibly therefore only be done at
  that process step where a valuable secondary good is produced (Pn).
  The following procedure shall be applied:
  Modelling firstly the waste / end-of-life management/treatment processes until the treated
  waste crosses the “zero market value ” border (see Figure 33 ). S ubsequently the two-step
  allocation procedure is to be applied on this process step.
  Figure 33 Allocation of waste / end -of-life products if the management / treatment
  processes result in any valuable product (secondary good): In addition to the allocation of the
  good of the true joint process and the secondary good, the inventory of the treatment process
  step Pn where the waste crosses the zero market value border (MV < O to MV
    0) is to be
  allocated between the two life cycles: The encircled emissions, wastes and product s /
  consumables are to be shared between the pre -treated waste / EoL product (i.e. the first
  system) and the secondary good (i.e. the second system). See text for details.
  Note that for the "market price is below zero" case, a double allocation is to be do ne:
  Firstly between the co -products of the true joint process (i.e. the primary good that is about
  equivalent to the secondary good), as always. Secondly, and in addition, between the pre -
  treated waste / end-of-life product that enters the process Pn that stands at the border
  between the first and second life cycle and the secondary good that leaves it (see Figure 33).
  For both these two allocations, the same two-step procedure of chapter 7.9.3 is applied:
  1st criterion of determining physical causality: if such exists during the process step when
  a valuable product ( secondary good ) is obtained, the corresponding inventory values are
  allocated between the first life cycle and the secondary good.

  233 An example: if the waste is a highly toxic waste that needs special transport, sto rage and treatment in a waste
  incineration facility and finally a little amount of electricity is produced, this cannot justify assigning the high
  environmental impact of the waste treatment incl. depositing of remaining waste and ashes to the electricity.  For
  accounting different versions of products over time, this approach would e.g. not capture improvements in the
  quantity or quality of wastes and end-of-life products.
  2nd (product) system1st (product) system
  Secondary
  good
  MV
   0
  Waste / EoL
  product
  (MV < 0)
  Pre-treated
  waste / EoL
  product
  (MV < 0)
  Emissions
  Wastes
  ...
  ...
  Products
  Wastes
  Products
  Emissions
  ...Use
  phase P1...n-1 Pn

  --- Page 374 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  14 Annex C: Modelling reuse, recycling, and energy recovery  354
  2nd criterion of market value: the remaining inventory exclusively of the process step that
  produces a valuable product ( secondary good ) is allocated with the market value criterion
  between the secondary good (s), i.e. the second life cycle, and the (potential ly pre-treated)
  waste / end-of-life product that enters this process step, i.e. the first life cycle.
  Note finally that the market value of the pre -treated waste / end-of-life product before it
  enters the process step that finally produces a valuable seco ndary good, is below zero and
  that hence the absolute value of its (negative) market price 234 shall be used when allocating
  between the first and second life cycle. The rest of the allocation calculation is the same.

  Note: the Provisions of this annex are found in the main text, in chapter 7.9.3.
  14.5 Recycling in consequential modelling
  (Refers to aspect of ISO 14044:2006 chapter 4.3.4.3)
  14.5.1 Introduction and overview
  As explained earlier, reuse/recycling/recovery in cons equential modelling is
  methodologically equivalent to other situations of multifunctionality. It has some special
  aspects that are logically derived from the same modelling approach while they lead not
  always to immediately intuitive solutions. They are explained in this chapter.
  14.5.2 Recyclability substitution approach
  (Refers to aspect of ISO 14044:2006 chapter 4.3.4.3)
  The recyclability substitution approach (also called "end -of-life recycling" or " recycling
  potential" approach235) follows the logic of conseq uential modelling 236 and is its archetypal
  approach for solving multifunctionality. This mechanism stimulates high recyclability in both
  quantity and quality. Note that the content of recycled material in the product itself is not
  directly considered in the final inventory, as that amount is corrected by the product's
  recyclability. In the further text , details are provided how and why this approach (combined
  with a correction for reduced technical properties/functionality) is also appropriate in case the
  recycled content needs to be stimulated for the material that is analysed.
  The recyclability substitution approach  is described in the following B ox and illustrated in
  Figure 34.


  234 If the market value / gate fee of the pre -treated waste is e.g. „ -1 US$“, the marke t value used for allocation
  would be „1 US$“. (One can interpret this also as an allocation between the secondary good and the waste
  treatment service that is here priced at "1US$").
  235 The term "recycling potential" is not well capturing - at least for short-lived products - that the actually achieved
  recycling rate is used. The term "end -of-life recycling" is only covering end -of-life products, but no production
  waste and has no methodological reference in its name. Hence, a different term is used here, co mbining the used
  criteria "recyclability" with the applied method "substitution".
  236 See the footnote 24 on the question whether this approach and substitution in general are an attributional or a
  consequential approach. In fact, it is argued to be an approach both to model "additional consequences" (as done
  in Situation A and B) and "existing consequences" (as done in Situation C1); the latter could also be termed
  "interactional".

  --- Page 375 ---
  ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
  14 Annex C: Modelling reuse, recycling, and energy recovery  355
  Terms and concepts: Recyclability substitution approach
  In the recyclability substitution approach, the avoided inventory of primary production of a
  good is credited to the end-of-life product or waste according to the degree that it is
  recyclable. Only the amount of good that cannot be quantitatively obtained back from the
  secondary good  (i.e. losses due to incomplete collection, losses during recycling, etc.) is
  modelled as primary production. The recycling efforts , deposition of any finally remaining
  waste etc. and the related impacts are part of the first life cycle. Note that this is analogous to
  substitute the mix of the most cost-competitive or least cost-competitive processes/systems.
  An example for "closed loop" and "open loop - same primary route" recycling  (see Figure 30
  and Figure 31 , respectively ): A product Y, made from only one material  X (to make the
  example clearer) is produced from 2 kg primary material and 2 kg secondary material (i.e.
  recycled content = 50 %); see top graphic in Figure 34. The 3.5 kg that are recycled result in
  3 kg secondary good  of the same quality as the one produced via the primary route
  (recyclability by mass = 75  %). The surplus of 1 kg secondary good , that is not required for
  the product's production, is substituted (see the curved arrow and the "S" in the graphics) by
  1 kg primary production of material X ("-1 kg"). This results in an effective inventory for the
  analysed system of 2 kg - 1 kg = 1 kg of the primary -produced material X, plus its assembly
  and use stage, plus the “recycling-processes-only” inventory of 3.5 kg of the recycled end-of-
  life product, plus waste disposal processes for each 0.5 kg of the directly deposited end -of-
  life product and 0.5 kg of waste generated during recycling.  Note that it does not matter
  whether the 2 kg  used secondary material stem from the recycling of this product or any
  other product made of that material . (In case the quality of the secondary material  would be
  lower than th e quality of the primary material,  this would be considered by crediting a lower
  amount or by market-value correction).
  If in the above example , the recyclability would be low er than the recycled content , e.g.
  resulting in only 1 kg secondary material  (second graphic in  Figure 34), the lacking 1 kg of
  material would be added by primary produced material  X ("1 kg"), to complete the required 4
  kg.
  Applying the same approach, but this time for another product, assuming that the secondary
  material X would normally not be used but disposed off ( see third graphic in Figure 34): if 3
  kg of the secondary material X are produced but only 2 kg are used in the production of the
  product, 1 kg needs to be disposed off ; this is  to be modelled instead of crediting avoided
  primary production ("1 kg" to disposal; see lower left process box) . If however the analysed
  product would using more secondary material X than it produces (bottom graphic in Figure
  34), this means that the here additionally required 1 kg of secondary X has to come fro m
  somewhere else. As any additionally  produced amount secondary X is disposed off, this
  additional demand diverts 1 kg of secondary material X from landfill, i.e. the product gets a
  credit of 1 kg avoided disposal ("-1 kg" avoided disposal; see lower left process box).
  In summary, this approach is rewarding a high recyclability, especially of valuable
  resources/goods and/or recycling to higher value secondary goods. Recyc led content is
  rewarded when otherwise unused/landfilled secondary resources are used.
  Note that the routes of primary production and of the substituted primary production do not
  need to be identical , as e.g. a specific route may be used for the purchased  material, while
  the credit would be given for the mix of the most cost -competitive routes  (under full
  consequential modelling; but see simplifications for Situation A, B, and C1).
  Lower quality of the secondary good is considered by substituting according ly less primary
  production or applying value correction (details see chapter 14.5.3.3).
---

## Chunk Identity

- Source: ILCD Handbook General Guide for LCA Detailed Guidance (2010)
- Source file: `1-ILCD-Handbook-General-guide-for-LCA-DETAILED-GUIDANCE-12March2010-ISBN-fin-v1.0-EN.pdf`
- Page range: 371-375
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 371 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
14 Annex C: Modelling reuse, recycling, and energy recovery  351

With "n" as total number of loops , and simplifying the resulting mathematical ser ies, the
total amount of uses after n loops is:
Formula 8
rrprpU n
n
i
i
 1/1 1
0
U total amount of use
i recycling loop number
n total number of recycling loops
In the above example of starting with p = 1 kg and a recycling rate of 95 % (r = 0.95) after
indefinite number n of loops one obtains a total amount of use of 20 kg (as in that case U =
p/(1-r) ).

Second step: Total life cycle inventory of total amount of use
The total life cycle inventory of the total amount of use is the sum of the inventories of
primary production "P" (up to the level of quality of the waste / end -of-life product) , all
recycling loops " R", and all final waste management of not recycled fractions and other
losses " W".  The repeated recycling processes and the disposal contribute to the total
inventory. This total inventory hence  includes all processes up to the level of the quality of
the primary material, energy carrier or part as obtained also later via recycling , plus all
recycling and waste treatment  steps. It does not include however any of the processes from
the manufacture and use of the products made from the material, energy carrier or part
because those processes are not physically related to  the production of the later
reused/recycled/recovered material, energy carrier, or part232.
As prescription one obtains:
Formula 9
))1/()((* 1 rrrRWPpI n

I total LCI of total amount of use of one initial unit of primary material, part or energy
carrier
P LCI of primary production per unit of material, part, or energy carrier
R LCI of effort for reuse/recycling/recovery per unit of material, part, or energy carrier

232 This can best be explained along an example: an aluminium beverage  can, as an illustrative example, has as
first co-function the function to carry and protect the beverage it contains, its second co -function is the aluminium
scrap (i.e. the end-of-life can) it provides as secondary resource for subsequent product systems . To provide the
first co-function of delivering the beverage, the can has to be produced, of course. To provide the second co -
function of being a secondary resource in form of scrap it is however sufficient if the aluminium grade the can is
made of is produced, while all other steps of transporting the aluminium to the can plant, making the can, etc. are
not related / attributable to the provision of the scrap. Hence both co-functions share the production steps until the
aluminium grade that is equivalent to that of the scrap is produced. The true co -producing process is hence the
one that produces the e.g. metal bar in the quality as it is also available in the e.g. scrap.

--- Page 372 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
14 Annex C: Modelling reuse, recycling, and energy recovery  352
W LCI of final waste management per unit of discarded material, part, or energy carrier

Final step: Average inventory per unit and value correction
Now the determining physical allocation cri terion is to be determined to allocate these
cradle-to-gate inventories of the material, energy, or part  between the two co -functions. In
this case, the criterion is simply mass, as the amount of material, part or energy carrier that is
physically required for both co-functions is obviously the same. From this one can obtain the
average inventory " e" per unit of material, part, or energy carrier, dividing the total life cycle
inventory of the total amount of use "I" by the total amount of use "U":
Formula 10
)1/()1(*
)1/()(**
1
1
rrp
rrrRWPp
U
Ie n
n


 e average LCI per unit of material, part, or energy carrier
The above expression for "e" can be further simplified as follows:
Formula 11
)1(
)(*)1(*
1
1
n
n
r
rrRrWPe
With an indefinite number of loops the expression
1
nr  approximates 0 (as r [0...1) and the
formula is simplified to yield the final version:
Formula 12
rRrWPe *)1(*

Note that this assumes technical equality between primary produced and
reused/recycled/recovered material, part, or energy carrier. If these differ (e.g. as for many
recycled polymers), a correction factor is to be introduced. This factor ca n be understood to
correct for not full equivalence of the technical quality of the primary produced
material/energy or part from the true co -producing process and the end -of-life product.
Especially for complex end -of-life products, this also captures the additional effort for e.g.
dismantling towards isolating the different materials or parts. This correction factor should be
the market price ratio of secondary/primary material, part, or energy carrier.
14.4.1.3 Market value of waste / end -of-life product is negative (i.e. a
waste treatment fee is to be paid)
(Refers to aspect of ISO 14044:2006 chapter 4.3.4.3)
In those cases where the waste / end -of-life product cannot directly be sold, it is not a co-
product but waste. However, there are two types of cases to be differentiated:
- In those cases where during the waste treatment no valuable product is produced at
all (e.g. the waste is directly land-filled, incinerated without energy-recovery, etc.), all
waste treatment steps are to be modelled and the inventory is fully to be assigned to
the first system that has generated the waste / end-of-life product.

--- Page 373 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
14 Annex C: Modelling reuse, recycling, and energy recovery  353
- In those cases, where during the waste treatment processes a valuable product is
produced (e.g. electricity from waste incineration or a secondary good  after some
additional cleaning and treatment steps, etc.), this secondary good is a co-product of
the first system and an allocation is to be applied. This leads to the question, whi ch
burden this secondary good is to carry.
It is argued that all treatment processes that are necessary until the treated waste / end -
of-life product is achieving a market value of zero are within the responsibility of the first
system (i.e. process steps  P1 to including Pn -1 in Figure 33). This is because the waste or
end-of-life product is generated by the first system, while a waste can per se not carry any
burden of treatment . Furthermore  is it considered inappropriate to a ttribute all preceding
waste treatment processes to the eventually produced secondary good233.
An allocation of burdens to the secondary goods can plausibly therefore only be done at
that process step where a valuable secondary good is produced (Pn).
The following procedure shall be applied:
Modelling firstly the waste / end-of-life management/treatment processes until the treated
waste crosses the “zero market value ” border (see Figure 33 ). S ubsequently the two-step
allocation procedure is to be applied on this process step.
Figure 33 Allocation of waste / end -of-life products if the management / treatment
processes result in any valuable product (secondary good): In addition to the allocation of the
good of the true joint process and the secondary good, the inventory of the treatment process
step Pn where the waste crosses the zero market value border (MV < O to MV
  0) is to be
allocated between the two life cycles: The encircled emissions, wastes and product s /
consumables are to be shared between the pre -treated waste / EoL product (i.e. the first
system) and the secondary good (i.e. the second system). See text for details.
Note that for the "market price is below zero" case, a double allocation is to be do ne:
Firstly between the co -products of the true joint process (i.e. the primary good that is about
equivalent to the secondary good), as always. Secondly, and in addition, between the pre -
treated waste / end-of-life product that enters the process Pn that stands at the border
between the first and second life cycle and the secondary good that leaves it (see Figure 33).
For both these two allocations, the same two-step procedure of chapter 7.9.3 is applied:
1st criterion of determining physical causality: if such exists during the process step when
a valuable product ( secondary good ) is obtained, the corresponding inventory values are
allocated between the first life cycle and the secondary good.

233 An example: if the waste is a highly toxic waste that needs special transport, sto rage and treatment in a waste
incineration facility and finally a little amount of electricity is produced, this cannot justify assigning the high
environmental impact of the waste treatment incl. depositing of remaining waste and ashes to the electricity.  For
accounting different versions of products over time, this approach would e.g. not capture improvements in the
quantity or quality of wastes and end-of-life products.
2nd (product) system1st (product) system
Secondary
good
MV
 0
Waste / EoL
product
(MV < 0)
Pre-treated
waste / EoL
product
(MV < 0)
Emissions
Wastes
...
...
Products
Wastes
Products
Emissions
...Use
phase P1...n-1 Pn

--- Page 374 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
14 Annex C: Modelling reuse, recycling, and energy recovery  354
2nd criterion of market value: the remaining inventory exclusively of the process step that
produces a valuable product ( secondary good ) is allocated with the market value criterion
between the secondary good (s), i.e. the second life cycle, and the (potential ly pre-treated)
waste / end-of-life product that enters this process step, i.e. the first life cycle.
Note finally that the market value of the pre -treated waste / end-of-life product before it
enters the process step that finally produces a valuable seco ndary good, is below zero and
that hence the absolute value of its (negative) market price 234 shall be used when allocating
between the first and second life cycle. The rest of the allocation calculation is the same.

Note: the Provisions of this annex are found in the main text, in chapter 7.9.3.
14.5 Recycling in consequential modelling
(Refers to aspect of ISO 14044:2006 chapter 4.3.4.3)
14.5.1 Introduction and overview
As explained earlier, reuse/recycling/recovery in cons equential modelling is
methodologically equivalent to other situations of multifunctionality. It has some special
aspects that are logically derived from the same modelling approach while they lead not
always to immediately intuitive solutions. They are explained in this chapter.
14.5.2 Recyclability substitution approach
(Refers to aspect of ISO 14044:2006 chapter 4.3.4.3)
The recyclability substitution approach (also called "end -of-life recycling" or " recycling
potential" approach235) follows the logic of conseq uential modelling 236 and is its archetypal
approach for solving multifunctionality. This mechanism stimulates high recyclability in both
quantity and quality. Note that the content of recycled material in the product itself is not
directly considered in the final inventory, as that amount is corrected by the product's
recyclability. In the further text , details are provided how and why this approach (combined
with a correction for reduced technical properties/functionality) is also appropriate in case the
recycled content needs to be stimulated for the material that is analysed.
The recyclability substitution approach  is described in the following B ox and illustrated in
Figure 34.


234 If the market value / gate fee of the pre -treated waste is e.g. „ -1 US$“, the marke t value used for allocation
would be „1 US$“. (One can interpret this also as an allocation between the secondary good and the waste
treatment service that is here priced at "1US$").
235 The term "recycling potential" is not well capturing - at least for short-lived products - that the actually achieved
recycling rate is used. The term "end -of-life recycling" is only covering end -of-life products, but no production
waste and has no methodological reference in its name. Hence, a different term is used here, co mbining the used
criteria "recyclability" with the applied method "substitution".
236 See the footnote 24 on the question whether this approach and substitution in general are an attributional or a
consequential approach. In fact, it is argued to be an approach both to model "additional consequences" (as done
in Situation A and B) and "existing consequences" (as done in Situation C1); the latter could also be termed
"interactional".

--- Page 375 ---
ILCD Handbook: General guide for Life Cycle Assessment - Detailed guidance            First edition
14 Annex C: Modelling reuse, recycling, and energy recovery  355
Terms and concepts: Recyclability substitution approach
In the recyclability substitution approach, the avoided inventory of primary production of a
good is credited to the end-of-life product or waste according to the degree that it is
recyclable. Only the amount of good that cannot be quantitatively obtained back from the
secondary good  (i.e. losses due to incomplete collection, losses during recycling, etc.) is
modelled as primary production. The recycling efforts , deposition of any finally remaining
waste etc. and the related impacts are part of the first life cycle. Note that this is analogous to
substitute the mix of the most cost-competitive or least cost-competitive processes/systems.
An example for "closed loop" and "open loop - same primary route" recycling  (see Figure 30
and Figure 31 , respectively ): A product Y, made from only one material  X (to make the
example clearer) is produced from 2 kg primary material and 2 kg secondary material (i.e.
recycled content = 50 %); see top graphic in Figure 34. The 3.5 kg that are recycled result in
3 kg secondary good  of the same quality as the one produced via the primary route
(recyclability by mass = 75  %). The surplus of 1 kg secondary good , that is not required for
the product's production, is substituted (see the curved arrow and the "S" in the graphics) by
1 kg primary production of material X ("-1 kg"). This results in an effective inventory for the
analysed system of 2 kg - 1 kg = 1 kg of the primary -produced material X, plus its assembly
and use stage, plus the “recycling-processes-only” inventory of 3.5 kg of the recycled end-of-
life product, plus waste disposal processes for each 0.5 kg of the directly deposited end -of-
life product and 0.5 kg of waste generated during recycling.  Note that it does not matter
whether the 2 kg  used secondary material stem from the recycling of this product or any
other product made of that material . (In case the quality of the secondary material  would be
lower than th e quality of the primary material,  this would be considered by crediting a lower
amount or by market-value correction).
If in the above example , the recyclability would be low er than the recycled content , e.g.
resulting in only 1 kg secondary material  (second graphic in  Figure 34), the lacking 1 kg of
material would be added by primary produced material  X ("1 kg"), to complete the required 4
kg.
Applying the same approach, but this time for another product, assuming that the secondary
material X would normally not be used but disposed off ( see third graphic in Figure 34): if 3
kg of the secondary material X are produced but only 2 kg are used in the production of the
product, 1 kg needs to be disposed off ; this is  to be modelled instead of crediting avoided
primary production ("1 kg" to disposal; see lower left process box) . If however the analysed
product would using more secondary material X than it produces (bottom graphic in Figure
34), this means that the here additionally required 1 kg of secondary X has to come fro m
somewhere else. As any additionally  produced amount secondary X is disposed off, this
additional demand diverts 1 kg of secondary material X from landfill, i.e. the product gets a
credit of 1 kg avoided disposal ("-1 kg" avoided disposal; see lower left process box).
In summary, this approach is rewarding a high recyclability, especially of valuable
resources/goods and/or recycling to higher value secondary goods. Recyc led content is
rewarded when otherwise unused/landfilled secondary resources are used.
Note that the routes of primary production and of the substituted primary production do not
need to be identical , as e.g. a specific route may be used for the purchased  material, while
the credit would be given for the mix of the most cost -competitive routes  (under full
consequential modelling; but see simplifications for Situation A, B, and C1).
Lower quality of the secondary good is considered by substituting according ly less primary
production or applying value correction (details see chapter 14.5.3.3).
