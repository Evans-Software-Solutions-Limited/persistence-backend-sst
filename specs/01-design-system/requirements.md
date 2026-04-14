# 01 — Design System: Requirements

## Overview

Establish the UI foundation: design tokens, primitive components, and theme infrastructure. All subsequent features build on this layer. Must support dark/light mode and be performant on mobile.

---

## User Stories

### STORY-001: As a user, I want the app to feel fast and responsive with consistent visual styling

**Acceptance Criteria:**

- [ ] Colour palette defined (primary, secondary, success, warning, error, neutral scales)
- [ ] Typography scale defined (heading 1-4, body, caption, label)
- [ ] Spacing scale defined (4px base, 8, 12, 16, 20, 24, 32, 48, 64)
- [ ] All tokens accessible via theme hook or constants

### STORY-002: As a user, I want dark and light mode support

**Acceptance Criteria:**

- [ ] Theme provider wraps the app with system preference detection
- [ ] `useTheme()` hook returns current mode and tokens
- [ ] All components respect the active theme
- [ ] Manual override option (system / light / dark)

### STORY-003: As a developer, I want reusable UI primitive components

**Acceptance Criteria:**

- [ ] `Button` — primary, secondary, outline, ghost, danger variants; loading state; disabled state
- [ ] `Text` — renders with typography tokens (heading, body, caption, label)
- [ ] `Card` — container with padding, border radius, shadow
- [ ] `Input` — text input with label, error state, helper text
- [ ] `LoadingSpinner` — consistent loading indicator
- [ ] `EmptyState` — icon + message + optional action
- [ ] `ErrorState` — error message + retry action
- [ ] `Badge` — status/count indicator
- [ ] `Divider` — horizontal line separator
- [ ] `Avatar` — user avatar with fallback initials

### STORY-004: As a developer, I want all primitives to be presenters (pure props, no state)

**Acceptance Criteria:**

- [ ] Every UI primitive is a presenter component (receives all data via props)
- [ ] No hooks or side effects inside primitives
- [ ] Every primitive has a test verifying render with props
- [ ] Storybook-style test cases cover all variants

### STORY-005: As a developer, I want consistent layout components

**Acceptance Criteria:**

- [ ] `Screen` — safe area wrapper with optional scroll, padding, background
- [ ] `Row` — horizontal flex layout with gap
- [ ] `Stack` — vertical flex layout with gap
- [ ] `Spacer` — flexible space component

### STORY-006: As a user, I want the app to feel premium, modern, and gym-floor usable

**Acceptance Criteria:**

- [ ] Dark-first palette with intentional dark mode (not just inverted light mode)
- [ ] Large touch targets (minimum 44pt) for gym-floor use with sweaty hands
- [ ] High contrast text and icons for glanceability during active sessions
- [ ] Skeleton loaders for async content (not spinners — skeletons feel faster)
- [ ] Optimistic UI updates for mutations (don't wait for server response)
- [ ] 60fps scroll/animation — no jank on FlatList or ScrollView
- [ ] Consistent enter/exit transitions between screens
- [ ] Micro-interactions on key actions (completing sets, hitting PRs, finishing workouts)
- [ ] Generous spacing and clear visual hierarchy — no cramped screens
- [ ] Progressive disclosure — simple by default, power features via gestures or secondary UI

### STORY-007: As a developer, I want a performant component library with build-time optimisation

**Acceptance Criteria:**

- [ ] Tamagui installed and configured with Expo
- [ ] Tamagui compiler enabled for build-time flattening
- [ ] All design tokens defined in Tamagui's token system
- [ ] Custom Persistence theme wrapping Tamagui's theme provider
- [ ] All UI primitives built as Tamagui styled components with our branding
- [ ] If Tamagui has Expo 53 compatibility issues, gluestack UI used as fallback
