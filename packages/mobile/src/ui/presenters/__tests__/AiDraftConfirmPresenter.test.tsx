import { fireEvent, within } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  AiDraftConfirmPresenter,
  type AiDraftConfirmProps,
  type AiDraftItem,
} from "../AiDraftConfirmPresenter";

const item = (over: Partial<AiDraftItem> = {}): AiDraftItem => ({
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

function render(over: Partial<AiDraftConfirmProps> = {}) {
  const props: AiDraftConfirmProps = {
    items: [item()],
    onToggleItem: jest.fn(),
    onEditGrams: jest.fn(),
    totalKcal: 300,
    slot: "breakfast",
    onSlotChange: jest.fn(),
    onConfirm: jest.fn(),
    ...over,
  };
  return {
    ...renderWithTheme(<AiDraftConfirmPresenter {...props} />),
    props,
  };
}

describe("AiDraftConfirmPresenter", () => {
  it("renders the summary card with the kept-item count and total kcal", () => {
    const { getByTestId } = render({
      items: [item(), item({ name: "Rice", on: false })],
      totalKcal: 300,
    });
    expect(
      getByTestId("ai-draft-confirm-summary-count").props.children,
    ).toEqual(expect.arrayContaining([1]));
    expect(getByTestId("ai-draft-confirm-summary-kcal").props.children).toBe(
      "300",
    );
  });

  it("renders one row per item with name, grams, confidence, and kcal", () => {
    const { getByTestId } = render();
    expect(getByTestId("ai-draft-confirm-item-0")).toBeTruthy();
    expect(getByTestId("ai-draft-confirm-item-0-grams").props.value).toBe(
      "180",
    );
    expect(
      within(getByTestId("ai-draft-confirm-item-0-confidence")).getByText(/94/),
    ).toBeTruthy();
    expect(getByTestId("ai-draft-confirm-item-0-kcal").props.children).toEqual([
      "300",
      " kcal",
    ]);
  });

  it("renders the confidence pill with the gold tone below the 0.7 threshold", () => {
    const { getByTestId } = render({
      items: [item({ confidence: 0.62, on: false })],
    });
    expect(getByTestId("ai-draft-confirm-item-0-confidence")).toBeTruthy();
  });

  it("toggling a row calls onToggleItem with its index", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("ai-draft-confirm-item-0-toggle"));
    expect(props.onToggleItem).toHaveBeenCalledWith(0);
  });

  it("editing the grams input calls onEditGrams with the parsed number", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(getByTestId("ai-draft-confirm-item-0-grams"), "150");
    expect(props.onEditGrams).toHaveBeenCalledWith(0, 150);
  });

  it("all-letters grams input strips to an empty string, parsing as 0", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(getByTestId("ai-draft-confirm-item-0-grams"), "abc");
    expect(props.onEditGrams).toHaveBeenCalledWith(0, 0);
  });

  it("a malformed numeric string (multiple decimal points) parses as NaN and falls back to 0", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(getByTestId("ai-draft-confirm-item-0-grams"), "1.2.3");
    expect(props.onEditGrams).toHaveBeenCalledWith(0, 0);
  });

  it("changing the meal slot calls onSlotChange", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("ai-draft-confirm-meal-picker-option-dinner"));
    expect(props.onSlotChange).toHaveBeenCalledWith("dinner");
  });

  it("confirming calls onConfirm", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("ai-draft-confirm-add"));
    expect(props.onConfirm).toHaveBeenCalled();
  });

  it("disables Add when no items are kept", () => {
    const { getByTestId } = render({ items: [item({ on: false })] });
    expect(
      getByTestId("ai-draft-confirm-add").props.accessibilityState.disabled,
    ).toBe(true);
  });

  it("shows 'Added ✓' and disables Add when added=true", () => {
    const { getByTestId } = render({ added: true });
    const addBtn = getByTestId("ai-draft-confirm-add");
    expect(addBtn.props.accessibilityState.disabled).toBe(true);
  });

  it("renders an unticked item's row with the toggle unchecked", () => {
    const { getByTestId } = render({ items: [item({ on: false })] });
    expect(
      getByTestId("ai-draft-confirm-item-0-toggle").props.accessibilityState
        .checked,
    ).toBe(false);
  });

  it("renders multiple items with distinct testIDs", () => {
    const { getByTestId } = render({
      items: [item({ name: "Chicken" }), item({ name: "Rice" })],
    });
    expect(getByTestId("ai-draft-confirm-item-0")).toBeTruthy();
    expect(getByTestId("ai-draft-confirm-item-1")).toBeTruthy();
  });

  it("supports a custom testID prefix", () => {
    const { getByTestId } = render({ testID: "custom-confirm" });
    expect(getByTestId("custom-confirm")).toBeTruthy();
    expect(getByTestId("custom-confirm-item-0")).toBeTruthy();
  });
});
