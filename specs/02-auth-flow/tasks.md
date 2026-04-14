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
- [ ] Write integration tests (with mock Supabase client)
  - _Only in-memory adapter tested; no Supabase-specific integration tests_

## Phase 3: Auth Hook & State

- [x] Create `useAuth()` hook (`src/ui/hooks/useAuth.ts`)
- [ ] Expose: `session`, `isLoading`, `isAuthenticated`, `signIn`, `signUp`, `signOut`, `resetPassword`, `signInWithOAuth`
  - _Missing: `isAuthenticated` (derived), `signUp`, `resetPassword` not exposed on hook_
- [x] Subscribe to `onAuthStateChange` for real-time session updates
- [x] Write tests for hook state transitions (loading → authenticated, loading → unauthenticated)

## Phase 4: Sign In Screen

- [ ] Create `SignInPresenter` with email/password inputs, OAuth buttons, error display, loading state
  - _Sign-in is a single monolithic screen, not split into presenter_
- [ ] Create `SignInContainer` with form validation, auth calls, navigation
  - _No container/presenter split; all logic is in `app/(auth)/sign-in.tsx`_
- [x] Create `app/(auth)/sign-in.tsx` screen (renders container)
  - _Screen exists with OAuth (Google/Apple) buttons and email/password fields_
- [ ] Write presenter test (renders all elements, fires callbacks)
- [ ] Write container integration test (successful sign-in navigates)

## Phase 5: Sign Up Screen

- [ ] Create `SignUpPresenter` with email/password/confirm fields, password strength, OAuth buttons
- [ ] Create `SignUpContainer` with validation, sign-up call, error handling
- [ ] Create `app/(auth)/sign-up.tsx` screen
- [ ] Write tests for sign-up flow

## Phase 6: Password Reset

- [ ] Create `ForgotPasswordPresenter` (email input, submit, success message)
- [ ] Create `ForgotPasswordContainer` (calls resetPassword)
- [ ] Create `app/(auth)/forgot-password.tsx` screen
- [ ] Write tests

## Phase 7: Route Protection

- [x] Update `app/_layout.tsx` to check auth state and redirect
  - _AuthGate component with useSegments/useRouter pattern_
- [x] Create `(auth)/_layout.tsx` (unauthenticated layout)
- [x] Create `(app)/_layout.tsx` (authenticated layout with tab navigator)
  - _Note: currently a Stack, not tabs — tabs deferred to later milestone_
- [ ] Test: unauthenticated user redirected to sign-in
- [ ] Test: authenticated user redirected to app

## Phase 8: Sign Out

- [x] Add sign-out action to `useAuth()`
- [ ] Clear session, local cache on sign-out
  - _Sign-out clears Supabase session but does not clear SQLite local cache_
- [ ] Navigate to sign-in screen
  - _AuthGate handles this reactively via onAuthStateChange_
- [ ] Preserve sync queue across sign-out (resolved on next sign-in)
  - _Sync queue is preserved (not cleared) but no re-sync on next sign-in_
- [ ] Write tests for sign-out flow

## Phase 9: Quality Gates

- [x] All auth tests pass with 90% coverage
- [x] `bun run typecheck` passes
- [x] `bun run lint` passes
- [x] `bun run prettier:check` passes
