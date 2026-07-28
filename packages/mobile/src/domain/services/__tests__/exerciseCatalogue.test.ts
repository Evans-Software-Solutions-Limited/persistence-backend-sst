import {
  EQUIPMENT_CATALOGUE_NAME,
  MUSCLE_GROUP_CATALOGUE_NAME,
  looksLikeUuidArray,
  resolveEquipmentIds,
  resolveMuscleGroupIds,
} from "@/domain/services/exerciseCatalogue";
import {
  EQUIPMENT_TYPES,
  MUSCLE_GROUPS,
  type EquipmentType,
} from "@/domain/models/exercise";
import type { ReferenceEntry } from "@/domain/models/reference-list";

/**
 * The real seeded catalogue names, transcribed from
 * `packages/seed/data/reference.json` (+ the generic `Machine` added by
 * 20260727120000). Using the ACTUAL names is the point of these tests: a
 * hand-invented catalogue would let a wrong mapping pass, which is the
 * "test that cannot fail" trap.
 */
const MUSCLE_CATALOGUE_NAMES = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Forearms",
  "Abs",
  "Obliques",
  "Lower Back",
  "Quadriceps",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Hip Flexors",
  "Traps",
  "Lats",
  "Full Body",
];

const EQUIPMENT_CATALOGUE_NAMES = [
  "Barbell",
  "Dumbbells",
  "Kettlebell",
  "Resistance Bands",
  "Pull-up Bar",
  "Bench",
  "Cable Machine",
  "Machine",
  "Smith Machine",
  "Squat Rack",
  "Leg Press Machine",
  "Leg Curl Machine",
  "Leg Extension Machine",
  "Lat Pulldown Machine",
  "Rowing Machine",
  "Treadmill",
  "Exercise Bike",
  "Elliptical",
  "Medicine Ball",
  "Foam Roller",
  "Yoga Mat",
  "Box / Step",
  "TRX / Suspension Trainer",
  "EZ Bar",
  "Dip Station",
  "Bodyweight",
  "Battle Ropes",
  "Sled",
  "Ab Wheel",
];

function catalogue(names: readonly string[]): ReferenceEntry[] {
  return names.map((name, i) => ({
    // Deterministic, well-formed v4-shaped uuids.
    id: `0000000${(i + 1).toString(16).padStart(1, "0")}-0000-4000-8000-000000000000`.replace(
      /^0{7}/,
      "0000000",
    ),
    name,
    displayName: null,
  }));
}

const MUSCLES = catalogue(MUSCLE_CATALOGUE_NAMES);
const EQUIPMENT = catalogue(EQUIPMENT_CATALOGUE_NAMES);

function idOf(entries: ReferenceEntry[], name: string): string {
  const found = entries.find((e) => e.name === name);
  if (!found) throw new Error(`test catalogue is missing ${name}`);
  return found.id;
}

describe("catalogue name maps", () => {
  it("covers every muscle-group enum member", () => {
    for (const group of MUSCLE_GROUPS) {
      expect(MUSCLE_GROUP_CATALOGUE_NAME).toHaveProperty(group);
    }
  });

  it("covers every equipment enum member with a non-null name", () => {
    for (const equipment of EQUIPMENT_TYPES) {
      expect(EQUIPMENT_CATALOGUE_NAME[equipment]).toBeTruthy();
    }
  });

  it("maps every equipment member onto a name that actually exists in the catalogue", () => {
    // This is the test that would have caught the shipped bug: `dumbbell` →
    // "Dumbbell" (singular) is absent from the catalogue, as is `resistance_band`
    // → "Resistance Band".
    for (const equipment of EQUIPMENT_TYPES) {
      expect(EQUIPMENT_CATALOGUE_NAMES).toContain(
        EQUIPMENT_CATALOGUE_NAME[equipment],
      );
    }
  });

  it("maps every non-null muscle member onto a name that exists in the catalogue", () => {
    for (const group of MUSCLE_GROUPS) {
      const name = MUSCLE_GROUP_CATALOGUE_NAME[group];
      if (name === null) continue;
      expect(MUSCLE_CATALOGUE_NAMES).toContain(name);
    }
  });

  it("does not include the removed `other` equipment member", () => {
    expect(EQUIPMENT_TYPES as readonly string[]).not.toContain("other");
  });

  it("pins the four members a naive normalise-and-match resolver gets wrong", () => {
    // Regression pins, each one a value that `name.toLowerCase().replace(" ","_")`
    // would fail to find.
    expect(EQUIPMENT_CATALOGUE_NAME.dumbbell).toBe("Dumbbells");
    expect(EQUIPMENT_CATALOGUE_NAME.resistance_band).toBe("Resistance Bands");
    expect(EQUIPMENT_CATALOGUE_NAME.cable).toBe("Cable Machine");
    expect(MUSCLE_GROUP_CATALOGUE_NAME.core).toBe("Abs");
  });
});

describe("resolveMuscleGroupIds", () => {
  it("resolves the enum keys the form actually emits", () => {
    const result = resolveMuscleGroupIds(MUSCLES, ["chest"]);
    expect(result.unresolved).toEqual([]);
    expect(result.ids).toEqual([idOf(MUSCLES, "Chest")]);
  });

  it("resolves `core` to Abs", () => {
    const result = resolveMuscleGroupIds(MUSCLES, ["core"]);
    expect(result.unresolved).toEqual([]);
    expect(result.ids).toEqual([idOf(MUSCLES, "Abs")]);
  });

  it("expands a multi-group label without duplicating ids", () => {
    // The "Back" picker label expands to back + lats; "Legs" to four groups.
    const result = resolveMuscleGroupIds(MUSCLES, [
      "back",
      "lats",
      "back", // a duplicate, e.g. primary + secondary overlap
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.ids).toEqual([idOf(MUSCLES, "Back"), idOf(MUSCLES, "Lats")]);
  });

  it("reports an unmapped member instead of dropping it", () => {
    const result = resolveMuscleGroupIds(MUSCLES, ["chest", "abductors"]);
    expect(result.unresolved).toEqual(["abductors"]);
    // The resolved id is still returned, but the caller must not send a
    // partial array — that decision belongs to resolveExercisePayloadReferences.
    expect(result.ids).toEqual([idOf(MUSCLES, "Chest")]);
  });

  it("reports a member whose mapped name is absent from THIS catalogue", () => {
    // Simulates a catalogue that has drifted (row renamed / not yet seeded).
    const withoutChest = MUSCLES.filter((e) => e.name !== "Chest");
    const result = resolveMuscleGroupIds(withoutChest, ["chest"]);
    expect(result.ids).toEqual([]);
    expect(result.unresolved).toEqual(["chest"]);
  });

  it("matches case-insensitively", () => {
    const lowered = MUSCLES.map((e) => ({ ...e, name: e.name.toLowerCase() }));
    const result = resolveMuscleGroupIds(lowered, ["quadriceps"]);
    expect(result.unresolved).toEqual([]);
    expect(result.ids).toHaveLength(1);
  });

  it("ignores catalogue rows with a blank id or name", () => {
    const dirty: ReferenceEntry[] = [
      { id: "", name: "Chest", displayName: null },
      ...MUSCLES,
    ];
    const result = resolveMuscleGroupIds(dirty, ["chest"]);
    expect(result.ids).toEqual([idOf(MUSCLES, "Chest")]);
  });
});

describe("resolveEquipmentIds", () => {
  it("resolves every member the picker can produce", () => {
    const pickerMembers: EquipmentType[] = [
      "barbell",
      "dumbbell",
      "machine",
      "cable",
      "bodyweight",
      "kettlebell",
      "resistance_band",
    ];
    const result = resolveEquipmentIds(EQUIPMENT, pickerMembers);
    expect(result.unresolved).toEqual([]);
    expect(result.ids).toHaveLength(pickerMembers.length);
  });

  it("resolves `machine` to the generic catalogue row, not a specific machine", () => {
    const result = resolveEquipmentIds(EQUIPMENT, ["machine"]);
    expect(result.ids).toEqual([idOf(EQUIPMENT, "Machine")]);
    expect(result.ids).not.toEqual([idOf(EQUIPMENT, "Smith Machine")]);
  });

  it("reports `machine` as unresolved when the generic row is missing", () => {
    // i.e. before the migration runs. Better a loud deferral than an exercise
    // silently created with no equipment.
    const preMigration = EQUIPMENT.filter((e) => e.name !== "Machine");
    const result = resolveEquipmentIds(preMigration, ["machine"]);
    expect(result.ids).toEqual([]);
    expect(result.unresolved).toEqual(["machine"]);
  });
});

describe("looksLikeUuidArray", () => {
  it("is false for enum keys", () => {
    expect(looksLikeUuidArray(["chest", "barbell"])).toBe(false);
  });

  it("is true for a fully-uuid array", () => {
    expect(
      looksLikeUuidArray([
        "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
      ]),
    ).toBe(true);
  });

  it("is false for a MIXED array so a partial rewrite is re-resolved, not skipped", () => {
    expect(
      looksLikeUuidArray(["3f2504e0-4f89-41d3-9a0c-0305e82c3301", "chest"]),
    ).toBe(false);
  });

  it("is false for an empty array", () => {
    // An empty array needs no resolution and no catalogue; treating it as
    // "already uuids" would be equally correct, but false keeps the caller's
    // length check as the single place that decides.
    expect(looksLikeUuidArray([])).toBe(false);
  });
});
