# Founding website identity release

Approved approach: keep Stripe, require customer sign-in on the website before
new purchases, and verify the purchase email on the website for legacy pending
grants. The native app only reads its existing account's access. Do not add
in-app purchase claiming, promotional unlocking codes or purchase links.

## Customer contract

Show before sign-in: **Already use Persistence? Use the same account and sign-in
method as the app. If you use Apple with Hide My Email, choose Continue with
Apple. Do not create another account with your purchase email.**

Show the destination account before payment or verification and offer a way to
switch accounts. A receipt email is separate from account identity. Never merge
accounts, disclose the relay's destination, or transfer active access merely
because two addresses look related. Customers may retain Hide My Email.

New purchases activate on the authenticated account after successful payment.
Legacy purchases require both signed-in account ownership and a code sent to the
original purchase email. A failed or repeated verification must not consume a
different grant, change expiry or restore refunded access.

## Apple setup — required before release

On 20 September 2026, a read-only request to production Supabase's Apple
authorization endpoint returned HTTP 400: `Unsupported provider: missing OAuth
secret`. Native sign-in working does not establish browser sign-in readiness.
The earlier production setup runbook describes native-only configuration.

For each environment:

1. In Apple Developer, create a web Services ID and associate it with the same
   primary App ID as the native app. Production native ID:
   `com.bradleyevans96.persistence`; staging native ID:
   `com.bradleyevans96.persistence.staging`. Do not use a separate ungrouped app
   identity or invent an existing Services ID.
2. Configure the Services ID's website domain and return URL. The Apple return
   URL is the relevant Supabase project's `/auth/v1/callback`, not the website's
   final callback. Production project: `opcvjypsoivaxerahbal`.
3. Configure the Apple signing key/secret in Supabase Auth. Put the web Services
   ID first in the configured client IDs, retaining the existing native IDs.
   Supabase uses the first ID for OAuth and accepts listed native audiences.
   Keep private keys and generated secrets out of source control, browser
   configuration, logs and screenshots.
4. Add a narrowly scoped Supabase redirect allowlist entry for the actual
   website origin and `/founding/access/callback?flow=*`. The random `flow`
   query is part of our callback URL: allowing only the path can cause Supabase
   to reject it and fall back to SiteURL when the origins differ. Do not allow
   arbitrary hosts or all website paths. Keep existing app, voucher and admin
   callback URLs intact; verify the actual nonce-bearing callback is accepted.
   Confirm Google's existing provider also permits the new Supabase-to-website
   callback; the provider's own callback remains the Supabase callback.
5. Confirm the website deploy has its existing public Supabase URL and anon key
   for the same project used by that environment's native app.
6. Record the Apple OAuth secret expiry and arrange rotation before expiry
   (Apple secrets last at most six months). Browser OAuth requires this even
   though native ID-token sign-in does not.
7. Register the actual transactional/auth sending domains with Apple's private
   email relay, including any subdomains, and verify SPF/DKIM. This is necessary
   for messages addressed to relay accounts; it does not expose personal email.

These are dashboard settings, not accomplished by merging this PR. Do not
describe the feature as event-ready until the real account test below passes.

## Release evidence

Use dedicated test accounts and Stripe test mode. No customer purchase is a
test fixture. Brad controls native builds; this flow requires no native change.

| Scenario                                      | Required evidence                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Existing native Apple user with Hide My Email | Browser Continue with Apple returns exactly the same Supabase user UUID as native sign-in; no second profile is created. |
| New Apple user starts on website              | After payment, native sign-in reaches the same UUID and sees the correct tier and fixed expiry.                          |
| Different receipt email                       | Payment remains associated with authenticated UUID; receipt retains supplied email; no email-based reassignment.         |
| Legacy pending purchase                       | Signed-in Apple account plus purchase-mailbox code activates exactly the original grant once.                            |
| Wrong account                                 | Destination warning and Switch account work; switching clears claim state and cannot submit a code for the old account.  |
| Cancelled/expired sign-in                     | No checkout starts, no seat is reserved and retry returns to the selected plan.                                          |
| Payment/webhook retry                         | One grant and one subscription; original expiry is unchanged on replay.                                                  |
| Two tabs / changed receipt email              | No second concurrent checkout for the same account; no other account's checkout can be resumed.                          |
| Account becomes ineligible during checkout    | Paid purchase remains visible for admin resolution; no fallback to receipt-email account.                                |
| Refunded or already active legacy grant       | Verification cannot transfer or re-enable it.                                                                            |
| Account email/password and Google             | Existing account remains the destination; no regression to voucher or admin login.                                       |
| Sensitive page navigation                     | No marketing pixel on authentication, callback, checkout or claim inputs; callback code is removed from the address bar. |

Apply additive migrations through the normal release pipeline before deploying
dependent API code. Release backend and website together: the new checkout API
requires authentication, so the old anonymous website cannot create purchases.
Existing paid anonymous checkout sessions remain supported by the webhook.

Apple approval is not established by these functional tests. The relevant
published rule for access bought elsewhere is 3.1.3(b), subject to its conditions;
do not present an identity-verification code as an exception to payment rules.

References: [Supabase Apple configuration](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web),
[Apple relay setup](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service),
[App Review payment rules](https://developer.apple.com/app-store/review/guidelines/#business).
