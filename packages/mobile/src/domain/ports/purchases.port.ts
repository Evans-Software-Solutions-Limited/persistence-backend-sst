import type { Result } from "@/shared/errors";
import type {
  BillingCycle,
  SubscriptionTierName,
} from "@/domain/models/subscription";

/**
 * PurchasesPort — RevenueCat-fronted native IAP (M12, iOS-only rail).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md
 *
 * RevenueCat (`react-native-purchases`) owns receipt validation, renewals,
 * refunds and grace periods; the backend webhook keeps `user_subscriptions`
 * (the entitlement authority) in sync. The mobile client only needs to:
 *
 *   1. configure the SDK with the **public** iOS SDK key (client-safe),
 *   2. bind identity — App User ID **MUST equal the Supabase user id** so a
 *      user's entitlements merge across rails (the load-bearing rule),
 *   3. read the `default` offering's packages, present them, run a purchase,
 *      and read back the resulting active entitlements,
 *   4. restore purchases (Apple requirement).
 *
 * Implementations:
 *   - `RevenueCatPurchasesAdapter` (prod, `adapters/purchases/revenuecat.adapter.ts`)
 *   - `MockPurchasesAdapter` (tests, `adapters/purchases/__tests__/mock.adapter.ts`)
 *
 * iOS-only: the production adapter is constructed solely on iOS (web / Android
 * keep the Stripe rail), so `Adapters.purchases` is optional and absent on
 * other platforms. Consumers gate on its presence via `usePurchases`.
 */

/**
 * Discriminator for `PurchasesError`.
 *
 * - `cancelled` — user dismissed the native purchase sheet. The flow clears
 *   the in-flight selection silently (no alert), mirroring the Stripe path.
 * - `not_configured` — `configure` hasn't run (missing SDK key in dev). The
 *   flow surfaces an inline "unavailable" state rather than crashing.
 * - `network` — transient connectivity / store-comms failure; retryable.
 * - `store_problem` — App Store returned an error (product not available,
 *   payment declined, etc.). Surfaced to the user.
 * - `purchase_not_allowed` — device disallows purchases (parental controls).
 * - `unknown` — anything else.
 */
export type PurchasesErrorKind =
  | "cancelled"
  | "not_configured"
  | "network"
  | "store_problem"
  | "purchase_not_allowed"
  | "unknown";

export interface PurchasesError {
  readonly kind: PurchasesErrorKind;
  /** RevenueCat `PURCHASES_ERROR_CODE` string when present. */
  readonly code: string | null;
  readonly message: string;
}

/**
 * A purchasable package, normalised from a RevenueCat `PurchasesPackage` into
 * the fields the UI needs. `tier` + `billingCycle` are derived from the store
 * product identifier (see `domain/services/purchaseOfferings`) so the iOS
 * paywall can match a package to the tile the user tapped.
 */
export interface PurchaseProduct {
  /** RevenueCat package identifier within the offering (e.g. `$rc_monthly`). */
  packageId: string;
  /** Store product identifier (e.g. `app.persistence.premium.monthly`). */
  productId: string;
  /** The tier this package unlocks; `null` when the id isn't recognised. */
  tier: SubscriptionTierName | null;
  billingCycle: BillingCycle;
  /** Localised, currency-formatted price for display (e.g. `£9.99`). */
  priceString: string;
}

/**
 * One active entitlement read from `CustomerInfo.entitlements.active` after a
 * purchase / restore. `tier` is `null` for an entitlement id we don't model
 * (forward-compatible). The server webhook remains the source of truth; this
 * is only used for the optimistic post-purchase UX.
 */
export interface ActiveEntitlement {
  entitlementId: string;
  tier: SubscriptionTierName | null;
  productId: string | null;
  /** ISO timestamp, or `null` when the store reports no expiry. */
  expiresAt: string | null;
}

export interface PurchasesPort {
  /**
   * `true` once `configure` has run with a non-empty SDK key. The iOS flow
   * gates on this so a missing dev key degrades to an inline "unavailable"
   * state instead of throwing on the first SDK call.
   */
  isConfigured(): boolean;

  /**
   * Configure the SDK with the **public** iOS SDK key. Idempotent — safe to
   * call more than once; a no-op after the first successful configure. An
   * empty key is a no-op (leaves `isConfigured()` false).
   */
  configure(publicSdkKey: string): void;

  /**
   * Bind App User ID to the Supabase user id. Called after auth resolves and
   * before any purchase. No-op-safe when not configured.
   */
  logIn(appUserId: string): Promise<Result<void, PurchasesError>>;

  /** Reset to an anonymous RevenueCat id. Called on sign-out. */
  logOut(): Promise<Result<void, PurchasesError>>;

  /**
   * Fetch the `default` offering's packages, normalised. Empty array when no
   * offering / packages are configured yet (e.g. tiers cowork hasn't attached
   * Apple products to). The promise resolves `ok` even when empty.
   */
  getPurchasablePackages(): Promise<Result<PurchaseProduct[], PurchasesError>>;

  /**
   * Run the native purchase sheet for `packageId` and return the resulting
   * active entitlements. User cancellation → `fail` with kind `cancelled`.
   */
  purchase(
    packageId: string,
  ): Promise<Result<ActiveEntitlement[], PurchasesError>>;

  /** Restore prior purchases; returns the resulting active entitlements. */
  restore(): Promise<Result<ActiveEntitlement[], PurchasesError>>;
}
