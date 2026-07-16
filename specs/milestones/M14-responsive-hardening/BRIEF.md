# M14 Responsive Hardening — font tokens, small-device clipping, device-size tests

> **Status: DRAFT, not yet triggered.** Written 2026-07-01 off a read-only audit of the mobile
> typography system and layout responsiveness across iPhone sizes (SE 375pt → Pro Max 430pt) and
> iOS Dynamic Type. Hold for Brad's go-ahead before dispatching an agent. Mobile-only — no backend
> changes, so this ships as a single PR, not a backend/frontend pair.

## Why this milestone exists

The audit's headline finding: **the architecture here is already healthy.** Layout is mostly
flex/percentage-driven (bottom sheets use percentage snap points, the Fuel Targets editor is
flex end-to-end, carousels compute width as `screenWidth * 0.85`), text truncation
(`numberOfLines`) is applied consistently on cards/lists, safe-area insets are used broadly and
correctly, and iOS Dynamic Type accessibility scaling works out of the box since nothing disables
`allowFontScaling`. **Do not introduce a width-based font-scaling library** (react-native-size-
matters or similar) — fixed-pt sizes + Dynamic Type is the correct iOS pattern already in use, and
adding scale-by-screen-width logic on top of it would fight Apple's own accessibility model, not
improve it.

This milestone closes four specific, concrete gaps found during the audit — see
[[project_responsive_layout_audit]] in memory for the full audit. **Tablet/iPad support is
explicitly NOT part of this milestone** — see M15 (deferred, post-MVP) for that.

## Scope

0. **P0 — set `supportsTablet: false` in `packages/mobile/app.json`.** Stop-gap decided 2026-07-01:
   tablet support is real product scope (coaches likely to use a tablet, relevant to the Android
   release too — see M15, deferred) but not built yet. Rather than ship an unadapted phone UI to
   iPad/tablet users in the meantime, disable tablet builds until M15 actually lands. One-line
   config change, no layout work.

1. **P0 — `YourWorkoutsSection` carousel card fixed height.** `src/ui/components/home/
YourWorkoutsSection.tsx` hardcodes `carouselHeight = 170` for a card holding a title
   (`numberOfLines={1}`) + description (`numberOfLines={2}`). This is the one concrete
   overflow/clipping candidate found: a user with iOS "Larger Text" turned up, or an unusually
   long title, has no headroom. Fix: either give the card a `minHeight` instead of a fixed
   `height` (let content grow, keep a sensible floor), or verify + document that the current
   two-line text budget genuinely cannot overflow the fixed box even at the largest Dynamic Type
   category (measure, don't assume) and add a regression test proving it.

2. **P1 — `FuelTargetsPresenter` bypasses the font-token system.** ~30 raw `fontSize={n}` calls
   (9–32pt) instead of the canonical `$display`/`$body`/`$mono` Tamagui font scale
   (`src/ui/theme/fonts.ts`). Since this is the newest screen in the app, fix the drift while it's
   fresh rather than let it become the template other screens copy. Map each raw size to the
   nearest existing token size; if a genuinely new size is needed, add it to the token scale
   rather than inlining it.

3. **P1 — no device-size test coverage beyond one component.** Only `Segmented.test.tsx` mocks
   `useWindowDimensions` to prove layout behavior at different widths. Add the same pattern
   (`setViewport(width)` helper mocking `react-native/Libraries/Utilities/useWindowDimensions`) to
   at least: `FuelTargetsPresenter`, `LinearSlider`, and `YourWorkoutsSection` (to directly cover
   fix #1) — test at SE width (375) and Pro Max width (430) for each. Don't attempt exhaustive
   coverage of every screen in this pass; these three are the ones touched by this milestone plus
   the newest/highest-risk screen.

4. **P1 — `SemiCircleSlider` still captures `Dimensions.get('window').width` at module load.**
   `LinearSlider` (built in the same recent work) correctly measures its own width via `onLayout`
   instead. Backport that pattern to `SemiCircleSlider`'s default-width fallback so both sliders
   use the same, better approach. Low urgency (portrait lock masks the actual staleness bug today)
   but cheap to fix while both components are fresh in mind.

## Explicitly out of scope

- **Tablet/iPad support** — see M15. Don't add tablet-specific layout logic here.
- Increasing `Row`/`Column` layout-primitive adoption across the other 62 presenters that don't
  use them (P2 in the audit, a consistency/maintainability item, not a device-size bug) — separate
  follow-up if Brad wants it.
- `ActivityChips` `numberOfLines` hardening (P2, low risk given short labels) — fold in only if
  it's a trivial one-line addition while already touching that file for #2; don't scope a separate
  pass for it.
- No changes to the safe-area handling pattern (per-screen `useSafeAreaInsets` calls) — it works
  consistently today; don't introduce a new shared `Screen`/`SafeScreen` wrapper as part of this
  milestone even though the audit noted its absence as a minor consistency risk.

## Definition of done

See SMOKE_TEST.md. PR green on the full gate (`bun run prettier:check && typecheck && lint &&
build && test:unit`), 90% coverage on changed files, and:

- `YourWorkoutsSection` card provably doesn't clip at the largest Dynamic Type category (test +
  manual check).
- `FuelTargetsPresenter` has zero raw `fontSize` numeric literals remaining — all reference the
  token scale.
- New viewport-driven tests exist for `FuelTargetsPresenter`, `LinearSlider`, and
  `YourWorkoutsSection`, each asserting correct layout at both 375pt and 430pt widths.
- `SemiCircleSlider` no longer reads `Dimensions.get` at module scope.
