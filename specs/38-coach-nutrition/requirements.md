# 38 — Coach nutrition and resilient recipe imports

21 September 2026. Brad requested this work alongside the Relay-inspired programme features, in one initial PR. This is native Persistence functionality, not a Relay integration. This scope supersedes spec 26's deferral of coach-authored plans; it does not claim those plans are implemented in the initial foundation PR.

## Outcome

A coach can prepare meals and meal plans, import recipes into their library and share them with an authorized athlete. The athlete reviews what was sent, can use it in their own plan, and logs what they actually eat. Missing calculator profile details can be filled where they are needed.

## Acceptance

- **N1 Calculator:** age/date of birth, sex, height and weight tiles are tappable. Missing inputs say they are required for calculation. Save updates the existing profile/measurement stores and calculator immediately, including during onboarding and offline. Manual calorie entry remains available. Preserve unit preferences and workout/onboarding drafts. No change to calorie formulas in this delivery.
- **N2 Recipe imports:** accept any safely fetchable public recipe URL, without an invented site whitelist. Support nested Recipe JSON-LD and grouped instructions. Review extracted content before saving; preserve source URL. On unreadable/blocked pages offer paste ingredients/method and manual creation without losing attribution. Never invent nutritional values from missing page data. Existing screenshot capture remains available through Add recipe.
- **N3 Coach library:** a paid, authorized coach can manually create meals/plans and use the existing recipe import/review tools. Imported recipes remain private until explicitly shared. Manual authoring/sharing does not silently invoke paid AI.
- **N4 Sharing:** share an owned recipe or a dated meal-plan draft with an active consenting athlete. Label the coach, source and sent date. Recipient reviews before accepting; receipt is not activation, and activation is not food consumption. No auto-logging or overwriting active plans. One recipe can be shared independently of a meal plan.
- **N5 Ownership:** accepted content is athlete-owned, with frozen recipe/ingredient amounts and provenance. Edits/deletion in a coach library cannot change accepted athlete meals or logged history. Sharing copies dependencies the athlete cannot otherwise read; do not expose private library IDs or broad cross-user recipe access.
- **N6 Permission/lifecycle:** trusted actor, coach entitlement, active relationship, seat rules and nutrition consent are checked for every coach read/write and at send/accept. One coach cannot access another coach's drafts or the athlete's unrelated private nutrition. Revocation stops access and pending delivery; accepted athlete copies and food logs remain. Account deletion preserves history per existing policy.
- **N7 Nutrition integrity:** recompute totals from authorized food/recipe data and amounts. Display source-provided versus estimated values and unknowns. Check declared avoidances before acceptance; unknown allergen information remains unknown. Meal planning is general nutrition support, not diagnosis or therapeutic diet prescribing.
- **N8 Recovery:** retries use idempotency keys, revision conflicts are visible, notification failures cannot duplicate shares. Offline athlete logging reuses the existing queue and cannot mutate the coach's plan.

## Working access rule

Proposed default consistent with the training workspace: paid coaches can author/share manually; actively coached athletes can receive and use shared plans without buying personal Premium Plus. Independent AI generation keeps existing personal entitlement/quota checks. The new coach nutrition capability and nutrition-specific consent wording need explicit product confirmation before runtime enablement; current target-setting permission is not blanket access to nutrition history.

## Initial PR boundary

Ship N1 and deterministic/paste N2; deliver the programme W1 model and this coach nutrition contract. N3–N8 remain implementation tasks below, not user-visible features. Broad AI webpage extraction is an evaluated follow-on; it must not replace deterministic parsing or bypass blocked/paywalled pages.
