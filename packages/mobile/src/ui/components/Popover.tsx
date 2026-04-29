import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
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
                >
                  <Ionicons
                    name="close"
                    size={24}
                    color={Colors.text.primary}
                  />
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
    padding: Spacing.lg,
  },
  popover: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.xl,
    width: "100%",
    maxWidth: 500,
    ...Shadows.large,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    ...Typography.h3,
    fontSize: 18,
    color: Colors.text.primary,
    lineHeight: 22,
    marginBottom: 0,
  },
  closeButton: {
    padding: Spacing.sm,
    marginLeft: Spacing.md,
  },
  content: {
    flex: 1,
    padding: Spacing.lg,
  },
  footer: {
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.border,
  },
});
