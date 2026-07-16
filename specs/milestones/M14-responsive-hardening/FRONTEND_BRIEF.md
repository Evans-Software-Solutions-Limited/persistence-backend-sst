# M14 Frontend Brief — responsive hardening

All four items land in `packages/mobile`, one PR, separate commits per item so each is reviewable
on its own.

## 1. `YourWorkoutsSection` carousel card height

File: `src/ui/components/home/YourWorkoutsSection.tsx` (fixed `carouselHeight = 170`, near line 29
per the audit).

- First, measure the actual risk before changing anything: what's the tallest this card's content
  (title, 1 line + description, 2 lines) can get at the largest iOS Dynamic Type accessibility
  category (`accessibilityExtraExtraExtraLarge`)? If it provably still fits in 170pt, the fix is
  just adding a regression test that proves it (render at max font scale, assert no overflow/
  clipping) — don't change the layout unnecessarily.
- If it doesn't fit, change `height: 170` to `minHeight: 170` (or similar) so the card can grow
  with content, and re-check the carousel's horizontal scroll/snap behavior still looks right with
  variable-height cards — if variable height breaks the carousel's snap alignment, consider instead
  keeping fixed height but reducing to `numberOfLines={1}` for the description at the largest font
  scale (a conditional based on `PixelRatio.getFontScale()`), whichever is the smaller, more
  contained change.
- Add the test either way — this is the one component in the audit identified as an actual
  overflow candidate, so it needs proof, not just a fix.

## 2. `FuelTargetsPresenter` font-token adoption

File: `src/ui/presenters/FuelTargetsPresenter.tsx`.

- Reference token scale: `src/ui/theme/fonts.ts` (`displayFont`/`bodyFont`/`monoFont`
  `createFont()` definitions) and `src/ui/theme/tokens.ts:141-185` (`fonts` object). Confirm which
  is actually canonical before starting — the audit found two parallel definitions (a plain-object
  scale in `tokens.ts` and the real Tamagui font config in `fonts.ts`); if they've drifted from
  each other, that's worth a one-line flag back to Brad but not an in-scope fix for this item.
- Grep every `fontSize={` literal in the file (~30 occurrences, sizes ranging 9–32pt per the
  audit) and replace with the nearest Tamagui size token (`fontSize="$N"` against `$display`/
  `$body`/`$mono` families) or the equivalent `fonts.ts` token reference, matching how other
  ported screens already reference the scale.
- If a genuinely new size is needed that has no close token match, add it to the scale in
  `fonts.ts` rather than leaving a numeric literal — don't create a second escape hatch.
- No visual behavior should change if this is done correctly (tokens should map to the same or
  very close point sizes already in use) — this is a refactor, not a redesign. If a token
  substitution would visibly shift a size by more than ~1pt, flag it rather than silently
  changing the screen's appearance (legacy-fidelity discipline still applies even to a brand-new
  screen once it's shipped).

## 3. Device-size (viewport) tests

Reference pattern: `src/ui/components/foundation/__tests__/Segmented.test.tsx` — mocks
`react-native/Libraries/Utilities/useWindowDimensions` with a `setViewport(width)` helper.

- Add the same mocking pattern to test files for `FuelTargetsPresenter`, `LinearSlider`, and
  `YourWorkoutsSection` (this last one doubles as the regression test for item #1).
- For each, assert at minimum: renders without throwing at 375pt (iPhone SE) and 430pt (iPhone Pro
  Max) width, and any width-derived layout value (e.g. `LinearSlider`'s measured track width via
  `onLayout`, `YourWorkoutsSection`'s `cardWidth = screenWidth * 0.85`) resolves to the expected
  proportional value at each width.
- Keep these tests behaviorally focused (does layout logic produce the right numbers / not crash)
  rather than pixel-perfect snapshot tests, which are brittle and not what's being verified here.

## 4. `SemiCircleSlider` module-load `Dimensions.get` fix

File: `src/ui/components/workouts/SemiCircleSlider/SemiCircleSlider.tsx` (currently:
`const DEFAULT_WIDTH = Dimensions.get("window").width - 64;` at module scope, used as a
default-prop fallback).

- Replace with the same `onLayout`-measurement pattern `LinearSlider` already uses
  (`src/ui/components/foundation/LinearSlider/LinearSlider.tsx`) — measure the component's actual
  available width at render time instead of reading a static snapshot at import time.
- Confirm no caller relies on the old static-constant behavior (e.g. passing no explicit width and
  expecting the exact `Dimensions.get`-derived number) before changing the default — grep callers
  of `SemiCircleSlider` first.

## Tests

- Coverage per item as described above; 90% on changed files per repo standard.
- Full existing `Segmented.test.tsx`, `LinearSlider` tests (if any exist today — check), and
  `FuelTargetsPresenter`/`FuelTargetsContainer` tests must still pass.

## Out of scope

Everything in BRIEF.md's "explicitly out of scope" section — no tablet work, no `Row`/`Column`
adoption sweep across other presenters, no new shared `Screen` wrapper.
