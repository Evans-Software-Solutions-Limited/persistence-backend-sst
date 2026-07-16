import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type {
  ApplePayCartItem,
  PaymentsPort,
} from "@/domain/ports/payments.port";
import { color } from "@/ui/theme/tokens";

/**
 * Apple Pay trigger for subscription buy / change flows. Ported 1:1
 * from legacy `persistence-mobile/components/payment/PaymentMethodForm.tsx`
 * — same auto-trigger lifecycle, same cart-item construction with
 * trial breakdown, same Android error state.
 *
 * Spec: specs/11-payments-subscriptions/design.md § PaymentsPort
 * Satisfies: requirements.md AC 2.1, 2.2, 2.7, 2.8, 2.9, 7.3
 *
 * Wraps the V2 `PaymentsPort` (injected via the `payments` prop) rather
 * than calling the Stripe SDK directly. The container passes
 * `useAdapters().payments` in. This keeps the component testable
 * without mocking Stripe at the module boundary — pass a
 * `MockPaymentsAdapter` instead.
 *
 * Component renders only the inline error state — on iOS with Apple
 * Pay configured, it auto-triggers the sheet on mount and returns
 * `null` (the sheet is presented natively, the parent owns the
 * success / cancel flow via `onPaymentMethodReady` / `onError`).
 */

export interface PaymentMethodFormProps {
  /** Subscription amount in PENCE for the immediate charge. 0 on trial paths. */
  amount: number;
  currency?: string;
  onPaymentMethodReady: (paymentMethodId: string) => void;
  onError: (error: string) => void;
  billingCycle?: "monthly" | "yearly";
  /** Trial days when the user is eligible — drives cart-item layout. */
  trialDuration?: number | null;
  isTrialEligible?: boolean;
  /** Recurring amount in PENCE — required when isTrialEligible + trialDuration. */
  recurringAmount?: number;
  /** Disable auto-trigger while parent is mid-call. Prevents duplicate fires. */
  isProcessing?: boolean;
  /** Defaults to true; legacy parity (component-as-trigger). */
  shouldTrigger?: boolean;
  /** Injected payments port — V2 dependency-injection seam. */
  payments: PaymentsPort;
}

/**
 * Special-cased error string that the parent uses to suppress the
 * alert on user-initiated cancellation. Legacy parity.
 */
export const USER_CANCELLED_ERROR = "USER_CANCELLED";

export function PaymentMethodForm({
  amount,
  currency = "gbp",
  onPaymentMethodReady,
  onError,
  billingCycle = "monthly",
  trialDuration = null,
  isTrialEligible = false,
  recurringAmount,
  isProcessing = false,
  shouldTrigger = true,
  payments,
}: PaymentMethodFormProps) {
  const [applePaySupported, setApplePaySupported] = useState<boolean | null>(
    null,
  );
  const [hasTriggered, setHasTriggered] = useState(false);

  // Stable refs for the parent callbacks — the auto-trigger effect
  // would otherwise re-run on every parent render (containers
  // typically recreate inline arrow callbacks). Legacy did this
  // implicitly via the eslint-disable; we use refs.
  const onPaymentMethodReadyRef = useRef(onPaymentMethodReady);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onPaymentMethodReadyRef.current = onPaymentMethodReady;
    onErrorRef.current = onError;
  }, [onPaymentMethodReady, onError]);

  // Check Apple Pay support on mount. Android returns false without
  // hitting the SDK; iOS asks the adapter (which asks Stripe).
  useEffect(() => {
    let isMounted = true;
    payments
      .isApplePaySupported()
      .then((supported) => {
        if (isMounted) setApplePaySupported(supported);
      })
      .catch(() => {
        if (isMounted) setApplePaySupported(false);
      });
    return () => {
      isMounted = false;
    };
  }, [payments]);

  const handleApplePay = useCallback(async () => {
    // Pre-conditions are guarded by the auto-trigger effect below
    // (Platform.OS === 'ios', applePaySupported === true) before this
    // is ever called. The defensive duplicates from legacy were dead
    // code in V2's call-graph; the adapter still classifies actual
    // platform / wallet errors at the boundary if Stripe surfaces
    // them at sheet-time.

    const amountInPounds = (amount / 100).toFixed(2);
    const periodLabel = billingCycle === "yearly" ? "year" : "month";

    const cartItems: ApplePayCartItem[] = [];

    if (isTrialEligible && trialDuration && recurringAmount !== undefined) {
      // Trial breakdown — legacy line-by-line.
      const recurringAmountInPounds = (recurringAmount / 100).toFixed(2);
      const trialStartDate = Math.floor(Date.now() / 1000);
      const trialEndDate = trialStartDate + trialDuration * 24 * 60 * 60;

      const trialStartDateFormatted = new Date(
        trialStartDate * 1000,
      ).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const firstPaymentDate = new Date(trialEndDate * 1000);
      const formattedDate = firstPaymentDate.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      cartItems.push({
        label: `${trialDuration}-day free trial (starting ${trialStartDateFormatted})`,
        amountPence: 0,
        paymentType: "Immediate",
        isPending: false,
      });

      cartItems.push({
        label: `£${recurringAmountInPounds} per ${periodLabel} (starting ${formattedDate})`,
        amountPence: recurringAmount,
        paymentType: "Recurring",
        isPending: true,
        intervalCount: 1,
        intervalUnit: billingCycle === "yearly" ? "year" : "month",
        startDate: trialEndDate,
      });
    } else {
      cartItems.push({
        label: `Subscription - £${amountInPounds} per ${periodLabel}`,
        amountPence: amount,
        paymentType: "Recurring",
        intervalCount: 1,
        intervalUnit: billingCycle === "yearly" ? "year" : "month",
      });
    }

    const result = await payments.collectApplePayPaymentMethod({
      merchantCountryCode: "GB",
      currencyCode: currency.toUpperCase(),
      cartItems,
    });

    if (!result.ok) {
      // On error, release the latch so the parent's retry handler can
      // re-mount the component and re-trigger. The success path keeps
      // the latch set — once Apple Pay returns a paymentMethodId, the
      // parent is expected to unmount the component (legacy parity:
      // selectedTierForPayment = null after success).
      setHasTriggered(false);
      if (result.error.kind === "cancelled") {
        // User cancelled — parent suppresses the alert via the
        // sentinel string. Legacy parity.
        onErrorRef.current(USER_CANCELLED_ERROR);
        return;
      }
      onErrorRef.current(result.error.message);
      return;
    }

    // Prevent duplicate calls — same guard legacy had. Keeps the
    // latch set so the auto-trigger effect doesn't re-fire if the
    // parent stays mounted (e.g. during async backend processing).
    if (isProcessing) return;

    onPaymentMethodReadyRef.current(result.value.paymentMethodId);
  }, [
    amount,
    currency,
    billingCycle,
    isTrialEligible,
    trialDuration,
    recurringAmount,
    isProcessing,
    payments,
  ]);

  // Auto-trigger on mount once support state is known. Legacy lines
  // 252-289. The trigger only fires once per (mount × shouldTrigger ×
  // applePaySupported) state.
  useEffect(() => {
    if (!shouldTrigger) return;
    if (hasTriggered) return;
    if (applePaySupported === null) return;

    setHasTriggered(true);

    if (applePaySupported === false) {
      setHasTriggered(false);
      onErrorRef.current(
        "Apple Pay is not available on this device. Please ensure you have a card set up in Apple Wallet.",
      );
      return;
    }

    if (Platform.OS !== "ios") {
      setHasTriggered(false);
      onErrorRef.current("Apple Pay is only available on iOS devices.");
      return;
    }

    if (applePaySupported === true) {
      void handleApplePay();
    }
  }, [applePaySupported, hasTriggered, handleApplePay, shouldTrigger]);

  // Android no-buy state — legacy parity (AC 2.9).
  if (Platform.OS !== "ios") {
    return (
      <View style={styles.container} testID="payment-form-android-state">
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={24} color={color.$error} />
          <Text style={styles.errorText}>
            Apple Pay is only available on iOS devices. Please use an iPhone or
            iPad to complete your subscription.
          </Text>
        </View>
      </View>
    );
  }

  // Loading state while checking support.
  if (applePaySupported === null) {
    return (
      <View style={styles.container} testID="payment-form-loading">
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            Checking Apple Pay availability...
          </Text>
        </View>
      </View>
    );
  }

  // Apple Pay supported = false on iOS — empty wallet, etc.
  if (!applePaySupported) {
    return (
      <View style={styles.container} testID="payment-form-no-wallet">
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={24} color={color.$warning} />
          <Text style={styles.errorText}>
            Apple Pay is not available on this device. Please ensure you have a
            card set up in Apple Wallet and that Apple Pay is enabled.
          </Text>
        </View>
      </View>
    );
  }

  // Apple Pay sheet is the UI — component renders nothing.
  return null;
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: color.$error + "20",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.$error + "40",
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: color.$text,
    lineHeight: 20,
  },
  loadingContainer: {
    padding: 16,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
    color: color.$text2,
  },
});
