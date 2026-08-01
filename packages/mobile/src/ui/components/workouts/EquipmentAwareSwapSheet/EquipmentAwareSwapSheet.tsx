/**
 * <EquipmentAwareSwapSheet> — the ONE equipment-aware exercise picker
 * (spec-21 § 6.4 / § 10, AC-4.2 / AC-4.4; design D6 + D7's swap sheet).
 *
 * Serves BOTH surfaces, which is the whole point of it existing:
 *
 *   - the Loadout review row  → a kit context IS known;
 *   - the standalone in-session swap (`SwapExercisePopover`) → it may not be.
 *
 * It replaces the ad-hoc client-side muscle filter that used to live at
 * `SwapExercisePopover.tsx:131-142`, whose own header comment recorded the gap it
 * was working around ("V2 has no `similar_to` API"). There is one now:
 * `GET /exercises/substitutes`. Two things improve by moving server-side, and the
 * second is not cosmetic:
 *
 *   1. Ranking uses the § 6.2 signals (muscles, difficulty, movement pattern,
 *      whether you have logged it) instead of "shares one primary muscle group",
 *      and each row can therefore say WHY it matched.
 *   2. **The device's cached exercise library is not visibility-aware.** Filtering
 *      it on-device cannot enforce `buildVisibilityCondition` (AC-3.6), so the old
 *      path was one cache-population bug away from listing another coach's private
 *      exercises. The endpoint scopes the read server-side.
 *
 * ## ⚠ `best` and `others` are two different claims — never merge or co-sort them
 *
 * `best` is containment-filtered: every row is performable with the supplied kit.
 * `others` is the same muscle filter WITHOUT containment, minus every compatible
 * id (not just the ones that fit `best`'s page — so a compatible-but-rank-26
 * exercise is never mislabelled as not fitting). Rank order alone cannot express
 * "this one is illegal", which is why the server returns two lists.
 *
 * ## ⚠ …but `others` only MEANS "incompatible" when a kit was supplied
 *
 * With no `equipment`, the server skips the compatible query entirely: `best` is
 * empty by design and the whole ranked list arrives as `others`. That is the
 * standalone swap's normal case, and dimming every row there — or making every
 * pick pass through a "doesn't fit your kit" acknowledgement — would be asserting
 * something nobody checked. `hasEquipmentContext` therefore gates the dimming AND
 * the acknowledgement AND `isUserOverride`, together, from one flag.
 *
 * ## ⚠ The acknowledgement is what sets `isUserOverride`, and it must
 *
 * `POST /workouts/:id/variations` re-verifies equipment containment on every row
 * NOT flagged `isUserOverride`. A deliberate pick from the incompatible list that
 * arrives unflagged is rejected 400 `EQUIPMENT_NOT_AVAILABLE` and the user loses a
 * whole reviewed adaptation to an error they cannot act on. The flag is derived
 * from WHICH LIST the row came from — never from re-checking the exercise's own
 * equipment on-device, which would drift from the server's rule and could either
 * reject a legal pick or mark a legal pick as an override and corrupt the
 * provenance the save path reads back (AC-3.3).
 */

import { Ionicons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type {
  SubstituteCandidate,
  SubstitutesResult,
} from "@/domain/models/loadout";
import { describeMatchSignals } from "@/domain/services/loadout.service";
import { tokenizeSearch } from "@/domain/services/exercise.service";
import type { LoadoutApiError } from "@/domain/ports/api.port";
import { BottomSheet, Pill } from "@/ui/components/foundation";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useDebouncedValue } from "@/ui/hooks/useDebouncedValue";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * Fetch a broad visibility-scoped pool. Search is immediate over the current
 * response, then debounced to the server so names beyond the ordinary cap stay
 * reachable.
 */
const CANDIDATE_LIMIT = 400;

export type EquipmentAwareSwapSheetProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** The exercise being replaced. Null closes the fetch down (nothing to rank against). */
  readonly forExerciseId: string | null;
  /** Shown in the sheet eyebrow so the user knows which row they are changing. */
  readonly exerciseName: string;
  /**
   * The kit context. Omit for the standalone swap, where the kit is unknown.
   *
   * ⚠ **An EMPTY array is treated as "no context", not as "no equipment".** That
   * is the server's behaviour, not a shortcut taken here: `exercisesSubstitutesHandler`
   * skips the compatible query entirely on `equipment.length === 0`, because
   * passing an empty containment array would drop the predicate and make `best`
   * identical to `others`. `SubstitutesQuery` says the same thing — "never send
   * `[]` expecting no filter". Matching the server matters because the alternative
   * is a screen that dims rows and demands an override acknowledgement for a
   * containment check nobody ran.
   */
  readonly equipmentTypeIds?: readonly string[];
  /** e.g. a saved gym's name — labels the kit chip. */
  readonly equipmentContextLabel?: string | null;
  /** Resolves `equipmentRequired` ids for the "needs …" line on an incompatible row. */
  readonly equipmentNameById?: ReadonlyMap<string, string>;
  /** Already in the plan/session — shown disabled so a no-op swap is impossible. */
  readonly existingExerciseIds?: readonly string[];
  /**
   * Rows the SERVER cannot know about yet, rendered in their own group above the
   * ranked lists. Empty/omitted for Loadout; the standalone swap supplies the
   * caller's own custom exercises that are still queued for sync.
   *
   * ⚠ **This exists because the server-side read has one honest blind spot.**
   * `createExerciseCommand` is offline-first: it writes a `local-…` row into
   * `cached_exercises` and enqueues `POST /exercises`. Until the sync queue
   * drains, `GET /exercises/substitutes` cannot return it — so the picker's own
   * Create CTA led straight back to a list the new exercise was missing from.
   * That exact flow (swap → Create → back) is a bug Brad reported from a live
   * session and #340 fixed on the cache-reading picker this component replaced;
   * routing the list through the server reopened it by a different door.
   *
   * They are NOT ranked and carry no `matchedOn` — there is nothing server-side
   * to rank them against — and never `incompatible`: the caller owns them, and
   * no containment check was run on them either way.
   */
  readonly localOnlyCandidates?: readonly SubstituteCandidate[];
  /**
   * `isUserOverride` is true only for a row taken from the INCOMPATIBLE list with
   * the acknowledgement confirmed.
   */
  readonly onSelect: (
    candidate: SubstituteCandidate,
    isUserOverride: boolean,
  ) => void;
  /** Optional "Create" affordance — the standalone picker has one, Loadout does not. */
  readonly onCreateExercise?: () => void;
  /**
   * A caller-owned failure to act on a selection, shown in-sheet.
   *
   * Exists because a select handler can fail AFTER the sheet has done its job —
   * `SwapExercisePopover` has to resolve the pick through the local exercise
   * cache and can come up empty. Without somewhere to say so, the sheet would sit
   * open looking as though the tap was never registered.
   */
  readonly unavailableMessage?: string | null;
  readonly testID?: string;
};

const EMPTY_RESULT: SubstitutesResult = {
  best: [],
  others: [],
  meta: { truncated: false },
};

export function EquipmentAwareSwapSheet({
  visible,
  onClose,
  forExerciseId,
  exerciseName,
  equipmentTypeIds,
  equipmentContextLabel,
  equipmentNameById,
  existingExerciseIds = [],
  localOnlyCandidates,
  onSelect,
  onCreateExercise,
  unavailableMessage = null,
  testID = "equipment-aware-swap-sheet",
}: EquipmentAwareSwapSheetProps) {
  const { api } = useAdapters();

  const [result, setResult] = useState<SubstitutesResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LoadoutApiError | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  /** The incompatible row awaiting an explicit acknowledgement. */
  const [pendingOverride, setPendingOverride] =
    useState<SubstituteCandidate | null>(null);
  /**
   * What `result` currently holds rows FOR — `<row>|<kit>`. Distinguishes a
   * re-fetch that invalidates the rows on screen from one that does not; see the
   * fetch effect.
   */
  const resultKeyRef = useRef<string | null>(null);

  // Serialised so the effect re-runs when the CONTENTS change, not when the
  // caller happens to hand over a fresh array with the same ids — the Loadout
  // review step rebuilds its context object on every render.
  //
  // ⚠ A COMMA, and never a control character. An earlier version used a literal
  // U+0000 here; every gate passed (Prettier, ESLint and Babel all accept it)
  // while git's binary heuristic tripped on the NUL and rendered this entire
  // file as "Binary file not shown" — making the one component that derives
  // `isUserOverride` unreviewable and un-mergeable by the normal path. Commas
  // cannot appear in a UUID, so they round-trip these ids exactly.
  const equipmentKey = equipmentTypeIds ? [...equipmentTypeIds].join(",") : "";
  const equipmentForQuery = useMemo(
    () => (equipmentKey.length > 0 ? equipmentKey.split(",") : undefined),
    [equipmentKey],
  );
  const hasEquipmentContext = equipmentForQuery !== undefined;

  useEffect(() => {
    if (visible) return;
    setQuery("");
    setPendingOverride(null);
  }, [visible]);

  useEffect(() => {
    if (!visible || forExerciseId === null) {
      // ⚠ Clearing this is not tidiness. `.finally` below is gated on
      // `!cancelled`, so a request still in flight when the sheet closes never
      // settles the flag. The next open that ALSO takes this branch — a
      // substitute whose source row has fallen out of the session, or one whose
      // source has not synced yet — would then render "Finding matches…"
      // forever, and `isEmpty` is false while loading, so the empty state it is
      // supposed to show never appears.
      setIsLoading(false);
      resultKeyRef.current = null;
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    // Reset when the ROW or the KIT changed: a stale list would render under the
    // new row's name for as long as the request takes, and every entry in it
    // would be a plausible-looking wrong answer.
    //
    // ⚠ NOT on a changed search term, though this effect re-runs for one. Those
    // rows are still this row's, the client-side `filter` has already narrowed
    // them, and blanking them for the round trip is the exact flicker that
    // filtering immediately over the current response exists to avoid.
    const resultKey = `${forExerciseId}|${equipmentKey}`;
    if (resultKeyRef.current !== resultKey) {
      resultKeyRef.current = resultKey;
      setResult(EMPTY_RESULT);
      setPendingOverride(null);
    }
    void api
      .getExerciseSubstitutes({
        forExerciseId,
        // Spread so the key is ABSENT in the no-kit case rather than explicitly
        // `undefined`. The adapter already drops an empty `equipment`, so this is
        // belt-and-braces — but it keeps the two layers stating the same contract.
        ...(equipmentForQuery ? { equipment: equipmentForQuery } : {}),
        limit: CANDIDATE_LIMIT,
        ...(debouncedQuery ? { search: debouncedQuery } : {}),
      })
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) setError(response.error);
        else setResult(response.value);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    visible,
    forExerciseId,
    equipmentForQuery,
    equipmentKey,
    debouncedQuery,
    api,
  ]);

  const existing = useMemo(
    () => new Set(existingExerciseIds),
    [existingExerciseIds],
  );

  // AND-match every token against the name — same rule as the other pickers, so
  // "press bench" still finds "Bench Press". Applied client-side over the ranked
  // current response for immediate feedback while the debounced server request
  // applies the same tokens before the repository's ordinary 400-row cap.
  const filter = useCallback(
    (rows: readonly SubstituteCandidate[]) => {
      const tokens = tokenizeSearch(query);
      if (tokens.length === 0) return rows;
      return rows.filter((row) => {
        const name = row.name.toLowerCase();
        return tokens.every((token) => name.includes(token));
      });
    },
    [query],
  );

  const best = useMemo(() => filter(result.best), [filter, result.best]);
  const others = useMemo(() => filter(result.others), [filter, result.others]);
  // Same client-side token filter as the ranked lists, so typing narrows all
  // three groups consistently. The debounced SERVER search cannot see these
  // rows at all — they do not exist server-side yet — so filtering them here is
  // the only thing that keeps the sheet's search honest about them.
  const localOnly = useMemo(
    () => filter(localOnlyCandidates ?? []),
    [filter, localOnlyCandidates],
  );

  const onRowPress = useCallback(
    (candidate: SubstituteCandidate, incompatible: boolean) => {
      if (incompatible) {
        setPendingOverride(candidate);
        return;
      }
      onSelect(candidate, false);
    },
    [onSelect],
  );

  const confirmOverride = useCallback(() => {
    if (pendingOverride === null) return;
    onSelect(pendingOverride, true);
    setPendingOverride(null);
  }, [onSelect, pendingOverride]);

  const missingNames = useMemo(() => {
    if (pendingOverride === null || equipmentNameById === undefined) return [];
    const owned = new Set(equipmentTypeIds ?? []);
    return pendingOverride.equipmentRequired
      .filter((id) => !owned.has(id))
      .map((id) => equipmentNameById.get(id))
      .filter((name): name is string => Boolean(name));
  }, [pendingOverride, equipmentNameById, equipmentTypeIds]);

  const isEmpty =
    !isLoading &&
    error === null &&
    best.length === 0 &&
    others.length === 0 &&
    localOnly.length === 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Swap exercise"
      eyebrow={exerciseName.toUpperCase()}
      accent="primary"
      height="tall"
      testID={testID}
    >
      {pendingOverride !== null ? (
        <OverrideConfirm
          candidate={pendingOverride}
          missingNames={missingNames}
          onConfirm={confirmOverride}
          onCancel={() => setPendingOverride(null)}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.contextRow}>
            {hasEquipmentContext ? (
              <Pill tone="primary" size="xs">
                {(equipmentContextLabel ?? "YOUR KIT").toUpperCase()}
              </Pill>
            ) : null}
            <Text style={styles.contextText}>
              {hasEquipmentContext
                ? "Ranked by your available equipment"
                : "Ranked by how closely it matches"}
            </Text>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={color.$text3} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search these matches…"
              placeholderTextColor={color.$text4}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              testID="swap-sheet-search"
            />
            {onCreateExercise ? (
              <TouchableOpacity
                onPress={onCreateExercise}
                testID="swap-sheet-create"
                accessibilityRole="button"
                accessibilityLabel="Create exercise"
                hitSlop={8}
              >
                <Text style={styles.createText}>Create</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {unavailableMessage !== null ? (
            <View style={styles.stateBlock} testID="swap-sheet-unavailable">
              <Ionicons
                name="cloud-offline-outline"
                size={22}
                color={color.$warning}
              />
              <Text style={styles.stateText}>{unavailableMessage}</Text>
            </View>
          ) : null}

          {isLoading ? (
            <View style={styles.stateBlock} testID="swap-sheet-loading">
              <ActivityIndicator color={color.$primary} />
              <Text style={styles.stateText}>Finding matches…</Text>
            </View>
          ) : null}

          {error !== null ? (
            <View style={styles.stateBlock} testID="swap-sheet-error">
              <Ionicons
                name="alert-circle-outline"
                size={22}
                color={color.$error}
              />
              <Text style={styles.stateText}>
                Couldn&apos;t load matches. Check your connection and try again.
              </Text>
            </View>
          ) : null}

          {isEmpty ? (
            <View style={styles.stateBlock} testID="swap-sheet-empty">
              <Text style={styles.stateText}>
                {query.length > 0
                  ? "No matches with that name."
                  : "No alternatives found for this exercise."}
              </Text>
            </View>
          ) : null}

          {localOnly.length > 0 ? (
            <CandidateGroup
              // First, because the only way to be in this group is to have just
              // created the exercise — the user came back here looking for it.
              label="CREATED ON THIS DEVICE"
              rows={localOnly}
              incompatible={false}
              existing={existing}
              onPress={onRowPress}
              testIDPrefix="swap-local"
            />
          ) : null}

          {best.length > 0 ? (
            <CandidateGroup
              label="BEST MATCHES"
              rows={best}
              incompatible={false}
              existing={existing}
              onPress={onRowPress}
              testIDPrefix="swap-best"
            />
          ) : null}

          {others.length > 0 ? (
            <CandidateGroup
              // The heading is the honest claim in each case. With a kit context
              // these rows failed containment; without one, nothing was checked.
              //
              // ⚠ NOT "full library". The server ANDs `search` with the source's
              // primary-muscle filter, so swapping a bench press and typing
              // "squat" returns nothing — under a heading that had just promised
              // the whole library, that reads as a broken search rather than a
              // scoped one.
              label={hasEquipmentContext ? "DOESN'T FIT YOUR KIT" : "MATCHES"}
              rows={others}
              incompatible={hasEquipmentContext}
              existing={existing}
              onPress={onRowPress}
              testIDPrefix="swap-others"
            />
          ) : null}

          {result.meta.truncated ? (
            <Text style={styles.truncatedNote} testID="swap-sheet-truncated">
              More matches are available. Search by name to narrow them.
            </Text>
          ) : null}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

function CandidateGroup({
  label,
  rows,
  incompatible,
  existing,
  onPress,
  testIDPrefix,
}: {
  readonly label: string;
  readonly rows: readonly SubstituteCandidate[];
  readonly incompatible: boolean;
  readonly existing: ReadonlySet<string>;
  readonly onPress: (
    candidate: SubstituteCandidate,
    incompatible: boolean,
  ) => void;
  readonly testIDPrefix: string;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {rows.map((row) => {
        const alreadyInPlan = existing.has(row.id);
        const signals = describeMatchSignals(row.matchedOn);
        return (
          <TouchableOpacity
            key={row.id}
            style={[
              styles.row,
              incompatible && styles.rowDim,
              alreadyInPlan && styles.rowDisabled,
            ]}
            // ⚠ `disabled` and `accessibilityState.disabled` are BOTH required
            // and are not duplication: the first blocks the touch, the second
            // tells VoiceOver/TalkBack. A mutation sweep will report removing
            // either one as surviving, because Testing Library's `press` honours
            // the a11y state while the device honours the prop — so each covers
            // for the other in exactly one environment. Keep both.
            disabled={alreadyInPlan}
            onPress={() => onPress(row, incompatible)}
            testID={`${testIDPrefix}-${row.id}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: alreadyInPlan }}
            accessibilityLabel={
              incompatible
                ? `${row.name}. Does not fit your equipment.`
                : row.name
            }
          >
            <View style={styles.rowIcon}>
              <Ionicons
                name={incompatible ? "lock-closed-outline" : "barbell-outline"}
                size={16}
                color={incompatible ? color.$text4 : color.$text2}
              />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowName} numberOfLines={1}>
                {row.name}
              </Text>
              <Text style={styles.rowReason} numberOfLines={2}>
                {alreadyInPlan
                  ? "Already in this workout"
                  : (signals ?? "A close match")}
              </Text>
            </View>
            {alreadyInPlan ? null : (
              <Ionicons
                name="swap-horizontal"
                size={16}
                color={incompatible ? color.$text4 : color.$primary}
              />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * The explicit acknowledgement (AC-4.2).
 *
 * A full-panel takeover rather than an inline toggle, because confirming this is
 * what stamps `isUserOverride: true` on the saved row — it changes what the
 * server verifies and what the provenance says forever. It should not be
 * possible to do by mis-tapping a dimmed list.
 */
function OverrideConfirm({
  candidate,
  missingNames,
  onConfirm,
  onCancel,
}: {
  readonly candidate: SubstituteCandidate;
  readonly missingNames: readonly string[];
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <View style={styles.confirm} testID="swap-sheet-override-confirm">
      <View style={styles.confirmIcon}>
        <Ionicons name="alert-circle" size={26} color={color.$warning} />
      </View>
      <Text style={styles.confirmTitle}>{candidate.name}</Text>
      <Text style={styles.confirmBody}>
        {missingNames.length > 0
          ? `This needs ${missingNames.join(", ")}, which isn't in the kit you picked.`
          : "This one doesn't fit the kit you picked."}
      </Text>
      <Text style={styles.confirmBodyMuted}>
        You can still use it — we&apos;ll record that it was your choice.
      </Text>
      <TouchableOpacity
        style={styles.confirmPrimary}
        onPress={onConfirm}
        testID="swap-sheet-override-confirm-accept"
        accessibilityRole="button"
      >
        <Text style={styles.confirmPrimaryText}>Use it anyway</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.confirmSecondary}
        onPress={onCancel}
        testID="swap-sheet-override-confirm-cancel"
        accessibilityRole="button"
      >
        <Text style={styles.confirmSecondaryText}>Pick something else</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: space.$base,
    paddingBottom: space.$2xl,
    gap: space.$md,
  },
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$sm,
    paddingTop: space.$sm,
  },
  contextText: { flex: 1, fontSize: 11.5, color: color.$text4 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$sm,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: radius.$md,
    paddingHorizontal: space.$md,
    height: 44,
  },
  searchInput: { flex: 1, color: color.$text, fontSize: 14, padding: 0 },
  createText: { color: color.$primary, fontSize: 13, fontWeight: "600" },
  stateBlock: {
    alignItems: "center",
    gap: space.$sm,
    paddingVertical: space.$xl,
  },
  stateText: {
    color: color.$text3,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  group: { gap: space.$xs },
  groupLabel: {
    fontSize: 10.5,
    letterSpacing: 0.9,
    color: color.$text4,
    fontWeight: "700",
    paddingTop: space.$sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$md,
    paddingVertical: space.$md,
    borderBottomWidth: 1,
    borderBottomColor: color.$border,
  },
  rowDim: { opacity: 0.55 },
  rowDisabled: { opacity: 0.35 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.$md,
    backgroundColor: color.$surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { color: color.$text, fontSize: 14, fontWeight: "600" },
  rowReason: { color: color.$text3, fontSize: 11.5, lineHeight: 16 },
  truncatedNote: {
    color: color.$text4,
    fontSize: 11,
    textAlign: "center",
    paddingTop: space.$sm,
  },
  confirm: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.$xl,
    gap: space.$md,
  },
  confirmIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.$surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmTitle: {
    color: color.$text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  confirmBody: {
    color: color.$text2,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: "center",
  },
  confirmBodyMuted: {
    color: color.$text3,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "center",
  },
  confirmPrimary: {
    alignSelf: "stretch",
    height: 48,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.$sm,
  },
  confirmPrimaryText: {
    color: color.$primaryInk,
    fontSize: 15,
    fontWeight: "700",
  },
  confirmSecondary: {
    alignSelf: "stretch",
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmSecondaryText: {
    color: color.$text2,
    fontSize: 14,
    fontWeight: "600",
  },
});
