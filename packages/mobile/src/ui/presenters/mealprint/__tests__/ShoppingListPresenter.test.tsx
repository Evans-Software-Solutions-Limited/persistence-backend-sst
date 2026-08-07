import { fireEvent, within } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import type { ShoppingList } from "@/domain/models/shoppingList";
import {
  ShoppingListPresenter,
  type ShoppingListProps,
} from "../ShoppingListPresenter";

function list(over: Partial<ShoppingList> = {}): ShoppingList {
  return {
    planId: "plan-1",
    aisles: [
      {
        aisle: "Meat & fish",
        items: [
          { id: "food-1", name: "Chicken breast", quantity: "300g" },
          { id: "food-2", name: "Salmon fillet", quantity: "2" },
        ],
      },
      {
        aisle: "Dairy & eggs",
        items: [{ id: "food-3", name: "Greek yoghurt", quantity: "500g" }],
      },
    ],
    totalItems: 3,
    ...over,
  };
}

function props(over: Partial<ShoppingListProps> = {}): ShoppingListProps {
  return {
    loading: false,
    error: null,
    list: list(),
    checked: {},
    onToggleItem: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

describe("ShoppingListPresenter", () => {
  it("shows a loading state before any list is known", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <ShoppingListPresenter {...props({ loading: true, list: null })} />,
    );
    expect(getByText(/Loading your shopping list/i)).toBeTruthy();
    expect(queryByTestId("shopping-list-progress")).toBeNull();
  });

  it("shows an error state when the fetch failed and there is no list", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ShoppingListPresenter
        {...props({
          loading: false,
          list: null,
          error: "This plan couldn't be found.",
        })}
      />,
    );
    expect(getByTestId("shopping-list-error")).toBeTruthy();
    expect(getByText("This plan couldn't be found.")).toBeTruthy();
  });

  it("renders the OFFLINE pill and the progress card with done/total", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ShoppingListPresenter {...props({ checked: { "food-1": true } })} />,
    );
    expect(getByText(/OFFLINE/i)).toBeTruthy();
    expect(
      within(getByTestId("shopping-list-progress")).getByText("1/3"),
    ).toBeTruthy();
  });

  it("renders one Card of items per aisle, in order", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ShoppingListPresenter {...props()} />,
    );
    expect(getByText("Meat & fish")).toBeTruthy();
    expect(getByText("Dairy & eggs")).toBeTruthy();
    expect(getByTestId("shopping-item-food-1")).toBeTruthy();
    expect(getByTestId("shopping-item-food-2")).toBeTruthy();
    expect(getByTestId("shopping-item-food-3")).toBeTruthy();
  });

  it("shows each item's name and right-aligned quantity", () => {
    const { getByText } = renderWithTheme(
      <ShoppingListPresenter {...props()} />,
    );
    expect(getByText("Chicken breast")).toBeTruthy();
    expect(getByText("300g")).toBeTruthy();
  });

  it("fires onToggleItem with the item id when a row is pressed", () => {
    const onToggleItem = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ShoppingListPresenter {...props({ onToggleItem })} />,
    );
    fireEvent.press(getByTestId("shopping-item-food-1"));
    expect(onToggleItem).toHaveBeenCalledWith("food-1");
  });

  it("renders a checked item with a checked accessibility state", () => {
    const { getByTestId } = renderWithTheme(
      <ShoppingListPresenter {...props({ checked: { "food-1": true } })} />,
    );
    expect(
      getByTestId("shopping-item-food-1").props.accessibilityState?.checked,
    ).toBe(true);
    expect(
      getByTestId("shopping-item-food-2").props.accessibilityState?.checked,
    ).toBe(false);
  });

  it("fires onBack from the header", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ShoppingListPresenter {...props({ onBack })} />,
    );
    fireEvent.press(getByTestId("shopping-list-back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows a full progress bar once every item is checked", () => {
    const { getByTestId } = renderWithTheme(
      <ShoppingListPresenter
        {...props({
          checked: { "food-1": true, "food-2": true, "food-3": true },
        })}
      />,
    );
    expect(
      within(getByTestId("shopping-list-progress")).getByText("3/3"),
    ).toBeTruthy();
  });
});
