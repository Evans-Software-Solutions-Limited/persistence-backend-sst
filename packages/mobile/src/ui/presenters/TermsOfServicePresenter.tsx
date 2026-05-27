import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, Spacing, Typography } from "@/ui/theme/profileLegacyTheme";

/**
 * Terms of Service — pure presenter. Layout + copy ported verbatim from
 * `persistence-mobile/app/terms-of-service.tsx`. Static legal content.
 */

export type TermsOfServicePresenterProps = {
  onBack: () => void;
};

export function TermsOfServicePresenter({
  onBack,
}: TermsOfServicePresenterProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            testID="terms-of-service-back"
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Terms of Service</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.content} testID="terms-of-service-scroll">
          <Text style={styles.lastUpdated}>Last Updated: January 2025</Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
            <Text style={styles.bodyText}>
              By accessing and using the Persistence mobile application
              (&quot;App&quot;), you accept and agree to be bound by the terms
              and provision of this agreement. If you do not agree to these
              terms, please do not use the App.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>2. Use License</Text>
            <Text style={styles.bodyText}>
              Permission is granted to temporarily use the App for personal,
              non-commercial transitory viewing only. This is the grant of a
              license, not a transfer of title, and under this license you may
              not:
            </Text>
            <Text style={styles.listItem}>• Modify or copy the materials</Text>
            <Text style={styles.listItem}>
              • Use the materials for any commercial purpose
            </Text>
            <Text style={styles.listItem}>
              • Attempt to reverse engineer any software contained in the App
            </Text>
            <Text style={styles.listItem}>
              • Remove any copyright or other proprietary notations from the
              materials
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>3. User Accounts</Text>
            <Text style={styles.bodyText}>
              You are responsible for maintaining the confidentiality of your
              account and password. You agree to accept responsibility for all
              activities that occur under your account.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              4. Health and Fitness Disclaimer
            </Text>
            <Text style={styles.bodyText}>
              The App provides fitness tracking and workout information for
              informational purposes only. The App is not a substitute for
              professional medical advice, diagnosis, or treatment. Always seek
              the advice of your physician or other qualified health provider
              with any questions you may have regarding a medical condition or
              fitness program.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>5. Limitation of Liability</Text>
            <Text style={styles.bodyText}>
              In no event shall Persistence or its suppliers be liable for any
              damages (including, without limitation, damages for loss of data
              or profit, or due to business interruption) arising out of the use
              or inability to use the App, even if Persistence or a Persistence
              authorized representative has been notified orally or in writing
              of the possibility of such damage.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>6. Revisions</Text>
            <Text style={styles.bodyText}>
              Persistence may revise these terms of service at any time without
              notice. By using this App you are agreeing to be bound by the then
              current version of these terms of service.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>7. Contact Information</Text>
            <Text style={styles.bodyText}>
              If you have any questions about these Terms of Service, please
              contact us at admin@evans-software-solutions.com
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  headerTitle: {
    ...Typography.h3,
  },
  headerSpacer: {
    width: 24,
  },
  content: {
    flex: 1,
    padding: Spacing.md,
  },
  lastUpdated: {
    ...Typography.caption,
    color: Colors.text.tertiary,
    marginBottom: Spacing.lg,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.sm,
  },
  bodyText: {
    ...Typography.body1,
    marginBottom: Spacing.sm,
    lineHeight: 24,
  },
  listItem: {
    ...Typography.body1,
    marginLeft: Spacing.md,
    marginBottom: Spacing.xs,
  },
});
