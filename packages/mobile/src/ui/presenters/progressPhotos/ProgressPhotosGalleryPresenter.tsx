import { RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { ScreenGlow } from "@/ui/components/foundation/ScreenGlow";
import { IconCamera, IconChevronL } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import { IconButton, TopBar } from "../you/youKit";
import {
  AddPhotosButton,
  EmptyPhotoRow,
  PhotoRow,
  type PhotoPoseLabel,
  type PhotoTileView,
} from "./PhotoTile";

/**
 * <ProgressPhotosGalleryPresenter> — canvas Y3 Gallery (PER-137): back,
 * "Gallery", a cyan camera button; "Add today's photos"; then each date's
 * set of three, newest first, with that date's weight on the right. A tile
 * opens the Y3c viewer on that pose. Pure.
 */

export type GallerySetView = {
  id: string;
  /** "25 Oct" */
  dateLabel: string;
  /** The weight ("82.4 kg"), or the upload state for a set on the phone. */
  detail: string;
  photos: PhotoTileView[];
};

export type ProgressPhotosGalleryPresenterProps = {
  sets: readonly GallerySetView[];
  /**
   * Shown while sets wait to upload: without `expo-file-system` they're
   * kept in the phone's temporary storage (design F fallback).
   */
  pendingWarning: string | null;
  isRefreshing: boolean;
  onRefresh(): void;
  onBack(): void;
  onAdd(): void;
  onOpenPhoto(setId: string, pose: PhotoPoseLabel): void;
};

export function ProgressPhotosGalleryPresenter(
  p: ProgressPhotosGalleryPresenterProps,
) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="photo-gallery-screen"
    >
      <ScreenGlow />
      <TopBar
        left={
          <IconButton
            label="Back"
            onPress={p.onBack}
            testID="photo-gallery-back"
          >
            <IconChevronL size={20} color={color.$text} />
          </IconButton>
        }
        title="Gallery"
        right={
          <IconButton
            label="Add photos"
            onPress={p.onAdd}
            testID="photo-gallery-add-icon"
          >
            <IconCamera size={20} color={color.$primary} />
          </IconButton>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            refreshing={p.isRefreshing}
            onRefresh={p.onRefresh}
            tintColor={color.$primary}
          />
        }
      >
        <AddPhotosButton onPress={p.onAdd} testID="photo-gallery-add" />

        {p.pendingWarning && (
          <Text
            marginTop={12}
            fontFamily="$body"
            fontSize={12}
            lineHeight={17}
            color="$text3"
            testID="photo-gallery-pending-warning"
          >
            {p.pendingWarning}
          </Text>
        )}

        {p.sets.length === 0 && (
          <EmptyPhotoRow marginTop={18} testID="photo-gallery-empty" />
        )}

        {p.sets.map((set) => (
          <View key={set.id} testID={`photo-set-${set.id}`}>
            <View
              flexDirection="row"
              alignItems="baseline"
              justifyContent="space-between"
              marginTop={18}
            >
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={15}
                color="$text"
              >
                {set.dateLabel}
              </Text>
              <Text fontFamily="$mono" fontSize={12} color="$text3">
                {set.detail}
              </Text>
            </View>
            <PhotoRow
              photos={set.photos}
              dateLabel={set.dateLabel}
              onOpen={(pose) => p.onOpenPhoto(set.id, pose)}
              testID={`photo-set-${set.id}-tiles`}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
