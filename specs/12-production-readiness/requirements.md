# 12 — Production Readiness: Requirements

## Overview

Final milestone before App Store / Play Store release. EAS Build configuration, store assets, performance optimization, security audit, crash monitoring, and release procedures.

---

## User Stories

### STORY-001: As a developer, I want EAS Build configured for development, preview, and production

**Acceptance Criteria:**

- [ ] `eas.json` with three profiles: development (dev client), preview (internal testing), production (store)
- [ ] iOS and Android build configurations correct (bundle IDs, signing)
- [ ] Environment variables injected per build profile
- [ ] Build succeeds for all profiles

### STORY-002: As a developer, I want store assets prepared

**Acceptance Criteria:**

- [ ] App icon (iOS + Android adaptive icon)
- [ ] Splash screen (light + dark)
- [ ] App Store screenshots (iPhone, iPad if applicable)
- [ ] Play Store screenshots
- [ ] App Store description, keywords, category
- [ ] Privacy policy URL
- [ ] Terms of service URL

### STORY-003: As a user, I want the app to start quickly

**Acceptance Criteria:**

- [ ] Cold start <2 seconds to interactive UI
- [ ] Dashboard renders from cache immediately (no blank screen)
- [ ] Session restore (auth check) completes within 500ms
- [ ] No unnecessary API calls on startup
- [ ] Bundle size monitored and optimised

### STORY-004: As a developer, I want crash and error monitoring

**Acceptance Criteria:**

- [ ] Error reporting service configured (e.g., Sentry, Expo EAS Insights)
- [ ] Unhandled errors caught and reported
- [ ] Source maps uploaded for production builds
- [ ] Crash-free rate visible in dashboard

### STORY-005: As a developer, I want a release checklist

**Acceptance Criteria:**

- [ ] Pre-release checklist documented
- [ ] Staging sign-off process defined
- [ ] Rollback procedure documented (OTA update revert or store rollback)
- [ ] Version bumping process defined

### STORY-006: As a developer, I want all quality gates passing in CI

**Acceptance Criteria:**

- [ ] All packages: typecheck, lint, prettier, build, test pass
- [ ] Mobile: 90% coverage threshold met
- [ ] No critical or high severity lint warnings
- [ ] No `any` types in production code
- [ ] E2E smoke test for critical paths (sign in, start workout, log set)

### STORY-007: As a user, I want the app to handle poor network gracefully

**Acceptance Criteria:**

- [ ] No crashes on network timeout
- [ ] Sync failures show non-intrusive retry indicator
- [ ] Offline mode clearly indicated in UI
- [ ] Pending sync count visible (e.g., "3 changes waiting to sync")
- [ ] Automatic retry when connectivity restored

### STORY-008: As a developer, I want security verified before release

**Acceptance Criteria:**

- [ ] No API keys or secrets in client bundle
- [ ] All API calls use HTTPS
- [ ] JWT tokens stored in secure storage (not plain AsyncStorage for production)
- [ ] Certificate pinning considered (not required for V1)
- [ ] No sensitive data logged to console in production builds
- [ ] Deep link handlers validated (no open redirect)
