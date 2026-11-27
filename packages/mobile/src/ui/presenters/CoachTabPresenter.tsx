import { Pressable, RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { LoadingSpinner } from "@/ui/components/LoadingSpinner";
import { CoachAvatar, Eyebrow } from "./coaching/coachingKit";
import type { AthleteResource } from "@/domain/models/coachResources";
import { CoachTabResources } from "./coachResources/CoachTabResources";

/**
 * <CoachTabPresenter> — the athlete's Coach tab (PER-126): canvas C2e, and
 * C11k straight after accepting. The tab exists only while someone coaches
 * the athlete (the tab layout hides it otherwise).
 *
 * Several coaches (PER-101): one chip per coach above the header, only when
 * there are two or more (Brad, 23 Nov — one coach looks exactly like C2e).
 * Tapping a chip shows that coach.
 *
 * Resources (PER-143) is live. The other C2e sections (forms due, messages,
 * plan) belong to other tickets. Until each lands it shows as a marked placeholder (Brad, 23 Nov:
 * "make it clear not there until in development"); the release ships only
 * once the platform is complete.
 */

export type CoachTabCoach = {
  id: string;
  name: string;
  firstName: string;
  initials: string;
  /** "Coaching you since August" / "Your coach from today". */
  subtitle: string;
  /** The coach's user id (PER-143: picks their resources). */
  trainerId?: string;
};

export type CoachTabPresenterProps = {
  coaches: readonly CoachTabCoach[];
  /** The coach shown; null only while nothing is cached yet. */
  selected: CoachTabCoach | null;
  isLoading: boolean;
  isRefreshing: boolean;
  onSelect(id: string): void;
  onRefresh(): void;
  /** PER-143: the selected coach's resources (null while none is cached). */
  resources?: AthleteResource[] | null;
  onOpenResource?(assignmentId: string): void;
};

/** Placeholders for C2e sections still being built, in canvas order. */
export function inDevelopmentSections(firstName: string) {
  return [
    {
      key: "forms",
      eyebrow: null,
      title: "Forms and check-ins to fill in",
      ticket: "PER-130",
    },
    {
      key: "messages",
      eyebrow: null,
      title: `Messages from ${firstName}`,
      ticket: "PER-92",
    },
    {
      key: "plan",
      eyebrow: `Your plan from ${firstName}`,
      title: "Programme and meal plans",
      ticket: "PER-140, PER-133",
    },
  ] as const;
}

export function CoachTabPresenter(p: CoachTabPresenterProps) {
  const insets = useSafeAreaInsets();

  if (!p.selected) {
    return (
      <View
        flex={1}
        backgroundColor="$bg"
        alignItems="center"
        justifyContent="center"
        testID="coach-tab-loading"
      >
        {p.isLoading ? (
          <LoadingSpinner accessibilityLabel="Loading your coach" />
        ) : null}
      </View>
    );
  }

  const coach = p.selected;
  return (
    <View flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 120,
        }}
        refreshControl={
          <RefreshControl refreshing={p.isRefreshing} onRefresh={p.onRefresh} />
        }
        testID="coach-tab"
      >
        {p.coaches.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
            testID="coach-tab-chips"
          >
            {p.coaches.map((c) => (
              <CoachChip
                key={c.id}
                coach={c}
                selected={c.id === coach.id}
                onPress={() => p.onSelect(c.id)}
              />
            ))}
          </ScrollView>
        )}

        <Eyebrow>Your coach</Eyebrow>
        <View
          flexDirection="row"
          alignItems="center"
          gap={12}
          marginTop={8}
          testID="coach-tab-header"
        >
          <CoachAvatar initials={coach.initials} size={52} fontSize={17} />
          <View flex={1}>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={24}
              lineHeight={30}
              letterSpacing={-0.5}
              color="$text"
              accessibilityRole="header"
            >
              {coach.name}
            </Text>
            <Text fontFamily="$body" fontSize={12.5} color="$text3">
              {coach.subtitle}
            </Text>
          </View>
        </View>

        <View marginTop={18}>
          {inDevelopmentSections(coach.firstName).map((s) => (
            <View key={s.key}>
              {s.eyebrow !== null && (
                <View marginTop={22} marginBottom={6}>
                  <Eyebrow>{s.eyebrow}</Eyebrow>
                </View>
              )}
              <InDevelopmentRow
                title={s.title}
                ticket={s.ticket}
                testID={`coach-tab-dev-${s.key}`}
              />
            </View>
          ))}
        </View>

        {p.resources !== undefined && (
          <CoachTabResources
            firstName={coach.firstName}
            rows={p.resources}
            onOpen={p.onOpenResource ?? (() => {})}
          />
        )}
      </ScrollView>
    </View>
  );
}

/** Canvas `.chip` (34pt) with the coach's initials; violet when selected. */
function CoachChip(p: {
  coach: CoachTabCoach;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: p.selected }}
      accessibilityLabel={p.coach.name}
      hitSlop={{ top: 5, bottom: 5 }}
      testID={`coach-tab-chip-${p.coach.id}`}
    >
      <View
        height={34}
        paddingLeft={5}
        paddingRight={13}
        borderRadius={9999}
        borderWidth={1}
        borderColor={p.selected ? "$accentTrainer" : "$border2"}
        backgroundColor={p.selected ? "$accentTrainerDim" : "$surface"}
        flexDirection="row"
        alignItems="center"
        gap={6}
      >
        <View
          width={24}
          height={24}
          borderRadius={9999}
          borderWidth={1.5}
          borderColor="$accentTrainer"
          backgroundColor="$surface"
          alignItems="center"
          justifyContent="center"
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={10}
            color="$accentTrainer"
          >
            {p.coach.initials}
          </Text>
        </View>
        <Text
          fontFamily="$body"
          fontWeight="600"
          fontSize={13}
          color={p.selected ? "$text" : "$text2"}
        >
          {p.coach.firstName}
        </Text>
      </View>
    </Pressable>
  );
}

/** A dashed row marking a section that isn't built yet. */
function InDevelopmentRow(p: {
  title: string;
  ticket: string;
  testID: string;
}) {
  return (
    <View
      paddingVertical={12}
      paddingHorizontal={14}
      marginTop={8}
      borderRadius={12}
      borderWidth={1}
      borderStyle="dashed"
      borderColor="$border3"
      gap={2}
      testID={p.testID}
    >
      <Text fontFamily="$body" fontWeight="600" fontSize={14} color="$text2">
        {p.title}
      </Text>
      <Text fontFamily="$body" fontSize={12} color="$text3">
        {`In development (${p.ticket}). Not in this build yet.`}
      </Text>
    </View>
  );
}
