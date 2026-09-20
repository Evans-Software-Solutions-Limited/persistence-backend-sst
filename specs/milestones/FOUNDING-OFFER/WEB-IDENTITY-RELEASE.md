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
3. Populate the GitHub environment settings below. The deployment workflow
   validates them before mutations, then applies the Apple provider settings
   through Supabase's Management API before deploying the website. It puts the
   web Services ID first, preserves existing native IDs, and retains the
   required native ID for that environment.
4. The same step adds the exact website callback
   `/founding/access/callback?flow=*` to Supabase's redirect allowlist, preserving
   existing app, voucher and admin callbacks. The random `flow` query is part of
   the URL. Google's existing provider can use this same Supabase-to-website
   callback; its upstream provider callback remains the Supabase callback.
5. The website uses the existing public Supabase key and stage-derived URL for
   the same project as the native app. Never put an Apple secret or Supabase
   service-role key into a `VITE_*` variable.
6. Record the Apple OAuth secret expiry and replace the GitHub secret, then
   redeploy before expiry (Apple client secrets last at most six months).
   Browser OAuth requires this even though native ID-token sign-in does not.
7. Register the actual transactional/auth sending domains with Apple's private
   email relay, including any subdomains, and verify SPF/DKIM. This is necessary
   for messages addressed to relay accounts; it does not expose personal email.

Apple Developer setup and GitHub values must be supplied before deploying.
Merging does not create the Apple Services ID or key. Deployment fails rather
than silently shipping unconfigured sign-in when required values are missing.
Populate `staging` before merging (main automatically deploys staging), and
`Production` before publishing the release.
Do not describe the feature as event-ready until the real account test below passes.

## GitHub environment values

In repository **Settings → Environments**, configure both `Production` (capital
P) and `staging`. Do not paste secret values into PRs or chat.

A read-only name check on 20 September 2026 found `VITE_SUPABASE_ANON_KEY`
already present as a variable in both environments, alongside the existing
Supabase secrets below. Only `APPLE_SERVICES_ID` and `APPLE_CLIENT_SECRET` are
new names. Production also has a same-named public-key secret; the workflow
uses the **variable**, so changing only that duplicate secret has no effect.
Secret contents were not read or validated in this check.

| Kind              | Name                     | Production value                                                                                      | staging value                                                                   |
| ----------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Variable          | `VITE_SUPABASE_ANON_KEY` | Production project's **anon** JWT or **publishable** API key                                          | Staging project's **anon** JWT or **publishable** API key                       |
| Variable          | `APPLE_SERVICES_ID`      | Actual web Services ID created in Apple Developer, associated with `com.bradleyevans96.persistence`   | Actual web Services ID associated with `com.bradleyevans96.persistence.staging` |
| Secret            | `APPLE_CLIENT_SECRET`    | Apple-generated/signed client-secret JWT whose subject is the production Services ID                  | Separate JWT whose subject is the staging Services ID                           |
| Secret (existing) | `SUPABASE_ACCESS_TOKEN`  | Supabase management access token with permission to read and update this project's Auth configuration | Token authorized for staging Auth configuration                                 |
| Secret (existing) | `SUPABASE_PROJECT_REF`   | `opcvjypsoivaxerahbal`                                                                                | `nxkhlrvjxotyjulodxzk`                                                          |

The public API key is the same client key used by the corresponding mobile app,
available in Supabase **Project Settings → API Keys**. Never use `service_role`
or an `sb_secret_…` key. A publishable key is public, despite containing “key”.
`SUPABASE_ACCESS_TOKEN` is a management token, not an anon or service-role key;
its existing database deployment permissions must also remain intact. For
fine-grained tokens, add `auth_config_read`, `auth_config_write` and `project_admin_write` permissions.
Keep the existing database password, service-role key and other deployment
secrets unchanged.

Suggested **new** Services IDs, if available, are
`com.bradleyevans96.persistence.web` and
`com.bradleyevans96.persistence.staging.web`. These are proposed names, not IDs
already provisioned. Set the variable to the exact ID you actually register.
Generate each client-secret JWT using that Services ID, your Apple Team ID,
Sign in with Apple Key ID and `.p8` private key. Supabase's Apple setup guide
links a browser-local generator. Store only the resulting JWT as
`APPLE_CLIENT_SECRET`; this workflow does not need the `.p8`, Team ID or Key ID
in GitHub. Existing `ASC_API_KEY`/`ASC_API_KEY_ID` values are App Store Connect
credentials; they are not the Sign in with Apple client secret. Generation/expiry
validation is not proof Apple will accept the key:
complete the real login smoke test.

| Apple web setup | Production                                                  | staging                                                     |
| --------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Website domain  | `persistence.evans-software-solutions.com`                  | `staging.persistence.evans-software-solutions.com`          |
| Return URL      | `https://opcvjypsoivaxerahbal.supabase.co/auth/v1/callback` | `https://nxkhlrvjxotyjulodxzk.supabase.co/auth/v1/callback` |

No GitHub `VITE_SUPABASE_URL`, Apple private-key variable, or `VITE_APPLE_*`
secret is needed. The website URL and callback allowlist are derived from the
same checked-in stage configuration as the backend.

The workflow performs local validation with `--check`, then GET/PATCH/GET of
Supabase Auth configuration during deployment. It logs only success or sanitized
errors, never the provider response or secret. No configuration has been applied
by the PR itself. A deploy reapplies GitHub's Apple settings; update the GitHub
secret before deploying if it was rotated manually in Supabase.

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
