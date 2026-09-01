import { render } from "@testing-library/react-native";
import type { ComponentProps } from "react";
import type { Redirect } from "expo-router";
import BodyFatHistoryScreen from "../body-fat-history";

const mockRedirect = jest.fn((_props: ComponentProps<typeof Redirect>) => null);

jest.mock("expo-router", () => ({
  Redirect: (props: ComponentProps<typeof Redirect>) => mockRedirect(props),
}));

jest.mock("@/ui/containers/BodyHistoryContainer", () => ({
  BodyHistoryContainer: () => null,
}));

jest.mock("@/ui/state/experiencePolish", () => ({
  isExperiencePolishEnabled: () => false,
}));

describe("BodyFatHistoryScreen compatibility redirect", () => {
  it("preserves body-fat context while experience polish is disabled", () => {
    render(<BodyFatHistoryScreen />);
    expect(mockRedirect).toHaveBeenLastCalledWith({
      href: "/(app)/body-history?metric=bodyFat",
    });
  });
});
