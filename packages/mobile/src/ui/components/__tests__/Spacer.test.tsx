import { Text } from "react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Spacer } from "../Spacer";

describe("Spacer", () => {
  it("renders as flex spacer by default", () => {
    const { UNSAFE_root } = renderWithTheme(<Spacer testID="spacer" />);
    expect(UNSAFE_root).toBeTruthy();
  });

  it("renders with size variant", () => {
    const { UNSAFE_root } = renderWithTheme(<Spacer size="md" />);
    expect(UNSAFE_root).toBeTruthy();
  });

  it("renders between siblings", () => {
    const { getByText } = renderWithTheme(
      <>
        <Text>Before</Text>
        <Spacer />
        <Text>After</Text>
      </>,
    );
    expect(getByText("Before")).toBeTruthy();
    expect(getByText("After")).toBeTruthy();
  });
});
