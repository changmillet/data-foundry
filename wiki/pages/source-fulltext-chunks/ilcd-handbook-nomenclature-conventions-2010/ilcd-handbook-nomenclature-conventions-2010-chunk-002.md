---
pageType: "source-fulltext-chunk"
title: "ILCD Handbook Nomenclature and Other Conventions (2010) - chunk 002"
nodeId: "ilcd-handbook-nomenclature-conventions-2010-chunk-002"
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
chunkIndex: 2
pageRange: "9-16"
extractionMethod: "pypdf page.extract_text fallback; document-granular-decompose env unavailable"
fullText: |-
  --- Page 9 ---
  ILCD Handbook: Nomenclature and other conventions           First edition
   viii
  Rule 25: Mandatory for technical target audience, recommended for non-technical target audience:
  Reference flow properties and reference units for types of flows, further criteria: .............. 33
  Rule 26: Mandatory for technical target audience, recommended for non-technical target audience:
  Creation and naming of flow properties, unit groups and units: .......................................... 36
  Rule 27: Recommended for technical and non-technical target audience: classification of contact
  data sets: ............................................................................................................................. 36
  Rule 28: Recommended for technical and non-technical target audience: classification of source
  data sets: ............................................................................................................................. 37

  --- Page 10 ---
  ILCD Handbook: Nomenclature and other conventions           First edition
   ix

  --- Page 11 ---
  ILCD Handbook: Nomenclature and other conventions           First edition
  1
  1 Introduction
  1.1 Relationship to other documents and files
  This document stands in context of the following docu ments and files, which are
  currently accessible via http://lct.jrc.ec.europa.eu:
   Other technical guidance documents of the ILCD Handbook
   ILCD reference elementary flows, i.e. a set of 19000+ elementary flows , as
  well as  flow properties and unit groups . Implemented based upon this
  document. Available as both Excel spreadsheet and ILCD formatted data sets
  as xml files.
   ILCD reference format, including a developer package of the ILCD format.
  This package includes f urther useful documents  and sample data sets.  This
  package also includes two xml files  (ILCDClassification.xml and
  ILCDElementaryFlowCategorization.xml) that implement the whole set of
  classes and elementaryFlowCategories of this document.
  1.2 Purpose of this document
  Different LCA working groups use often considerably different nomenclature and
  other conventions. In consequence, L ife Cycle Inventory (L CI) data sets are
  incompatible on different levels, what strongly limits the combined use of LCI data
  sets from different sources as well as an efficient, electronic data exchange among
  practitioners. This situation also hampers a clear and unambiguous understanding of
  LCA study reports and their efficient review.
  The purpose of this document is hence to support Life Cycle Inventory data
  collection, documentation and use in LCA studies by providing a common
  nomenclature and provisions on related topics. The document also forms the basis
  for a common reference elementary flow list for use in both LCI and LCIA work.
  This supports an efficient LCA work and data exchange among different LCA tools
  and databases.
  Goal is to guide data collection , naming,  and documentation in a way that the
  inventory data
   is meaningful and precise in view of further impact assessment an d
  interpretation as well as reporting
   can be compiled and provided in a cost-efficient way
   is comprehensive without overlaps, and

  --- Page 12 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   2
   supports an efficient data exchange among practitioners also with different
  database and software systems, thereby reducing errors
  This nomenclature and other conventions focus on elementary flows, flow
  properties and the related units, but extend to suggestions for the naming of
  process data sets , product and waste flows , for better compatibility among
  different database systems. Basic recommendations and requirements are also
  given on the classification of source and contact data sets.
  1.3 Approach of this document and nomenclature
  From the above purposes and motivations, the following concrete approach and
  subsequently the concrete nomenclature and other conventions were derived:
   Start from existing practice
   Comprehensible nomenclature
   Simple rules for naming and classification for elementary flows and other
  basic elements of an LCA
   Support automatic data exchange
   Compatibility with different modelling approaches
   Flexible, but guiding recommendations for  use for  non-technical target
  audience, more strict requirements for deliverables for technical audience
  including Life Cycle Inventory data sets
   Default language and multi-language capability
  The following bullets provide some more aspects for each of these issues:
   Start from existing practice:  The harmonisation process of the
  nomenclature was started from widely used existing LCA naming schemes.
  These are implemented in market -relevant LCA databases and software
  tools and known and/or used by the majority of practitioners.
   Comprehensible nomenclature: Lengthy names should be avoided as well
  as artificial names, rarely used names, ambiguous or otherwise misleading
  names and – only for elementary flows – industry-sector specific names.
   Simple rules:  A generally applicable naming pattern and classification /
  categorisation with few exceptions should be used. This improves the
  understanding and daily use, makes search functions more effic ient and
  reduces the risk of “twins” in the naming.
   Support automatic data exchange:
  o The nomenclature, classification and assignment of flow properties
  and units to flows should support an automated exchange among the
  main market relevant LCA data formats , as far as possible. This
  complements the approach of an object orientated documentation
  format, i.e. the ILCD reference format that already reflects this need
  from a format-perspective.

  --- Page 13 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   3
  o Next to flow names, further information items such as CAS Numbers
  support LCI practice in a structured way in data exchange but also
  translation to other languages etc. For data exchange (especially for
  the matching of flow names) the flow name and the CAS No. are
  both to be considered wherever available to prevent mismatching.
  o The nomenclature and other conventions are foreseen for use in
  ILCD-compliant data sets and have hence also  be applied in
  developing the ILCD reference elementary flow data sets , flow
  properties and unit groups. These data sets will hence strongly e ase
  the use of the nomenclature, by allowing having a complete set  of
  elementary flows and related flow properties and units ready for use
  in electronic form for exchange among LCA software tools.
   Compatibility with different modelling principles: As widely done in LCA
  practice, the names of product flows should be identical as those of the
  related processes in order to ease searches and to support matrix -type LCI
  modelling tools. This is not foreseen for multi-functional processes of course,
  for which a c orresponding nomenclature is to be found.  The more widely
  used process chain modelling approaches are equally fully supported.
   Flexible, but guiding for communication to non -technical audience
  (e.g. Executive summaries of LCA studies) , more strict for technical
  audience (e.g. LCI data sets, detailed part of LCA studies): To ease LCA
  practice and to support a valid LCIA calculation, the elementary flows need
  to contain the information to the receiving/providing environmental
  compartment, where required. This  is also general practice. The target
  audience of LCI data sets is always technical while those of LCA studies
  includes non -technical audience. Hence, a similarly differentiated need for
  strictness of clear nomenclature for LCI data sets and a more flexible one for
  communication to non -technical audience is derived. This is implemented
  here by a c lassification that is mandatory for LCI data sets while in LCA
  studies only recommended. For most proprietary formats, the
  elementaryFlowCategory (e.g. “Emissions to air”) is part of the semantically
  meaningful flow identifying information , what  has to be considered.
  Practically, the degree of specification has to reflect both aspects of a
  technically feasible measurement of the flow values in common practice of
  LCI work and of common LCIA practice. Other aspects especially relevant
  here are the database manageability and error traceability  in inventories. A
  further differentiation of receiving or providing environmental media, by
  geographical area (e.g. country), fl ow speciation, environmental conditions
  etc., is not recommended here for the time being. The ILCD system is
  intended to further work on these issues. These should be revisited in the
  coming years in view of the development of respective further differenti ated
  LCIA methods and factors as well as applicability and data availability in LCI
  practice.

  --- Page 14 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   4
   Flexible, but clearly guiding classification and names of product and
  waste flows:
  o The classification of product and waste flows as well as for
  processes should  be a "recommendation" only also on the level of
  the top categor ies and user extendable; sub -categories are
  suggested but equally only as "recommendation", allowing for full
  flexibility also reflecting the technical constraints of some existing
  LCA software tools.
  o The names of product and waste flows as well as unit processes /
  LCI results should equally be recommended only, to increase
  flexibility.
   Default language and multi -language capability: According to the report
  of the SETAC WG on Data Availability  and Quality  it was found that “In
  practical LCI work, the use of deviant nomenclature and local languages
  other than English cannot be avoided.”  Implicitly, the choice for English as a
  main language for exchange of data is made. At the same time , this
  expresses the need to support the use of other languages. The naming rules
  and other conventions made here should be made largely language -
  independent; i.e. allow that they in principle also work in other languages.
  This ensures that a translation will be one -to-one in both directions of the
  translation. In the first place, the English variant of the nomenclature and
  other conventions is used to develop and apply it. To support a sound
  management of language -versions of data sets, languages must be dealt
  with in a clearly structured way, keeping the different translations of a
  specific data set together (for effective maintenance and extension), i.e. they
  should be stored in the same file. This is foreseen and technically supported
  by the ILCD reference format.
  The concrete nomenclature and other conventions in the subsequent chapters are
  derived reflecting the above approaches and considerations and are justified
  discussing briefly the pros and cons of possible solutions.
  1.4 Specific approach for flows
  The hiera rchical classification  of a flow data set is formally equivalent to the
  assigning of it to a category / sub -category structural level as often done for
  structuring the user access to the data sets in LCA databases. Two different types of
  such classificatio ns should be differentiated: those that are mere classes a flow is
  assigned to (e.g. grouping of substances into "organic" or "inorganic"), and those that
  actually have a methodological/semantical meaning (e.g. grouping of substances into
  compartments and sub-compartments of the receiving / providing environment such
  as "Emissions to air" and "Emissions to water" that result in different LCIA factors for
  the elementary flows). Focus is here laid on the second type, the semantically
  meaningful information th at is implemented in the ILCD data set format as
  elementaryFlowCategory. Note that for structuring database contents in LCA

  --- Page 15 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   5
  software applications both classifications can be used  (alternatively or in
  combination), depending on intended users and preference of the software provider.
  Generally, the following problems are identified regarding both the classification of
  flows and the structure of LCA databases in general:
   No or too little classification/structure ( e.g. no structure but  hundreds or
  thousands of objects in database)
   Unbalanced classification/structure (e.g. resulting in hierarchies with 1 to 5
  objects in one class but at the same time other  classes with over 500
  objects)
   Unnecessarily high number of hierarchies used in hierarchical
  classification/structure (e.g. Elementary flows / Resources / Non -renewable
  energetic resources / Solid non-renewable energetic resources / Hard coal
  resources / , where after five mouse -clicks the user can finally see the list of
  the actual elementary flows of different types of hard coal).
   Classification/structure not oriented to state -of-the-art of LCI practice and/or
  LCIA methods
   Ambiguous structure (e.g. largely overlapping logic).
   Especially for product and waste flows a "source" -type ("from which industry
  or pro cess type does the substance come"), a "purpose" -type ("for which
  purpose is the substance used") and a "substance" -type ("what type of
  substance is it") classification approach can be found in practice. Of these,
  the make -type often results in problems, s uch as e.g. "Sulphur; technical
  quality" as a product flow is found under "refinery" and "copper industry", but
  a "Sulphur mix" product flow can not be clearly placed (or found) anywhere.
  The preferred classification type will depend on the application, i. e. industry-
  specific eco-design LCI databases would probably be best structured along
  the use-type, while general back -ground LCI databases would best follow a
  substance-type classification.

  Therefore the recommended hierarchical classifications and recom mendation for
  use in structuring a general database, content should reflect the following
  considerations:
   Its logic is intuitive and easily comprehensible and independent of the
  specific e.g. industry context in which the LCA database is used (while in -
  house a different structure can still be used, data exchange and reporting is
  based on a common reference structure)
   It has an evenly balanced, and appropriate absolute number of entries in
  each classification level sub -classifications in each classification,  as this
  allows fast identification of objects. This is typically the case if between 5 to
  10 entries exist, both for each classification level and for the data sets in
  each classification and sub-classification: the human eye and brain can very
  quickly grasp the content and identify the required next -lower classification.

  --- Page 16 ---
  ILCD Handbook: Nomenclature and other conventions          First edition
   6
  A smaller number of classes results in too many hierarchies and required
  "clicks", a much higher number in too long lists to read. For the data sets in
  the classes, however other aspects are to be considered, such as named in
  the following bullet-point.
   It puts objects together into one folder that are required in the same context
  of e.g. LCI work (e.g. when building up an combustion emission inventory,
  the user will need to compile different organic emissions to air, what is eased
  if found in the same folder), as far possible
   For elementary flows, its differentiation on top -level is additionally driven
  from LCIA perspective, i.e. only where LCIA methods require actually a
  differentiation, a separate classification should be given
   It is not overlapping and leaves no relevant gaps, as far as possible. As this
  is typically not fully avoidable it offers an “other” option to allow placing
  objects that can not be (clearly) put elsewhere.
   Finally, as many specific database structures are already employed in widely
  used LCA tools and databases, the reference structure orients to this
  existing practice as far as possible as a harmonised suggestion. As some
  software tools are limited to handle more th an two hierarchy levels also for
  elementary flows, the number of mandatory but also recommended levels
  should be limited, if acceptable from the other considerations.
  The following mandatory and recommended classifications take these
  considerations into account.
  1.5 "Mandatory" and "recommended" items of this
  document
  The nomenclature and other conventions are subdivided into "Mandatory" and
  "Recommended” ones. Furthermore, a differentiation is made for deliverables for
  non-technical target audience, which generally have less strict requirements for exact
  compatibility and those for technical audience, such as LCI data sets , where different
  classification systems and the like would render a data exchange among
  practitioners and their common use more cumbersome.
  For "mandatory" items, any deviating use would very likely render data exchange
  incompatible or LCA study comprehension and review more laborious and/or result in
  errors that affect the LCI and LCIA results. Other rules are set "recommended" only,
  as a d eviating use would not have the strong negative effects as described just
  above. They allowing for more flexibility in individually cases. To consequently apply
  this guidance is intended to nevertheless support better  compatibility and a more
  efficient work flow in data exchange and reporting and hence to save time and cost.
  Rule 1: Requirement status of the individual rules:
---

## Chunk Identity

- Source: ILCD Handbook Nomenclature and Other Conventions (2010)
- Source file: `9-MANPROJ-PR-ILCD-Handbook-Nomenclature-and-other-conventions-first-edition-ISBN-fin-v1.0-E.pdf`
- Page range: 9-16
- Extraction method: pypdf page.extract_text fallback; document-granular-decompose env unavailable

## Extracted Text

--- Page 9 ---
ILCD Handbook: Nomenclature and other conventions           First edition
 viii
Rule 25: Mandatory for technical target audience, recommended for non-technical target audience:
Reference flow properties and reference units for types of flows, further criteria: .............. 33
Rule 26: Mandatory for technical target audience, recommended for non-technical target audience:
Creation and naming of flow properties, unit groups and units: .......................................... 36
Rule 27: Recommended for technical and non-technical target audience: classification of contact
data sets: ............................................................................................................................. 36
Rule 28: Recommended for technical and non-technical target audience: classification of source
data sets: ............................................................................................................................. 37

--- Page 10 ---
ILCD Handbook: Nomenclature and other conventions           First edition
 ix

--- Page 11 ---
ILCD Handbook: Nomenclature and other conventions           First edition
1
1 Introduction
1.1 Relationship to other documents and files
This document stands in context of the following docu ments and files, which are
currently accessible via http://lct.jrc.ec.europa.eu:
 Other technical guidance documents of the ILCD Handbook
 ILCD reference elementary flows, i.e. a set of 19000+ elementary flows , as
well as  flow properties and unit groups . Implemented based upon this
document. Available as both Excel spreadsheet and ILCD formatted data sets
as xml files.
 ILCD reference format, including a developer package of the ILCD format.
This package includes f urther useful documents  and sample data sets.  This
package also includes two xml files  (ILCDClassification.xml and
ILCDElementaryFlowCategorization.xml) that implement the whole set of
classes and elementaryFlowCategories of this document.
1.2 Purpose of this document
Different LCA working groups use often considerably different nomenclature and
other conventions. In consequence, L ife Cycle Inventory (L CI) data sets are
incompatible on different levels, what strongly limits the combined use of LCI data
sets from different sources as well as an efficient, electronic data exchange among
practitioners. This situation also hampers a clear and unambiguous understanding of
LCA study reports and their efficient review.
The purpose of this document is hence to support Life Cycle Inventory data
collection, documentation and use in LCA studies by providing a common
nomenclature and provisions on related topics. The document also forms the basis
for a common reference elementary flow list for use in both LCI and LCIA work.
This supports an efficient LCA work and data exchange among different LCA tools
and databases.
Goal is to guide data collection , naming,  and documentation in a way that the
inventory data
 is meaningful and precise in view of further impact assessment an d
interpretation as well as reporting
 can be compiled and provided in a cost-efficient way
 is comprehensive without overlaps, and

--- Page 12 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 2
 supports an efficient data exchange among practitioners also with different
database and software systems, thereby reducing errors
This nomenclature and other conventions focus on elementary flows, flow
properties and the related units, but extend to suggestions for the naming of
process data sets , product and waste flows , for better compatibility among
different database systems. Basic recommendations and requirements are also
given on the classification of source and contact data sets.
1.3 Approach of this document and nomenclature
From the above purposes and motivations, the following concrete approach and
subsequently the concrete nomenclature and other conventions were derived:
 Start from existing practice
 Comprehensible nomenclature
 Simple rules for naming and classification for elementary flows and other
basic elements of an LCA
 Support automatic data exchange
 Compatibility with different modelling approaches
 Flexible, but guiding recommendations for  use for  non-technical target
audience, more strict requirements for deliverables for technical audience
including Life Cycle Inventory data sets
 Default language and multi-language capability
The following bullets provide some more aspects for each of these issues:
 Start from existing practice:  The harmonisation process of the
nomenclature was started from widely used existing LCA naming schemes.
These are implemented in market -relevant LCA databases and software
tools and known and/or used by the majority of practitioners.
 Comprehensible nomenclature: Lengthy names should be avoided as well
as artificial names, rarely used names, ambiguous or otherwise misleading
names and – only for elementary flows – industry-sector specific names.
 Simple rules:  A generally applicable naming pattern and classification /
categorisation with few exceptions should be used. This improves the
understanding and daily use, makes search functions more effic ient and
reduces the risk of “twins” in the naming.
 Support automatic data exchange:
o The nomenclature, classification and assignment of flow properties
and units to flows should support an automated exchange among the
main market relevant LCA data formats , as far as possible. This
complements the approach of an object orientated documentation
format, i.e. the ILCD reference format that already reflects this need
from a format-perspective.

--- Page 13 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 3
o Next to flow names, further information items such as CAS Numbers
support LCI practice in a structured way in data exchange but also
translation to other languages etc. For data exchange (especially for
the matching of flow names) the flow name and the CAS No. are
both to be considered wherever available to prevent mismatching.
o The nomenclature and other conventions are foreseen for use in
ILCD-compliant data sets and have hence also  be applied in
developing the ILCD reference elementary flow data sets , flow
properties and unit groups. These data sets will hence strongly e ase
the use of the nomenclature, by allowing having a complete set  of
elementary flows and related flow properties and units ready for use
in electronic form for exchange among LCA software tools.
 Compatibility with different modelling principles: As widely done in LCA
practice, the names of product flows should be identical as those of the
related processes in order to ease searches and to support matrix -type LCI
modelling tools. This is not foreseen for multi-functional processes of course,
for which a c orresponding nomenclature is to be found.  The more widely
used process chain modelling approaches are equally fully supported.
 Flexible, but guiding for communication to non -technical audience
(e.g. Executive summaries of LCA studies) , more strict for technical
audience (e.g. LCI data sets, detailed part of LCA studies): To ease LCA
practice and to support a valid LCIA calculation, the elementary flows need
to contain the information to the receiving/providing environmental
compartment, where required. This  is also general practice. The target
audience of LCI data sets is always technical while those of LCA studies
includes non -technical audience. Hence, a similarly differentiated need for
strictness of clear nomenclature for LCI data sets and a more flexible one for
communication to non -technical audience is derived. This is implemented
here by a c lassification that is mandatory for LCI data sets while in LCA
studies only recommended. For most proprietary formats, the
elementaryFlowCategory (e.g. “Emissions to air”) is part of the semantically
meaningful flow identifying information , what  has to be considered.
Practically, the degree of specification has to reflect both aspects of a
technically feasible measurement of the flow values in common practice of
LCI work and of common LCIA practice. Other aspects especially relevant
here are the database manageability and error traceability  in inventories. A
further differentiation of receiving or providing environmental media, by
geographical area (e.g. country), fl ow speciation, environmental conditions
etc., is not recommended here for the time being. The ILCD system is
intended to further work on these issues. These should be revisited in the
coming years in view of the development of respective further differenti ated
LCIA methods and factors as well as applicability and data availability in LCI
practice.

--- Page 14 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 4
 Flexible, but clearly guiding classification and names of product and
waste flows:
o The classification of product and waste flows as well as for
processes should  be a "recommendation" only also on the level of
the top categor ies and user extendable; sub -categories are
suggested but equally only as "recommendation", allowing for full
flexibility also reflecting the technical constraints of some existing
LCA software tools.
o The names of product and waste flows as well as unit processes /
LCI results should equally be recommended only, to increase
flexibility.
 Default language and multi -language capability: According to the report
of the SETAC WG on Data Availability  and Quality  it was found that “In
practical LCI work, the use of deviant nomenclature and local languages
other than English cannot be avoided.”  Implicitly, the choice for English as a
main language for exchange of data is made. At the same time , this
expresses the need to support the use of other languages. The naming rules
and other conventions made here should be made largely language -
independent; i.e. allow that they in principle also work in other languages.
This ensures that a translation will be one -to-one in both directions of the
translation. In the first place, the English variant of the nomenclature and
other conventions is used to develop and apply it. To support a sound
management of language -versions of data sets, languages must be dealt
with in a clearly structured way, keeping the different translations of a
specific data set together (for effective maintenance and extension), i.e. they
should be stored in the same file. This is foreseen and technically supported
by the ILCD reference format.
The concrete nomenclature and other conventions in the subsequent chapters are
derived reflecting the above approaches and considerations and are justified
discussing briefly the pros and cons of possible solutions.
1.4 Specific approach for flows
The hiera rchical classification  of a flow data set is formally equivalent to the
assigning of it to a category / sub -category structural level as often done for
structuring the user access to the data sets in LCA databases. Two different types of
such classificatio ns should be differentiated: those that are mere classes a flow is
assigned to (e.g. grouping of substances into "organic" or "inorganic"), and those that
actually have a methodological/semantical meaning (e.g. grouping of substances into
compartments and sub-compartments of the receiving / providing environment such
as "Emissions to air" and "Emissions to water" that result in different LCIA factors for
the elementary flows). Focus is here laid on the second type, the semantically
meaningful information th at is implemented in the ILCD data set format as
elementaryFlowCategory. Note that for structuring database contents in LCA

--- Page 15 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 5
software applications both classifications can be used  (alternatively or in
combination), depending on intended users and preference of the software provider.
Generally, the following problems are identified regarding both the classification of
flows and the structure of LCA databases in general:
 No or too little classification/structure ( e.g. no structure but  hundreds or
thousands of objects in database)
 Unbalanced classification/structure (e.g. resulting in hierarchies with 1 to 5
objects in one class but at the same time other  classes with over 500
objects)
 Unnecessarily high number of hierarchies used in hierarchical
classification/structure (e.g. Elementary flows / Resources / Non -renewable
energetic resources / Solid non-renewable energetic resources / Hard coal
resources / , where after five mouse -clicks the user can finally see the list of
the actual elementary flows of different types of hard coal).
 Classification/structure not oriented to state -of-the-art of LCI practice and/or
LCIA methods
 Ambiguous structure (e.g. largely overlapping logic).
 Especially for product and waste flows a "source" -type ("from which industry
or pro cess type does the substance come"), a "purpose" -type ("for which
purpose is the substance used") and a "substance" -type ("what type of
substance is it") classification approach can be found in practice. Of these,
the make -type often results in problems, s uch as e.g. "Sulphur; technical
quality" as a product flow is found under "refinery" and "copper industry", but
a "Sulphur mix" product flow can not be clearly placed (or found) anywhere.
The preferred classification type will depend on the application, i. e. industry-
specific eco-design LCI databases would probably be best structured along
the use-type, while general back -ground LCI databases would best follow a
substance-type classification.

Therefore the recommended hierarchical classifications and recom mendation for
use in structuring a general database, content should reflect the following
considerations:
 Its logic is intuitive and easily comprehensible and independent of the
specific e.g. industry context in which the LCA database is used (while in -
house a different structure can still be used, data exchange and reporting is
based on a common reference structure)
 It has an evenly balanced, and appropriate absolute number of entries in
each classification level sub -classifications in each classification,  as this
allows fast identification of objects. This is typically the case if between 5 to
10 entries exist, both for each classification level and for the data sets in
each classification and sub-classification: the human eye and brain can very
quickly grasp the content and identify the required next -lower classification.

--- Page 16 ---
ILCD Handbook: Nomenclature and other conventions          First edition
 6
A smaller number of classes results in too many hierarchies and required
"clicks", a much higher number in too long lists to read. For the data sets in
the classes, however other aspects are to be considered, such as named in
the following bullet-point.
 It puts objects together into one folder that are required in the same context
of e.g. LCI work (e.g. when building up an combustion emission inventory,
the user will need to compile different organic emissions to air, what is eased
if found in the same folder), as far possible
 For elementary flows, its differentiation on top -level is additionally driven
from LCIA perspective, i.e. only where LCIA methods require actually a
differentiation, a separate classification should be given
 It is not overlapping and leaves no relevant gaps, as far as possible. As this
is typically not fully avoidable it offers an “other” option to allow placing
objects that can not be (clearly) put elsewhere.
 Finally, as many specific database structures are already employed in widely
used LCA tools and databases, the reference structure orients to this
existing practice as far as possible as a harmonised suggestion. As some
software tools are limited to handle more th an two hierarchy levels also for
elementary flows, the number of mandatory but also recommended levels
should be limited, if acceptable from the other considerations.
The following mandatory and recommended classifications take these
considerations into account.
1.5 "Mandatory" and "recommended" items of this
document
The nomenclature and other conventions are subdivided into "Mandatory" and
"Recommended” ones. Furthermore, a differentiation is made for deliverables for
non-technical target audience, which generally have less strict requirements for exact
compatibility and those for technical audience, such as LCI data sets , where different
classification systems and the like would render a data exchange among
practitioners and their common use more cumbersome.
For "mandatory" items, any deviating use would very likely render data exchange
incompatible or LCA study comprehension and review more laborious and/or result in
errors that affect the LCI and LCIA results. Other rules are set "recommended" only,
as a d eviating use would not have the strong negative effects as described just
above. They allowing for more flexibility in individually cases. To consequently apply
this guidance is intended to nevertheless support better  compatibility and a more
efficient work flow in data exchange and reporting and hence to save time and cost.
Rule 1: Requirement status of the individual rules:
