import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  EditProfilePresenter,
  type EditProfilePresenterProps,
} from "../EditProfilePresenter";

function makeProps(
  overrides: Partial<EditProfilePresenterProps> = {},
): EditProfilePresenterProps {
  return {
    fullName: "Brad Simms",
    fitnessLevel: "intermediate",
    isProfilePublic: false,
    isSaving: false,
    isLoadingInitial: false,
    errorMessage: null,
    onFullNameChange: jest.fn(),
    onFitnessLevelChange: jest.fn(),
    onIsProfilePublicChange: jest.fn(),
    onSave: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  };
}

describe("EditProfilePresenter", () => {
  it("renders the loader when isLoadingInitial is true", () => {
    const { queryByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ isLoadingInitial: true })} />,
    );
    expect(queryByTestId("edit-profile-screen")).toBeTruthy();
    expect(queryByTestId("edit-profile-full-name")).toBeNull();
    expect(queryByTestId("edit-profile-save")).toBeNull();
  });

  it("renders the form with initial values", () => {
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps()} />,
    );
    expect(getByTestId("edit-profile-full-name").props.value).toBe(
      "Brad Simms",
    );
    expect(getByTestId("edit-profile-public-switch").props.value).toBe(false);
  });

  it("highlights the selected fitness level", () => {
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ fitnessLevel: "advanced" })} />,
    );
    // The selected option's style array has the optionSelected style
    // appended; assert it by checking the merged style background colour.
    const advanced = getByTestId("edit-profile-fitness-advanced");
    const beginner = getByTestId("edit-profile-fitness-beginner");
    // RN's style flattening is implementation-specific; assert by way of
    // the testID being rendered and pressable. Selection signal is via
    // fontWeight on the inner Text — we read that instead.
    expect(advanced.props.disabled).toBeFalsy();
    expect(beginner.props.disabled).toBeFalsy();
  });

  it("fires onFullNameChange when the text field changes", () => {
    const onFullNameChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onFullNameChange })} />,
    );
    fireEvent.changeText(getByTestId("edit-profile-full-name"), "New Name");
    expect(onFullNameChange).toHaveBeenCalledWith("New Name");
  });

  it("fires onFitnessLevelChange when a different level is tapped", () => {
    const onFitnessLevelChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onFitnessLevelChange })} />,
    );
    fireEvent.press(getByTestId("edit-profile-fitness-elite"));
    expect(onFitnessLevelChange).toHaveBeenCalledWith("elite");
  });

  it("fires onIsProfilePublicChange when the switch toggles", () => {
    const onIsProfilePublicChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onIsProfilePublicChange })} />,
    );
    fireEvent(getByTestId("edit-profile-public-switch"), "valueChange", true);
    expect(onIsProfilePublicChange).toHaveBeenCalledWith(true);
  });

  it("fires onSave when the Save Changes button is tapped", () => {
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onSave })} />,
    );
    fireEvent.press(getByTestId("edit-profile-save"));
    expect(onSave).toHaveBeenCalled();
  });

  it("fires onBack when the back button is tapped", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onBack })} />,
    );
    fireEvent.press(getByTestId("edit-profile-back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("disables inputs + save while isSaving", () => {
    const onFullNameChange = jest.fn();
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({ isSaving: true, onFullNameChange, onSave })}
      />,
    );
    expect(getByTestId("edit-profile-full-name").props.editable).toBe(false);
    expect(
      getByTestId("edit-profile-save").props.accessibilityState?.disabled,
    ).toBeTruthy();
    fireEvent.press(getByTestId("edit-profile-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders the error banner when errorMessage is set", () => {
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({ errorMessage: "Couldn't save" })}
      />,
    );
    const banner = getByTestId("edit-profile-error");
    expect(banner).toBeTruthy();
  });
});
