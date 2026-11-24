import { fireEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  PlansShoppingListPresenter,
  type PlansShoppingListProps,
} from "../PlansShoppingListPresenter";

function render(over: Partial<PlansShoppingListProps> = {}) {
  const props: PlansShoppingListProps = {
    view: "list",
    chips: [
      { key: "p1", label: "Training day" },
      { key: "mealprint-m1", label: "Mealprint plan" },
    ],
    done: 1,
    total: 3,
    aisles: [
      {
        aisle: "Meat & fish",
        items: [
          { id: "i1", name: "Chicken breast", quantity: "450 g", ticked: true },
        ],
      },
      {
        aisle: "Cupboard",
        items: [
          { id: "i2", name: "Porridge oats", quantity: "160 g", ticked: false },
          { id: "i3", name: "Honey", quantity: "1 jar", ticked: false },
        ],
      },
    ],
    refreshing: false,
    onRefresh: jest.fn(),
    onToggle: jest.fn(),
    onBack: jest.fn(),
    onAdd: jest.fn(),
    onRetry: jest.fn(),
    ...over,
  };
  return {
    props,
    ...renderWithTheme(<PlansShoppingListPresenter {...props} />),
  };
}

describe("PlansShoppingListPresenter", () => {
  it("draws the N23 top bar, chips, progress and aisles", () => {
    const { getByText, getByTestId } = render();
    expect(getByText("Shopping list")).toBeTruthy();
    expect(getByText("Training day")).toBeTruthy();
    expect(getByText("Mealprint plan")).toBeTruthy();
    expect(getByTestId("plans-shopping-done").props.children).toBe(1);
    expect(getByText("of 3 items")).toBeTruthy();
    expect(getByText("Meat & fish")).toBeTruthy();
    expect(getByText("Cupboard")).toBeTruthy();
    expect(getByText("450 g")).toBeTruthy();
    expect(getByText("1 jar")).toBeTruthy();
  });

  it("marks ticked rows as checked and strikes their name through", () => {
    const { getByTestId, getByText } = render();
    expect(
      getByTestId("plans-shopping-item-i1").props.accessibilityState,
    ).toEqual({ checked: true });
    expect(
      getByTestId("plans-shopping-item-i2").props.accessibilityState,
    ).toEqual({ checked: false });
    const ticked = getByText("Chicken breast");
    const open = getByText("Porridge oats");
    const flat = (s: unknown) => Object.assign({}, ...[s].flat(3));
    expect(flat(ticked.props.style).textDecorationLine).toBe("line-through");
    expect(flat(open.props.style).textDecorationLine).toBe("none");
  });

  it("shows the bar as done / total", () => {
    const { getByTestId } = render({ done: 1, total: 4 });
    const flat = Object.assign(
      {},
      ...[getByTestId("plans-shopping-bar").props.style].flat(3),
    );
    expect(flat.width).toBe("25%");
  });

  it("fires toggle, back and add", () => {
    const { props, getByTestId } = render();
    fireEvent.press(getByTestId("plans-shopping-item-i2"));
    expect(props.onToggle).toHaveBeenCalledWith("i2");
    fireEvent.press(getByTestId("plans-shopping-back"));
    expect(props.onBack).toHaveBeenCalled();
    fireEvent.press(getByTestId("plans-shopping-add"));
    expect(props.onAdd).toHaveBeenCalled();
  });

  it("pull to refresh calls onRefresh", () => {
    const { props, getByTestId } = render({ refreshing: true });
    const scroll = getByTestId("plans-shopping-scroll");
    expect(scroll.props.refreshControl.props.refreshing).toBe(true);
    scroll.props.refreshControl.props.onRefresh();
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("says there is nothing to buy when the plans have no items", () => {
    const { getByTestId, getByText } = render({
      done: 0,
      total: 0,
      aisles: [],
    });
    expect(getByTestId("plans-shopping-nothing")).toBeTruthy();
    expect(getByText("of 0 items")).toBeTruthy();
    const flat = Object.assign(
      {},
      ...[getByTestId("plans-shopping-bar").props.style].flat(3),
    );
    expect(flat.width).toBe("0%");
  });

  it("shows the empty state with a way to add a plan", () => {
    const { props, getByTestId, queryByTestId } = render({ view: "empty" });
    expect(getByTestId("plans-shopping-empty")).toBeTruthy();
    expect(queryByTestId("plans-shopping-progress")).toBeNull();
    fireEvent.press(getByTestId("plans-shopping-empty-add"));
    expect(props.onAdd).toHaveBeenCalled();
  });

  it("shows loading, offline and error states", () => {
    expect(
      render({ view: "loading" }).getByTestId("plans-shopping-loading"),
    ).toBeTruthy();
    expect(
      render({ view: "offline" }).getByText("You're offline"),
    ).toBeTruthy();
    const err = render({ view: "error" });
    expect(err.getByText("Couldn't load your shopping list")).toBeTruthy();
    fireEvent.press(err.getByTestId("plans-shopping-retry"));
    expect(err.props.onRetry).toHaveBeenCalled();
  });

  it("renders the sheet slot", () => {
    const { getByText } = render({ sheet: <Text>sheet here</Text> });
    expect(getByText("sheet here")).toBeTruthy();
  });
});
