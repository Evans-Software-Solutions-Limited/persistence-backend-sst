import type { EquipmentType, MuscleGroup } from "@/domain/models/exercise";
import type { ReferenceEntry } from "@/domain/models/reference-list";

/**
 * Translation between the mobile domain enums and the backend reference
 * catalogue's row NAMES.
 *
 * Why this file exists: `POST`/`PATCH /exercises` validate `primary_muscles`,
 * `secondary_muscles` and `equipment_required` as arrays of **UUIDs**, but the
 * create/edit form produces domain enum keys (`"chest"`, `"barbell"`) and the
 * adapter passed them straight through. Every custom-exercise save therefore
 * returned HTTP 422 — deterministically, since the form always emits at least
 * one muscle group and exactly one equipment type, and local validation
 * *requires* both to be non-empty.
 *
 * `reference-list.ts` still claims `name` "equals the mobile enum string where
 * one exists". Against the seeded catalogue that is false, which is precisely
 * how the drift went unnoticed: the actual rows are `Chest`, `Dumbbells`,
 * `Resistance Bands`.
 *
 * ⚠ A normalise-and-match resolver (lowercase, spaces → underscores) is NOT
 * sufficient and must not be reintroduced. It silently drops `dumbbell`
 * (catalogue: plural `Dumbbells`), `resistance_band` (`Resistance Bands`) and
 * `core` (there is no `Core` row — abdominals are `Abs`). Silent dropping is the
 * T-E.10 failure mode: `seedExercises.ts`'s `resolve()` dropped unmapped names
 * without a word, which is how `Leg Press` shipped with
 * `equipment_required = '{}'` and stayed selectable for a bands-only athlete.
 *
 * Catalogue source of truth: `packages/seed/data/reference.json`
 * (17 muscle groups, 28 equipment types + the generic `Machine` added by
 * `20260727120000_equipment_types_generic_machine.sql`). Verify a change here
 * against that file, not against intuition.
 */

/**
 * Muscle-group enum → catalogue row name.
 *
 * `null` means "no catalogue row exists for this enum member". Both nulls are
 * currently UNREACHABLE from the UI: `MUSCLE_LABEL_TO_GROUPS` in
 * `ExerciseFormFields/exerciseForm.ts` never emits them, because the coarse
 * six-label picker has no Adductors/Abductors option. They are kept (rather
 * than deleted from the enum) because they are real muscle groups that a finer
 * picker would want, and an explicit `null` records the decision where a missing
 * key would just look like an oversight.
 *
 * Being a total `Record` is the point: adding a member to `MUSCLE_GROUPS`
 * without deciding its catalogue name is a compile error, not a silent drop.
 */
export const MUSCLE_GROUP_CATALOGUE_NAME: Record<MuscleGroup, string | null> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  quadriceps: "Quadriceps",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  // NOT "Core" — the catalogue has no such row. Abdominals are `Abs`, and
  // `Core` is a selectable label in the form, so this line is the difference
  // between a working save and a 422 for every core exercise.
  core: "Abs",
  forearms: "Forearms",
  traps: "Traps",
  lats: "Lats",
  hip_flexors: "Hip Flexors",
  // No catalogue row; unreachable from the current picker.
  abductors: null,
  adductors: null,
};

/**
 * Equipment enum → catalogue row name. Total and non-nullable: every member
 * resolves.
 *
 * `machine` maps to a generic `Machine` row added by
 * `20260727120000_equipment_types_generic_machine.sql`. The catalogue previously
 * held only SPECIFIC machines (`Smith Machine`, `Leg Press Machine`, …), so the
 * form's `Machine` option — one of only seven, and a common choice — had nothing
 * to map to. (Brad's call, 2026-07-27: add the generic row rather than force the
 * user to pick a specific machine.)
 *
 * `smith_machine` and `ez_bar` are also unreachable from the current coarse
 * picker, but unlike the muscle nulls they DO have catalogue rows, so mapping
 * them costs nothing and a finer picker would work immediately.
 *
 * The former `other` member was REMOVED from `EQUIPMENT_TYPES` rather than
 * mapped: it had no catalogue row, and `EQUIPMENT_OPTIONS` never offered it, so
 * mapping it would have been a branch no user could reach.
 */
export const EQUIPMENT_CATALOGUE_NAME: Record<EquipmentType, string> = {
  barbell: "Barbell",
  // Plural in the catalogue.
  dumbbell: "Dumbbells",
  machine: "Machine",
  cable: "Cable Machine",
  bodyweight: "Bodyweight",
  kettlebell: "Kettlebell",
  // Plural in the catalogue.
  resistance_band: "Resistance Bands",
  smith_machine: "Smith Machine",
  ez_bar: "EZ Bar",
};

export type ReferenceResolution = {
  /** Catalogue UUIDs, in the order the input enums were given. */
  ids: string[];
  /**
   * Enum members that could not be resolved — either no catalogue name is
   * mapped for them, or the catalogue has no row with that name. Callers MUST
   * treat a non-empty value as a failure to act on, never as an empty filter.
   */
  unresolved: string[];
};

/**
 * Build a case-insensitive name → id index over a reference list.
 *
 * Case-insensitive because the catalogue's casing is a display decision that
 * has changed before (`display_name` was added to muscle groups and not to
 * equipment), and a rename from `Dumbbells` to `dumbbells` should not silently
 * break every custom-exercise save. Exact-name matching remains the contract;
 * this only tolerates case.
 */
function indexByName(entries: readonly ReferenceEntry[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.id || !entry.name) continue;
    const key = entry.name.trim().toLowerCase();
    // First write wins: a duplicate name in the catalogue is a data problem, and
    // picking the first keeps resolution deterministic across calls.
    if (!index.has(key)) index.set(key, entry.id);
  }
  return index;
}

function resolveNames(
  entries: readonly ReferenceEntry[],
  members: readonly string[],
  catalogueNameFor: (member: string) => string | null | undefined,
): ReferenceResolution {
  const index = indexByName(entries);
  const ids: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const member of members) {
    const name = catalogueNameFor(member);
    if (!name) {
      unresolved.push(member);
      continue;
    }
    const id = index.get(name.trim().toLowerCase());
    if (!id) {
      unresolved.push(member);
      continue;
    }
    // De-duplicate: the coarse picker expands one label into several enum
    // members (Back → back + lats), and two labels can overlap, which would
    // otherwise send the same uuid twice.
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return { ids, unresolved };
}

/** Resolve muscle-group enum members to catalogue UUIDs. */
export function resolveMuscleGroupIds(
  entries: readonly ReferenceEntry[],
  groups: readonly string[],
): ReferenceResolution {
  return resolveNames(
    entries,
    groups,
    (member) => MUSCLE_GROUP_CATALOGUE_NAME[member as MuscleGroup] ?? null,
  );
}

/** Resolve equipment enum members to catalogue UUIDs. */
export function resolveEquipmentIds(
  entries: readonly ReferenceEntry[],
  equipment: readonly string[],
): ReferenceResolution {
  return resolveNames(
    entries,
    equipment,
    (member) => EQUIPMENT_CATALOGUE_NAME[member as EquipmentType] ?? null,
  );
}

/**
 * Is this array already catalogue UUIDs rather than domain enum keys?
 *
 * The drain must be idempotent over payloads: an entry queued by a build that
 * already resolved, or a payload re-read after a partial rewrite, must not be
 * "resolved" a second time (which would fail to match and look unresolvable).
 * A v4 UUID is unambiguously not an enum key, so shape is a safe discriminator.
 */
export function looksLikeUuidArray(values: readonly unknown[]): boolean {
  if (values.length === 0) return false;
  return values.every(
    (v) =>
      typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
}
