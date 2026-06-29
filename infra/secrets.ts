export const databaseUrl = new sst.Secret("PersistenceDatabaseUrl");

// Stripe secrets — server-side keys, never exposed to the mobile client.
//
// `StripeSecretKey`     — Stripe API secret key (sk_live_… or sk_test_…). Used
//                          for outbound SDK calls (create subscription, cancel,
//                          retrieve customer, etc.) AND for verifying webhook
//                          signatures via `stripe.webhooks.constructEvent()`.
// `StripeWebhookSecret` — webhook endpoint signing secret (whsec_…). Issued by
//                          Stripe when the webhook endpoint is registered;
//                          rotates independently from the API key. Required
//                          for signature verification on POST /stripe/webhook
//                          — without it, an attacker could forge events that
//                          mutate user_subscriptions.
//
// Set per-stage from CI via `bunx sst secret set <name> "<value>" --stage <stage>`.
// See deploy-staging.yml + production-deploy.yml for the GH-environment wiring.
// Never file-commit values; never paste them into PR descriptions or logs.
export const stripeSecretKey = new sst.Secret("StripeSecretKey");
export const stripeWebhookSecret = new sst.Secret("StripeWebhookSecret");

// RevenueCat secrets (M12 — RevenueCat fronts both Apple IAP + Stripe).
//
// `RevenueCatWebhookSecret` — the static bearer secret RevenueCat sends in the
//                              `Authorization` header on POST /revenuecat/webhook.
//                              RevenueCat uses NO HMAC/payload signature, so this
//                              shared secret is the only thing standing between an
//                              attacker and forged entitlement-grant events.
// `RevenueCatApiKey`         — secret REST API key (`sk_…`), server-side only.
//                              Used to re-fetch a customer's active entitlements
//                              after each webhook (the authoritative read).
// `RevenueCatProjectId`      — the RevenueCat project id for the v2 REST paths.
//
// Set per-stage from CI via `bunx sst secret set <name> "<value>" --stage <stage>`.
// Never file-commit values; never paste them into PR descriptions or logs.
export const revenueCatWebhookSecret = new sst.Secret(
  "RevenueCatWebhookSecret",
);
export const revenueCatApiKey = new sst.Secret("RevenueCatApiKey");
export const revenueCatProjectId = new sst.Secret("RevenueCatProjectId");

// Expo Push access token (09.9 / A3 — push delivery).
//
// `ExpoAccessToken` — OPTIONAL. The Expo Push API (https://exp.host/--/api/v2/push/send)
//                     accepts unauthenticated sends UNLESS "Enhanced Security
//                     for Push" is enabled on the Expo account, in which case
//                     it must be sent as a Bearer. The send client
//                     (`expoPushClient.ts`) omits the Authorization header when
//                     the value is empty/unset, so an empty secret is valid and
//                     deploys must NOT fail-fast on it (unlike the secrets
//                     above). Set per-stage from CI; leave empty unless Brad has
//                     turned Enhanced Security on in the Expo dashboard.
export const expoAccessToken = new sst.Secret("ExpoAccessToken");

// Supabase service-role key — server-side only, NEVER shipped to the client.
//
// `SupabaseServiceRoleKey` — the Supabase project's service-role API key. Used
//                            solely by the `DELETE /account` endpoint to remove
//                            the `auth.users` record via the Admin REST API
//                            (`DELETE /auth/v1/admin/users/{id}`), which the
//                            anon/JWT context cannot do. Required for App Store
//                            Guideline 5.1.1(v) in-app account deletion.
//
// Set per-stage from CI / locally via
//   `bunx sst secret set SupabaseServiceRoleKey "<service_role_key>" --stage <stage>`.
// Never file-commit the value; the repo is public.
export const supabaseServiceRoleKey = new sst.Secret("SupabaseServiceRoleKey");
