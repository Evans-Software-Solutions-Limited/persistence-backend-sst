# Coach nutrition: current capability and next delivery

Reviewed against the current local implementation on 23 September 2026; this is a code audit, not confirmation of the installed demo build.

| Capability                                                        | Current state                                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| PT sets a client's daily calories/macros/water                    | Implemented from Client Detail, with manual entry and a calculator. Writes are attributed to the coach and notify the client. |
| PT sees client nutrition progress                                 | Aggregate calorie/adherence summaries exist. This is not a meal-by-meal food diary.                                           |
| PT creates and assigns a specific meal to a client                | Not implemented as a coach-to-client workflow. Personal recipe and saved-meal creation already exist.                         |
| PT authors and sends a dated meal plan                            | Specified in spec 38; implementation tasks remain open.                                                                       |
| Import an individual recipe from a photo                          | Implemented in personal recipe tools, with review before saving and the existing AI access gate.                              |
| Import an individual recipe from a URL                            | Implemented; pasted ingredients/method and manual creation provide recovery when extraction fails.                            |
| Import a complete meal plan from PDF, pictures or free-form notes | Not implemented. Recipe photo capture is not a whole-plan importer.                                                           |

## Recommended next delivery

After dislike enforcement and guided swaps, prioritise **a PT assigning one specific meal, then a day of meals, to a client**. This gives imported content somewhere useful to go. Reuse the current recipe editor, food quantities, nutrition calculations and athlete logging.

Then add a single import-review flow for PDF, images and pasted notes: extract days, meal slots, recipes, portions and instructions into an editable draft; highlight unreadable quantities and unknown nutrition; let the PT correct it, check it against the client's preferences and send it. Importing or receiving a plan must not record it as eaten. The athlete reviews and accepts it before use.

Existing spec 38 already captures recipient-owned copies, attribution, consent and coach/athlete access. Those decisions belong in the implementation of sharing; current permission to set targets does not grant full access to the client's private food diary.

## Implementation evidence

- Target editor/calculator: `packages/mobile/src/ui/presenters/coach/EditNutritionTargetsSheet.tsx`.
- Authorised target write, audit and notification: `microservices/core/src/application/trainers/nutrition/setClientNutritionTarget.ts`.
- Aggregate progress: `microservices/core/src/application/repositories/clientDetailRepository.ts`, `getCalorieHit`.
- Current coach library is Programmes/Workouts/Exercises: `packages/mobile/src/ui/containers/CoachLibraryHubContainer.tsx`.
- Personal photo/URL/manual entry points: `packages/mobile/src/ui/containers/AddRecipeMenuContainer.tsx`.
- Photo extraction accepts JPEG/PNG, not PDF: `microservices/core/src/application/nutrition/ai/extractRecipe/nutritionAiExtractRecipeHandler.ts`.
- Paste recovery: `packages/mobile/src/ui/containers/RecipeImportContainer.tsx`.
- Agreed foundation and unfinished sharing scope: `specs/38-coach-nutrition/requirements.md` and `tasks.md`.
