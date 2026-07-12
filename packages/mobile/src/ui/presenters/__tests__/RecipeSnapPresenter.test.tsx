import { createRef } from "react";
import { fireEvent } from "@testing-library/react-native";
import { CameraView } from "expo-camera";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  RecipeSnapPresenter,
  type RecipeSnapPresenterProps,
} from "../RecipeSnapPresenter";

function render(over: Partial<RecipeSnapPresenterProps> = {}) {
  const props: RecipeSnapPresenterProps = {
    stage: "capture",
    offline: false,
    hasPermission: true,
    onRequestPermission: jest.fn(),
    cameraRef: createRef<CameraView>(),
    onShutterPress: jest.fn(),
    onPickFromLibrary: jest.fn(),
    errorMessage: null,
    onRetry: jest.fn(),
    onChooseAnother: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<RecipeSnapPresenter {...props} />), props };
}

describe("RecipeSnapPresenter — capture stage", () => {
  it("shows the offline notice and hides the camera when offline", () => {
    const { getByTestId, queryByTestId } = render({ offline: true });
    expect(getByTestId("recipe-snap-offline")).toBeTruthy();
    expect(queryByTestId("recipe-snap-camera")).toBeNull();
  });

  it("prompts for permission when not granted", () => {
    const { getByTestId, props } = render({ hasPermission: false });
    fireEvent.press(getByTestId("recipe-snap-grant"));
    expect(props.onRequestPermission).toHaveBeenCalledTimes(1);
  });

  it("offers library pick without permission too", () => {
    const { getByTestId, props } = render({ hasPermission: false });
    fireEvent.press(getByTestId("recipe-snap-pick-library-no-permission"));
    expect(props.onPickFromLibrary).toHaveBeenCalledTimes(1);
  });

  it("shows the camera + shutter when permitted and online", () => {
    const { getByTestId, props } = render();
    expect(getByTestId("recipe-snap-camera")).toBeTruthy();
    fireEvent.press(getByTestId("recipe-snap-shutter"));
    expect(props.onShutterPress).toHaveBeenCalledTimes(1);
  });

  it("fires onPickFromLibrary from the library button", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("recipe-snap-pick-library"));
    expect(props.onPickFromLibrary).toHaveBeenCalledTimes(1);
  });
});

describe("RecipeSnapPresenter — extracting stage", () => {
  it("shows an extracting indicator", () => {
    const { getByTestId } = render({ stage: "extracting" });
    expect(getByTestId("recipe-snap-extracting")).toBeTruthy();
  });
});

describe("RecipeSnapPresenter — error stage", () => {
  it("shows the error message and Retry / Choose another actions", () => {
    const { getByTestId, getByText, props } = render({
      stage: "error",
      errorMessage: "Daily AI limit reached.",
    });
    expect(getByText("Daily AI limit reached.")).toBeTruthy();
    fireEvent.press(getByTestId("recipe-snap-retry"));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("recipe-snap-choose-another"));
    expect(props.onChooseAnother).toHaveBeenCalledTimes(1);
  });

  it("falls back to generic copy when no errorMessage is set", () => {
    const { getByText } = render({ stage: "error", errorMessage: null });
    expect(getByText("Couldn't read this photo — try again.")).toBeTruthy();
  });
});

describe("RecipeSnapPresenter — header", () => {
  it("Back fires onBack", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("recipe-snap-back"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
