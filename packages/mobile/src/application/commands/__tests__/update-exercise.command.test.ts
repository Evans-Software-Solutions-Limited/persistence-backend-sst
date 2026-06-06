import { updateExerciseCommand } from "../update-exercise.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { CreateExerciseInput, Exercise } from "@/domain/models/exercise";

const existing: Exercise = {
  id: "ex-1",
  name: "Bench Press",
  description: null,
  instructions: "Old cue",
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: ["triceps"],
  equipment: ["barbell"],
  primaryMuscleGroupLabels: ["Chest"],
  secondaryMuscleGroupLabels: ["Triceps"],
  equipmentLabels: ["Barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: true,
  createdBy: "user-42",
};

const editedInput: CreateExerciseInput = {
  name: "Incline Bench Press",
  instructions: "New cue",
  category: "strength",
  difficulty: "advanced",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: ["shoulders", "triceps"],
  equipment: ["dumbbell"],
};

describe("updateExerciseCommand", () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
  });

  it("returns a validation error and touches nothing when input is invalid", () => {
    const result = updateExerciseCommand({ storage }, existing, {
      ...editedInput,
      name: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.fields.name).toBeDefined();
    }
    expect(storage.getCachedExercise("ex-1")).toBeNull();
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("optimistically upserts the edit into the cache, preserving identity fields", () => {
    const result = updateExerciseCommand({ storage }, existing, editedInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("ex-1");
    expect(result.value.isCustom).toBe(true);
    expect(result.value.createdBy).toBe("user-42");
    expect(result.value.name).toBe("Incline Bench Press");
    expect(result.value.difficulty).toBe("advanced");
    expect(result.value.equipment).toEqual(["dumbbell"]);

    const cached = storage.getCachedExercise("ex-1");
    expect(cached?.name).toBe("Incline Bench Press");
    expect(cached?.secondaryMuscleGroups).toEqual(["shoulders", "triceps"]);
  });

  it("enqueues a PATCH /exercises/:id when no mutation is pending (already-synced exercise)", () => {
    updateExerciseCommand({ storage }, existing, editedInput);

    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].entityType).toBe("exercise");
    expect(pending[0].entityId).toBe("ex-1");
    expect(pending[0].operation).toBe("update");
    expect(pending[0].endpoint).toBe("/exercises/ex-1");
    expect(pending[0].method).toBe("PATCH");
    expect(JSON.parse(pending[0].payload)).toMatchObject({
      name: "Incline Bench Press",
      difficulty_level: "advanced",
      equipment_required: ["dumbbell"],
    });
  });

  it("coalesces onto a still-pending CREATE: rewrites its payload, stays a POST, no second entry", () => {
    const local: Exercise = { ...existing, id: "local-xyz" };
    // Simulate the create command having queued the original POST.
    storage.enqueueMutation({
      entityType: "exercise",
      entityId: "local-xyz",
      operation: "create",
      payload: { name: "Bench Press" },
      endpoint: "/exercises",
      method: "POST",
    });

    updateExerciseCommand({ storage }, local, editedInput);

    const pending = storage.getPendingMutations();
    // Single entry — the edit folded into the queued create.
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("create");
    expect(pending[0].method).toBe("POST");
    expect(pending[0].endpoint).toBe("/exercises");
    // ...but its body now carries the edited values, so the POST that
    // eventually flushes creates the exercise in its final edited state.
    expect(JSON.parse(pending[0].payload)).toMatchObject({
      name: "Incline Bench Press",
    });
  });

  it("coalesces rapid re-edits onto a single pending PATCH", () => {
    updateExerciseCommand({ storage }, existing, editedInput);
    updateExerciseCommand({ storage }, existing, {
      ...editedInput,
      name: "Re-edited Name",
    });

    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].method).toBe("PATCH");
    expect(JSON.parse(pending[0].payload).name).toBe("Re-edited Name");
  });

  it("trims and includes description / video / thumbnail when present", () => {
    const result = updateExerciseCommand({ storage }, existing, {
      ...editedInput,
      description: "  big lift  ",
      videoUrl: "  https://v/clip.mp4 ",
      thumbnailUrl: "  https://i/thumb.png ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBe("big lift");
    expect(result.value.videoUrl).toBe("https://v/clip.mp4");
    expect(result.value.thumbnailUrl).toBe("https://i/thumb.png");

    const [pending] = storage.getPendingMutations();
    const payload = JSON.parse(pending.payload);
    expect(payload.description).toBe("big lift");
    expect(payload.video_url).toBe("https://v/clip.mp4");
    expect(payload.thumbnail_url).toBe("https://i/thumb.png");
  });

  it("defaults missing secondary muscles to [] and missing instructions to ''", () => {
    const {
      secondaryMuscleGroups: _s,
      instructions: _i,
      ...rest
    } = editedInput;
    const result = updateExerciseCommand({ storage }, existing, rest);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.secondaryMuscleGroups).toEqual([]);
    expect(result.value.instructions).toBeNull();

    const [pending] = storage.getPendingMutations();
    const payload = JSON.parse(pending.payload);
    expect(payload.secondary_muscles).toEqual([]);
    expect(payload.instructions).toBe("");
  });

  it("preserves cached description/videoUrl/thumbnailUrl the edit never touched", () => {
    // A synced exercise that already carries media + a description.
    const withMedia: Exercise = {
      ...existing,
      description: "A solid compound lift",
      videoUrl: "https://v/keep.mp4",
      thumbnailUrl: "https://i/keep.png",
    };
    // `editedInput` omits description + videoUrl + thumbnailUrl entirely —
    // exactly what the editor form emits (it exposes none of the three for an
    // untouched edit). The command must NOT wipe them from the cache.
    const result = updateExerciseCommand({ storage }, withMedia, editedInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBe("A solid compound lift");
    expect(result.value.videoUrl).toBe("https://v/keep.mp4");
    expect(result.value.thumbnailUrl).toBe("https://i/keep.png");

    const cached = storage.getCachedExercise("ex-1");
    expect(cached?.description).toBe("A solid compound lift");
    expect(cached?.videoUrl).toBe("https://v/keep.mp4");
    expect(cached?.thumbnailUrl).toBe("https://i/keep.png");

    // The PATCH omits the untouched keys, so cache and server stay in sync
    // (no drift that a later refresh would have to silently reconcile).
    const [pending] = storage.getPendingMutations();
    const payload = JSON.parse(pending.payload);
    expect(payload.description).toBeUndefined();
    expect(payload.video_url).toBeUndefined();
    expect(payload.thumbnail_url).toBeUndefined();
  });

  it("sends cleared optional text as explicit empty string so a PATCH can clear it", () => {
    const result = updateExerciseCommand({ storage }, existing, {
      ...editedInput,
      instructions: "   ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instructions).toBeNull();

    const [pending] = storage.getPendingMutations();
    // "" is present on the wire (not omitted) → server clears the field.
    expect(JSON.parse(pending.payload).instructions).toBe("");
  });
});
