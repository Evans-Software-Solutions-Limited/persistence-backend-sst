import { color } from "@/ui/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import React, { ReactNode } from "react";
import {
  DimensionValue,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface PopoverProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly header?: ReactNode;
  readonly content?: ReactNode;
  readonly footer?: ReactNode;
  readonly title?: string;
  readonly showCloseButton?: boolean;
  readonly maxHeight?: DimensionValue;
  readonly minHeight?: DimensionValue;
}

export function Popover({
  visible,
  onClose,
  header,
  content,
  footer,
  title,
  showCloseButton = true,
  maxHeight = "90%",
  minHeight = "60%",
}: PopoverProps) {
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[styles.popover, { maxHeight, minHeight }]}
          testID="popover"
        >
          {(header || title || showCloseButton) && (
            <View style={styles.header}>
              <View style={styles.headerContent}>
                {header || (title && <Text style={styles.title}>{title}</Text>)}
              </View>
              {showCloseButton && (
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  testID="close-button"
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                >
                  <Ionicons name="close" size={24} color={color.$text} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {content && (
            <ScrollView
              style={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {content}
            </ScrollView>
          )}

          {footer && <View style={styles.footer}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  popover: {
    backgroundColor: color.$surface,
    borderRadius: 24,
    width: "100%",
    maxWidth: 500,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.$surface3,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: color.$text,
    lineHeight: 22,
    marginBottom: 0,
  },
  closeButton: {
    padding: 8,
    marginLeft: 16,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: color.$surface3,
  },
});
