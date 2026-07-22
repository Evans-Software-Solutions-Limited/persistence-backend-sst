import React from "react";
import { ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/ui/components/Button";
import { color } from "@/ui/theme/tokens";

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
  const {
    successMessage,
    benefits,
    isTrainerTier,
    onGoToHome,
    onManageClients,
  } = props;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={color.$bg} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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
                    name={
                      benefit.icon as React.ComponentProps<
                        typeof Ionicons
                      >["name"]
                    }
                    size={24}
                    color={color.$primary}
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  scroll: {
    flex: 1,
  },
  // `flexGrow: 1` (not `flex: 1`) so the content centres when it fits and
  // grows/scrolls when it doesn't — the whole point of the fix (tall content /
  // large Dynamic Type / trainer tier with a Manage-Clients CTA overflowed a
  // fixed centred View and clipped, with no way to scroll). Vertical padding
  // keeps the title clear of the status bar when scrolled to the top.
  content: {
    flexGrow: 1,
    paddingHorizontal: 8,
    paddingVertical: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  messageSection: {
    alignItems: "center",
    paddingBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
    paddingBottom: 16,
  },
  message: {
    fontSize: 16,
    color: color.$text2,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: color.$text,
    textAlign: "center",
    paddingBottom: 16,
  },
  benefitsSection: {
    alignItems: "center",
    width: "100%",
    paddingTop: 24,
    paddingBottom: 24,
  },
  benefitsContainer: {
    width: "100%",
    gap: 16,
  },
  benefitItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  benefitIcon: {
    paddingRight: 16,
    alignSelf: "flex-start",
  },
  benefitContent: {
    flex: 1,
  },
  benefitTitle: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
    paddingBottom: 4,
  },
  benefitDescription: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
  },
  actionSection: {
    gap: 16,
    paddingTop: 24,
    width: "100%",
  },
});
