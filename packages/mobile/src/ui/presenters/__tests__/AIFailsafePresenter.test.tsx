import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AIFailsafePresenter } from "@/ui/presenters/AIFailsafePresenter";

describe("AIFailsafePresenter", () => {
  it("is temporary, blameless and exposes manual continuation", () => {
    const onDismiss = jest.fn();
    const onBuildManually = jest.fn();
    render(
      <AIFailsafePresenter
        onDismiss={onDismiss}
        onBuildManually={onBuildManually}
      />,
    );
    expect(screen.getByText("AI is taking a short break")).toBeTruthy();
    expect(screen.queryByText(/credits|used \d|limit of/i)).toBeNull();
    fireEvent.press(screen.getByText("Got it"));
    fireEvent.press(screen.getByText("Build a workout myself"));
    expect(onDismiss).toHaveBeenCalled();
    expect(onBuildManually).toHaveBeenCalled();
  });
});
