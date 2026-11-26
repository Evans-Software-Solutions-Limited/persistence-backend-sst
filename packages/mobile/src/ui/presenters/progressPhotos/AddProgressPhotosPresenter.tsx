import { Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "@tamagui/core";
import { LoadingSpinner } from "@/ui/components/LoadingSpinner";
import { ScreenGlow } from "@/ui/components/foundation/ScreenGlow";
import { IconCamera, IconChevronL } from "@/ui/components/icons";
import type { ProgressPhotoPose } from "@/domain/models/progressPhotos";
import { color } from "@/ui/theme/tokens";
import { IconButton, KeyValueRow, TopBar } from "../you/youKit";
import { PhotoImage, PoseChip, type PhotoPoseLabel } from "./PhotoTile";

/**
 * <AddProgressPhotosPresenter> — canvas Y3b Add photos (PER-137): Front,
 * Side and Back slots ("Tap to take"; a taken slot shows the photo and
 * "FRONT ✓" and retakes on tap), the date and that day's weight, the
 * privacy line, and a bottom button that only saves once all three are
 * taken ("Add 2 more to save" → "Save photos"). Pure.
 */

export type AddPhotoSlot = {
  pose: ProgressPhotoPose;
  label: PhotoPoseLabel;
  photo: { uri: string } | null;
  busy: boolean;
};

export type AddProgressPhotosPresenterProps = {
  slots: readonly AddPhotoSlot[];
  /** "Today, 27 Oct" */
  dateLabel: string;
  /** "82.4 kg", or "—" with no weight near today. */
  weightLabel: string;
  canSave: boolean;
  /** "Save photos" · "Add 2 more to save" */
  ctaLabel: string;
  isSaving: boolean;
  onBack(): void;
  onTakePose(pose: ProgressPhotoPose): void;
  onSave(): void;
};

function Slot(p: { slot: AddPhotoSlot; onPress(): void }) {
  const s = p.slot;
  const done = s.photo !== null;
  return (
    <Pressable
      onPress={p.onPress}
      disabled={s.busy}
      accessibilityRole="button"
      accessibilityLabel={
        done ? `${s.label} photo taken. Retake` : `${s.label} photo. Take it`
      }
      testID={`add-photo-slot-${s.pose}`}
      style={{ flex: 1 }}
    >
      <View
        height={250}
        borderRadius={16}
        overflow="hidden"
        alignItems="center"
        justifyContent="center"
        gap={8}
        borderWidth={done ? 0 : 1.5}
        borderStyle="dashed"
        borderColor="rgba(255,255,255,0.18)"
      >
        {done ? (
          <>
            <LinearGradient
              colors={["#2A2E3B", "#1A1D29"]}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
            <PhotoImage
              uri={s.photo!.uri}
              cacheKey={s.photo!.uri}
              testID={`add-photo-image-${s.pose}`}
            />
            <PoseChip label={`${s.label} ✓`} />
          </>
        ) : s.busy ? (
          <LoadingSpinner size="sm" testID={`add-photo-busy-${s.pose}`} />
        ) : (
          <>
            <IconCamera size={28} color={color.$primary} />
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={13}
              color="$text3"
            >
              {s.label}
            </Text>
            <Text fontFamily="$display" fontSize={11} color="$text3">
              Tap to take
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export function AddProgressPhotosPresenter(p: AddProgressPhotosPresenterProps) {
  const insets = useSafeAreaInsets();
  const enabled = p.canSave && !p.isSaving;
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="add-photos-screen"
    >
      <ScreenGlow />
      <TopBar
        left={
          <IconButton label="Back" onPress={p.onBack} testID="add-photos-back">
            <IconChevronL size={20} color={color.$text} />
          </IconButton>
        }
        title="Add photos"
        right={<View width={44} />}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
      >
        <Text fontFamily="$body" fontSize={14} lineHeight={20} color="$text2">
          Take all three, same spot and light each time.
        </Text>
        <View flexDirection="row" gap={8} marginTop={14}>
          {p.slots.map((slot) => (
            <Slot
              key={slot.pose}
              slot={slot}
              onPress={() => p.onTakePose(slot.pose)}
            />
          ))}
        </View>
        <View marginTop={14}>
          <KeyValueRow label="Date" value={p.dateLabel} />
          <KeyValueRow label="Weight that day" value={p.weightLabel} />
        </View>
        <Text
          marginTop={10}
          fontFamily="$body"
          fontSize={12}
          lineHeight={17}
          color="$text3"
        >
          Private to you and your coaches. Retake any photo before saving.
        </Text>
      </ScrollView>
      <View
        position="absolute"
        left={20}
        right={20}
        bottom={Math.max(insets.bottom, 16) + 14}
      >
        <Pressable
          onPress={p.onSave}
          disabled={!enabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !enabled, busy: p.isSaving }}
          testID="add-photos-save"
        >
          <View
            height={52}
            borderRadius={14}
            backgroundColor="$primary"
            opacity={p.canSave ? 1 : 0.45}
            alignItems="center"
            justifyContent="center"
          >
            {p.isSaving ? (
              <LoadingSpinner size="sm" color={color.$primaryInk} />
            ) : (
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={15}
                lineHeight={18}
                color="$primaryInk"
              >
                {p.ctaLabel}
              </Text>
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
}
