import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LoadingSpinner } from "@/ui/components/LoadingSpinner";
import { useAppliedReferral } from "@/ui/hooks/useAppliedReferral";
import { useClaimReferral } from "@/ui/hooks/useClaimReferral";
import { color } from "@/ui/theme/tokens";

export interface ReferralCodeEntryHandle {
  cancelPendingClaim: () => void;
}

export const ReferralCodeEntry = forwardRef<
  ReferralCodeEntryHandle,
  { onboarding?: boolean }
>(function ReferralCodeEntry({ onboarding = false }, ref) {
  const appliedQuery = useAppliedReferral();
  const claim = useClaimReferral();
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const applied = appliedQuery.data ?? null;
  const isLocked = applied?.lockedAt != null;
  const trimmedCode = useMemo(() => code.trim(), [code]);

  useImperativeHandle(ref, () => ({ cancelPendingClaim: claim.cancel }), [
    claim.cancel,
  ]);

  const apply = async () => {
    try {
      await claim.mutateAsync(trimmedCode);
      setExpanded(false);
      setCode("");
    } catch {
      // The server's neutral message is rendered from the mutation state.
    }
  };

  if (applied && !expanded) {
    return (
      <View style={styles.card} testID="referral-applied">
        <View style={styles.appliedRow}>
          <Ionicons name="checkmark-circle" size={18} color={color.$success} />
          <Text style={styles.appliedText}>
            {onboarding ? "Applied" : "Referral"}: {applied.label}
          </Text>
          {!isLocked && !onboarding && (
            <TouchableOpacity
              onPress={() => {
                claim.reset();
                setCode(applied.code);
                setExpanded(true);
              }}
              accessibilityRole="button"
              testID="referral-change"
            >
              <Text style={styles.changeText}>· Change</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  if (!expanded) {
    return (
      <TouchableOpacity
        style={styles.collapsed}
        onPress={() => setExpanded(true)}
        accessibilityRole="button"
        testID="referral-entry-toggle"
      >
        <Text style={styles.collapsedText}>
          Have a referral or partner code?
        </Text>
        <Ionicons name="chevron-down" size={18} color={color.$text3} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card} testID="referral-entry-form">
      <Text style={styles.label}>Referral or partner code</Text>
      <View style={styles.inputRow}>
        <TextInput
          value={code}
          onChangeText={(value) => {
            claim.reset();
            setCode(value.toUpperCase());
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={24}
          placeholder="Enter code"
          placeholderTextColor={color.$text4}
          style={styles.input}
          testID="referral-code-input"
          accessibilityLabel="Referral or partner code"
        />
        <TouchableOpacity
          style={[
            styles.applyButton,
            (trimmedCode.length < 4 || claim.isPending) && styles.disabled,
          ]}
          disabled={trimmedCode.length < 4 || claim.isPending}
          onPress={() => void apply()}
          accessibilityRole="button"
          testID="referral-code-apply"
        >
          {claim.isPending ? (
            <LoadingSpinner size="sm" color={color.$bg} />
          ) : (
            <Text style={styles.applyText}>Apply</Text>
          )}
        </TouchableOpacity>
      </View>
      {claim.error && (
        <Text style={styles.error} testID="referral-code-error">
          {claim.error.message}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  collapsed: {
    minHeight: 48,
    marginTop: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: color.$surface,
  },
  collapsedText: { color: color.$text2, fontSize: 14, fontWeight: "600" },
  card: {
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 13,
    backgroundColor: color.$surface,
    gap: 10,
  },
  appliedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  appliedText: { flex: 1, color: color.$text, fontSize: 14, fontWeight: "600" },
  changeText: { color: color.$primary, fontSize: 14, fontWeight: "700" },
  label: { color: color.$text, fontSize: 14, fontWeight: "600" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: color.$surface3,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: color.$text,
    backgroundColor: color.$bg,
  },
  applyButton: {
    minWidth: 72,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: color.$primary,
  },
  applyText: { color: color.$bg, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  error: { color: color.$error, fontSize: 13, lineHeight: 18 },
});
