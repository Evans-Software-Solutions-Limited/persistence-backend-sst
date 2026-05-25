import { SubscriptionManagementContainer } from "@/ui/containers/SubscriptionManagementContainer";

/**
 * Expo Router thin wrapper for Subscription Management. Reached from
 * the Profile tab via push navigation.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 3.1
 */
export default function SubscriptionManagementScreen() {
  return <SubscriptionManagementContainer />;
}
