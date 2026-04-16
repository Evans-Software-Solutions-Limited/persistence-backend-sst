# 01 — Design System: Tasks

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
