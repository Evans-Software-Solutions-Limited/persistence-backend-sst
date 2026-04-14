import { Text } from "react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("renders title", () => {
    const { getByText } = renderWithTheme(<EmptyState title="No workouts" />);
    expect(getByText("No workouts")).toBeTruthy();
  });

  it("renders description when provided", () => {
    const { getByText } = renderWithTheme(
      <EmptyState
        title="No workouts"
        description="Create your first workout to get started"
      />,
    );
    expect(getByText("Create your first workout to get started")).toBeTruthy();
  });

  it("renders icon when provided", () => {
    const { getByText } = renderWithTheme(
      <EmptyState title="No workouts" icon={<Text>Icon</Text>} />,
    );
    expect(getByText("Icon")).toBeTruthy();
  });

  it("renders action button when provided", () => {
    const onPress = jest.fn();
    const { getByText } = renderWithTheme(
      <EmptyState
        title="No workouts"
        action={{ label: "Create Workout", onPress }}
      />,
    );
    expect(getByText("Create Workout")).toBeTruthy();
  });

  it("renders with testID", () => {
    const { getByTestId } = renderWithTheme(
      <EmptyState title="Empty" testID="empty" />,
    );
    expect(getByTestId("empty")).toBeTruthy();
  });
});
