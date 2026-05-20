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
