import type { Result } from "@/shared/errors";

export type PaymentError = {
  readonly kind: "payment";
  readonly code: "cancelled" | "failed" | "unavailable";
  readonly message: string;
};

export type PaymentSheetParams = {
  paymentIntentClientSecret: string;
  ephemeralKeySecret: string;
  customerId: string;
};

/**
 * Port for payment processing (Stripe).
 * Stub — expanded in milestone 11.
 */
export interface PaymentsPort {
  initializePaymentSheet(
    tierId: string,
  ): Promise<Result<PaymentSheetParams, PaymentError>>;
  presentPaymentSheet(): Promise<Result<void, PaymentError>>;
  isApplePayAvailable(): Promise<boolean>;
  isGooglePayAvailable(): Promise<boolean>;
}
