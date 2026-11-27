import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { LoadingSpinner } from "@/ui/components/LoadingSpinner";
import { IconChevronR } from "@/ui/components/icons";
import { Note } from "@/ui/presenters/coachForms/kit";
import { CoachPhotoTile, PhotosEyebrow, type CoachPhotoView } from "./kit";

/**
 * C3.4b on iPhone: the latest set, then all sets; Compare opens C3.4c.
 * States: loading, no photos, not shared yet, the photos switch off,
 * coaching ended, offline (images already viewed only), and a failed read.
 */

export type PhotosPose = "Front" | "Side" | "Back";

export type PhotoSetRowView = {
  id: string;
  dateLabel: string;
  photos: { pose: PhotosPose; photo: CoachPhotoView | null }[];
};

export type ClientPhotosTabState =
  | "loading"
  | "ready"
  | "empty"
  | "not_shared"
  | "photos_off"
  | "ended"
  | "offline_empty"
  | "error";

export type ClientPhotosTabProps = {
  state: ClientPhotosTabState;
  clientFirst: string;
  /** The newest set (state "ready"). */
  latest: PhotoSetRowView | null;
  /** The earlier sets, newest first. */
  rows: PhotoSetRowView[];
  /** Showing the last read while offline. */
  offline: boolean;
  onCompare(): void;
  onOpenLatest(pose: PhotosPose): void;
  onOpenSet(setId: string): void;
  onRetry(): void;
};

/** ⚠ Not on the canvas (C3.4 draws only the gallery) — Brad to confirm. */
export const PHOTOS_STATE_COPY: Record<
  Exclude<ClientPhotosTabState, "loading" | "ready">,
  (first: string) => { title: string; body: string }
> = {
  empty: (first) => ({
    title: "No photos yet",
    body: `${first}'s front, side and back photos show here by date once they add some.`,
  }),
  not_shared: (first) => ({
    title: `${first} hasn't shared photos with you`,
    body: `${first} chooses whether their coaches see their progress photos. They show here once ${first} shares them.`,
  }),
  photos_off: (first) => ({
    title: `Photos are off for ${first}`,
    body: `Turn on Photos in ${first}'s settings to see their progress photos.`,
  }),
  ended: (first) => ({
    title: "Coaching has ended",
    body: `You can no longer see ${first}'s photos.`,
  }),
  offline_empty: (first) => ({
    title: "You're offline",
    body: `${first}'s photos load when you're back online.`,
  }),
  error: (first) => ({
    title: `We couldn't load ${first}'s photos`,
    body: "Check your connection and try again.",
  }),
};

/** ⚠ Not on the canvas. */
export const PHOTOS_OFFLINE_NOTE =
  "You're offline. Photos you've already viewed still show.";

export function ClientPhotosTabPresenter(p: ClientPhotosTabProps) {
  if (p.state === "loading") {
    return (
      <View paddingTop={24} alignItems="center" testID="client-photos-loading">
        <LoadingSpinner size="sm" />
      </View>
    );
  }
  if (p.state !== "ready" || !p.latest) {
    const kind = p.state === "ready" ? "empty" : p.state;
    const copy = PHOTOS_STATE_COPY[kind](p.clientFirst);
    return (
      <View
        paddingHorizontal={20}
        paddingTop={16}
        gap={6}
        testID={`client-photos-${kind}`}
      >
        <Text fontFamily="$body" fontWeight="600" fontSize={15} color="$text">
          {copy.title}
        </Text>
        <Text fontFamily="$body" fontSize={13} lineHeight={18} color="$text3">
          {copy.body}
        </Text>
        {kind === "error" || kind === "offline_empty" ? (
          <Pressable
            onPress={p.onRetry}
            accessibilityRole="button"
            hitSlop={10}
            testID="client-photos-retry"
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
  const latest = p.latest;
  return (
    <View paddingHorizontal={20} paddingTop={12} testID="client-photos">
      {p.offline ? (
        <Note testID="client-photos-offline">{PHOTOS_OFFLINE_NOTE}</Note>
      ) : null}
      <PhotosEyebrow
        title={`Latest · ${latest.dateLabel}`}
        marginTop={p.offline ? 12 : 0}
      >
        {p.rows.length > 0 ? (
          <Pressable
            onPress={p.onCompare}
            accessibilityRole="button"
            accessibilityLabel="Compare photos"
            hitSlop={10}
            testID="client-photos-compare"
          >
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={12.5}
              color="$accentTrainer"
            >
              Compare
            </Text>
          </Pressable>
        ) : null}
      </PhotosEyebrow>
      <View flexDirection="row" gap={8}>
        {latest.photos.map((ph) => (
          <Pressable
            key={ph.pose}
            style={{ flex: 1 }}
            onPress={() => p.onOpenLatest(ph.pose)}
            disabled={p.rows.length === 0}
            accessibilityRole="button"
            accessibilityLabel={`${ph.pose}, ${latest.dateLabel}`}
            testID={`client-photos-latest-${ph.pose}`}
          >
            <CoachPhotoTile
              photo={ph.photo}
              label={ph.pose}
              height={150}
              radius={12}
            />
          </Pressable>
        ))}
      </View>
      {p.rows.length > 0 ? (
        <>
          <PhotosEyebrow
            title={`All sets · ${p.rows.length}`}
            marginTop={14}
            testID="client-photos-all"
          />
          {p.rows.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => p.onOpenSet(row.id)}
              accessibilityRole="button"
              accessibilityLabel={`${row.dateLabel}: compare with the latest`}
              testID={`client-photos-set-${row.id}`}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={12}
                paddingVertical={12}
                borderBottomWidth={1}
                borderBottomColor="$border"
              >
                <Text
                  width={52}
                  fontFamily="$mono"
                  fontSize={12}
                  color="$text3"
                >
                  {row.dateLabel}
                </Text>
                <View flexDirection="row" gap={4}>
                  {row.photos.map((ph) => (
                    <CoachPhotoTile
                      key={ph.pose}
                      photo={ph.photo}
                      label={`${ph.pose}, ${row.dateLabel}`}
                      width={34}
                      height={44}
                      radius={6}
                      bare
                    />
                  ))}
                </View>
                <View flex={1} />
                <IconChevronR size={16} color="#8A8A98" />
              </View>
            </Pressable>
          ))}
        </>
      ) : null}
    </View>
  );
}
