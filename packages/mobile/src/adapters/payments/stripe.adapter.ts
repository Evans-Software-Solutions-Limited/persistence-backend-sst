import { Platform } from "react-native";
import {
  isPlatformPaySupported,
  createPlatformPayPaymentMethod,
  handleNextAction,
  PlatformPay,
} from "@stripe/stripe-react-native";
import type {
  ApplePayCartItem,
  CollectApplePayPaymentMethodInput,
  CollectApplePayPaymentMethodResult,
  PaymentError,
  PaymentErrorKind,
  PaymentsPort,
} from "@/domain/ports/payments.port";
import { fail, ok, type Result } from "@/shared/errors";

/**
 * Production `PaymentsPort` implementation backed by Stripe's React-
 * Native SDK + Apple Pay.
 *
 * Spec: specs/11-payments-subscriptions/design.md § PaymentsPort
 * Satisfies: requirements.md AC 2.1, 2.2, 2.5, 2.7, 7.3, 8.1
 *
 * The SDK exposes the Apple-Pay primitives as plain async functions
 * (not just hooks), so this adapter can live outside React's render
 * cycle. The legacy `usePlatformPay()` hook is bypassed — its only
 * job is to memoise the same module-level functions; the
 * `<StripeProvider>` configured at the app root still provides the
 * native session.
 *
 * Error mapping (legacy parity):
 *   - "Canceled" / "canceled" or messages containing "cancel" →
 *     `'cancelled'` (silent — Selection screen pattern-matches this).
 *   - Android / iOS-without-wallet → `'platform_unavailable'`. Legacy
 *     short-circuits Android via `Platform.OS !== 'ios'` and the
 *     SDK's `isPlatformPaySupported()` returning false on devices
 *     without a configured wallet; we do the same.
 *   - Empty wallet → `'no_payment_methods'`. Stripe surfaces a few
 *     code variants here; we keyword-match the message.
 *   - Other Stripe error → `'stripe_error'` with the SDK's message.
 *   - Unknown / non-Stripe exceptions → `'unknown'`.
 */
export class StripeApplePayAdapter implements PaymentsPort {
  async isApplePaySupported(): Promise<boolean> {
    if (Platform.OS !== "ios") return false;
    try {
      return await isPlatformPaySupported();
    } catch {
      // SDK may throw if Stripe isn't initialised yet (provider not
      // mounted, key missing). Treat as unsupported — the UI's
      // inline error state covers it.
      return false;
    }
  }

  async collectApplePayPaymentMethod(
    input: CollectApplePayPaymentMethodInput,
  ): Promise<Result<CollectApplePayPaymentMethodResult, PaymentError>> {
    // Hard short-circuit on Android — legacy parity. The SDK
    // would surface a more obscure error on Android; we surface
    // the explicit kind so the UI can show its dedicated inline
    // state without parsing strings.
    if (Platform.OS !== "ios") {
      return fail({
        kind: "platform_unavailable",
        code: null,
        message: "Apple Pay is only available on iOS devices.",
      });
    }

    try {
      const supported = await isPlatformPaySupported();
      if (!supported) {
        return fail({
          kind: "platform_unavailable",
          code: null,
          message:
            "Apple Pay is not available on this device. Please ensure you have a card set up in Apple Wallet.",
        });
      }

      const { paymentMethod, error } = await createPlatformPayPaymentMethod({
        applePay: {
          merchantCountryCode: input.merchantCountryCode,
          currencyCode: input.currencyCode.toUpperCase(),
          cartItems: input.cartItems.map(mapCartItem),
          requiredShippingAddressFields: [],
          requiredBillingContactFields: [],
        },
      });

      if (error) {
        return fail(classifyStripeError(error.code, error.message));
      }

      if (!paymentMethod?.id) {
        return fail({
          kind: "stripe_error",
          code: null,
          message: "Payment method ID not received from Apple Pay.",
        });
      }

      return ok({ paymentMethodId: paymentMethod.id });
    } catch (err) {
      return fail({
        kind: "unknown",
        code: null,
        message:
          err instanceof Error ? err.message : "Failed to process Apple Pay.",
      });
    }
  }

  async confirm3DS(clientSecret: string): Promise<Result<void, PaymentError>> {
    try {
      const { error } = await handleNextAction(clientSecret);
      if (error) {
        return fail(classifyStripeError(error.code, error.message));
      }
      return ok(undefined);
    } catch (err) {
      return fail({
        kind: "unknown",
        code: null,
        message:
          err instanceof Error
            ? err.message
            : "Failed to confirm 3DS challenge.",
      });
    }
  }
}

/**
 * Convert the domain `ApplePayCartItem` into the SDK's tagged-union
 * `CartSummaryItem`. The SDK requires the discriminant to be the
 * `PaymentType` enum literal; legacy code casts strings via `as any`,
 * we use the typed enum so a future SDK upgrade catches breakage at
 * compile time.
 *
 * Amounts are pence on the wire; SDK expects decimal-string pounds.
 *
 * Returns `PlatformPay.CartSummaryItem` — the union of Immediate /
 * Deferred / Recurring summary items. Each branch is typed against
 * its concrete SDK shape so consumers get full type narrowing.
 */
function mapCartItem(item: ApplePayCartItem): PlatformPay.CartSummaryItem {
  const amount = (item.amountPence / 100).toFixed(2);
  switch (item.paymentType) {
    case "Immediate": {
      const out: PlatformPay.ImmediateCartSummaryItem = {
        paymentType: PlatformPay.PaymentType.Immediate,
        label: item.label,
        amount,
        isPending: item.isPending,
      };
      return out;
    }
    case "Deferred": {
      const out: PlatformPay.DeferredCartSummaryItem = {
        paymentType: PlatformPay.PaymentType.Deferred,
        label: item.label,
        amount,
        deferredDate: item.startDate ?? Math.floor(Date.now() / 1000),
      };
      return out;
    }
    case "Recurring": {
      const out: PlatformPay.RecurringCartSummaryItem = {
        paymentType: PlatformPay.PaymentType.Recurring,
        label: item.label,
        amount,
        intervalCount: item.intervalCount ?? 1,
        intervalUnit: mapIntervalUnit(item.intervalUnit ?? "month"),
        startDate: item.startDate,
      };
      return out;
    }
  }
}

function mapIntervalUnit(
  unit: NonNullable<ApplePayCartItem["intervalUnit"]>,
): PlatformPay.IntervalUnit {
  switch (unit) {
    case "minute":
      return PlatformPay.IntervalUnit.Minute;
    case "hour":
      return PlatformPay.IntervalUnit.Hour;
    case "day":
      return PlatformPay.IntervalUnit.Day;
    case "month":
      return PlatformPay.IntervalUnit.Month;
    case "year":
      return PlatformPay.IntervalUnit.Year;
  }
}

/**
 * Map a raw Stripe SDK error onto the discriminated `PaymentError`.
 * Pure — exported for tests, no side effects.
 */
export function classifyStripeError(
  code: string | null | undefined,
  message: string | null | undefined,
): PaymentError {
  const normalisedCode = code ?? "";
  const normalisedMessage = (message ?? "").toLowerCase();

  // Legacy keyword-match — Stripe surfaces user-cancel in a few
  // shapes across SDK versions / platforms.
  const looksCancelled =
    normalisedCode === "Canceled" ||
    normalisedCode === "canceled" ||
    normalisedMessage.includes("cancel");

  if (looksCancelled) {
    return {
      kind: "cancelled",
      code: normalisedCode || null,
      message: message ?? "User cancelled the Apple Pay sheet.",
    };
  }

  // Empty wallet — observed Stripe codes vary; the message is
  // load-bearing here.
  if (
    normalisedMessage.includes("no payment method") ||
    normalisedMessage.includes("no card") ||
    normalisedMessage.includes("wallet is empty")
  ) {
    return {
      kind: "no_payment_methods",
      code: normalisedCode || null,
      message: message ?? "No payment methods available in Apple Wallet.",
    };
  }

  // Anything else with a code came from the SDK — treat as a
  // recognisable Stripe error.
  const kind: PaymentErrorKind = normalisedCode ? "stripe_error" : "unknown";
  return {
    kind,
    code: normalisedCode || null,
    message: message ?? "Stripe SDK returned an error.",
  };
}
