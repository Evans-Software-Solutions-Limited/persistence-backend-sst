# 01 — Design System: Tasks

## Current state (2026-04-19)

**Shipped: 32 of 35 tasks complete.** Primitives are in place; list-screen perf + health-check screen polish deferred to later milestones.

Built and verified:

- Tamagui 2.0.0-rc.40 on Expo 55 / RN 0.83 with compiler wired through babel + metro
- `tamagui.config.ts` with Persistence token overrides (Electric Cyan primary, cooler semantic palette, Figtree typography via design tokens)
- Dark-first theme in `src/ui/theme/` (`tokens.ts`, `themes.ts`, `typography.ts`, `theme.types.ts`)
- `ThemeProvider` + `useTheme()` with system/manual override persisted to AsyncStorage
- Layout primitives: `Screen`, `Row`, `Column`, `Spacer` (all tested)
- UI primitives built as Tamagui `styled()` wrappers: `Button`, `Text`, `Card`, `Input`, `LoadingSpinner`, `Skeleton`, `EmptyState`, `ErrorState`, `Badge`, `Divider`, `Avatar`, plus bespoke `PLogoDrawLoader`, `ComingSoon`, `ErrorBoundary`, `OAuthButton`, `ExerciseCard`, `ExerciseFilterBar`, `MuscleGroupPicker`
- Barrel exports + tests for every primitive
- `/frontend-design` review applied to auth screens (staggered Reanimated entry animations, two-layer gradient glow)
- User confirmed auth-screen styling on iOS simulator

Known gaps:

- No health-check screen yet (Phase 5) — deferred to milestone 07 / M1 HealthKit bundle
- 60fps FlatList performance audit not run — no scrollable list screens existed when spec was written; now unblocked by the exercise list (post-Phase 4) and should be verified in M1+

## Phase 0: Tamagui Setup

- [x] Install `tamagui`, `@tamagui/core`, `@tamagui/config` and Expo plugin
- [x] Configure Tamagui compiler in `babel.config.js` / `metro.config.js`
- [x] Verify Tamagui works with current Expo version (if Expo 53 issues, switch to gluestack UI)
  - _Running on Expo 55 / RN 0.83 with Tamagui 2.0.0-rc.40_
- [x] Create `tamagui.config.ts` with Persistence token overrides

## Phase 1: Tokens

- [x] Define colour palette in Tamagui token system (primary, secondary, success, warning, error, neutral scales)
- [x] Define typography tokens (heading 1-4, body, caption, label) in Tamagui config
- [x] Define spacing tokens (xs through 4xl) in Tamagui config
- [x] Define border radius tokens in Tamagui config
- [x] Create dark-first theme (dark mode is primary, light mode derived)
- [x] Write tests for token structure (valid values, expected keys)

## Phase 2: Theme Provider

- [x] Create Persistence `ThemeProvider` wrapping Tamagui's `TamaguiProvider`
- [x] Create `useTheme()` hook returning current mode and semantic tokens
- [x] Implement system colour scheme detection (Appearance API)
- [x] Support manual override (system / light / dark) via context
- [x] Persist theme preference to AsyncStorage
- [x] Write tests: default to system, override works, hook returns correct tokens

## Phase 3: Layout Components

- [x] Create `Screen` component (SafeAreaView + Tamagui Stack, scroll option, background from theme)
- [x] Create `Row` component (Tamagui XStack wrapper with gap prop)
- [x] Create `Column` component (Tamagui YStack wrapper with gap prop)
- [x] Create `Spacer` component (flex: 1 by default, or fixed size)
- [x] Write tests for layout components (renders children, applies spacing)

## Phase 4: UI Primitives

Build as Tamagui `styled()` wrappers with Persistence branding. Use `/frontend-design` skill for visual quality review.

- [x] Create `Button` (variants: primary, secondary, outline, ghost, danger; sizes: sm, md, lg; loading + disabled states; min 44pt touch target)
- [x] Create `Text` (variant prop maps to typography tokens)
- [x] Create `Card` (padding, border radius, elevation/shadow from theme)
- [x] Create `Input` (label, placeholder, error state, helper text, secure entry option; min 44pt touch target)
- [x] Create `LoadingSpinner` (size variants, colour from theme)
- [x] Create `Skeleton` (shimmer loading placeholder — prefer over spinners for content)
- [x] Create `EmptyState` (icon, title, description, optional action button)
- [x] Create `ErrorState` (error message, retry button)
- [x] Create `Badge` (count or status dot, colour variants)
- [x] Create `Divider` (horizontal line, margin props)
- [x] Create `Avatar` (image source with fallback to initials, size variants)
- [x] Write tests for every primitive (each variant renders, props passed correctly)

## Phase 5: Integration & Quality

- [x] Wire `ThemeProvider` into `app/_layout.tsx`
- [ ] Update existing health check screen to use new primitives
  - _No health check screen exists yet; deferred to milestone 07_
- [x] Export all components via barrel files
- [x] Run `/frontend-design` skill review on initial component set
  - _All three auth screens polished with staggered Reanimated enter animations, refined spacing, two-layer gradient glow_
- [x] Screenshot key screens and review visual quality
  - _Auth screens reviewed on iOS simulator — user confirmed "styling looks great"_
- [ ] Verify 60fps scroll performance on FlatList screens
  - _No scrollable list screens exist yet; deferred to milestone 03+_
- [x] Verify all quality gates pass
