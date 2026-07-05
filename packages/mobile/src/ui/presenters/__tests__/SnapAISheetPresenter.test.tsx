import { createRef } from "react";
import { Text } from "react-native";
import { fireEvent } from "@testing-library/react-native";
import { CameraView } from "expo-camera";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  SnapAISheetPresenter,
  type SnapAISheetProps,
  type SnapDraftItem,
} from "../SnapAISheetPresenter";

const item = (over: Partial<SnapDraftItem> = {}): SnapDraftItem => ({
  name: "Grilled chicken breast",
  quantity: 1,
  unit: "piece",
  estimatedGrams: 180,
  kcal: 300,
  proteinG: 56,
  carbsG: 0,
  fatG: 7,
  confidence: 0.94,
  on: true,
  ...over,
});

function render(over: Partial<SnapAISheetProps> = {}) {
  const props: SnapAISheetProps = {
    visible: true,
    onClose: jest.fn(),
    stage: "capture",
    offline: false,
    hasPermission: true,
    onRequestPermission: jest.fn(),
    cameraRef: createRef<CameraView>(),
    onShutterPress: jest.fn(),
    onPickFromLibrary: jest.fn(),
    items: [item()],
    onToggleItem: jest.fn(),
    onEditGrams: jest.fn(),
    totalKcal: 300,
    slot: "breakfast",
    onSlotChange: jest.fn(),
    onConfirm: jest.fn(),
    errorMessage: null,
    onRetry: jest.fn(),
    onChooseAnother: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<SnapAISheetPresenter {...props} />), props };
}

describe("SnapAISheetPresenter — capture stage", () => {
  it("shows the offline notice and hides the camera when offline", () => {
    const { getByTestId, queryByTestId } = render({ offline: true });
    expect(getByTestId("snap-offline")).toBeTruthy();
    expect(queryByTestId("snap-camera")).toBeNull();
  });

  it("prompts for permission when not granted", () => {
    const { getByTestId, props } = render({ hasPermission: false });
    expect(getByTestId("snap-permission")).toBeTruthy();
    fireEvent.press(getByTestId("snap-grant"));
    expect(props.onRequestPermission).toHaveBeenCalled();
  });

  it("offers a library pick even without camera permission", () => {
    const { getByTestId, props } = render({ hasPermission: false });
    fireEvent.press(getByTestId("snap-pick-library-no-permission"));
    expect(props.onPickFromLibrary).toHaveBeenCalled();
  });

  it("renders the camera + shutter when permitted and online", () => {
    const { getByTestId, props } = render();
    expect(getByTestId("snap-camera")).toBeTruthy();
    fireEvent.press(getByTestId("snap-shutter"));
    expect(props.onShutterPress).toHaveBeenCalled();
  });

  it("offers a library pick from the capture stage", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("snap-pick-library"));
    expect(props.onPickFromLibrary).toHaveBeenCalled();
  });
});

describe("SnapAISheetPresenter — recognizing stage", () => {
  it("shows the pulsing recognizing overlay", () => {
    const { getByTestId } = render({ stage: "recognizing" });
    expect(getByTestId("snap-recognizing")).toBeTruthy();
  });
});

describe("SnapAISheetPresenter — confirm / added stages", () => {
  it("renders the shared confirm UI with the draft items", () => {
    const { getByTestId } = render({ stage: "confirm" });
    expect(getByTestId("snap-confirm")).toBeTruthy();
    expect(getByTestId("snap-confirm-item-0")).toBeTruthy();
  });

  it("toggling an item calls onToggleItem", () => {
    const { getByTestId, props } = render({ stage: "confirm" });
    fireEvent.press(getByTestId("snap-confirm-item-0-toggle"));
    expect(props.onToggleItem).toHaveBeenCalledWith(0);
  });

  it("editing grams calls onEditGrams", () => {
    const { getByTestId, props } = render({ stage: "confirm" });
    fireEvent.changeText(getByTestId("snap-confirm-item-0-grams"), "200");
    expect(props.onEditGrams).toHaveBeenCalledWith(0, 200);
  });

  it("confirming calls onConfirm", () => {
    const { getByTestId, props } = render({ stage: "confirm" });
    fireEvent.press(getByTestId("snap-confirm-add"));
    expect(props.onConfirm).toHaveBeenCalled();
  });

  it("added stage disables the Add button", () => {
    const { getByTestId } = render({ stage: "added" });
    expect(
      getByTestId("snap-confirm-add").props.accessibilityState.disabled,
    ).toBe(true);
  });

  it("low-confidence items default-unticked (container contract, rendered here)", () => {
    const { getByTestId } = render({
      stage: "confirm",
      items: [item({ confidence: 0.62, on: false, name: "Olive oil" })],
    });
    expect(
      getByTestId("snap-confirm-item-0-toggle").props.accessibilityState
        .checked,
    ).toBe(false);
  });
});

describe("SnapAISheetPresenter — error stage", () => {
  it("shows the default copy and retry/choose-another actions", () => {
    const { getByTestId, props } = render({
      stage: "error",
      errorMessage: null,
    });
    expect(getByTestId("snap-error")).toBeTruthy();
    fireEvent.press(getByTestId("snap-error-retry"));
    expect(props.onRetry).toHaveBeenCalled();
    fireEvent.press(getByTestId("snap-error-choose-another"));
    expect(props.onChooseAnother).toHaveBeenCalled();
  });

  it("shows a custom error message when provided", () => {
    const { getByTestId } = render({
      stage: "error",
      errorMessage: "The AI service is unavailable.",
    });
    expect(
      getByTestId("snap-error").findAllByType(Text)[0].props.children,
    ).toBe("The AI service is unavailable.");
  });
});
