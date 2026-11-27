import type { ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "@tamagui/core";
import { PhotoImage } from "@/ui/presenters/progressPhotos/PhotoTile";

/**
 * PER-138 shared pieces for C3.4b/c: the board's photo placeholder (160°
 * gradient, faint centred label) with the photo over it once it loads, and
 * the weight / body fat / apart strip.
 */

export type CoachPhotoView = {
  /** Photo id: the image's cache key, never the expiring link. */
  id: string;
  uri: string;
};

/** Canvas photo block: `linear-gradient(160deg, #2d3243, #1a1d29)`. */
export function CoachPhotoTile(p: {
  photo: CoachPhotoView | null;
  label: string;
  width?: number;
  height: number;
  radius: number;
  /** Hide the placeholder text (the canvas' small row thumbs have none). */
  bare?: boolean;
  flex?: number;
  testID?: string;
}) {
  return (
    <View
      width={p.width}
      flex={p.flex}
      height={p.height}
      borderRadius={p.radius}
      overflow="hidden"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.08)"
      alignItems="center"
      justifyContent="center"
      accessible
      accessibilityRole="image"
      accessibilityLabel={p.label}
      testID={p.testID}
    >
      <LinearGradient
        colors={["#2D3243", "#1A1D29"]}
        start={{ x: 0.33, y: 0 }}
        end={{ x: 0.67, y: 1 }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {p.bare ? null : (
        <Text
          fontFamily="$body"
          fontWeight="500"
          fontSize={10.5}
          color="#5C5C68"
          textAlign="center"
        >
          {p.label}
        </Text>
      )}
      {p.photo ? (
        <PhotoImage
          uri={p.photo.uri}
          cacheKey={p.photo.id}
          testID={p.testID ? `${p.testID}-image` : undefined}
        />
      ) : null}
    </View>
  );
}

/** Canvas `.eb`: 11pt uppercase label, with an optional link on the right. */
export function PhotosEyebrow(p: {
  title: string;
  marginTop?: number;
  children?: ReactNode;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="baseline"
      gap={8}
      marginTop={p.marginTop}
      marginBottom={8}
      testID={p.testID}
    >
      <Text
        flex={1}
        fontFamily="$body"
        fontWeight="600"
        fontSize={11}
        lineHeight={14}
        letterSpacing={2.6}
        textTransform="uppercase"
        color="$text3"
      >
        {p.title}
      </Text>
      {p.children}
    </View>
  );
}

export type CompareStripView = {
  weight: { from: string; to: string };
  weightUnit: "kg" | "lb";
  bodyFat: { from: string; to: string };
  apart: { value: string; unit: string };
};

function StripCell(p: {
  value: string;
  suffix: string;
  label: string;
  first?: boolean;
  testID?: string;
}) {
  return (
    <View
      flex={1}
      gap={3}
      paddingLeft={p.first ? 0 : 14}
      borderLeftWidth={p.first ? 0 : 1}
      borderLeftColor="rgba(255,255,255,0.08)"
      testID={p.testID}
    >
      <Text
        fontFamily="$mono"
        fontWeight="700"
        fontSize={15}
        lineHeight={20}
        letterSpacing={-0.5}
        color="$text"
      >
        {p.value}
        <Text fontFamily="$mono" fontWeight="500" fontSize={12} color="$text3">
          {p.suffix}
        </Text>
      </Text>
      <Text
        fontFamily="$body"
        fontWeight="600"
        fontSize={10}
        lineHeight={12}
        letterSpacing={1.6}
        textTransform="uppercase"
        color="$text3"
      >
        {p.label}
      </Text>
    </View>
  );
}

/** Canvas `.strip`: weight, body fat and time apart for the two dates. */
export function CompareStripRow(p: { strip: CompareStripView }) {
  return (
    <View
      flexDirection="row"
      paddingVertical={12}
      borderTopWidth={1}
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      testID="photo-compare-strip"
    >
      <StripCell
        first
        value={p.strip.weight.from}
        suffix={`→${p.strip.weight.to}`}
        label={`Weight ${p.strip.weightUnit}`}
        testID="photo-compare-weight"
      />
      <StripCell
        value={p.strip.bodyFat.from}
        suffix={`→${p.strip.bodyFat.to}`}
        label="Body fat %"
        testID="photo-compare-bodyfat"
      />
      <StripCell
        value={p.strip.apart.value}
        suffix={p.strip.apart.unit}
        label="Apart"
        testID="photo-compare-apart"
      />
    </View>
  );
}
