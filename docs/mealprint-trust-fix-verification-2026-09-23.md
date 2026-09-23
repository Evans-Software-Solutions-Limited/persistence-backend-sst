# Mealprint trust fixes — local verification

23 September 2026. Prepared for PR review; no deployment or native build.

## Behaviour changed

- A **fish dislike includes shellfish**: sea bass, prawns, crab, mussels and the existing recognised seafood vocabulary/tags are excluded. Specific species dislikes remain specific. Allergen rules remain separate.
- Candidate selection and generated output both enforce avoidances. Generated meal titles are checked; swaps reject items that fail the final avoidance check.
- Explicit common-protein requests, including **“something quick and chicken based”**, influence catalogue retrieval and survive the candidate cap. Suggestions/swaps must contain a meaningful amount of the requested protein in resolved food rows. A single requested protein group supplies at least 5g and half the plate's protein. A generated title, flavouring or token garnish does not satisfy it.
- Saved avoidances take precedence. Missing compatible ingredients produce a no-match result before inference, rather than an unrelated substitute. No-match copy does not ask users to remove allergies or dislikes.
- Draft and accepted-plan swaps offer optional feedback, presets, Generate and Cancel. Failed attempts retain feedback and the original meal; busy/lifecycle guards prevent stale forms and competing actions.

## Production-shaped regression and review corrections

- The saved phrase “all fish except tinned tuna for sandwiches” previously let sea bass and prawns through: the literal matcher required every word in the dislike to occur in the food name. Dietary-pattern and dislike field mappings were separate and correct in the inspected source.
- Bounded category phrases now enforce the fish/seafood/shellfish exclusion. Only explicitly named tinned/canned tuna sandwiches satisfy the scoped exception. Plain tuna, fresh tuna, sandwich fillings and mixed seafood remain excluded; unknown exception prose keeps the category exclusion. This is conservative matching, not arbitrary natural-language interpretation.
- Inspector review prompted fixes for negated comma lists/preparation words and reserving each requested ingredient term before the SQL retrieval cap. Ingredient checks use the original food name, so brands such as “Chicken of the Sea” cannot satisfy a chicken request. Swap presets now use standalone requests (High protein, Quick to make, Chicken based), rather than relative instructions requiring unavailable original-meal context.

## Evidence

Final isolated PR branch: **595 backend tests (19 suites)** and **199 mobile tests (5 suites)** pass; full typecheck **9/9** and lint **6/6** pass. Inspector Brad's local full-diff review is clean after resolving all four findings. Updated shortcut screenshots verify normal, busy and error states at phone width. Earlier broad-run coverage evidence and its limits follow.

- Final focused backend run: **555 tests pass**, followed by four additional negation regressions; final guidance helper **24 tests, 100% coverage** across all metrics.
- Revert checks: fish handling, title/swap checks and SQL/request enforcement regressions fail when the corresponding fixes are removed.
- SQL request-priority test runs in PGlite with 600 competing higher-protein prawn rows and verifies requested chicken is retrieved first.
- Full mobile suite: **536 suites / 6,972 tests pass**. Later lifecycle additions: **48 container tests pass**, with 92.30% / 90.62% branch coverage; shared feedback component coverage 100%. Final copy/hook tests: **176 pass**.
- Actual feedback component rendered at phone width with app tokens/fonts: custom input, loading and error screenshots in `docs/evidence/mealprint-swap/`. Preview wrapper uses a synthetic meal; it is not a native or authenticated end-to-end test.
- Final broad backend run: **5,320 pass, 2 time out** in unchanged admin-marketing integration tests. The isolated admin suite subsequently passes **78/78 assertions**; its single-file invocation naturally fails the repository-wide coverage threshold. The timed-out full run remains a recorded flaky/host-contention result, not a clean first-pass green.
- Earlier broad test task passed 21/21 tasks before the final guidance changes. Final full typecheck initially passed 9/9; the last parser edit then exposed TS7022 in the web build, corrected with explicit boolean annotations. Final non-mobile build passes **12/12 tasks**.
- One broader coverage run collided with another run's temporary directory. Subsequent runs were isolated; orphaned workers from the interrupted run were identified by working directory and stopped. No production/application process was stopped.

## Limits and release check

Ingredient interpretation uses an explicit common-protein vocabulary. Arbitrary prose and preparation speed are not deterministically verified. Saved recipe titles alone cannot establish their ingredients for this check. Multi-meal day-plan guidance remains prompt-based so a dinner request is not imposed on every meal.

Live model testing is **not complete**: the development AWS SSO login expired and could not refresh. `scratchpad/mealprint-guidance/live-smoke.ts` is ready for two real-model checks using synthetic candidates after reauthentication; its import-only check passes. No customer data is used.

Before the demo: deploy the backend changes through the usual release process, refresh the mobile app through Brad's build/release process, and perform an authenticated walkthrough of fish avoidance, quick chicken suggestions, guided swaps, conflicting requests and no-match/retry behaviour. Native keyboard/sheet behaviour also needs device verification.
