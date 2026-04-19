# 13 — Nutrition Tracking: Requirements

> **This spec is a stub; requirements pass scheduled for pre-M9.** The nutrition feature has no legacy counterpart — it's a net-new full-stack build. A discovery agent needs to author this document before the M9 briefs are cut.

## User needs

TBD.

Likely areas to probe during discovery:

- What do users track? (meals, individual foods, macros, calories, water, possibly body-composition correlations)
- Do we need barcode scanning? Food database integration (USDA, OpenFoodFacts, MyFitnessPal-style branded catalog)?
- Meal templates / recipes / quick-log?
- Daily targets (calories, protein/fat/carbs g, water L)?
- Weekly rollups? Correlations with training volume?
- Trainer/physio visibility into client nutrition (cross-cuts with M8)?

## Acceptance criteria

TBD.

## Out of scope

TBD.

## Open questions

- Offline strategy for a large food database — do we ship a cut-down database in-app, or require connectivity to search?
- Integration with Apple Health / Health Connect nutrition data?
- Does nutrition appear as its own tab, or live under Progress?
