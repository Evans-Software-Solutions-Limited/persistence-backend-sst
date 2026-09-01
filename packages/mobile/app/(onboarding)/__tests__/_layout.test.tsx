import { render } from "@testing-library/react-native";

import OnboardingLayout from "../_layout";

let mockScreenOptions: Record<string, unknown> | undefined;

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    Stack: ({ screenOptions }: { screenOptions: Record<string, unknown> }) => {
      mockScreenOptions = screenOptions;
      return React.createElement(View, { testID: "onboarding-stack" });
    },
  };
});

describe("OnboardingLayout", () => {
  it("uses a page-like horizontal transition instead of a cross-fade", () => {
    render(<OnboardingLayout />);

    expect(mockScreenOptions).toMatchObject({
      animation: "slide_from_right",
      gestureEnabled: false,
      headerShown: false,
    });
  });
});
