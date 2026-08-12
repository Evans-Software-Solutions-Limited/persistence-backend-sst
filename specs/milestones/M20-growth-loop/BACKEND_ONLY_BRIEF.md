# M20 Growth Instrumentation — BACKEND/WEB-ONLY BRIEF (binary frozen)

**Written:** 2026-08-12 (Cowork session) · **Owner:** Brad · **Executor:** Claude Code
**Supersedes nothing — implements** `specs/milestones/GTM-EXPANSION/BRIEF.md` §4 (M20-P1)
under a new constraint: **both apps are submitted and in store review; no new
binary this cycle.**

## Context — read first

- `specs/milestones/GTM-EXPANSION/BRIEF.md` §4 (M20) + §7 (marketing-readiness).
  M20-P1 (day-0 events) was pulled forward 2026-07-11 but was NEVER BUILT: no
  `analytics_events` table, no `.telemetry/`, no growth-instrumentation spec
  exists (spec-22 became program-import-and-adaptation).
- `marketing/LAUNCH_PLAYBOOK.md` §7 (ads gates), `STATE.md` START HERE
  (2026-08-12 entry: both apps submitted).
- **HARD CONSTRAINT: zero diffs under `packages/mobile`.** Anything needing a
  new binary is out of scope → queue as "build 2". `microservices/core`,
  `infra/`, `packages/web`, `supabase/migrations` deploy freely.
- Kiro discipline: author the spec triplet first (`specs/30-growth-instrumentation/`
  or next free number), checkpoint Brad on open decisions, then build in
  PR-sized rows. Standard rules: recon-first, idempotent migrations
  (prod-apply flagged manual), 90% coverage.

## Workstream 1 — First-party events, server-derived (DO FIRST: data decays daily)

1. `analytics_events` table (id, user_id nullable, event_name, occurred_at,
   properties jsonb, source) — idempotent migration + thin server-side emitter.
2. Emit from EXISTING server paths only (no client emitter this cycle):
   - `registration_completed` — profile-creation path
   - `trial_started`, `subscription_purchased` (value+currency), `renewal`,
     `cancellation`, `expiration` — from `revenuecat/revenueCatWebhookHandler.ts`,
     AFTER the entitlement upsert, best-effort try/catch, must NEVER fail the webhook
   - `session_completed` — session sync/write path
   - `lead_captured` (audience: athletes|coaches) — from `leads/leadsRoutes.ts`
3. Emitter interface must match the eventual client emitter (build 2) so the
   mobile addition later is a thin adapter, not a rework.

## Workstream 2 — Meta Conversions API (server-side, no SDK)

1. Secrets: `META_DATASET_ID`, `META_CAPI_ACCESS_TOKEN`, optional
   `META_TEST_EVENT_CODE` — fail-safe pattern from `leads/resendClient.ts`
   (empty config → no-op 503-free, NOT fail-fast secrets).
2. `metaCapiClient.ts` mirroring resendClient conventions: native fetch, no
   SDK, POST `https://graph.facebook.com/v21.0/{dataset_id}/events`.
3. Map from Workstream 1: Purchase (value/currency from RC webhook), Subscribe,
   StartTrial, CompleteRegistration, Lead. All best-effort/fire-and-forget.
4. `user_data`: SHA-256-hashed normalized email, hashed external_id (user id);
   pass `fbc`/`fbp` when captured (WS3); `event_id` on every event for pixel
   dedup; `action_source` = website for web-origin events, app otherwise.
5. Keep the sink generic — a TikTok Events API adapter should be addable as a
   sibling later without touching the event stream.

## Workstream 3 — Web pixel + click-capture + campaign attribution

1. Meta Pixel on the marketing site (`packages/web`). ⚠ CSP lives in
   `infra/web.ts` — extend script-src/connect-src/img-src for
   `connect.facebook.net` + `www.facebook.com` (the documented one-line seam).
2. Waitlist + coach forms: capture `fbclid`→`fbc` and the `_fbp` cookie; extend
   the two `/leads/*` endpoints to accept them (bounded, optional) and forward
   a CAPI `Lead` event deduped with the pixel via shared `event_id`.
3. BEFORE any traffic is driven: add the rate limiting / Turnstile flagged in
   the `leadsRoutes.ts` follow-up comment (coach route is an
   email-amplification vector).
4. Per-campaign landing routes (`/uon`, `/flyer`, `/qr/...`) whose outbound
   store links carry ASC campaign tokens (ct/pt) and Play UTM params —
   per-asset install attribution via store analytics, no SDK.

## Workstream 4 — Subscriptions: confirm backend-only levers

1. Verify no code-side tier lists anywhere (catalog = SSOT; mobile renders the
   offering) — tier/price/offering changes stay console+migration only.
2. Known defect, console-only fix: Coach Pro EUR annual is only 16.7% off
   (€999.99 vs €99.99×12) vs 29.9% GBP — fix by RAISING the EUR monthly.
3. Comps/founding/student offers rail = RC promotional entitlements — confirm
   the webhook path handles PROMOTIONAL grants cleanly.

## Explicitly OUT of scope (queue as "build 2" immediately after approval)

Meta/FB SDK, any MMP, SKAdNetwork/AEM in-app config, client-side event
emitter, share card, referral codes, ATT prompt. Note honestly in the spec:
without the SDK there is no install-level SKAN attribution — server signals
suffice until paid spend starts (playbook gates Meta spend to month 3+).

## Acceptance

- Every WS1 event lands in `analytics_events` from real flows; a sandbox IAP
  produces a server-side Purchase event with value+currency.
- Events visible in Meta Events Manager (test events) with dedup working.
- Zero diffs under `packages/mobile`. RC webhook behaviour unchanged when
  Meta/analytics config is absent or the sink is down.
- Weekly funnel (installs→registration→trial→paid) computable from
  `analytics_events` alone.
- STATE.md updated per row shipped.
