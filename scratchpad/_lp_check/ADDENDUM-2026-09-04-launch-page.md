# MARKETING-PLANS — addendum 2026-09-04: launch-offer landing page and requests

Decided by Brad on the evening of 4 Sep 2026 after PR #435 merged. This addendum amends `BRIEF.md`, `MARKETING_BRIEF.md` and `EXECUTION_PLAN.md` in this folder; where they conflict, this file wins. It will be committed alongside `LANDING_PAGE.md` (the approved strategy + copy) in a follow-up docs PR.

## Decisions

| #   | Decision                                                             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Cold Meta traffic lands on the rebuilt `/founding` launch-offer page | Primary conversion is a **launch-access request form** (Meta `Lead` event, consent-gated, deduped browser↔CAPI via the existing `useLeadSubmit` / `lead_captured` path). The Apple offer-code CTA becomes **secondary** ("Already sure? Get the app") on the same page for iOS visitors when `VITE_STORE_OFFER_IOS_URL` is set, still routed through `reportStoreClick`. `/meta` remains a valid campaign landing route but is no longer the primary ad destination. |
| A2  | Requests are stored and reviewable                                   | New `founding_requests` table + `POST /leads/founding` + `/admin/requests` list with status `new / contacted / granted / declined` and a **Grant** action that opens the existing New Grant form pre-filled (email, tier). Admin email via Resend still sent.                                                                                                                                                                                                        |
| A3  | Campaign slug stays the attribution key                              | UTMs are a mirror for Meta's own reporting only. The request row and the `lead_captured` event carry `campaign` (slug from `useCampaign()`) and `ref` (from `storedReferralCode()`), exactly as `store_click` will after WP2.                                                                                                                                                                                                                                        |
| A4  | Copy is produced in Cowork first, then handed to the build           | `LANDING_PAGE.md` (strategy, final copy, form states, wireframe, message map, A/B tests, SEO/social, handoff) is written and approved by Brad before WP9 starts. The coding agent implements it verbatim and does not write marketing copy.                                                                                                                                                                                                                          |
| A5  | Truthful CTA                                                         | The form CTA must not imply a guaranteed place: "Request launch access" / "Request your place" / "Join the launch" are acceptable; "Claim your spot" is not. Success copy explains review + confirmation email; it never says access is active.                                                                                                                                                                                                                      |
| A6  | Ads objective                                                        | With a `Lead` conversion on the destination, week 1 runs the **Leads** objective optimising for `Lead` (memory `persistence-meta-ads-strategy` preferred this from the start). Landing-page-views remains the fallback if `Lead` volume is too thin to exit learning.                                                                                                                                                                                                |
| A7  | Page must respect the grant-model amendment without sounding like it | No prices, no purchase flow, no grant/entitlement/database language, no "allocated personally". Availability from `GET /founding/availability` may be shown only as a designed scarcity element, never as a raw counter, and only if `LANDING_PAGE.md` keeps it. Contribution / crowdfunding, if mentioned at all, sits in a low-priority FAQ with the "separate from access" distinction intact.                                                                    |

## New work packages (append to `BRIEF.md § 3`; same gates)

### WP8 — launch-access requests (db + core + admin)

Migration (additive, RLS on, mirrored in `schema.ts`):

```sql
founding_requests (
  id uuid pk, created_at timestamptz default now(),
  email text not null check (email = lower(email)), first_name text,
  interest text not null check (interest in ('premium','premium_plus','start_up_coach_plus')),
  goal text,                              -- "What are you looking to achieve?" optional, ≤ 1000 chars
  referral_code text,                     -- normalised, optional; attribution only
  campaign_slug text check (campaign_slug is null or campaign_slug ~ '^[a-z0-9-]{1,32}$'),
  marketing_consent boolean not null default false,
  status text not null default 'new' check (status in ('new','contacted','granted','declined')),
  status_reason text, grant_id uuid references founding_grants(id) on delete set null,
  reviewed_by uuid, reviewed_at timestamptz,
  event_id text, fbc text, fbp text
)
```

Core: `POST /leads/founding` in `leadsRoutes.ts` following the `/leads/coach` shape exactly — CORS stamp, `leads` rate-limit bucket, honeypot, Turnstile, bounded input, `emitEvent(leadCapturedEvent("founding", …))` with `campaign` and `ref` added to the event properties, insert the row, then best-effort `sendEmail` to `RESEND_NOTIFICATION_TO` (subject "New launch access request", body: name, email, interest, goal, code, campaign). Optionally add the contact to the athletes Resend audience only when `marketing_consent` is true. Duplicate email with status `new` → 200 with the same success body (no enumeration), row not duplicated.

Admin: `GET /admin/requests?status=`, `PATCH /admin/requests/:id` (status + reason, audited as `founding_request.status`), and the **Grant** action: navigates to the existing New Grant form with email/tier pre-filled; on successful grant, the request is marked `granted` with `grant_id` (audited). `/admin/requests` nav item "Requests" between "Founding grants" and "Referral codes". Dashboard summary gains `newRequests` count.

Tests: route (validation, honeypot, Turnstile reject, rate limit, dedupe, event properties), repository, admin handlers (403 non-admin, status transitions, audit rows), UI (list, filter, Grant pre-fill, status change).

### WP9 — launch-offer landing page (web) — starts only when `LANDING_PAGE.md` is approved

Rebuild `packages/web/src/pages/Founding.tsx` to the section wireframe and copy in `LANDING_PAGE.md`, inside `MarketingLayout` so `?ref=` capture and the campaign slug keep working. Form component `FoundingRequestForm` built on the existing `LeadForms.tsx` patterns (`useLeadSubmit`, Turnstile widget, honeypot, consent checkbox, `trackLead(eventId)`), posting to `/leads/founding` with `campaign` + `ref`. Interaction states exactly as specified (idle, validating, submitting, success, error, rate-limited). Secondary store-offer CTA (A1) reuses WP3's `StoreOfferCta`. Update `Founding.test.tsx` for the new sections and states; keep the old assertions that no payment CTA, bank details or price literals render on this page. SEO/social meta from `LANDING_PAGE.md`. Privacy policy: check the request-data categories are covered by the existing lead-form wording; if not, add one sentence to the web copy only (the cookies/lead section is the sanctioned divergence — do not touch the mobile copy).

Smoke test additions: (j) submit a request on staging with consent → row in `founding_requests` with `campaign` and `ref`, `lead_captured` event, admin email received, request visible in `/admin/requests`; (k) Grant from the request → grant created, request `granted`, audit rows; (l) submit without consent → row stored with `marketing_consent=false`, no Meta forwarding; (m) honeypot filled → 200, nothing stored.

## Sequencing change

1. Claude Code session A (now): WP1–WP8 on `feat/marketing-plans`. Do not start WP9.
2. Cowork (now, in parallel): produce `LANDING_PAGE.md`; Brad approves.
3. Docs PR: this addendum + `LANDING_PAGE.md` into `specs/milestones/MARKETING-PLANS/`.
4. Claude Code session B: WP9 on the same branch (or a follow-up branch if A has merged).
5. Meta test window shifts to start when WP9 is live on prod — target 12 Sep, still inside the 30 Sep Shipaton window.

## Inputs still needed from Brad for `LANDING_PAGE.md`

Listed in that document's § 14 once drafted; expect: current app screenshots (Home, Train, You, coach client list), the three tiers' feature boundaries as they read on `/pricing`, the founder photo/video assets available, the redemption window you're comfortable stating for a confirmed place, and whether availability should be shown at all.
