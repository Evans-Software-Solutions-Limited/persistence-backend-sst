import { render, screen } from "@testing-library/react-native";
import { OfflineBanner } from "@/ui/components/subscription/OfflineBanner";

describe("OfflineBanner", () => {
  it("renders the banner with the offline copy + testID", () => {
    render(<OfflineBanner />);
    expect(screen.getByTestId("subscription-offline-banner")).toBeTruthy();
    expect(screen.getByText("You're offline")).toBeTruthy();
  });
});
