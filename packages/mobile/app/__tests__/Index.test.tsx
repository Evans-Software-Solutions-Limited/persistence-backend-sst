import { renderWithTheme } from "../../__tests__/test-utils";
import { StyleSheet } from "react-native";
import Index from "../index";

jest.mock("../../src/ui/components", () => ({
  PLogoDrawLoader: () => null,
}));

describe("Index bootstrap", () => {
  it("uses the canonical dark full-screen surface", () => {
    const view = renderWithTheme(<Index />);

    expect(
      StyleSheet.flatten(
        view.getByTestId("root-bootstrap-loading").props.style,
      ),
    ).toEqual(expect.objectContaining({ backgroundColor: "#0A0B12" }));
  });
});
