import { Text, View } from "@tamagui/core";
import { SessionExerciseCard } from "@/ui/components/session/SessionExerciseCard";
import type { SetSyncState } from "@/ui/components/session/SetLogger";
import { IconEyeOff, iconDefaults } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";
import type { WeightUnit } from "@/shared/utils";
import type {
  TogetherAthleteProjection,
  TogetherSharedSnapshot,
} from "@/domain/ports/togetherShared.port";
import {
  togetherValuesKey as valuesKey,
  type TogetherPartnerOutbox,
} from "@/ui/hooks/useTogetherPartnerOutbox";
import { togetherPartnerAccess } from "./togetherPartnerAccess";
import {
  TogetherAthleteAvatar,
  togetherToneColor,
  type TogetherAvatarTone,
} from "./TogetherAthleteAvatar";

export { togetherPartnerAccess };

type PartnerRow = {
  setId: string;
  reps: number | null;
  weightKg: number | null;
  logged: boolean;
};
type PartnerExercise = {
  planExerciseId: string;
  exerciseId: string;
  name: string;
  targetSets: number;
  skipped: boolean;
  rows: PartnerRow[];
};
/**
 * The partner's exercises in plan order, each with the partner's own set rows
 * in their order: filled where logged, empty where not, so a row the partner
 * adds or deletes shows here too and a fill-in names the row it was typed
 * into. Before the partner has shared any rows for an exercise, an empty row
 * stands in for every planned set. Rows the viewer added follow.
 */
export function togetherPartnerExercises(p: {
  snapshot: TogetherSharedSnapshot;
  ownerId: string;
  projection?: TogetherAthleteProjection;
  exerciseNames: Readonly<Record<string, string>>;
  added: Readonly<Record<string, number>>;
  rowId(planExerciseId: string, index: number): string;
  /** Empty rows the viewer is using (a draft or a send); they keep their place. */
  keep?(setId: string): boolean;
  /** Ids already minted for an exercise, so kept rows past the first few are found. */
  minted?(planExerciseId: string): number;
}): PartnerExercise[] {
  const plan = p.snapshot.athletePlans[p.ownerId];
  const planned = [...(plan?.exercises ?? [])].sort(
    (a, b) => a.order - b.order,
  );
  const slots = [
    ...planned.map((e) => ({
      planExerciseId: e.planExerciseId,
      exerciseId: p.projection?.exercises[e.planExerciseId]?.exerciseId,
      fallbackId: e.exerciseId,
      targetSets: e.targetSets,
    })),
    ...Object.entries(p.projection?.exercises ?? {})
      .filter(([id]) => !planned.some((e) => e.planExerciseId === id))
      .map(([planExerciseId, e]) => ({
        planExerciseId,
        exerciseId: e.exerciseId,
        fallbackId: e.exerciseId,
        targetSets: 0,
      })),
  ];
  // A partner whose app shares empty rows shows exactly their rows; one that
  // shares logged sets only shows any empty row (PER-60).
  const exact = Object.values(p.projection?.exercises ?? {}).some((e) =>
    e.sets.some((set) => !set.completed),
  );
  return slots.map((slot, index) => {
    const exercise = p.projection?.exercises[slot.planExerciseId];
    const exerciseId = slot.exerciseId ?? slot.fallbackId;
    // The partner's rows as they are on their phone, empty ones included.
    const logged: PartnerRow[] = (exercise?.sets ?? []).map((set) =>
      set.completed
        ? {
            setId: set.setId,
            reps: set.reps,
            weightKg: set.weightKg,
            logged: true,
          }
        : { setId: set.setId, reps: null, weightKg: null, logged: false },
    );
    // Planned rows stand in until the partner's own rows for the exercise
    // arrive, and on top of logged sets from an app that shares only those.
    // Added rows go on top of what is on screen, even past the plan. When the
    // partner's rows arrive, an untouched stand-in goes, never the one being
    // typed into.
    const want =
      (exact && exercise ? 0 : Math.max(0, slot.targetSets - logged.length)) +
      (p.added[slot.planExerciseId] ?? 0);
    const free: string[] = [];
    const pool = (i: number) => p.rowId(slot.planExerciseId, i);
    const known = p.minted?.(slot.planExerciseId) ?? 0;
    for (let i = 0; free.length < want || i < known; i++) {
      const setId = pool(i);
      if (!logged.some((row) => row.setId === setId) && !free.includes(setId))
        free.push(setId);
    }
    const kept = free.filter((id) => p.keep?.(id));
    const spare = free.filter((id) => !p.keep?.(id));
    const chosen = new Set([
      ...kept,
      ...spare.slice(0, Math.max(0, want - kept.length)),
    ]);
    const empty: PartnerRow[] = free
      .filter((id) => chosen.has(id))
      .map((setId) => ({ setId, reps: null, weightKg: null, logged: false }));
    return {
      planExerciseId: slot.planExerciseId,
      exerciseId,
      name: p.exerciseNames[exerciseId] ?? `Exercise ${index + 1}`,
      targetSets: slot.targetSets,
      skipped: !!exercise?.skipped,
      rows: [...logged, ...empty],
    };
  });
}

/**
 * A partner's workout inside the active-session screen (canvas row 2): the
 * same exercise cards and set rows as your own, with an empty row for every
 * planned set. With fill-in the rows are editable at once; a set is sent when
 * its reps and kg are both filled and the field loses focus. Without numbers
 * only plan progress shows. Never reads the viewer's own history or draft.
 */
export function TogetherPartnerPresenter(p: {
  snapshot: TogetherSharedSnapshot;
  ownerId: string;
  accountId: string;
  exerciseNames: Readonly<Record<string, string>>;
  tone: TogetherAvatarTone;
  /** From the partner's delegation grant (`togetherPartnerAccess`). */
  editable: boolean;
  /** This partner's fill-in state, owned by the container (`useTogetherPartnerOutbox`). */
  outbox: TogetherPartnerOutbox;
  /** The viewer's weight-display preference (PER-98); defaults to kg. */
  weightUnit?: WeightUnit;
}) {
  const access = togetherPartnerAccess(p.snapshot, p.ownerId, p.accountId);
  const editable = p.editable && access.editable;
  const profile = p.snapshot.profiles[p.ownerId]?.trim();
  const owner = profile || "Training partner";
  // Copy uses the first name, never a pronoun (we don't know anyone's).
  const first = profile ? profile.split(/\s+/)[0]! : owner;
  const { drafts, delivery } = p.outbox;
  const bar = (text: string) => (
    <View paddingHorizontal={16} marginTop={-8}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={10}
        paddingVertical={8}
        paddingLeft={12}
        paddingRight={10}
        borderRadius={12}
        borderWidth={1}
        borderColor="$infoBorder"
        backgroundColor="$infoDim"
        testID="together-partner-bar"
      >
        <TogetherAthleteAvatar name={owner} size={22} tone={p.tone} />
        <Text
          flex={1}
          color="$text2"
          fontFamily="$body"
          fontSize={12}
          lineHeight={16}
        >
          {text}
        </Text>
      </View>
    </View>
  );

  const projection = access.projection;

  if (!access.numbers) {
    const plan = p.snapshot.athletePlans[p.ownerId];
    const progress = p.snapshot.progress.find((r) => r.userId === p.ownerId);
    const planned = [...(plan?.exercises ?? [])].sort(
      (a, b) => a.order - b.order,
    );
    const rows = [
      ...planned.map((e) => ({
        id: e.planExerciseId,
        exerciseId: e.exerciseId as string | undefined,
        target: e.targetSets,
      })),
      ...(progress?.exercises ?? [])
        .filter(
          (e) => !planned.some((x) => x.planExerciseId === e.planExerciseId),
        )
        .map((e) => ({
          id: e.planExerciseId,
          exerciseId: undefined,
          target: 0,
        })),
    ];
    const ring = togetherToneColor(p.tone);
    return (
      <View gap={16} testID="together-partner-view">
        {bar(`${owner} · numbers private`)}
        <View gap={14} testID="together-partner-list">
          <View
            backgroundColor="$surface"
            borderWidth={1}
            borderColor="$border"
            borderRadius={14}
            paddingVertical={18}
            paddingHorizontal={16}
            gap={8}
            alignItems="center"
          >
            <IconEyeOff {...iconDefaults({ size: 20 })} color={color.$text3} />
            <Text
              color="$text"
              fontFamily="$body"
              fontWeight="600"
              fontSize={14}
              lineHeight={18}
              textAlign="center"
            >
              {first} keeps numbers private
            </Text>
            <Text
              color="$text3"
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              textAlign="center"
            >
              {`You see ${first}’s progress through the plan, not weights or reps.`}
            </Text>
          </View>
          {rows.map((row, index) => {
            const current = progress?.exercises.find(
              (e) => e.planExerciseId === row.id,
            );
            const done = current?.completedSets ?? 0;
            const total = Math.max(row.target, done);
            const share = total ? Math.min(1, done / total) : 0;
            return (
              <View
                key={row.id}
                gap={6}
                accessible
                accessibilityLabel={`${
                  (row.exerciseId && p.exerciseNames[row.exerciseId]) ||
                  `Exercise ${index + 1}`
                }, ${current?.skipped ? "skipped" : `${done} of ${total} sets`}`}
              >
                <View flexDirection="row" justifyContent="space-between">
                  <Text
                    color="$text"
                    fontFamily="$body"
                    fontWeight="500"
                    fontSize={14}
                    lineHeight={18}
                  >
                    {(row.exerciseId && p.exerciseNames[row.exerciseId]) ||
                      `Exercise ${index + 1}`}
                  </Text>
                  <Text
                    color="$text3"
                    fontFamily="$mono"
                    fontSize={12}
                    lineHeight={17}
                  >
                    {current?.skipped ? "Skipped" : `${done} of ${total} sets`}
                  </Text>
                </View>
                <View
                  height={6}
                  borderRadius={9999}
                  backgroundColor="$surface3"
                  overflow="hidden"
                >
                  <View
                    height="100%"
                    borderRadius={9999}
                    width={`${Math.round(share * 100)}%`}
                    style={{ backgroundColor: ring }}
                  />
                </View>
              </View>
            );
          })}
          {!rows.length && (
            <Text color="$text3" fontFamily="$body" fontSize={12}>
              {`Waiting for ${first}’s plan.`}
            </Text>
          )}
        </View>
      </View>
    );
  }

  const exercises = togetherPartnerExercises({
    snapshot: p.snapshot,
    ownerId: p.ownerId,
    projection,
    exerciseNames: p.exerciseNames,
    added: p.outbox.added,
    rowId: p.outbox.rowId,
    keep: (setId) => !!drafts[setId] || !!delivery[setId],
    minted: p.outbox.minted,
  });
  /** The value shown in a row: a live draft, else what the partner logged. */
  const shown = (row: PartnerRow): PartnerRow => {
    const draft = drafts[row.setId];
    return editable &&
      draft &&
      draft.base === (row.logged ? valuesKey(row) : "")
      ? { ...row, reps: draft.reps, weightKg: draft.weightKg }
      : row;
  };
  const edit = (
    row: PartnerRow,
    patch: Partial<Pick<ExerciseSet, "reps" | "weightKg">>,
  ) => {
    const current = shown(row);
    p.outbox.edit(
      row.setId,
      {
        reps: patch.reps !== undefined ? patch.reps : current.reps,
        weightKg:
          patch.weightKg !== undefined ? patch.weightKg : current.weightKg,
      },
      row.logged ? valuesKey(row) : "",
    );
  };
  const caption = (e: PartnerExercise) => {
    const n = Math.max(e.targetSets, e.rows.length);
    return e.skipped ? "Skipped" : `${n} ${n === 1 ? "set" : "sets"}`;
  };
  return (
    <View gap={16} testID="together-partner-view">
      {bar(
        editable
          ? `Logging for ${first} · changes ${first}’s record`
          : projection
            ? `${owner} · read-only. Fill-in is off.`
            : `${owner} · waiting for ${first}’s sets`,
      )}
      {/* No inset of its own: the cards sit at the same width as your own
          workout (the screen pads both); only the bar lines up with the strip. */}
      <View testID="together-partner-list">
        {exercises.map((e) => {
          const rows = e.rows.map(shown);
          const exercise: SessionExercise = {
            id: e.planExerciseId,
            sessionId: p.ownerId,
            exerciseId: e.exerciseId,
            exerciseName: e.name,
            sortOrder: 0,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            skipped: e.skipped,
            sets: rows.map((row, i) => ({
              id: row.setId,
              sessionExerciseId: e.planExerciseId,
              setNumber: i + 1,
              reps: row.reps,
              weightKg: row.weightKg,
              rpe: null,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: row.logged,
              completedAt: null,
            })),
          };
          const previous: Record<number, { weightKg: number; reps: number }> =
            {};
          if (access.prev)
            for (const row of p.snapshot.previous[p.ownerId] ?? [])
              if (row.exerciseId === e.exerciseId)
                previous[row.setNumber] = {
                  reps: row.reps,
                  weightKg: row.weightKg,
                };
          const sync: Record<string, SetSyncState> = {};
          for (const row of e.rows)
            sync[row.setId] =
              delivery[row.setId] ?? (row.logged ? "saved" : "none");
          return (
            <SessionExerciseCard
              key={e.planExerciseId}
              partner
              weightUnit={p.weightUnit}
              readOnly={!editable}
              exercise={exercise}
              caption={caption(e)}
              previousSetsBySetNumber={previous}
              restSeconds={0}
              syncStateBySetId={sync}
              onCommitSet={(setId) => {
                if (editable) p.outbox.commit(setId, e.planExerciseId);
              }}
              onUpdateSet={(setId, patch) => {
                const row = e.rows.find((r) => r.setId === setId);
                if (!row || !editable) return;
                edit(row, patch);
                // Prev fills both values at once and sends straight away.
                if (patch.reps != null && patch.weightKg != null)
                  p.outbox.commit(setId, e.planExerciseId);
              }}
              onLogSet={() => p.outbox.addRow(e.planExerciseId)}
              onRemoveSet={() => {}}
              onOpenNotes={() => {}}
              onSubstitute={() => {}}
              onRemoveExercise={() => {}}
              onStartRest={() => {}}
            />
          );
        })}
        {!exercises.length && (
          <Text color="$text3" fontFamily="$body" fontSize={12}>
            {`Waiting for ${first}’s plan.`}
          </Text>
        )}
        {p.outbox.failed && (
          <Text
            color="$error"
            fontFamily="$body"
            fontSize={12}
            lineHeight={17}
            accessibilityLiveRegion="polite"
          >
            {`That set could not be sent to ${first}. Check the connection and that fill-in is still on, then try again.`}
          </Text>
        )}
      </View>
    </View>
  );
}
