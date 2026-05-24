import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import type { CollectApplePayPaymentMethodInput } from "@/domain/ports/payments.port";

describe("MockPaymentsAdapter", () => {
  const input: CollectApplePayPaymentMethodInput = {
    merchantCountryCode: "GB",
    currencyCode: "GBP",
    cartItems: [
      {
        label: "Premium",
        amountPence: 1499,
        paymentType: "Recurring",
        intervalCount: 1,
        intervalUnit: "month",
      },
    ],
  };

  it("defaults to applePaySupported = true and a successful collect", async () => {
    const adapter = new MockPaymentsAdapter();
    expect(await adapter.isApplePaySupported()).toBe(true);
    const result = await adapter.collectApplePayPaymentMethod(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.paymentMethodId).toBe("pm_test_mock_1");
    }
  });

  it("captures the last collect input and increments call counter", async () => {
    const adapter = new MockPaymentsAdapter();
    await adapter.collectApplePayPaymentMethod(input);
    await adapter.collectApplePayPaymentMethod(input);
    expect(adapter.collectCalls).toBe(2);
    expect(adapter.lastCollectInput).toEqual(input);
  });

  it("returns a configured error on collect", async () => {
    const adapter = new MockPaymentsAdapter();
    adapter.setNextCollectResponse({
      ok: false,
      error: { kind: "cancelled", code: "Canceled", message: "User x" },
    });
    const result = await adapter.collectApplePayPaymentMethod(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("cancelled");
    }
  });

  it("returns a configured paymentMethodId on collect success", async () => {
    const adapter = new MockPaymentsAdapter();
    adapter.setNextCollectResponse({ ok: true, paymentMethodId: "pm_custom" });
    const result = await adapter.collectApplePayPaymentMethod(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.paymentMethodId).toBe("pm_custom");
  });

  it("toggles Apple Pay support", async () => {
    const adapter = new MockPaymentsAdapter();
    adapter.setApplePaySupported(false);
    expect(await adapter.isApplePaySupported()).toBe(false);
  });

  it("confirms 3DS — default success and configured failure", async () => {
    const adapter = new MockPaymentsAdapter();
    const okResult = await adapter.confirm3DS("pi_test_secret");
    expect(okResult.ok).toBe(true);
    expect(adapter.lastConfirm3DSSecret).toBe("pi_test_secret");
    expect(adapter.confirm3DSCalls).toBe(1);

    adapter.setNextConfirm3DSResponse({
      ok: false,
      error: { kind: "stripe_error", code: "Failed", message: "3DS denied" },
    });
    const failResult = await adapter.confirm3DS("pi_other");
    expect(failResult.ok).toBe(false);
    if (!failResult.ok) {
      expect(failResult.error.message).toBe("3DS denied");
    }
    expect(adapter.confirm3DSCalls).toBe(2);
    expect(adapter.lastConfirm3DSSecret).toBe("pi_other");
  });
});
