import { Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "@tamagui/core";

/**
 * PER-137: canvas `.photo3` / `.pt` — three photo tiles in a row, each on
 * the dark gradient with its pose chip top-left ("FRONT"). Images are
 * cached on disk by `cacheKey` (the photo id), never by the expiring link.
 */

export type PhotoPoseLabel = "Front" | "Side" | "Back";

export type PhotoTileView = {
  pose: PhotoPoseLabel;
  uri: string;
  cacheKey: string;
};

/** Canvas `.pt b`: 10pt uppercase pose chip on a dark pill. */
export function PoseChip(p: { label: string }) {
  return (
    <View
      position="absolute"
      left={8}
      top={8}
      paddingHorizontal={6}
      paddingVertical={3}
      borderRadius={6}
      backgroundColor="rgba(10,11,18,0.6)"
    >
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={10}
        lineHeight={12}
        letterSpacing={1.2}
        textTransform="uppercase"
        color="$text2"
      >
        {p.label}
      </Text>
    </View>
  );
}

export function PhotoImage(p: {
  uri: string;
  cacheKey: string;
  fit?: "cover" | "contain";
  testID?: string;
}) {
  return (
    <Image
      source={{ uri: p.uri, cacheKey: p.cacheKey }}
      cachePolicy="disk"
      contentFit={p.fit ?? "cover"}
      transition={150}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      accessible={false}
      testID={p.testID}
    />
  );
}

function PhotoTile(p: {
  photo: PhotoTileView;
  dateLabel: string;
  onPress(): void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${p.photo.pose} photo, ${p.dateLabel}. Open`}
      testID={p.testID}
      style={{ flex: 1 }}
    >
      <View height={120} borderRadius={12} overflow="hidden">
        {/* Canvas `.pt`: linear-gradient(180deg, #2a2e3b, #1a1d29). */}
        <LinearGradient
          colors={["#2A2E3B", "#1A1D29"]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <PhotoImage uri={p.photo.uri} cacheKey={p.photo.cacheKey} />
        <PoseChip label={p.photo.pose} />
      </View>
    </Pressable>
  );
}

/** Canvas `.photo3`: the set's three tiles, 6pt apart, 10pt below the head. */
export function PhotoRow(p: {
  photos: readonly PhotoTileView[];
  dateLabel: string;
  onOpen(pose: PhotoPoseLabel): void;
  testID?: string;
}) {
  return (
    <View flexDirection="row" gap={6} marginTop={10} testID={p.testID}>
      {p.photos.map((photo) => (
        <PhotoTile
          key={photo.pose}
          photo={photo}
          dateLabel={p.dateLabel}
          onPress={() => p.onOpen(photo.pose)}
          testID={p.testID ? `${p.testID}-${photo.pose}` : undefined}
        />
      ))}
    </View>
  );
}
