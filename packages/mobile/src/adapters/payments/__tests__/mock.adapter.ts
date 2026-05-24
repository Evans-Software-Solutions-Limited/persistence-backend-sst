import type {
  CollectApplePayPaymentMethodInput,
  CollectApplePayPaymentMethodResult,
  PaymentError,
  PaymentsPort,
} from "@/domain/ports/payments.port";
import { fail, ok, type Result } from "@/shared/errors";

/**
 * In-memory `PaymentsPort` for container + presenter tests.
 *
 * Spec: specs/11-payments-subscriptions/design.md § PaymentsPort
 *
 * Configurable per-test via the constructor or the public setter
 * methods — tests can dial in (a) Apple-Pay support state, (b) the
 * next `collectApplePayPaymentMethod` outcome, and (c) the next
 * `confirm3DS` outcome.
 *
 * Captures the last inputs so tests can assert exactly what the
 * container / form sent (cart-item construction, trial breakdown,
 * etc.).
 */
export class MockPaymentsAdapter implements PaymentsPort {
  public applePaySupported = true;

  public nextCollectResponse:
    | { ok: true; paymentMethodId: string }
    | { ok: false; error: PaymentError } = {
    ok: true,
    paymentMethodId: "pm_test_mock_1",
  };

  public nextConfirm3DSResponse:
    | { ok: true }
    | { ok: false; error: PaymentError } = { ok: true };

  public lastCollectInput: CollectApplePayPaymentMethodInput | null = null;
  public collectCalls = 0;
  public lastConfirm3DSSecret: string | null = null;
  public confirm3DSCalls = 0;

  setApplePaySupported(supported: boolean): void {
    this.applePaySupported = supported;
  }

  setNextCollectResponse(
    next:
      | { ok: true; paymentMethodId: string }
      | { ok: false; error: PaymentError },
  ): void {
    this.nextCollectResponse = next;
  }

  setNextConfirm3DSResponse(
    next: { ok: true } | { ok: false; error: PaymentError },
  ): void {
    this.nextConfirm3DSResponse = next;
  }

  async isApplePaySupported(): Promise<boolean> {
    return this.applePaySupported;
  }

  async collectApplePayPaymentMethod(
    input: CollectApplePayPaymentMethodInput,
  ): Promise<Result<CollectApplePayPaymentMethodResult, PaymentError>> {
    this.collectCalls += 1;
    this.lastCollectInput = input;
    if (this.nextCollectResponse.ok) {
      return ok({ paymentMethodId: this.nextCollectResponse.paymentMethodId });
    }
    return fail(this.nextCollectResponse.error);
  }

  async confirm3DS(clientSecret: string): Promise<Result<void, PaymentError>> {
    this.confirm3DSCalls += 1;
    this.lastConfirm3DSSecret = clientSecret;
    if (this.nextConfirm3DSResponse.ok) {
      return ok(undefined);
    }
    return fail(this.nextConfirm3DSResponse.error);
  }
}
