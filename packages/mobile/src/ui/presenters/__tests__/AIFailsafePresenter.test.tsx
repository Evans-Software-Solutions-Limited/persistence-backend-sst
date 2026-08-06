import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AIFailsafePresenter } from "@/ui/presenters/AIFailsafePresenter";

describe("AIFailsafePresenter", () => {
  it("states the daily reset honestly and exposes manual continuation", () => {
    const onDismiss = jest.fn();
    const onBuildManually = jest.fn();
    render(
      <AIFailsafePresenter
        onDismiss={onDismiss}
        onBuildManually={onBuildManually}
      />,
    );
    expect(
      screen.getByText("You've reached today's workout adaptation limit"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Workout adaptations reset automatically at the next daily reset — nothing you need to do.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/short break|little while|tomorrow/i)).toBeNull();
    expect(screen.queryByText(/credits|used \d|limit of/i)).toBeNull();
    fireEvent.press(screen.getByText("Got it"));
    fireEvent.press(screen.getByText("Build a workout myself"));
    expect(onDismiss).toHaveBeenCalled();
    expect(onBuildManually).toHaveBeenCalled();
  });
});
