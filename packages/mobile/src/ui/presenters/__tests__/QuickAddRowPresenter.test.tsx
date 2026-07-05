import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  QuickAddRowPresenter,
  type QuickAddRowProps,
} from "../QuickAddRowPresenter";

function render(over: Partial<QuickAddRowProps> = {}) {
  const props: QuickAddRowProps = {
    aiLocked: true,
    onScan: jest.fn(),
    onSnap: jest.fn(),
    onSearch: jest.fn(),
    onRecipes: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<QuickAddRowPresenter {...props} />), props };
}

describe("QuickAddRowPresenter", () => {
  it("renders the four quick-add buttons", () => {
    const { getByTestId } = render();
    expect(getByTestId("fuel-quick-scan")).toBeTruthy();
    expect(getByTestId("fuel-quick-snap")).toBeTruthy();
    expect(getByTestId("fuel-quick-search")).toBeTruthy();
    expect(getByTestId("fuel-quick-recipes")).toBeTruthy();
  });

  it("shows the lock badge on Snap when AI is locked", () => {
    const { getByTestId } = render({ aiLocked: true });
    expect(getByTestId("fuel-quick-snap-lock")).toBeTruthy();
  });

  it("hides the lock badge when AI is allowed", () => {
    const { queryByTestId } = render({ aiLocked: false });
    expect(queryByTestId("fuel-quick-snap-lock")).toBeNull();
  });

  it("routes each button to its handler", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-quick-scan"));
    fireEvent.press(getByTestId("fuel-quick-snap"));
    fireEvent.press(getByTestId("fuel-quick-search"));
    fireEvent.press(getByTestId("fuel-quick-recipes"));
    expect(props.onScan).toHaveBeenCalledTimes(1);
    expect(props.onSnap).toHaveBeenCalledTimes(1);
    expect(props.onSearch).toHaveBeenCalledTimes(1);
    expect(props.onRecipes).toHaveBeenCalledTimes(1);
  });

  it("disables Snap and shows a neutral lock badge when offline", () => {
    const { getByTestId, props } = render({
      aiLocked: false,
      snapOffline: true,
    });
    fireEvent.press(getByTestId("fuel-quick-snap"));
    expect(props.onSnap).not.toHaveBeenCalled();
    expect(getByTestId("fuel-quick-snap-lock")).toBeTruthy();
    expect(getByTestId("fuel-quick-snap").props.accessibilityLabel).toBe(
      "Snap needs a connection — try Quick Add instead",
    );
  });

  it("offline takes precedence over the AI-allowed state for the lock badge", () => {
    const { getByTestId } = render({ aiLocked: false, snapOffline: true });
    expect(getByTestId("fuel-quick-snap-lock")).toBeTruthy();
  });
});
