import { SubscriptionSuccessContainer } from "@/ui/containers/SubscriptionSuccessContainer";

/**
 * Expo Router thin wrapper for the post-payment Success screen.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 2.6, 6.5
 */
export default function SuccessScreen() {
  return <SubscriptionSuccessContainer />;
}
