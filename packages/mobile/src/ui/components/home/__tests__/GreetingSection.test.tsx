import { GreetingSection } from "@/ui/components/home/GreetingSection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("GreetingSection", () => {
  const subscription = {
    tierName: "Pro",
    isFreeTier: false,
    isTrainerTier: false,
  };

  it("renders the user's first name", () => {
    const { getByText } = renderWithTheme(
      <GreetingSection
        firstName="Alex"
        subscription={subscription}
        onUpgradePress={jest.fn()}
      />,
    );
    expect(getByText("Hey, Alex")).toBeTruthy();
    expect(getByText("WELCOME BACK")).toBeTruthy();
  });

  it("falls back to 'Lifter' when firstName is null (AC 5.1)", () => {
    const { getByText } = renderWithTheme(
      <GreetingSection
        firstName={null}
        subscription={subscription}
        onUpgradePress={jest.fn()}
      />,
    );
    expect(getByText("Hey, Lifter")).toBeTruthy();
  });

  it("falls back to 'Lifter' when firstName is only whitespace", () => {
    const { getByText } = renderWithTheme(
      <GreetingSection
        firstName="   "
        subscription={subscription}
        onUpgradePress={jest.fn()}
      />,
    );
    expect(getByText("Hey, Lifter")).toBeTruthy();
  });
});
