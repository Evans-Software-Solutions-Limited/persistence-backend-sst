# 31 — Onboarding and experience polish · Requirements

Status: **Approved for implementation — 2026-08-31**
Approved prototype: `/Users/bradleysimms-evans/Downloads/Persistence Gym Application (3)/Persistence - Onboarding & Experience Deltas.html`

This specification incorporates the approved Claude handoff and Brad's final
review corrections. The prototype is visual guidance; production components,
commands, catalogue, and data contracts remain authoritative.

## Goal

Show each new user one useful onboarding journey that configures the existing
profile, habits, nutrition, and training features before recommending the
existing subscription that best matches what they said they want. The journey
must not duplicate existing feature setup or become a mandatory paywall.

## Product principles

1. Reuse the app's existing profile, subscription-role, habit, nutrition,
   workout, and purchase components and commands.
2. **Skip setup** on the opening page skips and permanently dismisses the whole
   journey. Skip on later pages skips only that page.
3. The journey is automatically shown once per user. Normal Settings screens
   remain the way to edit the same information later.
4. Explain Free, Premium, and Premium+ capability boundaries before asking for
   a subscription.
5. Continue with Free remains a clear option.

## STORY-001 — One-time journey

**As a newly verified user, I want one guided setup so Persistence starts in a
useful state without repeatedly interrupting me.**

Acceptance criteria:

1. After authentication and required consent, a user with neither completed nor
   dismissed onboarding sees these pages in order:
   1. Let's get you started
   2. Make it yours
   3. How will you use Persistence?
   4. Build your daily habits
   5. Let's set up your nutrition
   6. Train
   7. Your recommended plan
2. The opening **Skip setup** action exits to Home, records `dismissed`, and
   prevents the journey from being shown automatically again.
3. Skip on pages 2–7 records that page as skipped and advances to the next page.
4. Completing, subscribing, or continuing with Free records `completed` and
   prevents automatic replay.
5. Killing the app during an unfinished journey resumes at the last incomplete
   page.
6. The production welcome page uses the existing Persistence logo asset.
7. Settings edit the same underlying data later; there is no second onboarding
   database model for profile, habits, or nutrition values.
8. Analytics record page viewed/completed/skipped and journey completed/dismissed
   without body values, names, birth dates, exercise loads, or client IDs.

## STORY-002 — Make it yours using the real profile

1. The page reuses/extracts the existing Edit Profile fields and validation:
   full name, avatar, date of birth, fitness level, metabolic sex, height,
   height unit, and weight unit.
2. It does not add an onboarding-only `primaryGoal` or store weight on the
   profile. Body weight remains a measurement.
3. Date of birth uses the shared, JS-only calendar extracted from Fuel behind an
   accessible date-only field rather than a raw `YYYY-MM-DD` text field. It
   requires no native dependency or new iOS/Android binary release.
4. Select controls are functional and use the same option values as Edit Profile.
5. The calendar component is reusable throughout the app for date-only fields;
   existing date text fields should adopt it when this release touches them.
6. Canonical persistence remains unchanged: height in centimetres, DOB as an ISO
   date, and display-unit preferences as the existing enums.
7. Metabolic sex and height explain that they are used to estimate calorie
   targets, matching existing profile copy.

## STORY-003 — Use the subscription role selection

1. **How will you use Persistence?** uses the same Athlete / Coach values and
   subscription-selection state, presented as exactly two selectable tiles.
   It must not render a tab or segmented selector as a second control.
2. Athlete is labelled **For myself** and coach is labelled **Coach others**.
3. Selecting Coach explains that the user can still track their own training.
4. Coach asks the expected active-client band: 1–5, 6–15, or 16–30.
5. The client band is recommendation input only and never grants coach
   permissions or entitlements.
6. The choice feeds directly into the subscription-selection state and catalogue
   filter used by the final page.

## STORY-004 — Build your daily habits with Habit Setup

1. The page is titled **Build your daily habits**.
2. It mounts/reuses the existing Habit Setup components, category definitions,
   bounds, unit handling, attribution, and `configure-habit` command.
3. The user can enable and configure supported habits with real targets.
4. No onboarding-specific habit schema, command, or validation is introduced.
5. Skipping leaves habits unchanged; failed/offline saves follow the existing
   sync-queue behaviour.

## STORY-005 — Record nutrition intent

1. The page is titled **Let's set up your nutrition**.
2. It explains and lets the user select the tools they want:
   - **Free:** set calorie goals and track calories with the barcode scanner.
   - **Premium:** everything in Free plus reviewable AI photo calorie estimation.
   - **Premium+:** everything in Premium plus Mealprint personalised meal
     suggestions around calorie targets and preferences.
3. The photo-estimation copy says it is an estimate the user reviews before
   saving; it does not claim exact recognition.
4. Selections are stored as onboarding recommendation intent. Selecting a feature
   does not grant entitlement or begin a purchase.
5. Existing nutrition setup remains the implementation surface after onboarding.

## STORY-006 — Record training intent

1. The page is titled **Train**.
2. It explains and lets the user select the tools they want:
   - **Free:** create up to 3 custom workouts.
   - **Premium:** unlimited workouts and full history.
   - **Premium+:** gym setup and equipment-aware workout adaptability through
     Loadout.
3. Selections are stored as recommendation intent, not entitlements.
4. No first-workout creator or separate coaching-space setup is inserted into
   onboarding.

## STORY-007 — Recommended plan within Subscription Selection

1. The final page is the existing Subscription Selection experience in a
   recommendation state, not a second paywall implementation.
2. It highlights one recommended tile and explains which recorded choices drove
   the recommendation.
3. The athlete path defaults to **Premium+**, driven by the default Mealprint and
   adaptable-training selections. If the user explicitly removes Premium+
   capabilities, the lowest tier covering their retained selections may be
   highlighted instead.
4. Coach recommendation maps to the existing catalogue:
   - 1–5 clients → Start Up Coach, or Start Up Coach+ when adaptive-suite
     features were selected.
   - 6–15 clients → Coach.
   - 16–30 clients → Coach Pro.
5. **Show other plans** expands all plans in the selected athlete/coach ladder,
   using existing subscription cards and live store pricing.
6. A free-trial message appears as a banner on an eligible plan tile. The plan
   CTA always says **Subscribe** so it remains correct when the user is not trial
   eligible.
7. Trial length, eligibility, price, cadence, renewal terms, current entitlement,
   and Restore purchases come from the live purchase/catalogue flow.
8. **Continue with Free** completes onboarding and preserves all free setup.
9. Offline/store-unavailable states still allow Continue with Free.

## STORY-008 — Separate Weight history

1. The You/Progress Weight trend card is an accessible button opening a
   dedicated Weight page. Home composition is unchanged.
2. The page shows latest weight, change, graph, all weight entries, date, unit,
   and source where known.
3. Chart range choices are 1M, 3M, and 12M; the history list contains all
   available entries returned by the existing history read.
4. **Log weight** opens the existing measurement logging flow in weight context.
5. Saving refreshes the page and You/Progress card immediately.

## STORY-009 — Separate Body Fat history

1. The You/Progress Body Fat trend card is an accessible button opening a
   dedicated Body Fat page, not a segment on Weight history. Home composition
   is unchanged.
2. The page shows latest percentage, change, graph, all body-fat entries, date,
   and source where known.
3. Chart range choices are 1M, 3M, and 12M; the history list contains all
   available entries returned by the existing history read.
4. **Log body fat** opens the existing measurement logging flow in body-fat
   context.
5. Weight and Body Fat may share internal chart/list primitives but have separate
   routes, screen titles, empty states, and logging actions.
6. Neither page has an overflow menu.

## STORY-010 — Exercise-detail estimated 1RM banner

1. No separate performance page is added.
2. When qualifying history exists, a compact **Estimated 1RM** banner renders
   directly below exercise images/video and above the normal detail content.
3. One completed rep uses the lifted weight as actual 1RM; completed sets of
   2–10 reps use Epley: `weightKg * (1 + reps / 30)`.
4. The banner shows the estimate, display unit, and source set.
5. The formula is an internal calculation detail and is not written on the
   Exercise Detail page. The banner is limited to the Estimated 1RM label,
   estimate, display unit, and source set.
6. Zero/negative load, assisted/bodyweight-only sets, incomplete sets, and more
   than 10 reps are excluded.
7. With no qualifying lift history, Exercise Detail is unchanged.

## STORY-011 — Complete the existing coaching contract

1. Do not add a parallel coaching dashboard.
2. The existing coach Client Detail and athlete Coaching/Training surfaces resolve
   from the same relationship, programme, assignment, habit, nutrition-target,
   goal, measurement, and coach-brief sources.
3. Coach Client Detail presents active programme, workouts, habits, nutrition
   targets, goal/body trend, upcoming sessions, adherence, and private coach
   notes/actions.
4. Athlete Coaching presents coach identity, active programme/week, upcoming
   workouts, habits, nutrition targets, active goal, and athlete-visible briefs.
5. Private coach notes never appear to the athlete.
6. A cached active relationship remains visible while a network refresh is
   pending; loading must not temporarily remove the athlete tab.
7. Missing modules use purposeful empty/setup states.
8. Ending the relationship invalidates both sides and removes relationship-only
   access immediately.
9. Contract tests cover active, cached-active/loading, pending, ended, and no
   relationship states.

## STORY-012 — Exercise ordering

Exercise ordering is included. Gesture Handler, Reanimated, and the root gesture
host are already shipped, so this is JS-only and OTA-compatible; the date-picker
dependency is the only native-build reason in this package.

Acceptance criteria:

1. Add the drag handle to the existing create-workout, edit-workout, and active
   workout exercise-row designs.
2. Create/edit persists workout template order; active workout changes that
   session only.
3. A superset moves as one contiguous block.
4. VoiceOver/TalkBack receives Move up/Move down custom actions and position
   announcements.
5. The implementation reuses the existing `reorderExercises` domain helper.

## Release success measures

- Journey completion and whole-journey dismissal rate.
- Nutrition/training intent selections and recommended-plan distribution.
- Subscription conversion split by highlighted vs other plan.
- Weight/Body Fat tile-to-log conversion.
- Exercise-detail users with qualifying history who view the 1RM banner.
- Coached athletes who open Coaching and complete an assigned target.

## Explicit non-goals

- A mandatory paywall.
- An onboarding-only habit, profile, nutrition, or subscription implementation.
- Automatically replaying onboarding for existing/completed/dismissed users.
- A separate 1RM performance page.
- Combining Weight and Body Fat into one routed page.
