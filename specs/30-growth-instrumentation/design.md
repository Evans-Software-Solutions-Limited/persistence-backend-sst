# Spec 30 — Growth Instrumentation — Design

Companion to `requirements.md`. Recorded 2026-08-12 after recon of the RC
webhook, leads routes, `resendClient`, `infra/{secrets,web,api}.ts`, the DB
client/schema, the web router, and the profile/session write paths.

## The one architecture decision that shapes everything: how Meta events are sent

Recon established a hard fact: **`profiles` rows are created by the Postgres
`handle_new_user()` trigger on `auth.users`** (`supabase/migrations/002_functions_and_triggers.sql:141`),
not by any Node/Elysia code. The mobile app (frozen) never calls a registration
endpoint. So there is **no server-side JavaScript execution at registration
time** — the natural place an inline `emitEvent("registration_completed")` +
inline Meta `CompleteRegistration` would live simply does not exist.

Two ways to reconcile this with the brief (which lists BOTH a first-party
`registration_completed` event AND a Meta `CompleteRegistration` event):

- **Option A — inline fan-out.** Each Node call-site (`RC webhook`, `/leads/*`,
  session write) calls an emitter that writes `analytics_events` AND posts to
  Meta CAPI synchronously (best-effort). `registration_completed` is written by
  the DB trigger into `analytics_events`, but Meta `CompleteRegistration` is
  **deferred to build-2** (no server path to run it from).

- **Option B — outbox drainer (RECOMMENDED, and the reading most faithful to the
  brief's "Map from Workstream 1").** ALL events land in `analytics_events`
  first — Node paths via the emitter, registration via the trigger. A single
  small cron (`meta-capi-forward`) reads not-yet-forwarded rows and posts them to
  Meta CAPI, stamping `meta_forwarded_at`. This is the only backend-only way to
  send Meta `CompleteRegistration` for trigger-created registrations, and it also
  keeps the RC webhook and leads requests fast and fully isolated from Graph
  latency/outages.

**DECIDED 2026-08-12 (Brad): Option B.** Confirmed money-efficient — a 5-min
cron is ~8,600 invocations/month (well inside Lambda's 1M free tier), each a
sub-second indexed query that early-returns when there are no pending rows or
Meta is unconfigured; same pattern as the 5 existing crons. Also decided:
`analytics_events` lives in **Supabase Postgres** (the app DB — the brief
specifies a `supabase/migrations` table, and the funnel acceptance criterion
needs SQL joins against `profiles`/`user_subscriptions`; no AWS-native store
required), and **all four workstreams ship in ONE PR** (Brad's preference).

### Why the outbox is the better engineering call here

- The RC webhook is retry-sensitive (RevenueCat re-delivers on any 5xx/timeout).
  An inline Graph POST — even in a try/catch — adds latency and a failure
  surface to a path whose existing side-effects (`safeEvaluateStreaks`,
  `safeRecomputeVolume`) are already `await`ed sequentially. Writing one local
  row and forwarding out-of-band keeps the webhook lean.
- `analytics_events` becomes a durable outbox: if Meta is down, rows still land
  and get forwarded on the next drain. No lost conversions.
- One generic forwarder → adding TikTok Events API later is a sibling client the
  drainer also calls (R2.5), with no call-site churn.

## Data model — `analytics_events`

```
analytics_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid null references profiles(id) on delete set null,
  event_name      text not null,
  occurred_at     timestamptz not null default now(),
  properties      jsonb not null default '{}'::jsonb,
  source          text not null default 'server',   -- server | web | app (build-2)
  event_id        text null,        -- dedup key shared with the browser pixel
  meta_forwarded_at timestamptz null, -- Option B outbox marker (null = pending)
  created_at      timestamptz not null default now()
)
```

- **`user_id` nullable + `ON DELETE SET NULL`.** A `lead_captured` event has no
  user; and an account deletion must not cascade-wipe the funnel history it
  contributed (retention/analytics survive user deletion, de-identified).
- **No PII at rest (HC-4).** `properties` carries `value`, `currency`,
  `audience`, `tier`, `store`, `billing_cycle`, `event_id` echoes — never email
  or name. Email is hashed only in-flight in the CAPI client.
- **`event_id`.** For RC-derived events, the natural key is the RevenueCat
  `event.id` (stable, unique per RC event) — this is what Meta dedups on. For
  `lead_captured`, the web generates a UUID `event_id`, fires the browser pixel
  `Lead` with it, and passes it to `/leads/*`; the server stores the same value
  so the CAPI `Lead` dedups against the pixel (R3.2). For `session_completed`,
  `event_id = "sess_" + serverSessionId`. For trigger `registration_completed`,
  `event_id = "reg_" + user_id`.
- **Indexes:** `(event_name, occurred_at)` for funnel queries; a partial
  `(meta_forwarded_at) WHERE meta_forwarded_at IS NULL` for the drainer's hot
  scan (Option B only); a **partial UNIQUE on `event_id WHERE event_id IS NOT
NULL`** for idempotency — the RC webhook emits before mark-done, so a
  crash-then-retry re-emits the same `event.id`; `insert` uses `ON CONFLICT DO
NOTHING` so the funnel never double-counts (NULL event_ids are exempt).
- **Schema mirror:** add the Drizzle table to `packages/db/src/schema.ts`
  alongside the raw-SQL migration (both are sources of truth in this repo).
- **Retention:** analytics_events is high-volume, user-linked data. It is added
  to the nightly `dataRetentionSweep` on the same 12-month horizon as
  `client_data_access_log`, with a `(created_at)` index to serve the prune —
  consistent with the privacy policy's stated retention.

## The emitter — canonical event contract (`application/analytics/`)

```ts
// application/analytics/events.ts — the contract build-2's client emitter targets.
export type AnalyticsEventName =
  | "registration_completed"
  | "trial_started"
  | "subscription_purchased"
  | "renewal"
  | "cancellation"
  | "expiration"
  | "session_completed"
  | "lead_captured";

// Named AnalyticsEventInput (not AnalyticsEvent) so it doesn't collide with the
// Drizzle row type AnalyticsEventRow in @persistence/db.
export interface AnalyticsEventInput {
  name: AnalyticsEventName;
  userId?: string | null;
  occurredAt?: Date;
  eventId?: string; // dedup key (pixel ↔ CAPI)
  source?: "server" | "web" | "app";
  properties?: Record<string, unknown>;
}
```

```ts
// application/analytics/emitEvent.ts
export async function emitEvent(event: AnalyticsEventInput): Promise<void> {
  try {
    await new AnalyticsEventRepository().insert(event);
  } catch (err) {
    console.error(`[analytics:emit] failed for ${event.name}: ${msg(err)}`);
    // best-effort — never rethrow (HC-2)
  }
}
```

- `AnalyticsEventRepository.insert` — a plain append-only repository under
  `application/repositories/`, mirroring `aiUsageLogRepository`. Uses
  `getDb()` from `@persistence/db/client` and the Drizzle table from
  `@persistence/db`.
- The emitter is the **only** thing call-sites import. Sinks (DB now, Meta via
  the drainer under Option B) are wired behind it — R1.3/R2.5.
- Shape matches the future client emitter exactly, so build-2's mobile adapter
  is `POST /analytics/events` → `emitEvent(...)`, not a rework (R1.2).

## WS1 emission points (exact, from recon)

| Event                                                                                  | Where                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registration_completed`                                                               | `handle_new_user()` trigger — new migration adds an `INSERT INTO analytics_events` after the profiles insert           | `event*id = 'reg*'                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                                                        | NEW.id`, `source='app'`. Trigger already swallows errors (`EXCEPTION WHEN OTHERS`), so an analytics insert failure can never fail signup. ⚠ Sensitive: edits a `SECURITY DEFINER` auth trigger — the migration re-creates the function verbatim + one appended insert, idempotent. |
| `trial_started` / `subscription_purchased` / `renewal` / `cancellation` / `expiration` | `revenueCatWebhookHandler.ts`, after the per-user sync loop succeeds (step 4), before mark-done                        | Map from `event.type`: `INITIAL_PURCHASE`+`period_type==='TRIAL'` → `trial_started`; `INITIAL_PURCHASE`/`NON_RENEWING_PURCHASE` (non-trial) → `subscription_purchased`; `RENEWAL` → `renewal`; `CANCELLATION` → `cancellation`; `EXPIRATION` → `expiration`. `value`/`currency` from `event.price`/`event.currency` parsed defensively (R1.5). `userId = app_user_id` (skip anonymous/foreign ids, matching sync). One emit per webhook, `event_id = event.id`. Wrapped so it can never fail the webhook (HC-2). |
| `session_completed`                                                                    | `sessionsRecordHandler.ts:203`, inside the existing `if (payload.status === "completed" && !recorded.wasReplay)` block | Mirror `safeEvaluateStreaks`/`safeRecomputeVolume` as `safeEmitSessionCompleted`. Gate additionally on `payload.clientSessionId != null` so legacy no-clientSessionId clients (which get a fresh row every sync) can't double-emit. `event_id = 'sess_'+serverSessionId`.                                                                                                                                                                                                                                        |
| `lead_captured`                                                                        | `leadsRoutes.ts`, after `addContactToAudience` succeeds in each route                                                  | `properties.audience = 'athletes'                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 'coaches'`, `source='web'`, `event_id` from the request body (shared with the pixel). Best-effort; never affects the 200/503 the form already returns. |

The RC webhook body currently parses only `id`/`type`/`app_user_id`/`transferred_*`.
The analytics emit reads a few more fields (`price`, `currency`, `period_type`,
`store`, `product_id`) directly off the raw event — added to the defensive parse,
not trusted for entitlement decisions (those still come from the REST re-fetch).

## WS2 — Meta Conversions API client (`application/analytics/metaCapiClient.ts`)

- Mirrors `resendClient.ts`: native `fetch`, no SDK, a `MetaCapiNotConfiguredError`
  - `requireConfigured` guard, `getEnv` accessors for `META_DATASET_ID`,
    `META_CAPI_ACCESS_TOKEN`, `META_TEST_EVENT_CODE` (optional).
- `POST https://graph.facebook.com/v21.0/{dataset_id}/events?access_token=...`
  with `{ data: [event], test_event_code? }`.
- **`user_data` hashing:** SHA-256 of the normalized (trim+lowercase) email via
  `node:crypto`; `external_id` = SHA-256 of the user id; include raw `fbc`/`fbp`
  when present (Meta expects those un-hashed). Never log the raw email.
- **Event mapping** (`application/analytics/metaEventMap.ts`):
  `subscription_purchased`/`renewal` → `Purchase` (value+currency);
  `trial_started` → `StartTrial`; `subscription_purchased` also implies
  `Subscribe` (send `Subscribe` for the initial purchase);
  `registration_completed` → `CompleteRegistration`; `lead_captured` → `Lead`.
  `cancellation`/`expiration` have no standard Meta event → not forwarded.
- `action_source` = `website` when `source==='web'`, else `app`. `event_id`
  carried through for dedup. Fire-and-forget; unconfigured → no-op (HC-3).
- Generic sink boundary: `metaCapiClient` implements a `ConversionSink`
  interface; a `tiktokEventsClient` sibling can be dropped in later (R2.5).

### Option B drainer (`microservices/core/src/metaCapiForwardCron.ts` + `infra/api.ts` Cron)

- `rate(5 minutes)` (tunable). Reads `analytics_events WHERE meta_forwarded_at IS
NULL AND event_name IN (<mapped set>) ORDER BY occurred_at LIMIT N`, maps each
  to a Meta event, posts (batched per Graph limits), stamps `meta_forwarded_at`.
- For `CompleteRegistration`/`Purchase` it needs the user's email → fetch from
  `profiles`/auth at forward time and hash in-flight (never stored). Rows whose
  user was deleted (user_id null) forward without `em`/`external_id`.
- At-least-once; Meta dedups on `event_id`. A forward failure leaves
  `meta_forwarded_at` null → retried next drain. No-ops entirely when Meta is
  unconfigured (the cron early-returns), so a stage without secrets is a clean
  no-op. Reuses the `DATABASE_URL` + `SENTRY_DSN` bindings like the other crons.
- **Age-out (prevents head-of-line blocking / unbounded growth):** Meta rejects
  events whose `event_time` is >7 days old. Each drain FIRST bulk-marks pending
  rows older than `now − 7d` forwarded without sending (one statement, unbatched)
  — so a rollout that enables secrets weeks after deploy, or a persistently-bad
  token, can't re-pull the same unsendable oldest batch forever, and the pending
  set always drains. Then it forwards only the fresh remainder. `skipped` is
  logged in `[meta-capi-forward:summary]`.

## WS3 — Web pixel + click capture + campaign routes

- **Pixel:** a small `packages/web/src/lib/metaPixel.ts` that injects the pixel
  only when a build-time `VITE_META_PIXEL_ID` is set (absent → no-op, so dev/PR
  previews stay clean). Init in `main.tsx`; fire `PageView` on route change.
- **CSP (`infra/web.ts:37`):** add `https://connect.facebook.net` to
  `script-src`, `https://www.facebook.com` to `img-src` (the pixel's tracking
  GIF) and `connect-src`. One-line change per directive; the documented seam.
- **Click capture (`useLeadSubmit.ts` + forms):** read `fbclid` from the URL
  (persist to `fbc` in the documented `fb.1.<ts>.<fbclid>` format) and the
  `_fbp` cookie; generate a UUID `event_id`; fire the browser pixel `Lead` with
  that `event_id`; POST `{ ..., fbc, fbp, event_id }` to `/leads/*`.
- **`/leads/*` extension:** add optional bounded fields `fbc`, `fbp`, `event_id`
  (maxLength-guarded) to both route bodies. On success, emit `lead_captured`
  carrying them so the CAPI `Lead` dedups with the pixel (R3.2).
- **Rate limiting (R3.3, gates public linking):** add an API Gateway route-level
  throttle for the `/leads/*` routes (SST `transform` on the ApiGatewayV2 route,
  or a per-route throttle setting) as the first line, since these are the only
  unauthenticated write endpoints and `/leads/coach` sends email. Turnstile on
  the forms is the stronger option; captured here as the follow-up if throttle
  proves insufficient. **No public campaign traffic is driven until this lands.**
- **Campaign landing routes (R3.4):** add `/uon`, `/flyer`, `/qr/:slug` React
  routes that render the Home hero but whose store CTAs append per-asset
  attribution — Apple `ct`/`pt` campaign tokens on the App Store link and
  `utm_source`/`utm_campaign` on the Play link. Centralize the token map in
  `marketing/config.ts` so a new asset is one entry. Install attribution then
  reads out of App Store Connect / Play Console analytics (no SDK, no binary).

## WS4 — Subscriptions verification (mostly documentation)

- **R4.1:** The only code/DB-side "catalog" is the `subscription_tiers` table
  (GBP reference prices + gating flags) which the mobile reads via a public
  endpoint; real localized store prices come from ASC/Play/RevenueCat (mobile
  IAP prices are storefront-localized — PR #381). The `entitlements.ts`
  tier list (`RC_ENTITLEMENT_IDS`, `TIER_RANK`) is structural entitlement→tier
  mapping, **not** pricing, and correctly does not need a binary to change a
  price/offering. Conclusion: tier/price/offering changes are console + (if the
  GBP reference row changes) a one-line migration — no binary. Documented in the
  spec; no code change.
- **R4.2:** Coach Pro EUR annual is only 16.7% off (€999.99 vs €99.99×12) vs
  29.9% GBP. Fix = **raise the EUR monthly** in App Store Connect / Play / RC —
  a store-console change, Brad's action, nothing in this repo. Captured as a
  runbook action item (exact new price is Brad's pricing call).
- **R4.3:** The webhook reconcile re-fetches active entitlements and maps
  whichever entitlement is live to a tier — a PROMOTIONAL grant surfaces in the
  same `/subscriptions` snapshot as any other access-granting subscription, so
  comps/founding/student grants activate the tier cleanly. Verified by reading
  the sync path; add a focused test asserting a promo-shaped subscription
  activates.

## Testing strategy (90% on changed backend files)

- `emitEvent` / `AnalyticsEventRepository`: inserts the right row; swallows a DB
  error without throwing (HC-2).
- RC webhook: each `event.type` maps to the right event name + value/currency;
  a thrown emit does NOT change the webhook's 200/500; anonymous/foreign ids
  don't emit.
- session handler: emits once on completed+non-replay+clientSessionId; not on
  replay; emit failure doesn't fail the record.
- leads: emits `lead_captured` with the right audience + forwarded fbc/fbp/
  event_id; emit failure doesn't change the 200/503.
- `metaCapiClient`: unconfigured → no-op (no fetch); hashes email; maps events;
  never logs raw email; non-2xx handled without throwing to the caller.
- drainer (Option B): forwards pending rows, stamps `meta_forwarded_at`, retries
  on failure, no-ops when unconfigured.
- Web: pixel no-ops without an id; CSP snapshot; useLeadSubmit forwards
  fbc/fbp/event_id; campaign routes render + build correct store URLs.

## Rollout / secrets (Brad, manual — chat runbook, not committed)

- SST Secrets per stage: `META_DATASET_ID`, `META_CAPI_ACCESS_TOKEN`,
  optional `META_TEST_EVENT_CODE`; build-time `VITE_META_PIXEL_ID` for web.
- Migrations are prod-applied manually (flagged in each migration + STATE.md).
- Verify in Meta Events Manager → Test Events before driving traffic.
