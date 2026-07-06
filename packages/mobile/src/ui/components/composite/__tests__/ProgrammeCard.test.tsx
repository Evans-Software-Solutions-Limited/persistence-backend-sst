import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { ProgrammeCard } from "../ProgrammeCard";

describe("ProgrammeCard", () => {
  it("renders the eyebrow, name, finite week line + segmented bar", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ProgrammeCard
        programName="Strength Foundations"
        week={4}
        totalWeeks={12}
        testID="pc"
      />,
    );
    expect(getByText("Active programme")).toBeTruthy();
    expect(getByText("Strength Foundations")).toBeTruthy();
    expect(getByText("Week 4 / 12")).toBeTruthy();
    expect(getByText("· 8 weeks remaining")).toBeTruthy();
    // Finite → the segmented progress bar renders.
    expect(getByTestId("pc-bar")).toBeTruthy();
  });

  it("singularises 'week remaining' at one week left", () => {
    const { getByText } = renderWithTheme(
      <ProgrammeCard programName="Cut Block" week={11} totalWeeks={12} />,
    );
    expect(getByText("· 1 week remaining")).toBeTruthy();
  });

  it("omits the remaining label on the final week", () => {
    const { queryByText, getByText } = renderWithTheme(
      <ProgrammeCard programName="Cut Block" week={12} totalWeeks={12} />,
    );
    expect(getByText("Week 12 / 12")).toBeTruthy();
    expect(queryByText(/remaining/)).toBeNull();
  });

  it("renders the indefinite variant with no bar or denominator", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <ProgrammeCard
        programName="Ongoing Weight Loss"
        week={3}
        totalWeeks={null}
        testID="pc"
      />,
    );
    expect(getByText("Week 3 · Ongoing")).toBeTruthy();
    expect(queryByTestId("pc-bar")).toBeNull();
  });

  it("is pressable + shows the chevron only when onPress is provided", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgrammeCard
        programName="Hypertrophy"
        week={2}
        totalWeeks={8}
        onPress={onPress}
        testID="pc"
      />,
    );
    fireEvent.press(getByTestId("pc-pressable"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
