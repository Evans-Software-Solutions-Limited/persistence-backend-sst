import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeaderBar, IconBtn } from "@/ui/components/foundation";
import { IconBack, iconDefaults } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

// [08-profile-settings shell refresh 2026]
// Header chrome moved to <HeaderBar> + <IconBtn> foundation primitives and
// the top safe-area inset is applied to a plain container (replacing the
// SafeAreaView top edge). Static legal body kept on its StyleSheet per the
// cosmetic-refresh scope. Behaviour + testIDs unchanged.
// [01-design-system adoption sweep 2026-05-29]
// Foundation primitive shells swapped in: <Icon*> (Ionicons -> Lucide).

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
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderBar
        title="Terms of Service"
        leading={
          <IconBtn
            icon={<IconBack {...iconDefaults({ size: 20 })} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Go back"
            testID="terms-of-service-back"
          />
        }
      />

      <ScrollView style={styles.content} testID="terms-of-service-scroll">
        <Text style={styles.lastUpdated}>Last Updated: January 2025</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
          <Text style={styles.bodyText}>
            By accessing and using the Persistence mobile application
            (&quot;App&quot;), you accept and agree to be bound by the terms and
            provision of this agreement. If you do not agree to these terms,
            please do not use the App.
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
            the advice of your physician or other qualified health provider with
            any questions you may have regarding a medical condition or fitness
            program.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Limitation of Liability</Text>
          <Text style={styles.bodyText}>
            In no event shall Persistence or its suppliers be liable for any
            damages (including, without limitation, damages for loss of data or
            profit, or due to business interruption) arising out of the use or
            inability to use the App, even if Persistence or a Persistence
            authorized representative has been notified orally or in writing of
            the possibility of such damage.
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  lastUpdated: {
    fontSize: 12,
    fontWeight: "400" as const,
    lineHeight: 16,
    color: color.$text3,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 8,
  },
  listItem: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    marginLeft: 16,
    marginBottom: 4,
  },
});
