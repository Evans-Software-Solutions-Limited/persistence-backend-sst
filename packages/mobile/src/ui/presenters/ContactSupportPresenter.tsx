import React from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { IconBack, iconDefaults } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

// [08-profile-settings shell refresh 2026]
// Header chrome moved to <HeaderBar> + <IconBtn> and the Send Message CTA to
// the <Btn> foundation primitive (filled/primary). Top safe-area inset is
// applied to a plain container (replacing the SafeAreaView top edge). The
// mailto form body is kept on its StyleSheet per the cosmetic-refresh scope.
// Behaviour, props + testIDs unchanged.
// [01-design-system adoption sweep 2026-05-29]
// Foundation primitive shells swapped in: <Icon*> (Ionicons -> Lucide).

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
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderBar
        title="Contact Support"
        leading={
          <IconBtn
            icon={<IconBack {...iconDefaults({ size: 20 })} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Go back"
            testID="contact-support-back"
          />
        }
      />

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
            placeholderTextColor={color.$text3}
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
            placeholderTextColor={color.$text3}
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
            placeholderTextColor={color.$text3}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            testID="contact-support-message"
          />
        </View>

        <View style={styles.sendButton}>
          <Btn
            variant="filled"
            tone="primary"
            full
            onPress={onSend}
            testID="contact-support-send"
          >
            Send Message
          </Btn>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionDescription}>
            You can also reach us directly at:{" "}
            <Text
              style={styles.link}
              onPress={onOpenDirectEmail}
              testID="contact-support-direct-email"
            >
              admin@evans-software-solutions.com
            </Text>
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
  section: {
    marginBottom: 24,
  },
  sectionDescription: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
  },
  label: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: color.$surface3,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    borderWidth: 1,
    borderColor: color.$surface3,
  },
  textArea: {
    minHeight: 120,
  },
  sendButton: {
    marginBottom: 24,
  },
  link: {
    color: color.$primary,
    textDecorationLine: "underline",
  },
});
