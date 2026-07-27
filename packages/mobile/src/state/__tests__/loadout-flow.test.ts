import { useLoadoutFlow } from "@/state/loadout-flow";
import type { LoadoutPreview } from "@/domain/models/loadout";

const preview: LoadoutPreview = {
  workoutId: "w-1",
  parentName: "Upper Body",
  savedGymId: "gym-1",
  equipmentTypeIds: ["eq-1"],
  rows: [],
  meta: {
    keptCount: 0,
    swappedCount: 0,
    unresolvedCount: 0,
    intensityMismatchCount: 0,
    candidateCount: 0,
    candidatePoolTruncated: false,
    modelId: null,
  },
};

const draft = {
  detected: [
    {
      equipmentTypeId: "eq-1",
      name: "Dumbbells",
      confidence: 0.9,
      source: "model" as const,
    },
  ],
  unmatched: [],
  notes: null,
  modelId: "m",
};

beforeEach(() => {
  useLoadoutFlow.getState().reset();
  useLoadoutFlow.setState({ rev: 0 });
});

const get = () => useLoadoutFlow.getState();

describe("useLoadoutFlow — opening and closing", () => {
  it("starts closed", () => {
    expect(get().step).toBeNull();
    expect(get().workoutId).toBeNull();
  });

  it("opens at the collect step with the parent workout", () => {
    get().open("w-1", "Upper Body");
    expect(get().step).toBe("collect");
    expect(get().workoutId).toBe("w-1");
    expect(get().workoutName).toBe("Upper Body");
  });

  it("clears a previous run's context, preview and manual picks on open", () => {
    // The bug this prevents is quiet and bad: adapting workout B while holding A's
    // picks would apply them BY sortOrder to a different plan.
    get().open("w-1", "Upper Body");
    get().useGym({ id: "gym-1", name: "Hotel gym" });
    get().previewResolved(preview);
    get().applyManualPick(0, { exerciseId: "ex-9", isUserOverride: true });
    get().setScanDraft(draft);

    get().open("w-2", "Lower Body");

    expect(get().workoutId).toBe("w-2");
    expect(get().context).toBeNull();
    expect(get().preview).toBeNull();
    expect(get().manualPicks.size).toBe(0);
    expect(get().scanDraft).toBeNull();
    expect(get().step).toBe("collect");
  });

  it("reset closes the flow entirely", () => {
    get().open("w-1", "Upper Body");
    get().reset();
    expect(get().step).toBeNull();
    expect(get().workoutId).toBeNull();
  });
});

describe("useLoadoutFlow — the upsell is a sheet, not a step", () => {
  it("opens and closes without touching the step", () => {
    // Modelling the paywall as a step would put it in the back history, and an
    // unentitled user has no flow to be in behind it.
    get().openUpsell();
    expect(get().upsellOpen).toBe(true);
    expect(get().step).toBeNull();

    get().closeUpsell();
    expect(get().upsellOpen).toBe(false);
  });

  it("is cleared by open, so a later entitled run never shows it", () => {
    get().openUpsell();
    get().open("w-1", "Upper Body");
    expect(get().upsellOpen).toBe(false);
  });
});

describe("useLoadoutFlow — the equipment context is exactly one source", () => {
  it("a saved gym sets the gym context and advances to adapting", () => {
    get().open("w-1", "Upper Body");
    get().useGym({ id: "gym-1", name: "Hotel gym" });

    expect(get().context).toEqual({
      kind: "gym",
      gymId: "gym-1",
      gymName: "Hotel gym",
    });
    expect(get().step).toBe("adapting");
  });

  it("manual ids set the ids context and advance to adapting", () => {
    get().open("w-1", "Upper Body");
    get().useEquipmentIds(["eq-1", "eq-2"], "Hotel gym", true);

    expect(get().context).toEqual({
      kind: "ids",
      equipmentTypeIds: ["eq-1", "eq-2"],
      label: "Hotel gym",
      saveAsGym: true,
    });
  });

  it("de-duplicates the id list", () => {
    // The server reports the context size back from `equipmentTypeIds.length`, so a
    // duplicate would make "6 items available" wrong on the review banner.
    get().open("w-1", "Upper Body");
    get().useEquipmentIds(["eq-1", "eq-1", "eq-2"], "Custom", false);

    expect(
      (get().context as { equipmentTypeIds: readonly string[] })
        .equipmentTypeIds,
    ).toEqual(["eq-1", "eq-2"]);
  });

  it("copies the caller's array rather than aliasing it", () => {
    get().open("w-1", "Upper Body");
    const ids = ["eq-1"];
    get().useEquipmentIds(ids, "Custom", false);
    ids.push("eq-mutated");

    expect(
      (get().context as { equipmentTypeIds: readonly string[] })
        .equipmentTypeIds,
    ).toEqual(["eq-1"]);
  });

  it("CLEARS the previous adaptation when a new kit is chosen mid-flow", () => {
    // `open()` does not fire on the re-collect path (review → back to collect →
    // pick a different gym), so without clearing here the old picks survive and
    // `buildVariationExercises` applies them BY sortOrder to the new plan — a pick
    // compatible with kit A may not be with kit B, and it carries
    // `isUserOverride: false`, so the save 400s.
    get().open("w-1", "Upper Body");
    get().useGym({ id: "gym-1", name: "Hotel gym" });
    get().previewResolved(preview);
    get().applyManualPick(0, { exerciseId: "ex-9", isUserOverride: false });

    get().useGym({ id: "gym-2", name: "Home garage" });

    expect(get().preview).toBeNull();
    expect(get().manualPicks.size).toBe(0);
    expect(get().swapTarget).toBeNull();
    expect(get().step).toBe("adapting");
  });

  it("CLEARS the previous adaptation on the manual-ids path too", () => {
    get().open("w-1", "Upper Body");
    get().useGym({ id: "gym-1", name: "Hotel gym" });
    get().previewResolved(preview);
    get().applyManualPick(0, { exerciseId: "ex-9", isUserOverride: true });

    get().useEquipmentIds(["eq-1"], "Custom", false);

    expect(get().preview).toBeNull();
    expect(get().manualPicks.size).toBe(0);
  });

  it("REPLACES a gym context when manual ids are chosen instead", () => {
    // Never both: the preview 400s EQUIPMENT_CONTEXT_REQUIRED if two sources
    // arrive, and the union makes that structurally impossible from here.
    get().open("w-1", "Upper Body");
    get().useGym({ id: "gym-1", name: "Hotel gym" });
    get().useEquipmentIds(["eq-1"], "Custom", false);

    expect(get().context?.kind).toBe("ids");
  });

  it("REPLACES an ids context when a gym is chosen instead", () => {
    get().open("w-1", "Upper Body");
    get().useEquipmentIds(["eq-1"], "Custom", false);
    get().useGym({ id: "gym-1", name: "Hotel gym" });

    expect(get().context?.kind).toBe("gym");
  });
});

describe("useLoadoutFlow — the scan draft", () => {
  it("stores a draft and starts with nothing deselected", () => {
    get().setScanDraft(draft);
    expect(get().scanDraft).toBe(draft);
    expect(get().scanDeselectedIds.size).toBe(0);
  });

  it("toggles a detection off and back on", () => {
    get().setScanDraft(draft);
    get().toggleScanDetection("eq-1");
    expect(get().scanDeselectedIds.has("eq-1")).toBe(true);

    get().toggleScanDetection("eq-1");
    expect(get().scanDeselectedIds.has("eq-1")).toBe(false);
  });

  it("clears deselections when a NEW draft arrives", () => {
    // Deselections are keyed to the previous photo's detections; carrying them
    // over would silently untick items in the new scan.
    get().setScanDraft(draft);
    get().toggleScanDetection("eq-1");
    get().setScanDraft({ ...draft, modelId: "m2" });

    expect(get().scanDeselectedIds.size).toBe(0);
  });

  it("REFUSES to deselect a server-INJECTED detection", () => {
    // `Bodyweight` is withheld from the model and injected precisely so the user is
    // not offered the chance to untick it (T-E1.7) — it is true of every room, and
    // unticking it would make every bodyweight exercise get swapped or dropped.
    const withInjected = {
      ...draft,
      detected: [
        {
          equipmentTypeId: "eq-bw",
          name: "Bodyweight",
          confidence: 1,
          source: "injected" as const,
        },
        ...draft.detected,
      ],
    };
    get().setScanDraft(withInjected);

    get().toggleScanDetection("eq-bw");
    expect(get().scanDeselectedIds.has("eq-bw")).toBe(false);

    // A model detection in the same draft is still deselectable.
    get().toggleScanDetection("eq-1");
    expect(get().scanDeselectedIds.has("eq-1")).toBe(true);
  });

  it("clears the draft on a null", () => {
    get().setScanDraft(draft);
    get().setScanDraft(null);
    expect(get().scanDraft).toBeNull();
  });
});

describe("useLoadoutFlow — adapting is bound to the request", () => {
  it("only reaches review when a preview actually resolves", () => {
    // The prototype auto-advances out of `adapting` after 1700ms. That must not
    // ship: the preview is a Bedrock call at 2.6s p50 with a retry path up to 24s,
    // so a timer would show a review screen with no data.
    get().open("w-1", "Upper Body");
    get().useGym({ id: "gym-1", name: "Hotel gym" });

    expect(get().step).toBe("adapting");
    expect(get().preview).toBeNull();

    get().previewResolved(preview);
    expect(get().step).toBe("review");
    expect(get().preview).toBe(preview);
  });

  it("lets a caller send the user back to collect after a failure", () => {
    get().open("w-1", "Upper Body");
    get().useGym({ id: "gym-1", name: "Hotel gym" });
    get().goToStep("collect");

    expect(get().step).toBe("collect");
    // The context survives, so a retry does not make the user re-pick their kit.
    expect(get().context?.kind).toBe("gym");
  });
});

describe("useLoadoutFlow — manual picks and the swap sheet", () => {
  it("opens and closes the swap sheet", () => {
    get().openSwap({ sortOrder: 2, exerciseId: "ex-1", exerciseName: "Row" });
    expect(get().swapTarget?.sortOrder).toBe(2);

    get().closeSwap();
    expect(get().swapTarget).toBeNull();
  });

  it("records a pick keyed on sortOrder and closes the sheet", () => {
    // Leaving the sheet open over a row that just changed reads as though the pick
    // did not take.
    get().openSwap({ sortOrder: 2, exerciseId: "ex-1", exerciseName: "Row" });
    get().applyManualPick(2, { exerciseId: "ex-9", isUserOverride: true });

    expect(get().manualPicks.get(2)).toEqual({
      exerciseId: "ex-9",
      isUserOverride: true,
    });
    expect(get().swapTarget).toBeNull();
  });

  it("carries isUserOverride through verbatim", () => {
    // The store must not infer this — it comes from which LIST the candidate was
    // picked from, and a wrong value either 400s the save or corrupts provenance.
    get().applyManualPick(0, { exerciseId: "ex-9", isUserOverride: false });
    expect(get().manualPicks.get(0)?.isUserOverride).toBe(false);

    get().applyManualPick(1, { exerciseId: "ex-8", isUserOverride: true });
    expect(get().manualPicks.get(1)?.isUserOverride).toBe(true);
  });

  it("overwrites a pick for the same row rather than accumulating", () => {
    get().applyManualPick(0, { exerciseId: "ex-9", isUserOverride: true });
    get().applyManualPick(0, { exerciseId: "ex-7", isUserOverride: false });

    expect(get().manualPicks.size).toBe(1);
    expect(get().manualPicks.get(0)).toEqual({
      exerciseId: "ex-7",
      isUserOverride: false,
    });
  });

  it("keeps picks for different rows independent", () => {
    get().applyManualPick(0, { exerciseId: "ex-9", isUserOverride: false });
    get().applyManualPick(1, { exerciseId: "ex-8", isUserOverride: true });

    expect(get().manualPicks.size).toBe(2);
    expect(get().manualPicks.get(0)?.exerciseId).toBe("ex-9");
    expect(get().manualPicks.get(1)?.exerciseId).toBe("ex-8");
  });

  it("clears a single pick", () => {
    get().applyManualPick(0, { exerciseId: "ex-9", isUserOverride: true });
    get().applyManualPick(1, { exerciseId: "ex-8", isUserOverride: true });
    get().clearManualPick(0);

    expect(get().manualPicks.has(0)).toBe(false);
    expect(get().manualPicks.has(1)).toBe(true);
  });

  it("clearing a pick that does not exist is a no-op that preserves identity", () => {
    // Returning a new Map unconditionally would re-render every subscriber of
    // `manualPicks` on a miss.
    get().applyManualPick(1, { exerciseId: "ex-8", isUserOverride: true });
    const before = get().manualPicks;
    get().clearManualPick(99);
    expect(get().manualPicks).toBe(before);
  });

  it("does not mutate the previous Map in place", () => {
    // A mutated Map would not trip zustand's referential equality check, so the
    // review list would silently fail to re-render.
    get().applyManualPick(0, { exerciseId: "ex-9", isUserOverride: true });
    const first = get().manualPicks;
    get().applyManualPick(1, { exerciseId: "ex-8", isUserOverride: true });

    expect(get().manualPicks).not.toBe(first);
    expect(first.size).toBe(1);
  });
});

describe("useLoadoutFlow — saved", () => {
  it("advances to saved and bumps rev so the parent list re-reads", () => {
    get().open("w-1", "Upper Body");
    get().saved();

    expect(get().step).toBe("saved");
    expect(get().rev).toBe(1);
  });

  it("keeps rev across a reset — it is a signal to a DIFFERENT screen", () => {
    // Clearing it on reset would drop the one notification the "Saved setups" list
    // is waiting for, since reset runs as the flow closes.
    get().open("w-1", "Upper Body");
    get().saved();
    get().reset();

    expect(get().rev).toBe(1);
    expect(get().step).toBeNull();
  });

  it("keeps rev across a re-open", () => {
    get().open("w-1", "Upper Body");
    get().saved();
    get().open("w-2", "Lower Body");

    expect(get().rev).toBe(1);
  });

  it("increments rev once per save", () => {
    get().saved();
    get().saved();
    expect(get().rev).toBe(2);
  });
});
