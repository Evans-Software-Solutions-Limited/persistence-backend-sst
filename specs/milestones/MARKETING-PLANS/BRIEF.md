# Milestone MARKETING-PLANS — founders' offer attribution + admin "Marketing" section

Status: approved by Brad 4 Sep 2026. Thin slice; must land before the Shipaton submission (30 Sep 23:45 PDT), so scope is fixed — do not widen it.

Branch: `feat/marketing-plans` off `origin/main` **after `codex/auth-cardio-logging` has merged** (it amends the FOUNDING-OFFER grant model, adds `founding_grants.grant_kind`, makes contribution columns optional, and adds `founding_pool_limits` + `GET /founding/availability`). If it has not merged when you start, branch from `origin/codex/auth-cardio-logging` and say so in the PR body; do not build against the pre-amendment schema. One PR. Base: `git fetch && git checkout -b feat/marketing-plans origin/main`.

Read, in order: root `CLAUDE.md`, `STATE.md` (top entries 2026-09-03/04), `specs/milestones/FOUNDING-OFFER/BRIEF.md` (§ 2 **2026-09-04 amendment controls**; D1–D9 are history where they conflict), `SECURITY_REVIEW-2026-09-04.md`, `.claude/skills/elysia-route-change/SKILL.md`, `specs/30-growth-instrumentation/requirements.md` (R3.8 store click), `packages/web/src/marketing/config.ts`, `packages/web/src/admin/*`, `microservices/core/src/application/adminRoutes.ts`.

Gate for every commit: `bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit` green at the repo root; coverage ≥ 90% on changed files; no fake tests; revert-check each new test. Run the local `inspector-brad` subagent on the full diff before the final push and fix every 🔴/🟠/🟡. Never trigger the `@inspector-brad` CI action. Ping Brad via `slack-progress-updates` when green.

## 1. Why

Brad is running a founders' offer on two rails (discretionary founding access grants for warm traffic — granted, not sold, with optional separate contributions; an App Store offer code for cold Meta/Instagram traffic — the only priced rail) and needs one place — his existing `/admin` panel — to see every marketing plan, the brief behind it, and what each channel is actually producing. Today the panel shows grants and referral codes only, and the marketing site records **no channel** on a store click (`store_click.properties` has `ref`, `store`, `fbc/fbp`, `marketing_consent` — not the campaign slug), so nothing in the database can say "this click came from the Meta ads".

## 2. Decisions (do not re-open)

| # | Decision | Value |
|---|---|---|
| M1 | Codes are Brad's, never the agent's | Referral code words and App Store custom offer codes are chosen and created by Brad in `/admin` and ASC. They may be one per avenue or shared. Nothing in this milestone hard-codes, suggests or generates a code word; the UI links existing codes only. |
| M2 | Channel attribution = campaign slug | The web `CAMPAIGNS` slug on the landing route (`meta`, `ig`, `tt`, `uon`, `flyer`, `banner`, …) is the channel key everywhere: Apple `ct`, Play `utm_*`, and — new — `store_click.properties.campaign`. It works whether or not codes differ per avenue. |
| M3 | Referral codes stay attribution-only | D6 + amendment unchanged. Nothing here changes price or entitlement, and a grant does not lock a referral as a paid conversion. |
| M3a | Grants are access, not sales | Per the amendment: `founding_grants` rows are access grants (`grant_kind` `founding`/`complimentary`); `amount_minor`/`payment_*`/`paid_at` are an **optional contribution**, separate from access. The admin UI must label them "contribution", never "revenue" or "sales", and must never derive price, CAC or ROAS from them. |
| M4 | Marketing plans are admin-only data | New tables behind `adminGuard`, RLS enabled, no public read. Every mutation writes an `admin_audit_log` row in the same transaction (existing convention). |
| M5 | Off-platform numbers are hand-entered | Meta spend/impressions/clicks and ASC offer-code redemptions live outside our systems. Admin enters them as dated rows. No Meta Marketing API, no ASC API, no Stripe webhooks. |
| M6 | Nothing about the founding offer enters the mobile app | Apple 3.1.3(b). The store-offer CTA is web-only. Mobile is out of scope entirely. |
| M7 | Brief text lives in the plan row | `brief_md` (markdown, ≤ 64 KB) rendered read-only in the admin panel. Brad pastes the brief; agents do not author ad copy. |
| M8 | Existing routes and print slugs are immutable | Never rename/remove a `CAMPAIGNS` entry (print artwork depends on them). Adding `meta` is additive. |

## 3. Work packages, in order (one conventional commit each)

### WP1 — `meta` campaign slug (web)

`packages/web/src/marketing/config.ts`: add `meta: { ct: "meta", utm_source: "meta", utm_campaign: "founders" }` in the Social block with a one-line comment (paid Meta/Instagram placements; the organic bio link stays `ig`). Routes `/meta` and `/qr/meta` become live via `CAMPAIGN_LANDING_SLUGS`; `campaignWiring.test.tsx` and `edgeRedirect` tests must pass unchanged or be extended, not weakened.

### WP2 — channel on the store click (web + core)

Web: `reportStoreClick(store, campaign?)` in `packages/web/src/lib/storeClick.ts` gains an optional `campaign` (slug string) included in the beacon body; the callers are `AppStoreCta.tsx` (3 sites) and `PlayStoreCta.tsx` (2 sites) — both already sit under `CampaignContext`, so pass `useCampaign()`. Keep the body `text/plain` and under the 4 KB cap.

Core: `microservices/core/src/application/leads/leadsRoutes.ts` — `StoreClickBody.campaign?: string`; `parseBeaconBody` accepts `campaign` only if it matches `/^[a-z0-9-]{1,32}$/`; `storeClickEvent` copies it to `properties.campaign`. `analytics/metaEventMap.ts`: confirm `campaign` is **not** forwarded to Meta (only `value`/`currency` custom_data — memory `persistence-meta-capi-setup`); add a test asserting it is dropped. No PII, no new event names.

Tests: web (beacon body carries the slug from context; absent outside a provider), core (accepted / rejected slug, property written, Meta map excludes it).

### WP3 — store-offer CTA (web)

Config: `storeOffers` in `config.ts` — `{ ios?: string; android?: string }` redemption URLs read from `VITE_STORE_OFFER_IOS_URL` / `VITE_STORE_OFFER_ANDROID_URL` (add to `vite-env.d.ts`, `infra/web.ts`, both deploy workflows as optional vars; genuinely public values). Component `StoreOfferCta`: renders only when the URL for the visitor's platform is set (there is no client-side `isIOS()` in `packages/web/src` today — the platform sniff lives in the edge redirect; add a minimal, tested `platformFromUserAgent()` in `lib/`); goes through `reportStoreClick(store, campaign)` so it is still a `store_click`; copy is sentence case, states "renews at the standard price unless cancelled". Mount it on the marketing Home (hero + store section) **only when the route's campaign slug is in a `STORE_OFFER_CAMPAIGNS` allow-list** (`["meta"]` to start) so organic visitors keep the plain store CTA. Do **not** mount on `/founding` — that page is the off-app lane and must not mix rails. Do not touch mobile.

Tests: hidden when unset; shown on `/meta` on iOS UA; hidden on `/` ; beacon carries `campaign: "meta"`.

### WP4 — marketing plans schema (db)

Migration `supabase/migrations/2026MMDDHHMMSS_marketing_plans.sql` (idempotent, additive, RLS on, mirrored in `packages/db/src/schema.ts`):

```sql
marketing_plans (
  id uuid pk, name text not null, slug text not null unique check (slug ~ '^[a-z0-9-]{3,48}$'),
  status text not null default 'draft' check (status in ('draft','active','paused','complete')),
  objective text, hypothesis text, decision_rule text,
  offer_lanes text[] not null default '{}',          -- e.g. {'founding_access','store_offer'}
  store_offer_codes text[] not null default '{}',    -- ASC/Play code words Brad typed, display only
  budget_cap_minor integer check (budget_cap_minor is null or budget_cap_minor >= 0),
  currency text not null default 'GBP',
  starts_on date, ends_on date,
  brief_md text check (brief_md is null or length(brief_md) <= 65536),
  created_by uuid not null, created_at timestamptz default now(), updated_at timestamptz default now()
)
marketing_plan_channels (
  id uuid pk, plan_id uuid not null references marketing_plans(id) on delete cascade,
  campaign_slug text not null check (campaign_slug ~ '^[a-z0-9-]{1,32}$'),
  label text not null, placement text, notes text,
  unique (plan_id, campaign_slug)
)
marketing_plan_codes (                               -- codes linked to a plan; optionally pinned to one channel
  id uuid pk, plan_id uuid not null references marketing_plans(id) on delete cascade,
  referral_code_id uuid not null references referral_codes(id),
  campaign_slug text check (campaign_slug is null or campaign_slug ~ '^[a-z0-9-]{1,32}$'),
  unique (plan_id, referral_code_id)
)
marketing_plan_metrics (
  id uuid pk, plan_id uuid not null references marketing_plans(id) on delete cascade,
  campaign_slug text,                                 -- null = whole plan
  metric_date date not null,
  spend_minor integer check (spend_minor is null or spend_minor >= 0),
  impressions integer, clicks integer, landing_views integer,
  store_redemptions integer,                          -- ASC/Play offer-code redemptions, hand-entered
  notes text, recorded_by uuid not null, created_at timestamptz default now(),
  unique (plan_id, campaign_slug, metric_date)
)
```

`campaign_slug` is deliberately **not** an FK — the web `CAMPAIGNS` map is code, not a table. The admin UI validates against the list returned by the API (WP5).

### WP5 — admin API (core)

New handlers under `microservices/core/src/application/admin/marketing/`, mounted in `adminRoutes.ts`, all behind `adminGuard`, each mutation audited (`marketing_plan.create|update|status`, `marketing_plan_channel.add|remove`, `marketing_plan_metric.upsert`):

- `GET /admin/marketing/campaign-slugs` → the slugs the web knows (`meta`, `ig`, …). Source of truth is the web config; to avoid a cross-package import, ship a small shared list in `packages/db` or duplicate with a test in web asserting the two lists match (`campaignWiring.test.tsx` style). Pick the second unless a shared package is trivial.
- `GET /admin/marketing/plans?status=` → list rows with `channelsCount`, `spendMinor` (sum), `storeClicks` (count), `grants` (count).
- `POST /admin/marketing/plans`, `PATCH /admin/marketing/plans/:id` (fields incl. `briefMd`, `status`).
- `POST /admin/marketing/plans/:id/channels`, `DELETE …/channels/:channelId`.
- `POST /admin/marketing/plans/:id/codes` (link an **existing** referral code, optional channel pin), `DELETE …/codes/:linkId`. No code creation here (M1).
- `PUT /admin/marketing/plans/:id/metrics` (upsert by `(campaignSlug, metricDate)`).
- `GET /admin/marketing/plans/:id` → plan + channels + metrics + **derived attribution**, all scoped to `[starts_on, ends_on ?? today]`:
  - per channel: `store_clicks` = `analytics_events` where `event_name='store_click'` and `properties->>'campaign' = slug`; split by `properties->>'store'`; `store_clicks_with_code` where `properties->>'ref'` is any of the plan's linked codes.
  - per linked code: `referral_claims` = `referral_redemptions` for that code (count, locked count); `grants` = `founding_grants` with that `referral_code_id`, non-revoked, split by `grant_kind` and pending/applied, plus **optional contribution total** (`sum(amount_minor)` labelled "contributions", never "revenue"). Reuse `ReferralRepository` / `FoundingGrantRepository` methods where they exist; add scoped query methods rather than raw SQL (Drizzle only).
  - `registration_completed` has no channel — do not attribute it; show the plan-window total labelled "all sources" so Brad is not misled.

Repository: `microservices/core/src/application/repositories/marketingPlanRepository.ts`. Every read is admin-scoped, not user-scoped — that is correct here (there is no user), and `adminGuard` is the authorisation.

### WP6 — admin UI (web)

`packages/web/src/admin/pages/AdminMarketing.tsx` (list) and `AdminMarketingPlan.tsx` (detail); nav item "Marketing" in `AdminLayout.tsx` between "Referral codes" and "Lookup"; routes under the existing `/admin` `RequireAdmin` block in `App.tsx`; types + calls in `adminApi.ts`.

List: name, status badge, lanes, channels, dates, spend vs cap (progress), store clicks, grants. "New plan" form: name, slug (suggested from name like `suggestReferralCode`), lanes (checkboxes: founding access / store offer), store offer codes (free text Brad types, comma separated), budget cap, dates, objective, hypothesis, decision rule, brief (textarea, monospace). Codes are linked on the detail page from the existing referral-code list — the form never creates or suggests one.

Detail: header + status control (draft→active→paused/complete, audited); **Brief** panel rendering `brief_md` — `packages/web/package.json` has **no** markdown dependency today. Prefer a minimal in-repo renderer covering headings, paragraphs, lists, tables, code fences and bold/inline code as React elements (no raw HTML pass-through); only add a dependency if Brad approves it in the PR, and then pair it with sanitisation. **Never** `dangerouslySetInnerHTML` with unsanitised content. **Channels** table with add/remove (slug select from `/campaign-slugs`, label, placement). **Codes** table: link/unlink existing referral codes, optional channel pin. **Attribution** table per channel: store clicks (iOS/Android), clicks carrying a linked code, hand-entered spend/impressions/clicks/landing views/redemptions for the window, and a derived cost-per-store-click when both exist. **Per code**: referral claims (locked), grants by kind (pending/applied), contributions total labelled as such. **Plan totals** plus all-sources registrations (labelled "all sources"). **Weekly metrics** form: date, channel (or whole plan), spend, impressions, clicks, landing views, redemptions, notes — upsert. Copy is sentence case, no emojis; reuse `ui.tsx` primitives and the existing `formatMinor`/`formatDate`.

Tests: rendering, form validation, API mocking, status transition, metrics upsert — same depth as `AdminGrants`/`AdminCodes` tests.

### WP7 — docs, smoke test, ledger

- `specs/milestones/MARKETING-PLANS/` already holds `BRIEF.md` (this file), `MARKETING_BRIEF.md`, `EXECUTION_PLAN.md`, `CREATIVE_BRIEF.md`; add `SMOKE_TEST.md`: (a) visit `/meta?ref=<CODE>` on staging with consent granted → tap the store-offer CTA → one `analytics_events` row with `properties.campaign='meta'`, `ref='<CODE>'`, `store`; (b) `/` shows no store-offer CTA; (c) create plan → add channel `meta` → link the code → attribution shows that click; (d) upsert a metric row twice for the same date → one row; (e) non-admin JWT → 403 on every `/admin/marketing/*`; (f) audit rows present for each mutation; (g) `metaEventMap` never forwards `campaign`; (h) a `founding` grant with a linked code shows under that code with its contribution labelled "contribution".
- `STATE.md` session entry with gate output. Migration must be applied to staging before the core deploy (additive; safe to apply first).

## 4. Out of scope — do not start

Meta Marketing API / ASC API / RevenueCat API pulls; charts (tables only); editing referral codes from the plan page; Stripe; commission (spec-32 D–F); any mobile change; an `fbclid` → channel join; retention/cohort views; deleting plans (status `complete` instead); a public seat counter.

## 5. Handback — Brad, not the agent

- Merge `codex/auth-cardio-logging` first (or tell the agent to base on it).
- Choose the code word(s) — shared or per avenue — and create them in `/admin → Referral codes`.
- Create the ASC offer + custom code (pay-up-front, 6 months, new subscribers, max redemptions, expiry); redeem once end to end on a fresh Apple ID and confirm a `user_subscriptions` row exists (RC anonymous-id trap) **before** `VITE_STORE_OFFER_IOS_URL` is set in the `Production` GitHub environment.
- Set `VITE_STORE_OFFER_IOS_URL` (and Android if used) in `staging` first, run the smoke test, then `Production`.
- Apply the migration on staging → prod before the matching deploys.
- Create the plan in `/admin/marketing`, paste the brief, add channels `meta`, `ig`, `flyer`, `banner`, `uon`, link the code.
