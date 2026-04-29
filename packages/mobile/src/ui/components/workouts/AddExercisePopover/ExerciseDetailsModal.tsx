import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface ExerciseDetailsModalProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly exercise: any; // Using any to match the original
  readonly onBack: () => void;
}

const getDifficultyColor = (difficulty: string | null | undefined) => {
  if (!difficulty) return Colors.text.secondary;

  switch (difficulty) {
    case "beginner":
      return Colors.success.DEFAULT;
    case "intermediate":
      return Colors.warning.DEFAULT;
    case "advanced":
      return Colors.error.DEFAULT;
    case "expert":
      return Colors.primary.DEFAULT;
    default:
      return Colors.text.secondary;
  }
};

export function ExerciseDetailsModal({
  exercise,
  onBack,
}: ExerciseDetailsModalProps) {
  const handlePlayVideo = (videoUrl: string) => {
    Linking.openURL(videoUrl).catch(() => {
      Alert.alert("Error", "Could not open video");
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Exercise Details</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Video/Image Section */}
        <View style={styles.mediaSection}>
          {(() => {
            if (exercise.video_url) {
              return (
                <TouchableOpacity
                  style={styles.videoContainer}
                  onPress={() => handlePlayVideo(exercise.video_url!)}
                >
                  {exercise.thumbnail_url ? (
                    <Image
                      source={{ uri: exercise.thumbnail_url }}
                      style={styles.mediaImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.mediaPlaceholder}>
                      <Ionicons
                        name="play"
                        size={48}
                        color={Colors.text.primary}
                      />
                    </View>
                  )}
                  <View style={styles.playButton}>
                    <Ionicons
                      name="play"
                      size={24}
                      color={Colors.text.primary}
                    />
                  </View>
                  <View style={styles.fullVideoButton}>
                    <Text style={styles.fullVideoText}>FULL VIDEO</Text>
                  </View>
                </TouchableOpacity>
              );
            }

            if (exercise.thumbnail_url) {
              return (
                <Image
                  source={{ uri: exercise.thumbnail_url }}
                  style={styles.mediaImage}
                  resizeMode="cover"
                />
              );
            }

            return (
              <View style={styles.defaultPlaceholder}>
                <Ionicons
                  name="fitness"
                  size={48}
                  color={Colors.text.tertiary}
                />
                <Text style={styles.defaultPlaceholderText}>
                  Exercise Image
                </Text>
              </View>
            );
          })()}
        </View>

        {/* Exercise Name */}
        <View style={styles.titleSection}>
          <Text style={styles.exerciseName}>{exercise.name}</Text>
        </View>

        {/* Exercise Information */}
        <View style={styles.exerciseInfoSection}>
          {/* Description */}
          {exercise.description && (
            <View style={styles.infoSection}>
              <Text style={styles.infoTitle}>Description</Text>
              <Text style={styles.infoText}>{exercise.description}</Text>
            </View>
          )}

          {/* Instructions */}
          {exercise.instructions && (
            <View style={styles.infoSection}>
              <Text style={styles.infoTitle}>Instructions</Text>
              <Text style={styles.infoText}>{exercise.instructions}</Text>
            </View>
          )}

          {/* Primary Muscles */}
          {exercise.primary_muscles && exercise.primary_muscles.length > 0 && (
            <View style={styles.infoSection}>
              <Text style={styles.infoTitle}>Primary Muscles</Text>
              <Text style={styles.infoText}>
                {exercise.primary_muscles
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .map((muscle: any) => muscle.display_name || muscle.name)
                  .join(", ")}
              </Text>
            </View>
          )}

          {/* Equipment */}
          {exercise.equipment_required &&
            exercise.equipment_required.length > 0 && (
              <View style={styles.infoSection}>
                <Text style={styles.infoTitle}>Equipment</Text>
                <Text style={styles.infoText}>
                  {exercise.equipment_required
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((eq: any) => eq.name)
                    .join(", ")}
                </Text>
              </View>
            )}

          {/* Difficulty */}
          {exercise.difficulty_level && (
            <View style={styles.infoSection}>
              <Text style={styles.infoTitle}>Difficulty</Text>
              <View style={styles.difficultyContainer}>
                <View
                  style={[
                    styles.difficultyBadge,
                    {
                      backgroundColor:
                        getDifficultyColor(exercise.difficulty_level) + "20",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.difficultyBadgeText,
                      { color: getDifficultyColor(exercise.difficulty_level) },
                    ]}
                  >
                    {exercise.difficulty_level
                      ? exercise.difficulty_level.charAt(0).toUpperCase() +
                        exercise.difficulty_level.slice(1)
                      : "Unknown"}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  difficultyBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  difficultyBadge: {
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  difficultyContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  backButton: {
    padding: Spacing.sm,
  },
  screenTitle: {
    ...Typography.body1,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  mediaSection: {
    width: "100%",
    height: 250,
  },
  mediaImage: {
    width: "100%",
    height: "100%",
  },
  mediaPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: Colors.surface.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  defaultPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: Colors.surface.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  defaultPlaceholderText: {
    ...Typography.body2,
    color: Colors.text.tertiary,
    marginTop: Spacing.sm,
  },
  videoContainer: {
    position: "relative",
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    marginTop: Spacing.sm,
  },
  playButton: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: [{ translateX: -24 }, { translateY: -24 }],
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 24,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  fullVideoButton: {
    position: "absolute",
    top: Spacing.md,
    right: Spacing.md,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  fullVideoText: {
    ...Typography.caption,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  titleSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  exerciseName: {
    ...Typography.h2,
    fontWeight: "400",
    fontSize: 22,
    color: Colors.text.primary,
  },
  exerciseInfoSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  infoSection: {
    marginBottom: Spacing.lg,
  },
  infoTitle: {
    ...Typography.h3,
    fontSize: 18,
    marginBottom: Spacing.sm,
    color: Colors.text.primary,
  },
  infoText: {
    ...Typography.body1,
    color: Colors.text.secondary,
    lineHeight: 24,
  },
});
