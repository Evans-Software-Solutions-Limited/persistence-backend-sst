import type { ApiPort } from "@/domain/ports/api.port";
import type { AuthPort } from "@/domain/ports/auth.port";
import type { HealthPort } from "@/domain/ports/health.port";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";
import type { NotificationsPort } from "@/domain/ports/notifications.port";
import type { PurchasesPort } from "@/domain/ports/purchases.port";
import type { StoragePort } from "@/domain/ports/storage.port";

export interface Adapters {
  api: ApiPort;
  auth: AuthPort;
  storage: StoragePort;
  health: HealthPort;
  notifications: NotificationsPort;
  netInfo: NetInfoPort;
  /**
   * RevenueCat native IAP — the ONLY purchase rail in the mobile app. Optional
   * because it is iOS-only today (absent on Android until Play billing is wired
   * through RevenueCat); consumers gate on its presence via `usePurchases`.
   *
   * There is deliberately no card/Apple-Pay rail here. The Stripe Apple Pay
   * rail was removed in full — it was unreachable on iOS (the subscription
   * container short-circuits to the IAP flow) while still linking PassKit into
   * the binary, which App Review flagged under Guideline 2.1.
   */
  purchases?: PurchasesPort;
}
