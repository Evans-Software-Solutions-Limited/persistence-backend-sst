# Implementation contract

All responses use `{ data: ... }`; failures `{ message, code? }`. Admin calls use existing admin bearer auth. Redemption calls require a verified Supabase destination-account bearer token. The UI first collects voucher/eligibility details, then authenticates the membership account, then prepares/verifies/redeems. Account authentication is separate from employee eligibility proof; no anonymous account creation by the API.

## Admin

- `GET /admin/voucher-batches?q=` → `data: Batch[]`
- `POST /admin/voucher-batches` body `{ businessName, reference?, quantity, tierName: GrantableTierId, months, allowedDomains: string[], redeemBy: ISO|null, employeeEmails?: string[] }` → `data: { batch: Batch, codes: IssuedCode[] }`. Employee-email list is optional; when supplied length equals quantity (empty entries mean unassigned). Hash-only voucher storage: plaintext random codes are returned once, with an explicit download-now UX. Maximum 500 per batch.
- `GET /admin/voucher-batches/:id` → `data: { batch: Batch, vouchers: Voucher[] }`
- `PATCH /admin/voucher-batches/:id/vouchers/:voucherId` body `{ employeeEmail: string|null }` → `data: Voucher`. Only unused code assignments may change.
- `POST /admin/voucher-batches/:id/assignments` body `{ assignments: { voucherId, employeeEmail: string|null }[] }` → `data: { updated: number }`. Atomic CSV assignment with duplicate/conflict validation.
- `POST /admin/voucher-batches/:id/revoke` body `{ reason }` → `data: { revoked: number }`. Revokes unused vouchers only.
- `POST /admin/voucher-batches/:id/vouchers/:voucherId/revoke` body `{ reason }` → `data: { revoked: number }`.
- `POST /admin/voucher-batches/:id/export-audit` → `data: { recorded: true }` (record distribution export; never return stored codes).

`Batch`: `{ id, businessName, reference: string|null, tierName, months, allowedDomains: string[], redeemBy: string|null, createdAt: string, counts: { issued, unused, redeemed, expired, revoked } }`.

`Voucher`: `{ id, batchId, codeHint, employeeEmail: string|null, status: 'unused'|'redeemed'|'expired'|'revoked', eligibilityEmail: string|null, accountEmail: string|null, accountId: string|null, redeemedAt: string|null, expiresAt: string|null }`.

`IssuedCode`: `{ id, code, employeeEmail: string|null }`.

## Employee redemption

- `POST /vouchers/prepare` body `{ code, eligibilityEmail }` → `data: Challenge`. Hash lookup validates code/status/deadline/restrictions, verified destination account and persistent rate limits. If verified account email matches eligibility email, set `verified: true`; otherwise send a one-time numeric verification code to the eligibility mailbox. Delivery failure is a retryable error, never a fake success. No voucher is consumed.
- `POST /vouchers/verify` body `{ challengeId, otp }` → `data: Challenge`. Rate/attempt limited server-side, challenge bound to account ID, voucher and eligibility email, one-time proof. Invalid responses neutral.
- `POST /vouchers/redeem` body `{ challengeId }` → `data: Redemption`. Atomically check proof/deadline/status/restrictions/account conflicts and create subscription + permanent redemption. Exact completed request replay by its bound account returns the same result; no extra entitlement.

`Challenge`: `{ challengeId, verified: boolean, eligibilityEmail, accountEmail, businessName, tierName, months, expiresAt: string }`.

`Redemption`: `{ voucherId, businessName, tierName, months, eligibilityEmail, accountEmail, expiresAt: string }`.

Authentication or email changes invalidate client challenge state. Server rechecks destination account email/verification before completion. Browser account tokens use dedicated redemption storage and never admin storage. Signup/password sign-in use Supabase REST and explicit `/redeem/callback`; no mobile Site URL change. No access tokens in analytics or retained URL history. Eligibility OTP messages use existing Resend delivery; numeric OTPs prevent email scanner consumption. An authenticated employee need not create a second Supabase identity for their work mailbox.

Completed redemption challenge retries return the original result for 30 days. Permanent redeemed voucher records never expire or become reusable. Authenticated voucher requests opportunistically remove bounded batches of expired counters and proofs; no scheduled infrastructure is required.

`GrantableTierId` is one of `premium`, `premium_plus`, `individual_trainer`, `start_up_coach_plus`, `coach`, `coach_pro`. Grant/voucher duration is an integer from 1 to 120 months. Shared membership catalogue exports define this set; unsupported organisation plans and Free are not grant products.

`GET /admin/founding-grants/catalogue` retains `offers` for the founding campaign and adds `grantableTiers: [{tierName,label,isTrainerTier,months}]` for individual complimentary grants. Founding requests remain restricted to the campaign offers; complimentary requests accept all six supported tiers. Existing role-change confirmation still applies to individual grants.
