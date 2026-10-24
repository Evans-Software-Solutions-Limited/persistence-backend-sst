import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tamagui/core";
import { SessionExerciseCard } from "@/ui/components/session/SessionExerciseCard";
import type { SetSyncState } from "@/ui/components/session/SetLogger";
import { IconEyeOff, iconDefaults } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";
import type {
  TogetherAthleteProjection,
  TogetherSharedSnapshot,
} from "@/domain/ports/togetherShared.port";
import {
  TogetherAthleteAvatar,
  togetherToneColor,
  type TogetherAvatarTone,
} from "./TogetherAthleteAvatar";

/** What the viewer may see and do on one partner's workout (PER-60). */
export function togetherPartnerAccess(
  snapshot: TogetherSharedSnapshot,
  ownerId: string,
  accountId: string,
): {
  numbers: boolean;
  prev: boolean;
  editable: boolean;
  grantVersion: number;
  projection?: TogetherAthleteProjection;
} {
  const grant = snapshot.grants.find(
    (g) => g.ownerId === ownerId && g.recipientId === accountId,
  );
  const numbers = !!grant?.consent.numbers;
  const projection = numbers
    ? snapshot.athletes.find((a) => a.userId === ownerId)
    : undefined;
  return {
    numbers,
    prev: numbers && !!grant?.consent.prev,
    // Fill-in needs the numbers grant, the fill-in grant and a revision to write against.
    editable: !!projection && !!grant?.consent.logging,
    grantVersion: grant?.version ?? 0,
    projection,
  };
}

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
type Draft = {
  reps: number | null;
  weightKg: number | null;
  /** Logged values when the edit began; a draft over a changed set is dropped. */
  base: string;
  grantVersion: number;
};

const valuesKey = (row: { reps: number | null; weightKg: number | null }) =>
  `${row.reps ?? ""}|${row.weightKg ?? ""}`;

/**
 * The partner's exercises in plan order: logged sets first, then an empty row
 * for every planned set not logged yet, plus the rows the viewer added.
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
  return slots.map((slot, index) => {
    const exercise = p.projection?.exercises[slot.planExerciseId];
    const exerciseId = slot.exerciseId ?? slot.fallbackId;
    const logged: PartnerRow[] = (exercise?.sets ?? []).map((set) => ({
      setId: set.setId,
      reps: set.reps,
      weightKg: set.weightKg,
      logged: true,
    }));
    const total = Math.max(
      slot.targetSets + (p.added[slot.planExerciseId] ?? 0),
      logged.length,
    );
    // When the partner logs a set of their own, an untouched empty row goes,
    // never the one the viewer is typing into.
    const want = total - logged.length;
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
  onOperation(
    operation: Record<string, unknown>,
    observedRevision: number,
  ): Promise<void>;
}) {
  const access = togetherPartnerAccess(p.snapshot, p.ownerId, p.accountId);
  const editable = p.editable && access.editable;
  const profile = p.snapshot.profiles[p.ownerId]?.trim();
  const owner = profile || "Training partner";
  // Copy uses the first name, never a pronoun (we don't know anyone's).
  const first = profile ? profile.split(/\s+/)[0]! : owner;
  const ids = useRef<Record<string, string[]>>({});
  /** One set per partner in flight; the rest wait for its echo (lead: stale revisions). */
  const inflight = useRef<{
    setId: string;
    reps: number;
    weightKg: number;
    revision: number;
    token: number;
  } | null>(null);
  const queue = useRef<{ setId: string; planExerciseId: string }[]>([]);
  const tokens = useRef(0);
  const [added, setAdded] = useState<Record<string, number>>({});
  const [drafts, setDraftState] = useState<Record<string, Draft>>({});
  // Delivery reads drafts between renders (an echo, then the next send).
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const setDrafts = (
    next: (all: Record<string, Draft>) => Record<string, Draft>,
  ) => {
    draftsRef.current = next(draftsRef.current);
    setDraftState(draftsRef.current);
  };
  const [delivery, setDelivery] = useState<Record<string, SetSyncState>>({});
  const [error, setError] = useState("");
  const rowId = (planExerciseId: string, index: number) => {
    const pool = (ids.current[planExerciseId] ??= []);
    while (pool.length <= index) {
      const id = randomUUID();
      // Row ids key the rows; never let a repeat collapse two of them.
      pool.push(pool.includes(id) ? `${id}-${pool.length}` : id);
    }
    return pool[index]!;
  };
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
  const pumpRef = useRef<() => void>(() => {});
  const fail = (setId: string) => {
    setDelivery((all) => ({ ...all, [setId]: "notsent" }));
    setError(
      `That set could not be sent to ${first}. Check the connection and that fill-in is still on, then try again.`,
    );
  };
  const echoKey = projection
    ? `${projection.revision}:${JSON.stringify(projection.exercises)}`
    : "";
  useEffect(() => {
    const sent = inflight.current;
    if (sent && projection) {
      const echoed = Object.values(projection.exercises)
        .flatMap((e) => e.sets)
        .find((set) => set.setId === sent.setId);
      const landed =
        !!echoed &&
        echoed.reps === sent.reps &&
        echoed.weightKg === sent.weightKg;
      if (landed) {
        inflight.current = null;
        const base = valuesKey(sent);
        setDelivery((all) => {
          const { [sent.setId]: _saved, ...rest } = all;
          return rest;
        });
        // A correction typed while this was sending stays on screen and is
        // sent next (it is queued if it was committed).
        setDrafts((all) => {
          const draft = all[sent.setId];
          return draft && valuesKey(draft) !== base
            ? { ...all, [sent.setId]: { ...draft, base } }
            : all;
        });
      } else if (echoed || projection.revision > sent.revision) {
        // The owner moved on without applying it: rejected as stale.
        inflight.current = null;
        fail(sent.setId);
      }
    }
    if (!editable && queue.current.length) {
      for (const q of queue.current) fail(q.setId);
      queue.current = [];
    }
    pumpRef.current();
    // The projection's content and the grant drive delivery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echoKey, editable]);

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
        <View paddingHorizontal={16} gap={14}>
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
    added,
    rowId,
    keep: (setId) => !!drafts[setId] || !!delivery[setId],
    minted: (planExerciseId) => ids.current[planExerciseId]?.length ?? 0,
  });
  /** The value shown in a row: a live draft, else what the partner logged. */
  const shown = (row: PartnerRow): PartnerRow => {
    const draft = draftsRef.current[row.setId];
    return editable &&
      draft &&
      draft.base === (row.logged ? valuesKey(row) : "") &&
      draft.grantVersion === access.grantVersion
      ? { ...row, reps: draft.reps, weightKg: draft.weightKg }
      : row;
  };
  const edit = (
    row: PartnerRow,
    patch: Partial<Pick<ExerciseSet, "reps" | "weightKg">>,
  ) => {
    const current = shown(row);
    const next = {
      reps: patch.reps !== undefined ? patch.reps : current.reps,
      weightKg:
        patch.weightKg !== undefined ? patch.weightKg : current.weightKg,
    };
    setDrafts((all) => ({
      ...all,
      [row.setId]: {
        ...next,
        base: row.logged ? valuesKey(row) : "",
        grantVersion: access.grantVersion,
      },
    }));
    return next;
  };
  const rowOf = (setId: string) => {
    for (const e of exercises)
      for (const row of e.rows)
        if (row.setId === setId)
          return { row, planExerciseId: e.planExerciseId };
    return null;
  };
  /** Sends the next queued set against the revision on screen now. */
  const pump = () => {
    while (
      !inflight.current &&
      queue.current.length &&
      editable &&
      projection
    ) {
      const next = queue.current.shift()!;
      const found = rowOf(next.setId);
      const values = found && shown(found.row);
      if (
        !found ||
        !values ||
        values.reps === null ||
        values.weightKg === null ||
        (found.row.logged && valuesKey(values) === valuesKey(found.row))
      ) {
        setDelivery((all) => {
          const { [next.setId]: _done, ...rest } = all;
          return rest;
        });
        continue;
      }
      const token = ++tokens.current;
      inflight.current = {
        setId: next.setId,
        reps: values.reps,
        weightKg: values.weightKg,
        revision: projection.revision,
        token,
      };
      setDelivery((all) => ({ ...all, [next.setId]: "sending" }));
      void p
        .onOperation(
          {
            type: "upsertSet",
            planExerciseId: next.planExerciseId,
            set: {
              setId: next.setId,
              reps: values.reps,
              weightKg: values.weightKg,
              completed: true,
            },
          },
          projection.revision,
        )
        // Resolving only means it was handed over (Nearby publishes an intent
        // the owner may still reject); "saved" waits for the echo below.
        .catch(() => {
          if (inflight.current?.token !== token) return;
          inflight.current = null;
          fail(next.setId);
          pumpRef.current();
        });
    }
  };
  const send = (
    planExerciseId: string,
    row: PartnerRow,
    values: { reps: number | null; weightKg: number | null },
  ) => {
    if (!editable || !projection) return;
    if (values.reps === null || values.weightKg === null) return;
    if (
      row.logged &&
      valuesKey(values) === valuesKey(row) &&
      inflight.current?.setId !== row.setId
    )
      return;
    setError("");
    if (!queue.current.some((q) => q.setId === row.setId))
      queue.current.push({ setId: row.setId, planExerciseId });
    setDelivery((all) => ({ ...all, [row.setId]: "sending" }));
    pump();
  };
  pumpRef.current = pump;
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
      <View paddingHorizontal={16}>
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
              readOnly={!editable}
              exercise={exercise}
              caption={caption(e)}
              previousSetsBySetNumber={previous}
              restSeconds={0}
              syncStateBySetId={sync}
              onCommitSet={(setId) => {
                const row = e.rows.find((r) => r.setId === setId);
                if (row) send(e.planExerciseId, row, shown(row));
              }}
              onUpdateSet={(setId, patch) => {
                const row = e.rows.find((r) => r.setId === setId);
                if (!row || !editable) return;
                // Prev fills both values at once and sends straight away.
                if (patch.reps != null && patch.weightKg != null)
                  send(e.planExerciseId, row, edit(row, patch));
                else edit(row, patch);
              }}
              onLogSet={() =>
                setAdded((all) => ({
                  ...all,
                  [e.planExerciseId]: (all[e.planExerciseId] ?? 0) + 1,
                }))
              }
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
        {!!error && (
          <Text
            color="$error"
            fontFamily="$body"
            fontSize={12}
            lineHeight={17}
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        )}
      </View>
    </View>
  );
}
