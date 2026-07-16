import { color } from "@/ui/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";

interface ExerciseDetailsModalProps {
  readonly exercise: any; // Using any to match the original
}

const getDifficultyColor = (difficulty: string | null | undefined) => {
  if (!difficulty) return color.$text2;

  switch (difficulty) {
    case "beginner":
      return color.$success;
    case "intermediate":
      return color.$warning;
    case "advanced":
      return color.$error;
    case "expert":
      return color.$primary;
    default:
      return color.$text2;
  }
};

export function ExerciseDetailsModal({ exercise }: ExerciseDetailsModalProps) {
  const handlePlayVideo = (videoUrl: string) => {
    Linking.openURL(videoUrl).catch(() => {
      Alert.alert("Error", "Could not open video");
    });
  };

  // Content-only — the modal frame (header w/ back button, title) is
  // owned by the parent AddExercisePopover. This component renders
  // just the body of the details surface.
  return (
    <View style={styles.container}>
      <View style={styles.content}>
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
                      contentFit="cover"
                      transition={200}
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={styles.mediaPlaceholder}>
                      <Ionicons name="play" size={48} color={color.$text} />
                    </View>
                  )}
                  <View style={styles.playButton}>
                    <Ionicons name="play" size={24} color={color.$text} />
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
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory-disk"
                />
              );
            }

            return (
              <View style={styles.defaultPlaceholder}>
                <Ionicons name="fitness" size={48} color={color.$text3} />
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No `flex: 1` here — this surface renders inside Popover's
  // ScrollView, where flex-grow children collapse to 0 height.
  container: {
    backgroundColor: color.$bg,
  },
  difficultyBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  difficultyBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.$surface3,
  },
  backButton: {
    padding: 8,
  },
  screenTitle: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  placeholder: {
    width: 40,
  },
  content: {},
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
    backgroundColor: color.$surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  defaultPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: color.$surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  defaultPlaceholderText: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text3,
    marginTop: 8,
  },
  videoContainer: {
    position: "relative",
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 8,
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
    top: 16,
    right: 16,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fullVideoText: {
    fontSize: 12,
    lineHeight: 16,
    color: color.$text,
    fontWeight: "600",
  },
  titleSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
    marginBottom: 8,
  },
  exerciseName: {
    lineHeight: 32,
    fontWeight: "400",
    fontSize: 22,
    color: color.$text,
  },
  exerciseInfoSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  infoSection: {
    marginBottom: 24,
  },
  infoTitle: {
    fontWeight: "600",
    lineHeight: 28,
    fontSize: 18,
    marginBottom: 8,
    color: color.$text,
  },
  infoText: {
    fontSize: 16,
    fontWeight: "400",
    color: color.$text2,
    lineHeight: 24,
  },
});
