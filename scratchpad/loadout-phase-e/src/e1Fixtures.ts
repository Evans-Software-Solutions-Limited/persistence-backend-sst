/**
 * Phase E · T-E1.1/T-E1.3 — E1 ground truth.
 *
 * ⚠ **This is a 7-photo set, not the ~30 T-E1.1 asks for, and 6 of the 7 are
 * stock/web images.** Brad supplied it 2026-07-26 with "this can do for now".
 * Stock gym photography is easy mode — staged, wide, evenly lit, nothing
 * occluded — which is the opposite of what E1 exists to measure. Treat every
 * number this produces as a CEILING, not a real-world rate. `photo01` is the
 * only genuine phone photo and is scored separately for that reason.
 *
 * Ground truth is Claude's own labelling from viewing each photo, written
 * BEFORE any model ran (so the grading could not drift to fit the result) and
 * committed here so it is auditable. It is not Brad-confirmed — a second
 * labeller would strengthen it.
 *
 * Three buckets per photo, because a binary present/absent list would
 * mis-grade this domain:
 *
 * - `present` — unambiguously visible AND a row in `equipment_types`. Detecting
 *   it is a hit, missing it is a miss.
 *   `ambiguous` — a reasonable person could argue either way (a dark weight
 *   stack behind a rack, a bar whose type is unclear). Detections here score as
 *   NEITHER hit nor false positive; they are excluded, so the model is not
 *   punished for a judgement call the labeller could not make confidently.
 * - `traps` — things that LOOK like a catalogue row but are not one here. A
 *   road bike is not an `Exercise Bike`; interlocking rubber floor tiles are not
 *   a `Yoga Mat`. Detecting one is a false positive, and the interesting kind.
 * - `notInCatalogue` — real equipment with no `equipment_types` row (stability
 *   ball, punch bag, strongman log). Correct behaviour per design § 8 is
 *   `equipmentTypeId: null` with a `label`, NOT a forced match to a catalogue
 *   row. Forcing one is a false positive.
 *
 * Photos live outside the repo (T-E1.1) — see `E1_PHOTO_DIR`.
 */

export type E1Photo = {
  file: string;
  /** Where this photo came from, and therefore how much weight its result carries. */
  provenance: "real-phone-photo" | "stock";
  context: string;
  present: string[];
  ambiguous: string[];
  traps: string[];
  notInCatalogue: string[];
};

export const E1_PHOTOS: E1Photo[] = [
  {
    file: "photo01.jpg",
    provenance: "real-phone-photo",
    context:
      "Home garage gym, phone photo, angled, cluttered, partially occluded",
    present: [
      "Squat Rack",
      "Barbell",
      "Bench",
      "Dumbbells",
      "Pull-up Bar",
      "Box / Step",
    ],
    // A dark tower with a weight stack sits behind the rack — plausibly a cable
    // station or lat tower, unreadable in shadow. A white cylinder on the wall
    // may be a foam roller.
    ambiguous: [
      "Cable Machine",
      "Lat Pulldown Machine",
      "Foam Roller",
      "Smith Machine",
    ],
    // A road/mountain bike in the foreground is NOT an exercise bike; the floor
    // is interlocking rubber tiles, not a yoga mat.
    traps: ["Exercise Bike", "Yoga Mat", "Treadmill", "Rowing Machine"],
    notInCatalogue: ["stability / swiss ball"],
  },
  {
    file: "photo02.jpg",
    provenance: "stock",
    context:
      "Staged (likely AI-generated) home gym, bifold doors, perfect lighting",
    present: [
      "Squat Rack",
      "Barbell",
      "Dumbbells",
      "Bench",
      "Kettlebell",
      "Yoga Mat",
    ],
    ambiguous: ["Medicine Ball"],
    traps: ["Treadmill", "Cable Machine", "Exercise Bike"],
    notInCatalogue: ["stability / swiss ball", "sandbag"],
  },
  {
    file: "photo03.jpg",
    provenance: "stock",
    context: "Home multi-gym room, ceiling fan, blinds",
    present: [
      "Bench",
      "Dumbbells",
      "Cable Machine",
      "Lat Pulldown Machine",
      "Medicine Ball",
    ],
    // The multi-gym has a leg attachment that could be read as either leg
    // machine; wall straps could be bands or a suspension trainer.
    ambiguous: [
      "Leg Extension Machine",
      "Leg Curl Machine",
      "Resistance Bands",
      "TRX / Suspension Trainer",
      "Smith Machine",
    ],
    traps: ["Treadmill", "Squat Rack", "Rowing Machine"],
    notInCatalogue: ["punching bag"],
  },
  {
    file: "photo04.jpg",
    provenance: "stock",
    context:
      "Garage, functional trainer / rack with cable columns, bumper plates",
    present: ["Squat Rack", "Barbell", "Bench"],
    ambiguous: ["Cable Machine", "Smith Machine", "Lat Pulldown Machine"],
    traps: ["Yoga Mat", "Dumbbells", "Kettlebell", "Treadmill"],
    notInCatalogue: [],
  },
  {
    file: "photo05.jpg",
    provenance: "stock",
    context: "Brick garage gym, wall-mounted folding rack",
    present: ["Dumbbells", "Kettlebell", "Bench", "Squat Rack"],
    // A bar hangs on the right wall — camber/safety-squat/EZ, not resolvable.
    ambiguous: ["Barbell", "EZ Bar", "Medicine Ball", "Pull-up Bar"],
    traps: ["Yoga Mat", "Treadmill", "Cable Machine"],
    notInCatalogue: ["strongman log / sandbag"],
  },
  {
    file: "photo06.jpg",
    provenance: "stock",
    context: "Hotel-style gym, sea view, plate-loaded machine + benches",
    present: ["Dumbbells", "Bench"],
    ambiguous: ["Leg Press Machine", "Barbell", "Smith Machine"],
    traps: ["Treadmill", "Exercise Bike", "Cable Machine", "Yoga Mat"],
    notInCatalogue: [],
  },
  {
    file: "photo07.jpg",
    provenance: "stock",
    context:
      "Hotel / home cardio room, treadmill + cross-trainer + dumbbell rack",
    present: ["Treadmill", "Elliptical", "Dumbbells"],
    ambiguous: ["Exercise Bike", "Bench", "Box / Step"],
    traps: ["Barbell", "Squat Rack", "Cable Machine", "Rowing Machine"],
    notInCatalogue: ["wall-mounted TV"],
  },
];
