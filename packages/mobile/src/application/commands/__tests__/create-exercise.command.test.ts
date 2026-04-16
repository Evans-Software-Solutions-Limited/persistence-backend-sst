import { createExerciseCommand } from "../create-exercise.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { CreateExerciseInput } from "@/domain/models/exercise";

const validInput: CreateExerciseInput = {
  name: "Pistol Squat",
  description: "A unilateral squat",
  instructions: "Squat on one leg while holding the other out",
  category: "strength",
  difficulty: "advanced",
  primaryMuscleGroups: ["quadriceps"],
  secondaryMuscleGroups: ["glutes"],
  equipment: ["bodyweight"],
};

describe("createExerciseCommand", () => {
  let storage: InMemoryStorageAdapter;
  let generateId: jest.Mock<string>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    generateId = jest.fn().mockReturnValue("abc123");
  });

  it("returns a validation error when input is invalid", () => {
    const result = createExerciseCommand(
      { storage, generateId, userId: "u1" },
      { ...validInput, name: "" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.fields.name).toBeDefined();
    }
    // No side effects on validation failure
    expect(storage.getCachedExercises()).toHaveLength(0);
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(generateId).not.toHaveBeenCalled();
  });

  it("saves the exercise to local cache with isCustom=true on success", () => {
    const result = createExerciseCommand(
      { storage, generateId, userId: "user-42" },
      validInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe("local-abc123");
    expect(result.value.isCustom).toBe(true);
    expect(result.value.createdBy).toBe("user-42");

    const cached = storage.getCachedExercise("local-abc123");
    expect(cached).not.toBeNull();
    expect(cached?.name).toBe("Pistol Squat");
    expect(cached?.isCustom).toBe(true);
  });

  it("enqueues an API sync mutation with the original input payload", () => {
    createExerciseCommand({ storage, generateId, userId: "u1" }, validInput);

    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].entityType).toBe("exercise");
    expect(pending[0].entityId).toBe("local-abc123");
    expect(pending[0].operation).toBe("create");
    expect(pending[0].endpoint).toBe("/exercises");
    expect(pending[0].method).toBe("POST");
    expect(JSON.parse(pending[0].payload)).toMatchObject({
      name: validInput.name,
      category: validInput.category,
    });
  });

  it("trims name and empties optional text fields when blank", () => {
    const result = createExerciseCommand(
      { storage, generateId, userId: "u1" },
      {
        ...validInput,
        name: "  Clean Name  ",
        description: "   ",
        instructions: "",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Clean Name");
    expect(result.value.description).toBeNull();
    expect(result.value.instructions).toBeNull();
  });

  it("defaults secondaryMuscleGroups to an empty array when omitted", () => {
    const { secondaryMuscleGroups: _sec, ...rest } = validInput;
    const result = createExerciseCommand(
      { storage, generateId, userId: "u1" },
      rest,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.secondaryMuscleGroups).toEqual([]);
  });
});
