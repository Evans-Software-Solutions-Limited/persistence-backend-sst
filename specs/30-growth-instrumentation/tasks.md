# Spec 30 — Growth Instrumentation — Tasks (PR-sized rows)

Order enforces "WS1 first — day-0 data decays daily." **DECIDED 2026-08-12:
all four rows ship in ONE PR (Brad's preference); Meta forwarding = Option B
(outbox drainer); analytics_events in Supabase Postgres.** Rows below are commit
groups within that PR. Gates-green + Inspector-Brad-clean before raising it; zero
`packages/mobile` diffs (HC-1).

## Row 1 — WS1 first-party events (the data-capture floor) ⬅ DO FIRST

- [ ] T1.1 Migration `analytics_events` (idempotent) + `packages/db/src/schema.ts`
      mirror. Indexes: `(event_name, occurred_at)`, `(created_at)`, and
      (Option B) partial `(meta_forwarded_at) WHERE meta_forwarded_at IS NULL`.
- [ ] T1.2 `application/analytics/events.ts` (contract) + `emitEvent.ts` +
      `AnalyticsEventRepository` (append-only, best-effort). Tests.
- [ ] T1.3 Emit `subscription_purchased`/`trial_started`/`renewal`/
      `cancellation`/`expiration` from `revenueCatWebhookHandler.ts` (value+
      currency from event body, defensive parse). Webhook-never-fails tests.
- [ ] T1.4 Emit `session_completed` from `sessionsRecordHandler.ts` via
      `safeEmitSessionCompleted` (completed + non-replay + clientSessionId). Tests.
- [ ] T1.5 Emit `lead_captured` from `leadsRoutes.ts` (audience). Tests.
- [ ] T1.6 Migration `registration_completed` — extend `handle_new_user()`
      trigger to insert into `analytics_events` (idempotent function re-create).
- [ ] T1.7 Add analytics_events to `dataRetentionSweep` (12-month prune) + test.
- [ ] T1.8 STATE.md + funnel note (how to compute installs→reg→trial→paid).

## Row 2 — WS2 Meta CAPI sink

- [ ] T2.1 SST Secrets `META_DATASET_ID`/`META_CAPI_ACCESS_TOKEN`/
      `META_TEST_EVENT_CODE` (fail-safe) in `infra/secrets.ts` + wire in
      `infra/api.ts` env.
- [ ] T2.2 `metaCapiClient.ts` (+ `ConversionSink` boundary, `metaEventMap.ts`).
      SHA-256 email/external_id, fbc/fbp, event_id, action_source. Tests
      (unconfigured no-op, hashing, mapping, no-PII-logging).
- [ ] T2.3 **[Option B]** `metaCapiForwardCron.ts` + `infra/api.ts` Cron;
      `meta_forwarded_at` drain. **[Option A]** wire the Meta sink inline behind
      `emitEvent` for Node-path events. (Decided at checkpoint.)
- [ ] T2.4 STATE.md; verify in Meta Events Manager Test Events.

## Row 3 — WS3 web pixel + click capture + rate limit + campaign routes

- [ ] T3.1 CSP extension in `infra/web.ts` (script/img/connect-src).
- [ ] T3.2 `lib/metaPixel.ts` (no-op without `VITE_META_PIXEL_ID`) + init +
      PageView on route change. Tests.
- [ ] T3.3 Click capture in `useLeadSubmit.ts`/forms (fbclid→fbc, \_fbp,
      event_id, browser pixel Lead) + extend `/leads/*` bodies (fbc/fbp/
      event_id, bounded) forwarding to CAPI Lead. Tests both sides.
- [ ] T3.4 `/leads/*` rate limiting (API GW route throttle). ⚠ Gates public
      linking — must land before any campaign traffic.
- [ ] T3.5 Campaign landing routes `/uon`,`/flyer`,`/qr/:slug` + store-CTA
      attribution tokens (ASC ct/pt, Play UTM) centralized in config. Tests.
- [ ] T3.6 STATE.md.

## Row 4 — WS4 subscription lever verification (docs + one test)

- [ ] T4.1 Write the WS4 verification note into the spec/STATE (no code-side
      price list; EUR-annual console fix runbook; promo grant handling).
- [ ] T4.2 Focused test: a PROMOTIONAL-shaped active subscription activates the
      tier through the reconcile path (R4.3).
- [ ] T4.3 STATE.md.

## Build-2 backlog (queued, out of scope this cycle)

Client-side event emitter (`POST /analytics/events` → `emitEvent`), Meta/FB SDK,
MMP, SKAdNetwork/AEM, ATT prompt, share card, referral codes. Note: no
install-level SKAN attribution until the SDK ships — server signals suffice
until paid spend starts (playbook gates Meta spend to month 3+).
