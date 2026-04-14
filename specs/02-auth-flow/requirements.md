# 02 — Auth Flow: Requirements

## Overview

Complete authentication flow: sign in, sign up, OAuth (Google, Apple, Facebook), session persistence, password reset, and protected route gating. Auth uses Supabase Auth with JWT validation on the SST backend.

---

## User Stories

### STORY-001: As a user, I want to sign in with email and password

**Acceptance Criteria:**

- [ ] Email + password form with validation (email format, min 8 chars password)
- [ ] Error display for invalid credentials
- [ ] Loading state during auth request
- [ ] Successful sign-in navigates to main app
- [ ] Session token stored securely

### STORY-002: As a user, I want to sign up with email and password

**Acceptance Criteria:**

- [ ] Email + password + confirm password form
- [ ] Password strength indicator
- [ ] Email verification flow (confirmation screen)
- [ ] Successful sign-up creates account and navigates to onboarding or main app
- [ ] Error handling for duplicate email

### STORY-003: As a user, I want to sign in with Google, Apple, or Facebook

**Acceptance Criteria:**

- [ ] Google OAuth button (Android + iOS)
- [ ] Apple Sign In button (iOS only, hidden on Android)
- [ ] Facebook OAuth button (both platforms)
- [ ] OAuth callback handled via deep link (`persistencemobile://`)
- [ ] New OAuth user creates profile automatically
- [ ] Existing OAuth user restores session

### STORY-004: As a user, I want my session to persist across app restarts

**Acceptance Criteria:**

- [ ] Session token stored in AsyncStorage
- [ ] App launch restores session silently
- [ ] Expired token triggers re-auth (not crash)
- [ ] Token refresh happens automatically before expiry
- [ ] Offline launch shows cached data with stale session indicator

### STORY-005: As a user, I want to reset my password

**Acceptance Criteria:**

- [ ] "Forgot password" link on sign-in screen
- [ ] Email input → sends reset email via Supabase
- [ ] Success confirmation screen
- [ ] Deep link from email opens password reset form in app

### STORY-006: As a user, I want to sign out

**Acceptance Criteria:**

- [ ] Sign out button in profile/settings
- [ ] Clears session, local cache, and navigates to sign-in
- [ ] Pending sync queue preserved (syncs next sign-in)

### STORY-007: As a developer, I want protected routes that redirect unauthenticated users

**Acceptance Criteria:**

- [ ] `(auth)` route group for unauthenticated screens
- [ ] `(app)` route group for authenticated screens
- [ ] Root layout checks session state and redirects accordingly
- [ ] Auth state changes trigger immediate navigation update
