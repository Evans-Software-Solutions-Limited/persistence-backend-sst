import type { ApiPort } from "@/domain/ports/api.port";
import type { AuthPort } from "@/domain/ports/auth.port";
import type { HealthPort } from "@/domain/ports/health.port";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";
import type { NotificationsPort } from "@/domain/ports/notifications.port";
import type { PaymentsPort } from "@/domain/ports/payments.port";
import type { PurchasesPort } from "@/domain/ports/purchases.port";
import type { StoragePort } from "@/domain/ports/storage.port";

export interface Adapters {
  api: ApiPort;
  auth: AuthPort;
  storage: StoragePort;
  health: HealthPort;
  notifications: NotificationsPort;
  payments: PaymentsPort;
  netInfo: NetInfoPort;
  /**
   * RevenueCat native IAP (M12, iOS rail). Optional + absent on web / Android,
   * where the Stripe `payments` rail handles subscriptions. Consumers gate on
   * its presence via `usePurchases`.
   */
  purchases?: PurchasesPort;
}
