# Session Brief: Auth Flow Polish & Completion

## Context

Read the memory files first — they have full project context. Specs live in `specs/` at the repo root. The mobile app is in `packages/mobile`.

We're building the Persistence fitness mobile app. The V2 is a rebuild of the original app (`persistence-mobile`) using hexagonal architecture, offline-first with SQLite, and container/presenter pattern. The original app had the layout and functionality but performance issues and the need to become offline-first drove the rebuild.

**Stack:** Expo 55 / RN 0.83 / Xcode 26 / Tamagui / Supabase auth / SST API backend

## What was completed last session

- Auth flow screens (sign-in, sign-up, forgot-password) built with container/presenter split
- `useAuth` hook extended with `isAuthenticated`, `signUp`, `resetPassword`
- Loading bug fixed (AuthGate redirect logic + useAuth bootstrap race + processLock)
- 220 tests passing, 91% branch coverage, all quality gates clean

## Priorities for this session (in order)

### 1. Design polish on auth screens

The sign-in screen works but spacing between sections (OAuth buttons → divider → form → sign-in button) needs refinement. Use the `/frontend-design` skill on each presenter:

- `src/ui/presenters/SignInPresenter.tsx`
- `src/ui/presenters/SignUpPresenter.tsx`
- `src/ui/presenters/ForgotPasswordPresenter.tsx`

Focus: section spacing/gaps, enter/exit screen transitions, press feedback micro-interactions, visual rhythm. The user wants Strong/Hevy/Fitbod level polish — "slick and sexy", not just functional.

### 2. Custom branded loading screen

Replace the generic `LoadingSpinner` in `app/index.tsx` with a branded splash/loading state — PERSISTENCE wordmark with subtle animation, matching the auth screen aesthetic.

### 3. Complete remaining milestone 02 items

Check `specs/02-auth-flow/tasks.md` for unchecked items:

- [ ] Supabase adapter integration tests (with mock Supabase client)
- [ ] AuthGate redirect tests (unauthenticated → sign-in, authenticated → app)
- [ ] Sign-out SQLite cache clearing
- [ ] Sign-out flow tests

### 4. (If time) Begin milestone 03 — Exercise Library

Check `specs/03-exercise-library/` for requirements and tasks.

## Key gotchas

- **Build command:** `cd packages/mobile && LANG=en_US.UTF-8 npx expo run:ios` (native build, not dev-client — needed for future HealthKit work)
- `expo prebuild --clean` wipes the Podfile fmt C++17 fix — re-apply after prebuild
- Metro must run from `packages/mobile`, not repo root
- Supabase env vars in `packages/mobile/.env`
- Quality gates must all pass: `bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit`
- 90% coverage threshold is non-negotiable
- Always use `/frontend-design` skill when building or polishing screens

## Key files

| File | What |
|------|------|
| `src/ui/presenters/SignInPresenter.tsx` | Sign-in UI (needs spacing polish) |
| `src/ui/presenters/SignUpPresenter.tsx` | Sign-up UI (needs spacing polish) |
| `src/ui/presenters/ForgotPasswordPresenter.tsx` | Forgot password UI |
| `src/ui/containers/SignIn/Up/ForgotPasswordContainer.tsx` | Auth screen logic |
| `src/ui/hooks/useAuth.tsx` | Auth state hook (complete) |
| `src/adapters/auth/supabase.adapter.ts` | Supabase auth adapter |
| `app/_layout.tsx` | AuthGate with route protection |
| `app/(auth)/sign-in.tsx` | Thin screen wrapper |
| `specs/02-auth-flow/tasks.md` | Task checklist with completion status |
| `specs/_agent.md` | Architecture constraints (must read) |
