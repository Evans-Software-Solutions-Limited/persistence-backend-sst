# 04 — Workout Management: Design

> **Spec rewritten from scratch on 2026-05-27.** Pairs with `requirements.md` (same date).

---

## Architecture overview

The data layer is unchanged from V2. The presentation layer rewires through new primitives + relocates under the Train hub. File map:

```
packages/mobile/
├── app/(app)/
│   ├── (tabs)/
│   │   └── train.tsx                    ← TrainHubContainer (owned by 14-navigation)
│   ├── workouts/
│   │   ├── create.tsx                   ← WorkoutCreatorContainer (preserved)
│   │   └── [id]/
│   │       ├── index.tsx                ← WorkoutDetailContainer (preserved)
│   │       └── edit.tsx                 ← WorkoutEditorContainer (preserved)
│   └── exercises/
│       ├── [id].tsx                     ← ExerciseDetailContainer (preserved)
│       ├── [id]/edit.tsx                ← ExerciseEditorContainer (preserved)
│       ├── create.tsx                   ← DELETED — replaced by CreateExerciseSheet
│       └── filters/                     ← preserved
└── src/
    ├── application/
    │   ├── workouts/                    ← unchanged (90% coverage preserved)
    │   └── exercises/                   ← unchanged
    ├── domain/{models,ports}            ← unchanged
    ├── adapters/{api,storage}           ← unchanged (SQLite cache + sync queue)
    └── ui/
        ├── containers/
        │   ├── WorkoutsListContainer.tsx        ← rewired under Train segment
        │   ├── ExerciseListContainer.tsx        ← rewired under Train segment
        │   ├── WorkoutDetailContainer.tsx       ← unchanged plumbing, presenter updated
        │   ├── WorkoutCreatorContainer.tsx      ← unchanged plumbing
        │   ├── WorkoutEditorContainer.tsx       ← unchanged plumbing
        │   ├── CreateExerciseSheetContainer.tsx ← NEW
        │   └── ExerciseEditorContainer.tsx      ← unchanged plumbing
        └── presenters/
            ├── WorkoutsListPresenter.tsx
            ├── ExerciseListPresenter.tsx
            ├── WorkoutDetailPresenter.tsx
            ├── WorkoutCreatorPresenter.tsx
            ├── WorkoutEditorPresenter.tsx
            ├── CreateExerciseSheetPresenter.tsx   ← NEW
            └── ExerciseEditorPresenter.tsx
```

---

## `<WorkoutsListPresenter>` rewrite

Per `library.jsx:4–47`. Props match the existing V2 presenter — internals rewired through new primitives.

```ts
type WorkoutsListProps = {
  mine: Workout[];
  assigned: Workout[];
  defaults: Workout[];
  isLoading: boolean;
  error: Error | null;
  workoutLimit?: { used: number; limit: number };
  onCreate: () => void;
  onOpen: (workoutId: string) => void;
  onStart: (workoutId: string) => void;
  onRefresh: () => Promise<void>;
};
```

Layout:

```tsx
<ScrollView refreshControl={…}>
  <Btn full variant="filled" tone="primary" size="lg" icon={<IconPlus/>} onPress={onCreate}>
    Create Workout
  </Btn>

  {workoutLimit && <WorkoutLimitIndicator used={…} limit={…} />}

  <Section title="My Workouts" sub={`${mine.length} created · ${assigned.length} assigned`}>
    <Card pad={0} radius={14}>
      {mine.map((w, i) => <WorkoutRow key={w.id} workout={w} isLast={i === mine.length - 1} onPress={…} onStart={…} />)}
    </Card>
  </Section>

  <Section title="Assigned" sub={`${assigned.length} from coach`}>
    <Card pad={0} radius={14}>{assigned.map(…)}</Card>
  </Section>

  <Section title="Templates" sub={`${defaults.length} ready-to-use`}>
    <Card pad={0} radius={14}>{defaults.map(…)}</Card>
  </Section>
</ScrollView>
```

### `<WorkoutRow>` — new spec-local composite

Per `library.jsx:64–82`. Lives in `packages/mobile/src/ui/components/workouts/WorkoutRow/` (domain-specific, not a `01-design-system` foundation/composite).

```ts
type WorkoutRowProps = {
  workout: Workout;
  isLast: boolean;
  onPress: () => void;
  onStart: () => void;
};
```

Layout: 40×40 toned icon tile (`<IconDumbbell size={20}/>`) + name + meta + `<IconBtn size={32} icon={<IconPlay size={12}/>} tone="primary" onPress={onStart}/>`. Tone derived from `workout.tags[0]` or workout colour preference; defaults to `$primary`. Meta line: `{mins}m · {ex} exercises · <Pill tone={tone} size="xs">{badge}</Pill>`. Bottom border `$border` unless `isLast`.

---

## `<ExerciseListPresenter>` rewrite

Per `library.jsx:88–166`. Props:

```ts
type ExerciseListProps = {
  exercises: Exercise[];
  isLoading: boolean;
  error: Error | null;
  searchQuery: string;
  activeFilter: string;
  onSearch: (q: string) => void;
  onFilterChange: (f: string) => void;
  onOpenFilterMenu: () => void;
  onOpen: (exerciseId: string) => void;
  onCreate: () => void; // opens the CreateExerciseSheet
  onRefresh: () => Promise<void>;
};
```

Layout:

```tsx
<View>
  <SearchBar
    value={searchQuery}
    onChangeText={onSearch}
    placeholder={`Search ${exercises.length} exercises`}
  />

  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
    <IconBtn
      icon={<IconFilter size={14} />}
      size={32}
      tone="neutral"
      onPress={onOpenFilterMenu}
    />
    {FILTER_CHIPS.map((label) => (
      <FilterChip
        key={label}
        active={activeFilter === label}
        onPress={() => onFilterChange(label)}
      >
        {label}
      </FilterChip>
    ))}
  </ScrollView>

  <FlashList
    data={filteredExercises}
    renderItem={({ item }) => (
      <ExerciseCard exercise={item} onPress={() => onOpen(item.id)} />
    )}
    estimatedItemSize={108}
  />
</View>
```

### `<FilterChip>` — new spec-local composite

Per `library.jsx:131–142`. Pill-shaped pressable, `$surface2` default, `$primary` fill + `$primaryInk` fg when active. 32pt height, 14pt horizontal padding.

### `<ExerciseCard>` — new spec-local composite

Per `library.jsx:145–165`. `<Card>` with 3pt left-border in tone derived from primary muscle. Header row: name + level pill (tone derived: beginner → success, intermediate → gold, advanced → error, expert → error). Body: short description. Footer: primary muscle pill + neutral pills for tags.

Level values are the lowercase enum members from `exerciseDifficultyEnum` (`schema.ts:31`); render-side capitalisation happens in the pill label, not on the union member.

```ts
import type { CardAccent } from "~/ui/components/foundation/Card"; // see 01-design-system (Card.tsx lives under components/foundation/)

type ExerciseLevel = "beginner" | "intermediate" | "advanced" | "expert";

function levelToTone(level: ExerciseLevel): PillTone {
  switch (level) {
    case "beginner":
      return "success";
    case "intermediate":
      return "gold";
    case "advanced":
    case "expert":
      return "error";
  }
}

function levelLabel(level: ExerciseLevel): string {
  return level[0].toUpperCase() + level.slice(1); // "Beginner", etc. for the pill label only
}

// `<ExerciseCard>` is called with the GRANULAR domain MuscleGroup enum values
// (per schema.ts muscle_groups + the conversion layer below) — NOT the coarse
// UI labels from MUSCLES. The granular set has no "legs" / "arms" / "cardio"
// member, so a switch on those values would dead-code three of the seven
// branches. Map granular → tone via the inverse of MUSCLE_LABEL_TO_GROUPS:
// each granular muscle resolves back to the coarse label that owns it, then
// to the same tone the picker chip would have used.
const MUSCLE_GROUP_TO_TONE: Record<MuscleGroup, CardAccent> = {
  // Chest → primary
  chest: "primary",
  // Back / Lats → gold (matches the "Back" picker label)
  back: "gold",
  lats: "gold",
  // Legs → ember (matches the "Legs" picker label expansion)
  quadriceps: "ember",
  hamstrings: "ember",
  glutes: "ember",
  calves: "ember",
  // Shoulders / Traps → primary (matches the "Shoulders" picker label expansion)
  shoulders: "primary",
  traps: "primary",
  // Arms → gold (matches the "Arms" picker label expansion)
  biceps: "gold",
  triceps: "gold",
  forearms: "gold",
  // Core → success
  core: "success",
  // Hip / Adductor / Abductor — no picker-label equivalent (no "Hips" chip); fall back to primary
  hip_flexors: "primary",
  abductors: "primary",
  adductors: "primary",
};

function muscleToTone(muscle: MuscleGroup | undefined): CardAccent {
  // Cardio exercises produce `primaryMuscleGroups: []` per the Conversion layer
  // (Cardio is a category, not a muscle), so the caller passes `undefined`
  // when reading the first element. Default to "trainer" so the cardio card
  // still gets a distinctive tint without a muscle to derive from.
  if (!muscle) return "trainer";
  return MUSCLE_GROUP_TO_TONE[muscle] ?? "primary";
}
```

---

## `<CreateExercisePresenter>` — full-screen create

The form content below is per `create-exercise.jsx:19–203`, but rendered **full-screen**, not in a `<BottomSheet>`.

> **Revised 2026-06-03 (Phase 04.3 — full-screen, supersedes the sheet design):** create-exercise is a **full-screen route** (`<CreateExercisePresenter>` = `<HeaderBar>` + `KeyboardAvoidingView` + `ScrollView` form + sticky Cancel/Save footer; `<CreateExerciseContainer>` wires the command + `router.back()`). The original `<BottomSheet>`-based design (this section's "Sheet mount-point" + the `TrainHubContainer` sheet snippet below) is **obsolete** — the long form needed reliable scroll/keyboard handling the gorhom sheet fought on device. The sheet-only machinery (`useCreateExerciseSheet` store, root-layout mount, sign-out reset, `pendingCreate`/redirect-stub) is removed; the `<BottomSheet>` primitive fixes (gorhom `enableDynamicSizing={false}` + scroll-view `flex: 1`) stay for ProfileDrawer + other sheets. Triggers `router.push("/(app)/exercises/create")`.
>
> **Revised 2026-06-02 (Phase 04.3 implementation):** Three deltas from the design below: (1) the **Cardio** chip is dropped (the `Cardio → []` mapping fails `validateExerciseInput`'s ≥1-primary-muscle rule; cardio-as-category deferred), so `MuscleLabel` is the six muscles below and `category` is always `"strength"`; (2) form state is controlled `value`/`onChange`, not `react-hook-form` (not a dependency); (3) the container wires the real `createExerciseCommand` — there is **no** `useCreateExercise()` hook — and bumps a `useExerciseLibrary` signal on success so the sibling list re-reads (AC 6.5).

```ts
type CreateExerciseSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSave: (input: NewExerciseInput) => Promise<void>;
};

type NewExerciseInput = {
  name: string;
  primaryMuscleLabel: MuscleLabel; // UI-display label, mapped to MuscleGroup[] at the container boundary (see § Conversion layer)
  secondaryMuscleLabels: MuscleLabel[]; // 0..N labels, mapped to MuscleGroup[]
  equipmentLabel: EquipmentLabel; // UI label → EquipmentType (single → array of length 1)
  level: ExerciseLevel; // "beginner" | "intermediate" | "advanced" | "expert" — matches exerciseDifficultyEnum (schema.ts:31). UI radio labels capitalise via levelLabel(); the union value posted to /exercises must be lowercase or the backend rejects with `invalid input value for enum exercise_difficulty`.
  category: ExerciseCategory; // REQUIRED by CreateExerciseInput — defaults to "strength" unless primaryMuscleLabel === "Cardio" (see conversion)
  instructions?: string;
  photoUrl?: string; // mapped to `thumbnailUrl` at the container boundary
};

// UI-display labels (coarse, matches the create-exercise.jsx mock):
type MuscleLabel =
  | "Chest"
  | "Back"
  | "Legs"
  | "Shoulders"
  | "Arms"
  | "Core"
  | "Cardio";
const MUSCLES: MuscleLabel[] = [
  "Chest",
  "Back",
  "Legs",
  "Shoulders",
  "Arms",
  "Core",
  "Cardio",
];

type EquipmentLabel =
  | "Barbell"
  | "Dumbbell"
  | "Machine"
  | "Cable"
  | "Bodyweight"
  | "Kettlebell"
  | "Band";
const EQUIPMENT_OPTIONS: EquipmentLabel[] = [
  "Barbell",
  "Dumbbell",
  "Machine",
  "Cable",
  "Bodyweight",
  "Kettlebell",
  "Band",
];
```

### Conversion layer — UI labels → domain `CreateExerciseInput`

The presenter collects coarse, capitalised UI labels (`"Legs"`, `"Arms"`, `"Cardio"`, etc.) because that's what the prototype's `create-exercise.jsx` renders. The domain model in `packages/mobile/src/domain/models/exercise.ts:220` (`CreateExerciseInput`) is granular, lowercase, and array-shaped:

```ts
type CreateExerciseInput = {
  name: string;
  description?: string;
  instructions?: string;
  category: ExerciseCategory; // "strength" | "cardio" | "flexibility" | …
  difficulty: ExerciseDifficulty; // "beginner" | "intermediate" | "advanced" | "expert"
  primaryMuscleGroups: MuscleGroup[]; // granular: "biceps" | "triceps" | "quadriceps" | …
  secondaryMuscleGroups?: MuscleGroup[];
  equipment: EquipmentType[]; // lowercase: "barbell" | "dumbbell" | "machine" | …
  videoUrl?: string;
  thumbnailUrl?: string;
};
```

The CreateExerciseSheetContainer maps `NewExerciseInput` → `CreateExerciseInput` before calling `useCreateExercise()`. Conversion rules:

```ts
const MUSCLE_LABEL_TO_GROUPS: Record<MuscleLabel, MuscleGroup[]> = {
  Chest: ["chest"],
  Back: ["back", "lats"],
  Legs: ["quadriceps", "hamstrings", "glutes", "calves"], // coarse "Legs" maps to all four
  Shoulders: ["shoulders", "traps"],
  Arms: ["biceps", "triceps", "forearms"], // coarse "Arms" → three groups
  Core: ["core"],
  Cardio: [], // Cardio is a category, not a muscle — empty array + sets category="cardio"
};

const EQUIPMENT_LABEL_TO_ENUM: Record<EquipmentLabel, EquipmentType> = {
  Barbell: "barbell",
  Dumbbell: "dumbbell",
  Machine: "machine",
  Cable: "cable",
  Bodyweight: "bodyweight",
  Kettlebell: "kettlebell",
  Band: "resistance_band",
};

function toCreateExerciseInput(input: NewExerciseInput): CreateExerciseInput {
  const isCardio = input.primaryMuscleLabel === "Cardio";
  return {
    name: input.name,
    instructions: input.instructions,
    category: isCardio ? "cardio" : input.category, // Cardio label forces category
    difficulty: input.level,
    primaryMuscleGroups: MUSCLE_LABEL_TO_GROUPS[input.primaryMuscleLabel],
    secondaryMuscleGroups: input.secondaryMuscleLabels.flatMap(
      (l) => MUSCLE_LABEL_TO_GROUPS[l],
    ),
    equipment: [EQUIPMENT_LABEL_TO_ENUM[input.equipmentLabel]],
    thumbnailUrl: input.photoUrl,
  };
}
```

The container then calls `await createExercise(toCreateExerciseInput(input))`. Mapping is one-way (UI → domain); when the same exercise is later read for editing, the granular muscle list is preserved as-is (a finer-grained list than the picker can express — that's fine for v1; granular edit UI is post-launch).

Sheet sections (from `create-exercise.jsx`):

1. **Name input** — text input, required, autoFocus, `$surface2` bg, 10pt radius.
2. **Photo placeholder** — dashed-border 16:7 aspect button with `<IconCamera>` + label.
3. **Primary muscle** — radio chips (`$primary` active fill, `$primaryDim` inactive border).
4. **Secondary muscles** — multi-select chips (active = `$primary` border + `$primaryDim` bg + `<IconCheck>` prefix).
5. **Equipment** — radio chips (`$gold` accent when selected).
6. **Level** — 3-column radio grid with per-tier tones.
7. **Instructions textarea** — multiline, min 88pt, optional.
8. **Preview chip** — gradient `$primaryDim`→`$surface2`, live PRIMARY + EQUIPMENT + LEVEL + first 2 secondaries + overflow.
9. **Footer** — Cancel (outline, flex 1) + Save (filled, flex 2). Save disabled until `name.trim()` is non-empty. After successful save: button text → "Saved ✓" for 700ms, then sheet closes.

### Container

```ts
// CreateExerciseSheetContainer.tsx
export function CreateExerciseSheetContainer({ visible, onClose }) {
  const { mutateAsync: createExercise } = useCreateExercise(); // existing V2 mutation
  return (
    <CreateExerciseSheetPresenter
      visible={visible}
      onClose={onClose}
      onSave={async (input) => {
        // Convert UI labels → domain enums at the container boundary.
        // See § Conversion layer above for the mapping rules.
        await createExercise(toCreateExerciseInput(input));
        onClose();
      }}
    />
  );
}
```

### Sheet mount-point

Mounted inside `<TrainHubContainer>` from `14-navigation`. The full container (including the Zustand-selector hook reads + the `pendingCreate` deep-link effect) is canonical in `14-navigation/design.md § Train hub`; the snippet below mirrors only the parts relevant to the sheet so this spec stays self-contained. **Do not duplicate the canonical definition — `14-navigation` owns it.**

```tsx
function TrainHubContainer() {
  const segment = useTrainSegment((s) => s.segment); // see 14-navigation for full hook contract
  const setSegment = useTrainSegment((s) => s.setSegment);
  const [sheetOpen, setSheetOpen] = useState(false);

  // (pendingCreate effect for /exercises/create deep-link redirect lives in 14)

  return (
    <>
      <HeaderBar
        large
        eyebrow="TRAIN"
        title={segment === "Workouts" ? "Workouts" : "Exercises"}
        trailing={
          segment === "Exercises" ? (
            <Btn
              size="sm"
              variant="soft"
              tone="primary"
              icon={<IconPlus />}
              onPress={() => setSheetOpen(true)}
            >
              Create
            </Btn>
          ) : (
            <IconBtn icon={<IconSearch size={18} />} tone="ghost" onPress={…} />
          )
        }
      />
      <Segmented
        options={["Workouts", "Exercises"]}
        value={segment}
        onChange={setSegment}
      />
      {segment === "Workouts" ? (
        <WorkoutsListContainer />
      ) : (
        <ExerciseListContainer />
      )}
      <CreateExerciseSheetContainer
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
```

---

## `<WorkoutDetailPresenter>` rewrite

V2 already has this as a full-screen modal route (PR #41). Rewrite is shell-only.

```ts
type WorkoutDetailProps = {
  workout: Workout; // includes nested exercises[]
  isOwner: boolean;
  isLoading: boolean;
  error: Error | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStartSession: () => void;
};
```

Layout:

- `<HeaderBar>` compact with leading close `<IconBtn icon={<IconX/>}/>` + centred workout name + trailing Edit `<IconBtn icon={<IconEdit/>}/>` (owner only).
- Body: optional description (`$body.md` `$text2`), exercise list (each item: superset bracket on left side + exercise name + set/rep target + rest), Start CTA at the bottom (`<Btn variant="filled" tone="primary" size="lg" full>Start Workout</Btn>`).
- Each exercise row tap → `(app)/exercises/[id].tsx`.

Container (`WorkoutDetailContainer`) unchanged — same `useGetWorkoutById`, `useDeleteWorkout`, `useStartSession`.

---

## `<WorkoutCreatorPresenter>` + `<WorkoutEditorPresenter>` rewrite

V2's existing form structure preserved. Shell-only changes:

- Header → `<HeaderBar>` compact with leading close + trailing Save IconBtn.
- Field labels + inputs styled per new tokens (`$surface2` bg, `$border` 1pt, `$md` radius, `$body.md` text).
- `<AddExercisePopover>` preserved (already a `<BottomSheet>`-style popover in V2).
- `<ExerciseConfigCard>` preserved with internal styling refresh through new primitives.
- Submit button → `<Btn variant="filled" tone="primary" size="lg" full>Save Workout</Btn>`.

No behavioural changes — same validation, same submit, same propagation logic for superset shared fields.

---

## `<ExerciseDetailPresenter>` rewrite

V2 already has it. Shell-only update:

- Header: `<HeaderBar>` compact with close + Edit (owner only).
- Body: photo (if present), description, primary + secondary muscles section, equipment section, instructions section, related-exercises section.
- All `<View>` cards → `<Card>`. All ad-hoc badges → `<Pill>`. All Ionicons → Lucide.

Container unchanged.

---

## `<ExerciseEditorPresenter>` rewrite

V2 already has it. Same field set as the Create Exercise sheet (per STORY-008) but rendered full-screen. Shell-only update + ensures the field components are shared with the sheet (a `<ExerciseFormFields>` shared internal component that both the sheet and the editor compose against).

```ts
// packages/mobile/src/ui/components/exercises/ExerciseFormFields.tsx
type ExerciseFormFieldsProps = {
  value: NewExerciseInput;
  onChange: (next: NewExerciseInput) => void;
  showsPhoto?: boolean; // sheet shows compact; editor shows full
};
```

Both `<CreateExerciseSheetPresenter>` and `<ExerciseEditorPresenter>` import + render this component. Avoids field-state duplication.

---

## Backend impact

**None.**

All consumed endpoints exist in V2:

| Method | Path             |
| ------ | ---------------- |
| GET    | `/workouts`      |
| GET    | `/workouts/:id`  |
| POST   | `/workouts`      |
| PUT    | `/workouts/:id`  |
| DELETE | `/workouts/:id`  |
| GET    | `/exercises`     |
| GET    | `/exercises/:id` |
| POST   | `/exercises`     |
| PUT    | `/exercises/:id` |
| DELETE | `/exercises/:id` |

No migrations. No new ports. No sync-queue handler changes.

---

## Offline-first preservation

All flows continue to use the V2 architecture:

1. **Reads** — SQLite cache hydrated on launch; UI renders from cache; background refetch from API; cache updates trigger re-render.
2. **Writes** — mutation enqueued to sync queue + optimistic local cache update; sync engine flushes when online; conflicts last-write-wins (server authoritative).
3. **Create exercise via sheet** — uses the same `useCreateExercise()` mutation as the deleted full-screen route. Mutation path is unchanged.

No new sync-queue action types. The presentation layer change is opaque to the application + adapter layers.

---

## Testing strategy

### Unit tests (coverage preserved)

- `application/workouts/**` — 90% preserved.
- `application/exercises/**` — same.

### New presenter tests

- `WorkoutsListPresenter` — three sections render, empty state per section, quota indicator when `workoutLimit !== undefined`, refresh control wiring.
- `ExerciseListPresenter` — filter chip toggling, search input wiring, FlashList render, empty filter result.
- `CreateExerciseSheetPresenter` — every field interaction, Save disabled until name non-empty, Save fires mutation, "Saved ✓" affirmation for 700ms.
- `WorkoutDetailPresenter` — Edit IconBtn hidden for non-owners, Start CTA wires `onStartSession`, superset bracket renders for grouped exercises.

### New component tests

- `WorkoutRow` — props → render, `onPress` + `onStart` separate; tone derivation from `workout.tags[0]`.
- `FilterChip` — active/inactive visuals.
- `ExerciseCard` — tone derivation from primary muscle + level → pill tone mapping.
- `ExerciseFormFields` — shared form component used by both sheet + editor; all field interactions covered.

### Integration tests

- `TrainHubContainer` with `InMemoryApiAdapter` seeded with workouts + exercises; toggle segment; tap Create Workout → assert navigation; tap +Create on Exercises → assert sheet opens; submit sheet → assert mutation + cache update.
- Offline submit: in-memory adapter throws; assert mutation queued + UI optimistic + sync engine retries on reconnect.

### Visual regression

- Side-by-side screenshots: `<WorkoutsListPresenter>` vs `library.jsx`, `<ExerciseListPresenter>` vs same, `<CreateExerciseSheetPresenter>` vs `create-exercise.jsx`.

### Coverage

90% lines/branches/functions/statements.

---

## Risks + mitigations

| Risk                                                                                  | Mitigation                                                                                                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Removing `(app)/exercises/create.tsx` breaks deep links                               | Add redirect in `14-navigation` STORY-007 deep-link map: `/exercises/create` → open Train > Exercises + open CreateExerciseSheet.             |
| Form state in the sheet is large; sheet might lag                                     | Use `react-hook-form` per `_agent.md` § Forms recommendation. Per-field re-renders only.                                                      |
| BottomSheet 88% height + keyboard + many fields cause layout issues on small screens  | Validate during sheet PR. Sheet content uses `ScrollView keyboardShouldPersistTaps="handled"`. Same pattern as M9 fuel sheets.                |
| Migration of full-screen create to sheet might confuse users                          | "Saved ✓" affirmation gives strong feedback. The `+Create` placement in Train > Exercises header is more discoverable than V2's old location. |
| Tone derivation from primary muscle is arbitrary                                      | Mapping table committed in `design.md § <ExerciseCard>`. If owner feedback differs, revise via "**Revised YYYY-MM-DD:**".                     |
| Some sub-routes under `(app)/workouts/[id]/edit.tsx` could conflict with new patterns | Validated against existing V2 file tree — no conflicts.                                                                                       |

---

_End of `04-workout-management/design.md` · 2026-05-27 (rewritten from scratch)_
