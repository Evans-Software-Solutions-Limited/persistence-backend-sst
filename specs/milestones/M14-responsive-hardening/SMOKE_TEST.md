# M14 Smoke Test — responsive hardening

Run once the PR lands on the milestone branch. All manual checks should be done on an iOS
simulator (or device) with iOS Settings → Accessibility → Display & Text Size → Larger Text set to
its **maximum** (Accessibility sizes on), in addition to default text size, plus on both an
iPhone SE (or SE-sized simulator) and an iPhone Pro Max (or Pro Max-sized simulator).

## 1. Carousel card clipping

1. Home screen, "Your Workouts" carousel.
2. At default text size on both SE and Pro Max simulators: confirm title (1 line) + description
   (2 lines) render fully inside the card with no visible clipping or overlap with the card's
   edges/other chrome.
3. At maximum accessibility text size: repeat the same check. If the fix from item #1 changed
   fixed height to min-height or added a font-scale-conditional line count, confirm the card still
   looks intentional (not oddly tall, not clipped) at this setting.

## 2. Fuel Targets font tokens

1. Open the Fuel Targets editor on both SE and Pro Max simulators.
2. Visually compare against a pre-change screenshot (or the design reference) — confirm no visible
   size regression from the token substitution (this should be a no-op visually; flag anything
   that looks different).
3. Confirm at maximum accessibility text size the screen doesn't produce new overlap issues beyond
   what existed before this milestone (this milestone doesn't have to fully solve every accessibility-
   scale edge case on this screen — just shouldn't introduce a token-mapping regression).

## 3. Device-size tests

1. Run `bun run test:unit` for `packages/mobile` — confirm the new viewport tests for
   `FuelTargetsPresenter`, `LinearSlider`, and `YourWorkoutsSection` pass.
2. Spot-check one of the new tests by temporarily breaking the width-derivation logic locally and
   confirming the test actually fails (proves the test isn't a false-positive tautology) — this
   check is for the reviewing agent/engineer, not something to leave in the committed diff.

## 4. SemiCircleSlider

1. Find a screen using `SemiCircleSlider` (workouts flow — check current usages) on both SE and Pro
   Max simulators, confirm it renders at the correct width on each (not the old fixed
   `Dimensions.get`-at-import default) and that the slider is still fully interactive (drag/tap)
   at both sizes.

## Definition of done

All four checks pass on both simulator sizes at both default and maximum accessibility text size,
automated tests green, no regression in existing Fuel Targets/Segmented/LinearSlider test suites.
