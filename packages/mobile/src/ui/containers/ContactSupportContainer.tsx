import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking } from "react-native";
import { ContactSupportPresenter } from "@/ui/presenters/ContactSupportPresenter";
import { useAuth } from "@/ui/hooks/useAuth";

/**
 * M12: Contact Support container.
 *
 * Same UX as legacy `persistence-mobile/app/contact-support.tsx`:
 * - Email field is readonly, sourced from `session.email` (V2 equivalent
 *   of legacy `useGetUser().data?.email`).
 * - Send button validates both fields are non-empty, then opens the
 *   system mail client with `mailto:support@persistence.app`, subject +
 *   body pre-encoded. Body prefixes with `From: <email>` so support sees
 *   who wrote in even if the user's mail client re-writes the From: header.
 * - If `Linking.openURL` rejects, we surface the same fallback Alert
 *   legacy did, naming the direct support address.
 */
export const SUPPORT_EMAIL = "support@persistence.app";

export function ContactSupportContainer() {
  const router = useRouter();
  const { session } = useAuth();
  const email = session?.email ?? "";

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  const onSend = useCallback(() => {
    if (!subject || !message) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    const emailBody = `From: ${email || "Unknown"}\n\n${message}`;
    const mailtoLink = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(emailBody)}`;
    Linking.openURL(mailtoLink).catch(() => {
      Alert.alert(
        "Error",
        `Could not open email client. Please send an email to ${SUPPORT_EMAIL}`,
      );
    });
  }, [subject, message, email]);

  const onOpenDirectEmail = useCallback(() => {
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
  }, []);

  return (
    <ContactSupportPresenter
      email={email}
      subject={subject}
      message={message}
      onSubjectChange={setSubject}
      onMessageChange={setMessage}
      onSend={onSend}
      onOpenDirectEmail={onOpenDirectEmail}
      onBack={onBack}
    />
  );
}
