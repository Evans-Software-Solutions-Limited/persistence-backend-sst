# Claude handoff review — 2026-08-31

Reviewed against `main` at `12dfda83` and the production mobile component tree.

## Accepted

- Seven-step, once-only onboarding with whole-journey Skip on Welcome and
  page-level Skip thereafter.
- Existing Edit Profile, Habit Setup, Subscription Selection, purchase flow,
  catalogue, and Train overview are extension points rather than replacements.
- Nutrition and training intent are single-choice capability levels.
- Athlete defaults to Premium+; coach recommendation follows the existing
  client-cap ladder. Show other plans and Continue with Free remain available.
- Weight and Body Fat get separate pages from their existing You/Progress cards.
- Estimated 1RM is one compact banner below exercise media.
- Exercise ordering applies in create, edit, and live sessions; supersets move
  as one block.
- Coaching work completes the existing coach/athlete contract and Train surface;
  it does not add a parallel dashboard or tab.

## Corrections applied

- Home is not redesigned and does not gain body-metric tiles.
- The role choice is tiles only, not a tab plus tiles.
- DOB uses the shared JS-only Fuel calendar and does not trigger a new binary.
- Exercise ordering uses dependencies already in the binary and remains OTA-safe.
- The 1RM formula is not displayed; only the estimate and source set are shown.
- Separate body pages have no overflow menu.
- The broad legacy `CLAUDE_CODE_MIGRATION_PLAN.md` is unrelated to this scope and
  is not an implementation source.

## Engineering decisions

- Onboarding terminal/progress state is user-scoped server data with an offline
  SQLite mirror, so reinstalling or changing device does not replay it.
- Recommendation intent is persisted with onboarding progress for resume and
  analytics, but never grants entitlement.
- 1RM uses an authorised user/exercise-scoped backend read over completed sets;
  the client does not infer an all-time result from the recent-set hint cache.
- The old combined body-history route redirects to Weight for compatibility.
- Athlete-visible briefs and private coach notes remain separate API fields;
  private notes never enter the athlete payload.

No further Claude design pass is required before implementation.
