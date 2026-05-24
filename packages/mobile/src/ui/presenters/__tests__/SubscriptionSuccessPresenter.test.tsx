import { fireEvent, render as rawRender, screen } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import config from "../../../../tamagui.config";
import { SubscriptionSuccessPresenter } from "@/ui/presenters/SubscriptionSuccessPresenter";

function render(ui: React.ReactElement) {
  return rawRender(
    <TamaguiProvider config={config} defaultTheme="dark">
      {ui}
    </TamaguiProvider>,
  );
}

const benefits = [
  {
    icon: "checkmark-circle",
    title: "Unlimited Workouts",
    description: "Create and track unlimited workouts",
  },
];

describe("SubscriptionSuccessPresenter", () => {
  it("renders the title + success message", () => {
    render(
      <SubscriptionSuccessPresenter
        successMessage="Your subscription is active!"
        benefits={benefits}
        isTrainerTier={false}
        onGoToHome={jest.fn()}
        onManageClients={jest.fn()}
      />,
    );
    expect(screen.getByText("Subscription Activated!")).toBeTruthy();
    expect(screen.getByText("Your subscription is active!")).toBeTruthy();
  });

  it("renders the benefits list", () => {
    render(
      <SubscriptionSuccessPresenter
        successMessage=""
        benefits={[
          ...benefits,
          {
            icon: "sparkles",
            title: "AI Analytics",
            description: "AI-supported reporting",
          },
        ]}
        isTrainerTier={false}
        onGoToHome={jest.fn()}
        onManageClients={jest.fn()}
      />,
    );
    expect(screen.getByText("Unlimited Workouts")).toBeTruthy();
    expect(screen.getByText("AI Analytics")).toBeTruthy();
  });

  it("hides Manage Clients CTA for non-trainer tiers", () => {
    render(
      <SubscriptionSuccessPresenter
        successMessage=""
        benefits={benefits}
        isTrainerTier={false}
        onGoToHome={jest.fn()}
        onManageClients={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("success-manage-clients")).toBeNull();
    expect(screen.getByTestId("success-go-home")).toBeTruthy();
  });

  it("shows Manage Clients CTA on trainer tiers", () => {
    render(
      <SubscriptionSuccessPresenter
        successMessage=""
        benefits={benefits}
        isTrainerTier
        onGoToHome={jest.fn()}
        onManageClients={jest.fn()}
      />,
    );
    expect(screen.getByTestId("success-manage-clients")).toBeTruthy();
  });

  it("fires onGoToHome and onManageClients", () => {
    const onGoToHome = jest.fn();
    const onManageClients = jest.fn();
    render(
      <SubscriptionSuccessPresenter
        successMessage=""
        benefits={benefits}
        isTrainerTier
        onGoToHome={onGoToHome}
        onManageClients={onManageClients}
      />,
    );
    fireEvent.press(screen.getByTestId("success-go-home"));
    fireEvent.press(screen.getByTestId("success-manage-clients"));
    expect(onGoToHome).toHaveBeenCalledTimes(1);
    expect(onManageClients).toHaveBeenCalledTimes(1);
  });
});
