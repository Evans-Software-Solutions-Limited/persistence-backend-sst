import { renderWithTheme } from "../../__tests__/test-utils";
import NotFoundScreen from "../+not-found";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  const Ionicons = ({ name }: { name: string }) => (
    <Text testID={`icon-${name}`}>{name}</Text>
  );
  return { Ionicons };
});

describe("NotFoundScreen (+not-found)", () => {
  it("renders a visible fallback instead of a silent dead-end", () => {
    const { getByText, getByTestId } = renderWithTheme(<NotFoundScreen />);
    expect(getByText("Screen not found")).toBeTruthy();
    expect(
      getByText("We couldn't find the screen you were looking for."),
    ).toBeTruthy();
    expect(getByTestId("not-found")).toBeTruthy();
  });
});
