/**
 * Unit tests for `StripeApplePayAdapter`.
 *
 * Spec: specs/11-payments-subscriptions/design.md § PaymentsPort
 *
 * Mocks `@stripe/stripe-react-native` at the module boundary so the
 * adapter exercises its Platform.OS branching + error-classification
 * logic without needing the native SDK runtime.
 */

const mockIsPlatformPaySupported = jest.fn();
const mockCreatePlatformPayPaymentMethod = jest.fn();
const mockHandleNextAction = jest.fn();

jest.mock("@stripe/stripe-react-native", () => ({
  isPlatformPaySupported: (...args: unknown[]) =>
    mockIsPlatformPaySupported(...args),
  createPlatformPayPaymentMethod: (...args: unknown[]) =>
    mockCreatePlatformPayPaymentMethod(...args),
  handleNextAction: (...args: unknown[]) => mockHandleNextAction(...args),
  PlatformPay: {
    PaymentType: {
      Immediate: "Immediate",
      Recurring: "Recurring",
      Deferred: "Deferred",
    },
    IntervalUnit: {
      Minute: "minute",
      Hour: "hour",
      Day: "day",
      Month: "month",
      Year: "year",
    },
  },
}));

const mockPlatformOS: { current: "ios" | "android" } = { current: "ios" };
jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatformOS.current;
    },
  },
}));

// eslint-disable-next-line import/first
import {
  classifyStripeError,
  StripeApplePayAdapter,
} from "@/adapters/payments/stripe.adapter";
// eslint-disable-next-line import/first
import type { CollectApplePayPaymentMethodInput } from "@/domain/ports/payments.port";

beforeEach(() => {
  mockIsPlatformPaySupported.mockReset();
  mockCreatePlatformPayPaymentMethod.mockReset();
  mockHandleNextAction.mockReset();
  mockPlatformOS.current = "ios";
});

describe("StripeApplePayAdapter.isApplePaySupported", () => {
  it("returns false on Android without calling the SDK", async () => {
    mockPlatformOS.current = "android";
    const adapter = new StripeApplePayAdapter();
    expect(await adapter.isApplePaySupported()).toBe(false);
    expect(mockIsPlatformPaySupported).not.toHaveBeenCalled();
  });

  it("returns true on iOS when the SDK reports supported", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    const adapter = new StripeApplePayAdapter();
    expect(await adapter.isApplePaySupported()).toBe(true);
  });

  it("returns false on iOS when the SDK reports unsupported", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(false);
    const adapter = new StripeApplePayAdapter();
    expect(await adapter.isApplePaySupported()).toBe(false);
  });

  it("returns false on iOS when the SDK throws", async () => {
    mockIsPlatformPaySupported.mockRejectedValue(new Error("not initialised"));
    const adapter = new StripeApplePayAdapter();
    expect(await adapter.isApplePaySupported()).toBe(false);
  });
});

describe("StripeApplePayAdapter.collectApplePayPaymentMethod", () => {
  const cart: CollectApplePayPaymentMethodInput = {
    merchantCountryCode: "GB",
    currencyCode: "gbp",
    cartItems: [
      {
        label: "Premium - £14.99 per month",
        amountPence: 1499,
        paymentType: "Recurring",
        intervalCount: 1,
        intervalUnit: "month",
      },
    ],
  };

  it("returns platform_unavailable on Android without invoking the SDK", async () => {
    mockPlatformOS.current = "android";
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.collectApplePayPaymentMethod(cart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("platform_unavailable");
    }
    expect(mockCreatePlatformPayPaymentMethod).not.toHaveBeenCalled();
  });

  it("returns platform_unavailable on iOS when SDK reports unsupported", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(false);
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.collectApplePayPaymentMethod(cart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("platform_unavailable");
    }
  });

  it("returns the paymentMethodId on success", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({
      paymentMethod: { id: "pm_test_apple_pay" },
    });
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.collectApplePayPaymentMethod(cart);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.paymentMethodId).toBe("pm_test_apple_pay");
    }
  });

  it("uppercases the currency code passed to the SDK", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({
      paymentMethod: { id: "pm_x" },
    });
    const adapter = new StripeApplePayAdapter();
    await adapter.collectApplePayPaymentMethod(cart);
    const call = mockCreatePlatformPayPaymentMethod.mock.calls[0][0];
    expect(call.applePay.currencyCode).toBe("GBP");
    expect(call.applePay.merchantCountryCode).toBe("GB");
  });

  it("maps trial cart items (Immediate + Recurring with startDate) to SDK shape", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({
      paymentMethod: { id: "pm_x" },
    });
    const adapter = new StripeApplePayAdapter();
    await adapter.collectApplePayPaymentMethod({
      merchantCountryCode: "GB",
      currencyCode: "GBP",
      cartItems: [
        {
          label: "7-day free trial",
          amountPence: 0,
          paymentType: "Immediate",
          isPending: false,
        },
        {
          label: "£14.99 per month (after trial)",
          amountPence: 1499,
          paymentType: "Recurring",
          intervalCount: 1,
          intervalUnit: "month",
          startDate: 1735689600,
          isPending: true,
        },
      ],
    });
    const items =
      mockCreatePlatformPayPaymentMethod.mock.calls[0][0].applePay.cartItems;
    expect(items[0]).toMatchObject({
      paymentType: "Immediate",
      label: "7-day free trial",
      amount: "0.00",
    });
    expect(items[1]).toMatchObject({
      paymentType: "Recurring",
      label: "£14.99 per month (after trial)",
      amount: "14.99",
      intervalCount: 1,
      intervalUnit: "month",
      startDate: 1735689600,
    });
  });

  it("falls back to current time when Deferred item lacks startDate", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({
      paymentMethod: { id: "pm_x" },
    });
    const adapter = new StripeApplePayAdapter();
    const nowSec = Math.floor(Date.now() / 1000);
    await adapter.collectApplePayPaymentMethod({
      merchantCountryCode: "GB",
      currencyCode: "GBP",
      cartItems: [
        {
          label: "Deferred fallback",
          amountPence: 100,
          paymentType: "Deferred",
        },
      ],
    });
    const item =
      mockCreatePlatformPayPaymentMethod.mock.calls[0][0].applePay.cartItems[0];
    expect(item.paymentType).toBe("Deferred");
    // Allow 5s drift for slow test machines.
    expect(item.deferredDate).toBeGreaterThanOrEqual(nowSec - 5);
    expect(item.deferredDate).toBeLessThanOrEqual(nowSec + 5);
  });

  it("maps a Stripe SDK error onto a stripe_error PaymentError", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({
      error: { code: "Failed", message: "Card declined" },
    });
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.collectApplePayPaymentMethod(cart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("stripe_error");
      expect(result.error.message).toBe("Card declined");
    }
  });

  it("returns cancelled when SDK returns code Canceled", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({
      error: { code: "Canceled", message: "User canceled" },
    });
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.collectApplePayPaymentMethod(cart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("cancelled");
    }
  });

  it("returns stripe_error when paymentMethod is missing without an error", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({});
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.collectApplePayPaymentMethod(cart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("stripe_error");
    }
  });

  it("returns unknown when the SDK call itself throws", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockRejectedValue(new Error("boom"));
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.collectApplePayPaymentMethod(cart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unknown");
      expect(result.error.message).toBe("boom");
    }
  });

  it("returns unknown with a fallback message for non-Error throws", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockRejectedValue("oops");
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.collectApplePayPaymentMethod(cart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unknown");
      expect(result.error.message).toBe("Failed to process Apple Pay.");
    }
  });

  it("maps all interval units through the enum", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({
      paymentMethod: { id: "pm_x" },
    });
    const adapter = new StripeApplePayAdapter();
    const units: ("minute" | "hour" | "day" | "month" | "year")[] = [
      "minute",
      "hour",
      "day",
      "month",
      "year",
    ];
    for (const unit of units) {
      mockCreatePlatformPayPaymentMethod.mockClear();
      await adapter.collectApplePayPaymentMethod({
        merchantCountryCode: "GB",
        currencyCode: "GBP",
        cartItems: [
          {
            label: `Recurring per ${unit}`,
            amountPence: 100,
            paymentType: "Recurring",
            intervalCount: 1,
            intervalUnit: unit,
          },
        ],
      });
      const item =
        mockCreatePlatformPayPaymentMethod.mock.calls[0][0].applePay
          .cartItems[0];
      expect(item.intervalUnit).toBe(unit);
    }
  });

  it("defaults intervalCount and intervalUnit when omitted on a Recurring item", async () => {
    mockIsPlatformPaySupported.mockResolvedValue(true);
    mockCreatePlatformPayPaymentMethod.mockResolvedValue({
      paymentMethod: { id: "pm_x" },
    });
    const adapter = new StripeApplePayAdapter();
    await adapter.collectApplePayPaymentMethod({
      merchantCountryCode: "GB",
      currencyCode: "GBP",
      cartItems: [
        {
          label: "Bare recurring",
          amountPence: 999,
          paymentType: "Recurring",
        },
      ],
    });
    const item =
      mockCreatePlatformPayPaymentMethod.mock.calls[0][0].applePay.cartItems[0];
    expect(item.intervalCount).toBe(1);
    expect(item.intervalUnit).toBe("month");
  });
});

describe("StripeApplePayAdapter.confirm3DS", () => {
  it("returns ok when SDK reports no error", async () => {
    mockHandleNextAction.mockResolvedValue({});
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.confirm3DS("pi_test_secret");
    expect(result.ok).toBe(true);
    expect(mockHandleNextAction).toHaveBeenCalledWith("pi_test_secret");
  });

  it("classifies SDK errors via classifyStripeError", async () => {
    mockHandleNextAction.mockResolvedValue({
      error: { code: "Failed", message: "3DS rejected" },
    });
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.confirm3DS("pi_test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("stripe_error");
    }
  });

  it("returns unknown on a thrown error", async () => {
    mockHandleNextAction.mockRejectedValue(new Error("connection lost"));
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.confirm3DS("pi_test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unknown");
      expect(result.error.message).toBe("connection lost");
    }
  });

  it("returns unknown with fallback message for non-Error throws", async () => {
    mockHandleNextAction.mockRejectedValue("boom");
    const adapter = new StripeApplePayAdapter();
    const result = await adapter.confirm3DS("pi_test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("Failed to confirm 3DS challenge.");
    }
  });
});

describe("classifyStripeError", () => {
  it("treats code 'Canceled' as cancelled", () => {
    expect(classifyStripeError("Canceled", "User dismissed").kind).toBe(
      "cancelled",
    );
  });

  it("treats code 'canceled' (lowercase) as cancelled", () => {
    expect(classifyStripeError("canceled", "User dismissed").kind).toBe(
      "cancelled",
    );
  });

  it("treats messages containing 'cancel' as cancelled (any case)", () => {
    expect(classifyStripeError("OtherCode", "user CANCELLED").kind).toBe(
      "cancelled",
    );
  });

  it("treats empty-wallet messages as no_payment_methods", () => {
    expect(
      classifyStripeError("Failed", "No payment method available").kind,
    ).toBe("no_payment_methods");
    expect(
      classifyStripeError("Failed", "No card configured in wallet").kind,
    ).toBe("no_payment_methods");
    expect(classifyStripeError("Failed", "Apple Wallet is empty").kind).toBe(
      "no_payment_methods",
    );
  });

  it("treats anything else with a code as stripe_error", () => {
    expect(classifyStripeError("Failed", "Card declined").kind).toBe(
      "stripe_error",
    );
  });

  it("treats missing code and missing message as unknown", () => {
    const result = classifyStripeError(null, null);
    expect(result.kind).toBe("unknown");
    expect(result.code).toBe(null);
  });

  it("uses fallback messages when none are provided", () => {
    expect(classifyStripeError("Canceled", null).message).toBe(
      "User cancelled the Apple Pay sheet.",
    );
    expect(classifyStripeError("Failed", "no payment method").message).toBe(
      "no payment method",
    );
    expect(classifyStripeError("Failed", null).message).toBe(
      "Stripe SDK returned an error.",
    );
  });
});
