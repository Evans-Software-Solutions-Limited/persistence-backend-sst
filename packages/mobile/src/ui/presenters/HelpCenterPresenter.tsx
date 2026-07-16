import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeaderBar, IconBtn } from "@/ui/components/foundation";
import {
  IconBack,
  IconChevronR,
  IconMail,
  iconDefaults,
} from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

// [08-profile-settings shell refresh 2026]
// Header chrome moved to <HeaderBar> + <IconBtn> foundation primitives and
// the top safe-area inset is applied to a plain container (replacing the
// SafeAreaView top edge). FAQ list + Contact Support row kept on their
// StyleSheet per the cosmetic-refresh scope. Behaviour + testIDs unchanged.
// [01-design-system adoption sweep 2026-05-29]
// Foundation primitive shells swapped in: <Icon*> (Ionicons -> Lucide).

/**
 * Help Center — pure presenter. FAQ list + Contact Support CTA ported
 * verbatim from `persistence-mobile/app/help-center.tsx`. Five Q+A pairs
 * are inlined as the FAQ_ITEMS constant — same content, same order.
 */

type FaqItem = {
  question: string;
  answer: string;
};

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "How do I create a workout?",
    answer:
      'Go to the Workouts tab and tap the "+" button. You can add exercises, set reps and sets, and customize your workout.',
  },
  {
    question: "How do I track my progress?",
    answer:
      "Your progress is automatically tracked when you complete workouts. View your stats, personal records, and body measurements in the Progress tab.",
  },
  {
    question: "Can I connect with a personal trainer?",
    answer:
      "Yes! You can connect with a personal trainer through the app. They can assign workouts and track your progress.",
  },
  {
    question: "How do I sync my health data?",
    answer:
      "Go to Profile > Health Data to connect your Apple Health or Google Fit account. This allows us to sync steps, calories, and other health metrics.",
  },
  {
    question: "How do I change my subscription?",
    answer:
      'Go to Profile > Subscription and tap "Manage Subscription" to upgrade, downgrade, or cancel your subscription.',
  },
];

export type HelpCenterPresenterProps = {
  onBack: () => void;
  onContactSupport: () => void;
};

export function HelpCenterPresenter({
  onBack,
  onContactSupport,
}: HelpCenterPresenterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderBar
        title="Help Center"
        leading={
          <IconBtn
            icon={<IconBack {...iconDefaults({ size: 20 })} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Go back"
            testID="help-center-back"
          />
        }
      />

      <ScrollView style={styles.content} testID="help-center-scroll">
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {FAQ_ITEMS.map((item, index) => (
            <View
              key={index}
              style={styles.faqItem}
              testID={`help-center-faq-${index}`}
            >
              <Text style={styles.faqQuestion}>{item.question}</Text>
              <Text style={styles.faqAnswer}>{item.answer}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Need More Help?</Text>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={onContactSupport}
            testID="help-center-contact-support"
          >
            <IconMail size={20} color={color.$primary} />
            <Text style={styles.actionButtonText}>Contact Support</Text>
            <IconChevronR size={20} color={color.$text2} />
          </TouchableOpacity>
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
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 16,
  },
  faqItem: {
    backgroundColor: color.$surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  faqQuestion: {
    fontSize: 16,
    fontWeight: "600" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 4,
  },
  faqAnswer: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
  },
  actionButton: {
    backgroundColor: color.$surface,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    flex: 1,
  },
});
