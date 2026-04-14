import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Avatar } from "../Avatar";

describe("Avatar", () => {
  it("renders initials when no source provided", () => {
    const { getByText } = renderWithTheme(<Avatar fallback="JD" />);
    expect(getByText("JD")).toBeTruthy();
  });

  it("renders image when source provided", () => {
    const { getByTestId } = renderWithTheme(
      <Avatar
        source="https://example.com/avatar.jpg"
        fallback="JD"
        testID="avatar"
      />,
    );
    expect(getByTestId("avatar-image")).toBeTruthy();
  });

  it("renders all size variants", () => {
    const sizes = ["sm", "md", "lg"] as const;
    for (const size of sizes) {
      const { getByText } = renderWithTheme(
        <Avatar fallback={size.toUpperCase()} size={size} />,
      );
      expect(getByText(size.toUpperCase())).toBeTruthy();
    }
  });

  it("has image accessibility role", () => {
    const { getByTestId } = renderWithTheme(
      <Avatar fallback="JD" testID="avatar" />,
    );
    expect(getByTestId("avatar").props.accessibilityRole).toBe("image");
  });

  it("has accessibility label from fallback", () => {
    const { getByTestId } = renderWithTheme(
      <Avatar fallback="Jane Doe" testID="avatar" />,
    );
    expect(getByTestId("avatar").props.accessibilityLabel).toBe("Jane Doe");
  });
});
