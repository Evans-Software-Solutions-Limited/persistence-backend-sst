import type {
  PaymentsPort,
  PaymentError,
  PaymentSheetParams,
} from "@/domain/ports/payments.port";
import { fail, type Result } from "@/shared/errors";

const UNAVAILABLE: PaymentError = {
  kind: "payment",
  code: "unavailable",
  message: "Payments not yet available",
};

/**
 * No-op payments adapter. Replaced in milestone 11.
 */
export class StubPaymentsAdapter implements PaymentsPort {
  async initializePaymentSheet(): Promise<
    Result<PaymentSheetParams, PaymentError>
  > {
    return fail(UNAVAILABLE);
  }
  async presentPaymentSheet(): Promise<Result<void, PaymentError>> {
    return fail(UNAVAILABLE);
  }
  async isApplePayAvailable() {
    return false;
  }
  async isGooglePayAvailable() {
    return false;
  }
}
