import { useState } from "react";
import {
  Pressable,
  ScrollView,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { Text, View } from "@tamagui/core";
import { LoadingSpinner } from "@/ui/components/LoadingSpinner";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconCheck } from "@/ui/components/icons";
import type { CompareMode } from "@/domain/models/coachProgressPhotos";
import { BackLink, Note } from "@/ui/presenters/coachForms/kit";
import {
  CoachPhotoTile,
  CompareStripRow,
  PhotosEyebrow,
  type CoachPhotoView,
  type CompareStripView,
} from "./kit";
import {
  PHOTOS_OFFLINE_NOTE,
  PHOTOS_STATE_COPY,
  type ClientPhotosTabState,
  type PhotosPose,
} from "./ClientPhotosTabPresenter";

/**
 * C3.4c on iPhone: pick a pose, then two dates; side by side, or drag to
 * wipe from one to the other. Weight, body fat and time apart below, then
 * every date as a thumbnail of the chosen pose.
 */

export type CompareSide = {
  id: string;
  dateLabel: string;
  photo: CoachPhotoView | null;
};

export type CompareThumb = CompareSide & { selected: boolean };

export type PhotoCompareProps = {
  /** "ready" with two or more sets; "single" with one. */
  state: ClientPhotosTabState | "single";
  clientName: string;
  clientFirst: string;
  pose: PhotosPose;
  mode: CompareMode;
  older: CompareSide | null;
  newer: CompareSide | null;
  /** Every date, newest first. */
  dates: { id: string; dateLabel: string }[];
  strip: CompareStripView | null;
  thumbs: CompareThumb[];
  /** Wipe position, 0–1 (share of the earlier photo shown). */
  wipe: number;
  offline: boolean;
  onBack(): void;
  onPose(pose: PhotosPose): void;
  onMode(mode: CompareMode): void;
  onWipe(value: number): void;
  onOlder(setId: string): void;
  onNewer(setId: string): void;
  onThumb(setId: string): void;
  onRetry(): void;
};

const POSES: PhotosPose[] = ["Front", "Side", "Back"];
const MODE_LABEL: Record<CompareMode, string> = {
  side: "Side by side",
  wipe: "Wipe",
};
const PHOTO_HEIGHT = 300;

function OptionList(p: {
  options: { id: string; label: string }[];
  selected: string;
  onPick(id: string): void;
  testID: string;
}) {
  return (
    <View
      marginTop={6}
      paddingHorizontal={12}
      borderRadius={12}
      backgroundColor="$surface2"
      testID={p.testID}
    >
      {p.options.map((o) => {
        const on = o.id === p.selected;
        return (
          <Pressable
            key={o.id}
            onPress={() => p.onPick(o.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            testID={`${p.testID}-${o.id}`}
          >
            <View
              flexDirection="row"
              alignItems="center"
              minHeight={44}
              gap={8}
            >
              <Text
                flex={1}
                fontFamily="$body"
                fontSize={14}
                color={on ? "$accentTrainerBright" : "$text"}
              >
                {o.label}
              </Text>
              {on ? <IconCheck size={14} color="#A78BFA" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Drag across to move the line between the earlier and later photo. */
function Wipe(p: {
  older: CompareSide;
  newer: CompareSide;
  pose: PhotosPose;
  wipe: number;
  onWipe(value: number): void;
}) {
  const [width, setWidth] = useState(0);
  const move = (e: GestureResponderEvent) => {
    if (width <= 0) return;
    p.onWipe(Math.min(1, Math.max(0, e.nativeEvent.locationX / width)));
  };
  const pct = Math.round(p.wipe * 100);
  return (
    <View
      height={PHOTO_HEIGHT}
      borderRadius={12}
      overflow="hidden"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={move}
      onResponderMove={move}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Wipe between ${p.older.dateLabel} and ${p.newer.dateLabel}`}
      accessibilityValue={{ min: 0, max: 100, now: pct, text: `${pct}%` }}
      accessibilityActions={[
        { name: "increment", label: "More of the earlier photo" },
        { name: "decrement", label: "More of the later photo" },
      ]}
      onAccessibilityAction={(e) =>
        p.onWipe(
          Math.min(
            1,
            Math.max(
              0,
              p.wipe + (e.nativeEvent.actionName === "increment" ? 0.1 : -0.1),
            ),
          ),
        )
      }
      testID="photo-compare-wipe"
    >
      <CoachPhotoTile
        photo={p.newer.photo}
        label={`${p.pose} · ${p.newer.dateLabel}`}
        width={width || undefined}
        height={PHOTO_HEIGHT}
        radius={0}
      />
      <View
        position="absolute"
        top={0}
        left={0}
        bottom={0}
        width={width * p.wipe}
        overflow="hidden"
        testID="photo-compare-wipe-older"
      >
        <CoachPhotoTile
          photo={p.older.photo}
          label={`${p.pose} · ${p.older.dateLabel}`}
          width={width || undefined}
          height={PHOTO_HEIGHT}
          radius={0}
        />
      </View>
      <View
        position="absolute"
        top={0}
        bottom={0}
        left={width * p.wipe - 1}
        width={2}
        backgroundColor="$accentTrainer"
        pointerEvents="none"
      />
    </View>
  );
}

export function PhotoComparePresenter(p: PhotoCompareProps) {
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<"mode" | "older" | "newer" | null>(null);
  const toggle = (m: "mode" | "older" | "newer") =>
    setMenu((cur) => (cur === m ? null : m));
  const ready = p.state === "ready" && p.older && p.newer && p.strip;

  return (
    <View flex={1} paddingTop={insets.top} testID="photo-compare">
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal={10}
        height={52}
      >
        <BackLink
          label={p.clientName}
          onPress={p.onBack}
          testID="photo-compare-back"
        />
        {ready ? (
          <Pressable
            onPress={() => toggle("mode")}
            accessibilityRole="button"
            accessibilityLabel={`Compare view: ${MODE_LABEL[p.mode]}`}
            testID="photo-compare-mode"
          >
            <View
              height={36}
              paddingHorizontal={14}
              borderRadius={9999}
              borderWidth={1}
              borderColor="rgba(167,139,250,0.45)"
              backgroundColor="$accentTrainerDim"
              justifyContent="center"
            >
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={13}
                color="$accentTrainerBright"
              >
                {`${MODE_LABEL[p.mode]} ▾`}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
      >
        {menu === "mode" ? (
          <OptionList
            options={(["side", "wipe"] as const).map((m) => ({
              id: m,
              label: MODE_LABEL[m],
            }))}
            selected={p.mode}
            onPick={(id) => {
              p.onMode(id as CompareMode);
              setMenu(null);
            }}
            testID="photo-compare-modes"
          />
        ) : null}
        {p.state === "loading" ? (
          <View paddingTop={24} alignItems="center">
            <LoadingSpinner size="sm" />
          </View>
        ) : !ready ? (
          <CompareState {...p} state={p.state} />
        ) : (
          <>
            {p.offline ? (
              <Note testID="photo-compare-offline">{PHOTOS_OFFLINE_NOTE}</Note>
            ) : null}
            <View
              flexDirection="row"
              gap={4}
              marginTop={p.offline ? 12 : 0}
              marginBottom={12}
              borderBottomWidth={1}
              borderBottomColor="rgba(255,255,255,0.08)"
              accessibilityRole="tablist"
            >
              {POSES.map((pose) => {
                const on = pose === p.pose;
                return (
                  <Pressable
                    key={pose}
                    onPress={() => p.onPose(pose)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    testID={`photo-compare-pose-${pose}`}
                  >
                    <View
                      height={36}
                      paddingHorizontal={14}
                      justifyContent="center"
                      borderBottomWidth={2}
                      borderBottomColor={on ? "#A78BFA" : "transparent"}
                    >
                      <Text
                        fontFamily="$body"
                        fontWeight="600"
                        fontSize={13.5}
                        color={on ? "$text" : "$text3"}
                      >
                        {pose}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {p.mode === "side" ? (
              <View flexDirection="row" gap={8}>
                {[p.older!, p.newer!].map((side) => (
                  <CoachPhotoTile
                    key={side.id}
                    flex={1}
                    photo={side.photo}
                    label={`${p.pose} · ${side.dateLabel}`}
                    height={PHOTO_HEIGHT}
                    radius={12}
                    testID={`photo-compare-side-${side.id}`}
                  />
                ))}
              </View>
            ) : (
              <Wipe
                older={p.older!}
                newer={p.newer!}
                pose={p.pose}
                wipe={p.wipe}
                onWipe={p.onWipe}
              />
            )}
            <View flexDirection="row" gap={8} marginTop={8}>
              {(["older", "newer"] as const).map((slot) => {
                const side = slot === "older" ? p.older! : p.newer!;
                return (
                  <Pressable
                    key={slot}
                    style={{ flex: 1 }}
                    onPress={() => toggle(slot)}
                    accessibilityRole="button"
                    accessibilityLabel={`${slot === "older" ? "Earlier" : "Later"} date: ${side.dateLabel}`}
                    testID={`photo-compare-${slot}`}
                  >
                    <View
                      height={40}
                      borderRadius={12}
                      backgroundColor="$surface2"
                      alignItems="center"
                      justifyContent="center"
                    >
                      <Text
                        fontFamily="$body"
                        fontWeight="600"
                        fontSize={13}
                        color="$text"
                      >
                        {`${side.dateLabel} ▾`}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {menu === "older" || menu === "newer" ? (
              <OptionList
                options={p.dates
                  .filter(
                    (d) =>
                      d.id !== (menu === "older" ? p.newer!.id : p.older!.id),
                  )
                  .map((d) => ({ id: d.id, label: d.dateLabel }))}
                selected={menu === "older" ? p.older!.id : p.newer!.id}
                onPick={(id) => {
                  if (menu === "older") p.onOlder(id);
                  else p.onNewer(id);
                  setMenu(null);
                }}
                testID={`photo-compare-${menu}-dates`}
              />
            ) : null}
            <View marginTop={12}>
              <CompareStripRow strip={p.strip!} />
            </View>
            <PhotosEyebrow
              title={`All dates · ${p.thumbs.length} sets`}
              marginTop={10}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {p.thumbs.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => p.onThumb(t.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: t.selected }}
                  accessibilityLabel={`${t.dateLabel}: compare`}
                  testID={`photo-compare-thumb-${t.id}`}
                >
                  <View
                    borderRadius={9}
                    borderWidth={1}
                    borderColor={t.selected ? "$accentTrainer" : "transparent"}
                  >
                    <CoachPhotoTile
                      photo={t.photo}
                      label={t.dateLabel}
                      width={48}
                      height={62}
                      radius={8}
                    />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            <Text
              marginTop={10}
              fontFamily="$body"
              fontSize={11.5}
              lineHeight={16}
              color="$text3"
            >
              {`Only you and ${p.clientFirst} see these. They disappear for you if coaching ends.`}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** ⚠ "Compare needs two dates" is not on the canvas — Brad to confirm. */
function CompareState(
  p: PhotoCompareProps & {
    state: Exclude<PhotoCompareProps["state"], "loading">;
  },
) {
  const copy =
    p.state === "single" || p.state === "ready"
      ? {
          title: "Compare needs two dates",
          body: `${p.clientFirst} has one set of photos so far.`,
        }
      : PHOTOS_STATE_COPY[p.state](p.clientFirst);
  return (
    <View paddingTop={16} gap={6} testID={`photo-compare-state-${p.state}`}>
      <Text fontFamily="$body" fontWeight="600" fontSize={15} color="$text">
        {copy.title}
      </Text>
      <Text fontFamily="$body" fontSize={13} lineHeight={18} color="$text3">
        {copy.body}
      </Text>
      {p.state === "error" || p.state === "offline_empty" ? (
        <Pressable
          onPress={p.onRetry}
          accessibilityRole="button"
          hitSlop={10}
          testID="photo-compare-retry"
          style={{ alignSelf: "flex-start", marginTop: 6 }}
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={13}
            color="$accentTrainer"
          >
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
