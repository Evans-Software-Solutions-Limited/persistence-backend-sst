import { Text } from "react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { AdaptiveSuiteRouteGuard } from "../AdaptiveSuiteRouteGuard";

jest.mock("expo-router", () => {
  const { Text: MockText } = jest.requireActual("react-native") as {
    Text: typeof Text;
  };
  return {
    Redirect: ({ href }: { href: string }) => (
      <MockText testID="adaptive-suite-redirect">{href}</MockText>
    ),
  };
});

describe("AdaptiveSuiteRouteGuard", () => {
  it("holds a neutral pending screen while entitlement resolves", () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <AdaptiveSuiteRouteGuard
        allowed={false}
        isResolved={false}
        fallback="/(app)/(tabs)/fuel"
      >
        <Text>Protected content</Text>
      </AdaptiveSuiteRouteGuard>,
    );

    expect(getByTestId("adaptive-suite-route-pending")).toBeTruthy();
    expect(queryByText("Protected content")).toBeNull();
  });

  it("redirects a resolved deny without mounting protected content", () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <AdaptiveSuiteRouteGuard
        allowed={false}
        isResolved
        fallback="/(app)/(tabs)/fuel"
      >
        <Text>Protected content</Text>
      </AdaptiveSuiteRouteGuard>,
    );

    expect(getByTestId("adaptive-suite-redirect").props.children).toBe(
      "/(app)/(tabs)/fuel",
    );
    expect(queryByText("Protected content")).toBeNull();
  });

  it("mounts protected content only for an allowed verdict", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <AdaptiveSuiteRouteGuard allowed isResolved fallback="/(app)/(tabs)/fuel">
        <Text>Protected content</Text>
      </AdaptiveSuiteRouteGuard>,
    );

    expect(getByText("Protected content")).toBeTruthy();
    expect(queryByTestId("adaptive-suite-redirect")).toBeNull();
  });
});
