# 02 — Auth Flow: Tasks

## Current state (2026-04-19)

**Shipped: ~44 of 46 tasks complete.** Auth flow is functionally done; only sync-queue-resume-on-sign-in is deferred.

Built and verified:

- `AuthPort` interface at `src/domain/ports/auth.port.ts` with `AuthSession`, `AuthError`, `OAuthProvider` types
- `InMemoryAuthAdapter` for tests (originally specced as `mock.adapter.ts`, landed as `in-memory-auth.adapter.ts`)
- `SupabaseAuthAdapter` at `src/adapters/auth/supabase.adapter.ts` — full `AuthPort` implementation with OAuth deep-link handling, token refresh, session persistence, `processLock` for refresh race prevention, 24 integration tests
- `useAuth()` hook at `src/ui/hooks/useAuth.tsx` with loading-state race + 3s hard timeout to prevent stuck splash
- All three auth screens: `sign-in.tsx`, `sign-up.tsx`, `forgot-password.tsx` with matching container/presenter pairs, Reanimated entry animations, `/frontend-design` spacing polish, fade transitions
- Route protection: `AuthGate` in `app/_layout.tsx` with 7 tests covering redirect scenarios + loading
- `(auth)/_layout.tsx` and `(app)/_layout.tsx` split
- Sign-out clears `StoragePort` via `clearAll()` (wipes sync queue, cached workouts, cached exercises, active session, sync metadata)
- `PLogoDrawLoader` branded splash (animated P SVG stroke-draw ported from legacy app)
- All quality gates (prettier/typecheck/lint/build/test) passing

Known gaps:

- **Sync queue re-sync on next sign-in** (Phase 8) — currently the queue is cleared on sign-out; full re-sync strategy is being folded into M0 Exercise Library integration work.
- The `(app)/_layout.tsx` now wraps a 5-tab navigator (added 2026-04-17, commit 00db72e) — original spec called for tabs too, so this is complete; the prior note about "currently a Stack" is outdated.

## Phase 1: Domain & Ports

- [x] Define `AuthPort` interface (`src/domain/ports/auth.port.ts`)
- [x] Define `AuthSession`, `AuthError`, `OAuthProvider` types
- [x] Create mock auth adapter for tests (`src/adapters/auth/mock.adapter.ts`)
  - _Named `in-memory-auth.adapter.ts` in implementation_
- [x] Write tests for mock adapter (all methods return expected results)

## Phase 2: Supabase Adapter

- [x] Refactor existing `src/auth/provider.tsx` into `src/adapters/auth/supabase.adapter.ts`
- [x] Implement all `AuthPort` methods using `@supabase/supabase-js`
- [x] Handle OAuth deep link callback (`persistencemobile://`)
- [x] Implement token refresh logic
- [x] Implement session persistence (AsyncStorage)
- [x] Wire `setTokenProvider()` to inject access token into API client
- [x] Add `processLock` for session refresh race condition prevention
- [x] Write integration tests (with mock Supabase client)
  - _24 tests in `supabase.adapter.test.ts` covering all AuthPort methods against mocked Supabase SDK_

## Phase 3: Auth Hook & State

- [x] Create `useAuth()` hook (`src/ui/hooks/useAuth.ts`)
- [x] Expose: `session`, `isLoading`, `isAuthenticated`, `signIn`, `signUp`, `signOut`, `resetPassword`, `signInWithOAuth`
- [x] Subscribe to `onAuthStateChange` for real-time session updates
- [x] Write tests for hook state transitions (loading → authenticated, loading → unauthenticated)
- [x] Fix bootstrap: race `getSession()` + `onAuthStateChange` + 3s hard timeout to prevent stuck loading

## Phase 4: Sign In Screen

- [x] Create `SignInPresenter` with email/password inputs, OAuth buttons, error display, loading state
- [x] Create `SignInContainer` with form validation, auth calls, navigation
- [x] Create `app/(auth)/sign-in.tsx` screen (renders container)
- [x] Write presenter test (renders all elements, fires callbacks)
- [x] Write container integration test (successful sign-in navigates)
- [x] Polish spacing between OAuth/form sections using `/frontend-design` skill
  - _Refined spacing (56px brand→OAuth, 28px divider margins, 28px form→CTA, 36px footer), two-layer gradient glow_
- [x] Add screen transitions (enter/exit animations)
  - _Staggered Reanimated enter animations (fade-in + slide-up, 70ms stagger, 420ms duration), fade transitions between auth screens_

## Phase 5: Sign Up Screen

- [x] Create `SignUpPresenter` with email/password/confirm fields, OAuth buttons
- [x] Create `SignUpContainer` with validation, sign-up call, error handling
- [x] Create `app/(auth)/sign-up.tsx` screen
- [x] Write tests for sign-up flow
- [x] Polish spacing and transitions using `/frontend-design` skill
  - _Same staggered entry animation treatment as sign-in, refined section spacing_

## Phase 6: Password Reset

- [x] Create `ForgotPasswordPresenter` (email input, submit, success message)
- [x] Create `ForgotPasswordContainer` (calls resetPassword)
- [x] Create `app/(auth)/forgot-password.tsx` screen
- [x] Write tests

## Phase 7: Route Protection

- [x] Update `app/_layout.tsx` to check auth state and redirect
  - _AuthGate with useSegments/useRouter — fixed to handle root route_
- [x] Create `(auth)/_layout.tsx` (unauthenticated layout)
- [x] Create `(app)/_layout.tsx` (authenticated layout with tab navigator)
  - _Note: currently a Stack, not tabs — tabs deferred to later milestone_
- [x] Test: unauthenticated user redirected to sign-in
- [x] Test: authenticated user redirected to app
  - _7 AuthGate tests in `app/__tests__/AuthGate.test.tsx` covering all redirect scenarios + loading state_

## Phase 8: Sign Out

- [x] Add sign-out action to `useAuth()`
- [x] Clear session, local cache on sign-out
  - _`StoragePort.clearAll()` added and called from `useAuth.signOut()` — clears sync queue, cached entities, and sync metadata_
- [x] Navigate to sign-in screen
  - _AuthGate handles this reactively via onAuthStateChange_
- [ ] Preserve sync queue across sign-out (resolved on next sign-in)
  - _Sync queue is preserved (not cleared) but no re-sync on next sign-in_
- [x] Write tests for sign-out flow
  - _useAuth test verifies sign-out clears storage; InMemoryStorage test verifies clearAll behaviour_

## Phase 9: Quality Gates

- [x] All auth tests pass with 90% coverage
- [x] `bun run typecheck` passes
- [x] `bun run lint` passes
- [x] `bun run prettier:check` passes

## Remaining Items

- [x] Design polish pass on all auth screens (spacing, transitions) via `/frontend-design` skill
- [x] Custom loading/splash screen (replace spinner with branded loader)
  - _Ported PLogoDrawLoader (animated P SVG stroke-draw) from old app, mapped to Electric Cyan_
- [x] Supabase adapter integration tests
  - _24 tests covering all AuthPort methods_
- [x] AuthGate redirect tests
  - _7 tests covering all redirect scenarios_
- [x] Sign-out SQLite cache clearing
  - _`StoragePort.clearAll()` wipes sync_queue, cached_workouts, cached_exercises, active_session, sync_metadata_
- [ ] Sync queue re-sync on next sign-in
  - _Deferred — sync queue is cleared on sign-out; full re-sync strategy to be defined with Exercise Library milestone_
