import React from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { color } from "@/ui/theme/tokens";

export interface FoundingClaimPresenterProps {
  expanded: boolean;
  email: string;
  code: string;
  codeSent: boolean;
  busy: boolean;
  claimed: boolean;
  error: string | null;
  onExpand: () => void;
  onEmailChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSend: () => void;
  onVerify: () => void;
  onChangeEmail: () => void;
}

export function FoundingClaimPresenter(props: FoundingClaimPresenterProps) {
  if (props.claimed)
    return (
      <View style={styles.card}>
        <Text style={styles.title} accessibilityLiveRegion="polite">
          Your existing access is now active.
        </Text>
      </View>
    );
  if (!props.expanded)
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={props.onExpand}
        accessibilityRole="button"
        testID="founding-claim-toggle"
      >
        <Text style={styles.title}>Claim existing access</Text>
        <Text style={styles.body}>
          Already have founding or gifted access? Link it to this account.
        </Text>
      </TouchableOpacity>
    );
  const disabled =
    props.busy ||
    (props.codeSent
      ? props.code.length !== 6
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(props.email.trim()));
  return (
    <View style={styles.card} testID="founding-claim-form">
      <Text style={styles.title}>Claim existing access</Text>
      <Text style={styles.body}>
        Use the email associated with your founding or gifted access. With Apple
        Hide My Email, this may differ from your sign-in email.
      </Text>
      {props.codeSent ? (
        <>
          <Text style={styles.body}>
            We’ve sent a six-digit code to {props.email.trim()} to verify
            ownership and check for unclaimed access. Check your inbox and spam
            folder. The code expires after 10 minutes.
          </Text>
          <TextInput
            style={styles.input}
            value={props.code}
            onChangeText={props.onCodeChange}
            editable={!props.busy}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="Six-digit code"
            placeholderTextColor={color.$text4}
            accessibilityLabel="Six-digit access code"
            testID="founding-claim-code"
          />
        </>
      ) : (
        <TextInput
          style={styles.input}
          value={props.email}
          onChangeText={props.onEmailChange}
          editable={!props.busy}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          placeholder="Email for your existing access"
          placeholderTextColor={color.$text4}
          accessibilityLabel="Email for your existing access"
          testID="founding-claim-email"
        />
      )}
      {props.error && (
        <Text style={styles.error} accessibilityRole="alert">
          {props.error}
        </Text>
      )}
      <TouchableOpacity
        style={[styles.button, disabled && styles.disabled]}
        disabled={disabled}
        onPress={props.codeSent ? props.onVerify : props.onSend}
        accessibilityRole="button"
        testID="founding-claim-submit"
      >
        <Text style={styles.buttonText}>
          {props.busy
            ? "Please wait…"
            : props.codeSent
              ? "Verify and claim access"
              : "Send verification code"}
        </Text>
      </TouchableOpacity>
      {props.codeSent && (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={props.onSend}
            disabled={props.busy}
            accessibilityRole="button"
            style={styles.textButton}
          >
            <Text style={styles.link}>Resend code</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onChangeEmail}
            disabled={props.busy}
            accessibilityRole="button"
            style={styles.textButton}
          >
            <Text style={styles.link}>Use another email</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    marginBottom: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 13,
    backgroundColor: color.$surface,
    gap: 10,
  },
  title: { color: color.$primary, fontSize: 15, fontWeight: "700" },
  body: { color: color.$text2, fontSize: 13, lineHeight: 19 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.$surface3,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: color.$text,
    backgroundColor: color.$bg,
  },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: color.$primary,
  },
  buttonText: { color: color.$bg, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  error: { color: color.$error, fontSize: 13, lineHeight: 18 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  textButton: { minHeight: 44, justifyContent: "center" },
  link: { color: color.$primary, fontSize: 13, fontWeight: "600" },
});
