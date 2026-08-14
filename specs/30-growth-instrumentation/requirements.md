# Spec 30 — Growth Instrumentation (backend/web-only)

**Status:** Draft (authored 2026-08-12) · **Owner:** Brad · **Executor:** Claude Code
**Implements:** `specs/milestones/M20-growth-loop/BACKEND_ONLY_BRIEF.md`, which
scopes `specs/milestones/GTM-EXPANSION/BRIEF.md` §4 (M20-P1) under the
binary-frozen constraint (both apps in store review).

## Why now

Both apps are submitted and in store review (STATE.md 2026-08-12). Day-0 funnel
data — installs → registration → trial → paid — decays daily and can never be
backfilled. We must land first-party server-side instrumentation before paid
traffic and before RevenueCat Shipaton traction judging (release window
1 Aug–30 Sep 2026). The mobile binary is frozen, so **everything here is
backend / infra / `packages/web` / `supabase/migrations` only** — no client SDK,
no client-side emitter, no new binary this cycle.

## Hard constraints (non-negotiable)

- **HC-1** Zero diffs under `packages/mobile`. Anything requiring a new binary
  is out of scope and queued as "build 2".
- **HC-2** Emission is **best-effort everywhere**. It must NEVER fail the
  RevenueCat webhook, the leads-capture requests, or any user-facing write. Every
  emit is wrapped in its own try/catch and any error is logged, not thrown.
- **HC-3** Every external sink (analytics DB, Meta CAPI) **no-ops cleanly when
  unconfigured** — empty secrets → silent no-op, never a 5xx (mirror
  `resendClient` / `SentryDsn` / `ExpoAccessToken`, NOT the fail-fast secrets).
- **HC-4** No PII at rest in `analytics_events`. Email/name are never written to
  the events table; email is SHA-256-hashed only in-flight for Meta CAPI
  `user_data` and never persisted.
- **HC-5** Standard repo rules: recon-first, idempotent migrations (prod-apply
  flagged manual), 90% coverage on changed backend files, conventional commits,
  STATE.md updated per row shipped.

## Workstream 1 — First-party events (server-derived)

- **R1.1** A `analytics_events` table exists: `id` (uuid pk), `user_id`
  (uuid, nullable, FK→profiles with `ON DELETE SET NULL`), `event_name` (text),
  `occurred_at` (timestamptz, default now()), `properties` (jsonb, default
  `{}`), `source` (text — e.g. `server`/`web`/`app`), `created_at` (timestamptz).
  Migration is idempotent (`CREATE TABLE IF NOT EXISTS`) and mirrored in
  `packages/db/src/schema.ts`.
- **R1.2** A thin server-side emitter (`emitEvent`) inserts one row. It is
  best-effort: a DB failure is caught and logged, never thrown. Its input shape
  is the **canonical event contract** that the eventual client emitter (build 2)
  will target, so the mobile addition later is a thin adapter, not a rework.
- **R1.3** The emitter fans out to registered **sinks**. WS1 registers the
  `analytics_events` DB sink; WS2 adds the Meta CAPI sink. Adding a sink (e.g. a
  future TikTok Events API adapter) must not touch the call-sites.
- **R1.4** Events emitted from existing server paths only (no client emitter):
  - `registration_completed` — on genuine first-time profile creation.
  - `trial_started`, `subscription_purchased` (with `value` + `currency`),
    `renewal`, `cancellation`, `expiration` — from the RevenueCat webhook,
    AFTER the entitlement upsert, best-effort.
  - `session_completed` — on the session sync/write path, once per session
    (no double-emit on a re-sync).
  - `lead_captured` (with `audience: "athletes" | "coaches"`) — from the two
    `/leads/*` endpoints, after the contact is captured.
- **R1.5** `value`/`currency` for purchase/renewal events are read from the
  RevenueCat webhook event body (`price`/`currency`), parsed defensively —
  absent/unparseable → the event still emits without a value.
- **R1.6** The weekly funnel (installs→registration→trial→paid) must be
  computable from `analytics_events` alone (installs come from store analytics;
  registration/trial/paid come from the events table).

## Workstream 2 — Meta Conversions API (server-side, no SDK)

- **R2.1** Secrets `META_DATASET_ID`, `META_CAPI_ACCESS_TOKEN`, and optional
  `META_TEST_EVENT_CODE`, wired via the fail-safe SST Secret pattern (empty
  default; unconfigured → no-op).
- **R2.2** A `metaCapiClient` mirroring `resendClient` conventions: native
  `fetch`, no SDK, `POST https://graph.facebook.com/v21.0/{dataset_id}/events`.
- **R2.3** Maps WS1 events → Meta standard events: `Purchase` (value/currency
  from RC webhook), `Subscribe`, `StartTrial`, `CompleteRegistration`, `Lead`.
  All fire-and-forget.
- **R2.4** `user_data`: SHA-256-hashed normalized email; hashed `external_id`
  (the user id); `fbc`/`fbp` passed when captured (WS3); `event_id` on every
  event for pixel dedup; `action_source` = `website` for web-origin events,
  `app` otherwise.
- **R2.5** The sink is generic: a sibling adapter (e.g. TikTok Events API) can
  be added later without touching the event stream or call-sites.
- **R2.6** RC webhook behaviour is provably unchanged when Meta config is absent
  or Graph is down (best-effort, isolated try/catch).
- **R2.7** **CAPI consent gate — fail closed.** The sink MUST NOT forward an
  event whose subject has not affirmatively given marketing consent. A
  user-attributed row is gated on `profiles.marketing_consent === true`; an
  anonymous row (leads, store clicks) on `properties.marketing_consent === true`.
  `NULL` / absent / `false` = no forward (no recorded decision is a refusal). Do
  NOT strip `em`/`external_id` and send the rest — an unmatched event still tells
  Meta a conversion happened; skip the row entirely.
- **R2.8** **Web-only sink.** The sink forwards `source: 'web'` events ONLY.
  App/server-origin events are retained in `analytics_events` for funnel maths
  but are never forwarded, because Meta's app-event requirements (`extinfo`,
  `advertiser_tracking_enabled`) cannot be met without an in-app SDK (HC-1), so
  app events are unattributable and carry only a compliance cost. `action_source`
  is therefore always `website`.

## Workstream 3 — Web pixel + click-capture + campaign attribution

- **R3.1** Meta Pixel loads on the marketing site (`packages/web`). The CSP in
  `infra/web.ts` is extended (`script-src`/`connect-src`/`img-src`) for
  `connect.facebook.net` + `www.facebook.com` — the documented one-line seam.
  **Gated by R3.5:** the pixel must not initialise until the visitor has given
  explicit opt-in consent.
- **R3.2** The waitlist + coach forms capture `fbclid` (→`fbc`) and the `_fbp`
  cookie and forward them to `/leads/*`; the two endpoints accept them as
  bounded, optional fields and forward a CAPI `Lead` deduped with the browser
  pixel via a shared `event_id`.
- **R3.3** BEFORE any traffic is driven, the `/leads/*` endpoints gain the rate
  limiting / Turnstile flagged in the `leadsRoutes.ts` follow-up comment (the
  coach route is an email-amplification vector). Public linking is gated on this.
- **R3.4** Per-campaign landing routes (e.g. `/uon`, `/flyer`, `/qr/...`) whose
  outbound store links carry ASC campaign tokens (`ct`/`pt`) and Play UTM
  params, giving per-asset install attribution via store analytics (no SDK).
- **R3.5** **Consent gate (PECR reg 6 / UK-GDPR).** The Meta Pixel MUST NOT
  initialise (inject `fbevents.js`, call `fbq('init')`, or set `_fbp`/`_fbc`)
  until the visitor gives explicit **opt-in** consent. Default is "no consent"
  (no pre-ticked boxes, no consent-by-continuing). Consent is captured by a
  banner where **Reject is as easy as Accept** (equal prominence, one click),
  persists across page views, and is **withdrawable**; withdrawal stops future
  pixel loads/events and clears `_fbp`/`_fbc`. Not geo-gated — opt-in for every
  visitor. The server-side CAPI path is **also** consent-gated — see R2.7
  (superseding the earlier "not gated" decision). Turnstile and the theme
  preference are strictly-necessary / user-initiated and are NOT gated.
- **R3.6** **Policy accuracy (UK-GDPR Art 5(1)(a)).** The `/privacy` cookies
  section MUST describe actual behaviour — name Meta as the third party, state
  that its advertising cookie is set only after consent, and give the withdrawal
  route. The web and in-app privacy copies stay in sync per the `Privacy.tsx`
  header rule, except the cookies section, which is web-only (an in-app screen
  sets no website cookies). Do not claim a mechanism the build does not run
  (e.g. Turnstile is dormant unless its site key is set).
- **R3.7** **Advertising disclosure (UK-GDPR Art 13(1)(e) recipients).**
  `/privacy` MUST disclose Meta (Meta Platforms Ireland) as a recipient of
  server-side conversion data — sent only with consent, never sold, never
  including training/nutrition/health data — and MUST state that app activity is
  never sent to Meta. NO blanket "not used for advertising" claim may appear
  anywhere, **including the SEO `description` metadata**. These claims DO have
  in-app counterparts (unlike the cookies section), so the web + mobile copies
  change together.
- **R3.8** **Store-click conversion.** An outbound App Store click on the
  marketing site emits a `store_click` conversion, deduped browser↔server on a
  shared `event_id` (the R3.2 pattern), forwarded to Meta as a custom
  `AppStoreClick` event. This is the optimisable ads signal in the absence of an
  install SDK. The click navigates away, so the server call uses
  `navigator.sendBeacon` / `keepalive` and the pixel fires before navigation.

## Workstream 4 — Subscriptions: confirm backend-only levers

- **R4.1** Verify there is no code-side tier/price/offering list that would need
  a binary to change — the catalog (`subscription_tiers` table + the store
  consoles) is the SSOT; mobile renders the offering. Document what IS code-side
  (entitlement→tier mapping is structural, not pricing) so a reviewer isn't
  surprised.
- **R4.2** Document the known Coach Pro EUR-annual defect (only 16.7% off vs
  29.9% GBP) and its console-only fix (raise the EUR monthly). Confirm nothing
  in this repo needs to change for it (store-console pricing).
- **R4.3** Confirm the RevenueCat webhook path handles PROMOTIONAL entitlement
  grants (comps / founding / student) cleanly — the reconcile re-fetches active
  entitlements, so a promo grant should activate the tier like any other.

## Explicitly OUT of scope (queue as "build 2")

Meta/FB SDK, any MMP, SKAdNetwork/AEM in-app config, client-side event emitter,
share card, referral codes, ATT prompt. **Honest limitation:** without the SDK
there is no install-level SKAN attribution — server signals suffice until paid
spend starts (the playbook gates Meta spend to month 3+).

## Acceptance criteria

- **AC-1** Every WS1 event lands in `analytics_events` from a real flow; a
  sandbox IAP produces a server-side `subscription_purchased`/`Purchase` with
  value+currency.
- **AC-2** Events visible in Meta Events Manager (Test Events) with pixel↔CAPI
  dedup working via shared `event_id`.
- **AC-3** Zero diffs under `packages/mobile`.
- **AC-4** RC webhook + leads capture behave identically when Meta/analytics
  config is absent or the sink is down (proven by tests).
- **AC-5** Weekly funnel computable from `analytics_events` alone.
- **AC-6** ≥90% coverage on changed backend files; all gates green; Inspector
  Brad (local) clean before each PR.
- **AC-7** STATE.md updated per row shipped.
