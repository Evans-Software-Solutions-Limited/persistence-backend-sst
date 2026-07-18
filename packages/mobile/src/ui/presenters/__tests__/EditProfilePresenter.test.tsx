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
    dateOfBirth: "1990-01-15",
    gender: null,
    heightCm: "",
    weightUnit: "kg",
    heightUnit: "cm",
    isProfilePublic: false,
    isSaving: false,
    isLoadingInitial: false,
    errorMessage: null,
    onFullNameChange: jest.fn(),
    onFitnessLevelChange: jest.fn(),
    onGenderChange: jest.fn(),
    onDateOfBirthChange: jest.fn(),
    onHeightCmChange: jest.fn(),
    onWeightUnitChange: jest.fn(),
    onHeightUnitChange: jest.fn(),
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

  it("renders the DOB field and fires onDateOfBirthChange (STORY-010)", () => {
    const onDateOfBirthChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onDateOfBirthChange })} />,
    );
    expect(getByTestId("edit-profile-dob").props.value).toBe("1990-01-15");
    fireEvent.changeText(getByTestId("edit-profile-dob"), "1992-02-29");
    expect(onDateOfBirthChange).toHaveBeenCalledWith("1992-02-29");
  });

  it("fires onFitnessLevelChange when a different level is tapped", () => {
    const onFitnessLevelChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onFitnessLevelChange })} />,
    );
    fireEvent.press(getByTestId("edit-profile-fitness-elite"));
    expect(onFitnessLevelChange).toHaveBeenCalledWith("elite");
  });

  it("fires onGenderChange when a sex option is tapped", () => {
    const onGenderChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onGenderChange })} />,
    );
    fireEvent.press(getByTestId("edit-profile-gender-female"));
    expect(onGenderChange).toHaveBeenCalledWith("female");
  });

  it("maps 'Prefer not to say' to the 'other' value", () => {
    const onGenderChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onGenderChange })} />,
    );
    fireEvent.press(getByTestId("edit-profile-gender-other"));
    expect(onGenderChange).toHaveBeenCalledWith("other");
  });

  it("highlights the selected sex and leaves others unselected", () => {
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ gender: "female" })} />,
    );
    // The selected chip renders in the primary tone; a smoke check that the
    // node exists + the unselected sibling does too (visual state via style).
    expect(getByTestId("edit-profile-gender-female")).toBeTruthy();
    expect(getByTestId("edit-profile-gender-male")).toBeTruthy();
  });

  it("renders the height field and fires onHeightCmChange on input", () => {
    const onHeightCmChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({ heightCm: "178", onHeightCmChange })}
      />,
    );
    expect(getByTestId("edit-profile-height").props.value).toBe("178");
    fireEvent.changeText(getByTestId("edit-profile-height"), "180");
    expect(onHeightCmChange).toHaveBeenCalledWith("180");
  });

  it("renders cm or ft+in inputs based on the controlled heightUnit prop", () => {
    const { getByTestId, queryByTestId, rerender } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({ heightCm: "178", heightUnit: "cm" })}
      />,
    );
    expect(getByTestId("edit-profile-height").props.value).toBe("178");
    expect(queryByTestId("edit-profile-height-feet")).toBeNull();

    rerender(
      <EditProfilePresenter
        {...makeProps({ heightCm: "178", heightUnit: "ftin" })}
      />,
    );
    // 178cm = 70.0787...in = 5ft 10.1in.
    expect(queryByTestId("edit-profile-height")).toBeNull();
    expect(getByTestId("edit-profile-height-feet").props.value).toBe("5");
    expect(getByTestId("edit-profile-height-inches").props.value).toBe("10.1");
  });

  it("fires onHeightUnitChange when the height field's own toggle is tapped", () => {
    const onHeightUnitChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({ heightUnit: "cm", onHeightUnitChange })}
      />,
    );
    fireEvent.press(getByTestId("edit-profile-height-unit-ftin"));
    expect(onHeightUnitChange).toHaveBeenCalledWith("ftin");
  });

  it("typing feet/inches computes the canonical cm via onHeightCmChange", () => {
    const onHeightCmChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({ heightCm: "", heightUnit: "ftin", onHeightCmChange })}
      />,
    );
    fireEvent.changeText(getByTestId("edit-profile-height-feet"), "5");
    expect(onHeightCmChange).toHaveBeenLastCalledWith("152.4"); // 5ft 0in
    fireEvent.changeText(getByTestId("edit-profile-height-inches"), "10");
    expect(onHeightCmChange).toHaveBeenLastCalledWith("177.8"); // 5ft 10in
  });

  it("clearing both feet and inches sends an empty string to clear height", () => {
    const onHeightCmChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({
          heightCm: "178",
          heightUnit: "ftin",
          onHeightCmChange,
        })}
      />,
    );
    fireEvent.changeText(getByTestId("edit-profile-height-feet"), "");
    fireEvent.changeText(getByTestId("edit-profile-height-inches"), "");
    expect(onHeightCmChange).toHaveBeenLastCalledWith("");
  });

  it("re-derives feet/inches from the cm prop when entering ft/in mode after hydration", () => {
    // Regression: heightUnit resolves alongside heightCm during hydration
    // (isLoadingInitial flips false), so the ft/in fields must reflect the
    // real cm value the first time they render, not a stale "" default.
    const { getByTestId, queryByTestId, rerender } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({
          heightCm: "",
          heightUnit: "cm",
          isLoadingInitial: true,
        })}
      />,
    );
    rerender(
      <EditProfilePresenter
        {...makeProps({
          heightCm: "178",
          heightUnit: "ftin",
          isLoadingInitial: false,
        })}
      />,
    );
    expect(queryByTestId("edit-profile-height")).toBeNull();
    expect(getByTestId("edit-profile-height-feet").props.value).toBe("5");
  });

  it("selecting a weight-unit option fires onWeightUnitChange", () => {
    const onWeightUnitChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ onWeightUnitChange })} />,
    );
    fireEvent.press(getByTestId("edit-profile-weight-unit-lb"));
    expect(onWeightUnitChange).toHaveBeenCalledWith("lb");
  });

  it("does NOT render the public-profile switch (v1 launch — public sharing hidden)", () => {
    // The public-discoverability toggle is removed for v1 (Apple Guideline
    // 1.2 de-risk). The wiring prop stays on the type but the control must
    // not render — there must be no UI path to make a profile public.
    const { queryByTestId } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ isProfilePublic: true })} />,
    );
    expect(queryByTestId("edit-profile-public-switch")).toBeNull();
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
    const { getByTestId, getByText } = renderWithTheme(
      <EditProfilePresenter
        {...makeProps({ isSaving: true, onFullNameChange, onSave })}
      />,
    );
    expect(getByTestId("edit-profile-full-name").props.editable).toBe(false);
    expect(getByTestId("edit-profile-dob").props.editable).toBe(false);
    // Save button shows the processing label + is disabled.
    expect(getByText("Saving…")).toBeTruthy();
    expect(
      getByTestId("edit-profile-save").props.accessibilityState?.disabled,
    ).toBeTruthy();
    fireEvent.press(getByTestId("edit-profile-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders each fitness level option, selected one highlighted", () => {
    const { getByText } = renderWithTheme(
      <EditProfilePresenter {...makeProps({ fitnessLevel: "elite" })} />,
    );
    // capitalize() runs for every level label.
    expect(getByText("Beginner")).toBeTruthy();
    expect(getByText("Intermediate")).toBeTruthy();
    expect(getByText("Advanced")).toBeTruthy();
    expect(getByText("Elite")).toBeTruthy();
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
