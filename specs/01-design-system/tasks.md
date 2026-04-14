# 01 — Design System: Tasks

## Phase 0: Tamagui Setup

- [ ] Install `tamagui`, `@tamagui/core`, `@tamagui/config` and Expo plugin
- [ ] Configure Tamagui compiler in `babel.config.js` / `metro.config.js`
- [ ] Verify Tamagui works with current Expo version (if Expo 53 issues, switch to gluestack UI)
- [ ] Create `tamagui.config.ts` with Persistence token overrides

## Phase 1: Tokens

- [ ] Define colour palette in Tamagui token system (primary, secondary, success, warning, error, neutral scales)
- [ ] Define typography tokens (heading 1-4, body, caption, label) in Tamagui config
- [ ] Define spacing tokens (xs through 4xl) in Tamagui config
- [ ] Define border radius tokens in Tamagui config
- [ ] Create dark-first theme (dark mode is primary, light mode derived)
- [ ] Write tests for token structure (valid values, expected keys)

## Phase 2: Theme Provider

- [ ] Create Persistence `ThemeProvider` wrapping Tamagui's `TamaguiProvider`
- [ ] Create `useTheme()` hook returning current mode and semantic tokens
- [ ] Implement system colour scheme detection (Appearance API)
- [ ] Support manual override (system / light / dark) via context
- [ ] Persist theme preference to AsyncStorage
- [ ] Write tests: default to system, override works, hook returns correct tokens

## Phase 3: Layout Components

- [ ] Create `Screen` component (SafeAreaView + Tamagui Stack, scroll option, background from theme)
- [ ] Create `Row` component (Tamagui XStack wrapper with gap prop)
- [ ] Create `Column` component (Tamagui YStack wrapper with gap prop)
- [ ] Create `Spacer` component (flex: 1 by default, or fixed size)
- [ ] Write tests for layout components (renders children, applies spacing)

## Phase 4: UI Primitives

Build as Tamagui `styled()` wrappers with Persistence branding. Use `/frontend-design` skill for visual quality review.

- [ ] Create `Button` (variants: primary, secondary, outline, ghost, danger; sizes: sm, md, lg; loading + disabled states; min 44pt touch target)
- [ ] Create `Text` (variant prop maps to typography tokens)
- [ ] Create `Card` (padding, border radius, elevation/shadow from theme)
- [ ] Create `Input` (label, placeholder, error state, helper text, secure entry option; min 44pt touch target)
- [ ] Create `LoadingSpinner` (size variants, colour from theme)
- [ ] Create `Skeleton` (shimmer loading placeholder — prefer over spinners for content)
- [ ] Create `EmptyState` (icon, title, description, optional action button)
- [ ] Create `ErrorState` (error message, retry button)
- [ ] Create `Badge` (count or status dot, colour variants)
- [ ] Create `Divider` (horizontal line, margin props)
- [ ] Create `Avatar` (image source with fallback to initials, size variants)
- [ ] Write tests for every primitive (each variant renders, props passed correctly)

## Phase 5: Integration & Quality

- [ ] Wire `ThemeProvider` into `app/_layout.tsx`
- [ ] Update existing health check screen to use new primitives
- [ ] Export all components via barrel files
- [ ] Run `/frontend-design` skill review on initial component set
- [ ] Screenshot key screens and review visual quality
- [ ] Verify 60fps scroll performance on FlatList screens
- [ ] Verify all quality gates pass
