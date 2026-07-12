import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  AddRecipeMenuPresenter,
  type AddRecipeMenuPresenterProps,
} from "../AddRecipeMenuPresenter";

function render(over: Partial<AddRecipeMenuPresenterProps> = {}) {
  const props: AddRecipeMenuPresenterProps = {
    visible: true,
    onClose: jest.fn(),
    onSaveMeal: jest.fn(),
    onCreateRecipe: jest.fn(),
    onSnapRecipe: jest.fn(),
    snapDisabled: false,
    onImportUrl: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<AddRecipeMenuPresenter {...props} />), props };
}

describe("AddRecipeMenuPresenter", () => {
  it("renders all four rows", () => {
    const { getByTestId } = render();
    expect(getByTestId("add-recipe-menu-save-meal")).toBeTruthy();
    expect(getByTestId("add-recipe-menu-create-recipe")).toBeTruthy();
    expect(getByTestId("add-recipe-menu-snap")).toBeTruthy();
    expect(getByTestId("add-recipe-menu-import-url")).toBeTruthy();
  });

  it("fires onSaveMeal", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("add-recipe-menu-save-meal"));
    expect(props.onSaveMeal).toHaveBeenCalledTimes(1);
  });

  it("fires onCreateRecipe", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("add-recipe-menu-create-recipe"));
    expect(props.onCreateRecipe).toHaveBeenCalledTimes(1);
  });

  it("fires onImportUrl", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("add-recipe-menu-import-url"));
    expect(props.onImportUrl).toHaveBeenCalledTimes(1);
  });

  it("fires onSnapRecipe when not disabled", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("add-recipe-menu-snap"));
    expect(props.onSnapRecipe).toHaveBeenCalledTimes(1);
  });

  it("disables the snap row when snapDisabled (offline)", () => {
    const { getByTestId, props } = render({ snapDisabled: true });
    fireEvent.press(getByTestId("add-recipe-menu-snap"));
    expect(props.onSnapRecipe).not.toHaveBeenCalled();
  });
});
