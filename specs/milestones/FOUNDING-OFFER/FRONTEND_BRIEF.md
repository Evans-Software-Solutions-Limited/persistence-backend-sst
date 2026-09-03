# FOUNDING-OFFER — frontend brief (web + mobile)

Read `BRIEF.md` first. Backend contract is in `BACKEND_BRIEF.md § 4`.

## Web (`packages/web`) — ships first

### W1. Supabase auth for the admin area

- Add `@supabase/supabase-js` to web; client in `src/lib/supabase.ts` from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (add to `infra` web env per `sst-resource-change` skill; staging + production values).
- `/admin/login`: email → `signInWithOtp` (magic link) → `/admin/callback` exchanges the hash for a session. Reuse `AuthCallback.tsx` patterns. `noindex`, not in sitemap, not in nav.
- `src/lib/adminApi.ts`: thin fetch wrapper adding `Authorization: Bearer <access_token>` to `VITE_CORE_API_URL`. Do **not** use `eden.ts` (`treaty<CoreApi>` is at the TS2589 ceiling).
- `<RequireAdmin>` route guard: no session → `/admin/login`; session but first `/admin/summary` returns 403 → "This account isn't an admin" page. The server is the authority; the guard is UX only.

### W2. Admin pages (route prefix `/admin`, own minimal layout — not `MarketingLayout`)

1. **Dashboard** — seat meters (consumer used/200, coach used/20), revenue recorded, grants by tier, top codes by claims/paid, last 10 grants. Data from `GET /admin/summary`.
2. **Founding grants** — table (email, tier, amount, method, reference, code, paid at, expires, status) + **New grant** form: email (live lookup via `GET /admin/users?email=` showing current sub + attribution + role warning), tier (radio: Premium £30 / Premium+ £50 / Start Up Coach+ £99, amount prefilled but editable), method, reference, paid date (default today), referral code (optional, validated against the codes list), notes. Confirm dialog shows exactly what will be created; success shows seats remaining. Row action: **Revoke** (reason required).
3. **Referral codes** — table with status, kind, partner, claims / cap, grants, paid; create form (code auto-suggest from label, e.g. `UONFRESHERS`), pause/archive, edit limits/dates; detail drawer listing redemptions; **Copy link** producing `https://<site>/qr/<campaign_slug or 'default'>?ref=<CODE>`.
4. **User lookup** — email search → account, subscription, attribution, founding grant, with actions "Set attribution" and "New grant".
5. **Audit log** — filterable by entity.

Design: use the existing web tokens (`marketing.css` variables) but a dense utility layout; dark/light both. Every table has empty and error states. No health/training data is ever fetched or shown.

### W3. Marketing site

- `?ref=<CODE>` on any marketing route: persist to `sessionStorage` (`persistence.ref`), include as `properties.ref` on the existing `store_click` event (`storeClick.ts`), and render a small banner "Referral code **CODE** noted — enter it in the app after you sign up." Never call the backend to validate on the marketing site (keeps validation rate-limited to signed-in users).
- Founding-offer section on Home + `/founding` landing route: the two consumer prices, the coach line, "X of 200 places" (number from `import.meta.env.VITE_FOUNDING_SEATS_USED` at build time for v1 — a live public counter endpoint is a follow-up), what the money funds, how redemption works ("pay, then sign in to the app with the same email — Premium is on within a day"), bank details + Stripe Payment Link buttons, 14-day cancellation acknowledgement text, T&Cs link. Copy: sentence case, no emojis, confident; the birthday line is one sentence, the body is about the product.
- Tests: route guard, `?ref` capture, store_click property, forms' validation; typecheck/lint/build/unit green.

## Mobile (`packages/mobile`) — next app release

Port discipline (CLAUDE.md) applies to existing screens: additions below are the **only** deviations, each explicitly approved by BRIEF D8.

### M1. Domain + adapter

- `domain/models/referral.ts` (`AppliedReferral`), `domain/ports/referrals.port.ts`, API adapter for `POST /referrals/claim`, `GET /referrals/me`, `DELETE /referrals/me` following the existing ports/adapters seam.
- Hooks `useAppliedReferral`, `useClaimReferral` (react-query keys `['referral', userId]`).

### M2. Onboarding (spec-31 journey)

- On the final onboarding step add an optional collapsed row **"Have a referral or partner code?"** → inline input (upper-cases as typed, 4–24 chars) + Apply. Success shows "Applied: <label>"; failure shows the server's neutral message. **Continue/Skip never depend on it**; a claim in flight is cancelled silently on Skip. Claim happens immediately on Apply, not on completion.

### M3. Subscription Selection

- Beneath the tier cards: applied state "Referral: <label> · Change" or the same entry row as M2. Keep it visually and semantically separate from any store **Redeem offer code** action; a referral never alters displayed prices (which remain StoreKit/Play via RevenueCat).
- If `lockedAt` is set, show read-only "Referral: <label>".

### M4. Founding members (no new UI)

- Verify the existing "cancelled — active until <date>" banner and the post-expiry gate copy read correctly for a founding row (`cancelledAt` set, `paymentStatus='active'`, `expiresAt` +6 months). Adjust only the copy string if it says "cancelled" in a way that would confuse a founding buyer; propose wording to Brad before changing.

### M5. Tests

Jest suites for the hooks, the onboarding row (does not block Continue/Skip), Subscription Selection applied/locked states, and neutral error rendering. Mobile typecheck/lint/test green; device check on iOS + Android for the two entry points.
