import type { Result } from "@/shared/errors";

/**
 * PaymentsPort — Apple-Pay-direct subscription flow.
 *
 * Spec: specs/11-payments-subscriptions/design.md § PaymentsPort
 * Satisfies: requirements.md AC 2.1, 2.2, 2.5, 2.7, 7.3, 8.1
 *
 * Replaces the legacy stub (`initializePaymentSheet` /
 * `presentPaymentSheet`) — V2 collects a Stripe `payment_method_id`
 * directly via Apple Pay's biometric sheet, then the backend creates
 * the subscription using that token. No PaymentSheet, no Checkout, no
 * Customer Portal.
 */

/**
 * Discriminator for `PaymentError`. UI handles each kind differently:
 *
 * - `cancelled` — user dismissed the Apple Pay sheet. Selection screen
 *   silently clears the in-flight tier; no alert.
 * - `platform_unavailable` — iOS device with no Apple Wallet card OR
 *   Apple Pay unsupported on the platform. Mirrors legacy's inline
 *   "Apple Pay only on iOS devices" error state.
 * - `no_payment_methods` — Apple Wallet is empty. Distinct from
 *   `platform_unavailable` so the UI can suggest adding a card.
 * - `stripe_error` — Stripe SDK returned a recognised error. UI shows
 *   the message in an alert.
 * - `unknown` — everything else. Should be rare; falls through to
 *   alert.
 */
export type PaymentErrorKind =
  | "cancelled"
  | "platform_unavailable"
  | "no_payment_methods"
  | "stripe_error"
  | "unknown";

export interface PaymentError {
  readonly kind: PaymentErrorKind;
  readonly code: string | null;
  readonly message: string;
}

/**
 * Single item in the Apple Pay sheet's itemised breakdown. The UI
 * builds two-row carts for trials (free trial + recurring deferred to
 * `startDate`) and one-row carts for non-trial subscriptions.
 *
 * `amountPence` is integer pence (e.g. 1499 for £14.99). The adapter
 * converts to the SDK's decimal-string format at the boundary.
 *
 * `startDate` is a unix epoch (seconds) — used to defer the first
 * recurring charge past the trial-end date so Apple's billing terms
 * show the right date.
 */
export interface ApplePayCartItem {
  label: string;
  amountPence: number;
  paymentType: "Immediate" | "Recurring" | "Deferred";
  intervalCount?: number;
  intervalUnit?: "minute" | "hour" | "day" | "month" | "year";
  startDate?: number;
  isPending?: boolean;
}

export interface CollectApplePayPaymentMethodInput {
  /** ISO country code, "GB" for Persistence. */
  merchantCountryCode: string;
  /** ISO-4217 currency, "GBP" for Persistence. */
  currencyCode: string;
  cartItems: ApplePayCartItem[];
}

export interface CollectApplePayPaymentMethodResult {
  paymentMethodId: string;
}

/**
 * Port for payment processing via Stripe Apple Pay.
 *
 * Implementations:
 *   - `StripeApplePayAdapter` (prod, `adapters/payments/stripe.adapter.ts`)
 *   - `MockPaymentsAdapter` (tests, `adapters/payments/__tests__/mock.adapter.ts`)
 */
export interface PaymentsPort {
  /**
   * `true` only on iOS devices where Apple Pay is supported AND a card
   * is set up in Apple Wallet. Returns `false` on Android in all
   * configurations.
   */
  isApplePaySupported(): Promise<boolean>;

  /**
   * Presents the Apple Pay sheet immediately (no UI before the sheet
   * appears) and returns a Stripe `payment_method_id` on success.
   *
   * User cancellation → Result.err with kind `'cancelled'`. The
   * Selection screen pattern-matches on this to suppress the alert.
   *
   * Trial breakdowns are constructed in the cart items:
   * - free trial period as `paymentType: "Immediate"` with
   *   `amountPence: 0`
   * - recurring charge as `paymentType: "Recurring"` with `startDate =
   *   today + trial_duration_days` so Apple's sheet displays the
   *   correct first-bill date.
   */
  collectApplePayPaymentMethod(
    input: CollectApplePayPaymentMethodInput,
  ): Promise<Result<CollectApplePayPaymentMethodResult, PaymentError>>;

  /**
   * Confirms a 3DS / SCA challenge for a PaymentIntent. Called when
   * the backend's `createSubscription` returns `requires_action: true`
   * with a `client_secret`.
   *
   * Stripe SDK presents the challenge sheet; on success the eventual
   * `customer.subscription.updated` webhook commits the final
   * `payment_status` server-side. The mobile picks up the change on
   * the next `getMySubscription` refetch.
   */
  confirm3DS(clientSecret: string): Promise<Result<void, PaymentError>>;
}
