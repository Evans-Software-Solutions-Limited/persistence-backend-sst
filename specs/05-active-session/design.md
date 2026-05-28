# 05 — Active Session: Design

> **Spec rewritten from scratch on 2026-05-27.** Pairs with `requirements.md` (same date).

---

## Architecture overview

The data layer is unchanged from V2. The presentation layer rebuilds significantly (per `requirements.md`) and introduces a new state machine for the minimise-to-bar pattern.

```
packages/mobile/
├── app/(app)/
│   ├── _layout.tsx                    ← MOUNT: <ActiveWorkoutOverlay/> (this spec)
│   └── session/
│       ├── index.tsx                  ← always renders via <ActiveWorkoutOverlay/> when expanded; route exists for deep-link / start-from-workout
│       ├── summary.tsx                ← SessionSummaryContainer (preserved)
│       └── rate.tsx                   ← WorkoutRatingContainer (preserved)
└── src/
    ├── state/
    │   └── active-workout.ts          ← NEW — useActiveWorkout Zustand slice + AsyncStorage
    ├── application/sessions/          ← unchanged (90% coverage preserved)
    ├── domain/{models,ports}          ← unchanged
    ├── adapters/{api,storage}         ← unchanged
    └── ui/
        ├── containers/
        │   ├── ActiveSessionContainer.tsx        ← unchanged plumbing, presenter rebuilt
        │   ├── ActiveWorkoutOverlay.tsx          ← NEW — switches between expanded screen + minimised bar
        │   ├── SessionSummaryContainer.tsx       ← preserved
        │   └── WorkoutRatingContainer.tsx        ← preserved
        └── presenters/
            ├── ActiveSessionPresenter.tsx        ← REBUILT (chevron-down minimise, 5-col grid, banner slot, end-confirm)
            ├── ActiveWorkoutBarPresenter.tsx     ← NEW — minimised bar
            ├── EndConfirmDialogPresenter.tsx     ← NEW — centred modal
            ├── TrainerBannerPresenter.tsx        ← NEW — withClient banner
            ├── SessionSummaryPresenter.tsx       ← preserved (shell refresh)
            └── WorkoutRatingPresenter.tsx       ← preserved (shell refresh)
```

---

## `useActiveWorkout` Zustand slice

Per migration plan §"Active workout specifically — minimize/restore pattern" + locked decision #7.

```ts
// packages/mobile/src/state/active-workout.ts
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Workout, SetLogEntry } from '~/domain/models';

const STORAGE_KEY = 'persistence.activeWorkout';

interface ActiveWorkoutState {
  workout: Workout | null;
  sessionId: string | null;
  expanded: boolean;
  elapsedSeconds: number;
  setLog: SetLogEntry[];
  withClient?: { id: string; initials: string; name: string };
  retroactive?: boolean;

  start: (input: { workout: Workout; sessionId: string; withClient?: …; retroactive?: boolean }) => void;
  minimize: () => void;
  expand: () => void;
  tick: () => void;
  appendSetLog: (entry: SetLogEntry) => void;
  end: () => Promise<void>;
  rehydrate: () => Promise<{ resumed: boolean; staleHours?: number }>;
}

export const useActiveWorkout = create<ActiveWorkoutState>((set, get) => ({
  workout: null,
  sessionId: null,
  expanded: false,
  elapsedSeconds: 0,
  setLog: [],

  start: ({ workout, sessionId, withClient, retroactive }) => {
    const state = {
      workout, sessionId, expanded: true, elapsedSeconds: 0, setLog: [],
      withClient, retroactive,
    };
    set(state);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, ts: Date.now() }));
  },

  minimize: () => set({ expanded: false }),
  expand:   () => set({ expanded: true }),

  tick: () => {
    set((s) => ({ elapsedSeconds: s.elapsedSeconds + 1 }));
    // Persist every 10s — not every tick — to limit AsyncStorage writes.
    if (get().elapsedSeconds % 10 === 0) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...get(), ts: Date.now() }));
    }
  },

  appendSetLog: (entry) => {
    set((s) => ({ setLog: [...s.setLog, entry] }));
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...get(), ts: Date.now() }));
  },

  end: async () => {
    set({ workout: null, sessionId: null, expanded: false, elapsedSeconds: 0, setLog: [] });
    await AsyncStorage.removeItem(STORAGE_KEY);
  },

  rehydrate: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { resumed: false };
    try {
      const parsed = JSON.parse(raw);
      const ageHours = (Date.now() - (parsed.ts || 0)) / (1000 * 60 * 60);
      if (ageHours > 24) {
        // Prompt the user before restoring; surface staleness.
        return { resumed: false, staleHours: ageHours };
      }
      set({
        workout: parsed.workout,
        sessionId: parsed.sessionId,
        expanded: false,                       // ALWAYS start minimised
        elapsedSeconds: parsed.elapsedSeconds || 0,
        setLog: parsed.setLog || [],
        withClient: parsed.withClient,
        retroactive: parsed.retroactive,
      });
      return { resumed: true };
    } catch {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return { resumed: false };
    }
  },
}));
```

Rehydration is called from `app/_layout.tsx` (sibling of the `useUserMode.rehydrate()` call from `14-navigation`).

```tsx
useEffect(() => {
  useActiveWorkout
    .getState()
    .rehydrate()
    .then((result) => {
      if (result.staleHours) {
        // Show prompt: "Resume workout from 2 days ago?" — see STORY-007 AC 7.3
      }
    });
}, []);
```

---

## `<ActiveWorkoutOverlay>` — root-mounted switcher

```tsx
// packages/mobile/src/ui/containers/ActiveWorkoutOverlay.tsx
import { useEffect } from "react";
import { useActiveWorkout } from "~/state/active-workout";
import { ActiveSessionContainer } from "./ActiveSessionContainer";
import { ActiveWorkoutBarPresenter } from "~/ui/presenters/ActiveWorkoutBarPresenter";

export function ActiveWorkoutOverlay() {
  const workout = useActiveWorkout((s) => s.workout);
  const expanded = useActiveWorkout((s) => s.expanded);
  const elapsedSeconds = useActiveWorkout((s) => s.elapsedSeconds);
  const expand = useActiveWorkout((s) => s.expand);
  const tick = useActiveWorkout((s) => s.tick);

  // The tick interval lives at the OVERLAY layer, not inside
  // <ActiveSessionContainer>. The overlay stays mounted for the entire session
  // (whether expanded or minimised), so the timer keeps advancing while the bar
  // is showing. The container only mounts when expanded — if the interval lived
  // there, minimising would unmount the container, clear the interval, and the
  // ActiveWorkoutBar would render a frozen clock until re-expanded.
  useEffect(() => {
    if (!workout) return;
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [workout, tick]);

  if (!workout) return null;

  if (expanded) {
    return <ActiveSessionContainer />; // covers the entire screen
  }

  return (
    <ActiveWorkoutBarPresenter
      workoutName={workout.name}
      elapsedSeconds={elapsedSeconds}
      onPress={expand}
    />
  );
}
```

Mounted in `app/(app)/_layout.tsx` (per `14-navigation` design):

```tsx
export default function AppLayout() {
  const drawerOpen = useDrawer((s) => s.open);
  return (
    <>
      <Stack>{…}</Stack>
      {drawerOpen && <ProfileDrawerContainer/>}
      <ActiveWorkoutOverlay/>
    </>
  );
}
```

Z-order: overlay sits ABOVE the tab tree but BELOW the drawer (the drawer's backdrop covers the overlay when open).

---

## `<ActiveSessionPresenter>` rebuild

Per `active-workout.jsx:3–139`. Props:

```ts
type ActiveSessionProps = {
  workout: Workout;
  sessionId: string;
  exercises: ExerciseInSession[];
  elapsedSeconds: number;
  setLog: SetLogEntry[];
  restTimer: RestTimerState;
  withClient?: { initials: string; name: string };
  retroactive?: boolean;

  onMinimize: () => void;
  onEnd: () => void;
  onAddSet: (exerciseId: string) => void;
  onRecordSet: (entry: SetLogEntry) => void;
  onDeleteSet: (setId: string) => void;
  onSwapExercise: (exerciseId: string) => void;
  onStartRest: (exerciseId: string, duration: number) => void;
  onFinishWorkout: () => void;
};
```

Layout:

```tsx
<View flex={1} bg="$bg">
  {/* Header */}
  <View row p={12} alignItems="center" gap={8}>
    <IconBtn
      icon={<IconChevronD />}
      size={36}
      tone="neutral"
      onPress={onMinimize}
    />
    <View flex={1} alignItems="center">
      <Text variant="h3" numberOfLines={1}>
        {workout.name}
      </Text>
      <Row gap={4} mt={2}>
        <IconTimer size={11} color="$primary" />
        <Text variant="mono" color="$primary" fontWeight={600}>
          {fmt(elapsedSeconds)}
        </Text>
      </Row>
    </View>
    <Pressable
      onPress={() => setConfirmEnd(true)}
      style={{
        height: 36,
        paddingX: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "$border2",
      }}
    >
      <Text variant="display" weight={600} size={12.5} color="$text3">
        End
      </Text>
    </Pressable>
  </View>

  {/* Trainer banner */}
  {withClient && (
    <TrainerBannerPresenter withClient={withClient} retroactive={retroactive} />
  )}

  {/* Exercise blocks */}
  <ScrollView>
    {exercises.map((ex) => (
      <ExerciseBlock
        key={ex.id}
        exercise={ex}
        sets={setLog.filter((s) => s.exerciseId === ex.id)}
        onAddSet={() => onAddSet(ex.id)}
        onRecordSet={onRecordSet}
        onDeleteSet={onDeleteSet}
        onSwap={() => onSwapExercise(ex.id)}
        onStartRest={() => onStartRest(ex.id, 60)}
      />
    ))}
  </ScrollView>

  {/* Sticky Finish CTA */}
  <View position="absolute" bottom={24} left={16} right={16}>
    <Btn
      full
      variant="filled"
      tone="primary"
      size="lg"
      icon={<IconCheck />}
      onPress={onFinishWorkout}
    >
      Finish Workout
    </Btn>
  </View>

  {/* End confirm dialog */}
  {confirmEnd && (
    <EndConfirmDialogPresenter
      elapsed={fmt(elapsedSeconds)}
      onKeepGoing={() => setConfirmEnd(false)}
      onEnd={() => {
        setConfirmEnd(false);
        onEnd();
      }}
    />
  )}

  {/* Rest timer (preserved from V2) */}
  {restTimer.isActive && <RestTimerDisplay {...restTimer} />}
</View>
```

### `<ExerciseBlock>` — new spec-local composite

Per `active-workout.jsx:73–106`. Domain-specific; lives in `packages/mobile/src/ui/components/session/ExerciseBlock/`.

```ts
type ExerciseBlockProps = {
  exercise: ExerciseInSession;
  sets: SetLogEntry[];
  onAddSet: () => void;
  onRecordSet: (entry: SetLogEntry) => void;
  onDeleteSet: (setId: string) => void;
  onSwap: () => void;
  onStartRest: () => void;
};
```

Header row: 28×28 icon tile + name + "{N} sets × {min}-{max} reps" + swap IconBtn. Set grid header + rows per the visual contract in `requirements.md` STORY-003 ACs. Inline `+ ADD SET` and `60S REST` links below.

### `<SetRow>` — new spec-local composite

5-column grid `36pt 1fr 1fr 1fr 24pt`:

```tsx
<Row display="grid" gridTemplateColumns="36pt 1fr 1fr 1fr 24pt" gap={8} py={8} borderBottom="$border">
  <Text variant="mono" color="$text2" size={13}>{setNumber}</Text>
  <Text variant="mono" color="$text4" size={12}>{previousValue || '—'}</Text>
  <TextInput
    value={reps}
    onChangeText={setReps}
    onBlur={() => onRecordSet({ reps: Number(reps), weight: Number(weight) })}
    keyboardType="numeric"
    placeholder="—"
    style={inputStyle}
  />
  <TextInput value={weight} … />
  <IconBtn icon={<IconX size={12}/>} size={20} tone="ghost" color="$error" onPress={onDelete}/>
</Row>
```

`inputStyle`: `$surface2` bg, `$border` 1pt, `$sm` radius (6pt), `$mono` font 13pt, centred text alignment.

### `<EndConfirmDialogPresenter>` — new presenter

Per `active-workout.jsx:115–136`. Uses a custom centred-modal layout (NOT `<BottomSheet>` — the prototype is a centred dialog, not a sheet).

```tsx
function EndConfirmDialogPresenter({ elapsed, onKeepGoing, onEnd }) {
  return (
    <Pressable onPress={onKeepGoing} style={fullScreenBackdrop}>
      <View onStartShouldSetResponder={() => true} style={dialogCard}>
        <Text variant="h1" mb={8}>
          End workout?
        </Text>
        <Text variant="body" size={13} mb={16} color="$text2">
          Your progress so far ({elapsed}) won't be saved as a completed
          workout.
        </Text>
        <Row gap={10}>
          <Btn
            variant="outline"
            tone="primary"
            size="md"
            onPress={onKeepGoing}
            flex={1}
          >
            Keep going
          </Btn>
          <Btn variant="filled" tone="error" size="md" onPress={onEnd} flex={1}>
            End
          </Btn>
        </Row>
      </View>
    </Pressable>
  );
}
```

`fullScreenBackdrop`: `position: absolute; inset: 0; background: rgba(0,0,0,0.65); backdropFilter: blur(6px); zIndex: $modal; display: flex; justifyContent: center; alignItems: center; padding: 24`.

`dialogCard`: `$surface` bg, `$border2` 1pt, `$xl` radius (20), padding 22, maxWidth 320, shadow `0 20px 60px rgba(0,0,0,0.6)`.

### `<TrainerBannerPresenter>` — new presenter

Per `active-workout.jsx:45–63`. Shipped here; data wired by M8 (`10-trainer-features`).

```ts
type TrainerBannerProps = {
  withClient: { initials: string; name: string };
  retroactive?: boolean;
};

function TrainerBannerPresenter({ withClient, retroactive }) {
  return (
    <Row mx={16} mb={12} p={8} px={12} gap={10} alignItems="center"
         bg="linear-gradient(135deg, $accentTrainerDim 0%, $surface2 100%)"
         borderColor="$accentTrainerDim"
         borderRadius={10}>
      <Avatar initials={withClient.initials} size={28} tone="trainer"/>
      <View flex={1}>
        <Text variant="eyebrow" color="$accentTrainer" size={9}>
          {retroactive ? 'LOGGING SESSION FOR' : 'TRAINING LIVE WITH'}
        </Text>
        <Text color="$text" size={13} weight={600} mt={1}>{withClient.name}</Text>
      </View>
      {!retroactive && (
        <Pill tone="success" size="xs">
          <View w={4} h={4} borderRadius={2} bg="$success" shadowColor="$success" shadowRadius={4}/>
          LIVE
        </Pill>
      )}
      {retroactive && <Pill tone="neutral" size="xs">RETRO</Pill>}
    </Row>
  );
}
```

---

## `<ActiveWorkoutBarPresenter>` — minimised bar

Per `active-workout.jsx:142–181`.

```ts
type ActiveWorkoutBarProps = {
  workoutName: string;
  elapsedSeconds: number;
  onPress: () => void;
  onLongPress?: () => void; // reveals end option
};
```

Layout: floating absolute pill at `bottom: tabBarHeight + 12`. Pulsing primary dot (Reanimated `withRepeat(withTiming({ opacity: 0.35 }, 700ms))`) + eyebrow + workout name + mono timer + chevron-right rotated -90°. Cyan glow border (`$primaryDim` 1pt + box-shadow `0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px $primaryDim`).

Long-press triggers the end-confirm dialog (via the overlay's `setConfirmEnd(true)`).

---

## `<ActiveSessionContainer>` plumbing

```tsx
// packages/mobile/src/ui/containers/ActiveSessionContainer.tsx
export function ActiveSessionContainer() {
  const workout = useActiveWorkout((s) => s.workout);
  const sessionId = useActiveWorkout((s) => s.sessionId);
  const elapsedSeconds = useActiveWorkout((s) => s.elapsedSeconds);
  const setLog = useActiveWorkout((s) => s.setLog);
  const withClient = useActiveWorkout((s) => s.withClient);
  const retroactive = useActiveWorkout((s) => s.retroactive);

  const tick = useActiveWorkout((s) => s.tick);
  const minimize = useActiveWorkout((s) => s.minimize);
  const appendSetLog = useActiveWorkout((s) => s.appendSetLog);

  // Existing V2 hooks — unchanged
  const { mutateAsync: recordSet } = usePostRecordSet();
  const { mutateAsync: deleteSet } = useDeleteSet();
  const { mutateAsync: swapExercise } = useSwapExerciseInSession();
  const { mutate: startRest } = useRestTimer();
  const { mutateAsync: endSession } = useEndSession();
  const restTimer = useRestTimerState();

  // NOTE: the tick interval intentionally lives in <ActiveWorkoutOverlay> (see
  // § Overlay state machine), NOT here. This container unmounts on minimise,
  // so a tick interval inside it would freeze the bar's clock until re-expand.

  if (!workout || !sessionId) return null;

  return (
    <ActiveSessionPresenter
      workout={workout}
      sessionId={sessionId}
      exercises={workout.exercises}
      elapsedSeconds={elapsedSeconds}
      setLog={setLog}
      restTimer={restTimer}
      withClient={withClient}
      retroactive={retroactive}
      onMinimize={minimize}
      onEnd={async () => {
        await endSession({ sessionId });
        router.replace('/(app)/session/summary');
      }}
      onAddSet={…}
      onRecordSet={async (entry) => {
        appendSetLog(entry);            // optimistic Zustand
        await recordSet(entry);          // queues via sync queue
      }}
      onDeleteSet={…}
      onSwapExercise={async (id) => { await swapExercise({ sessionId, fromExerciseId: id }); }}
      onStartRest={…}
      onFinishWorkout={async () => {
        await endSession({ sessionId });
        router.replace('/(app)/session/summary');
      }}
    />
  );
}
```

The Zustand slice handles UI state machine (minimise/expand, elapsed counter, persistence). The existing V2 hooks handle data mutations + sync queue. They cooperate via the optimistic `appendSetLog` + persisted-mutation pattern.

---

## `<SessionSummaryPresenter>` rewrite

Shell-only update. V2's current structure (3-stat strip + PR cards + Continue) preserved. Visual changes:

- `<HeaderBar>` compact with "Workout Complete!" title + close IconBtn.
- 3-stat strip via `<Card pad={16} radius={14}>` with three `<Stat>` primitives.
- PR cards via `<PRCard>` composite (from `01-design-system`).
- Continue CTA via `<Btn variant="filled" tone="primary" size="lg" full>Continue</Btn>`.

Container layer (`SessionSummaryContainer`) unchanged.

---

## `<WorkoutRatingPresenter>` rewrite

Shell-only update. `<SemiCircleSlider>` preserved (signature interaction). Per-band colour mapping:

```ts
const RPE_BAND_TONES = {
  easy: "$success", // 1-3
  moderate: "$info", // 4-5
  hard: "$warning", // 6-7
  veryHard: "$ember", // 8-9
  maximal: "$error", // 10
};
```

Notes field becomes a `<TextInput>` styled with new tokens (`$surface2` bg, `$border` 1pt, `$md` radius). Submit Btn via `<Btn variant="filled" tone="primary" size="lg" full>Submit Rating</Btn>`.

After submit, `useActiveWorkout().end()` clears the Zustand state and navigates back to the previous tab.

---

## Backend impact

**None.**

All consumed endpoints exist in V2:

| Method | Path                              |
| ------ | --------------------------------- |
| POST   | `/sessions`                       |
| GET    | `/sessions/:id`                   |
| PUT    | `/sessions/:id`                   |
| DELETE | `/sessions/:id`                   |
| POST   | `/sessions/:id/sets` (bulk-flush) |
| PUT    | `/sessions/:id/sets/:setId`       |
| DELETE | `/sessions/:id/sets/:setId`       |
| POST   | `/sessions/:id/swap-exercise`     |

No migrations. No new ports. No sync-queue handler changes.

---

## Offline-first preservation

Two persistence layers operating in lockstep:

1. **Zustand state machine** — `useActiveWorkout` slice persists to AsyncStorage on every tick (every 10s) + on every set-log change + on every state transition. Provides instant rehydration on launch.

2. **Local SQLite via the existing V2 session adapter** — `usePostRecordSet` mutation queues each set to the sync queue + writes optimistically to the local cache. Provides crash-safe, eventually-consistent server sync.

These layers are independent and idempotent:

- Force-quit during a session → both layers have the data → no double-counting on resume.
- Set committed but app crashed before AsyncStorage write → sync queue + SQLite still hold the set; Zustand rehydrates from `setLog`-less state but the user sees their sets via the SQLite-backed session view.

---

## Testing strategy

### Unit tests

- `useActiveWorkout` slice: every action method, AsyncStorage persistence, rehydrate path (fresh / stale > 24h / corrupt / no key).
- `<EndConfirmDialogPresenter>` — both CTAs, backdrop tap.
- `<TrainerBannerPresenter>` — LIVE vs RETRO render, eyebrow text variants.
- `<ActiveWorkoutBarPresenter>` — pulse animation, long-press trigger.
- `<ExerciseBlock>` — set grid render, add-set + start-rest inline links, swap-exercise IconBtn.
- `<SetRow>` — input commit calls `onRecordSet`, delete IconBtn calls `onDelete`.

### Integration tests

- Start session → minimize → navigate to Train tab → bar is visible → tap bar → expanded screen returns.
- Record set offline (in-memory adapter throws) → set appears optimistically → adapter recovers → assert sync queue flush.
- Force-quit simulation (kill Zustand + reload from AsyncStorage) → session resumes correctly minimised.
- End session → summary screen → rate screen → submit rating → return to previous tab → `useActiveWorkout` state cleared.

### Visual regression

- `<ActiveSessionPresenter>` vs `active-workout.jsx` side-by-side.
- `<ActiveWorkoutBarPresenter>` vs `active-workout.jsx:142–181`.
- `<EndConfirmDialogPresenter>` vs `active-workout.jsx:115–136`.
- `<TrainerBannerPresenter>` vs `active-workout.jsx:45–63` — both LIVE and RETRO states.

### Coverage

90% lines/branches/functions/statements per `_agent.md`.

---

## Risks + mitigations

| Risk                                                                            | Mitigation                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AsyncStorage write on every tick is too noisy                                   | Slice writes every 10s instead. Set-log writes are immediate (small payload).                                                                                                                                                                 |
| Zustand state diverges from SQLite cache after a crash                          | Both layers are idempotent. On crash, the user sees their sets via the SQLite-backed view; Zustand rehydrates from `setLog`-less state. The user can re-tap any missing input — the SQLite cache is the source of truth for displayed values. |
| Minimised bar interferes with ActiveWorkoutBar gestures                         | Long-press is the only end affordance from the bar; single tap always expands. Backdrop blur on end-confirm prevents misclicks.                                                                                                               |
| Tab bar height changes (`14-navigation` STORY-008) might shift the bar position | Bar reads `tabBarHeight` from the same hook the tab bar uses (`useSafeAreaInsets().bottom + 60`). Single source of truth.                                                                                                                     |
| Trainer banner is shipped but never wired until M8 — risk of dead code          | Banner props default `undefined` → banner doesn't render → no runtime cost. Slot is tested with mocked props in the presenter test.                                                                                                           |
| Set inputs commit on blur — user may navigate before blur fires                 | Listen for `onSubmitEditing` AND `onBlur`. If neither fires before navigation, persist the in-flight value on the screen's unmount via a cleanup effect.                                                                                      |

---

_End of `05-active-session/design.md` · 2026-05-27 (rewritten from scratch)_
