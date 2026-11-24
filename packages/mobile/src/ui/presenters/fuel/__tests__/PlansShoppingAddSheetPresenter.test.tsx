import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  PlansShoppingAddSheetPresenter,
  type PlansShoppingAddSheetProps,
} from "../PlansShoppingAddSheetPresenter";

function render(over: Partial<PlansShoppingAddSheetProps> = {}) {
  const props: PlansShoppingAddSheetProps = {
    visible: true,
    onClose: jest.fn(),
    plans: [
      {
        id: "p1",
        name: "Training day",
        sub: "Yours",
        fromCoach: false,
        included: true,
      },
      {
        id: "c1",
        name: "Cut phase",
        sub: "From Sam",
        fromCoach: true,
        included: false,
      },
    ],
    onToggle: jest.fn(),
    ...over,
  };
  return {
    props,
    ...renderWithTheme(<PlansShoppingAddSheetPresenter {...props} />),
  };
}

describe("PlansShoppingAddSheetPresenter", () => {
  it("lists every plan with its tick", () => {
    const { getByText, getByTestId } = render();
    expect(getByText("Training day")).toBeTruthy();
    expect(getByText("From Sam")).toBeTruthy();
    expect(
      getByTestId("plans-shopping-add-plan-p1").props.accessibilityState,
    ).toEqual({ checked: true });
    expect(
      getByTestId("plans-shopping-add-plan-c1").props.accessibilityState,
    ).toEqual({ checked: false });
  });

  it("ticking adds, unticking takes out", () => {
    const { props, getByTestId } = render();
    fireEvent.press(getByTestId("plans-shopping-add-plan-c1"));
    expect(props.onToggle).toHaveBeenCalledWith("c1", true);
    fireEvent.press(getByTestId("plans-shopping-add-plan-p1"));
    expect(props.onToggle).toHaveBeenCalledWith("p1", false);
  });

  it("Done closes", () => {
    const { props, getByTestId } = render();
    fireEvent.press(getByTestId("plans-shopping-add-done"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("says when there are no plans", () => {
    const { getByTestId } = render({ plans: [] });
    expect(getByTestId("plans-shopping-add-empty")).toBeTruthy();
  });
});
