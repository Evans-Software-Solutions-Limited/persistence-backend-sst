import { act } from "@testing-library/react-native";
import { useFuelSheets } from "@/state/fuel-sheets";

function reset() {
  act(() => useFuelSheets.setState({ sheet: null, slot: "breakfast", rev: 0 }));
}

describe("useFuelSheets", () => {
  beforeEach(reset);

  it("opens the scan sheet with a slot", () => {
    act(() => useFuelSheets.getState().openScan("lunch"));
    expect(useFuelSheets.getState().sheet).toBe("scan");
    expect(useFuelSheets.getState().slot).toBe("lunch");
  });

  it("opens the quick-add sheet, defaulting the slot to breakfast", () => {
    act(() => useFuelSheets.getState().openQuickAdd());
    expect(useFuelSheets.getState().sheet).toBe("quickAdd");
    expect(useFuelSheets.getState().slot).toBe("breakfast");
  });

  it("closes the open sheet", () => {
    act(() => useFuelSheets.getState().openQuickAdd("dinner"));
    act(() => useFuelSheets.getState().close());
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("opens the snap sheet with a slot", () => {
    act(() => useFuelSheets.getState().openSnap("dinner"));
    expect(useFuelSheets.getState().sheet).toBe("snap");
    expect(useFuelSheets.getState().slot).toBe("dinner");
  });

  it("opens the snap sheet, defaulting the slot to breakfast", () => {
    act(() => useFuelSheets.getState().openSnap());
    expect(useFuelSheets.getState().sheet).toBe("snap");
    expect(useFuelSheets.getState().slot).toBe("breakfast");
  });

  it("a quickAdd→snap handoff does not clobber the store (guard convention)", () => {
    // Mirrors the quickAdd→scan handoff: opening snap while quickAdd is open
    // flips `sheet` to "snap" — the quickAdd container's guarded onClose
    // (only clears when ITS `visible` is true) must see `sheet !== "quickAdd"`
    // and no-op, matching the ScanBarcodeSheetContainer/QuickAddSheetContainer
    // convention documented at the top of this file.
    act(() => useFuelSheets.getState().openQuickAdd("lunch"));
    act(() => useFuelSheets.getState().openSnap());
    expect(useFuelSheets.getState().sheet).toBe("snap");
    expect(useFuelSheets.getState().slot).toBe("breakfast");
  });

  it("bumps the mutation revision", () => {
    act(() => useFuelSheets.getState().notifyMutated());
    act(() => useFuelSheets.getState().notifyMutated());
    expect(useFuelSheets.getState().rev).toBe(2);
  });
});
