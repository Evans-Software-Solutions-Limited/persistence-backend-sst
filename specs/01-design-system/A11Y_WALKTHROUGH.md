# 01 — Design System: A11y Manual Walkthrough (Phase 1.9)

> Companion to the automated a11y audit (`packages/mobile/src/ui/components/__tests__/a11y-audit.test.tsx`). The automated suite proves every pressable primitive exposes `accessibilityRole` + a non-empty `accessibilityLabel` and meets the 44pt effective touch-target floor. This doc is the **manual** VoiceOver / TalkBack pass (STORY-005 AC, tasks.md T-1.9.2) that a human reviewer runs on-device against the `/dev/primitives/*` routes — the one gate an agent cannot execute (no screen-reader access in CI).

## Setup

1. `bun run dev` (or an EAS dev build) on a physical device.
2. iOS: Settings → Accessibility → VoiceOver → On (or triple-click side button). Android: Settings → Accessibility → TalkBack → On.
3. Navigate to `/dev/primitives` (dev-only route, gated behind `__DEV__`).

## What the automated suite already guarantees (no need to re-verify manually)

- Every pressable primitive announces `button` (or `tab` for Segmented/TabBar) role.
- Every pressable primitive has a non-empty `accessibilityLabel`.
- Touch targets: Btn md/lg (44/52 via minHeight), Btn sm (36, documented dense-row exception), IconBtn/Avatar/HabitTile (36 visual + hitSlop → 44 effective), DrawerRow/ClientRow/SummaryChip (44 via minHeight).

## Manual checklist (per primitive route)

For each route, swipe through every element with the screen reader and confirm:

| Route                         | Verify                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dev/primitives/Btn`         | Each button announces its label + "button". Disabled button announces "dimmed"/"disabled". Focus order is left→right, top→bottom.                                                                                   |
| `/dev/primitives/IconBtn`     | Icon buttons announce their `accessibilityLabel` (not "image"/empty). Non-pressable (no onPress) variants are NOT focusable as buttons. Tap target feels ≥44pt.                                                     |
| `/dev/primitives/Avatar`      | Pressable avatar announces "Avatar BE, button"; non-pressable announces as image. COACH badge doesn't create a separate confusing focus stop.                                                                       |
| `/dev/primitives/Card`        | Pressable card announces its label + "button"; static card is not focusable as a control.                                                                                                                           |
| `/dev/primitives/Segmented`   | Each segment announces "tab" + label + selected state ("selected"). Swiping moves between segments.                                                                                                                 |
| `/dev/primitives/TabBar`      | Each tab announces "tab" + label + selected. COACH chrome dot is decorative (not a focus stop). Badge count is announced with its tab.                                                                              |
| `/dev/primitives/Ring`        | Rings announce as "progress" with the percent value. Centre overlay text is readable.                                                                                                                               |
| `/dev/primitives/Bar`         | Bar announces "progress" + percent.                                                                                                                                                                                 |
| `/dev/primitives/Stat`        | Number + unit + label read as a coherent phrase; mono digits are spoken correctly.                                                                                                                                  |
| `/dev/primitives/BottomSheet` | Opening a sheet moves focus into it; backdrop is "dismiss"; drag handle is decorative. ESC / back gesture closes.                                                                                                   |
| `/dev/primitives/composites`  | DrawerRow/ClientRow/SummaryChip/WorkoutCarouselCard/HabitTile each announce one coherent "button" with a meaningful label. HabitTile `locked` announces "dimmed". Loading skeletons announce "Loading" (not empty). |
| `/dev/fonts`                  | Slashed-zero + tabular numerics render; screen reader speaks digits normally.                                                                                                                                       |

## Reduced-motion pass (AC 3.5)

1. iOS: Settings → Accessibility → Motion → Reduce Motion → On. Android: Settings → Accessibility → Remove animations.
2. Re-open `/dev/primitives/Ring` and `/dev/primitives/Bar`: the fill must **jump** to its final value with no transition (the automated suite covers the `useReducedMotion()` branch; this confirms the on-device OS setting is honoured).
3. Re-open `/dev/primitives/BottomSheet`: the sheet should snap rather than slide (gorhom respects reduce-motion).

## Contrast (AC 5.1 / 5.2)

The token contrast ratios are documented in `design.md § Token reference` (measured against `$bg #0A0B12`). Confirm no rendered text in any primitive uses `$text4`/`$text5` (sub-AA) — those are reserved for disabled/hairline non-text. The automated suite can't measure rendered contrast; this is a visual spot-check against the design-system standalone HTML.

## Sign-off

- [ ] VoiceOver pass complete (iOS)
- [ ] TalkBack pass complete (Android)
- [ ] Reduced-motion pass complete (both platforms)
- [ ] Contrast spot-check complete

_Phase 1.9 manual companion · 2026-05-29_
