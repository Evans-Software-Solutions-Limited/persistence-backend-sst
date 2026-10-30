import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  ScanBarcodeSheetPresenter,
  type ScanBarcodeSheetProps,
} from "../ScanBarcodeSheetPresenter";
import type { Food } from "@/domain/models/nutrition";

const food: Food = {
  id: "f1",
  name: "Oatmeal",
  brand: null,
  barcode: "123",
  kcal: 150,
  proteinG: 5,
  carbsG: 27,
  fatG: 3,
  servingSize: 40,
  servingUnit: "g",
  servingQuantity: null,
  source: "openfoodfacts",
  createdBy: null,
};

function render(over: Partial<ScanBarcodeSheetProps> = {}) {
  const props: ScanBarcodeSheetProps = {
    visible: true,
    onClose: jest.fn(),
    stage: "scanning",
    hasPermission: true,
    onRequestPermission: jest.fn(),
    onBarcodeScanned: jest.fn(),
    isResolving: false,
    food: null,
    portionMode: "serving",
    onPortionModeChange: jest.fn(),
    portionValue: 1,
    onPortionDec: jest.fn(),
    onPortionInc: jest.fn(),
    effectiveGrams: 40,
    scaled: { kcal: 150, proteinG: 5, carbsG: 27, fatG: 3 },
    per100: null,
    slot: "breakfast",
    onSlotChange: jest.fn(),
    onAdd: jest.fn(),
    onRescan: jest.fn(),
    ...over,
  };
  return {
    ...renderWithTheme(<ScanBarcodeSheetPresenter {...props} />),
    props,
  };
}

describe("ScanBarcodeSheetPresenter", () => {
  it("prompts for camera permission when not granted", () => {
    const { getByTestId, props } = render({ hasPermission: false });
    expect(getByTestId("scan-permission")).toBeTruthy();
    fireEvent.press(getByTestId("scan-grant"));
    expect(props.onRequestPermission).toHaveBeenCalled();
  });

  it("mounts the camera when permission is granted", () => {
    const { getByTestId } = render({ hasPermission: true });
    expect(getByTestId("scan-camera")).toBeTruthy();
  });

  it("renders the found-food card with macro pills, kcal stat, portion + meal pickers", () => {
    const { getByTestId } = render({ stage: "found", food });
    expect(getByTestId("scan-found-card")).toBeTruthy();
    expect(getByTestId("scan-kcal")).toBeTruthy();
    expect(getByTestId("scan-portion-mode")).toBeTruthy();
    expect(getByTestId("scan-portion")).toBeTruthy();
    expect(getByTestId("scan-meal-picker")).toBeTruthy();
    expect(getByTestId("scan-off-credit")).toBeTruthy();
  });

  it("labels the Serving portion with the real pack serving when known", () => {
    // OFF food: per-100g macros, real pack serving 220 g → Serving tab shows
    // "× 220g", not the per-100g basis.
    const { getByText } = render({
      stage: "found",
      food: { ...food, servingSize: 100, servingQuantity: 220 },
      portionMode: "serving",
    });
    expect(getByText("× 220g")).toBeTruthy();
  });

  it("labels portion totals with the amount logged and adds a per-100 g reference, never 'per 100g' (PER-95)", () => {
    const { getByText, queryByText } = render({
      stage: "found",
      food: {
        ...food,
        barcode: "4056489241430",
        kcal: 139,
        proteinG: 28.8,
        carbsG: 0.8,
        fatG: 2.1,
        servingSize: 100,
        servingQuantity: 240,
      },
      effectiveGrams: 240,
      scaled: { kcal: 334, proteinG: 69, carbsG: 2, fatG: 5 },
      per100: { kcal: 139, proteinG: 28.8, carbsG: 0.8, fatG: 2.1 },
    });
    expect(getByText("4056489241430 · for 240 g")).toBeTruthy();
    expect(getByText("334")).toBeTruthy();
    expect(
      getByText("Per 100 g: 139 kcal · P 28.8g · C 0.8g · F 2.1g"),
    ).toBeTruthy();
    expect(queryByText(/per 100g/i)).toBeNull();
  });

  it("omits the per-100 reference when the food has no gram/ml basis", () => {
    const { queryByTestId, getByText } = render({
      stage: "found",
      food: { ...food, barcode: null, servingSize: 1, servingUnit: "slice" },
      effectiveGrams: 2,
      per100: null,
    });
    expect(getByText("for 2 slice")).toBeTruthy();
    expect(queryByTestId("scan-per100")).toBeNull();
  });

  it("falls back to servingSize in the Serving label when serving_quantity is null", () => {
    const { getByText } = render({
      stage: "found",
      food, // servingQuantity null, servingSize 40
      portionMode: "serving",
    });
    expect(getByText("× 40g")).toBeTruthy();
  });

  it("switches portion mode + steps the portion", () => {
    const { getByTestId, props } = render({ stage: "found", food });
    fireEvent.press(getByTestId("scan-portion-mode-option-grams"));
    expect(props.onPortionModeChange).toHaveBeenCalledWith("grams");
    fireEvent.press(getByTestId("scan-portion-inc"));
    expect(props.onPortionInc).toHaveBeenCalled();
    fireEvent.press(getByTestId("scan-portion-dec"));
    expect(props.onPortionDec).toHaveBeenCalled();
  });

  it("picks a meal slot, adds, and re-scans", () => {
    const { getByTestId, props } = render({ stage: "found", food });
    fireEvent.press(getByTestId("scan-meal-picker-option-dinner"));
    expect(props.onSlotChange).toHaveBeenCalledWith("dinner");
    fireEvent.press(getByTestId("scan-confirm"));
    expect(props.onAdd).toHaveBeenCalled();
    fireEvent.press(getByTestId("scan-rescan"));
    expect(props.onRescan).toHaveBeenCalled();
  });

  it("renders the not-found, offline, and unavailable states", () => {
    expect(
      render({ stage: "not-found" }).getByTestId("scan-not-found"),
    ).toBeTruthy();
    expect(
      render({ stage: "offline" }).getByTestId("scan-offline"),
    ).toBeTruthy();
    expect(
      render({ stage: "unavailable" }).getByTestId("scan-unavailable"),
    ).toBeTruthy();
  });

  it('shows a plain "QUICK LOG" eyebrow with no day-context', () => {
    const { getByText, queryByText } = render();
    expect(getByText("QUICK LOG")).toBeTruthy();
    expect(queryByText(/QUICK LOG ·/)).toBeNull();
  });

  it("appends the day-context to the eyebrow when logging onto a past day (BRIEF-7 QA-20)", () => {
    const { getByText, queryByText } = render({
      dayContext: "TUESDAY · JUL 21",
    });
    expect(getByText("QUICK LOG · TUESDAY · JUL 21")).toBeTruthy();
    expect(queryByText("QUICK LOG")).toBeNull();
  });
});
