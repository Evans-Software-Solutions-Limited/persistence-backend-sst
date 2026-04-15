# 02 — Auth Flow: Tasks

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
- [ ] Write integration tests (with mock Supabase client)
  - _Only in-memory adapter tested; no Supabase-specific integration tests_

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
- [ ] Polish spacing between OAuth/form sections using `/frontend-design` skill
- [ ] Add screen transitions (enter/exit animations)

## Phase 5: Sign Up Screen

- [x] Create `SignUpPresenter` with email/password/confirm fields, OAuth buttons
- [x] Create `SignUpContainer` with validation, sign-up call, error handling
- [x] Create `app/(auth)/sign-up.tsx` screen
- [x] Write tests for sign-up flow
- [ ] Polish spacing and transitions using `/frontend-design` skill

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
- [ ] Test: unauthenticated user redirected to sign-in
- [ ] Test: authenticated user redirected to app

## Phase 8: Sign Out

- [x] Add sign-out action to `useAuth()`
- [ ] Clear session, local cache on sign-out
  - _Sign-out clears Supabase session but does not clear SQLite local cache_
- [x] Navigate to sign-in screen
  - _AuthGate handles this reactively via onAuthStateChange_
- [ ] Preserve sync queue across sign-out (resolved on next sign-in)
  - _Sync queue is preserved (not cleared) but no re-sync on next sign-in_
- [ ] Write tests for sign-out flow

## Phase 9: Quality Gates

- [x] All auth tests pass with 90% coverage
- [x] `bun run typecheck` passes
- [x] `bun run lint` passes
- [x] `bun run prettier:check` passes

## Remaining Items (for next session)

- [ ] Design polish pass on all auth screens (spacing, transitions) via `/frontend-design` skill
- [ ] Custom loading/splash screen (replace spinner with branded loader)
- [ ] Supabase adapter integration tests
- [ ] AuthGate redirect tests
- [ ] Sign-out SQLite cache clearing
- [ ] Sync queue re-sync on next sign-in
