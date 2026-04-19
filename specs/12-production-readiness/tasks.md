# 12 — Production Readiness: Tasks

## Phase 0: Current state (2026-04-19)

**Shipped: ~1 of ~45 tasks complete. Not started except for the icons/splash port.**

What's there:

- App icon + splash screens ported from legacy app (commit cb8b3c0, `packages/mobile/assets/icons/`). iOS adaptive / Android adaptive + light/dark splash variants in place.

Nothing else built: no `eas.json`, no performance audit, no error monitoring, no security audit, no network-resilience test pass, no release process docs.

Parent milestone: **M11 Polish** — runs `/frontend-design` pass across the whole app for cohesion; performs the FlatList→FlashList roll, `expo-image` rollout with blur placeholders, animation jank audit; empty/error/loading state consistency sweep; accessibility (touch targets, screen-reader labels, contrast AA); navigation redesign decision (Home + Progress + Workouts + Exercises + Nutrition + Profile + optional Clients is 6-7 tabs, which likely pushes something into Profile menu or a drawer); EAS build config; Sentry; release checklist.

## Phase 1: EAS Build

- [ ] Create `eas.json` with development, preview, production profiles
- [ ] Configure environment variables per profile
- [ ] Verify iOS build (bundle ID, signing)
- [ ] Verify Android build (package, keystore)
- [ ] Test development build (dev client)
- [ ] Test preview build (internal distribution)

## Phase 2: Store Assets

- [ ] Copy/create app icon from old app (iOS + Android adaptive)
- [ ] Copy/create splash screens (light + dark)
- [ ] Prepare App Store screenshots
- [ ] Prepare Play Store screenshots
- [ ] Write App Store description and keywords
- [ ] Ensure privacy policy and terms of service URLs are live
- [ ] Create app preview video (optional)

## Phase 3: Performance

- [ ] Measure cold start time, target <2s to interactive
- [ ] Implement lazy tab loading (React.lazy for tab screens)
- [ ] Preload SQLite data during splash screen
- [ ] Defer health/notification initialization
- [ ] Replace FlatList with FlashList for long lists
- [ ] Add React.memo to list item components
- [ ] Measure and reduce JS bundle size (target <15MB)
- [ ] Profile and fix unnecessary re-renders

## Phase 4: Error Monitoring

- [ ] Choose and integrate error reporting (Sentry or EAS Insights)
- [ ] Configure source map upload for production builds
- [ ] Set user context on sign-in
- [ ] Add breadcrumbs for navigation and key actions
- [ ] Verify errors appear in monitoring dashboard
- [ ] Strip console.log from production builds (Babel plugin)

## Phase 5: Security Audit

- [ ] Verify no secrets in client bundle (only EXPO*PUBLIC*\* vars)
- [ ] Migrate JWT storage from AsyncStorage to expo-secure-store
- [ ] Verify all API calls use HTTPS
- [ ] Validate deep link handlers (no open redirect)
- [ ] Verify no sensitive data in console logs (production build)
- [ ] Review all API adapter error messages (no token/secret leakage)

## Phase 6: Network Resilience

- [ ] Test all screens with airplane mode (verify offline UX)
- [ ] Test sync queue with slow/intermittent network
- [ ] Verify retry indicators are non-intrusive
- [ ] Test session logging survives complete offline period
- [ ] Verify sync resumes cleanly when connectivity restored
- [ ] Add "pending sync" indicator to UI (number of queued mutations)

## Phase 7: Quality Gate Final Pass

- [ ] `bun run prettier:check` — passes
- [ ] `bun run typecheck` — passes, no `any` types
- [ ] `bun run lint` — passes, no warnings
- [ ] `bun run build` — passes
- [ ] `bun run test:unit` — passes, 90% coverage met
- [ ] Manual smoke test: sign in → browse exercises → start workout → log sets → complete → view progress
- [ ] Cross-platform test: iOS + Android

## Phase 8: Release Process

- [ ] Document release checklist
- [ ] Document rollback procedure (OTA + store)
- [ ] Define version bumping process
- [ ] Create staging sign-off template
- [ ] Define staged rollout plan (10% → 50% → 100%)
- [ ] Submit to TestFlight / Play Internal Testing
- [ ] Staging sign-off
- [ ] Production release

## Phase 9: Post-Launch

- [ ] Monitor crash-free rate (target >99.5%)
- [ ] Monitor API error rates
- [ ] Monitor sync failure rates
- [ ] Set up alerts for elevated error rates
- [ ] Plan first post-launch patch cadence
