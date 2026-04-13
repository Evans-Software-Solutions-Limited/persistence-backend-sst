# 01 — Design System: Tasks

## Phase 1: Tokens

- [ ] Create `src/ui/theme/tokens.ts` with colour palette, typography scale, spacing scale, border radius
- [ ] Create light theme semantic colours (`src/ui/theme/light.ts`)
- [ ] Create dark theme semantic colours (`src/ui/theme/dark.ts`)
- [ ] Create `Theme` type definition (`src/ui/theme/theme.types.ts`)
- [ ] Write tests for token structure (valid hex colours, expected keys)

## Phase 2: Theme Provider

- [ ] Create `ThemeProvider` context (`src/ui/theme/ThemeProvider.tsx`)
- [ ] Create `useTheme()` hook returning current theme object
- [ ] Implement system colour scheme detection (Appearance API)
- [ ] Support manual override (system / light / dark) via context
- [ ] Persist theme preference to AsyncStorage
- [ ] Write tests: default to system, override works, hook returns correct tokens

## Phase 3: Layout Components

- [ ] Create `Screen` component (SafeAreaView wrapper, scroll option, background from theme)
- [ ] Create `Row` component (horizontal flex, gap prop)
- [ ] Create `Stack` component (vertical flex, gap prop)
- [ ] Create `Spacer` component (flex: 1 by default, or fixed size)
- [ ] Write tests for layout components (renders children, applies spacing)

## Phase 4: UI Primitives

- [ ] Create `Button` (variants: primary, secondary, outline, ghost, danger; sizes: sm, md, lg; loading + disabled states)
- [ ] Create `Text` (variant prop maps to typography tokens)
- [ ] Create `Card` (padding, border radius, elevation/shadow from theme)
- [ ] Create `Input` (label, placeholder, error state, helper text, secure entry option)
- [ ] Create `LoadingSpinner` (size variants, colour from theme)
- [ ] Create `EmptyState` (icon, title, description, optional action button)
- [ ] Create `ErrorState` (error message, retry button)
- [ ] Create `Badge` (count or status dot, colour variants)
- [ ] Create `Divider` (horizontal line, margin props)
- [ ] Create `Avatar` (image source with fallback to initials, size variants)
- [ ] Write tests for every primitive (each variant renders, props passed correctly)

## Phase 5: Integration

- [ ] Wire `ThemeProvider` into `app/_layout.tsx`
- [ ] Update existing health check screen to use new primitives
- [ ] Export all components via barrel files
- [ ] Verify all quality gates pass
