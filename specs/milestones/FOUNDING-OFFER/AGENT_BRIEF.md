# FOUNDING-OFFER — agent brief for the remaining work

You are picking up milestone `specs/milestones/FOUNDING-OFFER/` on branch
`feat/founding-offer-admin` (worktree `.claude/worktrees/founding-offer`, based on
`origin/main` @ `ea85b774`). Read, in order: `BRIEF.md` (decisions D1–D9 are
binding), `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`, then the
2026-09-03 entry at the top of `STATE.md`. Repo conventions: root `CLAUDE.md`,
`.claude/skills/elysia-route-change/SKILL.md`, `.claude/skills/sst-resource-change/SKILL.md`.
Mobile changes are additive UI on existing screens; CLAUDE.md's "port fidelity"
rule still applies to everything you do not explicitly add here.

## Already done (do not redo)

- Backend: migration, schema, `requireAdmin`, `/admin/*`, `/referrals/*`,
  pending-grant apply in `GET /subscriptions/me`, RC-sync attribution lock,
  `scripts/set-admin.ts`, `WEB_ORIGIN` env. Commit `f2e34374`.
- Web: `/admin` panel (`packages/web/src/admin/`) — login, dashboard, grants
  (+ New grant form), codes, lookup, audit; `VITE_SUPABASE_*` env. Commit `571c5c19`.

Gate for every PR: `bun run typecheck && bun run lint && bun run test:unit`
green at the repo root (lint has pre-existing warnings only; zero errors).
Prettier on touched files. Add a STATE.md session entry before finishing.

## Work package A — website: founding landing + `?ref=` capture (FRONTEND_BRIEF § W3)

1. **`/founding` route + Home section** (`packages/web/src/pages/Founding.tsx`, linked
   from Home's hero and store section). Content, in this order: one-line hook
   ("I turn 30 this month. 200 founding places."), the two consumer cards
   (Premium £30 / Premium+ £50, six months, no auto-renew), the coach line
   (Start Up Coach+ £99, 20 places), "X of 200 places taken" (read
   `import.meta.env.VITE_FOUNDING_SEATS_USED`, default 0; add it to
   `vite-env.d.ts` and `infra/web.ts` like `VITE_META_PIXEL_ID`), what the money
   funds (banners, QR subscription, founders' fairs — plain list in prose), how
   redemption works ("pay, then sign up in the app with the same email — access
   is on within a day; we'll email you"), payment: bank-transfer details and
   Stripe Payment Link buttons read from `VITE_FOUNDING_BANK_DETAILS` /
   `VITE_FOUNDING_STRIPE_PREMIUM_URL` / `VITE_FOUNDING_STRIPE_PREMIUM_PLUS_URL` /
   `VITE_FOUNDING_STRIPE_COACH_URL` (all optional; hide a button whose URL is
   empty), the 14-day cancellation acknowledgement sentence, T&Cs link. Copy
   rules: sentence case, no emojis, no hype, no mention of financial pressure.
   `useSeo` like the other pages; add to `sitemap.xml`.
   **⚠ Apple 3.1.3(b):** this page may be linked from the website, QR codes and
   socials only — never from inside the mobile app.
2. **`?ref=<CODE>` capture** on every marketing route: in `MarketingLayout`, read
   `ref` from the query string, normalise (upper-case, strip spaces/hyphens,
   `^[A-Z0-9]{4,24}$`), persist to `sessionStorage` key `persistence.ref`, and
   render a small dismissible banner "Referral code CODE noted — enter it in the
   app after you sign up". No backend validation from the marketing site.
3. **Attribute store clicks**: extend `reportStoreClick` (`lib/storeClick.ts`) to
   send `ref` when present, and extend the backend `POST /store-click` schema +
   `analytics_events.properties` to accept and store `ref` (optional string,
   ≤24). Find the handler under `microservices/core/src/application/analytics/`
   (route registered via the marketing edge). Additive; do not touch Meta CAPI
   forwarding (`ref` must not be forwarded — it is not consented ad data).
4. Tests: route renders with/without env; `?ref` normalisation + banner; store
   click carries `ref`; backend schema accepts/rejects `ref`. Web suite,
   typecheck, lint, `vite build` green.

## Work package B — mobile: referral code entry (FRONTEND_BRIEF § Mobile)

**Ship as an EAS Update (OTA), not a store build.** Everything here is JS/TS:
no new native module, no `app.config.ts` change, no permission. The project
already runs `expo-updates` with `runtimeVersion: { policy: "appVersion" }` and
channels `staging` / `production` (`eas.json`). Constraints that follow:

- Branch the mobile work from the commit the **current store build** was cut
  from (same `version` in `app.config.ts` ⇒ same runtime), NOT from a branch
  that carries native changes (the Meta SDK / ATT / ExpoSQLite plugin work on
  `codex/mobile-release-drag-loader-meta` requires a new binary). If `main`'s
  `version` differs from the store build's, ask Brad which runtime to target
  before publishing.
- `eas update --channel staging --message "referral code entry"` first; device
  check on iOS + Android against the staging API (backend must already be
  deployed there — Work package A is not a dependency). Then
  `eas update --channel production`.
- Do not add `expo-*` packages or bump anything with native code; if you find
  yourself needing to, stop and flag it — that turns this into a store release.

Implementation:

1. `domain/models/referral.ts`, `domain/ports/referrals.port.ts`, API adapter for
   `POST /referrals/claim { code }`, `GET /referrals/me`, `DELETE /referrals/me`
   (envelope `{ data: { applied } }`; errors `{ message }` with 404 uniform
   "That code isn't valid", 409 locked, 429 rate-limited). Hooks
   `useAppliedReferral` / `useClaimReferral` (query key `['referral', userId]`).
2. Onboarding (spec-31 journey, last step): collapsed row **"Have a referral or
   partner code?"** → inline input (upper-cases as typed, 4–24 chars) + Apply.
   Success: "Applied: <label>". Failure: server message verbatim. Continue/Skip
   never depend on it; an in-flight claim is dropped on Skip.
3. Subscription Selection: under the tier cards, applied state
   "Referral: <label> · Change" or the same entry row; read-only when
   `lockedAt` is set. Keep it visually separate from any store offer-code
   action; a referral never alters displayed prices.
4. Founding members need **no** mobile change. Verify the existing
   "cancelled — active until <date>" banner and the post-expiry gate copy read
   sensibly for a row with `cancelledAt` set, `paymentStatus='active'`,
   `expiresAt` +6 months; propose copy tweaks to Brad rather than changing them.
5. Jest: hooks, onboarding row (does not block Continue/Skip), Subscription
   Selection applied/locked states, neutral error rendering. Mobile
   typecheck/lint/test green.

## Work package C — staging verification and production release

1. Merge order: backend PR → web PR → (mobile OTA independent). Staging auto-applies
   the migration on merge.
2. Staging: run `SMOKE_TEST.md` §§ Backend + Web end to end with
   `bun run set-admin <brad staging email>` (needs `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY` for staging), the Supabase Auth redirect
   allow-list containing `https://staging.<site>/admin/callback`, and
   `VITE_SUPABASE_ANON_KEY` in the staging web deploy env.
3. Production release follows `SMOKE_TEST.md § Release` exactly — it ships every
   migration since v1.8.0 (all additive; review the `--dry-run` output), then the
   RevenueCat production webhook check, `set-admin` on prod, web env, redirect
   URL, and Brad's first real grant before any public announcement.
4. Ops notes for Brad (put them in the PR description): Stripe Payment Links
   (one per tier, cap 200 across the two consumer links is NOT enforceable in
   Stripe — the panel's seat meter is the cap; set each link's limit
   generously and watch the dashboard), bank details for the landing page, and
   the reply-to for the invite email (`RESEND_FROM` is `no-reply@` — replies
   bounce; either add a `reply_to` in `foundingGrantService.sendInvite` or
   change the email copy to point at a support address).

## Out of scope (do not start)

Commission ledger, partner portal, Apple/Google offer-code mapping, Stripe
webhooks, a live public seat counter endpoint (follow-up once the static
`VITE_FOUNDING_SEATS_USED` is annoying), deleting the parked Stripe rail.
