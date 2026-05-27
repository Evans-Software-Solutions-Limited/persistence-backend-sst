import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/profileLegacyTheme";

/**
 * Contact Support — pure presenter. Mailto form ported verbatim from
 * `persistence-mobile/app/contact-support.tsx`. Same field set (email
 * readonly + subject + message), same button label, same direct-email
 * footer line.
 */

export type ContactSupportPresenterProps = {
  email: string;
  subject: string;
  message: string;
  onSubjectChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSend: () => void;
  onOpenDirectEmail: () => void;
  onBack: () => void;
};

export function ContactSupportPresenter({
  email,
  subject,
  message,
  onSubjectChange,
  onMessageChange,
  onSend,
  onOpenDirectEmail,
  onBack,
}: ContactSupportPresenterProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            testID="contact-support-back"
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Contact Support</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.content} testID="contact-support-scroll">
          <View style={styles.section}>
            <Text style={styles.sectionDescription}>
              Have a question or need help? Send us a message and we&apos;ll get
              back to you as soon as possible.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Your Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              editable={false}
              placeholderTextColor={Colors.text.tertiary}
              testID="contact-support-email"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Subject</Text>
            <TextInput
              style={styles.input}
              value={subject}
              onChangeText={onSubjectChange}
              placeholder="What can we help you with?"
              placeholderTextColor={Colors.text.tertiary}
              testID="contact-support-subject"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Message</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={message}
              onChangeText={onMessageChange}
              placeholder="Describe your issue or question..."
              placeholderTextColor={Colors.text.tertiary}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              testID="contact-support-message"
            />
          </View>

          <TouchableOpacity
            style={styles.sendButton}
            onPress={onSend}
            testID="contact-support-send"
          >
            <Ionicons
              name="mail-outline"
              size={20}
              color={Colors.text.primary}
            />
            <Text style={styles.sendButtonText}>Send Message</Text>
          </TouchableOpacity>

          <View style={styles.section}>
            <Text style={styles.sectionDescription}>
              You can also reach us directly at:{" "}
              <Text
                style={styles.link}
                onPress={onOpenDirectEmail}
                testID="contact-support-direct-email"
              >
                support@persistence.app
              </Text>
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
    ...Typography.h4,
  },
  headerSpacer: {
    width: 24,
  },
  content: {
    flex: 1,
    padding: Spacing.md,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionDescription: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  label: {
    ...Typography.body1,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.surface.tertiary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    ...Typography.body1,
    color: Colors.text.primary,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  textArea: {
    minHeight: 120,
  },
  sendButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    ...Shadows.electric,
  },
  sendButtonText: {
    ...Typography.button,
    color: Colors.text.primary,
  },
  link: {
    color: Colors.primary.DEFAULT,
    textDecorationLine: "underline",
  },
});
