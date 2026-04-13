# 02 — Auth Flow: Tasks

## Phase 1: Domain & Ports

- [ ] Define `AuthPort` interface (`src/domain/ports/auth.port.ts`)
- [ ] Define `AuthSession`, `AuthError`, `OAuthProvider` types
- [ ] Create mock auth adapter for tests (`src/adapters/auth/mock.adapter.ts`)
- [ ] Write tests for mock adapter (all methods return expected results)

## Phase 2: Supabase Adapter

- [ ] Refactor existing `src/auth/provider.tsx` into `src/adapters/auth/supabase.adapter.ts`
- [ ] Implement all `AuthPort` methods using `@supabase/supabase-js`
- [ ] Handle OAuth deep link callback (`persistencemobile://`)
- [ ] Implement token refresh logic
- [ ] Implement session persistence (AsyncStorage)
- [ ] Wire `setTokenProvider()` to inject access token into API client
- [ ] Write integration tests (with mock Supabase client)

## Phase 3: Auth Hook & State

- [ ] Create `useAuth()` hook (`src/ui/hooks/useAuth.ts`)
- [ ] Expose: `session`, `isLoading`, `isAuthenticated`, `signIn`, `signUp`, `signOut`, `resetPassword`, `signInWithOAuth`
- [ ] Subscribe to `onAuthStateChange` for real-time session updates
- [ ] Write tests for hook state transitions (loading → authenticated, loading → unauthenticated)

## Phase 4: Sign In Screen

- [ ] Create `SignInPresenter` with email/password inputs, OAuth buttons, error display, loading state
- [ ] Create `SignInContainer` with form validation, auth calls, navigation
- [ ] Create `app/(auth)/sign-in.tsx` screen (renders container)
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

- [ ] Update `app/_layout.tsx` to check auth state and redirect
- [ ] Create `(auth)/_layout.tsx` (unauthenticated layout)
- [ ] Create `(app)/_layout.tsx` (authenticated layout with tab navigator)
- [ ] Test: unauthenticated user redirected to sign-in
- [ ] Test: authenticated user redirected to app

## Phase 8: Sign Out

- [ ] Add sign-out action to `useAuth()`
- [ ] Clear session, local cache on sign-out
- [ ] Navigate to sign-in screen
- [ ] Preserve sync queue across sign-out (resolved on next sign-in)
- [ ] Write tests for sign-out flow

## Phase 9: Quality Gates

- [ ] All auth tests pass with 90% coverage
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run prettier:check` passes
