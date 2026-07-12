import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  RecipeImportPresenter,
  type RecipeImportPresenterProps,
} from "../RecipeImportPresenter";

function render(over: Partial<RecipeImportPresenterProps> = {}) {
  const props: RecipeImportPresenterProps = {
    stage: "input",
    url: "",
    onUrlChange: jest.fn(),
    onImport: jest.fn(),
    onCreateManually: jest.fn(),
    onRetry: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<RecipeImportPresenter {...props} />), props };
}

describe("RecipeImportPresenter — input stage", () => {
  it("disables submit with no URL", () => {
    const { getByTestId, props } = render({ url: "" });
    fireEvent.press(getByTestId("recipe-import-submit"));
    expect(props.onImport).not.toHaveBeenCalled();
  });

  it("fires onUrlChange while typing", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(
      getByTestId("recipe-import-url-input"),
      "https://x.test/recipe",
    );
    expect(props.onUrlChange).toHaveBeenCalledWith("https://x.test/recipe");
  });

  it("fires onImport when a URL is present", () => {
    const { getByTestId, props } = render({ url: "https://x.test/recipe" });
    fireEvent.press(getByTestId("recipe-import-submit"));
    expect(props.onImport).toHaveBeenCalledTimes(1);
  });

  it("Back fires onBack", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("recipe-import-back"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

describe("RecipeImportPresenter — importing stage", () => {
  it("shows a loading state", () => {
    const { getByTestId } = render({ stage: "importing" });
    expect(getByTestId("recipe-import-loading")).toBeTruthy();
  });
});

describe("RecipeImportPresenter — no-microdata stage", () => {
  it("offers Create manually", () => {
    const { getByTestId, props } = render({ stage: "no-microdata" });
    expect(getByTestId("recipe-import-no-microdata")).toBeTruthy();
    fireEvent.press(getByTestId("recipe-import-create-manually"));
    expect(props.onCreateManually).toHaveBeenCalledTimes(1);
  });
});

describe("RecipeImportPresenter — error stage", () => {
  it("offers Retry", () => {
    const { getByTestId, props } = render({ stage: "error" });
    expect(getByTestId("recipe-import-error")).toBeTruthy();
    fireEvent.press(getByTestId("recipe-import-retry"));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
