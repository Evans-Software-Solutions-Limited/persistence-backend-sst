import { fireEvent } from "@testing-library/react-native";
import React from "react";
import type { LoadoutPreviewRow } from "@/domain/models/loadout";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { LoadoutEntryCard } from "../LoadoutEntryCard";
import { LoadoutUpsellSheet, formatMonthlyPrice } from "../LoadoutUpsellSheet";
import { SavedSetupsSection } from "../SavedSetupsSection";
import { formatTarget } from "../LoadoutReviewStep";
import { adaptingErrorCopy } from "../LoadoutAdaptingStep";
import {
  EquipmentScanSheetPresenter,
  scanErrorCopy,
} from "../EquipmentScanSheetPresenter";
import { LoadoutManualStep } from "../LoadoutManualStep";
import { GymsLockedPanel } from "../GymsLockedPanel";
import { LoadoutScaffold } from "../LoadoutScaffold";
import { LoadoutSavedStep } from "../LoadoutSavedStep";

jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

/** RN style props arrive as an array once an inline style is merged in. */
function flattenStyle(node: { props: { style?: unknown } }) {
  const style = node.props.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.flat(Infinity))
    : style;
}

const row = (
  overrides: Partial<LoadoutPreviewRow> = {},
): LoadoutPreviewRow => ({
  sortOrder: 1,
  status: "kept",
  exerciseId: "ex-1",
  substitutedFromExerciseId: null,
  reason: {
    code: "kept_compatible",
    missingEquipment: [],
    matchedOn: [],
    flags: [],
    note: null,
    selectedBy: null,
  },
  exercise: null,
  supersetGroup: null,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetDurationSeconds: null,
  restSeconds: null,
  notes: null,
  ...overrides,
});

describe("LoadoutEntryCard", () => {
  it("pitches the feature when locked, and never prints a price", () => {
    const { getByText, queryByText } = renderWithTheme(
      <LoadoutEntryCard locked onPress={jest.fn()} />,
    );
    getByText("Unlock to re-map this workout to whatever kit you have");
    getByText("PREMIUM+");
    // The number lives in the sheet, sourced from the catalog. A literal on a
    // card is how the retired £19.99 would have shipped past a price change.
    expect(queryByText(/£/)).toBeNull();
  });

  it("describes the action when unlocked", () => {
    const { getByText } = renderWithTheme(
      <LoadoutEntryCard locked={false} onPress={jest.fn()} />,
    );
    getByText("Re-map this workout to whatever kit you have today");
  });

  it("is still tappable when locked — the paywall is the pitch", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <LoadoutEntryCard locked onPress={onPress} />,
    );
    fireEvent.press(getByTestId("loadout-entry-card"));
    expect(onPress).toHaveBeenCalled();
  });

  it("distinguishes re-adaptation and explains when the linked gym changed", () => {
    const { getByText } = renderWithTheme(
      <LoadoutEntryCard
        locked={false}
        mode="readapt"
        gymUpdated
        onPress={jest.fn()}
      />,
    );
    getByText("Re-adapt this setup");
    getByText("Your gym equipment has changed since this setup was made");
  });

  it("asks for new equipment when a setup no longer has a linked gym", () => {
    const { getByText } = renderWithTheme(
      <LoadoutEntryCard
        locked={false}
        mode="readapt"
        linkedGymAvailable={false}
        onPress={jest.fn()}
      />,
    );
    getByText("Choose equipment and re-run the original workout");
  });
});

describe("GymsLockedPanel", () => {
  it("pitches and offers an upgrade, with NO price literal", () => {
    const { getByTestId, getByText, queryByText } = renderWithTheme(
      <GymsLockedPanel onUpgrade={jest.fn()} />,
    );
    getByTestId("gyms-locked");
    getByText("PREMIUM+");
    // Same rule as LoadoutEntryCard: the number lives in the sheet, from the
    // catalog. `premium_plus` ships inactive, so there is no price yet at all.
    expect(queryByText(/£/)).toBeNull();
  });

  it("builds no taster — design § 5.2 is a hard gate", () => {
    const { queryByText, queryByTestId } = renderWithTheme(
      <GymsLockedPanel onUpgrade={jest.fn()} />,
    );
    // No free allowance to have run out of, and nothing that previews real
    // output: no list, no counts, no create affordance.
    expect(queryByText(/free/i)).toBeNull();
    expect(queryByText(/remaining/i)).toBeNull();
    expect(queryByText(/\d+ item/)).toBeNull();
    expect(queryByTestId("saved-gyms-create")).toBeNull();
  });

  it("routes to the paywall", () => {
    const onUpgrade = jest.fn();
    const { getByTestId } = renderWithTheme(
      <GymsLockedPanel onUpgrade={onUpgrade} />,
    );
    fireEvent.press(getByTestId("gyms-locked-upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
  });
});

describe("LoadoutUpsellSheet", () => {
  it("shows the live API price when there is one", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <LoadoutUpsellSheet
        visible
        onClose={jest.fn()}
        priceMonthly={29.99}
        onUpgrade={jest.fn()}
      />,
    );
    getByTestId("loadout-upsell-price");
    getByText("£29.99");
  });

  it("omits the price block entirely when the API has none", () => {
    const { queryByTestId } = renderWithTheme(
      <LoadoutUpsellSheet
        visible
        onClose={jest.fn()}
        priceMonthly={null}
        onUpgrade={jest.fn()}
      />,
    );
    expect(queryByTestId("loadout-upsell-price")).toBeNull();
  });

  it("builds NO taster meter — design § 5.2 is a hard gate", () => {
    const { queryByText } = renderWithTheme(
      <LoadoutUpsellSheet
        visible
        onClose={jest.fn()}
        priceMonthly={null}
        onUpgrade={jest.fn()}
      />,
    );
    // The handoff's "3 free scans left" framing must not exist: there is no
    // free-tier code path, so there is nothing to have run out of.
    expect(queryByText(/free scan/i)).toBeNull();
    expect(queryByText(/remaining/i)).toBeNull();
  });

  it("routes to the paywall", () => {
    const onUpgrade = jest.fn();
    const { getByTestId } = renderWithTheme(
      <LoadoutUpsellSheet
        visible
        onClose={jest.fn()}
        priceMonthly={29.99}
        onUpgrade={onUpgrade}
      />,
    );
    fireEvent.press(getByTestId("loadout-upsell-upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
  });
});

describe("formatMonthlyPrice", () => {
  it("drops the pence on a whole-pound price", () => {
    expect(formatMonthlyPrice(30)).toBe("£30");
  });
  it("keeps two decimals otherwise", () => {
    expect(formatMonthlyPrice(29.99)).toBe("£29.99");
    expect(formatMonthlyPrice(29.9)).toBe("£29.90");
  });
});

describe("SavedSetupsSection", () => {
  const variation = (overrides = {}) => ({
    id: "v-1",
    name: "Upper Body · Hotel gym",
    description: null,
    parentWorkoutId: "w-1",
    variationKind: "loadout",
    sourceGymId: "gym-1",
    sourceGymName: "Hotel gym",
    sourceEquipmentTypeIds: null,
    estimatedDurationMinutes: null,
    swapCount: 3,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  });

  it("renders nothing when the workout has never been adapted", () => {
    const { queryByTestId } = renderWithTheme(
      <SavedSetupsSection variations={[]} onOpenVariation={jest.fn()} />,
    );
    expect(queryByTestId("loadout-saved-setups")).toBeNull();
  });

  it("shows the ORIGINAL alongside the variations", () => {
    const { getByText } = renderWithTheme(
      <SavedSetupsSection
        variations={[variation()]}
        onOpenVariation={jest.fn()}
      />,
    );
    // AC-5.1's promise is only visible if the original sits there as a peer.
    getByText("Original");
    getByText("BASE");
    getByText("Hotel gym");
    getByText("3 swaps");
  });

  it("falls back to the variation's own name when the gym was deleted", () => {
    const { getByText } = renderWithTheme(
      <SavedSetupsSection
        variations={[variation({ sourceGymName: null })]}
        onOpenVariation={jest.fn()}
      />,
    );
    // `sourceGymName` is LEFT JOINed and a variation outlives its gym (AC-7.3).
    getByText("Upper Body · Hotel gym");
  });

  it.each([
    [0, "no swaps"],
    [1, "1 swap"],
    [4, "4 swaps"],
  ])("pluralises %s swaps correctly", (count, label) => {
    const { getByText } = renderWithTheme(
      <SavedSetupsSection
        variations={[variation({ swapCount: count })]}
        onOpenVariation={jest.fn()}
      />,
    );
    getByText(label);
  });

  it("opens a variation", () => {
    const onOpen = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SavedSetupsSection
        variations={[variation()]}
        onOpenVariation={onOpen}
      />,
    );
    fireEvent.press(getByTestId("loadout-variation-v-1"));
    expect(onOpen).toHaveBeenCalledWith("v-1");
  });

  it("signals an equipment-set change without replacing the row action", () => {
    const onOpen = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <SavedSetupsSection
        variations={[
          variation({
            sourceEquipmentTypeIds: ["eq-dumbbell"],
            currentSourceGymEquipmentTypeIds: ["eq-dumbbell", "eq-cable"],
          }),
        ]}
        onOpenVariation={onOpen}
      />,
    );
    getByText("Gym equipment updated · Re-adapt");
    fireEvent.press(getByTestId("loadout-variation-v-1"));
    expect(onOpen).toHaveBeenCalledWith("v-1");
  });
});

describe("formatTarget", () => {
  it("renders a rep RANGE", () => {
    expect(formatTarget(row())).toBe("3 sets × 8–10 reps");
  });

  it("collapses a single rep target", () => {
    expect(formatTarget(row({ targetRepsMin: 12, targetRepsMax: 12 }))).toBe(
      "3 sets × 12 reps",
    );
  });

  it("renders a duration target instead of reps", () => {
    expect(formatTarget(row({ targetDurationSeconds: 45 }))).toBe("3 × 45s");
  });

  it("treats a zero duration as a rep target, not a 0s hold", () => {
    expect(formatTarget(row({ targetDurationSeconds: 0 }))).toBe(
      "3 sets × 8–10 reps",
    );
  });

  it("defaults a null set count to 1 rather than rendering 'null sets'", () => {
    expect(formatTarget(row({ targetSets: null }))).toBe("1 sets × 8–10 reps");
    expect(
      formatTarget(row({ targetSets: null, targetDurationSeconds: 30 })),
    ).toBe("1 × 30s");
  });
});

describe("adaptingErrorCopy", () => {
  it("offers an upgrade only on an entitlement denial", () => {
    expect(adaptingErrorCopy("entitlement").upgrade).toBe(true);
    expect(adaptingErrorCopy("limit").upgrade).toBe(false);
    expect(adaptingErrorCopy("unavailable").upgrade).toBe(false);
    expect(adaptingErrorCopy("generic").upgrade).toBe(false);
  });

  it("offers no retry where retrying cannot succeed", () => {
    expect(adaptingErrorCopy("limit").retryable).toBe(false);
    expect(adaptingErrorCopy("entitlement").retryable).toBe(false);
    expect(adaptingErrorCopy("unavailable").retryable).toBe(true);
    expect(adaptingErrorCopy("generic").retryable).toBe(true);
  });

  it("never tells the user to rephrase — there is no prompt", () => {
    for (const kind of [
      "entitlement",
      "limit",
      "unavailable",
      "generic",
    ] as const) {
      expect(adaptingErrorCopy(kind).body).not.toMatch(/rephras/i);
    }
  });

  it("names the outage rather than blaming the connection on a 503", () => {
    // There is no fallback to the § 6.2 ranker, so "try again" alone would send
    // the user at a call that fails for as long as the outage lasts.
    expect(adaptingErrorCopy("unavailable").title).toBe(
      "Loadout can't adapt right now",
    );
  });
});

describe("scanErrorCopy", () => {
  it("offers an upgrade only on an entitlement denial", () => {
    expect(scanErrorCopy("entitlement").upgrade).toBe(true);
    for (const kind of [
      "unreadable",
      "limit",
      "unavailable",
      "generic",
    ] as const) {
      expect(scanErrorCopy(kind).upgrade).toBe(false);
    }
  });

  it("offers no retry on a ceiling or a denial", () => {
    expect(scanErrorCopy("limit").retryable).toBe(false);
    expect(scanErrorCopy("entitlement").retryable).toBe(false);
    expect(scanErrorCopy("unreadable").retryable).toBe(true);
    expect(scanErrorCopy("unavailable").retryable).toBe(true);
    expect(scanErrorCopy("generic").retryable).toBe(true);
  });

  it("never tells the user to rephrase a photo", () => {
    for (const kind of [
      "entitlement",
      "unreadable",
      "limit",
      "unavailable",
      "generic",
    ] as const) {
      expect(scanErrorCopy(kind).body).not.toMatch(/rephras/i);
    }
  });

  it("tells an unreadable photo HOW to be better, not just that it failed", () => {
    expect(scanErrorCopy("unreadable").body).toMatch(/wider shot/);
  });
});

describe("LoadoutScaffold", () => {
  it("renders no back affordance when none is supplied", () => {
    const { queryByTestId } = renderWithTheme(
      <LoadoutScaffold title="Done" testID="scaffold">
        {null}
      </LoadoutScaffold>,
    );
    expect(queryByTestId("scaffold-back")).toBeNull();
  });

  it("labels the close variant for screen readers", () => {
    const { getByLabelText } = renderWithTheme(
      <LoadoutScaffold
        title="Set up"
        onBack={jest.fn()}
        backIcon="close"
        backLabel="Close Loadout"
        testID="scaffold"
      >
        {null}
      </LoadoutScaffold>,
    );
    expect(getByLabelText("Close Loadout")).toBeTruthy();
  });

  it("renders the eyebrow, trailing slot and footer when supplied", () => {
    const { getByText } = renderWithTheme(
      <LoadoutScaffold
        title="Pick equipment"
        eyebrow="LOADOUT"
        onBack={jest.fn()}
        trailing={<>{null}</>}
        footer={<>{null}</>}
      >
        {null}
      </LoadoutScaffold>,
    );
    getByText("LOADOUT");
    getByText("Pick equipment");
  });

  it("pads for the status bar and the home indicator", () => {
    // The device bug this replaced: `<SafeAreaView>` from
    // react-native-safe-area-context is native-only and never reads
    // `SafeAreaInsetsContext`, so inside the `fullScreenModal` route it measured
    // ZERO and the header rendered over the clock. Asserting the ACTUAL numbers
    // from `renderWithTheme`'s provider (top 44 / bottom 34) is what makes this
    // fail if the insets are dropped again — a truthy-style check would pass on
    // `paddingTop: 0`, which is the whole bug.
    const { getByTestId } = renderWithTheme(
      <LoadoutScaffold title="Set up Loadout" testID="scaffold">
        {null}
      </LoadoutScaffold>,
    );

    expect(flattenStyle(getByTestId("scaffold"))).toMatchObject({
      paddingTop: 44,
      paddingBottom: 34,
    });
  });
});

describe("LoadoutSavedStep", () => {
  it("pads for the status bar and the home indicator", () => {
    // Repeated rather than inherited: this step does not use the scaffold, so
    // dropping its insets is a separate regression with the same symptom.
    const { getByTestId } = renderWithTheme(
      <LoadoutSavedStep
        workoutName="Upper"
        gymLabel="Hotel gym"
        onDone={jest.fn()}
      />,
    );

    expect(flattenStyle(getByTestId("loadout-saved"))).toMatchObject({
      paddingTop: 44,
      paddingBottom: 34,
    });
  });

  it("uses update copy after an in-place re-adaptation", () => {
    const { getByText } = renderWithTheme(
      <LoadoutSavedStep
        workoutName="Upper"
        gymLabel="Hotel gym"
        replaced
        onDone={jest.fn()}
      />,
    );
    getByText("Setup re-adapted");
    getByText("View updated setup");
  });
});

describe("LoadoutManualStep", () => {
  const base = {
    groups: [],
    selectedIds: new Set<string>(),
    onToggle: jest.fn(),
    name: "",
    onNameChange: jest.fn(),
    saveAsGym: true,
    onToggleSave: jest.fn(),
    onBack: jest.fn(),
    onAdapt: jest.fn(),
  };

  it("says it is loading while the catalogue is in flight", () => {
    const { getByTestId } = renderWithTheme(
      <LoadoutManualStep {...base} isLoading />,
    );
    getByTestId("loadout-manual-loading");
  });

  it("distinguishes a FAILED catalogue load from a loading one", () => {
    // An empty picker with no explanation reads as "you own no equipment".
    const { getByTestId, queryByTestId } = renderWithTheme(
      <LoadoutManualStep {...base} isLoading={false} />,
    );
    getByTestId("loadout-manual-empty");
    expect(queryByTestId("loadout-manual-loading")).toBeNull();
  });

  it("labels the save toggle by its state for screen readers", () => {
    const { getByTestId, rerender } = renderWithTheme(
      <LoadoutManualStep {...base} isLoading={false} saveAsGym={false} />,
    );
    expect(
      getByTestId("loadout-manual-save-toggle").props.accessibilityState
        .checked,
    ).toBe(false);

    rerender(<LoadoutManualStep {...base} isLoading={false} saveAsGym />);
    expect(
      getByTestId("loadout-manual-save-toggle").props.accessibilityState
        .checked,
    ).toBe(true);
  });

  // The CTA copy had no assertion at all until 2026-08-02, which is how it
  // shipped reading "Adapt to 1 items" — reachable by ticking a single chip, the
  // most likely thing a user with a bag of dumbbells does.
  it("says '1 item' for a single pick and '2 items' for more", () => {
    const { getByText, rerender } = renderWithTheme(
      <LoadoutManualStep
        {...base}
        isLoading={false}
        selectedIds={new Set(["eq-dumbbell"])}
      />,
    );
    getByText("Adapt to 1 item");

    rerender(
      <LoadoutManualStep
        {...base}
        isLoading={false}
        selectedIds={new Set(["eq-dumbbell", "eq-bench"])}
      />,
    );
    getByText("Adapt to 2 items");
  });
});

describe("EquipmentScanSheetPresenter — the injected-detection guard", () => {
  /**
   * ⚠ Tested at the PRESENTER, not only through the container.
   *
   * `useLoadoutFlow.toggleScanDetection` already refuses to deselect a
   * server-injected detection, so a container-level test can never put an
   * injected id into `deselectedIds` — which makes the presenter's own half of
   * the guard look like dead code to a mutation sweep, and leaves the LAST layer
   * before render unprotected if the store's rule is ever relaxed. Handing this
   * pure presenter the state the store forbids is the only way to pin it.
   */
  const props = {
    visible: true,
    onClose: jest.fn(),
    stage: "draft" as const,
    draft: {
      detected: [
        {
          equipmentTypeId: "eq-dumbbell",
          name: "Dumbbells",
          confidence: 0.9,
          source: "model" as const,
        },
        {
          equipmentTypeId: "eq-bodyweight",
          name: "Bodyweight",
          confidence: 1,
          source: "injected" as const,
        },
      ],
      unmatched: [],
      notes: null,
      modelId: "opus",
    },
    // Both ids marked deselected, including the injected one.
    deselectedIds: new Set(["eq-dumbbell", "eq-bodyweight"]),
    errorKind: null,
    hasCameraPermission: true,
    offline: false,
    onRequestPermission: jest.fn(),
    onTakePhoto: jest.fn(),
    onPickFromLibrary: jest.fn(),
    onToggleDetection: jest.fn(),
    onUseDraft: jest.fn(),
    onRetry: jest.fn(),
    onPickManually: jest.fn(),
    onUpgrade: jest.fn(),
  };

  it("keeps an injected detection TICKED even when it is in deselectedIds", () => {
    const { getByTestId } = renderWithTheme(
      <EquipmentScanSheetPresenter {...props} />,
    );
    // Unticking `Bodyweight` would make every bodyweight exercise get swapped or
    // dropped for no reason (T-E1.7) — it is true of every room.
    expect(
      getByTestId("loadout-scan-chip-eq-bodyweight").props.accessibilityState
        .checked,
    ).toBe(true);
    expect(
      getByTestId("loadout-scan-chip-eq-dumbbell").props.accessibilityState
        .checked,
    ).toBe(false);
  });

  it("counts the injected detection as selected, so the CTA stays usable", () => {
    const { getByText } = renderWithTheme(
      <EquipmentScanSheetPresenter {...props} />,
    );
    // 1 of 2 — the injected one. A count that dropped it would disable "Use
    // these" on a draft that still has real equipment in it.
    getByText("DETECTED · 1 SELECTED");
    // "1 item", not "1 items" — this line pinned the wrong copy until 2026-08-02.
    getByText("Use these 1 item");
  });
});
