# Business vouchers release notes

Implemented on `codex/business-vouchers-admin`. Database/backend/web release only; no native code or app build. Business payment collection remains manual.

## Operations

Create a batch under Admin → Business vouchers. Choose business/reference, quantity, Premium or Premium+, months, optional claim deadline, optional exact domains and optional employee email assignments. Blank domain policy allows open domains. An exact email assignment is independent; where both are set, both must match.

Download the distribution CSV immediately after issuance and confirm it is saved. The server stores hashes and cannot regenerate plaintext codes. Pending receipts are temporarily recoverable in the same browser tab for the same admin for up to 24 hours, then expire; explicit saved acknowledgement removes that receipt. Use the business reference for invoice attribution. Subsequent audit exports contain identifiers, restrictions, both redeemed emails and status, not voucher secrets. CSV assignments validate the entire import before applying it.

Give employees the website `/redeem` URL and their individual code. They may sign in or create a normal verified account. The default is one email for eligibility and membership. With a different membership account, they must authenticate that account and verify a short-lived numeric code at their eligibility email. Final confirmation names both addresses. Membership starts at redemption, does not auto-renew, and appears in the existing app after sign-in/onboarding and subscription refresh.

A used code remains used permanently, including after account deletion or membership expiry. Revocation applies only to unused codes and does not cancel active access. Live paid memberships, live prepaid access, incompatible roles and unapplied grants are rejected without consuming the code. Completed request retries are supported for 30 days. Bounded request-path cleanup removes expired temporary proofs/counters while preserving redemption audit history.

## Release sequence

1. Apply `supabase/migrations/20260914143040_business_vouchers.sql` through the normal migration workflow. Private RLS tables, constraints, indexes and the redeemed-record immutability trigger must be present before backend rollout.
2. Deploy core and web using the existing environment configuration. Core uses the existing transactional Resend configuration. Web requires `VITE_CORE_API_URL`, `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_ANON_KEY` for the matching environment.
3. Add the exact HTTPS `<web-origin>/redeem/callback` to that environment's Supabase Auth redirect allowlist. Keep the mobile Site URL and `persistencemobile://auth/callback`, and existing `/admin/callback`, unchanged. Keep account email confirmation enabled.
4. On staging, issue a small test batch and verify real email delivery, signup confirmation, existing-account password/email-link sign-in, same-email redemption, restricted work email to personal account, conflict/replay handling and CSV distribution.
5. Sign in to the currently released mobile app with the redeemed account, finish onboarding if new, refresh/reopen and confirm tier/expiry. Check that normal mobile email login and admin login still route correctly. No native build is part of this checklist.
6. Review staging evidence before the normal production release; repeat a controlled smoke test there.

Live email delivery and physical-device verification were not performed in this local review task. Do not treat synthetic browser previews as a deployed end-to-end test.

## Rollback

Rollback application versions if necessary, but retain voucher tables, immutable redeemed rows and existing subscriptions after any issuance/redemption. Do not drop or reset voucher history: doing so could lose paid access attribution or enable reuse. Stop distributing unused codes while a backend rollback is in effect.
