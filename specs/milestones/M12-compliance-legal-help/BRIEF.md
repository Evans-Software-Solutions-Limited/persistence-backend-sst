# M12 — Compliance + Legal + Help

## Why this milestone

The V2 ProfilePresenter already wires "Help Center", "Contact Support", "Terms of Service", and "Privacy Policy" entries on the Support menu (see [`packages/mobile/src/ui/presenters/ProfilePresenter.tsx:615-669`](../../../packages/mobile/src/ui/presenters/ProfilePresenter.tsx)) and the ProfileContainer routes them to `/(app)/profile/{help,contact,terms,privacy}` (see [`packages/mobile/src/ui/containers/ProfileContainer.tsx:187-201`](../../../packages/mobile/src/ui/containers/ProfileContainer.tsx)) — but **none of those route files exist yet**, so every menu tap currently dead-ends. M12 ships those four route files plus a Privacy Settings screen, closing the last App-Store-blocking gap on user-facing legal/help surfaces.

The five legacy screens are static content + one `mailto:` form + one profile-visibility toggle. None of them carry under-the-hood efficiency wins; the work is **pure 1:1 port** so the App Store review submission has the legally required Privacy Policy + Terms of Service + a working support channel.

## Parent spec

No standalone Kiro spec — these screens are static content/legal copy. Brief is self-contained.

## Scope (frontend only — one PR)

Five legacy screens → five V2 route files. Container/presenter split applied where it earns its keep (privacy settings has state), thin route shell elsewhere.

| Legacy file (`persistence-mobile/app/`) | V2 destination | Backend dep |
|---|---|---|
| `privacy-policy.tsx` | `packages/mobile/app/(app)/profile/privacy.tsx` | None — static |
| `terms-of-service.tsx` | `packages/mobile/app/(app)/profile/terms.tsx` | None — static |
| `help-center.tsx` | `packages/mobile/app/(app)/profile/help.tsx` | None — static FAQ |
| `contact-support.tsx` | `packages/mobile/app/(app)/profile/contact.tsx` | Reads `session.email` from `useAuth`; `mailto:` link |
| `privacy-settings.tsx` | `packages/mobile/app/(app)/profile/privacy-settings.tsx` | Existing PATCH `/profile` (`isProfilePublic` only — see PORT-GAP below) |

Routes land at `/(app)/profile/{help,contact,terms,privacy}` — matching the paths the existing ProfileContainer already pushes to. NB: the brief's example V2 destinations (`/(app)/privacy-policy.tsx` etc.) would conflict with the wired-up paths, so we follow the container's existing routes.

Privacy Settings is **not** in the Profile menu in legacy (only deeplink-reachable). M12 adds it under the existing "Privacy Policy" row as a sibling entry to make the visibility toggle discoverable for App Store reviewers — flagged as a deliberate addition tied to App Store readiness, not a UI redesign.

## Non-goals

- **No backend changes.** Legacy `privacy-settings.tsx` writes a string `profile_visibility` ∈ {`private`,`friends`,`public`}. V2's `ApiProfile.isProfilePublic` is a boolean (see [`packages/mobile/src/domain/ports/api.port.ts:373`](../../../packages/mobile/src/domain/ports/api.port.ts)). **PORT-GAP**: M12 ships a 2-state Private/Public toggle that maps to `isProfilePublic`. The legacy "Friends Only" option is dropped at port time — restoring it requires a backend field add (out of scope; flagged for a future spec).
- No legal copy rewrite. Last-Updated date stays "January 2025" as in legacy until Brad decides to refresh it.
- No new design tokens. Reuse `profileLegacyTheme` (which itself re-exports `homeLegacyTheme`) — the shim that mirrors the legacy `Colors / Spacing / BorderRadius / Shadows / Typography` schema so the port copies StyleSheet code unchanged.
- No deeplink wiring beyond what the existing ProfileContainer already does. Legacy's `lib/utils/deeplinkParser.ts:53` privacy-settings entry is irrelevant to V2 routing.

## Success criteria

1. All four wired-up Profile menu entries (Help Center / Contact Support / Terms of Service / Privacy Policy) navigate to their respective screens and the back arrow returns to Profile.
2. Privacy Settings reachable from the Support menu, Private/Public toggle round-trips through `PATCH /profile` and persists after re-open.
3. Contact Support opens the email client with `mailto:support@persistence.app`, subject + body pre-filled, sender email taken from `session.email`. Error branch (no email client) surfaces an Alert that names the support address.
4. Help Center FAQ entries copied verbatim from legacy (5 Q+A pairs); "Contact Support" CTA at the bottom navigates to the contact screen.
5. Privacy Policy and Terms of Service render the full legacy copy verbatim (10 + 7 sections respectively), including the "Last Updated: January 2025" line.
6. Per-PR quality gates (prettier / typecheck / lint / build / test, ≥90% coverage on changed mobile files).

## Legacy file references

- `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/app/privacy-policy.tsx`
- `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/app/terms-of-service.tsx`
- `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/app/help-center.tsx`
- `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/app/contact-support.tsx`
- `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/app/privacy-settings.tsx`
- Profile menu wiring template: `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/app/(tabs)/profile.tsx:661-675`

## Port discipline

Strict 1:1 — same JSX shape, same StyleSheet, same affordances, same copy. No card surfaces, padding, shadows, or border radii beyond what legacy used. Hardcoded copy stays. Theme constants pulled from `@/ui/theme/profileLegacyTheme` (which already mirrors the legacy `@/constants/theme` schema). Any unavoidable delta gets a `// PORT-GAP:` comment AND a PR-description line.
