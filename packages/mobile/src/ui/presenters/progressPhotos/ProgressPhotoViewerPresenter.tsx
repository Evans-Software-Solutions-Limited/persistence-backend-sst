import { Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "@tamagui/core";
import {
  IconCamera,
  IconChevronD,
  IconTrash,
  IconX,
} from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import { IconButton } from "../you/youKit";
import { PhotoImage, type PhotoPoseLabel } from "./PhotoTile";

/**
 * <ProgressPhotoViewerPresenter> — canvas Y3c photo viewer, LANDSCAPE
 * (Brad, 26 Nov: landscape only, for this page; the container turns the
 * screen). The photo fills the screen; one bar across the top, as on the
 * canvas: Close, one dropdown for pose and date ("Front · 25 Oct 2026"),
 * that date's weight, body fat and change vs the latest photos, then
 * Delete (Brad approved, not drawn) and Add photos. The dropdown holds the
 * pose switch and every date with photos. Pure.
 */

export type ViewerDateOption = {
  id: string;
  /** "25 Oct 2026" */
  label: string;
  /** "82.4 kg" or "" */
  weight: string;
  selected: boolean;
};

export type ProgressPhotoViewerPresenterProps = {
  photo: { uri: string; cacheKey: string } | null;
  pose: PhotoPoseLabel;
  dateLabel: string;
  /** Weight · Body fat · vs latest, values already formatted. */
  data: readonly { value: string; label: string }[];
  accessibilityLabel: string;
  open: boolean;
  dates: readonly ViewerDateOption[];
  onClose(): void;
  onToggle(): void;
  onSelectPose(pose: PhotoPoseLabel): void;
  onSelectDate(id: string): void;
  onAdd(): void;
  onDelete(): void;
};

const POSES: PhotoPoseLabel[] = ["Front", "Side", "Back"];

export function ProgressPhotoViewerPresenter(
  p: ProgressPhotoViewerPresenterProps,
) {
  const insets = useSafeAreaInsets();
  // Canvas bar: 18pt top, 28pt sides, clear of the notch in landscape.
  const barTop = insets.top + 18;
  const barLeft = Math.max(insets.left, 28);
  const barRight = Math.max(insets.right, 28);
  return (
    <View flex={1} backgroundColor="$bg" testID="photo-viewer-screen">
      <View
        flex={1}
        accessible
        accessibilityRole="image"
        accessibilityLabel={p.accessibilityLabel}
      >
        <LinearGradient
          colors={["#2A2E3B", "#141620"]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {p.photo && (
          <PhotoImage
            uri={p.photo.uri}
            cacheKey={p.photo.cacheKey}
            fit="contain"
            testID="photo-viewer-image"
          />
        )}
      </View>

      <LinearGradient
        colors={["rgba(10,11,18,0.85)", "rgba(10,11,18,0)"]}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          paddingTop: barTop,
          paddingLeft: barLeft,
          paddingRight: barRight,
          paddingBottom: 24,
        }}
      >
        <View flexDirection="row" alignItems="center" gap={14}>
          <IconButton
            label="Close"
            onPress={p.onClose}
            testID="photo-viewer-close"
          >
            <IconX size={20} color={color.$text} />
          </IconButton>
          <Pressable
            onPress={p.onToggle}
            accessibilityRole="button"
            accessibilityLabel={`${p.pose} · ${p.dateLabel}. Choose a photo`}
            accessibilityState={{ expanded: p.open }}
            testID="photo-viewer-dropdown"
            style={{ flexShrink: 1 }}
          >
            <View
              flexDirection="row"
              alignItems="center"
              gap={8}
              height={44}
              paddingHorizontal={14}
              borderRadius={12}
              backgroundColor="rgba(18,20,29,0.9)"
              borderWidth={1}
              borderColor="$border3"
            >
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={15}
                color="$text"
                numberOfLines={1}
                flexShrink={1}
              >
                {`${p.pose} · ${p.dateLabel}`}
              </Text>
              <IconChevronD size={16} color={color.$text} />
            </View>
          </Pressable>
          <View
            flexDirection="row"
            gap={22}
            marginLeft={8}
            testID="photo-viewer-stats"
          >
            {p.data.map((d) => (
              <View key={d.label} testID={`photo-viewer-data-${d.label}`}>
                <Text
                  fontFamily="$mono"
                  fontWeight="600"
                  fontSize={16}
                  color="$text"
                >
                  {d.value}
                </Text>
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={10}
                  letterSpacing={1.4}
                  textTransform="uppercase"
                  color="$text3"
                >
                  {d.label}
                </Text>
              </View>
            ))}
          </View>
          <View flex={1} />
          <IconButton
            label="Delete these photos"
            onPress={p.onDelete}
            testID="photo-viewer-delete"
          >
            <IconTrash size={18} color={color.$text2} />
          </IconButton>
          <IconButton
            label="Add photos"
            onPress={p.onAdd}
            testID="photo-viewer-add"
          >
            <IconCamera size={20} color={color.$primary} />
          </IconButton>
        </View>
      </LinearGradient>

      {p.open && (
        <View
          position="absolute"
          top={barTop + 52}
          left={barLeft + 58}
          width={300}
          maxHeight={260}
          borderRadius={16}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="rgba(255,255,255,0.12)"
          padding={10}
          gap={6}
          accessibilityLabel="Choose a photo"
          testID="photo-viewer-listbox"
        >
          <View
            flexDirection="row"
            gap={2}
            padding={3}
            borderRadius={999}
            backgroundColor="$surface"
            borderWidth={1}
            borderColor="rgba(255,255,255,0.08)"
            accessibilityRole="tablist"
            accessibilityLabel="Pose"
          >
            {POSES.map((pose) => {
              const on = pose === p.pose;
              return (
                <Pressable
                  key={pose}
                  onPress={() => p.onSelectPose(pose)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  testID={`photo-viewer-pose-${pose}`}
                  style={{ flex: 1 }}
                >
                  <View
                    height={32}
                    borderRadius={999}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={on ? "$surface4" : "transparent"}
                  >
                    <Text
                      fontFamily="$display"
                      fontWeight="600"
                      fontSize={13}
                      color={on ? "$text" : "$text3"}
                    >
                      {pose}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <ScrollView>
            {p.dates.map((d) => (
              <Pressable
                key={d.id}
                onPress={() => p.onSelectDate(d.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: d.selected }}
                testID={`photo-viewer-date-${d.id}`}
              >
                <View
                  flexDirection="row"
                  alignItems="center"
                  gap={10}
                  minHeight={44}
                  paddingHorizontal={12}
                  borderRadius={10}
                  backgroundColor={
                    d.selected ? "rgba(34,211,238,0.12)" : "transparent"
                  }
                >
                  <Text
                    flex={1}
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={14}
                    color="$text"
                  >
                    {d.label}
                  </Text>
                  <Text fontFamily="$mono" fontSize={12} color="$text3">
                    {d.weight}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
