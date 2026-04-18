import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ComingSoon } from "../ComingSoon";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  const Ionicons = ({ name }: { name: string }) => (
    <Text testID={`icon-${name}`}>{name}</Text>
  );
  return { Ionicons };
});

describe("ComingSoon", () => {
  it("renders the title, description, and icon", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ComingSoon
        icon="stats-chart-outline"
        title="Progress"
        description="Charts coming soon."
        testID="progress-placeholder"
      />,
    );
    expect(getByText("Progress")).toBeTruthy();
    expect(getByText("Charts coming soon.")).toBeTruthy();
    expect(getByTestId("icon-stats-chart-outline")).toBeTruthy();
    expect(getByTestId("progress-placeholder")).toBeTruthy();
  });
});
