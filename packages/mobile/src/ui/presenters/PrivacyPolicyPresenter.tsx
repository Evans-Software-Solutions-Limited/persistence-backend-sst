import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconBack } from "@/ui/components/icons";
import { Colors, Spacing, Typography } from "@/ui/theme/profileLegacyTheme";

// [01-design-system adoption sweep 2026-05-29]
// Foundation primitive shells swapped in: <Icon*> (Ionicons -> Lucide).
// Composite primitives + layout-shape changes deferred to owning spec.

/**
 * Privacy Policy — pure presenter. Layout + copy ported verbatim from
 * `persistence-mobile/app/privacy-policy.tsx`. Static legal content; no
 * data dependencies. The route file uses this presenter directly with
 * an `onBack` handler bound to `router.back()`.
 */

export type PrivacyPolicyPresenterProps = {
  onBack: () => void;
};

export function PrivacyPolicyPresenter({
  onBack,
}: PrivacyPolicyPresenterProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            testID="privacy-policy-back"
            hitSlop={8}
          >
            <IconBack size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Privacy Policy</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.content} testID="privacy-policy-scroll">
          <Text style={styles.lastUpdated}>Last Updated: January 2025</Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>1. Introduction</Text>
            <Text style={styles.bodyText}>
              Persistence (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;)
              is committed to protecting your privacy. This Privacy Policy
              explains how we collect, use, disclose, and safeguard your
              information when you use our mobile application.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>2. Information We Collect</Text>
            <Text style={styles.bodyText}>
              We collect information that you provide directly to us:
            </Text>
            <Text style={styles.listItem}>
              • Account information (name, email address)
            </Text>
            <Text style={styles.listItem}>
              • Profile information (fitness level, preferences)
            </Text>
            <Text style={styles.listItem}>
              • Workout data (exercises, sets, reps, weights)
            </Text>
            <Text style={styles.listItem}>
              • Health data (if you choose to sync)
            </Text>
            <Text style={styles.bodyText}>
              We also automatically collect certain information about your
              device and how you interact with our App.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              3. How We Use Your Information
            </Text>
            <Text style={styles.bodyText}>
              We use the information we collect to:
            </Text>
            <Text style={styles.listItem}>
              • Provide, maintain, and improve our services
            </Text>
            <Text style={styles.listItem}>
              • Process and complete transactions
            </Text>
            <Text style={styles.listItem}>
              • Send you technical notices and support messages
            </Text>
            <Text style={styles.listItem}>
              • Respond to your comments and questions
            </Text>
            <Text style={styles.listItem}>
              • Monitor and analyze trends and usage
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              4. Data Storage and Security
            </Text>
            <Text style={styles.bodyText}>
              Your data is stored securely using industry-standard encryption.
              We use Supabase for data storage and authentication, which
              complies with GDPR and other data protection regulations.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>5. Your Rights (GDPR)</Text>
            <Text style={styles.bodyText}>
              If you are located in the European Economic Area (EEA), you have
              certain data protection rights:
            </Text>
            <Text style={styles.listItem}>
              • The right to access your personal data
            </Text>
            <Text style={styles.listItem}>
              • The right to rectify inaccurate data
            </Text>
            <Text style={styles.listItem}>
              • The right to erasure (&quot;right to be forgotten&quot;)
            </Text>
            <Text style={styles.listItem}>
              • The right to restrict processing
            </Text>
            <Text style={styles.listItem}>• The right to data portability</Text>
            <Text style={styles.listItem}>
              • The right to object to processing
            </Text>
            <Text style={styles.bodyText}>
              To exercise these rights, please contact us at
              admin@evans-software-solutions.com
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>6. Data Retention</Text>
            <Text style={styles.bodyText}>
              We retain your personal information for as long as necessary to
              provide our services and fulfill the purposes outlined in this
              Privacy Policy, unless a longer retention period is required or
              permitted by law.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>7. Third-Party Services</Text>
            <Text style={styles.bodyText}>
              We may use third-party services (such as analytics providers) that
              collect, monitor, and analyze information. These third parties
              have their own privacy policies addressing how they use such
              information.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>8. Children&apos;s Privacy</Text>
            <Text style={styles.bodyText}>
              Our App is not intended for children under the age of 13. We do
              not knowingly collect personal information from children under 13.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              9. Changes to This Privacy Policy
            </Text>
            <Text style={styles.bodyText}>
              We may update our Privacy Policy from time to time. We will notify
              you of any changes by posting the new Privacy Policy on this page
              and updating the &quot;Last Updated&quot; date.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>10. Contact Us</Text>
            <Text style={styles.bodyText}>
              If you have any questions about this Privacy Policy, please
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
