import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color } from "@/ui/theme/tokens";

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
            <Ionicons name="warning" size={48} color={color.$warning} />
            <Text style={styles.modalTitle}>Cancel Subscription?</Text>
          </View>

          <Text style={styles.modalMessage}>
            Are you sure you want to cancel your subscription?
          </Text>

          <View style={styles.modalInfoBox}>
            <Ionicons
              name="information-circle"
              size={20}
              color={color.$primary}
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
    padding: 24,
  },
  modalContent: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
  },
  modalMessage: {
    fontSize: 16,
    color: color.$text,
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 24,
  },
  modalInfoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: color.$primary + "10",
    borderRadius: 12,
    padding: 16,
    gap: 8,
    marginBottom: 24,
  },
  modalInfoText: {
    flex: 1,
    fontSize: 14,
    color: color.$text2,
    lineHeight: 20,
  },
  modalButtons: {
    gap: 8,
  },
  modalButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalButtonCancel: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: color.$surface3,
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: color.$text,
  },
  modalButtonConfirm: {
    backgroundColor: color.$error,
  },
  modalButtonConfirmText: {
    fontSize: 16,
    fontWeight: "600",
    color: color.$bg,
  },
});
