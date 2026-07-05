import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { HeaderBar } from "@/ui/components/foundation/HeaderBar";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { Pill } from "@/ui/components/foundation/Pill";
import { Segmented } from "@/ui/components/foundation/Segmented";
import { toneTokens, type Tone } from "@/ui/components/foundation/tones";
import { SearchBar } from "@/ui/components/composite/SearchBar";
import { IconLayers, IconPlus, iconDefaults } from "@/ui/components/icons";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import type { ApiError } from "@/shared/errors";
import type { ProgramSummary } from "@/domain/models/program";

/**
 * <ProgramsListPresenter> — the coach Programs tab library.
 * Ports the prototype's `ProgramsScreenV2` (design-source/screens/coach.jsx:
 * 286-388) with strict fidelity: large HeaderBar ("Programmes", `N ACTIVE ·
 * N DRAFTS` eyebrow, trainer-tone "+") → SearchBar → trainer-accent Segmented
 * (Active | Drafts) → the accent-cycling `ProgramRowV2` cards → dashed
 * "+ New programme" CTA.
 *
 * The prototype's tag-filter chip row and "Archive" segment are DROPPED: the
 * backend models neither tags nor an archive state (specs/19-programs D6 —
 * ACTIVE/DRAFT is the only status axis, derived from `activeClientCount > 0`).
 *
 * Pure presentational; cache-first (renders whatever list is present, blocking
 * loader/error only when there's nothing at all). Search + segment are
 * controlled by the container.
 */

export type ProgramSegment = "Active" | "Drafts";

/** Left-accent cycle — client-derived, no backend colour column (D6 / brief). */
const ACCENT_CYCLE: Tone[] = ["primary", "gold", "success", "ember"];

export type ProgramsListPresenterProps = {
  programs: ProgramSummary[];
  searchQuery: string;
  onSearchChange: (next: string) => void;
  segment: ProgramSegment;
  onSegmentChange: (next: ProgramSegment) => void;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  onRefresh: () => void;
  onCreate: () => void;
  onOpenProgram: (id: string) => void;
  testID?: string;
};

/** ACTIVE = at least one live assignment; DRAFT otherwise (derived — D6). */
export function isProgramActive(p: ProgramSummary): boolean {
  return p.activeClientCount > 0;
}

/** Filter by segment status then case-insensitive name match. */
export function filterPrograms(
  programs: ProgramSummary[],
  segment: ProgramSegment,
  query: string,
): ProgramSummary[] {
  const q = query.trim().toLowerCase();
  return programs.filter((p) => {
    const active = isProgramActive(p);
    if (segment === "Active" && !active) return false;
    if (segment === "Drafts" && active) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

function ProgramRowV2({
  program,
  accent,
  onPress,
  testID,
}: {
  program: ProgramSummary;
  accent: Tone;
  onPress: () => void;
  testID?: string;
}) {
  const active = isProgramActive(program);
  const subtle =
    program.description && program.description.trim().length > 0
      ? program.description
      : `${program.daysPerWeek} days/wk`;

  return (
    <Card
      pad={14}
      radius={14}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={`Programme: ${program.name}`}
      style={{ borderLeftWidth: 3, borderLeftColor: toneTokens(accent).base }}
    >
      <View
        flexDirection="row"
        alignItems="flex-start"
        justifyContent="space-between"
        marginBottom={10}
      >
        <View flex={1} paddingRight={12}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
            numberOfLines={1}
          >
            {program.name}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$text3"
            marginTop={2}
            numberOfLines={1}
          >
            {subtle}
          </Text>
        </View>
        <Pill tone={active ? "success" : "neutral"} size="xs">
          {active ? "ACTIVE" : "DRAFT"}
        </Pill>
      </View>
      <View flexDirection="row" alignItems="center" gap={6} flexWrap="wrap">
        <Pill tone="neutral" size="xs">
          {program.durationWeeks !== null
            ? `${program.durationWeeks} WKS`
            : "ONGOING"}
        </Pill>
        {program.activeClientCount > 0 ? (
          <Pill tone="trainer" size="xs">
            {`${program.activeClientCount} CLIENT${program.activeClientCount === 1 ? "" : "S"}`}
          </Pill>
        ) : null}
      </View>
    </Card>
  );
}

function EmptyState({
  title,
  body,
  testID,
}: {
  title: string;
  body: string;
  testID: string;
}) {
  return (
    <Card pad={24} radius={14} testID={testID} style={{ alignItems: "center" }}>
      <View
        width={56}
        height={56}
        borderRadius={9999}
        backgroundColor="$accentTrainerDim"
        alignItems="center"
        justifyContent="center"
        marginBottom={12}
      >
        <IconLayers {...iconDefaults({ size: 24 })} color="#A78BFA" />
      </View>
      <Text
        fontFamily="$display"
        fontWeight="700"
        fontSize={16}
        color="$text"
        marginBottom={4}
        textAlign="center"
      >
        {title}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={13}
        color="$text3"
        textAlign="center"
        lineHeight={18}
      >
        {body}
      </Text>
    </Card>
  );
}

export function ProgramsListPresenter(props: ProgramsListPresenterProps) {
  const {
    programs,
    searchQuery,
    onSearchChange,
    segment,
    onSegmentChange,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    onCreate,
    onOpenProgram,
    testID,
  } = props;

  const insets = useSafeAreaInsets();

  const activeCount = useMemo(
    () => programs.filter(isProgramActive).length,
    [programs],
  );
  const draftCount = programs.length - activeCount;

  const filtered = useMemo(
    () => filterPrograms(programs, segment, searchQuery),
    [programs, segment, searchQuery],
  );

  if (isLoading && programs.length === 0) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="programs-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error && programs.length === 0) {
    return (
      <View flex={1} testID="programs-error-state">
        <ErrorState
          message="Couldn't load your programmes."
          onRetry={onRefresh}
        />
      </View>
    );
  }

  const hasAny = programs.length > 0;

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      <ScrollView
        testID="programs-scroll"
        contentContainerStyle={{ paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <HeaderBar
          large
          title="Programmes"
          eyebrow={`${activeCount} ACTIVE · ${draftCount} DRAFTS`}
          trailing={
            <IconBtn
              icon={<IconPlus size={18} strokeWidth={2.2} />}
              tone="trainer"
              onPress={onCreate}
              accessibilityLabel="New programme"
              testID="programs-create-btn"
            />
          }
        />

        <View paddingHorizontal={16} gap={12}>
          <SearchBar
            placeholder="Search programmes"
            value={searchQuery}
            onChangeText={onSearchChange}
            testID="programs-search"
          />

          <Segmented
            options={["Active", "Drafts"]}
            value={segment}
            onChange={(v) => onSegmentChange(v as ProgramSegment)}
            accent="trainer"
            testID="programs-segmented"
          />

          {!hasAny ? (
            <EmptyState
              title="No programmes yet"
              body="Build your first programme with the + button, then assign it to a client."
              testID="programs-empty"
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Nothing here"
              body="No programmes match those filters."
              testID="programs-empty-filtered"
            />
          ) : (
            <View gap={10}>
              {filtered.map((program, i) => (
                <ProgramRowV2
                  key={program.id}
                  program={program}
                  accent={ACCENT_CYCLE[i % ACCENT_CYCLE.length]}
                  onPress={() => onOpenProgram(program.id)}
                  testID={`program-row-${program.id}`}
                />
              ))}
            </View>
          )}

          {/* Dashed "+ New programme" CTA (prototype). */}
          <Pressable
            onPress={onCreate}
            accessibilityRole="button"
            accessibilityLabel="New programme"
            testID="programs-new-cta"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              paddingVertical={14}
              borderRadius={14}
              borderWidth={1.5}
              borderColor="$border2"
              alignItems="center"
              justifyContent="center"
              flexDirection="row"
              gap={8}
              style={{ borderStyle: "dashed" }}
            >
              <IconPlus size={14} strokeWidth={2.5} color="#A78BFA" />
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={13}
                color="$accentTrainer"
              >
                New programme
              </Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
