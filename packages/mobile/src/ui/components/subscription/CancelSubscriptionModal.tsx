import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Cancellation-confirmation modal. Ported 1:1 from legacy
 * `persistence-mobile/app/(auth)/subscription-selection.tsx` lines
 * 567–636 (the inline `CancelSubscriptionModal` component).
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 3.5
 *
 * Pure presenter — visibility controlled by the parent rendering /
 * unmounting it. Two CTAs: confirm + dismiss. While processing,
 * confirm button shows "Cancelling..." and both are disabled.
 */

export interface CancelSubscriptionModalProps {
  /** ISO date string; falls back to a generic "current billing period" string. */
  subscriptionEndsAt?: string;
  onConfirm: () => void;
  onDismiss: () => void;
  isProcessing: boolean;
}

function formatEndDate(dateString?: string): string {
  if (!dateString) return "the end of your current billing period";
  return new Date(dateString).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function CancelSubscriptionModal({
  subscriptionEndsAt,
  onConfirm,
  onDismiss,
  isProcessing,
}: CancelSubscriptionModalProps) {
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      testID="cancel-subscription-modal"
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Ionicons name="warning" size={48} color={Colors.warning.DEFAULT} />
            <Text style={styles.modalTitle}>Cancel Subscription?</Text>
          </View>

          <Text style={styles.modalMessage}>
            Are you sure you want to cancel your subscription?
          </Text>

          <View style={styles.modalInfoBox}>
            <Ionicons
              name="information-circle"
              size={20}
              color={Colors.primary.DEFAULT}
            />
            <Text style={styles.modalInfoText}>
              Your subscription perks will remain active until{" "}
              {formatEndDate(subscriptionEndsAt)}. You&apos;ll continue to have
              access to all features until then.
            </Text>
          </View>

          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonCancel]}
              onPress={onDismiss}
              disabled={isProcessing}
              testID="cancel-modal-dismiss"
            >
              <Text style={styles.modalButtonCancelText}>
                Keep Subscription
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonConfirm]}
              onPress={onConfirm}
              disabled={isProcessing}
              testID="cancel-modal-confirm"
            >
              <Text style={styles.modalButtonConfirmText}>
                {isProcessing ? "Cancelling..." : "Cancel Subscription"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalContent: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: "100%",
    maxWidth: 400,
    ...Shadows.large,
  },
  modalHeader: {
    alignItems: "center",
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text.primary,
    textAlign: "center",
  },
  modalMessage: {
    fontSize: 16,
    color: Colors.text.primary,
    textAlign: "center",
    marginBottom: Spacing.md,
    lineHeight: 24,
  },
  modalInfoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.primary.DEFAULT + "10",
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  modalInfoText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  modalButtons: {
    gap: Spacing.sm,
  },
  modalButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  modalButtonCancel: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  modalButtonConfirm: {
    backgroundColor: Colors.error.DEFAULT,
  },
  modalButtonConfirmText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.inverse,
  },
});
