import { render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import {
  PaymentMethodForm,
  USER_CANCELLED_ERROR,
} from "@/ui/components/subscription/PaymentMethodForm";

// Platform.OS is a string constant in the Jest RN polyfill; mutate it
// directly via Object.defineProperty so per-test overrides work.
const originalOS = Platform.OS;
function setPlatformOS(os: "ios" | "android"): void {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
}

beforeEach(() => {
  setPlatformOS("ios");
});

afterAll(() => {
  setPlatformOS(originalOS as "ios" | "android");
});

describe("PaymentMethodForm — Android no-buy state", () => {
  it("renders the inline 'Apple Pay only on iOS' message on Android", async () => {
    setPlatformOS("android");
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(false);
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        onPaymentMethodReady={jest.fn()}
        onError={jest.fn()}
        payments={payments}
      />,
    );
    expect(
      await screen.findByTestId("payment-form-android-state"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Apple Pay is only available on iOS devices/),
    ).toBeTruthy();
  });
});

describe("PaymentMethodForm — iOS auto-trigger flow", () => {
  it("auto-triggers Apple Pay on mount and reports the paymentMethodId on success", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(true);
    payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_test" });
    const onReady = jest.fn();
    const onError = jest.fn();
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        onPaymentMethodReady={onReady}
        onError={onError}
        payments={payments}
      />,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledWith("pm_test"));
    expect(payments.collectCalls).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("constructs a single Recurring cart item for non-trial subscriptions", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(true);
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        onPaymentMethodReady={jest.fn()}
        onError={jest.fn()}
        payments={payments}
      />,
    );
    await waitFor(() => expect(payments.collectCalls).toBe(1));
    expect(payments.lastCollectInput?.cartItems).toHaveLength(1);
    expect(payments.lastCollectInput?.cartItems[0]).toMatchObject({
      paymentType: "Recurring",
      amountPence: 1499,
      intervalCount: 1,
      intervalUnit: "month",
    });
  });

  it("constructs the trial breakdown when isTrialEligible + recurringAmount provided", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(true);
    render(
      <PaymentMethodForm
        amount={0}
        billingCycle="monthly"
        isTrialEligible
        trialDuration={7}
        recurringAmount={1499}
        onPaymentMethodReady={jest.fn()}
        onError={jest.fn()}
        payments={payments}
      />,
    );
    await waitFor(() => expect(payments.collectCalls).toBe(1));
    const items = payments.lastCollectInput?.cartItems ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      paymentType: "Immediate",
      amountPence: 0,
      isPending: false,
    });
    expect(items[0].label).toMatch(/7-day free trial/);
    expect(items[1]).toMatchObject({
      paymentType: "Recurring",
      amountPence: 1499,
      intervalCount: 1,
      intervalUnit: "month",
      isPending: true,
    });
    expect(items[1].startDate).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("uses year interval unit when billingCycle is yearly", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(true);
    render(
      <PaymentMethodForm
        amount={14999}
        billingCycle="yearly"
        onPaymentMethodReady={jest.fn()}
        onError={jest.fn()}
        payments={payments}
      />,
    );
    await waitFor(() => expect(payments.collectCalls).toBe(1));
    expect(payments.lastCollectInput?.cartItems[0].intervalUnit).toBe("year");
  });

  it("passes USER_CANCELLED sentinel to onError when the user dismisses", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(true);
    payments.setNextCollectResponse({
      ok: false,
      error: { kind: "cancelled", code: "Canceled", message: "user" },
    });
    const onError = jest.fn();
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        onPaymentMethodReady={jest.fn()}
        onError={onError}
        payments={payments}
      />,
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(USER_CANCELLED_ERROR),
    );
  });

  it("passes the error message to onError on non-cancel failure", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(true);
    payments.setNextCollectResponse({
      ok: false,
      error: { kind: "stripe_error", code: "Failed", message: "Card declined" },
    });
    const onError = jest.fn();
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        onPaymentMethodReady={jest.fn()}
        onError={onError}
        payments={payments}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Card declined"));
  });

  it("renders the no-wallet inline state on iOS when adapter reports unsupported", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(false);
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        onPaymentMethodReady={jest.fn()}
        onError={jest.fn()}
        payments={payments}
      />,
    );
    expect(await screen.findByTestId("payment-form-no-wallet")).toBeTruthy();
  });

  it("does not fire onPaymentMethodReady when isProcessing is true (duplicate guard)", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(true);
    const onReady = jest.fn();
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        isProcessing
        onPaymentMethodReady={onReady}
        onError={jest.fn()}
        payments={payments}
      />,
    );
    await waitFor(() => expect(payments.collectCalls).toBe(1));
    // Adapter still got called (sheet was presented + user paid), but
    // the duplicate-call guard suppresses the parent callback.
    expect(onReady).not.toHaveBeenCalled();
  });

  it("treats isApplePaySupported rejection as 'unsupported' (catch branch)", async () => {
    const payments = new MockPaymentsAdapter();
    // Override the method to reject — the production Stripe adapter
    // surfaces SDK init failures here.
    payments.isApplePaySupported = jest.fn(async () => {
      throw new Error("SDK not initialised");
    });
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        onPaymentMethodReady={jest.fn()}
        onError={jest.fn()}
        payments={payments}
      />,
    );
    expect(await screen.findByTestId("payment-form-no-wallet")).toBeTruthy();
  });

  it("does not auto-trigger when shouldTrigger is false", async () => {
    const payments = new MockPaymentsAdapter();
    payments.setApplePaySupported(true);
    render(
      <PaymentMethodForm
        amount={1499}
        billingCycle="monthly"
        shouldTrigger={false}
        onPaymentMethodReady={jest.fn()}
        onError={jest.fn()}
        payments={payments}
      />,
    );
    // Wait a tick to let any rejections settle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(payments.collectCalls).toBe(0);
  });
});
