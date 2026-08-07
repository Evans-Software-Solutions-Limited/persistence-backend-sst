import type { ReactNode } from "react";
import { Redirect, type Href } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { color } from "@/ui/theme/tokens";

export type AdaptiveSuiteRouteGuardProps = {
  readonly allowed: boolean;
  readonly isResolved: boolean;
  readonly fallback: Href;
  readonly children: ReactNode;
};

/**
 * Prevents restored navigation state and direct deep links from reopening
 * Loadout/Mealprint screens after entitlement loss. Pending is neutral: a paid
 * user must not be redirected while `/subscriptions/me` is still resolving.
 */
export function AdaptiveSuiteRouteGuard({
  allowed,
  isResolved,
  fallback,
  children,
}: AdaptiveSuiteRouteGuardProps) {
  if (!isResolved) {
    return (
      <View style={styles.pending} testID="adaptive-suite-route-pending">
        <ActivityIndicator color={color.$text3} />
      </View>
    );
  }
  if (!allowed) return <Redirect href={fallback} />;
  return children;
}

const styles = StyleSheet.create({
  pending: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.$bg,
  },
});
