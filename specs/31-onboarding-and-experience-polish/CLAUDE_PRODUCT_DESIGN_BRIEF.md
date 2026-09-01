# Claude product-design brief — onboarding and experience improvements

**Owner:** Brad
**Stage:** Product design and component audit only
**Production implementation:** Not authorised until Brad approves the returned
prototype and the revised specs
**Repository:** `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst`

## Why this brief exists

An earlier standalone HTML prototype was rejected because it invented controls,
navigation chrome, cards, and information architecture instead of showing how
the requested changes fit the application that already exists.

Do not redesign Persistence. Start from the current mobile app, use its actual
screens and components, and show the smallest coherent changes required.

The rejected prototype at
`/Users/bradleysimms-evans/Documents/Persistence Gym Application/` is **not a
design reference**. It may only be used to understand the rejected directions
listed below.

## Your assignment

Produce a high-fidelity, clickable design prototype and an implementation-ready
component map for the requested onboarding and experience changes.

Work in two phases:

1. Audit the current product and present the reuse/delta map.
2. Build the prototype using those existing layouts and components.

Do not write production feature code. Do not rewrite the specs until Brad has
reviewed the prototype; return proposed spec corrections separately.

## Mandatory repository audit

Read the complete relevant files—not just screenshots or isolated components.
At minimum inspect:

### App shell and design system

- `packages/mobile/src/ui/theme/tokens.ts`
- `packages/mobile/src/ui/components/foundation/`
- `packages/mobile/app/(app)/(tabs)/_layout.tsx`
- `packages/mobile/app/_layout.tsx`

### Profile

- `packages/mobile/src/ui/containers/EditProfileContainer.tsx`
- `packages/mobile/src/ui/presenters/EditProfilePresenter.tsx`
- `packages/mobile/src/domain/models/profilePage.ts`
- `packages/mobile/src/application/commands/update-profile.command.ts`

### Subscription role and plan selection

- `packages/mobile/src/ui/containers/SubscriptionSelectionContainer.tsx`
- `packages/mobile/src/ui/presenters/SubscriptionSelectionPresenter.tsx`
- `packages/mobile/src/ui/containers/IOSPurchaseFlowContainer.tsx`
- the corresponding iOS purchase-flow presenter
- `packages/mobile/src/ui/components/subscription/`
- `packages/subscription-catalog/src/index.ts`
- `specs/29-subscription-restructure/`

### Habits

- `packages/mobile/src/ui/containers/HabitSetupContainer.tsx`
- `packages/mobile/src/ui/presenters/habits/`
- `packages/mobile/src/application/commands/configure-habit.command.ts`
- `packages/mobile/src/domain/models/habit-config.ts`

### Nutrition

- current Nutrition/Fuel tab presenters and containers
- calorie-target editing flow
- barcode logging flow
- Snap/photo calorie-estimation flow
- Mealprint flow and gates
- the real tier/feature catalogue copy

### Training and exercise order

- `packages/mobile/src/ui/presenters/WorkoutFormBody.tsx`
- `packages/mobile/src/ui/hooks/useWorkoutForm.tsx`
- `packages/mobile/src/ui/containers/WorkoutCreatorContainer.tsx`
- `packages/mobile/src/ui/containers/WorkoutEditorContainer.tsx`
- `packages/mobile/src/ui/presenters/ActiveSessionPresenter.tsx`
- `packages/mobile/src/ui/containers/ActiveSessionContainer.tsx`
- `packages/mobile/src/domain/services/workout.service.ts`
- session exercise/superset components

### Measurements and exercise detail

- `packages/mobile/src/ui/components/home/BodyWeightTile.tsx`
- `packages/mobile/src/ui/components/home/BodyFatTile.tsx`
- `packages/mobile/src/ui/containers/BodyHistoryContainer.tsx`
- `packages/mobile/src/ui/presenters/BodyHistoryPresenter.tsx`
- the existing measurement logging sheet/container
- `packages/mobile/src/ui/containers/ExerciseDetailContainer.tsx`
- `packages/mobile/src/ui/presenters/ExerciseDetailPresenter.tsx`
- current session/record history domain services

### Coach and athlete relationship surfaces

- `packages/mobile/src/ui/containers/ClientDetailContainer.tsx`
- `packages/mobile/src/ui/presenters/coach/ClientDetailPresenter.tsx`
- `packages/mobile/src/ui/containers/TrainHubContainer.tsx`
- `packages/mobile/src/ui/containers/TrainOverviewContainer.tsx`
- `packages/mobile/src/ui/presenters/TrainOverviewPresenter.tsx`
- `packages/mobile/src/ui/containers/AthleteProgramContainer.tsx`
- relationship/programme/habit/target/goal/brief query hooks and models

Also compare the relevant legacy mobile screens where the repo instructions say
the V2 surface is a port. Do not accidentally discard working behaviour.

## Audit output required before prototyping

Return a table with one row per requested page/feature:

| Request | Existing screen/component | Reuse unchanged | Small adaptation | New component genuinely required | Data/command already available | Open decision |
| ------- | ------------------------- | --------------- | ---------------- | -------------------------------- | ------------------------------ | ------------- |

Rules:

- If an existing component can do the job, use it.
- If an existing component needs an onboarding mode, propose the smallest prop
  or wrapper change.
- Do not create onboarding-only copies of profile, habits, nutrition,
  subscription cards, workout rows, body history, or coaching modules.
- Do not create visual controls merely because the prototype tool makes them
  convenient.

## Onboarding journey to design

The journey is shown automatically once per user after authentication/required
consent. Completion and dismissal are terminal for automatic display.

### 1. Let's get you started

- Use the real Persistence logo.
- Explain what will be set up and the approximate time.
- **Skip setup** immediately exits to the real Home screen and records the whole
  journey as dismissed.
- Do not show a “You're ready”, success, confirmation, or intermediate page
  after Skip setup.
- Continue enters Make it yours.

### 2. Make it yours

- Reuse the existing Edit Profile fields, order, validation, and controls as far
  as possible.
- Do not add profile fields that the application does not store.
- Weight is a measurement, not a profile value.
- Use native controls or a maintained package for date/calendar and select-style
  interaction. Do not hand-build either.
- First check whether an acceptable component already exists in the app or in an
  installed dependency.
- Existing profile fields already use chips/toggles for fitness level, metabolic
  sex, height unit, and weight unit; prefer reusing them rather than introducing
  dropdowns.
- Date of birth currently uses a raw ISO text field and needs a better control.
  The repo does **not** currently declare a native date-picker dependency. If the
  proposed component requires a native dependency, call out the binary-build
  impact and wait for approval before production implementation.

### 3. How will you use Persistence?

- One choice presentation only: two selectable tiles—**For myself** and
  **Coach others**.
- Do not show tabs plus tiles, a segmented control plus tiles, or two duplicate
  selection mechanisms.
- Reuse the role semantics and state from Subscription Selection.
- Coach selection asks expected active clients using an existing selection
  pattern: 1–5, 6–15, or 16–30.
- Explain that coaches can still track their own training.

### 4. Build your daily habits

- This is the existing Habit Setup experience presented in onboarding context.
- Reuse its real category cards, target controls, units, validation, and save
  command.
- Do not create summary rows pretending to configure habits.
- Do not add an onboarding habit model.

### 5. Let's set up your nutrition

- Explain the real tier ladder:
  - Free: calorie goals, calorie tracking, and barcode scanner.
  - Premium: photo calorie estimation that the user reviews before saving.
  - Premium+: Mealprint personalised meal suggestions around calorie targets.
- Record one single choice representing the highest nutrition capability the
  user wants: Free, Premium, or Premium+.
- This is **single-select**, not a multi-select checklist.
- Use an existing card/radio/selection pattern from the app.

### 6. Train

- Explain the real tier ladder:
  - Free: up to 3 custom workouts.
  - Premium: unlimited workouts and history.
  - Premium+: Loadout gym setup and equipment-aware workout adaptability.
- Record one single choice representing the highest training capability the
  user wants: Free, Premium, or Premium+.
- This is **single-select**, not a multi-select checklist.
- Use an existing card/radio/selection pattern from the app.

### 7. Recommended subscription

- This should look and behave like the existing Subscription Selection screen,
  not a new paywall.
- Highlight the plan that covers the higher of the Nutrition and Train choices.
- Athlete defaults may lead to Premium+, but the recommendation must reflect the
  actual single choices the user made.
- Coach mapping follows the existing catalogue:
  - 1–5 clients: Start Up Coach, or Start Up Coach+ if adaptive-suite capability
    is required.
  - 6–15: Coach.
  - 16–30: Coach Pro.
- Show other plans expands/renders the existing plan cards for that audience.
- Trial eligibility appears on the plan tile/card only when the live store says
  the user is eligible.
- Purchase CTA always says **Subscribe**.
- Continue with Free is always available and completes onboarding.
- Use live store price/cadence/legal/restore behaviour.

## Secondary feature designs

These must be drawn as deltas inside the actual existing screens, not as new
screens unless explicitly required.

### Exercise ordering

- Add a drag handle to the existing exercise row design in workout create,
  workout edit, and active workout.
- The repository already ships `react-native-gesture-handler`, Reanimated, and a
  root gesture host. It also already has `reorderExercises`.
- Design/implementation must use those shipped capabilities; do not add a drag
  library or native dependency.
- On current evidence this is a JavaScript-only, OTA-compatible change and does
  **not** require a new binary. Confirm no native/config/plugin changes in the
  final implementation plan.
- Moving any member of a superset moves the entire contiguous superset block.
- Create/edit persists workout order; active workout changes that session only.
- Include accessible Move before/Move after actions and an announcement of the
  new position.

### Weight history

- Tapping the existing Weight Home tile opens a dedicated Weight screen.
- Base it on existing Body History and measurement components.
- Add graph, full weight history, ranges if supported by the available data, and
  a weight-context log action.
- Do not add an unexplained top-right overflow menu.

### Body Fat history

- Tapping the existing Body Fat Home tile opens a separate dedicated Body Fat
  screen.
- Base it on existing Body History and measurement components.
- Add graph, full body-fat history, ranges if supported, and a body-fat-context
  log action.
- Do not combine Weight and Body Fat into a segmented page.
- Do not add an unexplained top-right overflow menu.

### Exercise 1RM

- The capability required is: when a user opens a specific exercise and has
  qualifying previous weighted lifts, show an estimated 1RM using an accepted
  formula and clearly identify it as an estimate.
- Do not assume the rejected prototype's banner is the correct treatment.
- Start from the real Exercise Detail screen and propose the smallest treatment
  that fits its hierarchy and existing components.
- Show the source set and formula explanation without turning Exercise Detail
  into a new analytics dashboard.
- No qualifying history means no additional UI.

### Coach/client and athlete coaching information

- The capability required is to make the complete assigned setup visible:
  programme/workouts, habits, targets, goals, nutrition setup, and appropriate
  coach information.
- Do not assume the rejected prototype's Coaching tab/cards are correct.
- Audit what the existing coach Client Detail and athlete Train/Training surfaces
  already show, identify the actual missing data or relationship-gating defect,
  and prototype only those deltas.
- Respect private coach notes and existing authorisation boundaries.
- The coach and athlete sides must derive from the same relationship/assignment
  contract and invalidate coherently.

## Rejected directions—do not repeat

- Standalone visual language or web-style phone mockups that do not match the
  current application.
- Hand-built calendar, dropdown, select, graph controls, or drag framework.
- Tabs plus tiles for the same Athlete/Coach choice.
- Multi-select Nutrition or Train checklists.
- A separate “Set up coaching space” onboarding page.
- A “You're ready” page after Skip setup.
- Unexplained overflow menus on Weight or Body Fat.
- Assuming a 1RM banner treatment before reviewing Exercise Detail.
- Assuming a brand-new Coaching dashboard before auditing existing surfaces.
- Duplicating Habit Setup or Subscription Selection.

## Prototype requirements

1. Prototype at the actual app device dimensions and safe-area behaviour.
2. Use screenshots/renders of the real current app as the baseline.
3. Reuse actual component styles/tokens/assets in the design source.
4. Provide both Athlete and Coach onboarding branches.
5. Demonstrate:
   - welcome Skip going straight to Home
   - profile date/selection interaction
   - single-select Nutrition and Train choices
   - recommendation recalculating from choices/client band
   - Show other plans and Continue with Free
   - one superset block being reordered
   - separate Weight and Body Fat entry points/screens
   - proposed minimal 1RM treatment in real Exercise Detail
   - actual coach/athlete screen deltas
6. Show loading, empty, unavailable/offline, and existing-paid-user states where
   they materially change the journey.

## Deliverables back to Brad

Return these as separate artefacts:

1. `CURRENT_COMPONENT_AUDIT.md` — the reuse/delta table and evidence paths.
2. Clickable prototype source and exported screenshots.
3. `DESIGN_DECISIONS.md` — only decisions that cannot be read directly from the
   prototype, including package/native-build implications.
4. `SPEC_CHANGESET.md` — precise replacements/additions for requirements,
   design, and tasks; do not silently rewrite them.
5. `IMPLEMENTATION_SLICES.md` — dependency-ordered slices with file ownership,
   tests, migration/API needs, OTA vs native-build classification, and rollout.
6. An explicit list of unresolved product decisions for Brad. Do not make those
   decisions implicitly in the prototype.

## Acceptance bar for the design stage

The design stage is complete only when:

- every new visual element names the existing component it reuses or explains
  why a new component is unavoidable;
- no requested interaction has two competing controls;
- Nutrition and Train are single-select;
- the recommendation follows those choices and client count;
- Skip setup goes directly to Home;
- the profile does not fork Edit Profile;
- Habit Setup and Subscription Selection remain the implementation owners;
- body metric screens have no invented overflow menus;
- 1RM and coaching treatments are grounded in their real current screens;
- native dependency/build implications are explicit;
- Brad has approved the prototype before production code begins.
