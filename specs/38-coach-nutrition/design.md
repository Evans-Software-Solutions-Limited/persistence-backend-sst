# Coach nutrition — implementation contract

## Existing seams (main 9dc86814)

- `packages/mobile/src/ui/containers/FuelTargetsContainer.tsx`: calculator inputs; latest weight measurement takes precedence over profile weight. Use `updateProfileCommand` and measurement logging rather than a parallel profile store.
- `microservices/core/src/application/recipes/import/recipesImportHandler.ts`: authenticated preview, no persistence; `safeRecipeFetch` checks DNS/private networks, redirects, content type, byte budget and timeout. Keep these controls for every future parser.
- `application/recipes/services/parseRecipe.ts`: deterministic extraction. Expand nested JSON-LD/grouped instructions, preserve order and unknown nutrition. Multiple-recipe selection, HTML microdata and AI extraction require separate fixtures/evaluation.
- `packages/mobile/src/state/recipe-draft.ts` and `RecipeCreateContainer.tsx`: one review/save path. Paste fallback populates user-supplied lines without inferring amounts or macros; source URL is retained separately from extraction provenance.
- `application/trainers/nutrition/setClientNutritionTarget.ts`: existing relationship guard, transactional audit and post-commit notification pattern. This endpoint expressly limits the existing coach mandate to targets.
- `application/repositories/recipeRepository.ts` and `mealPlanRepository.ts`: owner-scoped reads; plan `createdByUserId` provides attribution but does not grant access. Do not relax their ownership predicates.

Paths beginning `application/` are relative to `microservices/core/src/`.

## Proposed sharing model

Add a private `coach_nutrition_shares` record containing sender, recipient, relationship, kind (`recipe|plan`), immutable bounded content snapshot, schema version, source revision, idempotency key, status (`pending|accepted|declined|revoked`), timestamps and accepted object IDs. Actor/owner IDs come from authentication/relationship lookup. Payloads contain references and portions; the server resolves ownership and snapshots authorized content. Audit records do not contain private unrelated athlete data.

Send locks/revalidates the active relationship and expected source revision in the write transaction, then inserts the share/audit and durable notification outbox with a unique sender+recipient+idempotency key. Reusing a key with a different payload is a conflict. Sending one share must not expose the rest of the sender's library.

Proposed endpoints:

- Coach `POST /trainers/me/clients/:clientId/nutrition-shares` and scoped list/revoke endpoints.
- Athlete `GET /nutrition/shares`, detail, `POST /nutrition/shares/:id/accept` and decline.
- Coach meal-plan draft CRUD stays in the coach's own library; recipient targeting occurs only at send.

Accept atomically verifies recipient, pending state, current relationship/consent, supported snapshot version and avoidance/ingredient validity; copies the recipe/meal/private-food dependency graph to recipient-owned IDs with explicit source attribution; creates a draft plan; records accepted IDs/audit. Deduplicate the copy graph within the share and reuse accepted IDs on retry. Public food references may be reused only if currently accessible; private foods require copies or a visible unresolved-ingredient decision. Do not silently drop deleted/unresolvable ingredients. Derived nutrition is recomputed server-side; unknown and estimated values retain provenance.

Activation is a separate athlete action using expected active-plan revision. If an active plan already exists on a date, show an explicit replace decision; never silently archive it during share acceptance. Preserve accepted snapshot/logged history on coach edits, relationship termination, source deletion or account deletion. Pending shares revoke on offboarding; serialize accept/revoke using the same relationship/share locks. The coach sees their own share statuses, not unrestricted athlete nutrition history.

## UX

Coach Clients → athlete → Nutrition: existing targets plus Draft meal plan and Share recipe. Coach recipes use the same import/create review flow, with multi-select for day/meal slots and deterministic totals. Athlete Fuel → From your coach: received recipes/plans, attribution, date, review/decline/accept. After acceptance use existing plan views, shopping lists and explicit Log meal flow. An import button is available inside the coach's recipe picker; it must not save directly into an athlete account.

## Wider URL coverage

Current delivery removes misleading verified-site claims and adds recoverable paste input. Further extraction should try standards-based JSON-LD/microdata before an explicitly requested, quota-controlled page-text extraction. Untrusted page text is data, cannot choose tools/recipients or issue instructions, and cannot bypass fetch policy. Return source-grounded fields, unresolved portions and confidence; require review. Evaluate authorized examples across blogs, grouped recipes, JS-only pages, malformed schemas, paywalls, missing nutrition and hostile markup. No promise that every URL can be read. Google documents HowToSection grouping: https://developers.google.com/search/docs/appearance/structured-data/recipe (checked 21 September 2026).
