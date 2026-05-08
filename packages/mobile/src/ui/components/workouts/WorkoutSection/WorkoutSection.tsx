import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";

interface WorkoutSectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  emptyTitle?: string;
  emptyIcon?: string;
  defaultExpanded?: boolean;
}

export function WorkoutSection({
  title,
  subtitle,
  children,
  isLoading = false,
  isEmpty = false,
  emptyMessage = "No items available",
  emptyTitle = "Empty",
  emptyIcon = "fitness",
  defaultExpanded = true,
}: WorkoutSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={handleToggle}>
        <View style={styles.sectionHeaderContent}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
        </View>
        <Ionicons
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={20}
          color={Colors.text.secondary}
        />
      </TouchableOpacity>

      {isExpanded && (
        <View>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <PLogoDrawLoader />
              <Text style={styles.loadingText}>Loading workouts...</Text>
            </View>
          ) : isEmpty ? (
            <View style={styles.emptyContainer}>
              <Ionicons
                name={emptyIcon as any}
                size={48}
                color={Colors.text.tertiary}
              />
              <Text style={styles.emptyTitle}>{emptyTitle}</Text>
              <Text style={styles.emptyMessage}>{emptyMessage}</Text>
            </View>
          ) : (
            children
          )}
        </View>
      )}
    </View>
  );
}
