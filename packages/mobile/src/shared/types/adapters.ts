import type { ApiPort } from "@/domain/ports/api.port";
import type { AuthPort } from "@/domain/ports/auth.port";
import type { HealthPort } from "@/domain/ports/health.port";
import type { NotificationsPort } from "@/domain/ports/notifications.port";
import type { PaymentsPort } from "@/domain/ports/payments.port";
import type { StoragePort } from "@/domain/ports/storage.port";

export interface Adapters {
  api: ApiPort;
  auth: AuthPort;
  storage: StoragePort;
  health: HealthPort;
  notifications: NotificationsPort;
  payments: PaymentsPort;
}
