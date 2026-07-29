import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { resolveExercisePayloadReferences } from "@/application/commands/resolveExerciseReferences";

const CHEST = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ABS = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const DUMBBELLS = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const MACHINE = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";

function storageWithCatalogue(): InMemoryStorageAdapter {
  const storage = new InMemoryStorageAdapter();
  storage.cacheReferenceList("muscle_groups", [
    { id: CHEST, name: "Chest", displayName: null },
    { id: ABS, name: "Abs", displayName: null },
  ]);
  storage.cacheReferenceList("equipment", [
    { id: DUMBBELLS, name: "Dumbbells", displayName: null },
    { id: MACHINE, name: "Machine", displayName: null },
  ]);
  return storage;
}

describe("resolveExercisePayloadReferences", () => {
  it("rewrites enum members to catalogue uuids", () => {
    const storage = storageWithCatalogue();
    const result = resolveExercisePayloadReferences(storage, {
      name: "My press",
      primary_muscles: ["chest"],
      equipment_required: ["dumbbell"],
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.payload.primary_muscles).toEqual([CHEST]);
    expect(result.payload.equipment_required).toEqual([DUMBBELLS]);
    // Untouched fields survive.
    expect(result.payload.name).toBe("My press");
  });

  it("maps core → Abs and machine → the generic row", () => {
    const storage = storageWithCatalogue();
    const result = resolveExercisePayloadReferences(storage, {
      primary_muscles: ["core"],
      equipment_required: ["machine"],
    });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.payload.primary_muscles).toEqual([ABS]);
    expect(result.payload.equipment_required).toEqual([MACHINE]);
  });

  it("is idempotent over an already-resolved payload", () => {
    const storage = storageWithCatalogue();
    const result = resolveExercisePayloadReferences(storage, {
      primary_muscles: [CHEST],
      equipment_required: [DUMBBELLS],
    });
    expect(result.status).toBe("unchanged");
  });

  it("needs no catalogue for a payload with no reference fields", () => {
    // A PATCH of just the name must never be deferred waiting on a catalogue.
    const empty = new InMemoryStorageAdapter();
    const result = resolveExercisePayloadReferences(empty, {
      name: "Renamed",
      instructions: "Do the thing",
    });
    expect(result.status).toBe("unchanged");
  });

  it("needs no catalogue for empty reference arrays", () => {
    const empty = new InMemoryStorageAdapter();
    const result = resolveExercisePayloadReferences(empty, {
      primary_muscles: [],
      equipment_required: [],
    });
    expect(result.status).toBe("unchanged");
  });

  it("defers when the catalogue is not cached, naming the kinds it needs", () => {
    const empty = new InMemoryStorageAdapter();
    const result = resolveExercisePayloadReferences(empty, {
      primary_muscles: ["chest"],
      equipment_required: ["dumbbell"],
    });
    expect(result.status).toBe("catalogue_unavailable");
    if (result.status !== "catalogue_unavailable") return;
    expect(result.kinds).toEqual(["muscle_groups", "equipment"]);
  });

  it("only requires the catalogue kinds the payload actually uses", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheReferenceList("equipment", [
      { id: DUMBBELLS, name: "Dumbbells", displayName: null },
    ]);
    const result = resolveExercisePayloadReferences(storage, {
      equipment_required: ["dumbbell"],
    });
    expect(result.status).toBe("resolved");
  });

  it("reports unresolvable members instead of sending a shortened array", () => {
    // The critical behaviour: a partial send would create the exercise with its
    // equipment quietly missing and nothing would ever say so.
    const storage = new InMemoryStorageAdapter();
    storage.cacheReferenceList("equipment", [
      { id: DUMBBELLS, name: "Dumbbells", displayName: null },
    ]);
    const result = resolveExercisePayloadReferences(storage, {
      equipment_required: ["dumbbell", "machine"],
    });
    expect(result.status).toBe("unresolvable");
    if (result.status !== "unresolvable") return;
    expect(result.unresolved).toEqual(["machine"]);
  });

  it("resolves secondary_muscles too", () => {
    const storage = storageWithCatalogue();
    const result = resolveExercisePayloadReferences(storage, {
      primary_muscles: ["chest"],
      secondary_muscles: ["core"],
    });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.payload.secondary_muscles).toEqual([ABS]);
  });

  it("does not mutate the payload it was given", () => {
    const storage = storageWithCatalogue();
    const payload = { primary_muscles: ["chest"] };
    resolveExercisePayloadReferences(storage, payload);
    expect(payload.primary_muscles).toEqual(["chest"]);
  });
});
