import React from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/ui/components/Button";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Pure presenter for the post-payment Success screen. Ported 1:1
 * from legacy `persistence-mobile/app/(auth)/success.tsx`.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 2.6, 6.5
 */

export interface SubscriptionBenefit {
  /** Ionicons name; loose typing matches legacy. */
  icon: string;
  title: string;
  description: string;
}

export interface SubscriptionSuccessPresenterProps {
  successMessage: string;
  benefits: SubscriptionBenefit[];
  /** Trainer tiers surface a second CTA. */
  isTrainerTier: boolean;
  onGoToHome: () => void;
  onManageClients: () => void;
}

export function SubscriptionSuccessPresenter(
  props: SubscriptionSuccessPresenterProps,
) {
  const { successMessage, benefits, isTrainerTier, onGoToHome, onManageClients } =
    props;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={Colors.background.primary}
      />

      <View style={styles.content}>
        <View style={styles.messageSection}>
          <Text style={styles.title}>Subscription Activated!</Text>
          <Text style={styles.message}>{successMessage}</Text>
        </View>

        <View style={styles.benefitsSection}>
          <Text style={styles.sectionTitle}>What you now have access to:</Text>
          <View style={styles.benefitsContainer}>
            {benefits.map((benefit, index) => (
              <View key={index} style={styles.benefitItem}>
                <View style={styles.benefitIcon}>
                  {/* The Ionicons name type is loose; legacy uses
                      `as any` here. */}
                  <Ionicons
                    name={benefit.icon as React.ComponentProps<typeof Ionicons>["name"]}
                    size={24}
                    color={Colors.primary.DEFAULT}
                  />
                </View>
                <View style={styles.benefitContent}>
                  <Text style={styles.benefitTitle}>{benefit.title}</Text>
                  <Text style={styles.benefitDescription}>
                    {benefit.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.actionSection}>
          {isTrainerTier && (
            <Button
              label="Manage Clients"
              onPress={onManageClients}
              variant="secondary"
              testID="success-manage-clients"
            />
          )}
          <Button
            label="Go to Home"
            onPress={onGoToHome}
            testID="success-go-home"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  messageSection: {
    alignItems: "center",
    paddingBottom: Spacing.xl,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: Colors.text.primary,
    textAlign: "center",
    paddingBottom: Spacing.md,
  },
  message: {
    fontSize: 16,
    color: Colors.text.secondary,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: Spacing.md,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.text.primary,
    textAlign: "center",
    paddingBottom: Spacing.md,
  },
  benefitsSection: {
    alignItems: "center",
    width: "100%",
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  benefitsContainer: {
    width: "100%",
    gap: Spacing.md,
  },
  benefitItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadows.small,
  },
  benefitIcon: {
    paddingRight: Spacing.md,
    alignSelf: "flex-start",
  },
  benefitContent: {
    flex: 1,
  },
  benefitTitle: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
    paddingBottom: Spacing.xs,
  },
  benefitDescription: {
    ...Typography.body2,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  actionSection: {
    gap: Spacing.md,
    paddingTop: Spacing.lg,
    width: "100%",
  },
});
